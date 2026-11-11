import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localBootstrapUrl, bootstrapLocalDb } from '../scripts/bootstrap-local-db.mjs';

describe('startup never writes the database schema', () => {
  function run(kind: 'docker' | 'native', databaseUrl?: string, fail = false) {
    const dir = mkdtempSync(path.join(tmpdir(), 'medbook-start-test-'));
    try {
      // Intercept only the application process; real Node handles URL encoding.
      const capture = path.join(dir, 'capture.cjs');
      writeFileSync(capture, `
        const fs = require('node:fs');
        const {spawnSync} = require('node:child_process');
        if (process.argv[2] === '-e') {
          const r = spawnSync(process.execPath, process.argv.slice(2), {stdio:'inherit'});
          process.exit(r.status ?? 1);
        }
        fs.writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({args:process.argv.slice(2),url:process.env.DATABASE_URL}));
        process.exit(process.env.APP_EXIT === 'yes' ? 17 : 0);
      `);
      writeFileSync(path.join(dir, 'node'), '#!/bin/sh\nexec "$TEST_NODE" "$TEST_CAPTURE" "$@"\n', { mode: 0o755 });
      for (const executable of ['npx', 'prisma', 'psql']) {
        writeFileSync(path.join(dir, executable), '#!/bin/sh\necho "Unexpected schema command" >&2\nexit 91\n', { mode: 0o755 });
      }
      const output = path.join(dir, 'out.json');
      const env = { ...process.env, PATH: dir + path.delimiter + process.env.PATH,
        TEST_NODE: process.execPath, TEST_CAPTURE: capture, CAPTURE_FILE: output,
        DATABASE_URL: databaseUrl ?? '', POSTGRES_PASSWORD: 'synthetic:p@ss/word?#2026', APP_EXIT: fail ? 'yes' : 'no' };
      const script = kind === 'docker' ? ['docker-entrypoint.sh']
        : ['-c', JSON.parse(readFileSync('package.json', 'utf8')).scripts.start];
      const result = spawnSync('sh', script, { env, encoding: 'utf8' });
      expect(result.stderr).not.toContain('Unexpected schema command');
      expect(result.status).toBe(fail ? 17 : 0);
      return JSON.parse(readFileSync(output, 'utf8'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  it.each(['docker', 'native'] as const)('starts %s without Prisma/SQL or schema sync', kind => {
    const url = 'postgresql://synthetic:unused@localhost:5432/medbook?schema=public';
    expect(run(kind, url)).toEqual({ args: ['dist/index.js'], url });
  });
  it('preserves URL encoding when Compose provides a password separately', () => {
    const url = new URL(run('docker').url);
    expect(decodeURIComponent(url.password)).toBe('synthetic:p@ss/word?#2026');
    expect(url.hostname).toBe('postgres');
  });
  it('propagates application failure rather than falling back to schema changes', () => {
    run('docker', 'postgresql://test:unused@localhost:5432/medbook', true);
  });
});

describe('local bootstrap target boundary', () => {
  it('allows only the named local database', () => {
    expect(localBootstrapUrl('postgresql://test:unused@postgres:5432/medbook?schema=public')).toContain('@postgres:5432/medbook');
  });
  it.each([
    undefined, 'postgresql://test:unused@production.example/medbook',
    'postgresql://test:unused@localhost/production',
    'postgresql://test:unused@localhost/medbook?host=production.example',
    'postgresql://test:unused@localhost/medbook?schema=private',
    'postgresql://test:unused@localhost/medbook#fragment',
  ])('refuses invalid/remote targets before loading a database client', async value => {
    await expect(bootstrapLocalDb(value)).rejects.toThrow();
  });
});
