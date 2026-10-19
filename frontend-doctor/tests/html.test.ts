import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/lib/html.ts';
test('print text cannot introduce executable markup and preserves Arabic', () => {
  assert.equal(escapeHtml('<script>window.marker=1</script>'), '&lt;script&gt;window.marker=1&lt;/script&gt;');
  assert.equal(escapeHtml('د. أمين & "اسم"'), 'د. أمين &amp; &quot;اسم&quot;');
  assert.equal(escapeHtml("'<img onerror='x'>"), '&#39;&lt;img onerror=&#39;x&#39;&gt;');
});
