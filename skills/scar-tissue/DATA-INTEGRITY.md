# Data integrity

These failures do not crash anything. The service stays green while it quietly stores wrong amounts, wrong times, duplicate rows, and IDs that are about to run out. They are found by finance, by customers, or by a hard stop on the day the limit is hit.

## Contents

- data.float-money
- data.naive-datetime
- data.app-only-constraints
- data.id-overflow

## data.float-money

**Look for**: monetary amounts stored or computed in binary floating point: `float`/`double` fields, JavaScript `number` arithmetic on decimal amounts, `FLOAT`/`DOUBLE`/`REAL` database columns for prices or balances, `parseFloat` on amounts, rounding with `Math.round(x * 100) / 100`, summing prices in a loop of floats, currency conversion in floats.

**Not a finding when**: amounts are integers in minor units (cents, paise), or a decimal type is used end to end (Python `Decimal`, Java `BigDecimal` with an explicit `RoundingMode`, SQL `NUMERIC`/`DECIMAL`), or the float is only used for display or analytics that never feed back into money.

**Failure**: `0.1 + 0.2` is `0.30000000000000004`. Totals drift by a cent here and there, invoices do not match payments, line items do not sum to the total, refunds of "the full amount" fail validation, and reconciliation reports thousands of tiny mismatches that someone has to explain to an auditor.

**Fix**: store and compute money as integer minor units or as a decimal type, and convert to a display string only at the edge. Round explicitly at defined points with a defined rule (for example half-even for tax, as your jurisdiction requires). Store the currency with every amount, and do not assume two decimal places: JPY has zero minor units, and KWD and BHD have three.

**Verify**: tests that sum many small amounts (for example 0.10 three times) and convert between currencies, asserting exact results.

**Severity**: `high`; `critical` when it affects charges, payouts, or balances.

## data.naive-datetime

**Look for**: timestamps without a time zone used for instants:
- Python `datetime.now()` or `datetime.utcnow()` (naive; `utcnow()` is deprecated since Python 3.12) compared with or stored next to aware values.
- Java `LocalDateTime` used for events and deadlines instead of `Instant`/`OffsetDateTime`.
- PostgreSQL `timestamp` (without time zone) columns storing moments in time, instead of `timestamptz`.
- JavaScript date parsing: `new Date("2026-03-10")` is parsed as UTC midnight but `new Date("2026-03-10T00:00")` as local time.
- Business logic that runs "at midnight" or "end of day" in server-local time.

**Not a finding when**: values are timezone-aware UTC instants (`datetime.now(timezone.utc)`, `Instant`, `timestamptz`), or the field genuinely represents a local wall-clock value (a store's opening hours, a birth date) and is stored with its zone or as a date.

**Failure**: servers in different regions disagree on "today". Subscriptions renew an hour early or late around daylight-saving changes, "expires at midnight" is midnight in the server's zone rather than the customer's, comparisons between naive and aware values raise errors or silently compare wrong, and reports double-count or drop an hour twice a year.

**Fix**: store and compute instants in UTC with zone-aware types. Convert to the user's zone only for display and for business rules defined in local time, using the user's or merchant's zone explicitly. Use dates (not timestamps) for date-only concepts.

**Verify**: tests around daylight-saving transitions and across zones (for example a renewal scheduled at 00:30 on a DST change date) asserting the intended instant.

**Severity**: `high` for billing, expiry, and scheduling; `medium` otherwise.

## data.app-only-constraints

**Look for**: invariants enforced only in application code: uniqueness checked with a query (Rails `validates uniqueness`, Django form-only checks, a Java `existsBy...` check), foreign keys "managed by the ORM" with no database constraint, required fields with nullable columns, allowed values without a `CHECK` constraint or enum type, money columns without a non-negative check where negatives are impossible.

**Not a finding when**: the constraint also exists in the database schema (check migrations), or the data store cannot enforce it and the code uses a safe pattern documented for that store.

**Failure**: any second writer (a new service, a backfill script, an admin tool, a race between two requests, a bug in one code path) writes data the application assumes is impossible. Duplicate accounts, orphaned rows, negative inventory, and null fields then break code paths far away from the original write, long after the bad data went in.

**Fix**: put invariants in the schema: `UNIQUE`, `NOT NULL`, `FOREIGN KEY`, `CHECK`, enum types, exclusion constraints. Keep application validation for good error messages, not for correctness. Add constraints to existing tables with the safe migration patterns in `database.unsafe-migration` (for example `NOT VALID` then `VALIDATE`), after cleaning up existing violations.

**Verify**: a test that bypasses the application layer (raw SQL) and asserts the database rejects the invalid write.

**Severity**: `high` for uniqueness of accounts, payments, and identifiers; `medium` otherwise.

## data.id-overflow

**Look for**:
- Primary keys and foreign keys of 32-bit integer type on tables that grow without bound (events, orders, messages, logs): PostgreSQL `serial`/`integer` (max 2,147,483,647), MySQL signed `INT AUTO_INCREMENT` (same limit; 4,294,967,295 unsigned).
- 64-bit IDs serialized as JSON numbers to JavaScript clients, where values above 2^53 − 1 lose precision.
- Counters stored in 32-bit fields that accumulate over time (view counts, sequence numbers).

**Not a finding when**: the type is 64-bit (`bigint`/`bigserial`, `BIGINT`) or a UUID, or the table is small and bounded by design (for example a fixed list of countries).

**Failure**: on the day the sequence passes 2,147,483,647, every insert into the table fails and the product stops working until a schema change completes. Changing the type of a primary key on a table that large is itself a long, risky migration, often with the outage already in progress. Separately, large 64-bit IDs parsed in JavaScript round to a neighboring value and fetch or update the wrong record.

**Fix**: use 64-bit integers or UUIDs for identifiers on any table that can grow without bound, including foreign-key columns that reference them. For existing tables, monitor sequence usage against the limit and migrate early with the expand-and-contract approach. Send 64-bit IDs to JavaScript clients as strings.

**Verify**: check the column types in the schema, and for existing tables query current sequence values against the type's maximum.

**Severity**: `high` for fast-growing tables, `critical` if a sequence is already past roughly half its range; `low` for small bounded tables.
