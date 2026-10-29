# A checkout endpoint written the way coding agents typically write it.
# It passes every happy-path test. It is also wrong in production in at
# least a dozen ways. See scar-tissue-report.json and after.py.
#
# Models (Order, Wallet) and publish() are omitted for brevity.

import time

import requests
from fastapi import FastAPI, HTTPException

from .db import Order, SessionLocal, Wallet
from .events import publish

app = FastAPI()
PAYMENTS_URL = "https://payments.example.com/v1/charges"


def charge_with_retry(customer_id: str, amount_cents: int) -> dict:
    for attempt in range(5):
        try:
            resp = requests.post(PAYMENTS_URL, json={"customer": customer_id, "amount": amount_cents})
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException:
            time.sleep(1)
    raise HTTPException(status_code=502, detail="payment failed")


@app.post("/checkout")
def checkout(customer_id: str, amount_cents: int, use_wallet: bool = False):
    db = SessionLocal()

    if use_wallet:
        wallet = db.query(Wallet).filter_by(customer_id=customer_id).first()
        if wallet.balance_cents < amount_cents:
            raise HTTPException(status_code=400, detail="insufficient balance")
        wallet.balance_cents -= amount_cents
        db.commit()
        charge = {"id": None}
    else:
        charge = charge_with_retry(customer_id, amount_cents)

    order = Order(customer_id=customer_id, amount_cents=amount_cents, charge_id=charge["id"], status="PAID")
    db.add(order)
    db.commit()

    try:
        publish("orders.paid", {"order_id": order.id})
    except Exception:
        pass

    return {"order_id": order.id}


@app.get("/orders")
def list_orders(customer_id: str):
    db = SessionLocal()
    return [o.to_dict() for o in db.query(Order).filter_by(customer_id=customer_id).all()]
