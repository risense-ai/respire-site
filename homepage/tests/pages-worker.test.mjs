import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = 'const consoleHosts = {}; const consoleBuild = {};\n' + readFileSync(new URL('../../scripts/pages-worker.mjs', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const env = { ASSETS: { async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/404.html') return new Response(null, { status: 301, headers: { Location: '/404' } });
  return new Response(request.method === 'HEAD' ? null : path === '/404' ? 'Page not found' : 'Homepage', { headers: { 'Content-Type': 'text/html' } });
} } };
for (const path of ['/404', '/404.html', '/missing', '/llms-full.txt']) {
  test(`${path} returns the error body without a canonical redirect`, async () => {
    const response = await worker.fetch(new Request(`https://example.com${path}`), env);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('location'), null);
    assert.equal(await response.text(), 'Page not found');
  });
}
test('homepage remains successful and HEAD errors have no body', async () => {
  assert.equal((await worker.fetch(new Request('https://example.com/'), env)).status, 200);
  const response = await worker.fetch(new Request('https://example.com/404.html', { method: 'HEAD' }), env);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '');
});
