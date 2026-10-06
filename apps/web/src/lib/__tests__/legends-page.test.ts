/**
 * The Legends page's modes (DESIGN.md §17): their order, and the Instagram
 * Endless card — its accent, its "Your best" line from this device, and no
 * leaderboard button. Read from the page and card sources: the built page is
 * checked by `pnpm check:site`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const page = source("../../pages/football-higher-or-lower/legends.astro");
const card = source("../../components/Card.astro");

/** Each `<Card …/>` on the page, in order, as its attribute text. */
const cards = [...page.matchAll(/<Card\b([\s\S]*?)\/>/g)].map((m) => m[1] ?? "");
const nameOf = (attrs: string) => /name=\{t\("mode\.(\w+)\.name"\)\}/.exec(attrs)?.[1];

describe("the Legends page's modes", () => {
  it("run Endless, Instagram Endless, Friendly, then Daily Ranked last", () => {
    expect(cards.map(nameOf)).toEqual(["endless", "instagram", "friendly", "ranked"]);
    for (const attrs of cards) expect(attrs).toMatch(/\bwide\b/);
  });

  it("keep Daily Ranked coming soon at the bottom, with room for the themed modes above it", () => {
    const ranked = cards.at(-1)!;
    expect(ranked).not.toMatch(/href=/);
    expect(page).toMatch(/moves to the top when it launches/);
    expect(page.indexOf("themed modes")).toBeLessThan(page.indexOf('t("mode.ranked.name")'));
    expect(page.indexOf("themed modes")).toBeGreaterThan(page.indexOf('t("mode.friendly.name")'));
  });

  it("give Instagram Endless its page, accent and best line, and no leaderboard button", () => {
    const instagram = cards[1]!;
    expect(instagram).toMatch(/href=\{INSTAGRAM_PATH\}/);
    expect(instagram).toMatch(/accent="instagram"/);
    expect(instagram).toMatch(/bestKey=\{bestKey\("legends", "endless-instagram"\)\}/);
    expect(instagram).not.toMatch(/extra=/);
    expect(cards[0]).toMatch(/extra=/);
  });
});

describe("the card's best line", () => {
  const script = /<script is:inline>([\s\S]*?)<\/script>/.exec(card)?.[1] ?? "";

  /** Runs the card's script against a page with one best line and the given storage. */
  function runWith(storage: () => string | null): { text: string; hidden: boolean } {
    const attrs: Record<string, string> = {
      "data-best-key": "bt:best:legends:endless-instagram",
      "data-template": "Your best: {best}",
    };
    const line = {
      textContent: "",
      hidden: true,
      getAttribute: (name: string) => attrs[name] ?? null,
    };
    const document = { querySelectorAll: () => [line] };
    const localStorage = { getItem: storage };
    new Function("document", "localStorage", script)(document, localStorage);
    return { text: line.textContent, hidden: line.hidden };
  }

  it("shows this device's best", () => {
    expect(runWith(() => "14")).toEqual({ text: "Your best: 14", hidden: false });
  });

  it("does nothing with no best, a zero, or something that isn't one", () => {
    for (const stored of [null, "0", "", "abc", "-3", "1.5", "<b>9</b>"]) {
      expect(runWith(() => stored)).toEqual({ text: "", hidden: true });
    }
  });

  it("does nothing, and throws nothing, when storage is blocked", () => {
    expect(
      runWith(() => {
        throw new Error("SecurityError");
      }),
    ).toEqual({ text: "", hidden: true });
  });

  it("holds no digits, so the leak scan has nothing to weigh", () => {
    expect(script).not.toMatch(/[0-9]/);
  });

  it("draws an original glyph, never a brand's mark", () => {
    expect(card).toMatch(/class="glyph"/);
    expect(card.toLowerCase()).not.toMatch(/instagram\.(svg|png)|glyph-instagram|logo/);
  });
});
