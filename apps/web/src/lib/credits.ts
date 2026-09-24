/**
 * Photo credits for the /credits page, read at build time.
 *
 * `credits.json` is a deck build artifact. It is read with `fs` while the page
 * prerenders and never imported, so nothing from `packages/deck/dist` enters
 * the module graph or the client bundle (ARCHITECTURE.md §4, §6). It holds no
 * stat values — only who is in each photo and how it is licensed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The shape `packages/deck` writes. Declared here rather than imported,
 * because `apps/web` never imports `@bt/deck`, not even for types.
 */
export interface Credit {
  readonly name: string;
  readonly author: string;
  readonly licence: string;
  /** Absent for public domain. */
  readonly licenceUrl?: string;
  readonly source: string;
}

// `astro build` and `astro dev` run from apps/web.
const CREDITS_PATH = resolve(process.cwd(), "../../packages/deck/dist/credits.json");

export function loadCredits(): Credit[] {
  let text: string;
  try {
    text = readFileSync(CREDITS_PATH, "utf8");
  } catch {
    throw new Error(
      `credits.json not found at ${CREDITS_PATH}. Build the deck first: pnpm --filter @bt/deck build --no-sim`,
    );
  }
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("credits.json: expected an array");

  const credits = data.map((entry: unknown, i): Credit => {
    const e = entry as Record<string, unknown>;
    for (const field of ["name", "author", "licence", "source"] as const) {
      if (typeof e[field] !== "string") throw new Error(`credits.json[${i}]: ${field} missing`);
    }
    const url = e["licenceUrl"];
    return {
      name: e["name"] as string,
      author: e["author"] as string,
      licence: e["licence"] as string,
      ...(typeof url === "string" ? { licenceUrl: url } : {}),
      source: e["source"] as string,
    };
  });

  return credits.sort((a, b) => a.name.localeCompare(b.name, "en"));
}
