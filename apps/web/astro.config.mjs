import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";

export default defineConfig({
  site: "https://biggerthangame.com",
  output: "static",
  integrations: [svelte()],
  // `about.html`, served by Workers Static Assets at `/about` with no trailing
  // slash, which is also the canonical URL.
  trailingSlash: "never",
  build: { assets: "_assets", format: "file" },
  vite: {
    // `pnpm dev` runs `wrangler dev` on :8787 alongside this server.
    server: { proxy: { "/api": "http://localhost:8787" } },
  },
});
