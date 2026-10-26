import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTestUrl } from './ci-prepare-migration-db.mjs';
const local = 'postgresql://test:test@127.0.0.1:5432/medbook_security_test?schema=public';
test('accepts only the two disposable local databases', () => {
  assert.equal(validateTestUrl({ TEST_DATABASE_URL: local }), local);
  assert(validateTestUrl({ TEST_DATABASE_URL: local.replace('security', 'load') }));
});
for (const [label, env] of [
  ['missing URL', {}],
  ['remote host', { TEST_DATABASE_URL: local.replace('127.0.0.1', 'production.neon.tech') }],
  ['production name', { TEST_DATABASE_URL: local.replace('medbook_security_test', 'medbook') }],
  ['different database URL', { TEST_DATABASE_URL: local, DATABASE_URL: local.replace('security', 'load') }],
  ['host override', { TEST_DATABASE_URL: local + '&host=remote.example' }],
  ['other schema', { TEST_DATABASE_URL: local.replace('schema=public', 'schema=other') }],
  ['other protocol', { TEST_DATABASE_URL: local.replace('postgresql:', 'https:') }],
]) test(`rejects ${label} before connecting`, () => assert.throws(() => validateTestUrl(env)));
