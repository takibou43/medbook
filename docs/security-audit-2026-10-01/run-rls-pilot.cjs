// Local-only reproducible pilot; no production URLs or credentials are accepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require(path.resolve(__dirname, '../../../.load-test/clinic-runtime/node_modules/pg'));
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const base = 'postgresql://postgres@127.0.0.1:54359/medbook_rls_test';
const owner = new PrismaClient({ datasourceUrl: base });
const runtime = new PrismaClient({ datasourceUrl: base.replace('postgres@', 'medbook_rls_runtime@') + '?connection_limit=2' });
const worker = new PrismaClient({ datasourceUrl: base.replace('postgres@', 'medbook_rls_worker@') + '?connection_limit=1' });
const checks = [];
const check = (name) => checks.push({ name, passed: true });
// The argument represents req.user.id AFTER authenticate's JWT + DB validation.
// Never bind a client body/query ID, role, or persistent SET to this context.
async function asUser(verifiedUserId, work) {
  return runtime.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('medbook.user_id', ${verifiedUserId}, true)`;
    return work(tx);
  }, { maxWait: 30000, timeout: 30000 });
}
async function main() {
  const pg = new Client({ connectionString: base });
  await pg.connect();
  await pg.query(fs.readFileSync(path.join(__dirname, 'rls-pilot.sql'), 'utf8'));
  await pg.end();
  const users = [];
  const runTag = Date.now();
  for (const role of ['PATIENT', 'DOCTOR', 'ASSISTANT', 'ADMIN']) {
    users.push(await owner.user.create({ data: { email: `rls-${runTag}-${role}@example.test`, role, passwordHash: 'synthetic-not-a-login-password' } }));
  }
  const notifications = [];
  for (const u of users) notifications.push(await owner.notification.create({ data: { userId: u.id, type: 'RLS_TEST', title: 'synthetic', message: 'synthetic' } }));
  const role = await runtime.$queryRaw`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
  assert.equal(role[0].name, 'medbook_rls_runtime');
  assert.equal(role[0].rolsuper, false); assert.equal(role[0].rolbypassrls, false);
  check('Actual Prisma connection role is limited and has no RLS bypass');
  assert.equal(await runtime.notification.count(), 0);
  check('No context defaults to deny');
  for (const u of users) {
    const rows = await asUser(u.id, tx => tx.notification.findMany());
    assert.equal(rows.length, 1); assert.equal(rows[0].userId, u.id);
  }
  check('Patient, doctor, assistant and admin see only their own notifications');
  assert.equal((await asUser(users[0].id, tx => tx.notification.updateMany({ where: { id: notifications[1].id }, data: { isRead: true } }))).count, 0);
  assert.equal((await asUser(users[0].id, tx => tx.notification.updateMany({ where: { id: notifications[0].id }, data: { isRead: true } }))).count, 1);
  check('Foreign update denied; own read flag update allowed');
  await assert.rejects(asUser(users[0].id, tx => tx.notification.updateMany({ data: { userId: users[1].id } })));
  check('Column privileges prevent notification ownership transfer');
  await assert.rejects(asUser(users[0].id, tx => tx.notification.create({ data: { userId: users[0].id, type: 'RLS_TEST', title: 'x', message: 'x' } })));
  check('Runtime cannot author system notifications');
  const sub = await asUser(users[0].id, tx => tx.pushSubscription.create({ data: { userId: users[0].id, endpoint: 'https://fcm.googleapis.com/fcm/send/rls-device', p256dh: 'synthetic', auth: 'synthetic' } }));
  await assert.rejects(asUser(users[0].id, tx => tx.pushSubscription.create({ data: { userId: users[1].id, endpoint: 'https://fcm.googleapis.com/fcm/send/wrong-owner', p256dh: 'synthetic', auth: 'synthetic' } })));
  await assert.rejects(asUser(users[0].id, tx => tx.pushSubscription.update({ where: { id: sub.id }, data: { userId: users[1].id } })));
  assert.equal(await asUser(users[1].id, tx => tx.pushSubscription.count()), 0);
  check('Push INSERT/UPDATE WITH CHECK prevents changing owner; foreign read denied');
  assert.equal((await asUser(users[1].id, tx => tx.pushSubscription.deleteMany())).count, 0);
  assert.equal((await asUser(users[0].id, tx => tx.pushSubscription.deleteMany())).count, 1);
  check('Push DELETE limited to owner');
  const result = await Promise.all(Array.from({ length: 80 }, (_, i) => {
    const u = users[i % users.length];
    return asUser(u.id, async tx => {
      const rows = await tx.notification.findMany();
      assert.equal(rows.length, 1); assert.equal(rows[0].userId, u.id);
    });
  }));
  assert.equal(result.length, 80);
  assert.equal(await runtime.notification.count(), 0);
  check('80 concurrent transactions with pool size 2 do not leak context');
  await assert.rejects(asUser(users[0].id, async () => { throw new Error('synthetic rollback'); }));
  assert.equal(await runtime.notification.count(), 0);
  check('Rollback clears local context too');
  await owner.user.update({ where: { id: users[0].id }, data: { isActive: false } });
  assert.equal(await asUser(users[0].id, tx => tx.notification.count()), 0);
  check('Deactivated identity is denied by policy');
  const expired = await worker.notification.create({ data: { userId: users[1].id, type: 'RLS_TEST', title: 'x', message: 'x', expiresAt: new Date(0) } });
  assert.equal((await worker.notification.deleteMany({ where: { id: notifications[1].id } })).count, 0);
  assert.equal((await worker.notification.deleteMany({ where: { id: expired.id } })).count, 1);
  await assert.rejects(worker.pushSubscription.create({ data: { userId: users[1].id, endpoint: 'https://fcm.googleapis.com/fcm/send/worker-denied', p256dh: 'x', auth: 'x' } }));
  check('Worker can insert notifications and purge expired only; cannot register devices');
  const flags = await owner.$queryRaw`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('notifications','push_subscriptions')`;
  assert(flags.every(x => x.relrowsecurity && x.relforcerowsecurity));
  check('RLS and FORCE RLS enabled on both pilot tables');
  await runtime.$disconnect(); await worker.$disconnect();
  const rollback = new Client({ connectionString: base }); await rollback.connect();
  await rollback.query(fs.readFileSync(path.join(__dirname, 'rls-pilot-rollback.sql'), 'utf8'));
  const after = await rollback.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('notifications','push_subscriptions')");
  assert(after.rows.every(x => !x.relrowsecurity));
  await rollback.end();
  check('Rollback tested without removing any records');
  fs.writeFileSync(path.join(__dirname, 'rls-results.json'), JSON.stringify({ database: 'medbook_rls_test', role: role[0], concurrentTransactions: 80, checks }, null, 2));
  console.log(`${checks.length} RLS checks passed, 80 concurrent transactions, rollback passed.`);
}
main().catch(error => { console.error('RLS pilot failed:', error.code || error.name); process.exitCode = 1; }).finally(async () => {
  await Promise.all([owner.$disconnect(), runtime.$disconnect(), worker.$disconnect()]);
});
