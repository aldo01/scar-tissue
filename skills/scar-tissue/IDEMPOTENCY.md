# Idempotency

Networks lose responses, clients retry, users double-click, brokers redeliver, webhooks are re-sent, and cron jobs overlap. Any operation with a side effect will eventually run twice. The question is whether the second run does damage.

## Contents

- idempotency.missing-key
- idempotency.check-then-insert
- idempotency.key-stored-after-effect
- idempotency.consumer-not-idempotent
- idempotency.unstable-key

## idempotency.missing-key

**Look for**: an endpoint, RPC, or function that performs an irreversible or customer-visible side effect and has no way to recognize a repeated request: payments, refunds, payouts, transfers, order creation, inventory deduction, coupon redemption, account creation, sending email/SMS/push, outgoing webhooks, provisioning resources, mutating calls to third-party APIs.

**Not a finding when**:
- The operation is naturally idempotent: a PUT that replaces the resource, setting a field to a fixed value ("mark order 42 PAID"), an upsert keyed by a natural business key.
- A database unique constraint on a business key already prevents the duplicate (for example a unique constraint on `payments.order_id` when each order can be paid once), and the code handles the constraint violation as "already done".
- The endpoint is an internal admin action behind a human confirmation step. Lower the severity rather than dropping it if money moves.

**Failure**: the client's request times out after the server has already charged the card, so the client retries. The server cannot tell the retry from a new purchase and charges again. The same happens with mobile apps retrying on flaky networks, users double-clicking, and gateways retrying on 502.

**Fix**: accept an idempotency key from the caller (for example an `Idempotency-Key` header) and enforce it before the side effect:

1. Insert `(scope, key, request_hash, status='in_progress')` into a table with a **unique constraint** on `(scope, key)`. Scope keys per tenant or user so different callers cannot collide.
2. If the insert hits the constraint, this is a repeat. Load the existing row:
   - same `request_hash` and `completed` → return the stored response;
   - same hash and `in_progress` → return 409 (or tell the client to retry later); never run the side effect again;
   - different hash → return 422: the key was reused for a different request.
3. Perform the side effect. Pass a key derived from yours to any downstream provider that supports idempotency keys, so the provider deduplicates too.
4. Store the response and mark the row `completed`. If the side effect is local, do this in the same transaction as the effect.
5. Expire rows after a window longer than any client's retry period (at least 24 hours is common).

Decide explicitly what happens to an `in_progress` row whose process died: a reconciliation job that checks the downstream system and completes or reverses the operation.

**Verify**: tests that send the same request twice sequentially (second returns the stored response, one side effect), twice concurrently (one side effect, the other gets 409 or the replay), and the same key with a different body (422).

**Severity**: `critical` for money and customer-facing messages; `high` for other side effects.

## idempotency.check-then-insert

**Look for**: deduplication done by querying first and inserting second:

```python
if not Order.objects.filter(request_id=rid).exists():
    Order.objects.create(request_id=rid, ...)
```
```java
if (!repo.existsByExternalId(id)) { repo.save(new Payment(id, ...)); }
```

Also Rails `validates :x, uniqueness: true` without a matching unique index, which has the same race.

**Not a finding when**: a unique constraint exists on the column (check the schema or migrations) and the insert path handles the violation. The query-first check is then just an optimization.

**Failure**: two concurrent requests both run the query, both see nothing, and both insert. Duplicates appear only under concurrency, so they pass every test and show up in production during traffic spikes and retries.

**Fix**: let the database decide. Add a unique constraint and treat a conflict as "already done": `INSERT ... ON CONFLICT DO NOTHING` (PostgreSQL), `INSERT IGNORE`/`ON DUPLICATE KEY` (MySQL), or catch the unique-violation error (`IntegrityError`, `DataIntegrityViolationException`, error code `23505` in PostgreSQL).

**Verify**: a test that runs two inserts concurrently (threads with a barrier, or two database sessions) and asserts exactly one row.

**Severity**: `high`; `critical` when the duplicate moves money.

## idempotency.key-stored-after-effect

**Look for**: the idempotency or deduplication record is written after the side effect, or in a separate transaction that can fail independently of it.

**Not a finding when**: the key is claimed before the side effect, or the key and the effect are written in the same database transaction.

**Failure**: the side effect succeeds, then the process crashes, the deploy restarts the pod, or the write of the key fails. The retry finds no record and performs the side effect again.

**Fix**: claim the key first (status `in_progress`), then perform the effect, then mark it completed. For effects local to the same database, write the effect and the key in one transaction.

**Verify**: a test that injects a failure between the side effect and the key update, then retries, and asserts a single side effect.

**Severity**: `high`; `critical` for payments.

## idempotency.consumer-not-idempotent

**Look for**: a handler for a queue, stream, or webhook (Kafka, SQS, RabbitMQ, Pub/Sub, NATS, Stripe/GitHub/Shopify webhooks) that performs side effects with no deduplication, or that applies relative changes ("add 100 to balance", "increment count", "send email").

**Not a finding when**:
- The handler records processed message IDs (or a business key) under a unique constraint in the same transaction as its database effects.
- The effect is naturally idempotent: an upsert, "set status to SHIPPED", or an update guarded by a version or state check (`UPDATE ... WHERE status = 'PENDING'`).

**Failure**: brokers deliver at least once. After a consumer rebalance, a crash before the offset commit, an SQS visibility timeout, or a redeploy, the same message is processed again. Webhook providers retry on any non-2xx response or timeout. Balances are credited twice, customers get duplicate emails, inventory is decremented twice.

**Fix**: deduplicate on a stable identifier. Prefer a business key (`payment_id`, `order_id`) over the broker's message ID, because producers can also publish duplicates with different message IDs. Write the dedupe record and the handler's database changes in one transaction. Turn relative changes into absolute or guarded ones where possible.

**Verify**: a test that delivers the same message twice (and the same webhook twice) and asserts the effect happened once.

**Severity**: `critical` for balances and payments; `high` otherwise.

## idempotency.unstable-key

**Look for**: an idempotency key generated inside the retry loop or per attempt (`uuid4()` inside the loop, a timestamp, `Date.now()`), or a key derived from fields that change between attempts. Also client apps that generate a new key every time the user taps "Pay" after an error.

**Not a finding when**: the key is generated once per logical operation, before the first attempt, and reused for every retry.

**Failure**: every retry looks like a new request, so the receiver cannot deduplicate. The key exists but protects nothing.

**Fix**: create the key once per logical operation and pass it into the retry logic. On clients, persist it with the pending operation so it survives an app restart, and only rotate it when the user starts a genuinely new operation.

**Verify**: inspect the key across simulated retries in a test; it must be identical.

**Severity**: `high`; `critical` for payments.
