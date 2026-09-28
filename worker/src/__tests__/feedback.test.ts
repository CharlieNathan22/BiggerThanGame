/**
 * `POST /api/feedback` as a pure function: strict validation, Turnstile, the
 * correction lookup, and what goes into the email. The send is mocked.
 */

import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_LIMITS, SITE_PAGES, STATS, valueOf } from "@bt/core";
import type { Player, RoundPayload } from "@bt/core";
import { scanForLeakedValues } from "@bt/deck";
import { FEEDBACK_FROM, FEEDBACK_SUBJECTS, handleFeedback } from "../feedback.js";
import type { AcceptedFeedback, FeedbackContext, FeedbackResult } from "../feedback.js";
import { cleanLine, cleanNote, parseFeedbackRequest } from "../feedback-validate.js";
import type { PlainTextMail } from "../mail.js";
import type { TurnstileOutcome } from "../turnstile.js";
import {
  SAMPLE_DECK,
  SECRET,
  TODAY,
  context,
  runDay,
  signedRunId,
  start,
  uuidFrom,
  walkRun,
} from "./helpers.js";

const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

function feedbackContext(
  overrides: Partial<FeedbackContext> = {},
): FeedbackContext & { sent: PlainTextMail[] } {
  const sent: PlainTextMail[] = [];
  return {
    deck: SAMPLE_DECK,
    secret: SECRET,
    clock: () => TODAY,
    to: "owner@example.com",
    uuid: () => uuidFrom(99),
    verifyTurnstile: async () => "pass",
    send: async (mail) => void sent.push(mail),
    ...overrides,
    sent,
  };
}

const suggest = (extra: Record<string, unknown> = {}) => ({
  kind: "suggest",
  name: "Gianfranco Zola",
  turnstileToken: TOKEN,
  ...extra,
});

/** A problem report; an `undefined` in `extra` leaves that key out. */
function problem(extra: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = {
    kind: "problem",
    note: "The about page has a typo",
    page: "/about",
    turnstileToken: TOKEN,
    ...extra,
  };
  for (const [k, v] of Object.entries(body)) if (v === undefined) delete body[k];
  return body;
}

async function correction(extra: Record<string, unknown> = {}) {
  return {
    kind: "correction",
    runId: await signedRunId("2026-09-19", uuidFrom(1)),
    round: 1,
    turnstileToken: TOKEN,
    ...extra,
  };
}

function rejection(result: FeedbackResult): string | undefined {
  return result.status === 400 ? result.body.detail : undefined;
}

describe("validation", () => {
  it("accepts a suggestion, with and without a note", () => {
    expect(parseFeedbackRequest(suggest())).toEqual({
      ok: true,
      value: { kind: "suggest", name: "Gianfranco Zola", turnstileToken: TOKEN },
    });
    expect(parseFeedbackRequest(suggest({ note: "Chelsea legend" }))).toMatchObject({
      ok: true,
      value: { note: "Chelsea legend" },
    });
  });

  it("accepts a correction, with and without a note", async () => {
    const body = await correction();
    expect(parseFeedbackRequest(body)).toEqual({ ok: true, value: body });
    expect(parseFeedbackRequest({ ...body, note: "Wrong fee" })).toMatchObject({
      ok: true,
      value: { note: "Wrong fee" },
    });
  });

  it("drops a note that is blank once cleaned", () => {
    const parsed = parseFeedbackRequest(suggest({ note: "  \n\t " }));
    expect(parsed.ok && parsed.value).not.toHaveProperty("note");
  });

  it("accepts text right at the limits, counted in characters", () => {
    const name = "é".repeat(FEEDBACK_LIMITS.name);
    const note = "⚽".repeat(FEEDBACK_LIMITS.note);
    expect(parseFeedbackRequest(suggest({ name, note })).ok).toBe(true);
  });

  const cases: [string, () => Promise<unknown> | unknown, string][] = [
    ["a non-object body", () => "hello", "invalid_body"],
    ["null", () => null, "invalid_body"],
    ["an array", () => [suggest()], "invalid_body"],
    ["no kind", () => ({ name: "Zola", turnstileToken: TOKEN }), "unknown_kind"],
    ["an unknown kind", () => suggest({ kind: "complaint" }), "unknown_kind"],
    ["a kind in the wrong case", () => suggest({ kind: "Suggest" }), "unknown_kind"],
    ["an extra key on a suggestion", () => suggest({ email: "a@b.com" }), "unexpected_key"],
    ["a correction's key on a suggestion", () => suggest({ round: 1 }), "unexpected_key"],
    ["an extra key on a correction", () => correction({ extra: true }), "unexpected_key"],
    ["a value on a correction", () => correction({ value: 108 }), "unexpected_key"],
    ["a display on a correction", () => correction({ display: "108" }), "unexpected_key"],
    ["a stat on a correction", () => correction({ stat: "caps" }), "unexpected_key"],
    ["a name on a correction", () => correction({ name: "Zola" }), "unexpected_key"],
    ["no name", () => ({ kind: "suggest", turnstileToken: TOKEN }), "missing_key"],
    ["no token", () => ({ kind: "suggest", name: "Zola" }), "missing_key"],
    ["no run id", () => ({ kind: "correction", round: 1, turnstileToken: TOKEN }), "missing_key"],
    [
      "no round",
      async () => ({
        kind: "correction",
        runId: await signedRunId("2026-09-19", uuidFrom(1)),
        turnstileToken: TOKEN,
      }),
      "missing_key",
    ],
    ["a number for a name", () => suggest({ name: 10 }), "not_a_string"],
    ["an array for a name", () => suggest({ name: ["Zola"] }), "not_a_string"],
    ["a number for a note", () => suggest({ note: 5 }), "not_a_string"],
    ["null for a note", () => suggest({ note: null }), "not_a_string"],
    ["an object for a token", () => suggest({ turnstileToken: {} }), "not_a_string"],
    ["a number for a run id", () => correction({ runId: 1 }), "not_a_string"],
    ["an empty name", () => suggest({ name: "" }), "name_required"],
    ["a name of only spaces and controls", () => suggest({ name: " \u0007\n " }), "name_required"],
    [
      "a name over the limit",
      () => suggest({ name: "x".repeat(FEEDBACK_LIMITS.name + 1) }),
      "name_too_long",
    ],
    [
      "a note over the limit",
      () => suggest({ note: "x".repeat(FEEDBACK_LIMITS.note + 1) }),
      "note_too_long",
    ],
    [
      "a correction note over the limit",
      () => correction({ note: "⚽".repeat(FEEDBACK_LIMITS.note + 1) }),
      "note_too_long",
    ],
    ["an empty token", () => suggest({ turnstileToken: "" }), "invalid_token"],
    [
      "a token over Turnstile's length",
      () => suggest({ turnstileToken: "t".repeat(FEEDBACK_LIMITS.token + 1) }),
      "invalid_token",
    ],
    ["a problem with no note", () => problem({ note: undefined }), "missing_key"],
    ["a problem with no page", () => problem({ page: undefined }), "missing_key"],
    ["a problem with a blank note", () => problem({ note: "  " }), "note_required"],
    ["a problem with an empty note", () => problem({ note: "" }), "note_required"],
    [
      "a problem note over the limit",
      () => problem({ note: "x".repeat(FEEDBACK_LIMITS.note + 1) }),
      "note_too_long",
    ],
    ["a page that isn't the site's", () => problem({ page: "/admin" }), "invalid_page"],
    [
      "a page as a full URL",
      () => problem({ page: "https://biggerthangame.com/" }),
      "invalid_page",
    ],
    ["a page with a query", () => problem({ page: "/about?x=1" }), "invalid_page"],
    ["a page as a number", () => problem({ page: 1 }), "not_a_string"],
    ["a name on a problem", () => problem({ name: "Zola" }), "unexpected_key"],
    ["a user agent on a problem", () => problem({ userAgent: "Firefox" }), "unexpected_key"],
    ["a run on a problem", () => problem({ runId: "x", round: 1 }), "unexpected_key"],
    ["a malformed run id", () => correction({ runId: "not-a-run" }), "invalid_run"],
    ["a round of zero", () => correction({ round: 0 }), "invalid_round"],
    ["a round past the maximum", () => correction({ round: 61 }), "invalid_round"],
    ["a fractional round", () => correction({ round: 1.5 }), "invalid_round"],
    ["a round as a string", () => correction({ round: "1" }), "invalid_round"],
  ];

  it.each(cases)("refuses %s", async (_name, make, code) => {
    const parsed = parseFeedbackRequest(await make());
    expect(parsed).toEqual({ ok: false, code });
    // And the handler turns it into a 400 before Turnstile or the send.
    const ctx = feedbackContext({ verifyTurnstile: vi.fn(async () => "pass" as const) });
    const result = await handleFeedback(await make(), ctx);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "bad_request", detail: code });
    expect(ctx.verifyTurnstile).not.toHaveBeenCalled();
    expect(ctx.sent).toEqual([]);
  });
});

describe("cleaning", () => {
  it("strips control characters and trims a line", () => {
    expect(cleanLine("  Zola\u0000\u001b[31m\r\n ")).toBe("Zola[31m");
    expect(cleanLine("Zo\u202ela\u2066")).toBe("Zola");
    expect(cleanLine("Zola\u0085\u009f")).toBe("Zola");
  });

  it("keeps emoji joiners and accents", () => {
    expect(cleanLine("Pelé 👨‍👩‍👧")).toBe("Pelé 👨‍👩‍👧");
  });

  it("keeps a note's line breaks, in one style, with no runs of blank lines", () => {
    expect(cleanNote("one\r\ntwo\rthree\u2028four\n\n\n\nfive\t6\u0007 \n")).toBe(
      "one\ntwo\nthree\nfour\n\nfive 6",
    );
  });
});

describe("suggestions", () => {
  it("sends a plain-text email with the fixed subject, the name and the note", async () => {
    const ctx = feedbackContext();
    const result = await handleFeedback(
      suggest({ name: "  Gianfranco Zola\u0007 ", note: "Chelsea\r\nlegend" }),
      ctx,
    );
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(ctx.sent).toHaveLength(1);
    const mail = ctx.sent[0]!;
    expect(mail.from).toBe(FEEDBACK_FROM);
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toBe(FEEDBACK_SUBJECTS.suggest);
    expect(mail.messageId).toBe(`<${uuidFrom(99)}@biggerthangame.com>`);
    expect(mail.text).toContain("Name: Gianfranco Zola\n");
    expect(mail.text).toContain("Chelsea\nlegend");
    expect(mail.text).not.toContain("\u0007");
    expect(mail.text).not.toMatch(/<[a-z][^>]*>/i);
  });

  it("never puts user text in the subject", async () => {
    const ctx = feedbackContext();
    const name = "Subject: injected\r\nBcc: someone@example.com";
    await handleFeedback(suggest({ name, note: "Subject: also injected" }), ctx);
    await handleFeedback(problem({ note: name }), ctx);
    expect(ctx.sent).toHaveLength(2);
    for (const mail of ctx.sent) {
      expect(Object.values(FEEDBACK_SUBJECTS)).toContain(mail.subject);
      expect(mail.subject).not.toMatch(/injected|someone/);
    }
  });
});

describe("problem reports", () => {
  it("accept a note from any of the site's pages", () => {
    for (const page of SITE_PAGES) {
      expect(parseFeedbackRequest(problem({ page }))).toEqual({
        ok: true,
        value: { kind: "problem", note: "The about page has a typo", page, turnstileToken: TOKEN },
      });
    }
  });

  it("send the fixed subject, the page and the note, and nothing else about the sender", async () => {
    const ctx = feedbackContext();
    const result = await handleFeedback(
      problem({ note: "Subject: hi\r\nThe share button\u0007 does nothing", page: "/credits" }),
      ctx,
    );
    expect(result).toEqual({ status: 200, body: { ok: true } });
    const mail = ctx.sent[0]!;
    expect(mail.subject).toBe(FEEDBACK_SUBJECTS.problem);
    expect(mail.text).toBe(
      [
        "Problem report",
        "",
        "Page: /credits",
        "",
        "Note:",
        "Subject: hi",
        "The share button does nothing",
        "",
        `Received: ${TODAY.toISOString()}`,
        "",
      ].join("\n"),
    );
  });

  it("go through Turnstile like the others", async () => {
    const ctx = feedbackContext({ verifyTurnstile: async () => "fail" });
    expect(await handleFeedback(problem(), ctx)).toEqual({
      status: 403,
      body: { error: "verification_failed" },
    });
    expect(ctx.sent).toEqual([]);
  });
});

describe("Turnstile", () => {
  it.each<[TurnstileOutcome, FeedbackResult]>([
    ["pass", { status: 200, body: { ok: true } }],
    ["fail", { status: 403, body: { error: "verification_failed" } }],
    ["error", { status: 502, body: { error: "unavailable" }, reason: "turnstile" }],
  ])("on %s answers %j", async (outcome, expected) => {
    const verifyTurnstile = vi.fn(async () => outcome);
    const ctx = feedbackContext({ verifyTurnstile });
    const result = await handleFeedback(suggest(), ctx);
    expect(result).toEqual(expected);
    expect(verifyTurnstile).toHaveBeenCalledWith(TOKEN);
    expect(ctx.sent).toHaveLength(outcome === "pass" ? 1 : 0);
  });
});

describe("a failed send", () => {
  it("is a calm 502 carrying only the error's code, and logs nothing itself", async () => {
    const spies = (["log", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const failure = Object.assign(new Error("Gianfranco Zola: not delivered"), {
      code: "E_SENDER_NOT_VERIFIED",
    });
    const ctx = feedbackContext({
      send: async () => {
        throw failure;
      },
    });
    const result = await handleFeedback(suggest(), ctx);
    expect(result).toEqual({
      status: 502,
      body: { error: "send_failed" },
      reason: "E_SENDER_NOT_VERIFIED",
    });
    expect(JSON.stringify(result)).not.toContain("Zola");
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("corrections", () => {
  /** A real run's first round, as the round endpoint dealt it. */
  async function dealt(): Promise<{ runId: string; round: RoundPayload }> {
    const started = await start(context());
    return { runId: started.runId, round: started.round };
  }

  function truth(deck: readonly Player[], id: string, round: RoundPayload, now: Date) {
    const player = deck.find((p) => p.id === id)!;
    const value = valueOf(player, round.stat.key, now)!;
    return { player, value, display: STATS[round.stat.key].format(value) };
  }

  it("put the server's own players, stat and values in the email", async () => {
    const { runId, round } = await dealt();
    const now = runDay(runId);
    const ctx = feedbackContext();
    const result = await handleFeedback(
      { kind: "correction", runId, round: 1, note: "Check this", turnstileToken: TOKEN },
      ctx,
    );
    expect(result).toEqual({ status: 200, body: { ok: true } });

    const mail = ctx.sent[0]!;
    expect(mail.subject).toBe(FEEDBACK_SUBJECTS.correction);
    const anchor = truth(SAMPLE_DECK, round.anchor.id, round, now);
    const challenger = truth(SAMPLE_DECK, round.challenger.id, round, now);
    expect(mail.text).toContain(`Stat: ${STATS[round.stat.key].label} (${round.stat.key})`);
    expect(mail.text).toContain(
      `Shown:  ${anchor.player.name} (${anchor.player.id}): ${anchor.display}`,
    );
    expect(mail.text).toContain(`[${anchor.value}]`);
    expect(mail.text).toContain(
      `Hidden: ${challenger.player.name} (${challenger.player.id}): ${challenger.display}`,
    );
    expect(mail.text).toContain(`[${challenger.value}]`);
    expect(mail.text).toContain("Check this");
    expect(mail.text).toContain("Round 1 of run 20260919-");
  });

  it("report the round asked for, deep into a run", async () => {
    const ctx = context();
    const { runId, started, answers } = await walkRun(ctx);
    const rounds = [started.round, ...answers.flatMap((a) => ("next" in a ? [a.next] : []))];
    const last = rounds.at(-1)!;
    const sent = feedbackContext();
    await handleFeedback(
      { kind: "correction", runId, round: last.index, turnstileToken: TOKEN },
      sent,
    );
    expect(sent.sent[0]!.text).toContain(`${last.anchor.name} (${last.anchor.id})`);
    expect(sent.sent[0]!.text).toContain(`${last.challenger.name} (${last.challenger.id})`);
    expect(sent.sent[0]!.text).toContain(`Round ${last.index} of`);
  });

  it("refuse a run id signed with another secret", async () => {
    const forged = await signedRunId("2026-09-19", uuidFrom(1), "not-the-secret");
    const ctx = feedbackContext({ verifyTurnstile: vi.fn(async () => "pass" as const) });
    const result = await handleFeedback(await correction({ runId: forged }), ctx);
    expect(rejection(result)).toBe("invalid_run");
    expect(ctx.verifyTurnstile).not.toHaveBeenCalled();
    expect(ctx.sent).toEqual([]);
  });

  it("refuse an unsigned or tampered run id", async () => {
    const genuine = await signedRunId("2026-09-19", uuidFrom(1));
    const body = genuine.slice(0, genuine.indexOf("."));
    const flipped = genuine.slice(0, -1) + (genuine.endsWith("A") ? "B" : "A");
    const otherRun = genuine.replace(uuidFrom(1), uuidFrom(2));
    for (const runId of [body, `${body}.`, flipped, otherRun]) {
      const result = await handleFeedback(await correction({ runId }), feedbackContext());
      expect(rejection(result), runId).toBe("invalid_run");
    }
  });

  it("refuse a run too old to answer", async () => {
    const old = await signedRunId("2026-08-01", uuidFrom(1));
    const result = await handleFeedback(await correction({ runId: old }), feedbackContext());
    expect(rejection(result)).toBe("run_expired");
  });

  it("refuse a round the run never dealt", async () => {
    // Two players tied on every stat: no pair can ever be dealt.
    const one = SAMPLE_DECK[0]!;
    const twins = [one, { ...one, id: `${one.id}-twin`, name: "Twin" }];
    const ctx = feedbackContext({ deck: twins });
    const result = await handleFeedback(await correction({ round: 1 }), ctx);
    expect(rejection(result)).toBe("invalid_round");
  });

  it("answer with nothing but { ok: true }: no value reaches the client", async () => {
    const ctx = context();
    for (let i = 0; i < 10; i++) {
      const { runId, started } = await walkRun(ctx);
      const now = runDay(runId);
      for (const round of [1, 2, 3]) {
        const result = await handleFeedback(
          { kind: "correction", runId, round, turnstileToken: TOKEN },
          feedbackContext(),
        );
        const text = JSON.stringify(result.body);
        expect(scanForLeakedValues(text, SAMPLE_DECK, now, "feedback response")).toEqual([]);
        expect(Object.keys(result.body).sort()).toEqual(
          result.status === 200 ? ["ok"] : ["detail", "error"],
        );
        expect(text).not.toContain(started.round.challenger.id);
      }
    }
  });
});

describe("an accepted message", () => {
  function recording(overrides: Partial<FeedbackContext> = {}) {
    const accepted: AcceptedFeedback[] = [];
    const order: string[] = [];
    const ctx = feedbackContext({
      accepted: (a) => {
        accepted.push(a);
        order.push("accepted");
      },
      ...overrides,
    });
    const send = ctx.send;
    return {
      ctx: {
        ...ctx,
        send: async (mail: PlainTextMail) => {
          order.push("send");
          await send(mail);
        },
      },
      accepted,
      order,
    };
  }

  it("reports a suggestion's cleaned name and note", async () => {
    const r = recording();
    await handleFeedback(
      suggest({ name: " Gianfranco Zola\u0007", note: "Chelsea\r\nlegend" }),
      r.ctx,
    );
    expect(r.accepted).toEqual([
      { kind: "suggest", submitted: { name: "Gianfranco Zola", note: "Chelsea\nlegend" } },
    ]);
  });

  it("leaves out a suggestion's missing note", async () => {
    const r = recording();
    await handleFeedback(suggest(), r.ctx);
    expect(r.accepted).toEqual([{ kind: "suggest", submitted: { name: "Gianfranco Zola" } }]);
  });

  it("reports a problem's note and page", async () => {
    const r = recording();
    await handleFeedback(problem({ note: "Typo\u0007 here", page: "/credits" }), r.ctx);
    expect(r.accepted).toEqual([
      { kind: "problem", submitted: { note: "Typo here", page: "/credits" } },
    ]);
  });

  it("reports a correction's round as shown, with the run key and never the run id", async () => {
    const started = await start(context());
    const { runId, round } = started;
    const now = runDay(runId);
    const r = recording();
    await handleFeedback(
      { kind: "correction", runId, round: 1, note: "Wrong fee", turnstileToken: TOKEN },
      r.ctx,
    );
    const def = STATS[round.stat.key];
    const shown = (role: string, id: string) => {
      const player = SAMPLE_DECK.find((p) => p.id === id)!;
      const qualifier = def.qualifier?.(player);
      return {
        role,
        name: player.name,
        display: def.format(valueOf(player, def.key, now)!),
        ...(qualifier !== undefined ? { qualifier } : {}),
      };
    };
    expect(r.accepted).toEqual([
      {
        kind: "correction",
        submitted: {
          note: "Wrong fee",
          run: runId.slice(0, runId.indexOf(".")),
          round: 1,
          stat: { id: def.key, label: def.label },
          players: [shown("anchor", round.anchor.id), shown("challenger", round.challenger.id)],
        },
      },
    ]);
    const text = JSON.stringify(r.accepted);
    expect(text).not.toContain(runId);
    expect(text).not.toContain(runId.slice(runId.indexOf(".") + 1));
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("owner@example.com");
  });

  it("is told only once the message is valid and verified, and before the send", async () => {
    const refused = recording();
    await handleFeedback(suggest({ email: "a@b.com" }), refused.ctx);
    expect(refused.accepted).toEqual([]);

    for (const verdict of ["fail", "error"] as const) {
      const r = recording({ verifyTurnstile: async () => verdict });
      await handleFeedback(suggest(), r.ctx);
      expect(r.accepted, verdict).toEqual([]);
    }

    const passed = recording();
    await handleFeedback(suggest(), passed.ctx);
    expect(passed.order).toEqual(["accepted", "send"]);
  });

  it("is told even when the send then fails", async () => {
    const r = recording({
      send: async () => {
        throw Object.assign(new Error("nope"), { code: "E_RATE_LIMIT_EXCEEDED" });
      },
    });
    const result = await handleFeedback(suggest(), r.ctx);
    expect(result.status).toBe(502);
    expect(r.accepted).toHaveLength(1);
  });
});
