import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRedirect } from '../src/lib/safeRedirect.ts';
test('rejects external and browser-normalized external destinations', () => {
  for (const value of ['//evil.example', '/\\evil.example', '/\n/evil.example', 'https://evil.example', 'javascript:alert(1)', null]) assert.equal(safeRedirect(value), '/account');
  assert.equal(safeRedirect('/account/arrival?code=synthetic'), '/account/arrival?code=synthetic');
  assert.equal(safeRedirect('/?doctor=synthetic&member=family'), '/?doctor=synthetic&member=family');
});
