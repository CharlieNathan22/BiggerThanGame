/**
 * Sharing, as the browser does it: the share sheet on phones, the clipboard or
 * a download elsewhere. The platform is injected, so the choices are tested in
 * Node with fakes.
 *
 * Why the share sheet only on touch devices: desktop browsers that have
 * `navigator.share` open a system dialog most people have never used, where a
 * copied link or a downloaded file is what they expect.
 */

import { t } from "../i18n";
import { drawShareCard, readPalette, readShareLayout, shareFonts } from "./share-image";
import type { Canvas2D, ShareBrand } from "./share-image";
import type { ShareCard } from "./share";

export interface SharePlatform {
  /** A phone or tablet, where the share sheet is the natural way to share. */
  readonly touch: boolean;
  readonly share?: (data: ShareData) => Promise<void>;
  readonly canShare?: (data: ShareData) => boolean;
  readonly writeText?: (text: string) => Promise<void>;
  /** Saves `blob` as a file called `name`. */
  readonly download: (blob: Blob, name: string) => void;
}

export type TextShareResult = "shared" | "copied" | "cancelled" | "failed";
export type ImageShareResult = "shared" | "saved" | "cancelled" | "failed";

/** The share text: the share sheet on a phone, otherwise the clipboard. */
export async function shareResultText(
  text: string,
  platform: SharePlatform,
): Promise<TextShareResult> {
  if (platform.touch && platform.share !== undefined) {
    try {
      await platform.share({ text });
      return "shared";
    } catch (err) {
      if (isAbort(err)) return "cancelled";
      // A share sheet that failed for any other reason: fall back to copying.
    }
  }
  if (platform.writeText === undefined) return "failed";
  try {
    await platform.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/** The share image: as a file to the share sheet on a phone, otherwise a download. */
export async function shareResultImage(
  blob: Blob,
  name: string,
  platform: SharePlatform,
): Promise<ImageShareResult> {
  const file = new File([blob], name, { type: "image/png" });
  const data: ShareData = { files: [file] };
  if (platform.touch && platform.share !== undefined && platform.canShare?.(data) === true) {
    try {
      await platform.share(data);
      return "shared";
    } catch (err) {
      if (isAbort(err)) return "cancelled";
    }
  }
  try {
    platform.download(blob, name);
    return "saved";
  } catch {
    return "failed";
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** The real browser. */
export function browserSharePlatform(): SharePlatform {
  const nav = navigator;
  return {
    touch: matchMedia("(pointer: coarse)").matches,
    ...(typeof nav.share === "function" ? { share: (d: ShareData) => nav.share(d) } : {}),
    ...(typeof nav.canShare === "function" ? { canShare: (d: ShareData) => nav.canShare(d) } : {}),
    ...(nav.clipboard !== undefined
      ? { writeText: (text: string) => nav.clipboard.writeText(text) }
      : {}),
    download: (blob, name) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      // Give the download a moment to start before the URL goes.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

/**
 * Draws the share image and returns it as a PNG. Waits for the page's fonts
 * first, so Archivo and Cinzel render rather than a fallback. No network: the
 * faces are the ones the page has already loaded.
 */
export async function renderShareImage(card: ShareCard): Promise<Blob> {
  const style = getComputedStyle(document.documentElement);
  const read = (property: string) => style.getPropertyValue(property);
  const layout = readShareLayout(read);
  const palette = readPalette(read);
  const brand: ShareBrand = {
    bigger: t("brand.bigger"),
    than: t("brand.than"),
    middle: ` ${t("brand.game")} — ${t("brand.football")} `,
    legends: t("brand.legends"),
  };

  const sample = [card.title, card.caption, card.ended?.stat ?? "", ...(card.players ?? [])]
    .map((p) => (typeof p === "string" ? p : `${p.name} ${p.display}`))
    .join(" ");
  await Promise.all(
    shareFonts(palette, layout).map((font) =>
      document.fonts.load(font, `${sample} 0123456789 ${brand.legends}`).catch(() => []),
    ),
  );
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas");
  drawShareCard(ctx as unknown as Canvas2D, card, palette, layout, brand);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  );
}
