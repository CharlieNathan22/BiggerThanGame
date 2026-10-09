/**
 * A Twitch Mode match, scored for both sides (DESIGN.md §3, Twitch Mode).
 *
 * The streamer's side is the server's verdict on their pick. Chat's is
 * scored here, against the answer the reveal shows: chat's majority pick, a
 * tie a miss ("Chat split 50/50"), no votes a miss ("No votes"). Pure, so the
 * scoring and the words are tested; the island only renders it.
 *
 * Nothing here names a player or a figure: the share text and image say the
 * score, the channel and the pool, and the per-question strip, so they can be
 * posted while the match is fresh in chat without spoiling a thing.
 */

import type { ChatPick, Guess, Reveal, RoundPayload, TimedGuess } from "@bt/core";
import { t } from "../../i18n";
import type { GridCell, ShareCard, ShareRow } from "../share";
import type { PoolOption } from "./settings";
import { pickOf } from "./votes";
import type { VoteCounts } from "./votes";

/** How chat did on a question. */
export type ChatOutcome = "right" | "wrong" | "split" | "none";

/** One question, both sides. */
export interface QuestionResult {
  readonly index: number;
  /** The streamer's pick: right, wrong, or none (the window closed with no pick). */
  readonly streamer: "right" | "wrong" | "none";
  readonly chat: ChatOutcome;
  /** The votes as they stood when voting closed. */
  readonly counts: VoteCounts;
}

export interface MatchScore {
  readonly chat: number;
  readonly streamer: number;
}

export type Winner = "chat" | "streamer" | "draw";

/** The right answer, from what the reveal shows: the challenger's figure against the anchor's. */
export function answerOf(round: RoundPayload, reveal: Reveal): Guess {
  return reveal.value > round.anchor.value ? "higher" : "lower";
}

export function chatOutcome(pick: ChatPick, answer: Guess): ChatOutcome {
  if (pick === "split" || pick === "none") return pick;
  return pick === answer ? "right" : "wrong";
}

/** A question as it ended: the server's verdict on the pick, and chat's against the answer. */
export function questionResult(
  round: RoundPayload,
  reveal: Reveal,
  guess: TimedGuess,
  counts: VoteCounts,
): QuestionResult {
  return {
    index: round.index,
    streamer: guess === "timeout" ? "none" : reveal.correct ? "right" : "wrong",
    chat: chatOutcome(pickOf(counts), answerOf(round, reveal)),
    counts,
  };
}

export function matchScore(results: readonly QuestionResult[]): MatchScore {
  return {
    chat: results.filter((r) => r.chat === "right").length,
    streamer: results.filter((r) => r.streamer === "right").length,
  };
}

export function winnerOf(score: MatchScore): Winner {
  if (score.chat === score.streamer) return "draw";
  return score.chat > score.streamer ? "chat" : "streamer";
}

/** "Chat won", "shroud won", or "It's a draw". */
export function winnerText(score: MatchScore, channel: string): string {
  const winner = winnerOf(score);
  if (winner === "draw") return t("stream.result.draw");
  return winner === "chat" ? t("stream.result.chatWins") : t("stream.result.youWin", { channel });
}

/** What chat did, in words, at the reveal: "Chat said higher", "Chat split 50/50", "No votes". */
export function chatPickText(counts: VoteCounts): string {
  const pick = pickOf(counts);
  if (pick === "none") return t("stream.reveal.none");
  if (pick === "split") return t("stream.reveal.split");
  return t(pick === "higher" ? "stream.reveal.chatHigher" : "stream.reveal.chatLower");
}

/** The pool's name in the share text: "Football Legends", "Instagram legends", "Barcelona legends". */
export function poolShareName(option: PoolOption | undefined): string {
  if (option === undefined || option.kind === "all") return t("stream.pool.share.all");
  if (option.kind === "instagram") return t("stream.pool.share.instagram");
  return t("stream.pool.share.theme", { name: option.theme?.name ?? "" });
}

/**
 * The share text: "Chat 12 – 14 shroud on Barcelona legends · Bigger Than
 * Twitch Mode", then the Twitch Mode page's address. No player, figure or answer.
 */
export function streamShareText(
  score: MatchScore,
  channel: string,
  pool: PoolOption | undefined,
  link: string,
): string {
  const line = t("stream.share", {
    chat: score.chat,
    streamer: score.streamer,
    channel,
    pool: poolShareName(pool),
  });
  return `${line}\n${link}`;
}

/** A side's strip: gold for a question it got, the miss (crossed) for one it didn't. */
export function stripCells(
  results: readonly QuestionResult[],
  side: "chat" | "streamer",
): GridCell[] {
  return results.map((r): GridCell =>
    r[side] === "right" ? { kind: "hit", tier: "basic" } : { kind: "miss" },
  );
}

/** The share image: the score, who won, the pool, and the two strips. No players. */
export function streamShareCard(
  results: readonly QuestionResult[],
  channel: string,
  pool: PoolOption | undefined,
  siteLabel: string,
): ShareCard {
  const score = matchScore(results);
  const rows: ShareRow[] = [
    { label: t("stream.score.chat"), cells: stripCells(results, "chat") },
    { label: channel, cells: stripCells(results, "streamer") },
  ];
  return {
    score: t("stream.score.figures", { chat: score.chat, streamer: score.streamer }),
    won: false,
    caption: t("stream.share.caption", { channel, pool: poolShareName(pool) }),
    title: winnerText(score, channel),
    cells: [],
    rows,
    ended: null,
    note: t("stream.share.mode"),
    players: null,
    challenge: "",
    site: siteLabel,
  };
}

/** The strip's words for a screen reader: "Question 3: chat right, shroud wrong". */
export function stripLabel(results: readonly QuestionResult[], channel: string): string {
  return results
    .map((r) =>
      t("stream.strip.question", {
        round: r.index,
        chat: t(`stream.strip.chat.${r.chat}`),
        channel,
        you: t(`stream.strip.you.${r.streamer}`),
      }),
    )
    .join(" ");
}
