# Security: authentication

Authentication bugs hand over accounts. Most come from verification steps that are skipped, weakened, or done in a way that can be bypassed: tokens decoded but not verified, secrets compared unsafely, webhooks trusted without a signature, and password flows that leak or never expire.

## Contents

- security.jwt-validation
- security.password-storage
- security.session-cookies
- security.timing-unsafe-compare
- security.webhook-signature
- security.password-reset

## security.jwt-validation

**Look for**: JWTs used for authentication without full verification:
- Decoding without verifying the signature: PyJWT `jwt.decode(token, options={"verify_signature": False})`, Node `jsonwebtoken.decode()` (which never verifies) used where `verify()` is needed, reading claims by base64-decoding the payload manually.
- Algorithms not pinned, so a token can choose its own algorithm (`none`, or switching RS256 to HS256 so the public key is used as an HMAC secret in vulnerable setups).
- Expiry (`exp`), audience (`aud`), and issuer (`iss`) not checked, or tokens issued with no expiry.
- Weak HMAC secrets (short, guessable, or committed to the repository).
- Long-lived access tokens with no revocation path.

**Not a finding when**: a maintained library verifies the signature with an explicitly pinned algorithm list and checks `exp`, `aud`, and `iss`, or an identity provider SDK or gateway does this before the service sees the request.

**Failure**: an attacker forges or modifies a token (sets `sub` to another user or `role` to `admin`) and the server accepts it, giving full account takeover or admin access. Or a stolen token works forever because it never expires.

**Fix**: verify every token with a maintained library, pin the accepted algorithms explicitly, check `exp`, `aud`, and `iss`, use strong keys (asymmetric keys from a key management service, or long random HMAC secrets stored as secrets), keep access tokens short-lived, and support revocation for refresh tokens.

**Verify**: tests that submit a token with a modified payload, `alg: none`, an expired `exp`, and a wrong `aud`, asserting each is rejected.

**Severity**: `critical`.

## security.password-storage

**Look for**: passwords stored or compared using plaintext, reversible encryption, or fast hashes: MD5, SHA-1, SHA-256, or SHA-512 (even salted), custom hashing schemes, or passwords logged or emailed.

**Not a finding when**: a dedicated password hashing function is used through a maintained library: Argon2id, scrypt, bcrypt, or PBKDF2 with a high iteration count (for example Django's and Spring Security's default password encoders, `argon2-cffi`, `bcrypt`). Note that bcrypt only uses the first 72 bytes of input.

**Failure**: the database leaks (backup exposed, SQL injection, insider). Fast hashes are cracked at billions of guesses per second on GPUs, so most users' passwords are recovered within hours and reused against their email and bank accounts.

**Fix**: hash with Argon2id (or bcrypt or scrypt) using a maintained library and parameters in line with current OWASP Password Storage guidance. Re-hash existing hashes on the user's next successful login, and force a reset for accounts that cannot be migrated.

**Verify**: check the stored hash format (for example `$argon2id$` or `$2b$` prefixes) and that verification uses the library's verify function.

**Severity**: `critical` for plaintext or reversible storage; `high` for fast hashes.

## security.session-cookies

**Look for**: session or authentication cookies set without `HttpOnly`, `Secure`, and a `SameSite` attribute; session IDs not regenerated after login (session fixation); sessions not invalidated on logout or password change; very long session lifetimes with no idle timeout; authentication tokens returned in URLs.

**Not a finding when**: the framework's session configuration sets these attributes (check settings such as Django `SESSION_COOKIE_SECURE`, Express `cookie: { secure, httpOnly, sameSite }`, Spring `server.servlet.session.cookie.*`), and login regenerates the session.

**Failure**: an XSS bug elsewhere steals the session cookie (no `HttpOnly`); the cookie is sent over plain HTTP on a hostile network (no `Secure`); an attacker plants a known session ID before login and takes over the session afterward (fixation); a stolen session still works after the user changes their password.

**Fix**: set `HttpOnly`, `Secure`, and `SameSite=Lax` (or `Strict`) on session cookies; regenerate the session ID on login and privilege changes; invalidate sessions on logout and password change; set idle and absolute timeouts.

**Verify**: inspect the `Set-Cookie` header in a test and assert the attributes; a test that a session ID from before login is not valid after login.

**Severity**: `high` for fixation and missing invalidation; `medium` for missing attributes.

## security.timing-unsafe-compare

**Look for**: secrets compared with ordinary equality: API keys, webhook signatures, HMACs, session tokens, password reset tokens, or OTPs compared with `==`, `===`, `.equals()`, `strcmp`, or `bytes.Equal`.

**Not a finding when**: a constant-time comparison is used: Python `hmac.compare_digest`, Java `MessageDigest.isEqual`, Node.js `crypto.timingSafeEqual` (with equal-length buffers), Go `subtle.ConstantTimeCompare`, or the comparison is done by a library that already does this (for example password-hash verify functions).

**Failure**: ordinary comparison returns as soon as a byte differs, so response time leaks how many leading bytes were correct. An attacker who can make many requests recovers a valid signature or token byte by byte. Network noise makes this harder but not impossible, especially from inside the same cloud region.

**Fix**: compare secrets with the platform's constant-time function. Compare digests of fixed length rather than raw values of varying length.

**Verify**: confirm every secret comparison goes through the constant-time function (a grep for `==` near `token`, `signature`, `secret`, `api_key` is a good start).

**Severity**: `medium`; `high` for webhook signatures and API keys on public endpoints.

## security.webhook-signature

**Look for**: webhook receivers (payment providers, GitHub, Shopify, Twilio, internal services) that act on the payload without verifying its signature, or that verify incorrectly:
- No signature check at all, or only an IP or "secret path" check.
- Signature computed over re-serialized JSON instead of the raw request body (this usually fails, and developers then disable the check).
- No timestamp tolerance, so captured requests can be replayed.
- Non-constant-time comparison of signatures.
- Acting on the event payload without confirming it with the provider's API when the stakes are high.

**Not a finding when**: the provider's official SDK verification function is used on the raw body (for example Stripe's `constructEvent`), with timestamp tolerance, and events are deduplicated by event ID.

**Failure**: an attacker posts a forged `payment_intent.succeeded` (or equivalent) event to the webhook URL. The server marks unpaid orders as paid and ships goods, upgrades accounts, or credits balances.

**Fix**: verify the signature over the raw request body with the provider's SDK or an HMAC with constant-time comparison, enforce a timestamp tolerance, deduplicate by event ID, and for high-value actions re-fetch the object from the provider's API before acting.

**Verify**: tests that post an unsigned event, an event with a wrong signature, and a replayed old event, asserting each is rejected with no side effects.

**Severity**: `critical` for payment and account events; `high` otherwise.

## security.password-reset

**Look for**: password reset and similar one-time-token flows (email verification, magic links, invitations) with weak tokens or lifecycle:
- Tokens from non-cryptographic randomness, short numeric codes without attempt limits, or tokens derived from guessable data (user ID, timestamp, email hash).
- Tokens that never expire, can be reused, or stay valid after the password changes.
- Tokens stored in plaintext in the database.
- Responses that differ for existing and non-existing accounts (account enumeration).
- Reset links built from the request's `Host` header (host header poisoning sends the link to an attacker-controlled domain).

**Not a finding when**: tokens come from a cryptographically secure generator with enough entropy (at least 128 bits), are stored hashed, expire within a short window, are single-use, are invalidated when the password changes, attempts are rate limited, and links use a configured base URL.

**Failure**: an attacker guesses or brute-forces a reset code, reuses a leaked old link, or poisons the reset email's link to capture the token, and takes over the account.

**Fix**: generate tokens with a secure generator, store only a hash, expire them quickly (for example within an hour), make them single-use, invalidate all outstanding tokens and sessions on password change, rate limit requests and attempts, return identical responses for known and unknown accounts, and build links from configuration, not from request headers.

**Verify**: tests that a token works once, fails after use, fails after expiry, fails after a password change, and that the response for an unknown email matches the response for a known one.

**Severity**: `critical` when tokens are guessable or links can be poisoned; `high` for missing expiry or reuse; `medium` for enumeration.
