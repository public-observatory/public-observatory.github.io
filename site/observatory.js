// The Observatory's pages. Agenda data comes from agendas.json, written by build.py.
// Page copy comes from content/*.md. Markdown HTML is sanitized with DOMPurify.
// Text from issues is untrusted, so it is only ever inserted as
// text, never as HTML. Mathematics in it, written as LaTeX between $...$ or $$...$$, is then typeset by
// KaTeX, which builds its own markup from the text and, with `trust` off, follows no links.
// A signed-in visitor also sees the private agendas they can read, fetched from GitHub with their own token.
"use strict";

const Observatory = (() => {
  const MARK = { open: "⋅", answered: "✓" };
  const KIND = { "open-agenda": "Open agenda", "closed-agenda": "Closed agenda", problem: "Problem" };

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === undefined || c === null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const noun = (n, word, many) => (n === 1 ? word : many || word + "s");
  const plural = (n, word, many) => `${n} ${noun(n, word, many)}`;
  const mark = (state) => h("span", { class: `mark s-${state}`, title: state }, MARK[state] ?? "·");
  const chip = (state) => h("span", { class: `status s-${state}` }, state);
  const safe = (url) => (/^https:\/\//.test(url || "") ? url : null);

  // Markdown links [text](https://...) in untrusted text become anchors, and only https links do; any other
  // bracketed text stays as written. With `links` off (inside a card, itself a link) only the label is kept.
  const LINK = /\[([^\]\n]+)\]\((\S+?)\)/g;
  function rich(text, links = true) {
    const out = [];
    let last = 0;
    for (const m of String(text).matchAll(LINK)) {
      if (!links || safe(m[2])) {
        out.push(text.slice(last, m.index), links ? h("a", { href: m[2], rel: "noopener" }, m[1]) : m[1]);
        last = m.index + m[0].length;
      }
    }
    out.push(text.slice(last));
    return out;
  }

  // Without KaTeX, if its CDN cannot be reached, the LaTeX is left as it was written.
  function typeset(el) {
    if (!window.renderMathInElement) return;
    renderMathInElement(el, { throwOnError: false, trust: false,
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false },
                   { left: "\\[", right: "\\]", display: true }, { left: "\\(", right: "\\)", display: false }] });
    // As in TeX, punctuation after a formula stays on the formula's line.
    for (const k of el.querySelectorAll(".katex")) {
      if (k.closest(".katex-display")) continue;
      let node = k;
      while (!node.nextSibling && node.parentNode !== el && node.parentNode.childNodes.length === 1) node = node.parentNode;
      const t = node.nextSibling, m = t && t.nodeType === Node.TEXT_NODE && /^[.,;:!?)\]]+/.exec(t.data);
      if (!m) continue;
      t.data = t.data.slice(m[0].length);
      const span = h("span", { class: "nowrap" });
      node.replaceWith(span);
      span.append(node, m[0]);
    }
  }

  async function json(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }

  // A native <select> opens the operating system's menu, which no stylesheet reaches. This draws the
  // menu in the page's own style and keeps the <select>, hidden, as the source of truth: choosing an
  // option sets its value and fires its "change", so listeners and the page without JavaScript work.
  function menu(select) {
    const options = [...select.options];
    const label = h("span", {}, select.selectedOptions[0].text);
    const button = h("button", { type: "button", class: "menu-button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": select.getAttribute("aria-label") }, label);
    const list = h("ul", { class: "menu-list", role: "listbox", tabindex: "-1", hidden: true });
    const items = options.map((o, i) => h("li", { role: "option", id: `${select.id}-${i}`, "aria-selected": String(o.selected), onclick: () => choose(i), onmousemove: () => focus(i) }, o.text));
    list.append(...items);
    let active = select.selectedIndex;

    function focus(i) {
      active = (i + items.length) % items.length;
      items.forEach((it, j) => it.classList.toggle("active", j === active));
      list.setAttribute("aria-activedescendant", items[active].id);
      items[active].scrollIntoView({ block: "nearest" });
    }
    function toggle(open) {
      list.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) { focus(select.selectedIndex); list.focus(); }
    }
    function choose(i) {
      toggle(false);
      button.focus();
      if (i === select.selectedIndex) return;
      select.selectedIndex = i;
      label.textContent = options[i].text;
      items.forEach((it, j) => it.setAttribute("aria-selected", String(j === i)));
      select.dispatchEvent(new Event("change"));
    }

    button.addEventListener("click", () => toggle(list.hidden));
    button.addEventListener("keydown", (ev) => {
      if (["ArrowDown", "ArrowUp"].includes(ev.key)) { ev.preventDefault(); toggle(true); }
    });
    list.addEventListener("keydown", (ev) => {
      const keys = { ArrowDown: () => focus(active + 1), ArrowUp: () => focus(active - 1), Home: () => focus(0), End: () => focus(items.length - 1),
        Enter: () => choose(active), " ": () => choose(active), Escape: () => { toggle(false); button.focus(); }, Tab: () => toggle(false) };
      if (!keys[ev.key]) return;
      if (ev.key !== "Tab") ev.preventDefault();
      keys[ev.key]();
    });
    const wrap = h("div", { class: "menu" }, button, list);
    document.addEventListener("click", (ev) => { if (!wrap.contains(ev.target)) toggle(false); });
    select.hidden = true;
    select.after(wrap);
  }

  // Shared by page copy and repository READMEs.
  function markdown(text) {
    // Keep LaTeX intact through Markdown parsing; KaTeX runs on the sanitized DOM.
    const parser = new marked.Marked(markedFootnote({ backRefLabel: "Back to citation" }), { extensions: [{
      name: "math", level: "inline",
      start: (src) => src.search(/\$|\\[([]/),
      tokenizer(src) {
        const match = /^(\$\$[\s\S]+?\$\$|\$[^\n$]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/.exec(src);
        if (match) return { type: "math", raw: match[0] };
      },
      renderer: (token) => h("span", {}, token.raw).outerHTML,
    }] });
    return DOMPurify.sanitize(parser.parse(text), {
      RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "form", "input", "button"],
      FORBID_ATTR: ["style", "srcset"],
    });
  }

  async function page(url) {
    const body = document.getElementById("page-content");
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      const text = await response.text();
      if (!window.marked || !window.DOMPurify) {
        body.replaceChildren(h("pre", { class: "page-fallback" }, text));
        return;
      }
      const content = markdown(text);
      if (body.classList.contains("about-page")) {
        // The introduction is the hero; each level-two heading starts a section.
        let group = h("header", { class: "hero" });
        const groups = [group];
        for (const node of [...content.childNodes]) {
          if (node.nodeName === "H2") {
            group = h("section", {});
            groups.push(group);
          }
          group.append(node);
        }
        body.replaceChildren(...groups);
      } else {
        body.replaceChildren(content);
      }
      typeset(body);
    } catch (error) {
      body.replaceChildren(h("p", {}, "This text could not be loaded. ",
        h("a", { href: url }, "Read the Markdown source"), "."));
      console.error(error);
    }
  }

  // ------------------------------------------------------------------ signing in

  // The GitHub App (github.com/apps/public-observatory) and its token exchange (auth/worker.js). Without both,
  // no one is offered sign-in. The exchange's origin must also be in each page's connect-src.
  const SIGNIN = { client: "Iv23li2HrD8GWOljxqVG", exchange: "https://observatory-auth.observatory-auth-setup.workers.dev/token" };
  const TOPIC = "observatory-agenda";
  const KEY = { state: "observatory.state", back: "observatory.back", token: "observatory.token",
    refresh: "observatory.refresh", login: "observatory.login", private: "observatory.private" };

  // Storage may be refused, in a private window or with site data blocked; the page then works signed out.
  // The refresh token is kept across visits; the access token and anything private only for the session.
  function stored(area, key, value) {
    try {
      const s = window[area];
      if (value === undefined) return s.getItem(key);
      if (value === null) s.removeItem(key); else s.setItem(key, value);
    } catch { return null; }
  }
  const signedIn = () => !!(stored("localStorage", KEY.refresh) || stored("sessionStorage", KEY.token));

  function signIn() {
    const state = crypto.randomUUID();
    stored("sessionStorage", KEY.state, state);
    stored("sessionStorage", KEY.back, location.href);
    location.assign(`https://github.com/login/oauth/authorize?${new URLSearchParams({
      client_id: SIGNIN.client, state, redirect_uri: new URL("./", location.href).href })}`);
  }

  function signOut() {
    stored("localStorage", KEY.refresh, null);
    for (const k of [KEY.token, KEY.login, KEY.private]) stored("sessionStorage", k, null);
  }

  // A code or refresh token, exchanged for a token. GitHub's refusal ends the session; an exchange that
  // cannot be reached does not, so that an outage does not sign everyone out.
  async function exchange(grant) {
    let data;
    try {
      const r = await fetch(SIGNIN.exchange, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(grant) });
      data = await r.json();
    } catch (e) {
      console.error("sign-in exchange unavailable", e);
      return null;
    }
    if (!data.access_token) {
      signOut();
      return null;
    }
    stored("sessionStorage", KEY.token, data.access_token);
    if (data.refresh_token) stored("localStorage", KEY.refresh, data.refresh_token);
    return data.access_token;
  }

  // GitHub returns here with ?code&state. The state must be the one this browser sent, so that no other
  // site can sign a visitor in to an account of its choosing. True if the page is leaving for where sign-in began.
  async function arrive() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code"), state = params.get("state");
    if (!code) return false;
    const expected = stored("sessionStorage", KEY.state), back = stored("sessionStorage", KEY.back);
    stored("sessionStorage", KEY.state, null);
    params.delete("code");
    params.delete("state");
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
    if (!expected || state !== expected) return false;
    stored("sessionStorage", KEY.private, null);
    await exchange({ code });
    if (back && new URL(back).origin === location.origin && back !== location.href) {
      location.replace(back);
      return true;
    }
    return false;
  }

  // A refresh token is good for one use, so requests that need a new token at once share one exchange.
  let renewing = null;
  function renew() {
    const refresh = stored("localStorage", KEY.refresh);
    if (!refresh) return Promise.resolve(null);
    return renewing ||= exchange({ refresh_token: refresh }).finally(() => { renewing = null; });
  }

  // The GitHub API as the visitor. A token past its eight hours is renewed once; if that fails, the visitor is signed out.
  async function api(path, accept = "application/vnd.github+json") {
    for (const again of [false, true]) {
      const token = (!again && stored("sessionStorage", KEY.token)) || await renew();
      if (!token) throw new Error("not signed in");
      const r = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
      if (r.status === 401 && !again) continue;
      if (r.status === 401) signOut();
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }
  }

  async function listing(path, key) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const batch = (await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`))[key];
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  // The private agendas the visitor can read: repositories with the topic on which the Observatory's App is
  // installed. Each keeps its entry, built by its own workflow with build.py, in its branch `observatory`. An
  // entry that names another repository than its own is refused, so that no agenda can pass for another.
  async function privateEntries() {
    if (!signedIn()) return [];
    const cached = stored("sessionStorage", KEY.private);
    if (cached) return JSON.parse(cached);
    const repos = [];
    for (const i of await listing("/user/installations", "installations"))
      repos.push(...await listing(`/user/installations/${i.id}/repositories`, "repositories"));
    const entries = await Promise.all(repos.filter((r) => r.private && (r.topics || []).includes(TOPIC)).map(async (r) => {
      try {
        const e = await api(`/repos/${r.full_name}/contents/entry.json?ref=observatory`, "application/vnd.github.raw+json");
        if (e.repo !== r.full_name) throw new Error(`entry.json names ${e.repo}`);
        return { ...e, private: true };
      } catch (err) {
        console.warn(`private agenda ${r.full_name} skipped: ${err.message}`);
        return null;
      }
    }));
    const out = entries.filter(Boolean);
    stored("sessionStorage", KEY.private, JSON.stringify(out));
    return out;
  }

  // The last item of the site's navigation: sign in, or the visitor's login and sign out.
  async function control() {
    const nav = document.querySelector("nav.site");
    if (!nav || !(SIGNIN.client && SIGNIN.exchange) && !signedIn()) return;
    if (!signedIn()) {
      nav.append(h("button", { type: "button", class: "signin", onclick: signIn }, "Sign in"));
      return;
    }
    let login = stored("sessionStorage", KEY.login);
    if (!login) {
      try { login = (await api("/user")).login; } catch { login = ""; }
      if (login) stored("sessionStorage", KEY.login, login);
    }
    nav.append(h("button", { type: "button", class: "signin", title: login ? `Signed in to GitHub as ${login}` : null,
      onclick: () => { signOut(); location.reload(); } }, login ? `${login} · Sign out` : "Sign out"));
  }

  // ------------------------------------------------------------------ the index

  const stamp = (iso) => iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "";
  // "3 days ago", or the date once that says more than the interval does.
  function ago(iso) {
    if (!iso) return "";
    const days = Math.round((Date.now() - Date.parse(iso)) / 864e5);
    if (days > 60) return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const hours = Math.round((Date.now() - Date.parse(iso)) / 36e5);
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    return hours < 24 ? rtf.format(-Math.max(hours, 0), "hour") : rtf.format(-days, "day");
  }
  const meter = (s) => h("span", { class: "meter", title: `${s.answered} of ${s.questions} problems answered` },
    h("span", { class: "bar" }, h("span", { style: `width:${Math.round(100 * (s.questions ? s.answered / s.questions : 0))}%` })),
    `${s.answered} of ${plural(s.questions, "problem")} answered`);

  async function index() {
    // The query string holds the search, so that a filtered index can be linked to and survives the back button.
    const params = new URLSearchParams(location.search);
    const sort = document.getElementById("sort");
    if ([...sort.options].some((o) => o.value === params.get("sort"))) sort.value = params.get("sort");
    menu(sort);
    const cards = document.getElementById("cards");
    const empty = document.getElementById("empty");
    const count = document.getElementById("count");
    const search = document.getElementById("q");
    let data;
    try {
      data = await json("agendas.json");
    } catch (e) {
      empty.hidden = false;
      empty.textContent = "The index could not be loaded.";
      return;
    }
    const state = { q: params.get("q") || "", kind: params.get("kind") || "", sort: sort.value };
    const progress = (s) => (s.questions ? s.answered / s.questions : 0);
    const open = (s) => s.questions - s.answered;
    const order = {
      active: (a, b) => (b.pushed || "").localeCompare(a.pushed || "") || b.summary.contributors - a.summary.contributors,
      open: (a, b) => open(b.summary) - open(a.summary),
      new: (a, b) => b.agenda.created.localeCompare(a.agenda.created),
      progress: (a, b) => progress(b.summary) - progress(a.summary),
    };

    function entry(e) {
      const a = e.agenda, s = e.summary;
      return h("li", { class: "entry" },
        h("div", { class: "entry-no", "aria-hidden": "true" }),
        h("div", {},
          h("div", { class: "entry-kind" }, h("span", { class: "badge" }, KIND[a.kind] || a.kind), e.private && [" · ", h("span", { class: "badge private" }, "Private")], " · ", e.repo.split("/")[0]),
          h("h3", {}, h("a", { href: `agenda.html?repo=${encodeURIComponent(e.repo)}` }, a.title)),
          h("p", { class: "question" }, rich(a.question, false)),
          h("p", { class: "summary" }, rich(a.summary, false)),
          h("div", { class: "entry-meta" },
            meter(s),
            h("span", {}, plural(s.claims, "claim")),
            h("span", {}, plural(s.contributors, "contributor")),
            e.pushed && h("span", { title: stamp(e.pushed) }, `active ${ago(e.pushed)}`),
            (a.tags || []).length ? h("span", { class: "tags" }, a.tags.map((t) =>
              h("button", { type: "button", class: "tag", title: `Show agendas on ${t}`, onclick: () => { search.value = t; state.q = t; render(); } }, t))) : null)));
    }

    function render() {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = data.agendas
        .filter((e) => !state.kind || e.agenda.kind === state.kind)
        .filter((e) => {
          const text = [e.agenda.title, e.agenda.question, e.agenda.summary, ...(e.agenda.tags || [])].join(" ").toLowerCase();
          return words.every((w) => text.includes(w));
        })
        .sort(order[state.sort]);
      cards.replaceChildren(...shown.map(entry));
      typeset(cards);
      count.textContent = shown.length === data.agendas.length ? plural(data.agendas.length, "agenda") : `${shown.length} of ${data.agendas.length}`;
      empty.hidden = shown.length > 0;
      empty.textContent = data.agendas.length ? "No agenda matches." : "No agendas yet. Pose the first one.";
      const query = new URLSearchParams(Object.entries(state).filter(([k, v]) => v && !(k === "sort" && v === "active")));
      history.replaceState(null, "", query.size ? `?${query}` : location.pathname);
    }

    search.value = state.q;
    search.addEventListener("input", (ev) => { state.q = ev.target.value; render(); });
    sort.addEventListener("change", (ev) => { state.sort = ev.target.value; render(); });
    for (const b of document.querySelectorAll(".chip")) {
      b.setAttribute("aria-pressed", String(b.dataset.kind === state.kind));
      b.addEventListener("click", () => {
        state.kind = b.dataset.kind;
        for (const o of document.querySelectorAll(".chip")) o.setAttribute("aria-pressed", String(o === b));
        render();
      });
    }
    render();
    if (data.built) document.getElementById("built").append(` Index built ${stamp(data.built)}.`);
    // The public index is shown at once; the private agendas join it when GitHub has answered.
    try {
      const known = new Set(data.agendas.map((e) => e.repo));
      const more = (await privateEntries()).filter((e) => !known.has(e.repo));
      if (more.length) {
        data.agendas = [...data.agendas, ...more];
        render();
      }
    } catch (e) {
      console.error("private agendas unavailable", e);
    }
  }

  // ------------------------------------------------------------------ one agenda

  function readmeBody(readme, github, title) {
    const body = h("article", { class: "readme-body" });
    if (!window.marked || !window.DOMPurify) {
      body.append(h("pre", { class: "readme-fallback" }, readme.text));
      return body;
    }
    body.append(markdown(readme.text));
    // The page already sets the title, so a README that opens by repeating it loses that heading.
    const first = body.firstElementChild;
    if (first?.tagName === "H1" && first.textContent.trim().toLowerCase() === title.trim().toLowerCase()) first.remove();
    // Resolve repository-relative links and images against the actual README location.
    const localIds = new Set([...body.querySelectorAll("[id]")].map((el) => el.id));
    for (const el of body.querySelectorAll("a[href], img[src]")) {
      const attr = el.tagName === "IMG" ? "src" : "href";
      const value = el.getAttribute(attr);
      // Footnotes and explicit README anchors refer to this rendered document.
      if (attr === "href" && value.startsWith("#") && localIds.has(value.slice(1))) continue;
      const base = attr === "src" ? readme.raw_url : readme.url;
      try {
        const url = new URL(value, base || github);
        if (!["https:", "http:", ...(attr === "href" ? ["mailto:"] : [])].includes(url.protocol)) throw new Error();
        el.setAttribute(attr, url.href);
      } catch { el.removeAttribute(attr); }
    }
    return body;
  }

  function readmeSection(readme, github, title) {
    const source = safe(readme?.url) || (github && `${github}#readme`);
    const section = h("section", { id: "agenda" },
      h("h2", {}, "The agenda", h("small", {}, "From the README", source && [" · ", h("a", { href: source }, "GitHub ↗")])));
    section.append(readme?.text ? readmeBody(readme, github, title)
      : h("p", { class: "note" }, "The README is not available in this snapshot.", github && [" ", h("a", { href: `${github}#readme` }, "Read it on GitHub"), "."]));
    return section;
  }

  async function agenda() {
    const main = document.getElementById("main");
    const repo = new URLSearchParams(location.search).get("repo") || "";
    let data, entry;
    try {
      data = await json("agendas.json");
      entry = data.agendas.find((e) => e.repo === repo) || (await privateEntries()).find((e) => e.repo === repo);
    } catch (e) {
      main.replaceChildren(h("p", { class: "empty" }, `This agenda could not be loaded (${e.message}).`));
      return;
    }
    if (!entry) {
      const offer = !signedIn() && SIGNIN.client && SIGNIN.exchange;
      main.replaceChildren(h("p", { class: "empty" }, "This agenda is not in the public index.",
        offer ? [" If it is private, ", h("button", { type: "button", class: "link", onclick: signIn }, "sign in with GitHub"), " to see it."] : ""));
      return;
    }
    document.title = `${entry.agenda.title} · The Public Observatory`;
    main.replaceChildren(...render(entry));
    typeset(main);
    follow(main);
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    if (data.built) document.getElementById("built").append(` As of ${stamp(data.built)}.`);
  }

  // The contents in the margin mark the section being read.
  function follow(main) {
    const links = [...main.querySelectorAll(".contents a")];
    if (!links.length) return;
    const sections = links.map((a) => document.getElementById(a.hash.slice(1)));
    const update = () => {
      let current = sections[0];
      for (const s of sections) if (s.getBoundingClientRect().top < 120) current = s;
      links.forEach((a, i) => a.classList.toggle("current", sections[i] === current));
    };
    addEventListener("scroll", update, { passive: true });
    update();
  }

  // An issue's body is its first line, the question or claim itself, then any paragraphs that explain it.
  const paragraphs = (text) => String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => h("p", {}, rich(p)));

  function render(entry) {
    const a = entry.agenda, s = entry.summary;
    const github = entry.repo.startsWith("local/") ? null : safe(entry.url) || `https://github.com/${entry.repo}`;
    const form = (template, fields) => github && `${github}/issues/new?${new URLSearchParams({ template, ...fields })}`;
    const questions = Object.fromEntries(entry.questions.map((q) => [q.number, q]));
    const answers = {};
    for (const c of entry.claims) for (const n of c.answers) (answers[n] ||= []).push(c);
    const link = (i) => safe(i.url) ? h("a", { href: i.url }, `#${i.number}`) : `#${i.number}`;
    const by = (i) => h("span", {}, i.author, " · ", link(i), i.created ? ` · ${ago(i.created)}` : "");

    const head = h("header", { class: "agenda-head" },
      h("span", { class: "badge" }, KIND[a.kind] || a.kind, entry.private ? " · Private" : ""),
      h("h1", {}, a.title),
      h("p", { class: "question" }, rich(a.question)),
      h("p", { class: "summary" }, rich(a.summary)));

    // The tree of questions: a question whose parents are not in the agenda is a root.
    const roots = entry.questions.filter((q) => !q.parents.some((p) => questions[p]));
    const seen = new Set();
    function node(q) {
      if (seen.has(q.number)) return h("li", { class: "q note" }, `(see #${q.number} above)`);
      seen.add(q.number);
      const li = h("li", { class: "q", "data-status": q.status },
        h("div", { class: "q-line" }, mark(q.status), h("div", { class: "q-text" },
          h("h3", { class: "q-title" }, rich(q.title || q.text)),
          q.title && q.text !== q.title ? h("div", { class: "q-statement" }, paragraphs(q.text)) : null,
          q.motivation ? h("div", { class: "q-motivation" }, paragraphs(q.motivation)) : null), chip(q.status)),
        h("div", { class: "q-meta" }, by(q),
          safe(q.url) && h("a", { href: q.url }, "Details and discussion ↗"),
          github && h("a", { href: form("claim.yml", { answers: `#${q.number}` }) }, "Answer it")),
        (answers[q.number] || []).length ? h("div", { class: "answers" }, answers[q.number].map((c) =>
          h("div", { class: "answer" }, h("span", { class: "text" }, rich(c.text)), h("span", { class: "note" }, by(c))))) : null);
      const subs = entry.questions.filter((x) => x.parents.includes(q.number));
      if (subs.length) li.append(h("ul", {}, subs.map(node)));
      return li;
    }
    const open = s.questions - s.answered;
    const treeList = roots.length ? h("ul", { class: "tree" }, roots.map(node)) : null;
    // Showing only open questions hides an answered question with open subquestions, and its subquestions with it;
    // the filter therefore applies to leaves of the tree and keeps every ancestor of a shown question.
    function only(status) {
      for (const li of [...treeList.querySelectorAll("li.q")].reverse()) {
        const shownChild = li.querySelector(":scope > ul > li.q:not([hidden])");
        li.hidden = !!status && li.dataset.status !== status && !shownChild;
      }
    }
    const filter = treeList && s.answered && open ? h("div", { class: "q-filter chips", role: "group", "aria-label": "Show" },
      [["", "All"], ["open", "Open"], ["answered", "Answered"]].map(([v, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(!v),
        onclick: (ev) => { only(v); for (const b of ev.target.parentNode.children) b.setAttribute("aria-pressed", String(b === ev.target)); } }, label))) : null;
    const tree = h("section", { id: "questions" },
      h("h2", {}, "Problems", h("small", {}, `${open} open · ${s.answered} answered`)),
      filter, treeList || h("p", { class: "note" }, "No problems yet. Pose the first problem."));

    const list = (id, title, items, row, none) => h("section", { id }, h("h2", {}, title, h("small", {}, plural(items.length, "claim"))),
      items.length ? h("ul", { class: "list" }, items.map(row)) : h("p", { class: "note" }, none));
    const claimRow = (c) => h("li", {}, h("div", { class: "text" }, paragraphs(c.text)),
      h("div", { class: "why" }, by(c), c.comments ? ` · ${plural(c.comments, "comment")}` : ""));

    // A claim that answers an answered question is shown under that question, and only there.
    const settled = (c) => c.answers.some((n) => questions[n] && questions[n].status === "answered");
    const loose = entry.claims.filter((c) => !settled(c));
    const claims = list("claims", "Claims", loose, claimRow, entry.claims.length
      ? "Every claim answers an answered question and is shown under it."
      : "No claims yet. A failed approach is worth recording too: it saves the next person the trouble.");

    const stats = h("div", {},
      h("div", { class: "stats" }, [[s.questions, "problem"], [s.claims, "claim"], [s.contributors, "contributor"]]
        .map(([n, word]) => h("div", { class: "stat" }, h("b", {}, n), h("span", {}, noun(n, word))))),
      h("div", { class: "progress" }, meter(s)));
    const side = h("aside", {}, h("div", { class: "side" },
      stats,
      github && h("div", { class: "actions" },
        a.kind !== "closed-agenda" && h("a", { class: "button primary", href: form("problem.yml", {}) }, "Pose a problem"),
        h("a", { class: "button", href: form("claim.yml", {}) }, "Record a claim"),
        h("a", { class: "button", href: github }, "Repository ↗")),
      h("div", { class: "who" }, h("span", { class: "contents-title" }, "Maintained by"), a.maintainers.map((m, i) => [i ? ", " : "",
        github ? h("a", { href: `https://github.com/${m}` }, m) : m])),
      h("nav", { class: "contents", "aria-label": "On this page" }, h("span", { class: "contents-title" }, "On this page"),
        h("ol", {}, [["agenda", "The agenda", ""], ["questions", "Problems", s.questions], ["claims", "Claims", loose.length]]
          .map(([id, label, n]) => h("li", {}, h("a", { href: `#${id}` }, label, n === "" ? null : h("small", {}, n))))))));

    return [head, h("div", { class: "layout" }, side,
      h("div", { class: "body" }, readmeSection(entry.readme, github, a.title), tree, claims))];
  }

  // Each page names itself, and the Markdown it shows, in attributes of <body>, so that it needs no inline script.
  async function start() {
    const { page: name, content } = document.body.dataset;
    if (!name || await arrive()) return;
    control();
    await Promise.all([content && page(content), name === "index" && index(), name === "agenda" && agenda()]);
  }

  return { index, agenda, page, start };
})();

Observatory.start();
