const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInContext } = require('node:vm');
const { JSDOM } = require('jsdom');

async function render(text, questions = []) {
  const dom = new JSDOM('<body data-page="agenda"><main id="main"></main></body>', {
    url: 'https://observatory.example/agenda.html?repo=Lab/relu-fibres',
    runScripts: 'outside-only',
  });
  const entry = {
    repo: 'Lab/relu-fibres', url: 'https://github.com/Lab/relu-fibres',
    agenda: { title: 'Fibres', kind: 'open-agenda', question: '', summary: '', maintainers: [] },
    summary: { questions: questions.length, answered: 0, claims: 0, contributors: 0 },
    questions, claims: [],
    readme: {
      text,
      url: 'https://github.com/Lab/relu-fibres/blob/main/docs/README.md',
      raw_url: 'https://raw.githubusercontent.com/Lab/relu-fibres/main/docs/README.md',
    },
  };
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ agendas: [entry] }) });
  // Load the actual page's scripts in order; observatory.js starts the page that <body> names.
  const html = readFileSync(resolve(__dirname, '../site/agenda.html'), 'utf8');
  for (const match of html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)) {
    if (match[1]?.startsWith('https:')) continue; // KaTeX is independent of footnote parsing.
    await runInContext(match[1]
      ? readFileSync(resolve(__dirname, '../site', match[1]), 'utf8') : match[2], dom.getInternalVMContext());
  }
  return dom;
}

test('problems show title, statement and optional motivation without field headings', async () => {
  const base = { parents: [], status: 'open', author: 'alice', created: '' };
  const dom = await render('', [
    { ...base, number: 1, title: 'Finiteness', text: 'Is $X$ finite?', motivation: 'A bound would follow.', url: 'https://github.com/Lab/relu-fibres/issues/1' },
    { ...base, number: 2, title: 'Title only', text: 'Title only', motivation: '', url: '' },
    { ...base, number: 3, text: 'Legacy cached statement', url: '' },
  ]);
  try {
    const doc = dom.window.document;
    const rows = doc.querySelectorAll('.q');
    assert.equal(rows[0].querySelector('.q-title').textContent, 'Finiteness');
    assert.equal(rows[0].querySelector('.q-statement').textContent, 'Is $X$ finite?');
    assert.equal(rows[0].querySelector('.q-motivation').textContent, 'A bound would follow.');
    assert.equal(rows[0].querySelectorAll('h3').length, 1);
    assert.equal([...rows[0].querySelectorAll('a')].find(a => a.textContent.startsWith('Details')).href, 'https://github.com/Lab/relu-fibres/issues/1');
    assert.equal(rows[1].querySelector('.q-statement, .q-motivation'), null);
    assert.equal(rows[2].querySelector('.q-title').textContent, 'Legacy cached statement');
  } finally { dom.window.close(); }
});

test('the map draws the README at the centre, problems around it and subproblems further out', async () => {
  const base = { status: 'open', author: 'alice', created: '', url: '', motivation: '' };
  const dom = await render('', [
    { ...base, number: 1, parents: [], title: 'Core', text: 'Core' },
    { ...base, number: 2, parents: [1], title: 'Sub', text: 'Sub', status: 'answered' },
    { ...base, number: 3, parents: [1, 2], title: 'Shared', text: 'Shared' },
    { ...base, number: 4, parents: [], title: '<b>x</b>', text: '<b>x</b>' },
    { ...base, number: 5, parents: [6], title: 'Cycle', text: 'Cycle' },
    { ...base, number: 6, parents: [5], title: 'Cycle', text: 'Cycle' },
  ]);
  try {
    const doc = dom.window.document;
    const stars = [...doc.querySelectorAll('.sky a.star:not(.readme)')];
    assert.deepEqual(stars.map(a => a.getAttribute('href')), ['#q-1', '#q-2', '#q-3', '#q-4']);
    assert.ok(stars.every(a => doc.getElementById(a.getAttribute('href').slice(1))));
    assert.equal(doc.querySelector('.sky a.readme').getAttribute('href'), '#agenda');
    assert.ok(stars[1].classList.contains('s-answered'));
    // Two roots to the centre, #2 to #1, #3 to both its parents.
    assert.equal(doc.querySelectorAll('.sky .edges line').length, 5);
    const r = (a) => Math.hypot(+a.querySelector('circle').getAttribute('cx'), +a.querySelector('circle').getAttribute('cy'));
    assert.ok(Math.abs(r(stars[0]) - r(stars[3])) < 1e-9 && r(stars[1]) > r(stars[0]) && r(stars[2]) > r(stars[1]));
    assert.equal(stars[3].querySelector('title').textContent, '#4 · <b>x</b> (open)');
    assert.equal(doc.querySelector('.sky b'), null);
  } finally { dom.window.close(); }
});

test('GitHub footnotes render as references with local citations and return links', async () => {
  const dom = await render(`# Fibres

Fibres can be disconnected.[^1] Hidden symmetries also occur.[^2] See again.[^1]

## References

[^1]: Grigsby et al., [*Functional dimension*](https://arxiv.org/abs/2209.04036v2), 2025.
[^2]: Grigsby et al., [*Hidden Symmetries*](https://proceedings.mlr.press/v202/grigsby23a.html), 2023.
`);
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('.footnotes ol > li').length, 2);
    assert.deepEqual([...doc.querySelectorAll('[data-footnote-ref]')].map(a => a.textContent), ['1', '2', '1']);
    assert.equal(doc.querySelectorAll('[data-footnote-backref]').length, 3);
    for (const link of doc.querySelectorAll('[data-footnote-ref], [data-footnote-backref]')) {
      assert.ok(link.getAttribute('href').startsWith('#'));
      assert.ok(doc.getElementById(link.getAttribute('href').slice(1)));
    }
    assert.equal(doc.querySelector('.footnotes a em').textContent, 'Functional dimension');
    assert.ok(!doc.querySelector('.readme-body').textContent.includes('[^1]'));
  } finally { dom.window.close(); }
});

test('footnote contents retain Markdown and math, while unsafe HTML is sanitized', async () => {
  const dom = await render('A note.[^long]\n\n[^long]: **First** paragraph with $f_\\theta$.\n\n    Second paragraph with [paper](paper.pdf).\n\n    <img src="plot.png" onerror="alert(1)"> <script>alert(1)</script>\n');
  try {
    const doc = dom.window.document;
    const note = doc.querySelector('.footnotes li');
    assert.ok(note.querySelectorAll('p').length >= 2);
    assert.equal(note.querySelector('strong').textContent, 'First');
    assert.ok(note.textContent.includes('$f_\\theta$'));
    assert.equal(note.querySelector('a').href, 'https://github.com/Lab/relu-fibres/blob/main/docs/paper.pdf');
    assert.equal(note.querySelector('img').src, 'https://raw.githubusercontent.com/Lab/relu-fibres/main/docs/plot.png');
    assert.equal(note.querySelector('script, [onerror]'), null);
  } finally { dom.window.close(); }
});

test('undefined footnotes and code stay literal; ordinary reference links still work', async () => {
  const dom = await render('Unknown[^missing]. `[^code]` [paper][source] [section](#on-github).\n\n[source]: https://example.com/paper\n');
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector('.footnotes'), null);
    assert.ok(doc.querySelector('.readme-body').textContent.includes('[^missing]'));
    assert.equal(doc.querySelector('code').textContent, '[^code]');
    assert.equal(doc.querySelector('.readme-body a').href, 'https://example.com/paper');
    assert.equal(doc.querySelector('.readme-body a:last-child').href, 'https://github.com/Lab/relu-fibres/blob/main/docs/README.md#on-github');
  } finally { dom.window.close(); }
});
