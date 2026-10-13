// The token exchange in auth/worker.js, with GitHub replaced by a stub.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const ENV = { GITHUB_CLIENT_ID: 'Iv1.client', GITHUB_CLIENT_SECRET: 'secret', ORIGINS: 'https://public-observatory.github.io http://localhost:8000' };
const SITE = 'https://public-observatory.github.io';

async function call({ method = 'POST', path = '/token', origin = SITE, body } = {}) {
  const { default: worker } = await import(pathToFileURL(resolve(__dirname, '../auth/worker.js')));
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url, ...init, body: JSON.parse(init.body) });
    return new Response('{"access_token":"t","refresh_token":"r"}', { status: 200 });
  };
  try {
    const headers = { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) };
    const request = new Request(`https://auth.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response: await worker.fetch(request, ENV), sent };
  } finally {
    globalThis.fetch = real;
  }
}

test('a code is exchanged with the client secret', async () => {
  const { response, sent } = await call({ body: { code: 'abc' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { access_token: 't', refresh_token: 'r' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://github.com/login/oauth/access_token');
  assert.deepEqual(sent[0].body, { client_id: 'Iv1.client', client_secret: 'secret', code: 'abc' });
});

test('a refresh token is exchanged for a new token', async () => {
  const { response, sent } = await call({ origin: 'http://localhost:8000', body: { refresh_token: 'old' } });
  assert.equal(response.status, 200);
  assert.deepEqual(sent[0].body, { client_id: 'Iv1.client', client_secret: 'secret', grant_type: 'refresh_token', refresh_token: 'old' });
});

test('another site may not use the secret', async () => {
  for (const origin of ['https://evil.example', null]) {
    const { response, sent } = await call({ origin, body: { code: 'abc' } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(sent.length, 0);
  }
  const { response } = await call({ method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(response.status, 403);
});

test('a preflight from the site is answered', async () => {
  const { response } = await call({ method: 'OPTIONS' });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST');
});

test('anything else is refused without calling GitHub', async () => {
  for (const [options, status] of [[{ path: '/' , body: { code: 'abc' } }, 404], [{ method: 'GET' }, 405],
    [{ body: {} }, 400], [{ body: { code: 7 } }, 400], [{ body: null }, 400]]) {
    const { response, sent } = await call(options);
    assert.equal(response.status, status, JSON.stringify(options));
    assert.equal(sent.length, 0);
  }
});
