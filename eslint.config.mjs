// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

// Globals that don't exist identically in browser, Worker and Node.
const PLATFORM_GLOBALS = [
  "window",
  "self",
  "document",
  "navigator",
  "location",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "crypto",
  "process",
  "Buffer",
];

export default defineConfig(
  globalIgnores(["**/dist/", "**/build/", "**/coverage/", "**/.astro/", "**/.wrangler/"]),

  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },

  // Svelte components, with TypeScript in <script lang="ts">. TypeScript and
  // svelte-check own undefined-name checking, as typescript-eslint advises.
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    extends: [tseslint.configs.recommended, svelte.configs.recommended],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: { "no-undef": "off" },
  },

  // CLAUDE.md invariant 5: seeded PRNG only. Applies to tests too — a test
  // that draws from Math.random isn't reproducible.
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Seeded PRNG only (CLAUDE.md invariant 5). Draw from ./prng.js.",
        },
      ],
    },
  },

  // packages/core runs in browser, Worker and Node, and server-side
  // verification depends on it behaving identically in all three. It imports
  // nothing but itself. Tests are exempt so they can import vitest.
  {
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/**/__tests__/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...PLATFORM_GLOBALS.map((name) => ({
          name,
          message: "packages/core is platform-free. Platform APIs belong in apps/web or worker/.",
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: /^(?!\.\.?\/)/.source,
              message:
                "packages/core stays dependency- and platform-free. Relative imports only; ask before adding a dependency.",
            },
          ],
        },
      ],
    },
  },

  // The Worker bundles its deck from packages/deck/dist (worker/src/deck.ts).
  // @bt/deck reads files with node:fs and must never reach the Worker bundle;
  // it is for Worker tests only.
  {
    files: ["worker/**/*.ts"],
    ignores: ["worker/src/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: /^@bt\/deck(\/|$)/.source,
              message: "@bt/deck uses node:fs. Worker runtime code gets the deck from src/deck.ts.",
            },
            {
              regex: /^node:/.source,
              message: "Worker runtime code runs in workerd, not Node.",
            },
          ],
        },
      ],
    },
  },

  // ARCHITECTURE.md §4, invariant 1: no deck data in the client, ever. The
  // leak scan of apps/web/dist is the backstop; this stops it at the import.
  {
    files: ["apps/web/**/*.{js,mjs,ts,svelte}", "apps/web/**/*.svelte.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: /^@bt\/deck(\/|$)|deck\.full\.json$|packages\/deck\/(dist|data)(\/|$)/.source,
              message:
                "apps/web must never import deck data (ARCHITECTURE.md §4). Player data comes from /api/round/next.",
            },
          ],
        },
      ],
    },
  },
);
