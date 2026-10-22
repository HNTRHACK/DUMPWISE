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
