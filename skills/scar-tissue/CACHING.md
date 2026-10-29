# Caching

A cache makes the normal case fast and the failure case dangerous. When it is empty, wrong, or unbounded, the cache itself becomes the outage.

## Contents

- caching.stampede
- caching.stale-write
- caching.missing-ttl
- caching.unbounded-local
- caching.cache-as-source-of-truth
- caching.penetration

## caching.stampede

**Look for**: cache-aside reads where every concurrent miss recomputes the value:

```python
value = cache.get(key)
if value is None:
    value = expensive_query()          # every concurrent miss runs this
    cache.set(key, value, ex=300)
```

Also: many keys written with the same TTL at the same moment (warm-up, deploys, nightly refresh), so they all expire together; a cache cluster restart in front of a database sized for cached traffic.

**Not a finding when**: recomputation is coalesced per key (Caffeine `cache.get(key, loader)`, Spring `@Cacheable(sync = true)` within one JVM, Go `singleflight`, a short lock per key), stale values are served while one request refreshes, or the backing query is cheap.

**Failure**: a hot key expires. Thousands of requests miss at the same moment and all hit the database. The database slows, so none of the recomputations finish quickly, so the cache stays empty and more requests pile on. A routine expiry becomes an outage.

**Fix**: let one request recompute while others wait briefly or get the stale value (single-flight or a short `SET lock:key NX PX` lock). Add random jitter to TTLs. Refresh very hot keys in the background before they expire (probabilistic early refresh). Plan capacity for a cold cache, or warm it before taking traffic.

**Verify**: a load test that expires a hot key under concurrent traffic and measures backend calls; expect roughly one recomputation, not one per request.

**Severity**: `high` for hot keys in front of a shared database; `medium` otherwise.

## caching.stale-write

**Look for**: update paths whose ordering lets an old value land in the cache:
- Writing the cache first, then the database (if the database write fails, the cache now lies).
- Read paths that populate the cache with a value read before a concurrent update committed.
- Updating the cache with `set` after a database write, when two writers can race.

**Not a finding when**: writes go to the database first and then delete (not set) the cache key, values have short TTLs, and slightly stale data is acceptable for this use case.

**Failure**: a reader misses, reads the old row, then pauses. A writer updates the row and deletes the cache key. The reader resumes and writes its old value into the cache. Stale data (a price, a permission, a balance) is served until the TTL expires, sometimes for hours.

**Fix**: update the database first, then delete the cache key; keep a TTL as the safety net. For data where staleness matters, version cached values and refuse to overwrite a newer version, or delete again shortly after the write (delayed double delete). For permissions and prices, prefer a short TTL or no cache.

**Verify**: a test that interleaves a slow reader with a writer and asserts the cache does not end up holding the old value.

**Severity**: `high` for prices, permissions, and balances; `medium` otherwise.

## caching.missing-ttl

**Look for**: cache writes with no expiry (`SET key value` without `EX`/`PX`, `cache.set(key, value)` with no timeout, `@Cacheable` on a cache with no expiry configured).

**Not a finding when**: the value is immutable (keyed by a content hash or a version), or invalidation is guaranteed by a mechanism you can see and the cache has a bounded size with eviction.

**Failure**: any bug that writes a wrong value, and any missed invalidation, becomes permanent until someone manually flushes the cache. Memory grows until eviction starts removing values you need. With Redis's default `maxmemory-policy` of `noeviction` (Redis OSS), writes start failing instead once memory is full.

**Fix**: give every entry a TTL, even a long one. Set `maxmemory` and an eviction policy appropriate to the cache's role.

**Verify**: check that every cache write path sets an expiry, and that the cache server's memory limit and eviction policy are configured.

**Severity**: `medium`.

## caching.unbounded-local

**Look for**: in-process caches that only grow: a module-level `dict` or static `HashMap` keyed by user input, IDs, or URLs; Python `functools.cache` (unbounded) or `lru_cache(maxsize=None)` on functions with unbounded arguments; Guava/Caffeine caches built without `maximumSize`; a Node.js `Map` used as a cache.

**Not a finding when**: the key space is small and fixed (configuration, enum values), or the cache has a size limit and eviction (`lru_cache` with its default `maxsize=128` or an explicit size, Caffeine with `maximumSize`, `cachetools.TTLCache`).

**Failure**: memory grows with traffic until the process is OOM-killed, typically days after the deploy, which makes the cause hard to connect to the change. Each replica holds its own copy, so the problem multiplies.

**Fix**: use a bounded LRU or TTL cache and size it deliberately. Consider whether a shared cache is more appropriate.

**Verify**: a test or load run with many distinct keys asserting the cache size stays at the limit.

**Severity**: `medium`; `high` when keys come directly from user input.

## caching.cache-as-source-of-truth

**Look for**: data that exists only in a cache: sessions, carts, counters, rate-limit state, job progress, idempotency keys, or locks stored in Redis or Memcached with no persistence or replication, or with an eviction policy that can remove them.

**Not a finding when**: the data is disposable and the code handles its absence correctly (for example a cart that is also saved to the database, or a counter that can reset safely), or the store is configured and operated as durable (persistence, replication, `noeviction` for that dataset).

**Failure**: the cache restarts, fails over, or evicts under memory pressure, and the data is gone: users are logged out, carts empty, idempotency keys vanish (so retries double-charge), in-progress jobs restart from zero.

**Fix**: decide per dataset. Disposable data must tolerate loss in code. Data that must survive belongs in a durable store, with the cache in front of it.

**Verify**: restart or flush the cache in a test environment and confirm user-visible behavior and correctness.

**Severity**: `high` for idempotency keys, locks, and money-related state; `medium` otherwise.

## caching.penetration

**Look for**: cache-aside lookups where a miss for a key that does not exist is never cached, so requests for nonexistent IDs always go to the database. Common on public endpoints taking IDs, slugs, or codes in the URL.

**Not a finding when**: negative results are cached (with a short TTL), the input is validated or authenticated before the lookup, or the backing lookup is cheap.

**Failure**: a crawler, a buggy client, or an attacker requests random IDs. Every request misses the cache and hits the database, bypassing the protection the cache was supposed to give. Database load spikes with no corresponding traffic to real data.

**Fix**: cache "not found" results with a short TTL, validate ID formats before lookup, rate limit the endpoint, and for very large key spaces consider a Bloom filter of existing keys.

**Verify**: a test requesting the same nonexistent ID repeatedly asserts the database is queried once per TTL.

**Severity**: `medium`; `high` on public, unauthenticated endpoints in front of a shared database.
