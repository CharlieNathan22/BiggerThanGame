import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";

export default defineConfig({
  site: "https://biggerthangame.com",
  output: "static",
  integrations: [svelte()],
  build: { assets: "_assets" },
});
