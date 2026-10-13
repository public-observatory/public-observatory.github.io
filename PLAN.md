# Plan: private agendas, seen through GitHub sign-in

## Progress

- Done: steps 1 to 3, with their tests (`tests/test_site.py`), and the `snapshot` command in the README.
- Done: step 6, the Worker (`auth/`), its tests (`tests/auth.test.cjs`) and its deployment, which waits on the variable `OBSERVATORY_AUTH`; the invariant in `CLAUDE.md`.
- Done: steps 7 to 9, the page: sign-in, private entries, the Private badge, dispatch by `data-page`, and the security policy; tested in `tests/signin.test.cjs`. The policy has not yet been checked in a real browser.
- Done: the README paragraph on private agendas, and the Docs page's instructions for making an agenda private.
- Done: the setup. The App is `github.com/apps/public-observatory` (client id `Iv23li2HrD8GWOljxqVG`, read-only Contents and Metadata), and the exchange is live at `https://observatory-auth.observatory-auth-setup.workers.dev/token`; both are wired into `SIGNIN`, connect-src and `auth/wrangler.toml`.
- Done: step 4, the workflow `.github/workflows/observatory.yml` in `agenda-template` (8b19b4a). In the private test repository `public-observatory/test-private-agenda` it built the entry on a push and rebuilt it, within a minute, when a problem was opened.
- Done: signing in on the live site, by hand.
- Done: with the App installed on the test repository, the agenda is shown, marked Private, to a signed-in reader and to no one signed out. The plan is complete.
- Recorded for later: the hourly public build needs a GitHub App installation token once the index passes about 300 agendas.

## Context

Principle 3 of `VISION.md` promises private agendas, shown only to those who can read their repositories. The hourly build indexes only public repositories into `agendas.json`, which GitHub Pages serves to everyone, so a private agenda can never be placed there. The aim is a sustainable sign-in with GitHub, after which a visitor sees the public agendas together with the private agendas whose repositories they can read.

Two facts determine the design. The GitHub API (`api.github.com`) accepts requests from browsers on any origin, but GitHub's token endpoints (`github.com/login/oauth/access_token`, `github.com/login/device/code`) do not. A static page can therefore call the API with a token but cannot obtain one without a server that holds a client secret. Personal access tokens pasted into the page were considered and rejected: they are hard to create, they expire, organisations must approve them, and the request to paste a credential resembles phishing.

The design rests on three decisions. Sign-in is a GitHub App together with a single stateless token exchange. Each private agenda builds its own entry with `build.py` and keeps it in its own repository, so the parsing of issues has one implementation, in Python. The public build is paginated beyond its present limit of 100 agendas.

## Design

### 1. Pagination of the public build

`from_github` in `site/build.py` reads one page of search results, so the index stops at 100 agendas. It should read pages of 100 until a short page or the search API's limit of 1,000 results. The docstring should record that the Actions token allows 1,000 requests an hour and that each agenda costs at least three, so that beyond about 300 agendas the hourly build will need a GitHub App installation token. This limit is recorded, not yet addressed.

### 2. One agenda as a function

The body of the loop in `from_github` becomes `one(repo, token, get)`, where `repo` is a repository as the search API or `/repos/{full}` describes it. It reads `agenda.json` and checks it with `agendas.problems`, then reads the issues and the README, and returns `entry(...)`. A private repository's `agenda.json` is read through the contents API; a public one's is still read from `raw.githubusercontent.com`, which costs nothing against the rate limit. The public build skips any private repository its token happens to see. A README's download URL is kept without its query, since for a private repository the query holds a short-lived token.

### 3. Snapshot mode

`python3 site/build.py snapshot OUT REPO` writes `OUT/entry.json`, a single entry in exactly the format of an element of `agendas.json`. It runs inside a private agenda's own workflow, with that repository's `GITHUB_TOKEN`. A malformed agenda makes it exit with status 1 and the reasons, so the failure is visible in the agenda itself.

### 4. The template's workflow

The template repository `Public-Observatory/agenda-template` gains `.github/workflows/observatory.yml`. It runs only when the repository is private.

- Triggers: `issues`, `issue_comment`, a push to the default branch, a daily schedule as a fallback, and `workflow_dispatch`.
- Permissions: `contents: write` and `issues: read`, with one concurrency group per repository.
- Steps: fetch `build.py` and `agenda.py` from `OBSERVATORY_REPO`, as the check workflow already does; run `snapshot`; force-push `entry.json` as a single commit to an orphan branch `observatory`.

The branch's history never grows, and the default branch is never touched.

### 5. The GitHub App

An App named "Public Observatory" is owned by the organisation. It has read-only Metadata and Contents permissions. Its user tokens expire after eight hours and come with refresh tokens valid for six months. Its callback is the site's root. A private agenda opts in when its maintainers install the App on its repository. A user's token then reaches exactly those repositories that both have the App installed and are readable by the user, which is principle 3.

### 6. The token exchange

`auth/worker.js` is a Cloudflare Worker of about thirty lines with no dependencies.

- Requests: `POST /token` with `{code}` or `{refresh_token}` is forwarded, with the client id and secret, to `github.com/login/oauth/access_token`, and GitHub's reply is returned.
- Origins: CORS admits only `https://public-observatory.github.io`, and `http://localhost:8000` when a development variable is set.
- Data: it stores and logs nothing and never sees agenda data.
- Deployment: `.github/workflows/auth.yml` deploys it on changes to `auth/**`, using `auth/wrangler.toml` and the repository secret `CLOUDFLARE_API_TOKEN`.

### 7. The session in the page

`site/observatory.js` holds the client id and the Worker's address as constants.

- Signing in stores a random `state` and the current address in `sessionStorage`, then redirects to `github.com/login/oauth/authorize`.
- On return, a page that carries `code` and `state` checks the state and exchanges the code through the Worker. It then removes them from the address and returns to the stored page.
- The refresh token is kept in `localStorage` and the access token in `sessionStorage`. A response of 401 triggers one refresh; if that fails, the visitor is signed out.
- The site's navigation shows "Sign in with GitHub", or the visitor's login with "Sign out".

### 8. Private entries in the page

- Finding them: with a token, the page lists `GET /user/installations` and, for each, `/user/installations/{id}/repositories`. It keeps the repositories that are private and carry the topic `observatory-agenda`.
- Reading them: for each, it reads `entry.json` from the branch `observatory` through the contents API and marks the entry private.
- Failures: a repository without a snapshot, or with a broken one, is skipped and reported in the console.
- Caching: entries are cached in `sessionStorage` only, so private text never persists on disk.
- The index page: `index()` merges public and private entries by `repo`, the public index taking precedence. A private card bears a "Private" badge beside its kind.
- The agenda page: `agenda()` falls back to the private entry when the repository is not in the public index. A visitor who is not signed in is told that the agenda may be private and is offered sign-in.
- Rendering: `render(entry)` is unchanged, so untrusted text is inserted exactly as before.

### 9. Hardening

A refresh token held by the page raises the cost of any injection. Each HTML file therefore carries a Content Security Policy in a `<meta>` element:

- scripts only from the site and cdnjs;
- connections only to the site, the GitHub API and the Worker;
- images from `https:` and `data:` sources;
- styles only from the site, Google Fonts and cdnjs.

The inline calls `Observatory.index()` and the like give way to dispatch on a `data-page` attribute of `<body>`.

### 10. Prose

- `README.md`: a paragraph on private agendas under "How it works", and the `snapshot` command under "Development".
- `site/content/docs.md`: how to make an agenda private, namely make the repository private, keep the topic, and install the App.
- `CLAUDE.md`: the invariant becomes "no hosted service of our own beyond `auth/`, a stateless token exchange that stores nothing", and `auth/` joins the layout.
- The template's README: the same note on private agendas.

## Files

- `site/build.py`: pagination, `one`, the snapshot mode.
- `site/observatory.js`: the session, private entries, merging, the badge, the sign-in control, dispatch by page.
- `site/*.html`: the security policy, the sign-in slot, `data-page`.
- `site/observatory.css`: the badge and the sign-in control.
- `auth/worker.js`, `auth/wrangler.toml`, `.github/workflows/auth.yml`: new.
- The template repository: `.github/workflows/observatory.yml` and its README.
- `tests/test_site.py`, and the new `tests/auth.test.cjs`.
- `README.md`, `CLAUDE.md`, `site/content/docs.md`.

## Verification

The existing suites, `python3 -m unittest discover -s tests` and `npm test`, pass, as do the unit tests on Python 3.10 under `uv`.

New Python tests use the injectable `get`. They check that:

- search pagination stops at a short page and at 1,000 results;
- `one` reads `agenda.json` through the contents API when it has a token;
- `snapshot` writes an entry equal to the matching element of a build from GitHub;
- a malformed agenda makes `snapshot` exit with status 1.

New Node tests stub `fetch`. They check that:

- a code is forwarded with the secret, and so is a refresh token;
- a foreign origin receives no CORS header;
- other methods and paths are refused with 405 or 404.

By hand, end to end:

1. Register a development App with callback `http://localhost:8000/`, and run `wrangler dev`.
2. Make a private test repository with the topic, a valid `agenda.json` and the new workflow, and install the App on it.
3. Open an issue; the branch `observatory` appears within a minute.
4. Build and serve `_site` as in the README, and sign in. The card appears marked "Private", and its page renders.
5. Sign out; the card disappears.
6. A second account without access never sees it.
7. Revoking the App's authorisation signs the page out cleanly.
8. The console reports no violation of the security policy.

## Setup only a person can do

1. Create the GitHub App under the organisation and note its client id.
2. Create a Cloudflare account and an API token, and store the token as the repository secret `CLOUDFLARE_API_TOKEN`.
3. Set the App's client secret with `wrangler secret put GITHUB_CLIENT_SECRET`.
