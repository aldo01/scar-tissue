# Database

The database is usually the first component to fall over and the last to recover. Most database incidents come from queries that were fine on test data, transactions held open too long, and schema changes applied to a live table.

## Contents

- database.n-plus-one
- database.unbounded-query
- database.deep-offset-pagination
- database.missing-index
- database.network-call-in-transaction
- database.long-transaction
- database.missing-statement-timeout
- database.unsafe-migration

## database.n-plus-one

**Look for**: a query inside a loop, often hidden behind an ORM relationship accessed per row:

- Django: accessing a ForeignKey or reverse relation in a loop without `select_related`/`prefetch_related`.
- SQLAlchemy: relationships with the default lazy loading accessed per row.
- JPA/Hibernate: `@OneToMany`/`@ManyToMany` (lazy by default) accessed per entity; `@ManyToOne`/`@OneToOne` are eager by default and still issue one query per row for JPQL results.
- Rails: associations accessed in a loop without `includes`.
- GraphQL: field resolvers that query per parent object without a DataLoader.
- Any code calling a repository or HTTP API inside a loop over results.

**Not a finding when**: the loop is bounded to a small fixed size, or batch fetching is configured (`hibernate.default_batch_fetch_size`, `@BatchSize`, DataLoader batching).

**Failure**: 10 queries in development, 10,000 in production for a large account. Latency grows with data size, database CPU spikes, and the endpoint times out for exactly the biggest customers.

**Fix**: load related data in one or a few queries: `select_related`/`prefetch_related`, `joinedload`/`selectinload`, `JOIN FETCH` or an entity graph, `includes`, a DataLoader, or a single `WHERE id IN (...)` batch.

**Verify**: a test that asserts the query count for a list of N items is constant (Django `assertNumQueries`, Hibernate statistics, SQL logging in tests).

**Severity**: `medium`; `high` on hot or user-facing list endpoints.

## database.unbounded-query

**Look for**: queries with no `LIMIT` whose result size grows with data: `findAll()`, `.all()`, `SELECT ... WHERE user_id = ?` behind a list endpoint, exports, admin pages, GraphQL list fields without `first`/`limit`, and "load all then filter in code".

**Not a finding when**: the result is bounded by the data model (for example "the 3 addresses a user may have", enforced by a constraint), or the query is a streamed export that processes rows in batches.

**Failure**: one customer has two million rows. The request loads them all, the process runs out of memory or times out, and the database spends minutes producing a result nobody can use.

**Fix**: paginate every list endpoint with a server-enforced maximum page size. Stream or batch exports with server-side cursors or keyset batches.

**Verify**: a test that requests more than the maximum page size and asserts the response is capped and includes a cursor for the next page.

**Severity**: `high`.

## database.deep-offset-pagination

**Look for**: `LIMIT n OFFSET m` (or `Pageable`, `.offset()`, `skip()`) over large or growing tables, especially when driven by infinite scroll or by background jobs walking a whole table.

**Not a finding when**: the table is small and bounded, or the maximum reachable offset is capped.

**Failure**: the database still reads and discards every skipped row, so page 20,000 is much slower than page 1. Rows inserted or deleted during a walk shift the window, so jobs skip or double-process records.

**Fix**: keyset (cursor) pagination on a unique, indexed ordering: `WHERE (created_at, id) > (:last_created_at, :last_id) ORDER BY created_at, id LIMIT :n`.

**Verify**: compare `EXPLAIN (ANALYZE)` for an early and a late page, and test that a full walk visits each row exactly once while rows are inserted.

**Severity**: `medium`; `high` for jobs where skipped rows mean missed processing.

## database.missing-index

**Look for**: new or changed queries that filter, join, or sort on columns with no supporting index. Check migration and schema files. PostgreSQL does **not** create indexes on foreign-key columns automatically (MySQL InnoDB does), so joins and cascading deletes on unindexed foreign keys are a common cause.

**Not a finding when**: an index exists whose leading columns match the filter (check composite index column order), or the table is small and stays small.

**Failure**: a sequential scan that takes milliseconds in development takes seconds in production and gets slower every day. Under load, these queries pile up and exhaust the connection pool.

**Fix**: add an index matching the filter and sort order. On a large live PostgreSQL table, use `CREATE INDEX CONCURRENTLY` (see `database.unsafe-migration`).

**Verify**: `EXPLAIN (ANALYZE)` on realistic data volumes shows an index scan.

**Severity**: `medium`; `high` on hot paths. Usually `needs-validation` unless the schema and query plan are visible.

## database.network-call-in-transaction

**Look for**: HTTP calls, payment provider calls, message publishing to an external broker, email sends, or other slow external calls made while a database transaction is open. Common shapes: a Spring `@Transactional` method that calls `RestTemplate`, `WebClient`, Feign, or Kafka; Python code inside `with transaction.atomic():` or `with session.begin():` that calls out; Rails `ActiveRecord::Base.transaction` blocks that call APIs.

**Not a finding when**: the call is to the same database, or it is a local, fast, in-process operation.

**Failure**: the external call is slow, so the transaction holds row locks and a pooled connection for its full duration. Other requests block on those locks, the pool empties, and the database looks like the cause of the outage. If the transaction rolls back after the external call succeeded, the external side effect (a charge, an email) cannot be undone.

**Fix**: keep transactions short and local. Make the external call outside the transaction, recording intent before and the result after in separate short transactions, or write an outbox row inside the transaction and let a relay perform the external call (see `messaging.dual-write`).

**Verify**: inspect the transaction boundaries (including proxies and decorators) and confirm no external call happens between begin and commit.

**Severity**: `high`.

## database.long-transaction

**Look for**: one transaction wrapping a large batch, a loop over many rows, a bulk backfill, or work that waits on a user or a queue.

**Not a finding when**: the batch is small and bounded, or the work is read-only on a replica.

**Failure**: locks held for minutes block other writers. In PostgreSQL, a long-running transaction also prevents vacuum from removing dead rows, so tables and indexes bloat and queries slow down across the database. A failure near the end rolls back all the work.

**Fix**: process in batches of a few hundred to a few thousand rows, each in its own transaction, with a checkpoint so the job resumes where it stopped. Set `idle_in_transaction_session_timeout` in PostgreSQL to kill abandoned transactions.

**Verify**: measure transaction duration for a realistic batch; it should be seconds, not minutes.

**Severity**: `medium`; `high` on busy tables.

## database.missing-statement-timeout

**Look for**: no statement or query timeout configured for application queries: PostgreSQL `statement_timeout` (default 0, disabled), JDBC `Statement.setQueryTimeout` or `jakarta.persistence.query.timeout` unset, MySQL `max_execution_time` unset (note it applies only to `SELECT`), no driver-level timeout.

**Not a finding when**: a timeout is set on the application's database role, connection string, connection pool init SQL, or ORM configuration.

**Failure**: one pathological query (a missing index, an unexpected plan, a huge tenant) runs for 40 minutes, holding a connection and locks. Several of them exhaust the pool and the service goes down, even though each request gave up long ago.

**Fix**: set a statement timeout for the application's role or connections (for example `ALTER ROLE app SET statement_timeout = '5s'`), with a longer limit only for known batch jobs that set it explicitly.

**Verify**: run `SELECT pg_sleep(60)` (or an equivalent) through the application's connection and assert it is cancelled at the configured timeout.

**Severity**: `medium`; `high` for services with large or multi-tenant data.

## database.unsafe-migration

**Look for**: schema changes that take strong locks on, or rewrite, a large table, or that break code still running during a rolling deploy. For PostgreSQL:

| Risky change | Why | Safer approach |
| --- | --- | --- |
| `CREATE INDEX` on a large table | Blocks writes for the whole build | `CREATE INDEX CONCURRENTLY` (cannot run inside a transaction block; a failed build leaves an `INVALID` index to drop) |
| `ADD COLUMN` with a volatile default (`gen_random_uuid()`, `clock_timestamp()`) | Rewrites the table under an exclusive lock | Add without default, backfill in batches, then set the default. Constant defaults are fast in PostgreSQL 11+ |
| `ALTER COLUMN ... TYPE` | Usually rewrites the table under an exclusive lock | Add a new column, dual-write, backfill, switch, drop |
| `SET NOT NULL` on a large table | Full scan under an exclusive lock | Add `CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE CONSTRAINT`, then `SET NOT NULL` (PostgreSQL 12+ skips the scan) |
| Adding a foreign key | Validates every row under lock | `ADD CONSTRAINT ... NOT VALID`, then `VALIDATE CONSTRAINT` separately |
| Renaming or dropping a column used by current code | Old instances still running mid-deploy fail on every query | Expand and contract across multiple deploys |
| Large data backfill inside the migration | One huge transaction, long locks, replication lag | A separate batched, resumable job |

For MySQL, check whether the change can run with `ALGORITHM=INSTANT` or `INPLACE`; otherwise use an online schema change tool (gh-ost, pt-online-schema-change). In both PostgreSQL and MySQL, even a fast DDL statement must first acquire a strong lock, and while it waits, every query queued behind it on that table waits too.

Frameworks often wrap migrations in a transaction, which blocks `CREATE INDEX CONCURRENTLY`. Rails needs `disable_ddl_transaction!`, and Alembic needs an autocommit block.

**Not a finding when**: the table is small (thousands of rows, not millions) and not on a hot path, or the change is applied with a tool designed for online changes.

**Failure**: a deploy runs the migration, which waits for or holds a lock on a hot table. Every query touching the table queues behind it, request timeouts cascade, and the site is down until the migration finishes or someone kills it, often with the deploy half-applied.

**Fix**: use expand and contract (add the new structure, deploy code that handles both, backfill in batches, switch reads, remove the old structure in a later deploy). Set `lock_timeout` (for example `SET lock_timeout = '5s'`) in migrations so they fail fast instead of blocking traffic, and retry them. Linters such as squawk (PostgreSQL), strong_migrations (Rails), and django-pg-zero-downtime-migrations catch many of these automatically.

**Verify**: run the migration against a production-sized copy while generating read and write traffic; confirm no request blocks for longer than the lock timeout.

**Severity**: `high`; `critical` for the largest and hottest tables.
