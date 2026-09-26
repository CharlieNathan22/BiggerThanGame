import { describe, expect, it } from "vitest";
import { IMAGE_BASE } from "../../config";
import { createPreloader, focusPosition, photoSizes, photoSources } from "../photos";
import type { ImageLike } from "../photos";

const KEY = "legends/originals/zidane-zinedine.a3f9c21e0b1d4e7f.jpg";
const portrait = { key: KEY, width: 1600, height: 2400 };

describe("photoSources", () => {
  // The Cloudflare configuration on the image host depends on these URLs
  // exactly: same two widths, same options in the same order, no query string.
  it("builds exactly the approved transformation URLs", () => {
    const { src, srcset } = photoSources(IMAGE_BASE, portrait);
    const url = (w: number) =>
      `https://img.biggerthangame.com/cdn-cgi/image/width=${w},quality=80,fit=scale-down,format=auto,onerror=redirect/${KEY}`;
    expect(src).toBe(url(800));
    expect(srcset).toBe(`${url(800)} 800w, ${url(1600)} 1600w`);
    expect(srcset).not.toContain("?");
  });
});

describe("photoSizes", () => {
  it("draws a portrait at its half's width", () => {
    expect(photoSizes({ width: 800, height: 1200 })).toBe(
      "(min-width: 780px) max(50vw, 66.7vh), max(100vw, 33.3vh)",
    );
  });

  it("allows for a landscape drawn wider than its half by the cover crop", () => {
    expect(photoSizes({ width: 1500, height: 1000 })).toBe(
      "(min-width: 780px) max(50vw, 150vh), max(100vw, 75vh)",
    );
  });

  it("treats a photo with no size as square", () => {
    expect(photoSizes({ width: 0, height: 0 })).toBe(
      "(min-width: 780px) max(50vw, 100vh), max(100vw, 50vh)",
    );
  });
});

describe("focusPosition", () => {
  it("turns the deck's focus into an object-position", () => {
    expect(focusPosition("50 15")).toBe("50% 15%");
    expect(focusPosition("0 100")).toBe("0% 100%");
  });

  it.each([undefined, "", "50", "50% 15%", "50 15 0", "101 0", "-5 10", "a b"])(
    "leaves %j to the default",
    (focus) => {
      expect(focusPosition(focus)).toBeUndefined();
    },
  );
});

describe("createPreloader", () => {
  function recorder() {
    const images: (ImageLike & { order: string[] })[] = [];
    const make = (): ImageLike => {
      const order: string[] = [];
      const img = {
        order,
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        decoding: "auto" as ImageLike["decoding"],
        set sizes(v: string) {
          order.push(`sizes=${v}`);
        },
        set srcset(v: string) {
          order.push(`srcset=${v}`);
        },
        set src(v: string) {
          order.push(`src=${v}`);
        },
      } as unknown as ImageLike & { order: string[] };
      images.push(img);
      return img;
    };
    return { images, make };
  }

  it("fetches with the card's own sizes and srcset, sizes first", () => {
    const { images, make } = recorder();
    createPreloader(IMAGE_BASE, make)(portrait);
    const card = photoSources(IMAGE_BASE, portrait);
    expect(images).toHaveLength(1);
    expect(images[0]?.order).toEqual([
      `sizes=${card.sizes}`,
      `srcset=${card.srcset}`,
      `src=${card.src}`,
    ]);
  });

  it("fetches each photo once, and nothing for a card without one", () => {
    const { images, make } = recorder();
    const preload = createPreloader(IMAGE_BASE, make);
    preload(portrait);
    preload(portrait);
    preload(undefined);
    expect(images).toHaveLength(1);
  });

  it("tries a photo again if it failed", () => {
    const { images, make } = recorder();
    const preload = createPreloader(IMAGE_BASE, make);
    preload(portrait);
    images[0]?.onerror?.("error");
    preload(portrait);
    expect(images).toHaveLength(2);
  });
});
