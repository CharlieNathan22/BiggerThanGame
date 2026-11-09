/**
 * 1v1's words: pure, so they're tested rather than buried in markup. Numbers
 * go through the site's own formatter (`count`), and plurals through the
 * `.one` / `.other` pairs in en.ts. The room sends codes; the words are here.
 */

import { REJOIN_MS, isSuddenDeath } from "@bt/core";
import type {
  DuelLimit,
  Reveal,
  RoomClosedReason,
  RoomErrorCode,
  RoomPlayerView,
  RoundPayload,
} from "@bt/core";
import { hasMessage, t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { count } from "../publish";
import { poolShareName } from "../stream/match";
import type { PoolOption } from "../stream/settings";
import type { SeatProblem } from "./api";
import { duelOutcome, duelQuestions, duelScore, duelSeries, opponent } from "./room";
import type { DuelView, RevealView } from "./room";
import type { LinkStatus } from "./socket";

/** What the page calls the other player before they have a name here. */
export function opponentName(view: DuelView): string {
  return opponent(view)?.name ?? "";
}

/** A timer's name: "Fast", "Relaxed", "Slow". */
export function limitName(limit: DuelLimit): string {
  return t(`duel.limit.${limit}`);
}

/** Under a timer's name: "10 s". */
export function limitSeconds(limit: DuelLimit): string {
  return t("duel.limit.seconds", { seconds: limit });
}

/** A timer for a screen reader: "Fast, 10 seconds per question". */
export function limitLabel(limit: DuelLimit): string {
  return t("duel.limit.name", { name: limitName(limit), seconds: limit });
}

/** The lobby's line for the timer: "Relaxed: 20 seconds a question". */
export function limitLine(limit: DuelLimit): string {
  return t("duel.lobby.timer", { name: limitName(limit), seconds: limit });
}

/** Why a seat wasn't had, under the field it is about. */
export function seatProblemText(problem: SeatProblem): string {
  switch (problem) {
    case "nameTaken":
      return t("duel.name.taken");
    case "nameRejected":
      return t("publish.rejected");
    case "full":
      return t("duel.problem.full");
    case "closed":
      return t("duel.problem.closed");
    case "verification":
      return t("duel.problem.check");
    case "slowDown":
      return t("duel.problem.slowDown");
    case "failed":
      return t("duel.problem.failed");
  }
}

/** Whether a seat's problem is with the name, so it shows under the name's field. */
export function isNameProblem(problem: SeatProblem | null): boolean {
  return problem === "nameTaken" || problem === "nameRejected";
}

/** Why the room has gone, in words. */
export function closedText(reason: RoomClosedReason): string {
  return t(`duel.closed.${reason}`);
}

/** The room's refusal, in words; "" for one the page has nothing to say about. */
export function refusedText(code: RoomErrorCode | null): string {
  if (code === null) return "";
  const key = `duel.refused.${code}`;
  return hasMessage(key) ? t(key as MessageKey) : "";
}

/** How this page's own connection reads at a glance. */
export function linkTone(link: LinkStatus): "ok" | "busy" | "bad" {
  if (link.kind === "connected") return "ok";
  return link.kind === "closed" ? "bad" : "busy";
}

/** Whole seconds left of `ms`, never below zero. */
export function secondsLeft(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * This page's connection, in words. In a match a dropped connection counts
 * down what the room gives a player to come back (`since` and `now` on the
 * socket's own clock); in the lobby and at full time there is no limit, so
 * no countdown.
 */
export function linkText(link: LinkStatus, playing: boolean, now: number): string {
  switch (link.kind) {
    case "connected":
      return t("duel.status.connected");
    case "idle":
    case "connecting":
      return t("duel.status.connecting");
    case "reconnecting": {
      if (!playing) return t("duel.status.reconnecting");
      // `now` ticks a couple of times a second and can trail the drop itself.
      const left = secondsLeft(REJOIN_MS - Math.max(0, now - link.since));
      return t(left === 1 ? "duel.status.reconnectingIn.one" : "duel.status.reconnectingIn.other", {
        count: count(left),
      });
    }
    case "closed":
      return "";
  }
}

/**
 * The other player's connection, in words: connected, away, or in a match how
 * long they have to come back. `sinceMs` is how long ago the room said so.
 */
export function opponentText(player: RoomPlayerView | undefined, sinceMs = 0): string {
  if (player === undefined) return "";
  const { name } = player;
  if (player.left === true) return t("duel.them.left", { name });
  if (player.connected) return t("duel.them.connected", { name });
  if (player.rejoinInMs === undefined) return t("duel.them.away", { name });
  const left = secondsLeft(player.rejoinInMs - Math.max(0, sinceMs));
  return t(left === 1 ? "duel.them.awayIn.one" : "duel.them.awayIn.other", {
    name,
    count: count(left),
  });
}

/** The track's words: "Question 7 of 20", the final question, or sudden death's own count. */
export function trackText(index: number, questions: number): string {
  if (isSuddenDeath(index, questions)) {
    return t("duel.track.suddenDeath", { round: index - questions });
  }
  const params = { round: index, target: questions };
  return index === questions ? t("duel.track.final", params) : t("duel.track.question", params);
}

function pickWord(pick: "higher" | "lower" | null): string {
  return t(pick === null ? "duel.pick.none" : `duel.pick.${pick}`);
}

/** Both picks at the reveal, this player's first: "You: higher", "Sam: no answer". */
export function revealPicks(
  view: DuelView,
  reveal: RevealView,
): { readonly you: string; readonly them: string } {
  const them = view.you === 0 ? 1 : 0;
  return {
    you: t("duel.reveal.you", { pick: pickWord(reveal.picks[view.you] ?? null) }),
    them: t("duel.reveal.them", {
      name: opponentName(view),
      pick: pickWord(reveal.picks[them] ?? null),
    }),
  };
}

/** What a screen reader hears at a reveal: the figure, both picks and verdicts, and the score. */
export function revealAnnouncement(
  view: DuelView,
  reveal: RevealView,
  round: RoundPayload,
  figure: Reveal,
): string {
  const them = view.you === 0 ? 1 : 0;
  const score = duelScore(view);
  const verdict = (right: boolean | undefined): string =>
    t(right === true ? "live.duelRight" : "live.duelWrong");
  return t("live.duelReveal", {
    challenger: round.challenger.name,
    value: figure.display,
    you: pickWord(reveal.picks[view.you] ?? null),
    yourVerdict: verdict(reveal.correct[view.you]),
    name: opponentName(view),
    them: pickWord(reveal.picks[them] ?? null),
    theirVerdict: verdict(reveal.correct[them]),
    yourScore: score.you,
    theirScore: score.them,
  });
}

/** "You win", "Sam wins" or "It's a draw". */
export function resultText(view: DuelView): string {
  const outcome = duelOutcome(view);
  if (outcome === "won") return t("duel.result.won");
  if (outcome === "lost") return t("duel.result.lost", { name: opponentName(view) });
  return t("duel.result.draw");
}

/** The line under the result when it wasn't simply the higher score: sudden death, a forfeit… */
export function resultNote(view: DuelView): string {
  const { result } = view;
  if (result === null) return "";
  const played = result.results[0]?.length ?? 0;
  switch (result.reason) {
    case "sudden-death":
      return t("duel.result.suddenDeath");
    case "draw":
      return t("duel.result.drawAfter", { count: count(Math.max(0, played - result.questions)) });
    case "exhausted":
      return t("duel.result.exhausted");
    case "forfeit":
      return result.left === view.you
        ? t("duel.result.forfeitLost")
        : t("duel.result.forfeitWon", { name: opponentName(view) });
    case "finished":
      return "";
  }
}

/** "Series: You 2 – 1 Sam". */
export function seriesText(view: DuelView): string {
  const series = duelSeries(view);
  return t("duel.result.series", { you: series.you, them: series.them, name: opponentName(view) });
}

/** The strip's words for a screen reader: "Question 3: you right, Sam wrong." */
export function stripLabel(view: DuelView): string {
  const name = opponentName(view);
  const word = (right: boolean): string => t(right ? "duel.strip.right" : "duel.strip.wrong");
  return duelQuestions(view)
    .map((q) =>
      t("duel.strip.question", { round: q.index, you: word(q.you), name, them: word(q.them) }),
    )
    .join(" ");
}

/**
 * The share text: "I beat Sam 14–12 on Barcelona legends · Bigger Than 1v1",
 * then the 1v1 page's address (never the room's). No player of the deck, no
 * stat, no figure: nothing it says spoils a question.
 */
export function duelShareText(view: DuelView, pool: PoolOption | undefined, link: string): string {
  const score = duelScore(view);
  const outcome = duelOutcome(view) ?? "draw";
  const line = t(`duel.share.${outcome}`, {
    name: opponentName(view),
    you: score.you,
    them: score.them,
    pool: poolShareName(pool),
  });
  return `${line}\n${link}`;
}
