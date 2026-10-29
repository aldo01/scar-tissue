# Messaging

Queues and event streams make systems resilient only if the code accepts what brokers actually guarantee: messages arrive at least once, possibly out of order, possibly long after they were sent, and one bad message can stall everything behind it.

## Contents

- messaging.dual-write
- messaging.ack-before-processing
- messaging.poison-message
- messaging.ordering-key
- messaging.visibility-timeout

## messaging.dual-write

**Look for**: a database write and a message publish that must both happen, done as two separate operations:

```java
@Transactional
public void placeOrder(Order o) {
    orderRepository.save(o);
    kafkaTemplate.send("orders", o.getId(), event);   // not part of the DB transaction
}
```
```python
db.add(order); db.commit()
producer.send("orders", event)
```

The same applies to writing a row and then calling another service, writing a row and then updating a cache or search index that others depend on, and publishing first and then committing.

**Not a finding when**:
- An outbox table is written in the same transaction and a relay publishes it.
- The event is published only from change data capture on the database (for example Debezium).
- The two systems are in one transaction by design (for example Kafka transactions writing both state and output to Kafka).
- Losing the event is genuinely acceptable (best-effort analytics) and documented as such. Lower to `low`.

**Failure**: the commit succeeds and the publish fails (broker down, network blip, process killed between the two lines, deploy restart). The order exists but no downstream service hears about it: no fulfilment, no confirmation email, no invoice. In the reverse order, the event is published, the commit fails, and consumers act on an order that does not exist. Inside a `@Transactional` method, the send can also happen before the commit and still be published if the commit later rolls back.

**Fix**: the transactional outbox. In the same database transaction as the business change, insert the event into an `outbox` table. A relay (a polling publisher, or CDC with Debezium's outbox event router) publishes outbox rows in order and marks them sent. The relay can publish a row more than once, so consumers must be idempotent (`idempotency.consumer-not-idempotent`). Alert when the oldest unsent outbox row gets old.

**Verify**: a test that makes the broker unavailable during the business operation and asserts the event is still delivered once the broker recovers.

**Severity**: `critical` when the event drives money, fulfilment, or customer communication; `high` otherwise.

## messaging.ack-before-processing

**Look for**: the message is acknowledged, or its offset committed, before the work is durably done:
- RabbitMQ consumers with `autoAck=true` / `auto_ack=True` / `noAck: true`.
- Plain Kafka consumers with `enable.auto.commit=true` (the client default) that hand records to background threads or async tasks; auto-commit on the next `poll()` commits offsets for records still being processed.
- SQS handlers that call `DeleteMessage` at the start, or before the side effect completes.
- Pub/Sub or other clients that ack immediately on receipt and process asynchronously.

**Not a finding when**: acknowledgement happens after successful processing (manual ack; manual offset commit after the batch completes; Spring Kafka's default container behavior, which disables client auto-commit and commits after the listener returns, as long as the listener does not hand work off asynchronously).

**Failure**: the process crashes, is OOM-killed, or is redeployed mid-processing. The broker believes the message was handled and never redelivers it. The work is silently lost, with no error anywhere.

**Fix**: acknowledge or commit only after processing succeeds. This makes delivery at-least-once, so make the handler idempotent. If processing is asynchronous, track completion per offset and commit only the highest contiguous completed offset.

**Verify**: a test that kills the consumer mid-processing and asserts the message is redelivered and processed.

**Severity**: `high`; `critical` for payments and orders.

## messaging.poison-message

**Look for**: a consumer with no limit on how many times a failing message is retried and no dead-letter destination. Also defaults that silently drop messages:
- Spring Kafka's `DefaultErrorHandler` retries a failed record 10 times with no delay, then logs it and skips it. Without a `DeadLetterPublishingRecoverer`, the message is effectively dropped.
- RabbitMQ handlers that `nack` with `requeue=true` on every error, producing an immediate redelivery loop.
- SQS queues with no redrive policy (`maxReceiveCount`) to a dead-letter queue.

**Not a finding when**: failures are capped and sent to a dead-letter queue or topic with the error attached, and DLQ growth is alerted on.

**Failure**: one malformed message fails forever. In a Kafka partition, every message behind it waits and consumer lag grows without bound. In other queues, it burns capacity on endless redelivery and floods the logs. With silent-skip defaults, the message disappears and nobody knows.

**Fix**: cap attempts with backoff, then dead-letter with the error and original metadata. Separate permanent errors (bad payload: dead-letter immediately) from transient ones (dependency down: retry with backoff, or pause the consumer). Alert on DLQ depth and provide a way to replay from the DLQ.

**Verify**: a test that publishes an unprocessable message followed by a valid one; assert the bad one reaches the DLQ and the good one is processed.

**Severity**: `high`.

## messaging.ordering-key

**Look for**: events for the same entity that must be applied in order, published with a null, random, or wrong key:
- Kafka records without a key (the default partitioner spreads keyless records across partitions), or keyed by something other than the entity whose order matters.
- SQS FIFO without the right `MessageGroupId`; standard SQS queues used for ordered workflows.
- Consumers that process records from one partition in parallel, breaking order for a key.

**Not a finding when**: events for an entity are independent and commutative (order does not matter), or consumers apply events using a version or sequence number and ignore stale ones.

**Failure**: "order cancelled" is processed before "order created", a status moves backwards, or balance changes apply out of order, leaving the final state wrong with no error raised.

**Fix**: key by the entity ID (order ID, account ID) so all of its events land in one partition or message group. Parallelize across keys, never within one key. Increasing a Kafka topic's partition count changes the key-to-partition mapping and temporarily breaks per-key order, so plan for it. Add a version or sequence number to events so consumers can discard stale ones.

**Verify**: a test that publishes events for one entity rapidly (including across producer instances) and asserts the final consumer state is correct.

**Severity**: `high` when state depends on order; `medium` otherwise.

## messaging.visibility-timeout

**Look for**: processing that can take longer than the broker's lease or liveness window:
- SQS visibility timeout (default 30 seconds) shorter than the worst-case processing time.
- Kafka processing between `poll()` calls longer than `max.poll.interval.ms` (default 5 minutes), which triggers a rebalance.
- Similar ack deadlines in other brokers without lease extension.

**Not a finding when**: the timeout is set above the worst-case processing time, or the client extends the lease while working (some client libraries, such as the Google Pub/Sub clients, extend automatically).

**Failure**: a slow message becomes visible again, or its partition is reassigned, while the first worker is still processing it. A second worker picks it up and the work runs twice in parallel. In Kafka, the consumer that took too long is also removed from the group, and its in-flight work is redelivered.

**Fix**: set the timeout above the worst-case processing time with margin, or extend it periodically while working (SQS `ChangeMessageVisibility`). For Kafka, reduce `max.poll.records` or move long work off the poll thread with careful offset handling. Keep the handler idempotent regardless.

**Verify**: a test with a handler slower than the configured window, asserting the message is processed once.

**Severity**: `medium`; `high` when duplicate processing has side effects.
