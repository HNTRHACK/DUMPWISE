-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "last_seen_at" TIMESTAMPTZ(3),
ADD COLUMN     "user_agent" VARCHAR(200);

-- CreateTable
CREATE TABLE "user_login_sources" (
    "user_id" UUID NOT NULL,
    "source_hash" CHAR(64) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_login_sources_pkey" PRIMARY KEY ("user_id","source_hash")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" VARCHAR(160) NOT NULL,
    "hits" INTEGER NOT NULL,
    "window_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3),

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_buckets_window_expires_at_idx" ON "rate_limit_buckets"("window_expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "user_login_sources" ADD CONSTRAINT "user_login_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Hand-written: PostgreSQL ROW-LEVEL SECURITY for multi-tenant isolation.
--
-- Tenant context = two TRANSACTION-LOCAL settings written by the API at the start of every
-- organization-scoped transaction (src/prisma/tenant-db.service.ts):
--     SELECT set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true)
-- "true" = local to the transaction, so a pooled connection never carries one tenant's context
-- into another request. Missing context -> NULL -> policies match nothing (fail closed).
--
-- Policies apply to every non-superuser role without BYPASSRLS (i.e. the API role
-- dumpwise_app). Superusers (migrations) bypass RLS; the provisioning role gets BYPASSRLS
-- but has no privileges on financial tables (scripts/setup-db-roles.ts).
-- ===========================================================================================

CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Tenant-owned business data: only the current organization, for reads AND writes.
ALTER TABLE "import_batches"         ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "products"               ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "distributors"           ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "customers"              ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "sales_transactions"     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_results" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "import_batches"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON "products"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON "distributors"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON "customers"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON "sales_transactions"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON "reconciliation_results"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());

-- Memberships: rows of the current organization, or the caller's own memberships
-- (needed for "which organizations do I belong to?"). Read-only for the API role.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_visibility ON "memberships" FOR SELECT
  USING (organization_id = app_current_org() OR user_id = app_current_user());

-- Organizations: the current one, or any the caller is a member of. Read-only for the API role.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_visibility ON "organizations" FOR SELECT
  USING (
    id = app_current_org()
    OR EXISTS (SELECT 1 FROM "memberships" m WHERE m.organization_id = "organizations".id AND m.user_id = app_current_user())
  );

-- Audit log: read your organization's events or your own security events; write events for
-- the current organization or organization-less security events. (No UPDATE/DELETE grants.)
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON "audit_events" FOR SELECT
  USING (organization_id = app_current_org() OR (organization_id IS NULL AND actor_user_id = app_current_user()));
CREATE POLICY audit_write ON "audit_events" FOR INSERT
  WITH CHECK (organization_id IS NULL OR organization_id = app_current_org());

-- Guardrails for the new tables.
ALTER TABLE "rate_limit_buckets" ADD CONSTRAINT "rate_limit_buckets_hits_check" CHECK (hits >= 0);
ALTER TABLE "user_login_sources" ADD CONSTRAINT "user_login_sources_hash_check" CHECK (source_hash ~ '^[0-9a-f]{64}$');
