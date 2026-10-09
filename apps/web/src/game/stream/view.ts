/**
 * Twitch Mode's words: pure, so they're tested rather than buried in markup.
 * Numbers go through the site's own formatter (`count`), and plurals through
 * the `.one` / `.other` pairs in en.ts.
 */

import { canEndVoting } from "@bt/core";
import type { StreamLimit } from "@bt/core";
import { t } from "../../i18n";
import type { GameState } from "../machine";
import { count } from "../publish";
import type { ChatStatus } from "./chat-source";
import { COMMANDS } from "./commands";
import type { VoteCommands } from "./commands";

/** "Connected to #shroud", "Couldn't find #shroud on Twitch…", and the rest. */
export function statusText(status: ChatStatus): string {
  switch (status.kind) {
    case "idle":
      return t("stream.status.idle");
    case "connecting":
      return t("stream.status.connecting", { channel: status.channel });
    case "connected":
      return t("stream.status.connected", { channel: status.channel });
    case "reconnecting":
      return t("stream.status.reconnecting", { channel: status.channel });
    case "failed":
      return t(`stream.status.failed.${status.reason}`, { channel: status.channel });
  }
}

/** How the status reads at a glance: fine, working on it, or a problem. */
export function statusTone(status: ChatStatus): "ok" | "busy" | "bad" | "idle" {
  if (status.kind === "connected") return "ok";
  if (status.kind === "failed") return "bad";
  if (status.kind === "idle") return "idle";
  return "busy";
}

/** "1 vote this question", "1,204 votes this question". */
export function votesText(voters: number): string {
  return t(voters === 1 ? "stream.votes.one" : "stream.votes.other", { count: count(voters) });
}

/** "Type !h or !higher · !l or !lower in chat", from the commands in play. */
export function hintText(commands: VoteCommands = COMMANDS): string {
  return t("stream.hint", {
    higherShort: commands.hint.higher[0],
    higher: commands.hint.higher[1],
    lowerShort: commands.hint.lower[0],
    lower: commands.hint.lower[1],
  });
}

/** A timer's button: "10 s", "1 min". */
export function limitLabel(limit: StreamLimit): string {
  return limit === 60
    ? t("stream.settings.minute")
    : t("stream.settings.seconds", { seconds: limit });
}

/** A timer's name for a screen reader: "10 seconds", "1 minute". */
export function limitName(limit: StreamLimit): string {
  return limit === 60
    ? t("stream.settings.minuteLong")
    : t("stream.settings.secondsLong", { seconds: limit });
}

/**
 * Whether "End voting" shows now: a question waiting, on a timer that offers
 * it, with at least `END_VOTING_AFTER_MS` gone (`canEndVoting` in @bt/core).
 */
export function endVotingShown(state: GameState, now: number): boolean {
  const { clock, stream } = state;
  if (state.phase !== "awaiting" || clock === null || stream === null) return false;
  return canEndVoting(stream.limit, now - clock.startedAt);
}

/** Whether chat's votes count now: from the question becoming answerable to the window closing. */
export function votingOpen(state: Pick<GameState, "phase" | "clock">): boolean {
  return state.phase === "awaiting" && state.clock !== null;
}
