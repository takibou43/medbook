-- TEST ONLY: reverse this pilot, retain all test records.
DO $$ BEGIN
  IF current_database() <> 'medbook_rls_test' THEN RAISE EXCEPTION 'isolated RLS test database required'; END IF;
END $$;
DROP POLICY notification_owner ON notifications;
DROP POLICY notification_worker_insert ON notifications;
DROP POLICY notification_worker_select ON notifications;
DROP POLICY notification_worker_purge ON notifications;
DROP POLICY push_owner ON push_subscriptions;
DROP POLICY push_worker_read ON push_subscriptions;
ALTER TABLE notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON notifications, push_subscriptions FROM medbook_rls_runtime, medbook_rls_worker;
REVOKE UPDATE ("isRead") ON notifications FROM medbook_rls_runtime;
DROP FUNCTION medbook_security.active_user_id();
DROP SCHEMA medbook_security;
REVOKE ALL ON SCHEMA public FROM medbook_rls_runtime, medbook_rls_worker;
-- Restore the default schema USAGE privilege of this newly-created test DB.
GRANT USAGE ON SCHEMA public TO PUBLIC;
DROP ROLE medbook_rls_runtime;
DROP ROLE medbook_rls_worker;
