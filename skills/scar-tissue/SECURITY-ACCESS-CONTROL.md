# Security: access control

Broken access control is the most common serious vulnerability in web applications. The code authenticates the user correctly and then never checks whether *this* user may do *this* thing to *this* object. Look at every handler that reads or changes data and ask: who is allowed, and where is that checked?

## Contents

- security.missing-authorization
- security.idor
- security.tenant-isolation
- security.mass-assignment
- security.client-trusted-value

## security.missing-authorization

**Look for**: endpoints, RPC methods, or jobs that perform sensitive actions without verifying the caller's identity or permission:
- Handlers with no authentication decorator, dependency, guard, or middleware, in a codebase where other handlers have one.
- The caller's identity taken from a request parameter, body field, or header (`?customer_id=`, `X-User-Id`) instead of a verified session or token.
- Admin or internal endpoints protected only by being "hidden" (not linked in the UI, an obscure path, an internal-sounding prefix) rather than by a role check.
- Role or permission checks done only in the frontend.
- Overly broad framework rules: Spring Security `permitAll()` matchers that are too wide or ordered before narrower rules, Express routers mounted before the auth middleware.

**Not a finding when**: authentication and authorization are enforced centrally for this route (global middleware, a gateway that verifies tokens and the service only trusts its injected identity over a private network, framework security configuration) and you can see the configuration; or the endpoint is intentionally public and exposes nothing sensitive.

**Failure**: an unauthenticated attacker calls the endpoint directly (with curl, not the UI) and performs the action as any user: places orders on someone else's account, spends another customer's wallet balance, reads personal data, or uses admin functions.

**Fix**: deny by default. Require authentication globally and explicitly mark the few public routes. Derive the caller's identity only from a verified session or token, never from client-supplied fields. Check permissions on the server for every sensitive action, ideally in one place (policy layer, guard, or method-level security).

**Verify**: tests that call each sensitive endpoint without credentials, with another user's credentials, and with a low-privilege role, asserting 401/403 (or 404).

**Severity**: `critical` when unauthenticated callers can act as other users or reach admin functions; `high` for privilege escalation by authenticated users.

## security.idor

**Look for**: an object fetched or modified by an ID from the request, without checking that it belongs to (or is shared with) the caller. This is also called broken object-level authorization (BOLA):

```python
order = db.get(Order, order_id)                     # any order, not "my order"
```
```java
invoiceRepository.findById(id)                      // then returned or updated directly
```
```js
await Doc.findByIdAndUpdate(req.params.id, req.body)
```

Check reads, updates, deletes, file downloads, nested resources (`/projects/1/tasks/99` where task 99 belongs to project 2), bulk endpoints taking lists of IDs, and GraphQL `node(id:)` resolvers.

**Not a finding when**: the query is scoped to the caller (`WHERE id = :id AND owner_id = :current_user`), a policy check runs after loading (`authorize(user, order)`), or the object is public by design.

**Failure**: a logged-in user changes `/api/orders/1001` to `/api/orders/1002` and reads (or edits, or deletes) another customer's order, address, and payment details. Sequential IDs make it trivial to scrape every record.

**Fix**: scope every lookup by the authenticated principal or apply an authorization check on the loaded object, in a shared helper so it cannot be forgotten. Return 404 rather than 403 for objects the caller may not see, to avoid confirming that they exist. Unguessable IDs (UUIDs) reduce scraping but are not a substitute for the check.

**Verify**: a test where user A requests, updates, and deletes user B's object by ID and gets 404 (or 403) every time.

**Severity**: `high`; `critical` when it exposes financial or sensitive personal data at scale.

## security.tenant-isolation

**Look for**: multi-tenant code where a query, cache key, search index, file path, or background job can cross tenant boundaries:
- Queries missing the tenant filter, especially in reports, exports, search, admin views, and new endpoints.
- Tenant ID taken from the request instead of the authenticated context.
- Cache keys without the tenant ID (`cache.get(f"settings")`, `cache.get(f"user:{user_id}")` where user IDs are not globally unique).
- Background jobs that iterate over data without restoring the tenant context.
- Shared object storage paths without a tenant prefix and access check.

**Not a finding when**: isolation is enforced below the application code (PostgreSQL row-level security policies bound to the tenant, separate databases or schemas per tenant, an ORM global filter that cannot be bypassed accidentally such as Hibernate filters or EF Core global query filters) and the tenant comes from the authenticated context.

**Failure**: one customer sees another customer's data: a report includes rows from all tenants, a cached settings object leaks between companies, or a search returns documents from other organizations. For B2B products this is a reportable breach and a lost customer.

**Fix**: take the tenant from the authenticated context only, enforce it in one layer that every query passes through (row-level security, a mandatory repository filter), include the tenant in every cache key and storage path, and set the tenant context explicitly in jobs.

**Verify**: tests with two tenants that exercise list, search, export, cache, and job paths and assert no cross-tenant results.

**Severity**: `critical`.

## security.mass-assignment

**Look for**: request bodies bound directly to persistence models or update calls without an allowlist of fields:

```python
User(**request.json)                                  # or user.update(**payload)
class UserSerializer(ModelSerializer): fields = "__all__"
```
```ruby
User.update(params.permit!)
```
```java
@PostMapping public User update(@RequestBody User user)   // entity used as the request type
```
```js
await User.create(req.body); Object.assign(user, req.body);
```

Sensitive fields at risk: `role`, `is_admin`, `is_verified`, `balance`, `credit_limit`, `owner_id`, `tenant_id`, `price`, `status`, `email_verified`.

**Not a finding when**: a dedicated request type (DTO, schema, form) with an explicit list of writable fields is used, or sensitive fields are marked read-only and the framework enforces it.

**Failure**: an attacker adds `"role": "admin"` or `"balance": 1000000` to a profile-update request and the server saves it, giving them admin access or free credit.

**Fix**: use explicit request types with only the fields a client may set, and copy them onto the model deliberately. Mark sensitive fields read-only in serializers. Never use persistence entities as API request types.

**Verify**: a test that sends extra privileged fields in create and update requests and asserts they are ignored or rejected.

**Severity**: `critical` when privilege or money fields are writable; `high` otherwise.

## security.client-trusted-value

**Look for**: the server trusting values from the client that it should compute or verify itself: prices, totals, discounts, tax, currency, quantity limits, the amount to charge, the user's role or plan, "payment succeeded" flags, feature entitlements, the result of a client-side check (CAPTCHA passed, OTP verified), or identifiers that decide who is charged or credited.

**Not a finding when**: the server recomputes the value from authoritative data (product catalog, cart in the database, plan record) and ignores or cross-checks the client's value.

**Failure**: an attacker edits the request to pay 1 cent for a 10,000-rupee order, apply a 100% discount, or mark an unpaid order as paid. Nothing errors, so the loss shows up only in revenue reconciliation.

**Fix**: compute money and entitlements on the server from authoritative data (look up prices, rebuild the total from the cart, read the plan from the database), confirm payment status with the payment provider (webhook or API), and treat client-sent values as hints at most.

**Verify**: tests that tamper with price, total, discount, and status fields and assert the server's computed values are used.

**Severity**: `critical` when it changes what is charged or paid out; `high` otherwise.
