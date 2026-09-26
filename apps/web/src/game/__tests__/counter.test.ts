import { describe, expect, it } from "vitest";
import { counterFrame, formatFigure, scrambleValue, splitDisplay } from "../counter";
import { TIMINGS } from "../timing";

const tapped = { tappedAt: 1000, arrivedAt: null };

describe("counterFrame", () => {
  it("scrambles from the tap until the answer lands, however long that takes", () => {
    for (const now of [1000, 1300, 1640, 5000, 30_000]) {
      expect(counterFrame(tapped, null, now, TIMINGS, false).kind).toBe("scramble");
    }
  });

  it("changes the scrambled number once per scramble tick", () => {
    const tick = (now: number) => {
      const f = counterFrame(tapped, null, now, TIMINGS, false);
      return f.kind === "scramble" ? f.tick : -1;
    };
    expect(tick(1000)).toBe(0);
    expect(tick(1000 + TIMINGS.scramble - 1)).toBe(0);
    expect(tick(1000 + TIMINGS.scramble)).toBe(1);
    expect(tick(1000 + 10 * TIMINGS.scramble)).toBe(10);
  });

  it("counts up from zero once the answer lands, settling at the nominal time", () => {
    const count = { tappedAt: 1000, arrivedAt: 1100 };
    expect(counterFrame(count, 80, 1100, TIMINGS, false)).toEqual({ kind: "count", value: 0 });
    const mid = counterFrame(count, 80, (1100 + 1000 + TIMINGS.count) / 2, TIMINGS, false);
    expect(mid.kind).toBe("count");
    if (mid.kind === "count") {
      expect(mid.value).toBeGreaterThan(0);
      expect(mid.value).toBeLessThan(80);
    }
    expect(counterFrame(count, 80, 1000 + TIMINGS.count, TIMINGS, false)).toEqual({
      kind: "done",
    });
  });

  it("rises monotonically — no frame goes backwards or jumps to the end", () => {
    const count = { tappedAt: 0, arrivedAt: 20 };
    let last = -1;
    for (let now = 20; now < TIMINGS.count; now += 16) {
      const f = counterFrame(count, 1000, now, TIMINGS, false);
      expect(f.kind).toBe("count");
      if (f.kind !== "count") return;
      expect(f.value).toBeGreaterThanOrEqual(last);
      expect(f.value).toBeLessThan(1000);
      last = f.value;
    }
  });

  it("gives a late answer the full settle time rather than snapping", () => {
    const late = TIMINGS.count + 1000;
    const count = { tappedAt: 0, arrivedAt: late };
    expect(counterFrame(count, 50, late, TIMINGS, false).kind).toBe("count");
    expect(counterFrame(count, 50, late + TIMINGS.settle - 1, TIMINGS, false).kind).toBe("count");
    expect(counterFrame(count, 50, late + TIMINGS.settle, TIMINGS, false).kind).toBe("done");
  });

  // The dev delay switch's settings (0, 200, 800 ms, 3 s), played frame by
  // frame at 60 fps: the scramble never stalls while the answer is out, and
  // once it lands the count rises smoothly from zero to the value.
  it.each([0, 200, 800, 3000])(
    "holds and settles without a snap or a freeze when the answer takes %i ms",
    (delay) => {
      const target = 1234;
      const frame = 1000 / 60;
      const count = { tappedAt: 0, arrivedAt: null };
      const arrived = { tappedAt: 0, arrivedAt: delay };

      let lastTick = -1;
      let lastChange = 0;
      let last = -1;
      let counted = 0;
      let doneAt: number | null = null;
      for (let now = 0; doneAt === null && now < delay + 5000; now += frame) {
        const f = counterFrame(
          now < delay ? count : arrived,
          now < delay ? null : target,
          now,
          TIMINGS,
          false,
        );
        if (f.kind === "scramble") {
          expect(now).toBeLessThan(delay);
          if (f.tick !== lastTick) {
            lastTick = f.tick;
            lastChange = now;
          }
          // Never frozen: a new number at least every scramble tick (plus a frame).
          expect(now - lastChange).toBeLessThanOrEqual(TIMINGS.scramble + frame);
        } else if (f.kind === "count") {
          expect(f.value).toBeGreaterThanOrEqual(last);
          // No snap: no frame covers more than a fifth of the distance.
          if (last >= 0) expect(f.value - last).toBeLessThanOrEqual(target / 5);
          last = f.value;
          counted++;
        } else {
          expect(f.kind).toBe("done");
          doneAt = now;
        }
      }

      expect(doneAt).not.toBeNull();
      expect(doneAt!).toBeGreaterThanOrEqual(Math.max(TIMINGS.count, delay + TIMINGS.settle));
      expect(counted).toBeGreaterThanOrEqual(Math.floor(TIMINGS.settle / frame) - 1);
    },
  );

  it("with reduced motion, keeps the ? until the answer, then shows it at once", () => {
    expect(counterFrame(tapped, null, 1500, TIMINGS, true)).toEqual({ kind: "hidden" });
    expect(counterFrame({ tappedAt: 1000, arrivedAt: 1200 }, 8, 1200, TIMINGS, true)).toEqual({
      kind: "done",
    });
  });
});

describe("scrambleValue", () => {
  it("stays within a range scaled from the anchor's visible figure", () => {
    expect(scrambleValue(100, 0)).toBe(0);
    expect(scrambleValue(100, 0.999)).toBeLessThan(200);
    expect(scrambleValue(1, 0.5)).toBe(5);
  });
});

describe("formatFigure", () => {
  it("formats in-between figures as the stat formats real ones", () => {
    expect(formatFigure("caps", 41.6)).toBe("42");
    expect(formatFigure("apps", 1234)).toBe("1,234");
    expect(formatFigure("ig", 3.14)).toBe("3.1m");
    expect(formatFigure("fee", 77.52)).toBe("€77.5m");
  });
});

describe("splitDisplay", () => {
  it("splits a trailing unit off for the smaller suffix", () => {
    expect(splitDisplay("88m")).toEqual({ main: "88", suffix: "m" });
    expect(splitDisplay("€77.5m")).toEqual({ main: "€77.5", suffix: "m" });
    expect(splitDisplay("0.5m")).toEqual({ main: "0.5", suffix: "m" });
  });

  it("leaves plain numbers whole", () => {
    expect(splitDisplay("1,234")).toEqual({ main: "1,234", suffix: "" });
    expect(splitDisplay("7")).toEqual({ main: "7", suffix: "" });
  });
});
