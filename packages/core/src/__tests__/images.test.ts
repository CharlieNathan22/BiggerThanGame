import { describe, expect, it } from "vitest";
import { DISPLAY_WIDTHS, imageUrl, originalUrl, srcsetFor } from "../images.js";

const base = "https://img.biggerthangame.com";
const key = "originals/a.0123456789abcdef.jpg";

describe("imageUrl", () => {
  it("builds a transformation URL on the image host", () => {
    expect(imageUrl(base, key, 800)).toBe(
      "https://img.biggerthangame.com/cdn-cgi/image/" +
        "width=800,quality=80,fit=scale-down,format=auto,onerror=redirect/" +
        "originals/a.0123456789abcdef.jpg",
    );
  });

  it("tolerates a trailing slash on the base", () => {
    expect(imageUrl(`${base}/`, key, 800)).toBe(imageUrl(base, key, 800));
  });

  it("lets the edge choose the format — one transformation per width, not per format", () => {
    expect(imageUrl(base, key, 1600)).toContain("format=auto");
    expect(imageUrl(base, key, 1600)).not.toMatch(/format=(webp|avif)/);
  });

  it("never enlarges past the original", () => {
    expect(imageUrl(base, key, 1600)).toContain("fit=scale-down");
  });

  it("falls back to the original rather than a broken image", () => {
    expect(imageUrl(base, key, 800)).toContain("onerror=redirect");
  });
});

describe("srcsetFor", () => {
  it("lists every display width, smallest first", () => {
    const widths = srcsetFor(base, key)
      .split(", ")
      .map((part) => part.split(" ")[1]);
    expect(widths).toEqual(DISPLAY_WIDTHS.map((w) => `${w}w`));
  });

  it("keeps the number of distinct URLs per player small", () => {
    // Every distinct URL is a transformation against the free 5,000 a month.
    // A 300-player deck at this many widths must leave plenty of headroom.
    expect(DISPLAY_WIDTHS.length * 300).toBeLessThanOrEqual(2_500);
  });
});

describe("originalUrl", () => {
  it("joins base and key", () => {
    expect(originalUrl(`${base}/`, "originals/a.jpg")).toBe(`${base}/originals/a.jpg`);
  });
});
