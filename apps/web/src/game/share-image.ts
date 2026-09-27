/**
 * The share image: a 1080×1350 PNG drawn on a canvas in the browser when a run
 * ends (DESIGN.md §13). Score, streak title, the grid, the stat that ended it,
 * the final round's two players with their revealed figures, and the site. In
 * a mode with a win target the score reads "7/20", the grid shows every round
 * of the challenge (the ones not reached empty), and a won run has a trophy.
 *
 * **No player photos.** Their CC-BY and CC-BY-SA licences require attribution
 * that can't travel with a shared image, so the image is type and colour only.
 * Nothing here touches the network: the fonts are the page's own, already
 * loaded, and the result is a local blob. It works offline once the run is over.
 *
 * Every colour, font and size comes from `styles/tokens.css`, read from the
 * computed style when drawing, so the image restyles with the site. The size
 * tokens are `--share-*`; `SHARE_LAYOUT` holds their fallbacks and a test keeps
 * the two equal.
 */

import type { Tier } from "@bt/core";
import type { GridCell, ShareCard } from "./share";

export interface ShareLayout {
  readonly width: number;
  readonly height: number;
  readonly pad: number;
  readonly barHeight: number;
  readonly gap: number;
  readonly brandSize: number;
  readonly legendsSize: number;
  readonly scoreSize: number;
  readonly captionSize: number;
  readonly titleSize: number;
  readonly labelSize: number;
  readonly plaqueSize: number;
  readonly plaqueWidth: number;
  readonly plaqueHeight: number;
  readonly nameSize: number;
  readonly valueSize: number;
  readonly noteSize: number;
  readonly urlSize: number;
  readonly cell: number;
  readonly cellGap: number;
  readonly cellRadius: number;
  readonly columns: number;
  readonly trophySize: number;
}

export const SHARE_LAYOUT: ShareLayout = {
  width: 1080,
  height: 1350,
  pad: 84,
  barHeight: 132,
  gap: 44,
  brandSize: 40,
  legendsSize: 52,
  scoreSize: 280,
  captionSize: 40,
  titleSize: 58,
  labelSize: 30,
  plaqueSize: 36,
  plaqueWidth: 560,
  plaqueHeight: 88,
  nameSize: 40,
  valueSize: 76,
  noteSize: 34,
  urlSize: 34,
  cell: 56,
  cellGap: 12,
  cellRadius: 12,
  columns: 10,
  trophySize: 132,
};

export const SHARE_LAYOUT_TOKENS: Readonly<Record<keyof ShareLayout, string>> = {
  width: "--share-w",
  height: "--share-h",
  pad: "--share-pad",
  barHeight: "--share-bar-h",
  gap: "--share-gap",
  brandSize: "--share-fs-brand",
  legendsSize: "--share-fs-legends",
  scoreSize: "--share-fs-score",
  captionSize: "--share-fs-caption",
  titleSize: "--share-fs-title",
  labelSize: "--share-fs-label",
  plaqueSize: "--share-fs-plaque",
  plaqueWidth: "--share-plaque-w",
  plaqueHeight: "--share-plaque-h",
  nameSize: "--share-fs-name",
  valueSize: "--share-fs-value",
  noteSize: "--share-fs-note",
  urlSize: "--share-fs-url",
  cell: "--share-cell",
  cellGap: "--share-cell-gap",
  cellRadius: "--share-cell-radius",
  columns: "--share-columns",
  trophySize: "--share-trophy",
};

/** A pixel token as a number: `56px` or `56`. */
export function parsePx(raw: string): number | undefined {
  const match = /^\s*(\d*\.?\d+)(px)?\s*$/.exec(raw);
  return match ? Number(match[1]) : undefined;
}

export function readShareLayout(read: (property: string) => string): ShareLayout {
  const out: Record<string, number> = { ...SHARE_LAYOUT };
  for (const [name, property] of Object.entries(SHARE_LAYOUT_TOKENS)) {
    const value = parsePx(read(property));
    if (value !== undefined && value > 0) out[name] = value;
  }
  return out as unknown as ShareLayout;
}

/** The colours and faces the image uses, as the tokens give them. */
export interface SharePalette {
  readonly night: string;
  readonly ink: string;
  readonly chalk: string;
  readonly dim: string;
  readonly rule: string;
  readonly gold: string;
  readonly goldRule: string;
  readonly miss: string;
  /** The edge of a round the run didn't reach. */
  readonly empty: string;
  readonly tiers: Readonly<Record<Tier, string>>;
  /** `--legends-gradient`'s stops, for "Legends" and the streak title. */
  readonly legends: readonly GradientStop[];
  readonly fontUi: string;
  readonly fontDisplay: string;
  /** Archivo weight and width per role, from the `--fv-*` tokens. */
  readonly faces: Readonly<Record<FaceRole, Face>>;
  readonly legendsWeight: string;
}

export type FaceRole = "num" | "brand" | "name" | "caption" | "caps" | "plaque";

export interface Face {
  readonly weight: number;
  readonly width: number;
}

const FACE_TOKENS: Readonly<Record<FaceRole, string>> = {
  num: "--fv-num",
  brand: "--fv-brand",
  name: "--fv-name",
  caption: "--fv-caption",
  caps: "--fv-caps",
  plaque: "--fv-plaque",
};

export interface GradientStop {
  readonly color: string;
  /** 0–1 */
  readonly at: number;
}

/** `"wdth" 118, "wght" 800` → `{ width: 118, weight: 800 }`. */
export function parseVariation(raw: string): Face {
  const axis = (name: string, fallback: number): number => {
    const match = new RegExp(`["']${name}["']\\s+(\\d+(?:\\.\\d+)?)`).exec(raw);
    return match ? Number(match[1]) : fallback;
  };
  return { weight: axis("wght", 400), width: axis("wdth", 100) };
}

/** A `linear-gradient(…)` token's colour stops, in order. */
export function parseGradientStops(raw: string): GradientStop[] {
  const stops: GradientStop[] = [];
  const pattern = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s+(\d+(?:\.\d+)?)%/g;
  for (const match of raw.matchAll(pattern)) {
    stops.push({ color: match[1] as string, at: Number(match[2]) / 100 });
  }
  return stops;
}

/**
 * Canvas can't set a variable font's width axis directly; `fontStretch` takes
 * keywords only. The keyword nearest the token's `wdth`.
 */
export function stretchKeyword(width: number): string {
  const keywords: readonly [number, string][] = [
    [62.5, "extra-condensed"],
    [75, "condensed"],
    [87.5, "semi-condensed"],
    [100, "normal"],
    [112.5, "semi-expanded"],
    [125, "expanded"],
  ];
  let best = keywords[3] as [number, string];
  for (const k of keywords) if (Math.abs(k[0] - width) < Math.abs(best[0] - width)) best = k;
  return best[1];
}

export function readPalette(read: (property: string) => string): SharePalette {
  const get = (property: string, fallback: string): string => read(property).trim() || fallback;
  const faces = Object.fromEntries(
    Object.entries(FACE_TOKENS).map(([role, property]) => [role, parseVariation(read(property))]),
  ) as Record<FaceRole, Face>;
  return {
    night: get("--night", "#0a1a22"),
    ink: get("--ink", "#06121a"),
    chalk: get("--chalk", "#eef3f1"),
    dim: get("--dim", "rgba(238, 243, 241, 0.66)"),
    rule: get("--rule", "rgba(238, 243, 241, 0.13)"),
    gold: get("--gold", "#ffb020"),
    goldRule: get("--gold-rule", "rgba(255, 176, 32, 0.28)"),
    miss: get("--miss", "#b8322a"),
    empty: get("--grid-empty-edge", "rgba(238, 243, 241, 0.28)"),
    tiers: {
      basic: get("--t-basic", "#ffc24d"),
      uncommon: get("--t-unc", "#5ab9f0"),
      rare: get("--t-rare", "#c77dff"),
    },
    legends: parseGradientStops(read("--legends-gradient")),
    fontUi: get("--font-ui", "sans-serif"),
    fontDisplay: get("--font-display", "serif"),
    faces,
    legendsWeight: get("--fw-legends", "600"),
  };
}

/**
 * The drawing surface: the parts of `CanvasRenderingContext2D` this uses, so a
 * test can draw onto a recorder. Deliberately no `drawImage` — there are no
 * photos to draw.
 */
export interface Canvas2D {
  fillStyle: string | CanvasGradient;
  strokeStyle: string | CanvasGradient;
  lineWidth: number;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fontStretch?: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
}

/** The font strings the image needs, so the caller can make sure they're loaded. */
export function shareFonts(palette: SharePalette, layout: ShareLayout): string[] {
  const f = (role: FaceRole, size: number) =>
    `${palette.faces[role].weight} ${size}px ${palette.fontUi}`;
  return [
    f("num", layout.scoreSize),
    f("brand", layout.brandSize),
    f("name", layout.nameSize),
    f("caption", layout.captionSize),
    f("caps", layout.labelSize),
    f("plaque", layout.plaqueSize),
    `${palette.legendsWeight} ${layout.legendsSize}px ${palette.fontDisplay}`,
  ];
}

/** The title bar's words: "Bigger " "Than" " Game — Football " "Legends". */
export interface ShareBrand {
  readonly bigger: string;
  readonly than: string;
  readonly middle: string;
  readonly legends: string;
}

/** Draws `card` over the whole of a `layout.width` × `layout.height` canvas. */
export function drawShareCard(
  ctx: Canvas2D,
  card: ShareCard,
  palette: SharePalette,
  layout: ShareLayout,
  brand: ShareBrand,
): void {
  const { width: W, height: H, pad } = layout;
  const centre = W / 2;

  const face = (role: FaceRole, size: number): void => {
    const f = palette.faces[role];
    ctx.font = `${f.weight} ${size}px ${palette.fontUi}`;
    if ("fontStretch" in ctx) ctx.fontStretch = stretchKeyword(f.width);
  };
  const display = (size: number): void => {
    ctx.font = `${palette.legendsWeight} ${size}px ${palette.fontDisplay}`;
    if ("fontStretch" in ctx) ctx.fontStretch = "normal";
  };
  /** Shrinks the current font until `text` fits `max`, down to 60%. */
  const fit = (text: string, size: number, max: number, set: (s: number) => void): number => {
    let s = size;
    set(s);
    while (ctx.measureText(text).width > max && s > size * 0.6) set((s -= 2));
    return s;
  };
  const gradient = (top: number, bottom: number): CanvasGradient | string => {
    if (palette.legends.length === 0) return palette.gold;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    for (const stop of palette.legends) g.addColorStop(stop.at, stop.color);
    return g;
  };

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.night;
  ctx.fillRect(0, 0, W, H);

  // The title bar: ink, a gold rule, "Bigger Than Game — Football Legends".
  ctx.fillStyle = palette.ink;
  ctx.fillRect(0, 0, W, layout.barHeight);
  ctx.fillStyle = palette.goldRule;
  ctx.fillRect(0, layout.barHeight - 2, W, 2);
  const brandBase = layout.barHeight / 2 + layout.brandSize * 0.36;
  face("brand", layout.brandSize);
  const parts = [brand.bigger, brand.than, brand.middle];
  const partWidths = parts.map((p) => ctx.measureText(p).width);
  display(layout.legendsSize);
  const legendsWord = brand.legends;
  const legendsWidth = ctx.measureText(legendsWord).width;
  let x = centre - (partWidths.reduce((a, b) => a + b, 0) + legendsWidth) / 2;
  ctx.textAlign = "left";
  face("brand", layout.brandSize);
  parts.forEach((p, i) => {
    ctx.fillStyle = i === 1 ? palette.gold : i === 2 ? palette.dim : palette.chalk;
    ctx.fillText(p, x, brandBase);
    x += partWidths[i] ?? 0;
  });
  display(layout.legendsSize);
  ctx.fillStyle = gradient(brandBase - layout.legendsSize * 0.8, brandBase);
  ctx.fillText(legendsWord, x, brandBase);

  // The body, stacked and centred between the bar and the footer.
  ctx.textAlign = "center";
  const rows = Math.ceil(card.cells.length / layout.columns);
  const gridH = rows > 0 ? rows * layout.cell + (rows - 1) * layout.cellGap : 0;
  const blocks: { h: number; draw: (top: number) => void }[] = [];

  if (card.won) {
    blocks.push({
      h: layout.trophySize,
      draw: (top) => drawTrophy(centre, top, layout.trophySize),
    });
  }
  blocks.push({
    h: layout.scoreSize * 0.78 + layout.captionSize * 1.4,
    draw: (top) => {
      ctx.fillStyle = palette.gold;
      // "20/20" is wider than a streak: it shrinks to fit rather than overrun.
      fit(card.score, layout.scoreSize, W - pad * 2, (s) => face("num", s));
      ctx.fillText(card.score, centre, top + layout.scoreSize * 0.74);
      face("caption", layout.captionSize);
      ctx.fillStyle = palette.dim;
      ctx.fillText(card.caption, centre, top + layout.scoreSize * 0.78 + layout.captionSize * 1.2);
    },
  });
  if (card.title !== "") {
    blocks.push({
      h: layout.titleSize,
      draw: (top) => {
        display(layout.titleSize);
        ctx.fillStyle = gradient(top, top + layout.titleSize);
        ctx.fillText(card.title, centre, top + layout.titleSize * 0.82);
      },
    });
  }
  if (card.challenge !== "") {
    blocks.push({
      h: layout.noteSize * 1.2,
      draw: (top) => {
        face("caption", layout.noteSize);
        ctx.fillStyle = palette.chalk;
        ctx.fillText(card.challenge, centre, top + layout.noteSize);
      },
    });
  }
  if (rows > 0) {
    blocks.push({ h: gridH, draw: (top) => drawGrid(top) });
  }
  if (card.ended !== null) {
    const ended = card.ended;
    blocks.push({
      h: layout.labelSize * 1.5 + layout.plaqueHeight,
      draw: (top) => {
        face("caps", layout.labelSize);
        ctx.fillStyle = palette.dim;
        ctx.fillText(ended.label, centre, top + layout.labelSize);
        const py = top + layout.labelSize * 1.5;
        const px = centre - layout.plaqueWidth / 2;
        ctx.fillStyle = palette.tiers[ended.tier];
        roundRect(px, py, layout.plaqueWidth, layout.plaqueHeight, layout.plaqueHeight / 2);
        ctx.fill();
        ctx.fillStyle = palette.ink;
        fit(ended.stat, layout.plaqueSize, layout.plaqueWidth - 48, (s) => face("plaque", s));
        ctx.fillText(ended.stat, centre, py + layout.plaqueHeight / 2 + layout.plaqueSize * 0.36);
      },
    });
  } else if (card.note !== "") {
    blocks.push({
      h: layout.noteSize * 1.2,
      draw: (top) => {
        face("caption", layout.noteSize);
        ctx.fillStyle = palette.dim;
        ctx.fillText(card.note, centre, top + layout.noteSize);
      },
    });
  }
  if (card.players !== null) {
    const players = card.players;
    const tier = card.ended?.tier ?? "basic";
    blocks.push({
      h: layout.nameSize * 1.4 + layout.valueSize,
      draw: (top) => {
        const colW = (W - pad * 2 - layout.gap) / 2;
        players.forEach((p, i) => {
          const cx = pad + colW / 2 + i * (colW + layout.gap);
          ctx.fillStyle = palette.chalk;
          fit(p.name, layout.nameSize, colW, (s) => face("name", s));
          ctx.fillText(p.name, cx, top + layout.nameSize);
          ctx.fillStyle = palette.tiers[tier];
          fit(p.display, layout.valueSize, colW, (s) => face("num", s));
          ctx.fillText(p.display, cx, top + layout.nameSize * 1.4 + layout.valueSize * 0.82);
        });
        ctx.strokeStyle = palette.rule;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centre, top);
        ctx.lineTo(centre, top + layout.nameSize * 1.4 + layout.valueSize);
        ctx.stroke();
      },
    });
  }

  const footerTop = H - pad - layout.urlSize;
  const room = footerTop - layout.barHeight;
  const content = blocks.reduce((sum, b) => sum + b.h, 0);
  const gap = Math.min(layout.gap * 1.4, Math.max(16, (room - content) / (blocks.length + 1)));
  let y = layout.barHeight + (room - content - gap * (blocks.length - 1)) / 2;
  for (const block of blocks) {
    block.draw(y);
    y += block.h + gap;
  }

  // The footer: the site, over a rule.
  ctx.fillStyle = palette.rule;
  ctx.fillRect(pad, footerTop - layout.urlSize * 0.9, W - pad * 2, 2);
  face("caption", layout.urlSize);
  ctx.fillStyle = palette.gold;
  ctx.fillText(card.site, centre, H - pad);

  function drawGrid(top: number): void {
    const { cell, cellGap, columns, cellRadius } = layout;
    card.cells.forEach((c: GridCell, i) => {
      const row = Math.floor(i / columns);
      const inRow = Math.min(columns, card.cells.length - row * columns);
      const rowW = inRow * cell + (inRow - 1) * cellGap;
      const cx = centre - rowW / 2 + (i % columns) * (cell + cellGap);
      const cy = top + row * (cell + cellGap);
      if (c.kind === "empty") {
        // A round not reached: an edge, no fill.
        const edge = 3;
        ctx.strokeStyle = palette.empty;
        ctx.lineWidth = edge;
        roundRect(cx + edge / 2, cy + edge / 2, cell - edge, cell - edge, cellRadius - edge / 2);
        ctx.stroke();
        return;
      }
      ctx.fillStyle = c.kind === "miss" ? palette.miss : palette.tiers[c.tier];
      roundRect(cx, cy, cell, cell, cellRadius);
      ctx.fill();
      if (c.kind === "miss") {
        // A cross, so the miss isn't told by colour alone.
        const inset = cell * 0.3;
        ctx.strokeStyle = palette.chalk;
        ctx.lineWidth = cell * 0.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + inset, cy + inset);
        ctx.lineTo(cx + cell - inset, cy + cell - inset);
        ctx.moveTo(cx + cell - inset, cy + inset);
        ctx.lineTo(cx + inset, cy + cell - inset);
        ctx.stroke();
      }
    });
  }

  /** A trophy in the gold-leaf gradient, `size` square, its top centre at (`cx`, `top`). */
  function drawTrophy(cx: number, top: number, size: number): void {
    const u = size / 100;
    const gold = gradient(top, top + size);
    // The cup: straight sides into a rounded bowl.
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(cx - 30 * u, top);
    ctx.lineTo(cx + 30 * u, top);
    ctx.lineTo(cx + 30 * u, top + 26 * u);
    ctx.arcTo(cx + 30 * u, top + 58 * u, cx, top + 58 * u, 30 * u);
    ctx.arcTo(cx - 30 * u, top + 58 * u, cx - 30 * u, top + 26 * u, 30 * u);
    ctx.closePath();
    ctx.fill();
    // The handles.
    ctx.strokeStyle = gold;
    ctx.lineWidth = 7 * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(cx + side * 30 * u, top + 10 * u);
      ctx.lineTo(cx + side * 44 * u, top + 10 * u);
      ctx.arcTo(cx + side * 44 * u, top + 36 * u, cx + side * 26 * u, top + 38 * u, 16 * u);
    }
    ctx.stroke();
    // The stem and the base.
    ctx.fillRect(cx - 5 * u, top + 56 * u, 10 * u, 20 * u);
    ctx.fillRect(cx - 17 * u, top + 76 * u, 34 * u, 9 * u);
    ctx.fillRect(cx - 26 * u, top + 88 * u, 52 * u, 12 * u);
  }

  function roundRect(rx: number, ry: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(rx + r, ry);
    ctx.arcTo(rx + w, ry, rx + w, ry + h, r);
    ctx.arcTo(rx + w, ry + h, rx, ry + h, r);
    ctx.arcTo(rx, ry + h, rx, ry, r);
    ctx.arcTo(rx, ry, rx + w, ry, r);
    ctx.closePath();
  }
}
