# Security: injection

Injection happens when untrusted input reaches an interpreter (a SQL engine, a shell, a template engine, a deserializer, a file path, a regex engine) as code instead of data. Find each place untrusted input enters, follow it to these sinks, and check whether it stays data the whole way.

Untrusted input includes: request parameters, headers, cookies, bodies, uploaded files and their names, webhook payloads, message payloads that other tenants or services can influence, data previously stored from users, and values from third-party APIs.

## Contents

- security.sql-injection
- security.command-injection
- security.nosql-injection
- security.template-injection
- security.path-traversal
- security.unsafe-deserialization
- security.xxe
- security.redos

## security.sql-injection

**Look for**: untrusted input concatenated or interpolated into SQL, JPQL/HQL, or other query strings:

```python
cursor.execute(f"SELECT * FROM users WHERE email = '{email}'")
session.execute(text(f"... ORDER BY {sort}"))             # SQLAlchemy text() with interpolation
User.objects.raw("SELECT ... WHERE name = '%s'" % name)    # Django raw(), extra(), RawSQL
```
```java
stmt.executeQuery("SELECT * FROM orders WHERE id = " + id);               // JDBC Statement
em.createQuery("FROM Order o WHERE o.status = '" + status + "'");         // JPQL is injectable too
```
```ts
await pool.query(`SELECT * FROM users WHERE id = ${req.params.id}`);      // a plain template string, not a parameter
```

Also: dynamic identifiers (`ORDER BY`, column names, table names) taken from input, which cannot be passed as parameters, and stored procedures that build dynamic SQL internally.

**Not a finding when**: values are passed as bound parameters (`%s` placeholders with an args tuple, `?`, `:name`, `$1`, JPA `setParameter`, ORM query builders), or the query uses a tagged-template library that parameterizes automatically (for example `sql` tags in `postgres.js` or `slonik`), or dynamic identifiers come from a fixed allowlist in code.

**Failure**: an unauthenticated attacker sends `' OR '1'='1` or a `UNION SELECT` payload in a search box, login form, or sort parameter. They read the whole users table including password hashes, bypass login, or modify and delete data. Automated scanners find these within days of deployment.

**Fix**: bound parameters for every value. Map dynamic identifiers through an allowlist (`{"newest": "created_at DESC", "price": "price ASC"}`). Run the application's database user with least privilege so an injection cannot drop tables or read unrelated schemas.

**Verify**: a test that passes a quote and a SQL payload (`' OR 1=1 --`) through the input and asserts it is treated as a literal value (no extra rows, no error revealing SQL).

**Severity**: `critical` when reachable by unauthenticated or low-privilege users; `high` when only admins can reach it.

## security.command-injection

**Look for**: untrusted input reaching a shell or a process launcher:
- Python `os.system`, `os.popen`, `subprocess.run(..., shell=True)` with interpolated strings.
- Node.js `child_process.exec`/`execSync` with template strings.
- Java `Runtime.exec` with a concatenated command, or a `ProcessBuilder` that starts a shell to run a command string.
- Go `exec.Command` that starts a shell to run a command string built from input.
- Argument injection even without a shell: input starting with `-` passed as an argument to tools like `git`, `tar`, `ffmpeg`, or `ImageMagick` (the tool reads a value such as `--some-option=...` as an option rather than a file name, which can make it write files or run commands; git, for example, has options that run a command).

**Not a finding when**: the program and arguments are passed as a list with no shell (`subprocess.run(["convert", path, out])`, `execFile`, `exec.Command("convert", path, out)`), input is validated against a strict allowlist, and options are separated from arguments with `--` where the tool supports it.

**Failure**: an attacker submits a filename containing shell metacharacters, such as `x; id` or `$(id)`, and gets remote code execution on the server, with the service's credentials and network access.

**Fix**: avoid the shell. Pass arguments as an array, validate input against an allowlist, insert `--` before user-supplied arguments, and prefer a library over shelling out (an image library instead of calling `convert`).

**Verify**: a test that passes `; touch /tmp/pwned` and `--help`-style inputs and asserts no extra command runs and the input is rejected or treated as a literal.

**Severity**: `critical`.

## security.nosql-injection

**Look for**: request data passed into MongoDB (or similar) queries without type checks, so an attacker can send operators instead of values:

```js
User.findOne({ email: req.body.email, password: req.body.password })
// body: {"email": "admin@x.com", "password": {"$ne": null}}  → matches any password
```

Also `$where` clauses or `$function` built from input, and query objects assembled from `req.query` (Express parses `?user[$ne]=x` into an object with some parsers).

**Not a finding when**: inputs are validated to the expected primitive type before use (schema validation such as Joi, Zod, Pydantic, class-validator), or operator keys are stripped (`express-mongo-sanitize`, Mongoose `sanitizeFilter`).

**Failure**: an attacker logs in as any user without a password, or extracts data by injecting `$regex`, `$gt`, or `$where` operators.

**Fix**: validate every input against a schema with explicit primitive types, cast to strings where strings are expected, never build `$where` from input, and enable operator sanitization in the ODM.

**Verify**: a test that sends `{"$ne": null}` and `{"$gt": ""}` in place of string fields and asserts rejection.

**Severity**: `critical` on authentication paths; `high` otherwise.

## security.template-injection

**Look for**: user input used as template **source** rather than template data, or evaluated as an expression:
- Python Jinja2 `Template(user_input).render()`, Flask `render_template_string(user_input)`.
- Java: Freemarker, Velocity, or Thymeleaf templates built from input; Spring `SpelExpressionParser().parseExpression(userInput)`; OGNL or MVEL evaluation of input.
- Node.js: `eval`, `new Function`, `vm.runInContext` with input; template engines compiling user-provided templates.
- "Customizable" email or notification templates edited by tenants and rendered with a full-power engine.

**Not a finding when**: input is only passed as variables into a fixed template, or user-editable templates are rendered with a sandboxed, logic-less engine (for example Mustache, or Jinja2's `SandboxedEnvironment` with care).

**Failure**: an attacker submits `{{ ''.__class__.__mro__[1].__subclasses__() }}`-style payloads (or a SpEL `T(java.lang.Runtime)` expression) and gets remote code execution.

**Fix**: never compile or evaluate user input as a template or expression. Pass it as data. For tenant-customizable templates, use a logic-less engine or a sandbox, with an allowlist of variables.

**Verify**: a test that submits `{{7*7}}` (and the engine's equivalent) and asserts the output contains the literal text, not `49`.

**Severity**: `critical`.

## security.path-traversal

**Look for**: untrusted input used to build file paths for reading, writing, or deleting:

```python
open(os.path.join(UPLOAD_DIR, filename))     # filename = "../../etc/passwd"
os.path.join("/srv/files", "/etc/passwd")     # → "/etc/passwd": an absolute second argument discards the base
```
```java
new File(baseDir, request.getParameter("name"));
```
```js
res.sendFile(path.join(__dirname, "files", req.query.f));
```

Also archive extraction that trusts entry names (zip slip: entries named `../../app/config.py`), and files saved under a path built from user-controlled data.

**Not a finding when**: files are looked up by an ID that maps to a server-generated name, or the resolved real path is verified to stay inside the base directory after normalization and symlink resolution.

**Failure**: an attacker reads `/etc/passwd`, application config with database credentials, or cloud credentials files, or overwrites application files to get code execution.

**Fix**: do not use user input as a path. Store files under generated names and keep a mapping. If a name must be used, resolve the real path and check containment: Python `Path(base, name).resolve().is_relative_to(Path(base).resolve())`, Java `base.resolve(name).normalize()` then `startsWith(base)` (plus `toRealPath()` if symlinks are possible). Reject absolute paths and `..`. For archives, apply the same check to every entry before writing.

**Verify**: tests with `../`, encoded `..%2f`, absolute paths, and a zip containing a `../` entry, asserting rejection.

**Severity**: `critical` for writes or reads of secrets; `high` for other reads.

## security.unsafe-deserialization

**Look for**: deserializers that can instantiate arbitrary types, applied to untrusted data:
- Python `pickle.loads`/`pickle.load` (including through caches, queues, or files users can influence), `yaml.load` without a safe loader, `yaml.unsafe_load`, `jsonpickle.decode`, `shelve`.
- Java `ObjectInputStream.readObject` on network or user data; Jackson with default typing enabled (`activateDefaultTyping`/legacy `enableDefaultTyping`) or `@JsonTypeInfo(use = Id.CLASS)` on untrusted input; XStream without a strict allowlist.
- .NET `BinaryFormatter`, `NetDataContractSerializer`; Ruby `Marshal.load`; PHP `unserialize`; Node.js `node-serialize`.

**Not a finding when**: the data comes only from a trusted source with integrity protection (for example signed with a key the attacker cannot obtain, and verified before deserializing), or a data-only format is used (JSON into plain types, `yaml.safe_load`, Protobuf).

**Failure**: an attacker sends a crafted payload (a pickle with a `__reduce__` method, or a Java gadget chain) and gets remote code execution during deserialization, before any application logic runs.

**Fix**: use data-only formats (JSON, Protobuf) and map into explicit types. Use `yaml.safe_load`. Disable polymorphic default typing and use explicit allowlists of subtypes. Never unpickle data that crossed a trust boundary.

**Verify**: confirm the code path accepts only data-only formats; a test that sends a malicious pickle or YAML tag (`!!python/object`) and asserts it is rejected.

**Severity**: `critical`.

## security.xxe

**Look for**: XML parsing of untrusted input with DTDs or external entities enabled:
- Java `DocumentBuilderFactory`, `SAXParserFactory`, `XMLInputFactory`, `TransformerFactory`, `SchemaFactory` used without disabling DTDs and external entities (the JDK parsers process DTDs by default).
- Python `lxml` parsers with entity resolution or network access enabled; the standard library XML parsers on untrusted input are exposed to entity-expansion attacks ("billion laughs").
- Endpoints accepting SOAP, SAML, SVG, DOCX/XLSX (which are zipped XML), RSS, or any `Content-Type: application/xml`.

**Not a finding when**: DTDs are disallowed (Java: the parser's `disallow-doctype-decl` feature enabled, plus external entities disabled), the input is trusted, or Python uses `defusedxml`.

**Failure**: an attacker uploads XML with an external entity pointing at a local file such as `/etc/passwd` or at the cloud metadata address `169.254.169.254`, and reads local files or cloud metadata credentials (SSRF), or sends nested entities that expand to gigabytes and exhaust memory.

**Fix**: disable DTDs and external entities on every parser factory (follow the OWASP XXE Prevention Cheat Sheet for your parser), or use `defusedxml` in Python. Prefer JSON where you control the format.

**Verify**: a test that parses an XML payload with an external entity and a nested-entity bomb, asserting rejection without file access or memory blowup.

**Severity**: `critical` for file or metadata disclosure; `high` for denial of service only.

## security.redos

**Look for**: regular expressions with nested or overlapping quantifiers (`(a+)+`, `(a|aa)+`, `(.*a){10}`, `(\w+\s?)*$`) applied to untrusted input in backtracking engines: JavaScript, Python `re`, Java, .NET, Ruby, and PCRE. Common in email, URL, and markdown validation regexes copied from the internet.

**Not a finding when**: the engine guarantees linear time (Go's `regexp`, Rust's `regex`, RE2 bindings such as `google-re2`), the input length is capped to a small size before matching, or the pattern has no nested or overlapping repetition.

**Failure**: an attacker sends a 30-character string crafted to trigger catastrophic backtracking. A single request pins a CPU core for seconds or minutes; a handful of requests make the service unresponsive. On Node.js, one such request blocks the entire event loop.

**Fix**: rewrite the pattern without nested quantifiers, cap input length before matching, use a linear-time engine for user-supplied input, or use a dedicated validation library instead of a hand-written regex.

**Verify**: run the regex against a known worst-case input (for example many repetitions of the matching character followed by a non-matching one) with a time limit; use a ReDoS checker where available.

**Severity**: `high` on unauthenticated endpoints; `medium` otherwise.
