// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
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
);
