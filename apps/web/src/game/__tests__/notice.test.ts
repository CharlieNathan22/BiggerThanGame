import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_NOTICE, TimedNotice } from "../notice";
import type { NoticeState } from "../notice";
import { TIMINGS } from "../timing";

const { notice, noticeFade } = TIMINGS;

let reduced: boolean;
let changes: NoticeState[];
let notes: TimedNotice;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  changes = [];
  notes = new TimedNotice({
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    timings: () => TIMINGS,
    reducedMotion: () => reduced,
    onChange: (state) => changes.push(state),
  });
});

afterEach(() => {
  notes.destroy();
  vi.useRealTimers();
});

/** The texts the live region was given, in order: what could be announced. */
const texts = () => changes.map((c) => c.text);

describe("a share note", () => {
  it("shows for --dur-notice, fades, then clears", async () => {
    notes.begin()("Copied");
    expect(notes.state).toEqual({ text: "Copied", fading: false });

    await vi.advanceTimersByTimeAsync(notice - 1);
    expect(notes.state).toEqual({ text: "Copied", fading: false });
    await vi.advanceTimersByTimeAsync(1);
    expect(notes.state).toEqual({ text: "Copied", fading: true });

    await vi.advanceTimersByTimeAsync(noticeFade - 1);
    expect(notes.state.text).toBe("Copied");
    await vi.advanceTimersByTimeAsync(1);
    expect(notes.state).toEqual(NO_NOTICE);
  });

  it("puts its text in the live region once: the fade keeps it, and clearing only removes it", async () => {
    notes.begin()("Image saved.");
    await vi.advanceTimersByTimeAsync(notice + noticeFade);
    expect(texts()).toEqual(["Image saved.", "Image saved.", ""]);
    expect(changes.filter((c) => c.text !== "" && !c.fading)).toHaveLength(1);
  });

  it("clears at --dur-notice with no fade under reduced motion", async () => {
    reduced = true;
    notes.begin()("Copied");
    await vi.advanceTimersByTimeAsync(notice - 1);
    expect(notes.state.text).toBe("Copied");
    await vi.advanceTimersByTimeAsync(1);
    expect(notes.state).toEqual(NO_NOTICE);
    expect(changes.some((c) => c.fading)).toBe(false);
  });

  it("shows failures the same way", async () => {
    notes.begin()("Couldn't copy.");
    await vi.advanceTimersByTimeAsync(notice + noticeFade);
    expect(notes.state).toEqual(NO_NOTICE);
  });

  it("shows nothing, and starts no timer, for an outcome with no note", async () => {
    notes.begin()("");
    expect(changes).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a second tap", () => {
  it("restarts the timer: the new note gets the full time", async () => {
    notes.begin()("Copied");
    await vi.advanceTimersByTimeAsync(notice - 1000);

    const show = notes.begin();
    expect(notes.state).toEqual(NO_NOTICE);
    show("Copied");
    await vi.advanceTimersByTimeAsync(notice - 1);
    expect(notes.state).toEqual({ text: "Copied", fading: false });
    await vi.advanceTimersByTimeAsync(1 + noticeFade);
    expect(notes.state).toEqual(NO_NOTICE);
  });

  it("restarts a note that was already fading", async () => {
    notes.begin()("Copied");
    await vi.advanceTimersByTimeAsync(notice + 1);
    expect(notes.state.fading).toBe(true);
    notes.begin()("Image saved.");
    expect(notes.state).toEqual({ text: "Image saved.", fading: false });
  });

  it("drops the first tap's outcome if it arrives after the second tap", async () => {
    const first = notes.begin();
    const second = notes.begin();
    second("Image saved.");
    first("Copied");
    expect(notes.state.text).toBe("Image saved.");
  });
});

describe("a new run", () => {
  it("clears the note at once and cancels its timer", async () => {
    notes.begin()("Copied");
    notes.clear();
    expect(notes.state).toEqual(NO_NOTICE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a share still in flight when Play again is pressed", async () => {
    const show = notes.begin();
    notes.clear();
    show("Copied");
    expect(notes.state).toEqual(NO_NOTICE);
    expect(vi.getTimerCount()).toBe(0);
  });
});
