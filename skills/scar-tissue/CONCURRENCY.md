# Concurrency

Code that works with one request at a time breaks with two. Most race conditions in backend services follow one pattern: read a value, decide in application code, write the result back, while another request does the same thing.

## Contents

- concurrency.lost-update
- concurrency.check-then-act
- concurrency.lock-without-fencing
- concurrency.unbounded-parallelism
- concurrency.shared-mutable-state
- concurrency.duplicate-scheduled-job

## concurrency.lost-update

**Look for**: read-modify-write on shared data where the new value is computed in application code:

```python
account = Account.objects.get(id=aid)
account.balance -= amount          # Django, SQLAlchemy, ActiveRecord, Mongoose: same pattern
account.save()
```
```java
Account a = repo.findById(id).orElseThrow();
a.setBalance(a.getBalance() - amount);   // JPA entity without @Version
repo.save(a);
```

Common targets: balances, inventory, quotas, counters, seat or slot availability, JSON documents edited as a whole.

A transaction alone does not prevent this. At READ COMMITTED (the PostgreSQL default) both transactions read the old value and the second write wins. In MySQL InnoDB at its default REPEATABLE READ, plain `SELECT` reads a snapshot, so the same lost update happens.

**Not a finding when**:
- The update is atomic in the database (`SET balance = balance - :amt`, Django `F()` expressions, `$inc` in MongoDB).
- A row lock is taken before reading (`SELECT ... FOR UPDATE`, Django `select_for_update()` inside `transaction.atomic()`, JPA `@Lock(PESSIMISTIC_WRITE)`).
- Optimistic locking is in place (a `version` column with JPA `@Version`, or `UPDATE ... WHERE version = :v` with a check on affected rows) and conflicts are retried or reported.
- Writes for the key are serialized by design (for example a Kafka consumer processing one partition sequentially, with the entity ID as the key) and nothing else writes the field.
- The transaction runs at SERIALIZABLE (or PostgreSQL REPEATABLE READ, which raises a serialization error on concurrent update) and the code retries on that error.

**Failure**: two withdrawals for the same account run concurrently. Both read 100, both write 100 − amount. One withdrawal vanishes, or both pass a balance check that only one should have passed.

**Fix** (choose the simplest that fits):
- Atomic conditional update: `UPDATE accounts SET balance = balance - :amt WHERE id = :id AND balance >= :amt`, then check the affected row count (0 means insufficient funds or not found).
- Optimistic locking with a version column, retrying on conflict a bounded number of times.
- Pessimistic locking with `SELECT ... FOR UPDATE` inside a short transaction, when the decision logic cannot be expressed in one statement.

**Verify**: a test that runs two updates concurrently against a real database (threads or two sessions, synchronized with a barrier) and asserts the invariant (final balance, no negative balance, total inventory).

**Severity**: `critical` for money, inventory, and quotas; `high` for other shared counters.

## concurrency.check-then-act

**Look for**: a decision in application code followed by an action that depends on it:

```ts
if (product.stock > 0) { await createOrder(); await decrementStock(); }
if (!(await userExists(email))) { await createUser(email); }
if (coupon.uses < coupon.maxUses) { await redeem(coupon); }
```

**Not a finding when**: the check and the action are one atomic operation in the database (conditional update, unique constraint, `INSERT ... ON CONFLICT`), or both run inside a transaction holding the right lock.

**Failure**: concurrent requests pass the check together. Inventory is oversold, duplicate users are created, a single-use coupon is redeemed many times. Flash sales and retries make this routine rather than rare.

**Fix**: move the check into the write. Use a conditional update (`UPDATE products SET stock = stock - 1 WHERE id = :id AND stock > 0`), a unique constraint, or a transaction with a row lock. The database is the only component that sees every request.

**Verify**: a concurrency test that fires N parallel requests against a resource with capacity 1 and asserts exactly one success.

**Severity**: `critical` for money and inventory; `high` otherwise.

## concurrency.lock-without-fencing

**Look for**: a distributed lock (Redis `SET key value NX PX`, Redlock, a lock row in a database, ZooKeeper or etcd leases) protecting work that can outlive the lock's TTL, with no fencing token checked by the resource being protected. Also: releasing a Redis lock with a plain `DEL` that can delete another holder's lock.

**Not a finding when**: the protected write checks a monotonically increasing fencing token (or version) and rejects stale holders; or the work is itself idempotent and safe to run twice; or the lock is only a best-effort optimization to avoid duplicate work.

**Failure**: worker A acquires the lock, then pauses (garbage collection, a slow network call, a VM stall) past the TTL. The lock expires; worker B acquires it and writes. Worker A wakes up and writes stale data over B's result, believing it still holds the lock.

**Fix**: prefer a conditional database write over a distributed lock. If a lock is needed, issue a fencing token (an increasing number) with each acquisition and make the storage reject writes carrying an older token. Release with a compare-and-delete (a Lua script checking the value) rather than `DEL`. Renew long-held locks, and verify ownership before the final write.

**Verify**: a test that simulates an expired lease (shorten the TTL, pause the first worker) and asserts the stale write is rejected.

**Severity**: `high`; `critical` when it guards money or data integrity.

## concurrency.unbounded-parallelism

**Look for**: one task, promise, goroutine, or thread per item with no limit:

```ts
await Promise.all(users.map(sendEmail));                 // 50,000 users
```
```python
await asyncio.gather(*(fetch(u) for u in urls))
```
```go
for _, item := range items { go process(item) }
```

In Java, `parallelStream()` and `CompletableFuture.supplyAsync()` without an executor run on the shared `ForkJoinPool.commonPool()`; blocking I/O there starves every other user of that pool.

**Not a finding when**: the input size is small and bounded by construction (for example a fixed list of 5 regions), or a concurrency limit is applied (semaphore, worker pool, `p-limit`, `errgroup.SetLimit`, a bounded executor).

**Failure**: a large input opens thousands of simultaneous connections. You hit the dependency's rate limits, exhaust your connection pool and file descriptors, run out of memory, and often take the dependency down with you.

**Fix**: bound concurrency explicitly (a semaphore or worker pool sized to what the dependency can handle) and process large inputs in batches. Give blocking work its own executor in Java.

**Verify**: a test with a large input and an instrumented fake dependency that records peak concurrency; assert it stays at or below the limit.

**Severity**: `high` when the input size is user-controlled or grows with data; `medium` otherwise.

## concurrency.shared-mutable-state

**Look for**: state shared across requests or threads and modified without synchronization: module-level dictionaries and lists in Python web apps running threaded workers; mutable fields on Spring singleton beans (`@Service`, `@Component`, `@Controller` are singletons by default); a static `SimpleDateFormat` or other non-thread-safe object in Java; a "current user" or "current tenant" stored in a global. In Node.js, state shared across `await` points can interleave between requests even on one thread.

**Not a finding when**: the state is immutable after startup, thread-local or request-scoped, protected by a lock, or a thread-safe structure (`ConcurrentHashMap`, `java.time.format.DateTimeFormatter`, atomics).

**Failure**: concurrent requests overwrite each other's data. One user sees another user's information, counters drift, or a non-thread-safe object corrupts its state and returns wrong results intermittently.

**Fix**: keep per-request data in the request scope. Make shared objects immutable or thread-safe. Replace `SimpleDateFormat` with `DateTimeFormatter`.

**Verify**: a concurrency test that interleaves two requests with different users or inputs and asserts each sees only its own data.

**Severity**: `critical` when it can leak data between users; `high` otherwise.

## concurrency.duplicate-scheduled-job

**Look for**: scheduled or cron work that runs in every instance or can overlap with itself:
- Spring `@Scheduled`, `node-cron`, `setInterval`, APScheduler, or a Go ticker inside a service that runs with multiple replicas.
- More than one Celery beat scheduler running.
- Kubernetes `CronJob` without `concurrencyPolicy: Forbid` (the default, `Allow`, lets runs overlap when one takes longer than the interval).
- Jobs with no lock or "already running" guard.

**Not a finding when**: the job is protected by a cluster-wide lock or leader election (ShedLock, a database advisory lock, a Kubernetes lease), runs as a single-instance deployment, or is idempotent and harmless when run concurrently.

**Failure**: with three replicas, the nightly billing job runs three times and charges customers three times. Or a slow run is still going when the next one starts, and both process the same records.

**Fix**: run scheduled jobs in exactly one place: a single-instance scheduler, a Kubernetes `CronJob` with `concurrencyPolicy: Forbid`, or a lock/leader election (ShedLock for Spring, a PostgreSQL advisory lock). Make the job itself idempotent as a second line of defense.

**Verify**: run two instances of the job at once in a test environment and assert the work happens once.

**Severity**: `critical` when the job moves money or messages customers; `high` otherwise.
