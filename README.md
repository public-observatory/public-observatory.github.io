# The Public Observatory

A public index of research agendas: questions, with their motivation and their decomposition into smaller questions, posed by anyone and worked on in public by people, laboratories and their agents. The website is at <https://public-observatory.github.io/>. `VISION.md` says what the Observatory is for.

## How it works

**An agenda is a git repository.** It holds `agenda.json`, which states the agenda's title, kind, root question, summary and maintainers, and a README giving its motivation, scope and standard of evidence. A new agenda inherits the separate [agenda template repository](https://github.com/public-observatory/agenda-template), including its issue forms and validation workflow.

**Questions and claims are issues.** Each agenda has two issue forms, kept short: a question is stated in one field, a claim in the title, and everything else is optional. A claim names the questions it answers, by issue number; an approach that did not work is recorded as a claim too. Code, data and proofs arrive as pull requests that the claim links to.

**Maintainers govern by stated rules.** In an *open agenda* anyone may add subquestions; in a *closed agenda* the maintainers set the questions and accept only answers; a *problem* is a single question. Claims are reviewed in the comments on their issues, and a maintainer closes a question once it is answered.

**The index is the topic.** Every public repository with the topic `observatory-agenda` is listed, wherever it lives, so that no one controls admission. Every hour, `site/build.py` searches GitHub for the topic, reads each agenda's `agenda.json` and issues, and writes `agendas.json`; the static pages in `site/` render it. An agenda whose files cannot be read is left out and reported.

## Layout

```
VISION.md          what the Observatory is for
site/              the website: index.html, agenda.html, observatory.js and .css;
                   build.py builds agendas.json; agenda.py checks an agenda.json
tests/             tests of site/agenda.py and site/build.py
```

## Editing the website text

Edit `site/content/index.md` for the home page introduction, `site/content/about.md` for the About page, and `site/content/docs.md` for the shared contribution guide. Use ordinary Markdown: `#` for the title, `##` for page sections, blank lines between paragraphs, and `[label](url)` for links. Links are relative to the HTML page. The About and Docs introduction before the first `##` is styled as the page header.

The pages load these files directly; no Markdown build or installation is needed. For a quick text preview, run `python3 -m http.server -d site` and open <http://localhost:8000/> <http://localhost:8000/about.html> or <http://localhost:8000/docs.html>. Save the Markdown and refresh. Use the full preview below to include agenda cards. Local previews need the HTTP server because browsers block these requests when opening HTML files directly.

Page layout, navigation, browser titles and search descriptions remain in the HTML files. GitHub Pages includes the Markdown files automatically when the site workflow deploys.

## Development

```sh
python3 -m unittest discover -s tests                          # the tests; standard library only, Python 3.10+
npm ci --ignore-scripts && npm test                           # Markdown rendering tests; Node.js 24+
python3 site/agenda.py check /path/to/agenda/agenda.json       # exit 1, with the reasons, if malformed
mkdir -p _site && cp site/*.html site/*.css site/*.js _site/
cp -R site/content _site/
python3 site/build.py local _site DIR...                       # index agendas in local directories, for a preview
python3 site/build.py snapshot OUT OWNER/REPO                 # one private agenda's entry, as its own workflow builds it
python3 -m http.server -d _site                                # and serve it
```

A local agenda directory holds `agenda.json` and, optionally, `README.md` and `issues.json`, a list of issues as the GitHub API returns them. The index includes each repository's README, displayed on its agenda page and refreshed with the hourly build. Relative README links and images point back to the source repository. A missing README does not remove the agenda from the index.

README rendering uses vendored Marked 18.1.0 (`site/marked.js`, MIT), marked-footnote 1.4.0 (`site/marked-footnote.js`, MIT) for GitHub-style footnotes, and DOMPurify 3.4.16 (`site/purify.js`, Apache-2.0 OR MPL-2.0); their license notices are included in the files.

An agenda's check fetches `site/agenda.py` from this repository; the agenda's variable `OBSERVATORY_REPO` points it at another copy.
