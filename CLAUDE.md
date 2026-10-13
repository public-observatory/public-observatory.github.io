# observatory

This repository is `Public-Observatory/Public-Observatory.github.io` on GitHub: the website of the Public Observatory, a public index of research agendas kept as git repositories, and the template from which agendas are made. Read `VISION.md` for the aim and `README.md` for how it works before changing behaviour.

## Commands

```sh
python3 -m unittest discover -s tests                     # all tests, under a second
npm ci --ignore-scripts && npm test                       # Markdown rendering tests; Node.js 24+
python3 site/build.py local OUT DIR...                    # build an index from local agenda directories
python3 -m http.server -d site                            # preview the page text; agenda cards need a built index
uv run --no-project --python 3.10 python -m unittest discover -s tests   # the oldest supported Python
```

## Layout

- `site/agenda.py`: the schema of `agenda.json` and `check`, which each agenda's pull requests run.
- `site/build.py`: builds `agendas.json` from GitHub (repositories with the topic `observatory-agenda`, their `agenda.json`, README and issues) or from local directories. Network access goes through an injectable `get`, so tests use a dict.
- `auth/worker.js`: the Cloudflare Worker that exchanges a GitHub sign-in code, or a refresh token, using the GitHub App's client secret; deployed by `.github/workflows/auth.yml`.
- `site/*.html`, `observatory.js`, `observatory.css`: the static pages, which render `agendas.json` and compute nothing the index does not say. Layout, navigation and page titles live in the HTML.
- `site/content/*.md`: the prose of the home, About and Docs pages, loaded by the pages as Markdown. Edit the text here, not in the HTML.
- `site/marked.js`, `marked-footnote.js`, `purify.js`: vendored Markdown renderer and sanitiser, with their licences in the files. Do not edit them; update by replacing the file and the version in `README.md`.
- `agenda-template/`: a new agenda's repository, published as the template repository `Public-Observatory/agenda-template`. Its issue forms (Problem, Claim) have headings that `build.fields` parses; change both together.
- `agendas/`: example agendas for local previews and tests.
- `tests/test_site.py`, `tests/markdown.test.cjs`, `tests/auth.test.cjs`, `tests/signin.test.cjs`: the schema, issues read as problems and claims, the ways of building the index and a snapshot, the rendering of Markdown, the token exchange, and signing in with the private agendas it reveals.

## Invariants

- Git and GitHub are the only infrastructure: no server, no database, no hosted service of our own beyond `auth/`, a stateless token exchange that stores nothing. The website is static.
- A private agenda never enters `agendas.json`. Its own workflow builds its entry with `build.py snapshot`, and the page reads it with the signed-in visitor's token.
- One broken agenda never takes the index down: it is skipped and reported.
- Text from issues, READMEs and agenda files is untrusted. The pages insert it only as text or as sanitised Markdown, never as raw HTML, and follow only `https://` links from it. Mathematics in it, written in LaTeX between `$...$` or `$$...$$`, is typeset by KaTeX from cdnjs, with `trust` off; without KaTeX the LaTeX is shown as written.
- Python is standard library only, 3.10+. The pages have no build step; Node is used only to test them.
- Fonts (Baskervville for headings, Open Sans for text, IBM Plex Mono for labels) come from Google Fonts; without them the pages fall back to system fonts. The night sky of the page heads is drawn in CSS, with no images.

## Style

- Terse code with docstrings that explain why, not what. Match the surrounding density.
- Prose (README, VISION, docstrings, the website, the template) should read like a top mathematical journal: precise, plain, grammatical, no hype.
- Any LaTeX source goes on one line per paragraph, and so does Markdown prose.

## Direction

The stages in `VISION.md` are the roadmap. The present design keeps the state of a claim in issue labels set by maintainers; stage 3 replaces that with a record that checks itself, and should be built only once agendas have outgrown labels.

Work on `main` directly: commit and push there.
