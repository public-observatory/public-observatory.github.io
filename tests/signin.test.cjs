// Signing in, and the private agendas a signed-in visitor sees, on the actual pages with GitHub replaced by a stub.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInContext } = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = 'https://public-observatory.github.io/';
const API = 'https://api.github.com';

const agendaOf = (repo, title) => ({
  repo, url: `https://github.com/${repo}`, pushed: '2026-10-06T00:00:00Z', questions: [], claims: [], readme: null,
  agenda: { title, kind: 'open-agenda', question: `What of ${title}?`, summary: '', created: '2026-10-01T00:00:00Z', maintainers: ['alice'] },
  summary: { questions: 0, answered: 0, claims: 0, contributors: 0 },
});
const repoOf = (full_name, topics = ['observatory-agenda'], priv = true) => ({ full_name, private: priv, topics });

// GitHub as one visitor sees it: one installation of the App, on four repositories.
function github() {
  return {
    'agendas.json': { agendas: [agendaOf('Lab/open', 'Open'), agendaOf('Lab/both', 'Both, public')] },
    'content/index.md': '# The Observatory',
    [`${API}/user`]: { login: 'alice' },
    [`${API}/user/installations?per_page=100&page=1`]: { installations: [{ id: 1 }] },
    [`${API}/user/installations/1/repositories?per_page=100&page=1`]: { repositories: [
      repoOf('Lab/secret'), repoOf('Lab/both'), repoOf('Lab/notopic', []), repoOf('Lab/liar'), repoOf('Lab/public', ['observatory-agenda'], false)] },
    [`${API}/repos/Lab/secret/contents/entry.json?ref=observatory`]: agendaOf('Lab/secret', 'Secret'),
    [`${API}/repos/Lab/both/contents/entry.json?ref=observatory`]: agendaOf('Lab/both', 'Both, private'),
    [`${API}/repos/Lab/liar/contents/entry.json?ref=observatory`]: agendaOf('Lab/secret', 'Impostor'),
  };
}

// Opens a page of the site at `url`, with `routes` answering its requests: a value, or a function of the request giving [status, value].
async function open(file, url, routes, { session = {}, local = {} } = {}) {
  const console = new VirtualConsole();
  const warnings = [];
  console.on('warn', (m) => warnings.push(m));
  console.on('error', (m) => warnings.push(String(m)));
  const html = readFileSync(resolve(__dirname, '../site', file), 'utf8');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: console });
  // jsdom shares storage between windows of one origin; each visit here starts from none.
  dom.window.sessionStorage.clear();
  dom.window.localStorage.clear();
  for (const [k, v] of Object.entries(session)) dom.window.sessionStorage.setItem(k, v);
  for (const [k, v] of Object.entries(local)) dom.window.localStorage.setItem(k, v);
  const calls = [];
  dom.window.fetch = async (u, init = {}) => {
    const key = String(u).startsWith(SITE) ? String(u).slice(SITE.length) : String(u);
    calls.push({ url: key, init });
    const route = routes[key];
    const [status, body] = typeof route === 'function' ? route(init) : route === undefined ? [404, { message: 'Not Found' }] : [200, route];
    return { ok: status < 300, status, json: async () => structuredClone(body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  for (const match of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    if (match[1].startsWith('https:')) continue;
    await runInContext(readFileSync(resolve(__dirname, '../site', match[1]), 'utf8'), dom.getInternalVMContext());
  }
  return { dom, doc: dom.window.document, calls, warnings };
}

test('a signed-in visitor sees the private agendas they can read, marked as such', async () => {
  const { dom, doc, calls, warnings } = await open('index.html', SITE, github(), { session: { 'observatory.token': 'tok' } });
  try {
    const titles = [...doc.querySelectorAll('.entry h3')].map((e) => e.textContent).sort();
    // The public index wins over a private copy; a repository without the topic, a public one, and an
    // entry that names another repository are all left out.
    assert.deepEqual(titles, ['Both, public', 'Open', 'Secret']);
    const secret = [...doc.querySelectorAll('.entry')].find((e) => e.textContent.includes('Secret'));
    assert.equal(secret.querySelector('.badge.private').textContent, 'Private');
    assert.equal(doc.querySelectorAll('.badge.private').length, 1);
    assert.ok(warnings.some((w) => /Lab\/liar.*names Lab\/secret/.test(w)));
    for (const c of calls.filter((c) => c.url.startsWith(API))) assert.equal(c.init.headers.Authorization, 'Bearer tok');
    assert.equal(doc.querySelector('nav.site button.signin').textContent, 'alice · Sign out');
    assert.ok(JSON.parse(dom.window.sessionStorage.getItem('observatory.private')).length === 2);
    assert.equal(dom.window.localStorage.getItem('observatory.private'), null);
  } finally { dom.window.close(); }
});

test('a visitor who is not signed in asks GitHub nothing', async () => {
  const { dom, doc, calls } = await open('index.html', SITE, github());
  try {
    assert.equal(doc.querySelectorAll('.entry').length, 2);
    assert.deepEqual(calls.filter((c) => !c.url.endsWith('.json') && !c.url.endsWith('.md')), []);
    // Until the App and the exchange are configured, no one is offered sign-in.
    assert.equal(doc.querySelector('nav.site button.signin'), null);
  } finally { dom.window.close(); }
});

test('a private agenda has its own page for those who can read it', async () => {
  const url = `${SITE}agenda.html?repo=Lab/secret`;
  let { dom, doc } = await open('agenda.html', url, github(), { session: { 'observatory.token': 'tok' } });
  try {
    assert.equal(doc.querySelector('h1').textContent, 'Secret');
    assert.equal(doc.querySelector('.agenda-head .badge').textContent, 'Open agenda · Private');
  } finally { dom.window.close(); }
  ({ dom, doc } = await open('agenda.html', url, github()));
  try {
    assert.equal(doc.querySelector('#main .empty').textContent, 'This agenda is not in the public index.');
  } finally { dom.window.close(); }
});

test('an expired token is renewed once for all requests, and a refused renewal signs out', async () => {
  const routes = github();
  let exchanges = 0;
  routes[''] = (init) => { exchanges++; return [200, JSON.parse(init.body).refresh_token === 'r1' ? { access_token: 'tok2', refresh_token: 'r2' } : { error: 'bad_refresh_token' }]; };
  for (const key of Object.keys(routes).filter((k) => k.startsWith(API))) {
    const value = routes[key];
    routes[key] = (init) => (init.headers.Authorization === 'Bearer tok2' ? [200, value] : [401, { message: 'Bad credentials' }]);
  }
  let { dom, doc } = await open('index.html', SITE, routes, { session: { 'observatory.token': 'old' }, local: { 'observatory.refresh': 'r1' } });
  try {
    assert.equal(exchanges, 1);
    assert.equal(dom.window.localStorage.getItem('observatory.refresh'), 'r2');
    assert.ok([...doc.querySelectorAll('.entry h3')].some((e) => e.textContent === 'Secret'));
  } finally { dom.window.close(); }
  ({ dom, doc } = await open('index.html', SITE, routes, { local: { 'observatory.refresh': 'stale' } }));
  try {
    assert.equal(dom.window.localStorage.getItem('observatory.refresh'), null);
    assert.equal(doc.querySelectorAll('.entry').length, 2);
  } finally { dom.window.close(); }
});

test('GitHub\'s return is accepted only with the state this browser sent', async () => {
  const routes = github();
  const sent = [];
  routes[''] = (init) => { sent.push(JSON.parse(init.body)); return [200, { access_token: 'tok', refresh_token: 'r1' }]; };
  const back = `${SITE}?q=primes`;
  let { dom } = await open('index.html', `${SITE}?q=primes&code=c1&state=s1`, routes, { session: { 'observatory.state': 's1', 'observatory.back': back } });
  try {
    assert.deepEqual(sent, [{ code: 'c1' }]);
    assert.equal(dom.window.location.href, back);
    assert.equal(dom.window.localStorage.getItem('observatory.refresh'), 'r1');
    assert.equal(dom.window.sessionStorage.getItem('observatory.state'), null);
  } finally { dom.window.close(); }
  sent.length = 0;
  ({ dom } = await open('index.html', `${SITE}?code=c2&state=forged`, routes, { session: { 'observatory.state': 's1' } }));
  try {
    assert.deepEqual(sent, []);
    assert.equal(dom.window.location.href, SITE);
    assert.equal(dom.window.localStorage.getItem('observatory.refresh'), null);
  } finally { dom.window.close(); }
});
