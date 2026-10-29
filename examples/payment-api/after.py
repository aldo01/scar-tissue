# The same checkout endpoint after `scar-tissue` hardening.
# Each change is tagged with the finding it fixes (see scar-tissue-report.json).
#
# Models (Cart, Order, Wallet, IdempotencyKey, OutboxEvent) are omitted for brevity.
# IdempotencyKey has a unique constraint on (customer_id, key).
# A separate outbox relay publishes OutboxEvent rows and retries on failure.
# current_customer_id() resolves the caller from a verified session or token.

import hashlib
import json
import random
import time

import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from .auth import current_customer_id
from .db import Cart, IdempotencyKey, Order, OutboxEvent, SessionLocal, Wallet

app = FastAPI()
PAYMENTS_URL = "https://payments.example.com/v1/charges"
PAYMENTS_TIMEOUT = (3, 10)                     # ST-008: (connect, read) seconds
RETRYABLE_STATUS = {429, 502, 503, 504}        # ST-012: only transient failures
MAX_ATTEMPTS = 3
MAX_PAGE_SIZE = 100

http = requests.Session()


def charge(customer_id: str, amount_cents: int, idempotency_key: str) -> dict:
    """Charge the card. Retrying is safe because the provider deduplicates on
    the Idempotency-Key, which stays the same across attempts (ST-003)."""
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = http.post(
                PAYMENTS_URL,
                json={"customer": customer_id, "amount": amount_cents},
                headers={"Idempotency-Key": idempotency_key},
                timeout=PAYMENTS_TIMEOUT,
            )
        except (requests.ConnectionError, requests.Timeout):
            pass                                # transient: retry below
        else:
            if resp.status_code < 400:
                return resp.json()
            if resp.status_code not in RETRYABLE_STATUS:
                raise HTTPException(status_code=402, detail="payment declined")  # ST-012: no retry
        # ST-009: exponential backoff with full jitter
        time.sleep(random.uniform(0, min(4.0, 0.5 * 2 ** attempt)))
    raise HTTPException(status_code=502, detail="payment provider unavailable")


def _request_hash(cart_id: int, use_wallet: bool) -> str:
    payload = json.dumps([cart_id, use_wallet])
    return hashlib.sha256(payload.encode()).hexdigest()


@app.post("/checkout")
def checkout(
    cart_id: int,
    use_wallet: bool = False,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),   # ST-002
    customer_id: str = Depends(current_customer_id),               # ST-001: never from the request
):
    request_hash = _request_hash(cart_id, use_wallet)

    with SessionLocal() as db:
        # ST-002: claim the key BEFORE any side effect. The unique constraint
        # on (customer_id, key) decides which request wins, even under races.
        db.add(IdempotencyKey(customer_id=customer_id, key=idempotency_key,
                              request_hash=request_hash, status="in_progress"))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.execute(
                select(IdempotencyKey).filter_by(customer_id=customer_id, key=idempotency_key)
            ).scalar_one()
            if existing.request_hash != request_hash:
                raise HTTPException(status_code=422, detail="Idempotency-Key reused for a different request")
            if existing.status == "completed":
                return existing.response                      # replay, no second charge
            raise HTTPException(status_code=409, detail="checkout already in progress")

        def release_key():
            # Let the client retry after a failure that happened before any charge.
            db.execute(delete(IdempotencyKey).filter_by(customer_id=customer_id, key=idempotency_key))
            db.commit()

        # ST-001 / ST-007: the cart must belong to the caller, and the amount is
        # computed from server-side prices, never read from the request.
        cart = db.execute(select(Cart).filter_by(id=cart_id, customer_id=customer_id)).scalar_one_or_none()
        if cart is None:
            release_key()
            raise HTTPException(status_code=404, detail="cart not found")
        amount_cents = cart.total_cents()

        charge_id = None
        if not use_wallet:
            # External call happens outside any open transaction.
            try:
                charge_id = charge(customer_id, amount_cents, f"checkout:{customer_id}:{idempotency_key}")["id"]
            except HTTPException:
                release_key()
                raise
            # ST-005: if the process dies between here and the commit below, the key
            # stays 'in_progress'. A reconciliation job matches provider charges to
            # orders and either completes the order or refunds the charge.

        # One transaction: wallet debit, order, outbox event, key completion.
        if use_wallet:
            # ST-004: atomic conditional debit, no read-modify-write race.
            debited = db.execute(
                update(Wallet)
                .where(Wallet.customer_id == customer_id, Wallet.balance_cents >= amount_cents)
                .values(balance_cents=Wallet.balance_cents - amount_cents)
            ).rowcount
            if debited != 1:
                db.rollback()
                release_key()
                raise HTTPException(status_code=400, detail="insufficient balance")

        order = Order(customer_id=customer_id, amount_cents=amount_cents, charge_id=charge_id, status="PAID")
        db.add(order)
        db.flush()                                            # assigns order.id

        # ST-006 / ST-010: the event is written in the same transaction as the order.
        # The outbox relay publishes it, retries on failure, and alerts if stuck.
        db.add(OutboxEvent(topic="orders.paid", key=str(order.id), payload={"order_id": order.id}))

        response = {"order_id": order.id}
        db.execute(
            update(IdempotencyKey)
            .filter_by(customer_id=customer_id, key=idempotency_key)
            .values(status="completed", response=response)
        )
        db.commit()
        return response


@app.get("/orders")
def list_orders(
    after_id: int = 0,
    limit: int = 50,
    customer_id: str = Depends(current_customer_id),               # ST-001
):
    # ST-011: server-enforced page size and keyset pagination.
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    with SessionLocal() as db:
        rows = db.execute(
            select(Order)
            .where(Order.customer_id == customer_id, Order.id > after_id)
            .order_by(Order.id)
            .limit(limit)
        ).scalars().all()
        return {
            "orders": [o.to_dict() for o in rows],
            "next_after_id": rows[-1].id if len(rows) == limit else None,
        }
