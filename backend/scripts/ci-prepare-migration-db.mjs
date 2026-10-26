// Candidate replay only: never changes the production migration directory/startup.
import { mkdtempSync, cpSync, copyFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

export function validateTestUrl(env) {
  assert(env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
  const url = new URL(env.TEST_DATABASE_URL);
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL only');
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local test databases only');
  assert(['/medbook_security_test', '/medbook_load_test'].includes(url.pathname), 'Unexpected test database');
  assert(!env.DATABASE_URL || env.DATABASE_URL === env.TEST_DATABASE_URL, 'DATABASE_URL must match TEST_DATABASE_URL');
  for (const key of url.searchParams.keys()) assert(key === 'schema', 'Unexpected connection option');
  assert(!url.searchParams.has('schema') || url.searchParams.get('schema') === 'public', 'public schema only');
  assert(!url.hash, 'URL fragments are not allowed');
  return url.toString();
}

async function main() {
  const databaseUrl = validateTestUrl(process.env);
  const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const prismaRoot = path.resolve(backend, '../prisma');
  const candidate = path.join(prismaRoot, 'migration-candidate/migrations');
  // Load the client only after validating the URL, to keep invalid-target tests offline.
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let stage;
  const run = (args) => {
    const result = spawnSync(process.execPath, [path.join(backend, 'node_modules/prisma/build/index.js'), ...args], {
      cwd: backend, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
    });
    assert.equal(result.status, 0, `Prisma ${args[0]} ${args[1]} failed`);
  };
  try {
    const [{ name }] = await db.$queryRaw`SELECT current_database() AS name`;
    assert.equal(name, new URL(databaseUrl).pathname.slice(1), 'Connected to unexpected database');
    const [{ count }] = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relkind IN ('r','p','v','m','S','f')`;
    assert.equal(count, 0, 'Replay requires an EMPTY test database; no reset/drop is performed');
    stage = mkdtempSync(path.join(tmpdir(), 'medbook-migration-replay-'));
    copyFileSync(path.join(prismaRoot, 'schema.prisma'), path.join(stage, 'schema.prisma'));
    cpSync(candidate, path.join(stage, 'migrations'), { recursive: true });
    const schema = path.join(stage, 'schema.prisma');
    await db.$disconnect();
    run(['migrate', 'deploy', '--schema', schema]);
    run(['migrate', 'status', '--schema', schema]);
    const ledger = () => db.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM "_prisma_migrations" ORDER BY migration_name`;
    const before = await ledger();
    const expected = readdirSync(candidate, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort();
    assert.deepEqual(before.map(x => x.migration_name), expected);
    assert(before.every(x => x.finished_at && !x.rolled_back_at), 'Unfinished migration');
    await db.$disconnect();
    run(['migrate', 'deploy', '--schema', schema]);
    assert.deepEqual(await ledger(), before, 'Second deploy changed migration history');
    await db.$disconnect();
    run(['migrate', 'diff', '--from-url', databaseUrl, '--to-schema-datamodel', path.join(prismaRoot, 'schema.prisma'), '--exit-code']);
    // Prisma diff ignores CHECK constraints and triggers: inspect those separately.
    const sql = readFileSync(path.join(candidate, '00000000000001_guards/migration.sql'), 'utf8');
    const checks = [...sql.matchAll(/ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"\s+CHECK/g)].map(m => `${m[1]}.${m[2]}`).sort();
    const actual = await db.$queryRaw`SELECT t.relname AS tab, c.conname AS name, c.convalidated AS valid
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND c.contype='c'`;
    assert.deepEqual(actual.map(x => `${x.tab}.${x.name}`).sort(), checks);
    assert(actual.every(x => x.valid), 'Unvalidated CHECK');
    const functions = await db.$queryRaw`SELECT p.proname AS name, p.prosrc AS body FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`;
    for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/g)) {
      assert.equal(functions.find(x => x.name === m[1])?.body.trim(), m[2].trim(), `Wrong function: ${m[1]}`);
    }
    const triggers = await db.$queryRaw`SELECT t.tgname AS name, t.tgenabled AS enabled,
      pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`;
    const normalize = s => s.replace(/public\./g, '').replace(/[";\s]/g, '').toLowerCase();
    const expectedTriggers = [...sql.matchAll(/CREATE TRIGGER[\s\S]*?;/g)].map(m => normalize(m[0])).sort();
    assert.deepEqual(triggers.map(x => normalize(x.definition)).sort(), expectedTriggers);
    assert(triggers.every(x => x.enabled === 'O'), 'Disabled trigger');
    console.log(`Replay verified: ${before.length} migrations, ${checks.length} CHECKs, ${triggers.length} triggers; schema matches.`);
  } finally {
    await db.$disconnect();
    if (stage) rmSync(stage, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
