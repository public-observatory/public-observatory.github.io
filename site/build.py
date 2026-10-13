"""Build `agendas.json`, the index the Observatory's website reads.

    python3 site/build.py github OUT [TOPIC]     agendas on GitHub with the topic (default observatory-agenda)
    python3 site/build.py local OUT DIR...       agendas in local directories, for previews
    python3 site/build.py snapshot OUT REPO      one private agenda's entry, as OUT/entry.json

An agenda is a repository holding `agenda.json`. Its questions and claims are its issues labelled
`question` or `claim`, opened through the forms in `agenda-template/.github/ISSUE_TEMPLATE`. A claim
is reviewed in its issue's comments; a maintainer closes a question once it is answered.
The index carries, for each agenda, the agenda file, its questions and claims, and the numbers the
front page shows. An agenda whose files cannot be read is left out and reported, so that one broken
repository does not take the index down. With `local`, a directory may hold `issues.json`, a list
of issues as the GitHub API returns them.

A private agenda never enters the index, which anyone can read. Its own workflow runs `snapshot`
with the repository's token and keeps the entry in its branch `observatory`, where only those who can
read the repository can read it.

Set GITHUB_TOKEN to search with a higher rate limit. The token of a GitHub Actions run allows 1,000
requests an hour and each agenda costs at least three, so an index of more than about 300 agendas
will need a GitHub App's installation token. Standard library only.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import agenda as agendas  # noqa: E402

TOPIC = "observatory-agenda"
LIMIT = 2 << 20  # bytes read from any one response
PAGES = 10  # pages of 100 issues read from any one agenda, and of search results, where GitHub stops at 1,000
EMPTY = "_No response_"


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def fetch(url: str, token: str | None = None) -> bytes:
    headers = {"User-Agent": "observatory-index", "Accept": "application/vnd.github+json"}
    if token and url.startswith("https://api.github.com/"):
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
        data = r.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError(f"{url} is larger than {LIMIT} bytes")
    return data


def fields(body: str | None) -> dict[str, str]:
    """The answers of an issue form by label. GitHub renders a form as one `### Label` heading per
    field and `_No response_` for a field left empty; an empty answer is left out."""
    out = {}
    for m in re.finditer(r"^### (.+?)\s*\n(.*?)(?=^### |\Z)", body or "", re.M | re.S):
        if (value := m[2].strip()) and value != EMPTY:
            out[m[1].strip()] = value
    return out


def numbers(text: str | None) -> list[int]:
    """Issue numbers as people write them: `#12`, `12`, or a link to the issue."""
    return sorted({int(n) for n in re.findall(r"(?:#|/issues/|\b)(\d+)\b", text or "")})


def item(issue: dict) -> dict | None:
    """A question or claim from an issue, or None for any other issue or a pull request. A question's text
    is its `Statement` field (formerly `Question`) and a claim's is its title; earlier forms used `Claim`, and placed a question under another by `Part of` or `Subquestion of`."""
    if "pull_request" in issue:
        return None
    labels = sorted(l["name"] if isinstance(l, dict) else l for l in issue.get("labels", []))
    f = fields(issue.get("body"))
    base = {"number": issue["number"], "url": issue.get("html_url", ""),
            "author": (issue.get("user") or {}).get("login", ""), "created": issue.get("created_at", ""),
            "comments": issue.get("comments", 0), "labels": labels}
    if "question" in labels:
        return {"type": "question", "title": issue["title"],
                "motivation": f.get("Why it matters") or f.get("Motivation", ""), "text": f.get("Statement") or f.get("Question", issue["title"]), "parents": numbers(f.get("Subquestion of") or f.get("Part of")),
                "status": "answered" if issue.get("state") == "closed" else "open", **base}
    if "claim" in labels:
        return {"type": "claim", "text": f.get("Claim", issue["title"]), "answers": numbers(f.get("Answers")),
                "evidence": f.get("Evidence", ""), "provenance": f.get("Provenance", ""), **base}
    return None


def entry(repo: str, agenda: dict, issues: list[dict], **extra) -> dict:
    items = [i for i in map(item, issues) if i]
    questions = sorted((i for i in items if i["type"] == "question"), key=lambda i: i["number"])
    claims = sorted((i for i in items if i["type"] == "claim"), key=lambda i: i["number"])
    summary = {"questions": len(questions), "answered": sum(q["status"] == "answered" for q in questions),
               "claims": len(claims),
               "contributors": len({i["author"] for i in items if i["author"]})}
    return {"repo": repo, "agenda": agenda, "questions": questions, "claims": claims, "summary": summary, **extra}


def pages(url: str, token: str | None, get, key: str | None = None) -> list:
    """Every item of a listing GitHub returns in pages of 100, up to PAGES pages."""
    out = []
    for page in range(1, PAGES + 1):
        batch = json.loads(get(f"{url}&per_page=100&page={page}", token))
        batch = batch.get(key, []) if key else batch
        out += batch
        if len(batch) < 100:
            break
    return out


def issues_of(full: str, token: str | None, get) -> list[dict]:
    return pages(f"https://api.github.com/repos/{full}/issues?state=all", token, get)


def readme_of(full: str, token: str | None, get) -> dict | None:
    """Use GitHub's README discovery (including .github/ and docs/ READMEs)."""
    try:
        data = json.loads(get(f"https://api.github.com/repos/{full}/readme", token))
        return {"text": base64.b64decode(data["content"]).decode("utf-8"),
                # A private repository's download URL carries a short-lived token, which must not be kept.
                "url": data["html_url"], "raw_url": data["download_url"].split("?")[0]}
    except (OSError, ValueError, KeyError, TypeError) as e:
        # A missing README must not hide the agenda and its questions.
        print(f"README unavailable for {full}: {e}", file=sys.stderr)
        return None


def one(repo: dict, token: str | None = None, get=fetch) -> dict:
    """The entry of one repository, as the search API or `/repos/{full}` describes it. A private
    repository's files are not on raw.githubusercontent.com, so its `agenda.json` is read through the
    contents API; a public one's is read without spending a request of the rate limit."""
    full, branch = repo["full_name"], repo["default_branch"]
    if repo.get("private"):
        data = json.loads(get(f"https://api.github.com/repos/{full}/contents/agenda.json?ref={branch}", token))
        agenda = json.loads(base64.b64decode(data["content"]))
    else:
        agenda = json.loads(get(f"https://raw.githubusercontent.com/{full}/{branch}/agenda.json"))
    if bad := agendas.problems(agenda):
        raise ValueError("; ".join(bad))
    return entry(full, agenda, issues_of(full, token, get), url=repo["html_url"], stars=repo["stargazers_count"],
                 pushed=repo["pushed_at"], readme=readme_of(full, token, get))


def from_github(topic: str = TOPIC, token: str | None = None, get=fetch) -> tuple[list[dict], list[str]]:
    q = urllib.parse.quote(f"topic:{topic}")
    out, skipped = [], []
    for r in pages(f"https://api.github.com/search/repositories?q={q}", token, get, "items"):
        # A token that can read a private agenda must still not put it in the public index.
        if r.get("private"):
            continue
        try:
            out.append(one(r, token, get))
        except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as e:
            skipped.append(f"{r['full_name']}: {e}")
    return out, skipped


def snapshot(full: str, token: str | None = None, get=fetch) -> dict:
    return one(json.loads(get(f"https://api.github.com/repos/{full}", token)), token, get)


def from_local(dirs: list[Path]) -> tuple[list[dict], list[str]]:
    entries, skipped = [], []
    for d in dirs:
        try:
            agenda = agendas.load(d / "agenda.json")
            issues = json.loads((d / "issues.json").read_text()) if (d / "issues.json").exists() else []
            readme = next((p for p in (d / "README.md", d / "readme.md", d / "README") if p.exists()), None)
            entries.append(entry(f"local/{d.name}", agenda, issues,
                                 readme={"text": readme.read_text()} if readme else None))
        except (OSError, ValueError, KeyError, TypeError) as e:
            skipped.append(f"{d}: {e}")
    return entries, skipped


def write(out: Path, entries: list[dict]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    entries = sorted(entries, key=lambda e: e["repo"].lower())
    (out / "agendas.json").write_text(json.dumps({"built": now(), "agendas": entries}, ensure_ascii=False, indent=1))


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] not in ("github", "local", "snapshot") or (argv[0] != "github" and len(argv) < 3):
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    out = Path(argv[1])
    if argv[0] == "snapshot":
        try:
            e = snapshot(argv[2], os.environ.get("GITHUB_TOKEN"))
        except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as err:
            print(f"snapshot of {argv[2]} failed: {err}", file=sys.stderr)
            return 1
        out.mkdir(parents=True, exist_ok=True)
        (out / "entry.json").write_text(json.dumps(e, ensure_ascii=False, indent=1))
        print(f"wrote {out / 'entry.json'}")
        return 0
    if argv[0] == "github":
        entries, skipped = from_github(argv[2] if len(argv) > 2 else TOPIC, os.environ.get("GITHUB_TOKEN"))
    else:
        entries, skipped = from_local([Path(d) for d in argv[2:]])
    write(out, entries)
    for s in skipped:
        print(f"skipped {s}", file=sys.stderr)
    print(f"indexed {len(entries)} agenda(s) in {out / 'agendas.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
