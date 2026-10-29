# Security: secrets, cryptography, and configuration

These findings do not need a clever attack. A secret in a repository, a disabled certificate check, a debug console left on, or a known-vulnerable library is enough.

When reporting a secret, never print the full value in the report or conversation. Show the location, the type of secret, and at most the first four characters.

## Contents

- security.hardcoded-secret
- security.weak-crypto
- security.insecure-randomness
- security.tls-verification-disabled
- security.debug-in-production
- security.vulnerable-dependency

## security.hardcoded-secret

**Look for**: credentials in source code, configuration files, or build files committed to the repository: API keys, database passwords, private keys (`-----BEGIN ... PRIVATE KEY-----`), cloud access keys (for example AWS keys starting with `AKIA`), webhook signing secrets, JWT signing secrets, OAuth client secrets, `.env` files, secrets in Dockerfiles and build arguments, credentials in CI configuration, and default credentials left in production config. Also secrets shipped in frontend bundles or mobile apps.

**Not a finding when**: the value is a clearly fake placeholder or test fixture that is not valid anywhere, or it is a public identifier designed to be exposed (for example a publishable payment key or a public OAuth client ID).

**Failure**: anyone with repository access, including former employees, contractors, CI providers, and anyone who obtains a leaked copy, has production credentials. Public repositories are scanned for keys within minutes of a push. Removing the secret in a later commit does not help, because it remains in git history.

**Fix**: move secrets to a secret manager or environment-injected configuration, **rotate the exposed credential** (assume it is compromised), and add secret scanning (for example gitleaks or trufflehog) in pre-commit and CI. Purge history only after rotating.

**Verify**: run a secret scanner over the repository and its history; confirm the old credential is revoked.

**Severity**: `critical` for production credentials and private keys; `high` for others.

## security.weak-crypto

**Look for**: broken or misused cryptography protecting confidentiality or integrity:
- MD5 or SHA-1 for signatures, integrity checks against tampering, or token generation.
- DES, 3DES, RC4, or Blowfish for encryption.
- AES in ECB mode (Java `Cipher.getInstance("AES")` defaults to ECB with many providers).
- A static, hardcoded, or reused IV or nonce (nonce reuse with AES-GCM is catastrophic).
- Encryption without authentication (CBC or CTR without a MAC), RSA encryption with PKCS#1 v1.5 padding instead of OAEP, short keys, and home-made constructions.
- Keys derived from passwords with a plain hash instead of a key derivation function.

**Not a finding when**: the weak algorithm is used for a non-security purpose (MD5 or SHA-1 as a cache key, checksum for accidental corruption, or deduplication ID), or a high-level, misuse-resistant library is used (libsodium/NaCl, Google Tink, Python `cryptography`'s Fernet or AESGCM with random nonces).

**Failure**: encrypted data is decrypted or modified by an attacker; ECB reveals patterns in the plaintext; reused nonces leak the key stream and allow forgeries; MD5-based signatures are forged with known collision techniques.

**Fix**: use an authenticated encryption scheme (AES-GCM or ChaCha20-Poly1305) through a high-level library, with random nonces generated per message, keys from a key management service, SHA-256 or better for integrity, HMAC for message authentication, and a proper KDF (HKDF for keys, Argon2/scrypt/PBKDF2 for passwords).

**Verify**: confirm the algorithm, mode, and nonce handling in code; a test that encrypting the same plaintext twice yields different ciphertexts, and that tampered ciphertext fails to decrypt.

**Severity**: `high`; `critical` when it protects payment data, credentials, or authentication tokens.

## security.insecure-randomness

**Look for**: non-cryptographic random generators used for anything an attacker must not guess: session IDs, API keys, password reset tokens, OTPs, invitation codes, CSRF tokens, file names for private files, nonces. Examples: JavaScript `Math.random()`, Python `random`, Java `java.util.Random` or `ThreadLocalRandom`, Go `math/rand`, and time- or counter-based IDs.

**Not a finding when**: a cryptographically secure source is used: Python `secrets` (or `os.urandom`, `uuid.uuid4()`), Java `SecureRandom`, Node.js `crypto.randomBytes`/`crypto.randomUUID`, Go `crypto/rand`, browser `crypto.getRandomValues`; or the value does not need to be secret (shuffling a UI list, sampling for metrics, jitter).

**Failure**: an attacker observes a few outputs, recovers the generator's state, and predicts the next reset token or session ID, taking over other users' accounts.

**Fix**: use the platform's cryptographically secure generator with at least 128 bits of entropy for tokens.

**Verify**: confirm every security-sensitive token is generated through the secure API.

**Severity**: `high`; `critical` for session and password-reset tokens.

## security.tls-verification-disabled

**Look for**: certificate or hostname verification turned off for outbound connections: Python `requests(..., verify=False)` or `ssl._create_unverified_context`, Go `InsecureSkipVerify: true`, Node.js `rejectUnauthorized: false` or `NODE_TLS_REJECT_UNAUTHORIZED=0`, Java trust managers that accept all certificates or `HostnameVerifier`s that return `true`, `curl -k` in scripts, and database or broker clients configured with TLS but no verification.

**Not a finding when**: verification is disabled only in test code against a local test server, or a private CA is configured explicitly (the correct fix for internal certificates).

**Failure**: an attacker on the network path (a compromised network device, a hostile Wi-Fi, a misrouted cloud network) intercepts the connection with any certificate and reads or modifies the traffic: API keys, payment data, database credentials, and responses the service trusts.

**Fix**: keep verification on. For internal services with private certificates, configure the private CA bundle explicitly rather than disabling verification.

**Verify**: a test that connects to a server with a self-signed certificate and asserts the connection fails.

**Severity**: `high`; `critical` for payment and credential traffic.

## security.debug-in-production

**Look for**: debug and diagnostic features reachable in production configuration:
- Django `DEBUG = True` (detailed error pages expose settings, environment details, and SQL).
- Flask or Werkzeug debug mode (`app.run(debug=True)`, `FLASK_DEBUG=1`): the interactive debugger can lead to remote code execution if exposed.
- Spring Boot Actuator endpoints exposed broadly (`management.endpoints.web.exposure.include=*`), especially `env`, `heapdump`, `threaddump`, and `loggers`, without authentication. A heap dump contains secrets in memory.
- Profilers (`pprof` in Go via `net/http/pprof` on the public listener), admin consoles, GraphQL playgrounds, Swagger UIs for internal APIs, and test or seed endpoints left enabled.

**Not a finding when**: these features are enabled only in development configuration, or exposed only on a separate internal port and network with authentication.

**Failure**: an attacker hits the debug console or Actuator endpoint and gets environment variables, credentials from a heap dump, internal structure, or a code execution console.

**Fix**: disable debug modes in production configuration, fail startup if debug is on in a production environment, expose only health and metrics endpoints publicly, and put management endpoints on an internal port behind authentication.

**Verify**: a test (or deployment check) that production settings have debug off and that management endpoints are not reachable from the public listener.

**Severity**: `critical` for interactive debuggers and heap dumps; `high` for environment and configuration exposure; `low` for API documentation pages.

## security.vulnerable-dependency

**Look for**: dependencies with known vulnerabilities. Do **not** report CVEs from memory, because advisories change constantly and version recall is unreliable. Instead, run the ecosystem's audit tool when available and report what it finds:

| Ecosystem | Tool |
| --- | --- |
| Node.js | `npm audit`, `pnpm audit`, `yarn npm audit` |
| Python | `pip-audit` |
| Go | `govulncheck ./...` (reports only vulnerabilities in code paths that are actually called) |
| Java | OWASP Dependency-Check, or `mvn`/`gradle` dependency audit plugins |
| Any | `osv-scanner` on the lockfiles |

These tools need network access to fetch advisories. If they cannot run, list the manifests and lockfiles and report a `needs-validation` finding asking the user to run the tool.

**Not a finding when**: the vulnerable code path is not reachable from this application (confirmed by a reachability-aware tool such as `govulncheck`, or by inspection), or the dependency is development-only and never shipped.

**Failure**: an attacker uses a published exploit for a library the service runs, for example a deserialization or parsing flaw, without needing any bug in your own code.

**Fix**: upgrade to a patched version, or apply the vendor's documented mitigation if no fix exists. Keep lockfiles committed and enable automated dependency updates (Dependabot, Renovate) with audits in CI.

**Verify**: re-run the audit tool and confirm the finding is gone.

**Severity**: use the advisory's severity, adjusted for reachability and exposure: lower it when the vulnerable function is not used, raise it when the component handles untrusted input on a public endpoint.
