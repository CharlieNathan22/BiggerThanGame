import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STREAK_TITLES } from "@bt/core";
import type { Tier } from "@bt/core";
import { describe, expect, it } from "vitest";
import { en } from "../../i18n/en";
import { initialState } from "../machine";
import type { GameState, RoundRecord } from "../machine";
import {
  challengeHeading,
  challengeIntro,
  challengeText,
  endingNames,
  gridCells,
  gridLabel,
  outcomeText,
  shareCard,
  shareGrid,
  shareText,
  titleText,
} from "../share";
import {
  SHARE_LAYOUT,
  SHARE_LAYOUT_TOKENS,
  drawShareCard,
  parseGradientStops,
  parseVariation,
  readPalette,
  readShareLayout,
  stretchKeyword,
} from "../share-image";
import type { Canvas2D } from "../share-image";
import { shareResultImage, shareResultText } from "../share-actions";
import type { SharePlatform } from "../share-actions";
import { RUN_ID, SIG, anchor, card, link } from "./fixtures";

const rec = (index: number, tier: Tier, correct = true): RoundRecord => ({
  index,
  stat: tier === "basic" ? "caps" : tier === "uncommon" ? "fee" : "ct",
  tier,
  correct,
});

const run = (tiers: Tier[], ended = true): RoundRecord[] =>
  tiers.map((tier, i) => rec(i + 1, tier, !(ended && i === tiers.length - 1)));

// Endless and Ranked have no win target: the plain streak, and a grid that
// stops at the miss. Friendly scores out of twenty.

describe("the share grid", () => {
  it("draws a tier square per answered round and a cross for the miss", () => {
    expect(shareGrid(run(["basic", "uncommon", "rare", "rare"]), "endless")).toBe("🟨🟦🟪❌");
  });

  it("wraps at ten", () => {
    const grid = shareGrid(run(Array<Tier>(23).fill("basic")), "endless");
    expect(grid.split("\n").map((l) => [...l].length)).toEqual([10, 10, 3]);
  });

  it("has no cross when the run wasn't lost", () => {
    expect(shareGrid(run(["basic", "basic"], false), "endless")).toBe("🟨🟨");
  });

  it("labels the tiers for a screen reader, colour aside", () => {
    expect(gridLabel(run(["basic", "basic", "rare", "uncommon"]), "endless")).toBe(
      "Your run: 2 basic, 0 uncommon and 1 rare stats right. Out on Highest transfer fee.",
    );
  });
});

describe("the share grid in Friendly", () => {
  it("is always two rows of ten, the rounds not reached left empty", () => {
    const grid = shareGrid(run(["basic", "uncommon", "rare", "rare"]), "friendly");
    expect(grid.split("\n")).toEqual(["🟨🟦🟪❌" + "⬛".repeat(6), "⬛".repeat(10)]);
  });

  it("fills both rows for a won run", () => {
    const grid = shareGrid(run(Array<Tier>(20).fill("basic"), false), "friendly");
    expect(grid.split("\n")).toEqual(["🟨".repeat(10), "🟨".repeat(10)]);
  });

  it("pads the grid's cells to twenty", () => {
    const cells = gridCells(run(["basic", "rare"]), "friendly");
    expect(cells).toHaveLength(20);
    expect(cells.slice(0, 2)).toEqual([{ kind: "hit", tier: "basic" }, { kind: "miss" }]);
    expect(cells.slice(2).every((c) => c.kind === "empty")).toBe(true);
    expect(gridCells(run(["basic", "rare"]), "endless")).toHaveLength(2);
  });

  it("says how many of the twenty were right", () => {
    expect(gridLabel(run(["basic", "basic", "rare", "uncommon"]), "friendly")).toBe(
      "3 of 20 right. Your run: 2 basic, 0 uncommon and 1 rare stats right. Out on Highest transfer fee.",
    );
  });
});

describe("streak titles in text", () => {
  it("has words for every title in every mode's table", () => {
    for (const titles of Object.values(STREAK_TITLES)) {
      for (const title of titles) expect(en[`title.${title.id}`]).toBeTruthy();
    }
  });

  it("gives none below five, and Endless's own titles past that", () => {
    expect(titleText(4, "endless")).toBe("");
    expect(titleText(10, "endless")).toBe("Starter");
    expect(titleText(15, "endless")).toBe("Fan favourite");
    expect(titleText(20, "endless")).toBe("Captain");
    expect(titleText(30, "endless")).toBe("Club legend");
    expect(titleText(40, "endless")).toBe("World class");
    expect(titleText(50, "endless")).toBe("Immortal");
    expect(titleText(45, "ranked")).toBe("GOAT");
  });

  it("gives Friendly its own: Captain at fifteen, Legend for the win", () => {
    expect(titleText(4, "friendly")).toBe("");
    expect(titleText(5, "friendly")).toBe("Squad player");
    expect(titleText(10, "friendly")).toBe("Starter");
    expect(titleText(15, "friendly")).toBe("Captain");
    expect(titleText(19, "friendly")).toBe("Captain");
    expect(titleText(20, "friendly")).toBe("Legend");
  });
});

describe("the share text in Endless", () => {
  const history = run([...Array<Tier>(12).fill("basic"), "rare"]);
  const site = "https://biggerthangame.com";

  it("carries the streak, title, grid, the stat and the two players that ended it, and the site", () => {
    const text = shareText(12, history, "wrong", site, "endless", ["Zinedine Zidane", "Luís Figo"]);
    expect(text.split("\n")).toEqual([
      "Bigger Than — Football Legends",
      "12 in a row · Starter",
      "🟨".repeat(10),
      "🟨🟨❌",
      "Ended on: Club trophies — Zinedine Zidane v Luís Figo",
      site,
    ]);
  });

  it("names the players but never their figures, and carries no challenge link", () => {
    const text = shareText(3, run(["basic", "basic", "basic", "basic"]), "wrong", site, "endless", [
      "Anchor",
      "Challenger",
    ]);
    expect(text).toContain("Anchor v Challenger");
    expect(text.replace(site, "")).not.toMatch(/\d{2,}/);
    expect(text).not.toContain("challenge=");
  });

  it("says when the clock ran out", () => {
    const text = shareText(
      4,
      run(["basic", "basic", "basic", "basic", "rare"]),
      "timeout",
      site,
      "endless",
      ["A", "B"],
    );
    expect(text).toContain("Out of time on: Club trophies — A v B");
  });

  it("ends with the site after a dropped connection", () => {
    const text = shareText(1, run(["basic"], false), "network", site, "endless");
    expect(text.split("\n")).toEqual([
      "Bigger Than — Football Legends",
      "1 correct, then out",
      "🟨",
      site,
    ]);
  });

  it("says so when a run went the distance", () => {
    const text = shareText(2, run(["basic", "basic"], false), "deck-exhausted", "s", "endless");
    expect(text).toContain("Went the distance");
  });

  it("takes the names from the round that ended the run, in Endless only", () => {
    const state = {
      round: {
        index: 3,
        stat: { key: "caps" as const, label: "Caps", tier: "basic" as const, statChanged: false },
        anchor: { ...anchor("a", 91), name: "Anchor Name" },
        challenger: card("b", "Challenger Name"),
      },
      reveal: { round: 3, value: 88, display: "88", correct: false },
    };
    expect(endingNames(state, "endless")).toEqual(["Anchor Name", "Challenger Name"]);
    expect(endingNames(state, "friendly")).toBeNull();
    expect(endingNames({ ...state, reveal: null }, "endless")).toBeNull();
  });
});

describe("challenge links, shared on their own", () => {
  const site = "https://biggerthangame.com";

  it("read Beat n and the Endless page's link", () => {
    expect(challengeText(link(12), site, "endless")).toBe(
      `Beat 12 — https://biggerthangame.com/football-higher-or-lower/legends/endless?challenge=${encodeURIComponent(RUN_ID)}&score=12&sig=${SIG}`,
    );
  });

  it("don't exist in Friendly, or without a signed link", () => {
    expect(challengeText(link(12), site, "friendly")).toBeNull();
    expect(challengeText(null, site, "endless")).toBeNull();
  });
});

describe("the share text in Friendly", () => {
  const site = "https://biggerthangame.com";

  it("scores a lost run out of twenty, names no player, and ends with the site", () => {
    const history = run([...Array<Tier>(12).fill("basic"), "rare"]);
    const lines = shareText(12, history, "wrong", site, "friendly").split("\n");
    expect(lines[1]).toBe("12/20 · Starter");
    expect(lines[2]).toBe("🟨".repeat(10));
    expect(lines[3]).toBe("🟨🟨❌" + "⬛".repeat(7));
    expect(lines[4]).toBe("Ended on: Club trophies");
    expect(lines[5]).toBe(site);
    expect(lines).toHaveLength(6);
  });

  it("gives a won run a trophy and no ending stat", () => {
    const history = run(Array<Tier>(20).fill("uncommon"), false);
    const lines = shareText(20, history, "won", site, "friendly").split("\n");
    expect(lines[1]).toBe("🏆 20/20 · Legend");
    expect(lines.slice(2, 4)).toEqual(["🟦".repeat(10), "🟦".repeat(10)]);
    expect(lines[4]).toBe(site);
    expect(lines).toHaveLength(5);
  });

  it("gives no trophy for twenty in a mode without a target", () => {
    const history = run(Array<Tier>(20).fill("basic"), false);
    const text = shareText(20, history, "deck-exhausted", site, "endless");
    expect(text).not.toContain("🏆");
    expect(text).toContain("20 in a row · Captain");
  });
});

describe("challenge text", () => {
  it("reads Beat n/20 in Friendly and Match 20/20 for a won run", () => {
    expect(challengeHeading(7, "friendly")).toBe("Beat 7/20");
    expect(challengeHeading(20, "friendly")).toBe("Match 20/20");
    expect(challengeHeading(7, "endless")).toBe("Beat 7");
    expect(challengeIntro(7, "endless")).toContain("streak was 7");
    expect(challengeIntro(7, "endless")).toContain("a run of your own");
    expect(challengeIntro(20, "friendly")).toContain("Can you match it?");
  });

  it("frames a won replay of a won run as a match", () => {
    expect(outcomeText("matched", 20, "friendly")).toBe("You matched 20/20. Perfect.");
    expect(outcomeText("short", 20, "friendly")).toBe("20/20 to match. Not this time.");
    expect(outcomeText("beat", 12, "friendly")).toBe("You beat 12/20.");
  });
});

describe("the share card", () => {
  const over = (patch: Partial<GameState>): GameState => ({
    ...initialState(),
    phase: "over",
    ...patch,
  });

  it("shows the final round's players with the figures the player saw", () => {
    const round = {
      index: 3,
      stat: {
        key: "caps" as const,
        label: "International caps",
        tier: "basic" as const,
        statChanged: false,
      },
      anchor: { ...anchor("a", 91), name: "Anchor Name" },
      challenger: card("b", "Challenger Name"),
    };
    const c = over({
      round,
      reveal: { round: 3, value: 88, display: "88", correct: false },
      history: run(["basic", "basic", "basic"]),
      streak: 2,
    });
    const shared = shareCard(c, "biggerthangame.com", "endless");
    expect(shared.players).toEqual([
      { name: "Anchor Name", display: "91" },
      { name: "Challenger Name", display: "88" },
    ]);
    expect(shared.ended).toEqual({ label: "Ended on", stat: "International caps", tier: "basic" });
    expect(shared.challenge).toBe("");
    expect(shared.score).toBe("2");
    expect(shared.won).toBe(false);
  });

  it("frames a replay against its target", () => {
    const c = over({ streak: 13, challenge: { status: "accepted", score: 12 } });
    expect(shareCard(c, "s", "endless").challenge).toBe("You beat 12.");
    expect(shareCard({ ...c, streak: 12 }, "s", "endless").challenge).toBe(
      "You matched 12. So close.",
    );
    expect(shareCard({ ...c, streak: 2 }, "s", "endless").challenge).toBe(
      "12 to beat. Not this time.",
    );
    expect(shareCard({ ...c, streak: 2 }, "s", "friendly").challenge).toBe(
      "12/20 to beat. Not this time.",
    );
  });

  it("scores Friendly out of twenty, with twenty cells, and marks a win", () => {
    const lost = shareCard(
      over({ streak: 7, history: run(Array<Tier>(8).fill("basic")) }),
      "s",
      "friendly",
    );
    expect(lost.score).toBe("7/20");
    expect(lost.cells).toHaveLength(20);
    expect(lost.won).toBe(false);

    const won = shareCard(
      over({ streak: 20, end: "won", history: run(Array<Tier>(20).fill("basic"), false) }),
      "s",
      "friendly",
    );
    expect(won).toMatchObject({
      score: "20/20",
      won: true,
      title: "Legend",
      caption: "a perfect run",
    });
    expect(won.ended).toBeNull();
    expect(won.note).toBe("");
  });
});

// ------------------------------------------------------------- the image

const tokensCss = readFileSync(
  fileURLToPath(new URL("../../styles/tokens.css", import.meta.url)),
  "utf8",
);
const tokens = new Map<string, string>();
for (const m of tokensCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  tokens.set(m[1] as string, (m[2] as string).trim());
}
const read = (p: string) => tokens.get(p) ?? "";

describe("share image tokens", () => {
  it.each(Object.entries(SHARE_LAYOUT_TOKENS))("%s is %s in tokens.css", (_, property) => {
    expect(tokens.has(property), property).toBe(true);
  });

  it("reads back the fallbacks from tokens.css exactly", () => {
    expect(readShareLayout(read)).toEqual(SHARE_LAYOUT);
  });

  it("is 1080×1350", () => {
    expect([SHARE_LAYOUT.width, SHARE_LAYOUT.height]).toEqual([1080, 1350]);
  });

  it("reads the palette, faces and gradient from the tokens", () => {
    const palette = readPalette(read);
    expect(palette.tiers).toEqual({ basic: "#ffc24d", uncommon: "#5ab9f0", rare: "#c77dff" });
    expect(palette.faces.num).toEqual({ weight: 800, width: 118 });
    expect(palette.legends.map((s) => s.at)).toEqual([0, 0.32, 0.62, 1]);
  });

  it("parses variation settings, gradients and widths", () => {
    expect(parseVariation('"wdth" 90, "wght" 700')).toEqual({ width: 90, weight: 700 });
    expect(parseGradientStops("linear-gradient(1deg, #fff 0%, rgba(0, 0, 0, 0.5) 50%)")).toEqual([
      { color: "#fff", at: 0 },
      { color: "rgba(0, 0, 0, 0.5)", at: 0.5 },
    ]);
    expect(stretchKeyword(118)).toBe("semi-expanded");
    expect(stretchKeyword(100)).toBe("normal");
    expect(stretchKeyword(88)).toBe("semi-condensed");
  });
});

/** A canvas that records text and never draws an image. */
function recorder() {
  const texts: string[] = [];
  const calls = new Set<string>();
  const ctx: Canvas2D & Record<string, unknown> = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    font: "10px x",
    textAlign: "left",
    textBaseline: "alphabetic",
    fontStretch: "normal",
    fillRect: () => calls.add("fillRect"),
    fillText: (t: string) => void texts.push(t),
    measureText: (t: string) => ({ width: t.length * 20 }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => calls.add("fill"),
    stroke: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }) as unknown as CanvasGradient,
  };
  return { ctx, texts, calls };
}

describe("drawing the share image", () => {
  const brand = { bigger: "Bigger", than: "Than", middle: " Game — Football ", legends: "Legends" };
  const card = {
    score: "12",
    won: false,
    caption: "in a row",
    title: "Starter",
    cells: [...Array(12).fill({ kind: "hit", tier: "basic" }), { kind: "miss" }] as ReturnType<
      typeof shareCard
    >["cells"],
    ended: { label: "Ended on", stat: "Club trophies", tier: "rare" as const },
    note: "",
    players: [
      { name: "Anchor Name", display: "14" },
      { name: "Challenger Name", display: "9" },
    ] as const,
    challenge: "You beat 11.",
    site: "biggerthangame.com",
  };

  it("writes every part of the card, and draws no image", () => {
    const { ctx, texts } = recorder();
    drawShareCard(ctx, card, readPalette(read), SHARE_LAYOUT, brand);
    for (const expected of [
      "12",
      "in a row",
      "Starter",
      "You beat 11.",
      "Ended on",
      "Club trophies",
      "Anchor Name",
      "14",
      "Challenger Name",
      "9",
      "biggerthangame.com",
      "Legends",
    ]) {
      expect(texts).toContain(expected);
    }
    expect(ctx).not.toHaveProperty("drawImage");
  });

  it("copes with a run that has no players or grid to show", () => {
    const { ctx, texts } = recorder();
    drawShareCard(
      ctx,
      { ...card, cells: [], players: null, ended: null, title: "", challenge: "" },
      readPalette(read),
      SHARE_LAYOUT,
      brand,
    );
    expect(texts).toContain("12");
  });

  it("draws a won Friendly run: the score out of twenty, a trophy, empty cells edged", () => {
    const { ctx, texts, calls } = recorder();
    const strokes: string[] = [];
    ctx.stroke = () => void strokes.push(String(ctx.strokeStyle));
    const palette = readPalette(read);
    drawShareCard(
      ctx,
      {
        ...card,
        score: "20/20",
        won: true,
        title: "Legend",
        cells: [
          ...Array(18).fill({ kind: "hit", tier: "basic" }),
          { kind: "empty" },
          { kind: "empty" },
        ],
        ended: null,
      },
      palette,
      SHARE_LAYOUT,
      brand,
    );
    expect(texts).toContain("20/20");
    expect(texts).toContain("Legend");
    expect(calls.has("fillRect")).toBe(true);
    expect(strokes.filter((s) => s === palette.empty)).toHaveLength(2);
  });
});

// ------------------------------------------------------------- the platform

function platform(patch: Partial<SharePlatform>): SharePlatform & { saved: string[] } {
  const saved: string[] = [];
  return { touch: false, download: (_b, name) => void saved.push(name), saved, ...patch };
}

describe("sharing the text", () => {
  it("copies to the clipboard on a desktop, even where a share sheet exists", async () => {
    const copied: string[] = [];
    const shared: ShareData[] = [];
    const p = platform({
      share: async (d) => void shared.push(d),
      writeText: async (t) => void copied.push(t),
    });
    expect(await shareResultText("hello", p)).toBe("copied");
    expect(copied).toEqual(["hello"]);
    expect(shared).toEqual([]);
  });

  it("uses the share sheet on a phone", async () => {
    const shared: ShareData[] = [];
    const p = platform({ touch: true, share: async (d) => void shared.push(d) });
    expect(await shareResultText("hello", p)).toBe("shared");
    expect(shared).toEqual([{ text: "hello" }]);
  });

  it("treats closing the sheet as a cancel, not a failure", async () => {
    const p = platform({
      touch: true,
      share: async () => {
        throw new DOMException("closed", "AbortError");
      },
    });
    expect(await shareResultText("x", p)).toBe("cancelled");
  });

  it("falls back to copying when the sheet fails, and reports a refused clipboard", async () => {
    const copied: string[] = [];
    const broken = async () => {
      throw new Error("nope");
    };
    const p = platform({ touch: true, share: broken, writeText: async (t) => void copied.push(t) });
    expect(await shareResultText("x", p)).toBe("copied");
    expect(await shareResultText("x", platform({ writeText: broken }))).toBe("failed");
    expect(await shareResultText("x", platform({}))).toBe("failed");
  });
});

describe("sharing the image", () => {
  const blob = new Blob(["png"], { type: "image/png" });

  it("downloads on a desktop", async () => {
    const p = platform({ share: async () => {}, canShare: () => true });
    expect(await shareResultImage(blob, "bigger-than-3.png", p)).toBe("saved");
    expect(p.saved).toEqual(["bigger-than-3.png"]);
  });

  it("shares the file on a phone that can", async () => {
    const shared: ShareData[] = [];
    const p = platform({
      touch: true,
      share: async (d) => void shared.push(d),
      canShare: (d) => (d.files?.length ?? 0) > 0,
    });
    expect(await shareResultImage(blob, "a.png", p)).toBe("shared");
    expect(shared[0]?.files?.[0]?.name).toBe("a.png");
    expect(p.saved).toEqual([]);
  });

  it("downloads on a phone that can't share files", async () => {
    const p = platform({ touch: true, share: async () => {}, canShare: () => false });
    expect(await shareResultImage(blob, "a.png", p)).toBe("saved");
  });
});
