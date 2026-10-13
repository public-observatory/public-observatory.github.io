// The Observatory's one hosted piece. GitHub gives a user's token only to a party that knows the
// GitHub App's client secret, and its token endpoint refuses requests from browsers, so a static page
// cannot sign anyone in by itself. This Worker forwards a sign-in code, or a refresh token, to GitHub
// together with the secret and returns GitHub's answer. It stores nothing, logs nothing, and never
// sees an agenda: everything else the page asks of GitHub, it asks directly with the user's token.
//
// Environment: GITHUB_CLIENT_ID; GITHUB_CLIENT_SECRET, a secret; ORIGINS, the pages allowed to call it,
// separated by spaces.

const GITHUB = "https://github.com/login/oauth/access_token";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = (env.ORIGINS || "").split(/\s+/).includes(origin);
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : { Vary: "Origin" };
    const reply = (status, body = null) => new Response(body, { status,
      headers: { ...cors, "Cache-Control": "no-store", ...(body ? { "Content-Type": "application/json" } : {}) } });

    if (new URL(request.url).pathname !== "/token") return reply(404);
    if (request.method === "OPTIONS") return reply(allowed ? 204 : 403);
    if (request.method !== "POST") return reply(405);
    // A browser would refuse the answer anyway; refusing here keeps other sites from using the secret at all.
    if (!allowed) return reply(403);

    let body;
    try { body = await request.json(); } catch { return reply(400); }
    const grant = typeof body?.code === "string" ? { code: body.code }
      : typeof body?.refresh_token === "string" ? { grant_type: "refresh_token", refresh_token: body.refresh_token }
      : null;
    if (!grant) return reply(400);

    const answer = await fetch(GITHUB, { method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "observatory-auth" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...grant }) });
    return reply(answer.status, await answer.text());
  },
};
