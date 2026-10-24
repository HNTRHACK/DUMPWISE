CREATE TABLE import_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  description varchar(1000) NOT NULL,
  source_type varchar(40) NOT NULL DEFAULT 'SAP_BILLING_CSV' CHECK (source_type = 'SAP_BILLING_CSV'),
  version integer NOT NULL CHECK (version > 0),
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED')),
  mapping jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  rules_version varchar(80) NOT NULL DEFAULT 'sap-billing-signs-v1' CHECK (rules_version = 'sap-billing-signs-v1'),
  created_by_user_id uuid NOT NULL,
  approved_by_user_id uuid,
  approved_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name, version),
  CHECK ((status = 'DRAFT' AND approved_at IS NULL AND approved_by_user_id IS NULL)
    OR (status = 'APPROVED' AND approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
);

ALTER TABLE import_template_versions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_template_versions
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());

-- Mapping meaning is immutable from creation, not merely after the first import.
CREATE FUNCTION protect_import_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','approved_at','approved_by_user_id']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','approved_at','approved_by_user_id'])
     OR OLD.status <> 'DRAFT' OR NEW.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Template versions are immutable; create a new version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_template_immutable BEFORE UPDATE ON import_template_versions
  FOR EACH ROW EXECUTE FUNCTION protect_import_template_version();

ALTER TABLE import_batches ADD COLUMN template_version_id uuid,
  ADD COLUMN rules_version varchar(80) NOT NULL DEFAULT 'sap-billing-signs-v1';
ALTER TABLE import_batches ADD CONSTRAINT import_batches_template_tenant_fkey
  FOREIGN KEY (organization_id, template_version_id)
  REFERENCES import_template_versions(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION protect_batch_mapping_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
     OR NEW.rules_version IS DISTINCT FROM OLD.rules_version THEN
    RAISE EXCEPTION 'Batch mapping provenance is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER batch_mapping_immutable BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION protect_batch_mapping_provenance();
