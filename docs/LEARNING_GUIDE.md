# DUMPWISE Learning Guide — Phase 1

For each major step: **A** what we built · **B** why DUMPWISE needs it · **C** files to read ·
**D** concepts · **E** a small exercise · **F** two interview questions with answers.

Read the files in section C with this guide open beside them. Every exercise can be checked
with `npm run verify` in `apps/api`.

---

## Step 1 — Inspecting the project and Docker

**A.** Before writing code we checked the existing project: tool versions, `compose.yaml`,
whether `.env` exists (without printing it), the NestJS scaffold, and whether PostgreSQL
was healthy.

**B.** Overwriting an existing setup or wiping a database is the most expensive mistake a
new engineer can make. Inspecting first also found a real problem: the scaffold shipped a
telemetry module that would send data to an outside service.

**C.** `compose.yaml`, `.gitignore`, `apps/api/package.json`

**D. Concepts**
- **Docker image vs. container.** An image (`postgres:17`) is a read-only template. A container (`dumpwise-postgres`) is a running instance of it.
- **Volume.** `postgres_data` keeps database files when the container is recreated.
- **Port mapping.** `127.0.0.1:5433:5432` means "port 5433 on *this machine only* forwards to 5432 inside the container". Writing `5433:5432` without the IP would expose the database to your whole network.
- **Health check.** `pg_isready` lets Docker report `healthy` only once PostgreSQL accepts connections.

**E. Exercise.** Run `docker compose ps` and `docker port dumpwise-postgres`. Then explain
in one sentence what would change if the ports line were `"5433:5432"`.

**F. Interview**
1. *What is the difference between a Docker image and a container?* An image is an immutable template made of layers. A container is a running, writable instance of an image. Many containers can run from one image.
2. *Why bind a dev database to 127.0.0.1?* So only programs on the same machine can reach it. Binding to all interfaces exposes it to anyone on the network, for example on café Wi-Fi.

---

## Step 2 — Backend foundation (NestJS)

**A.** A NestJS API on `127.0.0.1:3001` with `GET /health`, validated configuration, a global
input-validation pipe, one consistent error format, and OpenAPI docs.

**B.** Every later feature (dashboards, forecasting, presentations) hangs off this
skeleton. Misconfiguration has to fail loudly at startup, not at 2 a.m. during a management
report.

**C.** `src/main.ts`, `src/app.module.ts`, `src/app.setup.ts`, `src/config/env.ts`,
`src/common/all-exceptions.filter.ts`, `src/health/health.controller.ts`

**D. Concepts**
- **HTTP.** A request has a method (GET reads, POST creates…), a path, headers and an optional body. A response has a status code (2xx success, 4xx client error, 5xx server error), headers and a body.
- **REST.** URLs name *resources* (`/v1/sales/monthly`) and HTTP methods name *actions*. `v1` lets us change the API later without breaking old clients.
- **Module / controller / service.**
  - A **controller** handles HTTP: it reads the request and returns the response.
  - A **service** holds business logic and knows nothing about HTTP.
  - A **module** groups them and declares what it shares.
- **Dependency injection (DI).** `constructor(private readonly prisma: PrismaService)`: the class *asks* for a `PrismaService` instead of creating one. Nest builds it once and hands it to everyone who asks. This is why tests can swap the authenticator (Step 6).
- **Pipes and filters.** The `ValidationPipe` checks input *before* your code runs. The exception filter shapes errors *after* something throws.

**E. Exercise.** Add `version: '0.1.0'` to the `/health` response (DTO and controller).
Update `test/health.e2e-spec.ts` to expect it, then run `npm run test:e2e`.

**F. Interview**
1. *Why keep business logic out of controllers?* Services can then be reused from other entry points (our CLI calls the same services as the API) and tested without HTTP. Controllers stay thin translators.
2. *What problem does dependency injection solve?* It decouples a class from how its dependencies are built. That makes implementations swappable, which matters for testing and configuration, and gives you single shared instances such as one database pool.

---

## Step 3 — Database (SQL, Prisma, migrations, roles)

**A.** Ten tables (organizations, users, memberships, import batches, products,
distributors, customers, sales transactions, reconciliation results, audit events). They
use UUID keys, decimal money, composite tenant foreign keys and CHECK constraints. We added
a migration and a restricted runtime database role.

**B.** Sales numbers drive business decisions. The database is the last line of defense
against wrong signs, lost leading zeros and one company seeing another's data.

**C.** `prisma/schema.prisma`, `prisma/migrations/*/migration.sql`, `prisma.config.ts`,
`scripts/setup-db-roles.ts`, `src/prisma/prisma.service.ts`

**D. Concepts**
- **Table, row, column, primary key.** Each transaction is a row, and `id` uniquely identifies it.
- **Foreign key.** `product_id` must point to an existing product. Ours are *composite*, `(organization_id, product_id)`, so the product must also belong to the same organization.
- **Unique constraint.** `(organization_id, billing_document, billing_item)` makes the same SAP item impossible to store twice.
- **Index.** Like a book index, it makes "all transactions of org X in September" fast.
- **ORM (Prisma).** You write `prisma.product.findMany(...)` and get typed results; Prisma generates the SQL.
- **Migration.** A versioned SQL file that changes the schema. It is committed, reviewed and applied the same way everywhere. Never edit the database by hand.
- **Decimal vs. float.** `0.1 + 0.2 !== 0.3` in floating point. Money uses `numeric(18,2)` and decimal strings.
- **Least privilege.** The app role cannot DELETE or DROP, so even a bug or SQL injection cannot wipe data.

**E. Exercise.** Add an optional `region varchar(50)` column to `distributors`. Run
`npm run db:migrate:dev -- --name add_distributor_region`, read the generated SQL, and run
`npm run verify`.

**F. Interview**
1. *Why store SAP document numbers as strings?* They are identifiers, not quantities. `0090000908` as a number becomes `90000908`, which loses the leading zeros, breaks joins with SAP, and invites accidental arithmetic.
2. *What does a migration give you that editing the database by hand does not?* A reproducible, reviewable, ordered history. Every environment (dev, test, production) reaches the same schema the same way, and the schema change lives in version control with the code that needs it.

---

## Step 4 — Synthetic SAP data

**A.** A Python generator that writes 12 months of fictional SAP billing rows. It includes
credit memos, returns, cancellations, USD invoices, 24 duplicates, a conflicting key and 11
invalid rows, plus independently computed control totals.

**B.** We must never develop with real company data, but tests need realistic and *messy*
data. The independent totals make reconciliation meaningful.

**C.** `tools/synthetic-data/generate_sap_billing.py`, `data/synthetic/README.md`

**D. Concepts**
- **Deterministic randomness.** A fixed seed (`20261023`) produces the same "random" file every run, so tests are repeatable.
- **Ground truth.** The generator knows which rows are valid and computes the expected totals itself. The pipeline must reach the same answer independently.
- **Test oracle independence.** If the expected value is computed by the code under test, a bug fools both sides.

**E. Exercise.** Add one more invalid row type to the generator: a quantity written with
two decimal points (`1.2.3`). Regenerate, run `npm test`, and explain why the "synthetic
dataset" unit test still passes without any change to the TypeScript code.

**F. Interview**
1. *Why generate test data instead of copying production data?* Privacy and legal risk, and because you can deliberately inject the edge cases you need. Production data rarely contains every error you must handle.
2. *What is a test oracle?* The source of truth that says what the correct output is. A good oracle is independent of the implementation under test.

---

## Step 5 — The import pipeline

**A.** CSV → header recognition → type conversion → validation → duplicate detection →
database import → monthly aggregation → reconciliation. The stages up to duplicate detection
are pure functions. The database part runs in one transaction that rolls back if
reconciliation fails.

**B.** This is DUMPWISE's core promise: management sees numbers that provably match SAP.

**C.** `src/imports/parsing/*.ts` (read `header-mapping.ts`, `value-parsers.ts`,
`billing-rules.ts`, `parse-billing-file.ts`), `src/imports/import-pipeline.service.ts`,
`src/imports/reconciliation.ts`

**D. Concepts**
- **Pure function.** Same input gives the same output with no side effects. Pure functions are easy to test (23 unit tests run in milliseconds).
- **Database transaction.** A group of statements that commit *all together or not at all* (ACID). Our failed reconciliation throws inside `$transaction`, so every insert is undone.
- **Idempotency.** Doing something twice has the same effect as doing it once. A re-import of the same file is a no-op; overlapping rows are recognized by key and hash.
- **Advisory lock.** `pg_advisory_xact_lock` makes two imports for the same organization wait for each other.
- **Fail closed.** When unsure (an `Amount` column, a `03/05/2026` date), reject and explain; never guess.

**E. Exercise.** Support the SAP billing type `L2` (debit memo: +value, quantity 0). Update
`billing-rules.ts`, the Prisma enum and the CHECK constraint (in a new migration), and
add a unit test.

**F. Interview**
1. *How do you make a data import idempotent?* Give each record a natural business key, enforce it with a unique constraint, detect repeats (we use key plus content hash), and make "already processed" a successful no-op rather than an error or a duplicate.
2. *Why reconcile against control totals?* Row-level validation cannot detect *missing* or extra rows, or a systematic sign error. Comparing aggregates with an independent source catches whole classes of error before anyone sees the numbers.

---

## Step 6 — First protected API: authentication and authorization

**A.** `GET /v1/sales/monthly`, guarded by `OrganizationAccessGuard`. Authentication sits
behind an interface. The production binding rejects everyone; tests swap in a test-only
implementation through DI.

**B.** Multiple companies will share DUMPWISE. One leaked sales figure to a competitor
would end the business.

**C.** `src/auth/*.ts`, `src/sales/*.ts`, `test/helpers.ts` (`TestHeaderAuthenticator`)

**D. Concepts**
- **Authentication** = *who are you?* (401 when unknown). **Authorization** = *what may you do?* (403 when not allowed).
- **Multi-tenancy.** Many organizations in one database; every query is scoped by `organization_id`.
- **Guard.** Nest code that runs before the controller and can block the request.
- **Never trust client-supplied scope.** The organization id used in queries comes from the verified membership, and unknown query parameters are rejected.
- **Do not leak existence.** Return 403 for both "not a member" and "no such org".

**E. Exercise.** Add a `VIEWER`-forbidden rule: only `OWNER` and `ANALYST` may call the
endpoint. Hint: pass allowed roles to `OrganizationAccessService.require`. Add an e2e test
that a VIEWER receives 403.

**F. Interview**
1. *401 vs. 403?* 401 means the server doesn't know who you are, so authenticate. 403 means it knows who you are and you are not allowed.
2. *How do you test protected endpoints before real login exists?* Put authentication behind an interface, bind a deny-all implementation in production, and override it only in the test module with a test implementation that is never shipped.

---

## Step 7 — Security

**A.** Secrets out of Git, services bound to localhost, a least-privilege database role,
input limits, spreadsheet rejection (no macros), no external telemetry, and an honest list
of limitations.

**B.** Customers will hand DUMPWISE their most sensitive commercial data. Trust is the
product.

**C.** `docs/SECURITY.md`, `.gitignore`, `.env.example` files, `src/imports/parsing/csv-reader.ts`

**D. Concepts.** Defense in depth (application checks + database constraints); least
privilege; fail closed; secrets management; attack surface reduction (no upload endpoint
until auth exists); and why `.xlsm` is dangerous (macros are code).

**E. Exercise.** Install `helmet`, call `app.use(helmet())` in `configureApp`, and confirm with
`Invoke-WebRequest http://127.0.0.1:3001/health | Select-Object -Expand Headers` that new
security headers appear.

**F. Interview**
1. *What is defense in depth?* Several independent layers so that one failure is not fatal. Here, service-level org filtering *and* composite foreign keys *and* a restricted database role.
2. *Why is "no CORS configured" a security property here?* Browsers block JavaScript on other origins from reading our responses unless the server opts in. Leaving CORS off keeps random websites from calling a local API with a user's browser.

---

## Step 8 — Testing

**A.** 23 unit tests (pure parsing logic) and 21 e2e tests (real NestJS app + real PostgreSQL
test database). A mutation check proved the tests catch a wrong sign rule.

**B.** Financial logic must not regress silently when someone adds a feature next year.

**C.** `src/imports/parsing/parse-billing-file.spec.ts`, `test/*.e2e-spec.ts`,
`test/global-setup.ts`, `vitest.config*.ts`

**D. Concepts**
- **Unit test.** One function, no I/O, very fast.
- **Integration or e2e test.** Real modules and database together; slower but realistic.
- **Test isolation.** Each test creates its own organizations with random slugs, and the test DB is separate from dev (and refuses names not ending in `_test`).
- **Mutation testing.** Break the code on purpose; good tests must fail.
- **Arrange / Act / Assert.** Set up data, perform the action, check the result.

**E. Exercise.** Write a unit test proving that `90000908` and `0090000908` in the *same
file* are treated as duplicates, then temporarily remove `alphaPad` from `row-normalizer.ts`
and watch it fail.

**F. Interview**
1. *Unit vs. integration tests: when do you use which?* Unit tests for logic with many cases (date parsing), because they are fast and precise. Integration tests for wiring and contracts (SQL, guards, transactions), where mocks would hide real bugs.
2. *How do you keep database tests reliable?* Use a dedicated test database, migrate it the same way as production, give each test unique data or clean deterministically, avoid order dependence, and run files serially when they share state.

---

# Phase 2a — Authentication, authorization and protected APIs

## Step 9 — Password storage

**A.** Users log in with e-mail and password. We never store the password: we store a
**scrypt** hash with a random salt, in the form `scrypt$16$8$2$<salt>$<hash>`.

**B.** If the database ever leaks, attackers must not get working passwords. Many people
reuse passwords across systems, including their SAP login.

**C.** `src/auth/password-hasher.ts`, `src/auth/password-hasher.spec.ts`

**D. Concepts**
- **Hash vs. encryption.** Encryption can be reversed with a key. A hash cannot be reversed: to check a password you hash the attempt and compare.
- **Salt.** Random bytes mixed in, so two users with the same password get different hashes and precomputed "rainbow tables" are useless.
- **Slow, memory-hard hashing.** scrypt deliberately uses ~64 MiB of memory and ~0.2 s per guess. That's harmless for one login and ruinous for someone trying billions of guesses on GPUs. Never use plain SHA-256 for passwords.
- **Constant-time comparison** (`timingSafeEqual`). It doesn't stop early at the first wrong byte, so timing reveals nothing.
- **Unicode normalization (NFKC).** "café" can be typed as one character or as "e" plus an accent; both must log in.

**E. Exercise.** In `password-hasher.spec.ts`, write a test proving that the *same* password
hashed twice verifies against *both* hashes, even though the hashes differ.

**F. Interview**
1. *Why not hash passwords with SHA-256?* It is designed to be fast, billions per second on a GPU, so leaked hashes of human passwords are cracked quickly. Password hashing needs a deliberately slow, salted, preferably memory-hard function: scrypt, Argon2id or bcrypt.
2. *What is a salt and why must it be unique per password?* Random data hashed together with the password. A unique salt means identical passwords produce different hashes, so an attacker must attack every hash separately and precomputed tables don't work.

---

## Step 10 — Sessions and tokens

**A.** Login creates a row in `auth_sessions` and returns two random tokens. The **access
token** (15 minutes) goes in `Authorization: Bearer …` on every request. The **refresh
token** gets a new pair when the access token expires. Only SHA-256 hashes of the tokens
are stored.

**B.** Users must stay logged in for a working day without re-typing passwords, and an
administrator must be able to cut off a stolen laptop **immediately**.

**C.** `src/auth/tokens.ts`, `src/auth/auth.service.ts` (`login`, `refresh`,
`authenticateAccessToken`), `src/auth/authenticator.ts`, `test/auth.e2e-spec.ts`

**D. Concepts**
- **Stateful sessions vs. stateless JWTs.** A JWT carries signed claims and the server trusts it until it expires, so revoking it needs extra machinery. Our opaque tokens are looked up in the database on every request: one indexed query, but logout, password change and account disable work instantly.
- **Short-lived access, longer-lived refresh.** A leaked access token is only useful for minutes.
- **Refresh rotation and reuse detection.** Each refresh token works exactly once. If an old one shows up again, two parties hold copies (one is a thief), so we revoke the whole session.
- **Why a fast hash is fine for tokens.** They have 256 bits of randomness. Unlike human passwords, there is nothing to guess.
- **Bearer header vs. cookies.** Headers are not sent automatically by browsers, so CSRF doesn't apply. The frontend must still protect tokens from XSS.

**E. Exercise.** Add `GET /v1/auth/sessions` that lists the current user's *active* sessions
(id, createdAt, lastRefreshedAt, expiresAt; never hashes). Add an e2e test that logging in
twice shows two sessions and that logout leaves one.

**F. Interview**
1. *Access token vs. refresh token?* The access token is short-lived and sent on every API call. The refresh token is longer-lived, used only at the token endpoint to obtain new access tokens, and so exposed far less often.
2. *How do you revoke a JWT before it expires?* You can't with the token alone. Options are short lifetimes plus refresh, a server-side denylist of token ids, or switching to server-side sessions (what we did) where revocation is a database update.

---

## Step 11 — Guards, decorators and role-based authorization

**A.** `OrganizationAccessGuard` runs before every organization-scoped controller method.
It authenticates (401), reads `X-Organization-Id` (400), and checks the membership plus
any `@RequireRoles('OWNER')` on the route (403).

**B.** Separation of duties: an analyst can load data, but only an owner can publish numbers
management will see. One company must never see another's figures.

**C.** `src/auth/organization-access.guard.ts`, `src/auth/organization-access.service.ts`,
`src/imports/imports.controller.ts`

**D. Concepts**
- **Guard.** A Nest class with `canActivate()`. If it throws or returns false, the controller never runs.
- **Metadata and `Reflector`.** `@RequireRoles(...)` attaches data to a method (`SetMetadata`). The guard reads it back with `reflector.getAllAndOverride`. This is how decorators "configure" generic code.
- **RBAC (role-based access control).** Permissions belong to roles; users get roles *per organization* through `memberships`.
- **Defense in depth.** The services check roles again, so the CLI and future callers can't bypass the guard.
- **401 vs. 403 vs. 404.** Unknown caller, known but not allowed, and "doesn't exist *for you*". Answering 404 for another tenant's batch avoids confirming that it exists.

**E. Exercise.** Make `GET /v1/imports/:batchId` hide the `issues` array from VIEWERs (they
see the summary and reconciliation only). Test both roles.

**F. Interview**
1. *Where should authorization be enforced?* On the server, as close to the data as practical, and consistently. Here that's the guard at the HTTP edge, the role check in services, and tenant filters in every query (plus database constraints). Never rely on the frontend hiding buttons.
2. *What is an IDOR vulnerability?* Insecure Direct Object Reference: the server trusts an id from the client without checking that the caller may access that object. For example, `/imports/<someone else's id>`. We prevent it by always querying with `id AND organization_id`, and we have a test for it.

---

## Step 12 — Protecting the API surface

**A.** Rate limits (10 login attempts per minute per IP), account lockout, security headers
(helmet), streaming upload limits, `Cache-Control: no-store` on token responses, and HTTP
endpoints for upload and publish built on the unchanged pipeline.

**B.** Once a login endpoint exists, bots *will* try passwords. Upload endpoints are a classic
path for memory exhaustion and malicious files.

**C.** `src/app.module.ts` (ThrottlerModule), `src/auth/auth-rate-limit.ts`, `src/app.setup.ts`
(helmet), `src/imports/imports.module.ts` (multer limits), `test/rate-limit.e2e-spec.ts`

**D. Concepts**
- **Rate limiting vs. lockout.** Rate limiting slows one *client*. Lockout protects one *account* from many clients. Both have trade-offs: lockout can be abused to annoy a user.
- **multipart/form-data.** The HTTP encoding for file uploads. Limits must apply *while streaming* so a 5 GB upload is cut off early.
- **Security headers.** CSP limits where scripts may come from; `nosniff` stops MIME guessing; `X-Frame-Options` blocks clickjacking; HSTS forces HTTPS (only meaningful once HTTPS exists, which is why it is production-only).
- **HTTP 429 Too Many Requests**, plus `Retry-After` headers.

**E. Exercise.** Write an e2e test (in its own file, like `rate-limit.e2e-spec.ts`, setting a
small `IMPORT_MAX_BYTES` before importing the app) that uploads a file just over the limit.
Check which status code multer produces, and explain why.

**F. Interview**
1. *Why is in-memory rate limiting insufficient for production?* Each instance counts separately and the counters vanish on restart. Behind a load balancer you need shared storage such as Redis, and behind a proxy you must use the real client IP (trusted `X-Forwarded-For`).
2. *Why return the same error for "unknown e-mail" and "wrong password"?* Distinct messages, or distinct timings, let attackers enumerate which e-mails have accounts, then focus attacks or phishing on them. We also spend equal hashing time on unknown users.
