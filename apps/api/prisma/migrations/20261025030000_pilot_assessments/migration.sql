CREATE TABLE pilot_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL,
  manual_minutes numeric(8,2) NOT NULL CHECK(manual_minutes BETWEEN 0 AND 10080),
  automated_minutes numeric(8,2) NOT NULL CHECK(automated_minutes BETWEEN 0 AND 10080),
  reviewed boolean NOT NULL,
  discrepancies jsonb NOT NULL CHECK(jsonb_typeof(discrepancies)='array'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(organization_id,report_id) REFERENCES report_snapshots(organization_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX pilot_assessments_org_report_created_idx ON pilot_assessments(organization_id,report_id,created_at);
ALTER TABLE pilot_assessments ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pilot_assessments
  USING(organization_id=app_current_org()) WITH CHECK(organization_id=app_current_org());
