interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: "not_implemented" },
        { status: 501, headers: { "cache-control": "no-store" } },
      );
    }

    return env.ASSETS.fetch(request);
  },
};
