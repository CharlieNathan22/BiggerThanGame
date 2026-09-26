import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STREAK_TITLES } from "@bt/core";
import type { Tier } from "@bt/core";
import { describe, expect, it } from "vitest";
import { en } from "../../i18n/en";
import { initialState } from "../machine";
import type { GameState, RoundRecord } from "../machine";
import { gridLabel, shareCard, shareGrid, shareText, titleText } from "../share";
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

describe("the share grid", () => {
  it("draws a tier square per answered round and a cross for the miss", () => {
    expect(shareGrid(run(["basic", "uncommon", "rare", "rare"]))).toBe("🟨🟦🟪❌");
  });

  it("wraps at ten", () => {
    const grid = shareGrid(run(Array<Tier>(23).fill("basic")));
    expect(grid.split("\n").map((l) => [...l].length)).toEqual([10, 10, 3]);
  });

  it("has no cross when the run wasn't lost", () => {
    expect(shareGrid(run(["basic", "basic"], false))).toBe("🟨🟨");
  });

  it("labels the tiers for a screen reader, colour aside", () => {
    expect(gridLabel(run(["basic", "basic", "rare", "uncommon"]))).toBe(
      "Your run: 2 basic, 0 uncommon and 1 rare stats right. Out on Highest transfer fee.",
    );
  });
});

describe("streak titles in text", () => {
  it("has words for every title in core's table", () => {
    for (const title of STREAK_TITLES) expect(en[`title.${title.id}`]).toBeTruthy();
  });

  it("gives none below five", () => {
    expect(titleText(4)).toBe("");
    expect(titleText(10)).toBe("Starter");
    expect(titleText(50)).toBe("GOAT");
  });
});

describe("the share text", () => {
  const history = run([...Array<Tier>(12).fill("basic"), "rare"]);

  it("carries score, title, grid, the ending stat and the challenge link", () => {
    const text = shareText(12, history, "wrong", link(12), "https://biggerthangame.com");
    const lines = text.split("\n");
    expect(lines[0]).toBe("Bigger Than — Football Legends");
    expect(lines[1]).toBe("12 in a row · Starter");
    expect(lines[2]).toBe("🟨".repeat(10));
    expect(lines[3]).toBe("🟨🟨❌");
    expect(lines[4]).toBe("Ended on: Club trophies");
    expect(lines[5]).toBe(
      `Can you beat 12? https://biggerthangame.com/?challenge=${encodeURIComponent(RUN_ID)}&score=12&sig=${SIG}`,
    );
    expect(lines).toHaveLength(6);
  });

  it("names no player and no value", () => {
    const text = shareText(
      3,
      run(["basic", "basic", "basic", "basic"]),
      "wrong",
      link(3),
      "https://s",
    );
    expect(text).not.toMatch(/\bp\d\b/);
    expect(text.replace(/https?:\S+/, "")).not.toMatch(/\d{2,}/);
  });

  it("falls back to the site's address without a signed link", () => {
    const text = shareText(1, run(["basic"], false), "network", null, "https://biggerthangame.com");
    expect(text.split("\n")).toEqual([
      "Bigger Than — Football Legends",
      "1 correct, then out",
      "🟨",
      "https://biggerthangame.com",
    ]);
  });

  it("says so when a run went the distance", () => {
    const text = shareText(2, run(["basic", "basic"], false), "deck-exhausted", link(2), "s");
    expect(text).toContain("Went the distance");
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
      stat: { key: "caps" as const, label: "Caps", tier: "basic" as const, statChanged: false },
      anchor: { ...anchor("a", 91), name: "Anchor Name" },
      challenger: card("b", "Challenger Name"),
    };
    const c = over({
      round,
      reveal: { round: 3, value: 88, display: "88", correct: false },
      history: run(["basic", "basic", "basic"]),
      streak: 2,
    });
    const shared = shareCard(c, "biggerthangame.com");
    expect(shared.players).toEqual([
      { name: "Anchor Name", display: "91" },
      { name: "Challenger Name", display: "88" },
    ]);
    expect(shared.ended).toEqual({ label: "Ended on", stat: "Caps", tier: "basic" });
    expect(shared.challenge).toBe("");
  });

  it("frames a replay against its target", () => {
    const c = over({ streak: 13, challenge: { status: "accepted", score: 12 } });
    expect(shareCard(c, "s").challenge).toBe("You beat 12.");
    expect(shareCard({ ...c, streak: 12 }, "s").challenge).toBe("You matched 12. So close.");
    expect(shareCard({ ...c, streak: 2 }, "s").challenge).toBe("12 to beat. Not this time.");
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
    score: 12,
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
