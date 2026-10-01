-- TEST ONLY. Not a production migration and not part of Prisma migrate deploy.
-- Pilot scope: notifications + push subscriptions. All other tables are OUT OF SCOPE.
DO $$ BEGIN
  IF current_database() <> 'medbook_rls_test' THEN RAISE EXCEPTION 'isolated RLS test database required'; END IF;
  CREATE ROLE medbook_rls_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  CREATE ROLE medbook_rls_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO medbook_rls_runtime, medbook_rls_worker;
CREATE SCHEMA medbook_security;
REVOKE ALL ON SCHEMA medbook_security FROM PUBLIC;
GRANT USAGE ON SCHEMA medbook_security TO medbook_rls_runtime;
CREATE FUNCTION medbook_security.active_user_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT id FROM public.users
  WHERE id = NULLIF(current_setting('medbook.user_id', true), '') AND "isActive" = true
$$;
REVOKE ALL ON FUNCTION medbook_security.active_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION medbook_security.active_user_id() TO medbook_rls_runtime;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;

GRANT SELECT, DELETE ON notifications TO medbook_rls_runtime;
GRANT UPDATE ("isRead") ON notifications TO medbook_rls_runtime;
-- User notifications are produced by a separate worker; clients cannot author them.
GRANT INSERT, SELECT ON notifications TO medbook_rls_worker;
GRANT DELETE ON notifications TO medbook_rls_worker;
CREATE POLICY notification_owner ON notifications TO medbook_rls_runtime
  USING ("userId" = medbook_security.active_user_id())
  WITH CHECK ("userId" = medbook_security.active_user_id());
CREATE POLICY notification_worker_insert ON notifications FOR INSERT TO medbook_rls_worker WITH CHECK (true);
CREATE POLICY notification_worker_select ON notifications FOR SELECT TO medbook_rls_worker USING (true);
CREATE POLICY notification_worker_purge ON notifications FOR DELETE TO medbook_rls_worker
  USING ("expiresAt" IS NOT NULL AND "expiresAt" <= CURRENT_TIMESTAMP);

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO medbook_rls_runtime;
GRANT SELECT ON push_subscriptions TO medbook_rls_worker;
CREATE POLICY push_owner ON push_subscriptions TO medbook_rls_runtime
  USING ("userId" = medbook_security.active_user_id())
  WITH CHECK ("userId" = medbook_security.active_user_id());
CREATE POLICY push_worker_read ON push_subscriptions FOR SELECT TO medbook_rls_worker USING (true);
-- No role memberships, CREATE, TRUNCATE, migrations, or owner privileges granted.
