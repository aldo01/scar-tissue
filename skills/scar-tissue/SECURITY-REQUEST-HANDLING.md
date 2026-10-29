# Security: request handling

These vulnerabilities live at the edges of a service: where it fetches URLs on a user's behalf, redirects, accepts files, renders output, answers cross-origin requests, and reports errors.

## Contents

- security.ssrf
- security.open-redirect
- security.cors-misconfiguration
- security.csrf
- security.xss
- security.file-upload
- security.verbose-errors

## security.ssrf

**Look for**: the server making requests to URLs or hosts influenced by users: "import from URL", image or avatar fetch by URL, link previews and unfurling, webhook registration and test-fire, PDF or screenshot generators rendering user HTML, URL fields passed to HTTP clients, XML or SVG processing that follows external references, integrations where users enter a hostname.

**Not a finding when**: destinations come from a fixed allowlist, or every request is validated after DNS resolution against an allowlist (or a blocklist of private, loopback, link-local, and metadata ranges) and sent to the validated IP, with redirects disabled or re-validated, or requests go through an egress proxy that enforces this.

**Failure**: an attacker submits `http://169.254.169.254/latest/meta-data/iam/security-credentials/` and the server returns cloud credentials (AWS IMDSv1 needs no token), or reaches internal admin panels, databases with HTTP interfaces, and `localhost`-only services. Naive checks are bypassed with redirects, DNS rebinding, decimal or IPv6-mapped IP addresses (`http://2130706433/`, `http://[::ffff:127.0.0.1]/`), and `user@host` tricks.

**Fix**: prefer an allowlist of hosts. Otherwise resolve the hostname, reject private, loopback, link-local, and metadata addresses (IPv4 and IPv6), connect to the resolved IP (to defeat DNS rebinding), disable redirects or re-validate every hop, restrict schemes to `https` (and `http` if needed), and set short timeouts and response size limits. Route outbound user-driven requests through an egress proxy with these rules. Enforce IMDSv2 on cloud instances.

**Verify**: tests with metadata IPs, `localhost`, private ranges, decimal and IPv6-mapped forms, a redirect to an internal address, and a hostname resolving to `127.0.0.1`, all rejected.

**Severity**: `critical` when cloud metadata or internal admin services are reachable; `high` otherwise.

## security.open-redirect

**Look for**: redirects to a URL taken from input: `redirect(request.args["next"])`, `res.redirect(req.query.returnTo)`, `return "redirect:" + url`, OAuth `redirect_uri` values not matched exactly against registered URIs.

**Not a finding when**: the target is validated against an allowlist of exact URLs or hosts, or only relative paths are accepted with checks that reject `//evil.com`, `/\evil.com`, and scheme-relative or encoded variants.

**Failure**: an attacker sends victims a link on your real domain that redirects to a phishing page, which makes phishing far more convincing. In OAuth flows, a loose `redirect_uri` check lets attackers steal authorization codes or tokens and take over accounts.

**Fix**: redirect only to allowlisted destinations or to relative paths validated by parsing (not by string prefix). Match OAuth redirect URIs exactly.

**Verify**: tests with absolute URLs to other domains, `//evil.com`, `/\evil.com`, and encoded variants, asserting the redirect stays on-site.

**Severity**: `high` in OAuth and authentication flows; `medium` otherwise.

## security.cors-misconfiguration

**Look for**: CORS policies that let untrusted origins read authenticated responses:
- Reflecting the request's `Origin` header back in `Access-Control-Allow-Origin` together with `Access-Control-Allow-Credentials: true`.
- Origin checks by substring, prefix, or loose regex (`endswith("example.com")` matches `evilexample.com`; an unescaped `.` in a regex matches any character).
- Allowing the `null` origin with credentials.
- Framework CORS middleware configured with `origin: true` or a callback that allows everything, plus credentials.

**Not a finding when**: allowed origins are an exact-match allowlist, or credentials are not allowed and the API does not rely on cookies or other ambient credentials.

**Failure**: an attacker's website, visited by a logged-in user, makes cross-origin requests with the user's cookies and reads the responses: account data, API keys, CSRF tokens, personal information.

**Fix**: use an exact allowlist of origins. Only enable credentials for those origins. Never reflect arbitrary origins, and never allow `null` with credentials.

**Verify**: tests sending `Origin: https://evil.com`, `https://evilexample.com`, and `null`, asserting no `Access-Control-Allow-Origin` echo with credentials.

**Severity**: `high` when credentials are allowed; `low` otherwise.

## security.csrf

**Look for**: state-changing endpoints that authenticate with cookies (sessions) and have no CSRF protection: no CSRF token, no `SameSite` restriction, CSRF middleware disabled or exempted (`@csrf_exempt`, `csrf().disable()` in Spring Security with cookie sessions), state changes on GET requests, and JSON endpoints that also accept form or `text/plain` content types.

**Not a finding when**: authentication uses an `Authorization` header (bearer tokens) rather than cookies, or CSRF tokens are enforced, or session cookies are `SameSite=Lax`/`Strict` and no state-changing GET endpoints exist.

**Failure**: a logged-in user visits an attacker's page, which submits a hidden form to your site. The browser attaches the session cookie, and the action runs as the user: changing their email (leading to account takeover), transferring money, or deleting data.

**Fix**: keep the framework's CSRF protection enabled for cookie-authenticated routes, set `SameSite` on session cookies, never change state on GET, and accept only `application/json` on JSON APIs.

**Verify**: a test that submits a cross-site form request without a valid CSRF token and asserts rejection.

**Severity**: `high` for account, money, and security settings; `medium` otherwise.

## security.xss

**Look for**: untrusted data written into HTML without context-appropriate escaping on the server: template autoescaping turned off, raw-output filters (`|safe`, `mark_safe`, `{% autoescape false %}`, Thymeleaf `th:utext`, `<%- %>` in EJS, `{{{ }}}` in Handlebars), HTML built with string concatenation, user input placed inside `<script>` blocks or event-handler attributes, JSON responses served with `Content-Type: text/html`, and user-uploaded HTML or SVG served from the main domain.

**Not a finding when**: templates autoescape (the default in Django, Jinja2 in Flask, Thymeleaf `th:text`, React JSX) and no raw-output path receives untrusted data, or rich content is sanitized with a maintained HTML sanitizer before rendering.

**Failure**: an attacker stores a payload (a profile name, a comment, a support ticket) that runs JavaScript in other users' browsers, including administrators: stealing sessions, performing actions as them, or exfiltrating data.

**Fix**: rely on autoescaping and remove raw-output paths for untrusted data. Sanitize rich text with a maintained sanitizer. Serve JSON as `application/json`. Serve user uploads from a separate domain. Add a Content Security Policy as defense in depth.

**Verify**: a test that stores `<script>alert(1)</script>` and `"><img src=x onerror=alert(1)>` and asserts the rendered output is escaped.

**Severity**: `high` for stored XSS (`critical` if it reaches admin pages); `medium` for reflected XSS.

## security.file-upload

**Look for**: uploads accepted with the client-supplied filename, extension, or `Content-Type` trusted; files stored under the web root or served from the main domain; no size limit; HTML, SVG, or executable types accepted and served inline; uploaded archives extracted without checks; untrusted files processed by complex parsers (ImageMagick, Ghostscript, LibreOffice, video tools) without isolation.

**Not a finding when**: files get server-generated names, types are verified by content against an allowlist, size is limited, storage is outside the web root (or in object storage), and files are served from a separate domain with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

**Failure**: an attacker uploads an HTML or SVG file that executes JavaScript on your domain (stored XSS), a web shell that executes on the server, a path-traversal filename that overwrites application files, a decompression bomb, or a crafted image that exploits the image processor.

**Fix**: generate storage names, validate type by content against an allowlist, enforce size limits, store outside the web root, serve from a separate domain with attachment disposition and `nosniff`, and process untrusted files in an isolated, resource-limited worker.

**Verify**: tests uploading an `.html` disguised as `.jpg`, an SVG with script, a filename with `../`, and an oversized file, asserting each is rejected or neutralized.

**Severity**: `critical` if uploads can execute on the server; `high` for stored XSS; `medium` otherwise.

## security.verbose-errors

**Look for**: error responses that include stack traces, SQL statements, internal hostnames, file paths, library versions, or raw exception messages: catch-all handlers returning `str(e)` or `e.getMessage()` to clients, Spring Boot `server.error.include-stacktrace=always`, Express's default error handler when `NODE_ENV` is not `production`, GraphQL errors exposing internal details.

**Not a finding when**: clients receive a generic error with a correlation ID, and details go only to logs.

**Failure**: an attacker triggers errors deliberately to map the system: database type and schema from SQL errors, file paths, framework versions with known vulnerabilities, internal service names. That information makes other attacks faster and more precise.

**Fix**: return generic error messages with a request ID, log the details server-side, and configure frameworks for production error handling.

**Verify**: a test that triggers an internal error and asserts the response contains no stack trace, SQL, or file path.

**Severity**: `medium`; `low` if the details are minor.
