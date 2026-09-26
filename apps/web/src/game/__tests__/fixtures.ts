import type {
  AnchorCard,
  ChallengeLink,
  ContinueResponse,
  EndResponse,
  PlayerCard,
  RoundPayload,
  StatKey,
  Tier,
} from "@bt/core";
import { STATS } from "@bt/core";

export function card(id: string, name = id): PlayerCard {
  return { id, name, country: "Nowhere", position: "MF" };
}

export function anchor(id: string, value: number, stat: StatKey = "caps"): AnchorCard {
  return { ...card(id), value, display: STATS[stat].format(value) };
}

export interface RoundOptions {
  readonly stat?: StatKey;
  readonly statChanged?: boolean;
  readonly anchorValue?: number;
}

export function round(index: number, options: RoundOptions = {}): RoundPayload {
  const stat = options.stat ?? "caps";
  const def = STATS[stat];
  return {
    index,
    stat: {
      key: stat,
      label: def.label,
      tier: def.tier as Tier,
      statChanged: options.statChanged ?? false,
    },
    anchor: anchor(`p${index}`, options.anchorValue ?? 50, stat),
    challenger: card(`p${index + 1}`),
  };
}

export function cont(index: number, next: RoundPayload, value = 80): ContinueResponse {
  return { reveal: { round: index, value, display: String(value), correct: true }, next };
}

/** A well-formed run id and signature, for challenge links in tests. */
export const RUN_ID = "20260919-00000000-0000-4000-8000-000000000001.AAAAAAAAAAAAAAAAAAAAAA";
export const SIG = "BBBBBBBBBBBBBBBBBBBBBB";

export function link(score: number): ChallengeLink {
  return { runId: RUN_ID, score, sig: SIG };
}

export function wrong(index: number, value = 20): EndResponse {
  return {
    reveal: { round: index, value, display: String(value), correct: false },
    end: "wrong",
    challenge: link(index - 1),
  };
}

export function exhausted(index: number, value = 80): EndResponse {
  return {
    reveal: { round: index, value, display: String(value), correct: true },
    end: "deck-exhausted",
    challenge: link(index),
  };
}
