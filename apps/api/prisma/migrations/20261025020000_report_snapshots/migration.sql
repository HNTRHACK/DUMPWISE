CREATE TABLE report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  configuration jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  xlsx bytea NOT NULL,
  pptx bytea NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz(3) NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  CHECK (octet_length(xlsx) BETWEEN 1 AND 16777216),
  CHECK (octet_length(pptx) BETWEEN 1 AND 16777216),
  CHECK (expires_at > created_at)
);
CREATE INDEX report_snapshots_org_created_idx ON report_snapshots(organization_id,created_at);
ALTER TABLE report_snapshots ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON report_snapshots
  USING (organization_id=app_current_org()) WITH CHECK (organization_id=app_current_org());

-- No UPDATE/DELETE runtime grants: only complete exports can become visible.
