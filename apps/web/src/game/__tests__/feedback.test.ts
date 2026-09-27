import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEEDBACK_LIMITS, SITE_PAGES } from "@bt/core";
import { describe, expect, it, vi } from "vitest";
import {
  FEEDBACK_ENDPOINT,
  afterSent,
  arrivedFrom,
  linkedFeedback,
  sitePage,
  draftProblem,
  feedbackRequest,
  reportedRound,
  sendFeedback,
  shownFigureText,
  statusText,
  wrapFocus,
} from "../feedback";
import type { FeedbackContext, FormStatus, ReportedRound } from "../feedback";
import { TIMINGS } from "../timing";
import { initialState, reduce } from "../machine";
import type { GameEvent, GameState } from "../machine";
import { RUN_ID, cont, exhausted, round, wrong } from "./fixtures";

const at = (events: GameEvent[]): GameState => events.reduce(reduce, initialState());

/** A run that answers round 1 right and ends on round 2, `ending` deciding how. */
function over(ending: GameEvent): GameState {
  const r1 = round(1);
  const r2 = { ...round(2), challenger: { ...round(2).challenger, name: "Luís Figo" } };
  return at([
    { type: "start" },
    { type: "started", runId: RUN_ID, round: r1 },
    { type: "dealt" },
    { type: "spun" },
    { type: "guess", guess: "higher", at: 0 },
    { type: "answered", response: cont(1, r2), at: 100 },
    { type: "settled" },
    { type: "advance" },
    { type: "dealt" },
    { type: "guess", guess: "higher", at: 5000 },
    ending,
    { type: "settled" },
    { type: "advance" },
  ]);
}

const NO_CONTEXT: FeedbackContext = { report: null, page: "/" };

const REPORT: ReportedRound = {
  runId: RUN_ID,
  round: 2,
  stat: "fee",
  anchor: { name: "Zinedine Zidane", display: "€77.5m", qualifier: "2001" },
  challenger: { name: "Luís Figo", display: "€62m", qualifier: "2000" },
};

describe("reportedRound", () => {
  it("is the round that ended the run, with only what the player saw", () => {
    const state = over({ type: "answered", response: wrong(2, 20), at: 5100 });
    expect(state.phase).toBe("over");
    expect(reportedRound(state)).toEqual({
      runId: RUN_ID,
      round: 2,
      stat: "caps",
      anchor: { name: "p2", display: "50" },
      challenger: { name: "Luís Figo", display: "20" },
    });
  });

  it("covers a run that went the distance", () => {
    const state = over({ type: "answered", response: exhausted(2), at: 5100 });
    expect(reportedRound(state)?.round).toBe(2);
  });

  it("is null for a run banked after a dropped connection: the figure never came", () => {
    const state = over({ type: "answerFailed", failure: { kind: "fatal" }, at: 5100 });
    expect(state.phase).toBe("over");
    expect(reportedRound(state)).toBeNull();
  });

  it("is null before the run is over", () => {
    expect(reportedRound(initialState())).toBeNull();
    const playing = at([
      { type: "start" },
      { type: "started", runId: RUN_ID, round: round(1) },
      { type: "dealt" },
      { type: "spun" },
    ]);
    expect(reportedRound(playing)).toBeNull();
  });
});

describe("draftProblem", () => {
  it("needs a name for a suggestion, and nothing for a report", () => {
    expect(draftProblem("suggest", { name: "  ", note: "" })).toBe("nameRequired");
    expect(draftProblem("suggest", { name: "Zola", note: "" })).toBeNull();
    expect(draftProblem("correction", { name: "", note: "" })).toBeNull();
  });

  it("needs a note for a problem report", () => {
    expect(draftProblem("problem", { name: "", note: " \n " })).toBe("noteRequired");
    expect(draftProblem("problem", { name: "", note: "Typo" })).toBeNull();
    expect(draftProblem("suggest", { name: "Zola", note: "" })).toBeNull();
  });

  it("holds both to the server's limits, in characters", () => {
    const long = "é".repeat(FEEDBACK_LIMITS.name + 1);
    expect(draftProblem("suggest", { name: long, note: "" })).toBe("nameTooLong");
    const note = "⚽".repeat(FEEDBACK_LIMITS.note + 1);
    expect(draftProblem("correction", { name: "", note })).toBe("noteTooLong");
    expect(draftProblem("correction", { name: "", note: note.slice(2) })).toBeNull();
  });
});

describe("feedbackRequest", () => {
  it("sends a suggestion's name, trimmed, and leaves out a blank note", () => {
    expect(feedbackRequest("suggest", { name: " Zola ", note: " \n " }, NO_CONTEXT, "tok")).toEqual(
      {
        kind: "suggest",
        name: "Zola",
        turnstileToken: "tok",
      },
    );
    expect(
      feedbackRequest("suggest", { name: "Zola", note: "Chelsea" }, NO_CONTEXT, "tok"),
    ).toEqual({
      kind: "suggest",
      name: "Zola",
      note: "Chelsea",
      turnstileToken: "tok",
    });
  });

  it("sends a report's run id and round, and never a player or a figure", () => {
    const body = feedbackRequest(
      "correction",
      { name: "ignored", note: "Wrong" },
      { report: REPORT, page: "/about" },
      "tok",
    );
    expect(body).toEqual({
      kind: "correction",
      runId: RUN_ID,
      round: 2,
      note: "Wrong",
      turnstileToken: "tok",
    });
    const text = JSON.stringify(body);
    for (const shown of ["Zidane", "Figo", "77.5", "62", "fee"]) expect(text).not.toContain(shown);
  });

  it("sends a problem's note and page, and nothing else", () => {
    const body = feedbackRequest(
      "problem",
      { name: "ignored", note: "  Typo on credits  " },
      { report: REPORT, page: "/credits" },
      "tok",
    );
    expect(body).toEqual({
      kind: "problem",
      note: "Typo on credits",
      page: "/credits",
      turnstileToken: "tok",
    });
  });

  it("refuses a report with no round", () => {
    expect(() =>
      feedbackRequest("correction", { name: "", note: "" }, NO_CONTEXT, "tok"),
    ).toThrow();
  });
});

describe("sendFeedback", () => {
  const body = { kind: "suggest", name: "Zola", turnstileToken: "tok" } as const;

  it("posts JSON to the endpoint", async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true }));
    expect(await sendFeedback(fetchFn, body)).toBe("sent");
    expect(fetchFn).toHaveBeenCalledWith(
      FEEDBACK_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  });

  it.each([
    [429, "rateLimited"],
    [403, "verificationFailed"],
    [400, "failed"],
    [500, "failed"],
    [502, "failed"],
  ])("maps a %i to %s", async (status, outcome) => {
    const fetchFn = async () => Response.json({ error: "x" }, { status });
    expect(await sendFeedback(fetchFn, body)).toBe(outcome);
  });

  it("fails calmly with no connection", async () => {
    const fetchFn = async (): Promise<Response> => {
      throw new TypeError("offline");
    };
    expect(await sendFeedback(fetchFn, body)).toBe("failed");
  });

  it("gives up on a request that never answers", async () => {
    vi.useFakeTimers();
    const fetchFn = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const pending = sendFeedback(fetchFn, body, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("failed");
    vi.useRealTimers();
  });
});

describe("shownFigureText", () => {
  it("shows a figure with its qualifier, as the card did", () => {
    expect(shownFigureText("fee", REPORT.anchor)).toBe("Zinedine Zidane: €77.5m (2001)");
    expect(shownFigureText("caps", { name: "Pirlo", display: "116" })).toBe("Pirlo: 116");
  });
});

describe("statusText", () => {
  it("says something for every state but plain editing", () => {
    const states: FormStatus[] = [
      "sending",
      "sent",
      "failed",
      "rateLimited",
      "verificationFailed",
      "checkFailed",
    ];
    const texts = states.map((s) => statusText(s, null));
    for (const text of texts) expect(text).not.toBe("");
    expect(new Set(texts).size).toBe(states.length);
    expect(statusText("editing", null)).toBe("");
  });

  it("names a problem with the draft while editing", () => {
    expect(statusText("editing", "nameRequired")).not.toBe("");
    expect(statusText("editing", "noteTooLong")).not.toBe("");
  });

  it("keeps a slow-down calm", () => {
    expect(statusText("rateLimited", null)).not.toMatch(/error|fail|block|denied/i);
  });
});

describe("wrapFocus", () => {
  it("wraps Tab from the last element to the first", () => {
    expect(wrapFocus(4, 5, false)).toBe(0);
    expect(wrapFocus(2, 5, false)).toBeNull();
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    expect(wrapFocus(0, 5, true)).toBe(4);
    expect(wrapFocus(3, 5, true)).toBeNull();
  });

  it("brings focus from outside back in", () => {
    expect(wrapFocus(-1, 5, false)).toBe(0);
    expect(wrapFocus(-1, 5, true)).toBe(4);
  });

  it("does nothing with nothing to focus", () => {
    expect(wrapFocus(-1, 0, false)).toBeNull();
  });
});

describe("linkedFeedback", () => {
  it("opens the problem form from #problem, and suggest from #suggest", () => {
    expect(linkedFeedback("#problem")).toBe("problem");
    expect(linkedFeedback("#suggest")).toBe("suggest");
  });

  it("reads a footer link's data-feedback the same way", () => {
    expect(linkedFeedback("problem")).toBe("problem");
    expect(linkedFeedback("suggest")).toBe("suggest");
  });

  it("opens nothing for any other hash, and never the card report", () => {
    for (const hash of ["", "#", "#correction", "#Problem", "#problem-x", "#how-to-play"]) {
      expect(linkedFeedback(hash), hash).toBeNull();
    }
  });
});

describe("sitePage", () => {
  it("names the site's pages as the Worker accepts them", () => {
    expect(sitePage("/")).toBe("/");
    expect(sitePage("/about")).toBe("/about");
    expect(sitePage("/about.html")).toBe("/about");
    expect(sitePage("/index.html")).toBe("/");
  });

  it("calls any other path the 404 page, which is what the site serves there", () => {
    expect(sitePage("/no-such-page")).toBe("/404");
    expect(sitePage("/about/")).toBe("/404");
  });
});

describe("arrivedFrom", () => {
  const ORIGIN = "https://biggerthangame.com";

  it("is the page a #problem link was followed from, as a path only", () => {
    expect(arrivedFrom(`${ORIGIN}/credits?utm=x#top`, ORIGIN)).toBe("/credits");
    expect(arrivedFrom(`${ORIGIN}/missing`, ORIGIN)).toBe("/404");
  });

  it("is the game page for a link from elsewhere, or none at all", () => {
    expect(arrivedFrom("https://example.com/about", ORIGIN)).toBe("/");
    expect(arrivedFrom("", ORIGIN)).toBe("/");
    expect(arrivedFrom("not a url", ORIGIN)).toBe("/");
  });
});

describe("SITE_PAGES", () => {
  it("lists exactly the pages the site builds", () => {
    const dir = fileURLToPath(new URL("../../pages", import.meta.url));
    const built = readdirSync(dir)
      .filter((f) => f.endsWith(".astro"))
      .map((f) => f.replace(/\.astro$/, ""))
      .map((name) => (name === "index" ? "/" : `/${name}`));
    expect([...SITE_PAGES].sort()).toEqual(built.sort());
  });
});

describe("afterSent", () => {
  it("shows the thanks, then fades and closes", () => {
    expect(afterSent(TIMINGS, false)).toEqual({
      fadeAt: TIMINGS.thanks,
      closeAt: TIMINGS.thanks + TIMINGS.modal,
    });
  });

  it("skips the fade with reduced motion, but keeps the pause", () => {
    expect(afterSent(TIMINGS, true)).toEqual({ fadeAt: TIMINGS.thanks, closeAt: TIMINGS.thanks });
  });

  it("leaves the thanks up long enough to read, but not for ever: 2–8 s", () => {
    expect(TIMINGS.thanks).toBeGreaterThanOrEqual(2000);
    expect(TIMINGS.thanks).toBeLessThanOrEqual(8000);
  });
});
