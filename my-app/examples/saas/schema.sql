-- #region schema
CREATE TABLE tenants (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro'))
);

CREATE TABLE projects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name      text NOT NULL
);

-- Most queries filter by tenant, so the tenant comes first in the index.
CREATE INDEX projects_tenant ON projects (tenant_id);
-- #endregion

-- #region rls
-- The application connects as this role. It must not own the tables and must
-- not be a superuser, because superusers skip row level security entirely.
CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_user;
GRANT SELECT ON tenants TO app_user;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- FORCE applies the policy to the table owner as well.
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

-- USING filters what can be read. WITH CHECK guards what can be written.
-- After a transaction ends, a transaction-local setting reads as an empty
-- string, and ''::uuid is an error. NULLIF turns it into NULL, and a NULL
-- comparison matches no rows, so a forgotten tenant sees nothing at all.
CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- #endregion
