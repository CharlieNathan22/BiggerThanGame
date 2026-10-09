/**
 * A board entry with no country (left off, or none known) shows a "?" mark in
 * its flag's place, named "Country not shown"; one with a country still shows
 * its flag (DESIGN.md §13). `flagMark` decides; Flag.svelte draws it, and is
 * rendered here on the server, as Svelte would, to check the markup itself.
 * The boards ask for the mark everywhere they show a flag.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Component } from "svelte";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { afterAll, describe, expect, it } from "vitest";
import { flagMark } from "../flags";

const COMPONENTS = new URL("../../components/", import.meta.url);
const flagSource = readFileSync(new URL("Flag.svelte", COMPONENTS), "utf8");
const board = readFileSync(new URL("Leaderboard.svelte", COMPONENTS), "utf8");

/**
 * Flag.svelte compiled for the server, its imports pointed at the real files,
 * written to a temporary module and loaded: there is no Svelte plugin in the
 * test run, and the component is small enough not to need one.
 */
const dir = mkdtempSync(join(tmpdir(), "bt-flag-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
/** Flag.svelte's props. */
type FlagProps = { country: string | null; lazy?: boolean; unknown?: boolean };
async function loadFlag(): Promise<Component<FlagProps>> {
  const { js } = compile(flagSource, { generate: "server", filename: "Flag.svelte" });
  const code = js.code
    .replace(/from ['"]svelte\/internal\/server['"]/, () => {
      const server = import.meta.resolve("svelte/internal/server");
      return `from ${JSON.stringify(server)}`;
    })
    .replace(/from ['"]\.\.\/game\/flags['"]/, () => {
      const flags = pathToFileURL(fileURLToPath(new URL("../flags.ts", import.meta.url))).href;
      return `from ${JSON.stringify(flags)}`;
    });
  const file = join(dir, "Flag.js");
  writeFileSync(file, code);
  const module = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    default: Component<FlagProps>;
  };
  return module.default;
}

describe("a board entry's flag place", () => {
  it("is the flag for a country, named by the country", () => {
    expect(flagMark("GB")).toEqual({
      kind: "flag",
      src: "/flags/gb.svg",
      name: expect.stringMatching(/United Kingdom|GB/),
    });
  });

  it("is the ? mark for none, named so a screen reader doesn't just say question mark", () => {
    expect(flagMark(null)).toEqual({ kind: "unknown", name: "Country not shown" });
  });

  it("renders the ? mark with its name for a row without a country, and the flag for one with", async () => {
    const Flag = await loadFlag();
    const html = (props: FlagProps) => render(Flag, { props }).body;

    const none = html({ country: null, unknown: true });
    expect(none).toMatch(/<svg[^>]*class="flag unknown[^"]*"/);
    expect(none).toMatch(/role="img"/);
    expect(none).toMatch(/aria-label="Country not shown"/);
    expect(none).not.toMatch(/<img/);

    const flagged = html({ country: "BR", unknown: true });
    expect(flagged).toMatch(/<img[^>]*class="flag[^"]*"[^>]*src="\/flags\/br\.svg"/);
    expect(flagged).toMatch(/alt="(Brazil|BR)"/);
    expect(flagged).not.toMatch(/<svg/);

    // Without `unknown` (the publish dialog's choice), no country is no mark at all.
    expect(html({ country: null })).not.toMatch(/<svg|<img/);
  });

  it("shares the flag's size, shape, alignment and glow, its fill muted", () => {
    expect(flagSource).toMatch(/\.flag \{[^}]*width: var\(--flag-size\);[^}]*border-radius: 50%;/);
    expect(flagSource).toMatch(/img\.flag,\s*svg\.flag \{\s*box-shadow: var\(--flag-glow\);/);
    expect(flagSource).toMatch(/fill: var\(--flag-unknown-fill\)/);
  });

  it("is asked for wherever a board shows a flag: every row, the pinned row and the winner line", () => {
    const flags = [...board.matchAll(/<Flag\b[\s\S]*?\/>/g)].map((m) => m[0]);
    // The rows (tied ones included), the pinned row as a button and as a line, the winner.
    expect(flags).toHaveLength(4);
    for (const flag of flags) expect(flag).toMatch(/\bunknown\b/);
  });
});
