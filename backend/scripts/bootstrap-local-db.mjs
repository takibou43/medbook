// Explicit, one-time provisioning of an EMPTY local Compose database only.
// Never adopts production migration history or changes an existing database.
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function localBootstrapUrl(value) {
  assert(value, 'DATABASE_URL is required');
  const url = new URL(value);
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL only');
  assert(['postgres', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local Compose database only');
  assert.equal(url.pathname, '/medbook', 'Only the local medbook database can be initialized');
  assert(!url.hash, 'Fragments are not allowed');
  for (const [key, value] of url.searchParams) {
    assert(key === 'schema' && value === 'public', 'Only the public schema option is allowed');
  }
  return url.toString();
}

export async function bootstrapLocalDb(value) {
  const databaseUrl = localBootstrapUrl(value);
  const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  let stage;
  try {
    const [{ count }] = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relkind IN ('r','p','v','m','S','f')`;
    assert.equal(count, 0, 'Database must be EMPTY; no reset, adoption or schema sync is performed');
    stage = mkdtempSync(path.join(tmpdir(), 'medbook-local-init-'));
    copyFileSync(path.join(backend, '../prisma/schema.prisma'), path.join(stage, 'schema.prisma'));
    cpSync(path.join(backend, '../prisma/migration-candidate/migrations'), path.join(stage, 'migrations'), { recursive: true });
    const result = spawnSync(process.execPath, [path.join(backend, 'node_modules/prisma/build/index.js'),
      'migrate', 'deploy', '--schema', path.join(stage, 'schema.prisma')], {
      cwd: backend, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
    });
    assert.equal(result.status, 0, 'Local database initialization failed');
  } finally {
    await db.$disconnect();
    if (stage) rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bootstrapLocalDb(process.env.DATABASE_URL).catch(error => {
    // Prisma errors can contain connection details; do not print raw objects.
    console.error(error instanceof assert.AssertionError ? error.message : 'Local initialization failed; inspect the local database configuration.');
    process.exitCode = 1;
  });
}
