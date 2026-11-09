/**
 * The Worker the workerd tests run (worker/src/__tests__/workerd.test.ts): the
 * real app, the real Durable Object and a local D1 on the fixture deck, with Turnstile
 * always passing and the rate limits always allowing. Never deployed.
 *
 * Two test-only extras: `GET /test/fingerprint?seed=&mode=` deals a run in
 * workerd, for the cross-runtime determinism check (`&questions=` deals a
 * Twitch Mode match on the `variant` pool instead, and with `&duel` a 1v1
 * match and its sudden death); and `RunDO.alarmAt(now)` and
 * `RoomDO.alarmAt(now)` run a Durable Object's alarm as at a chosen moment
 * (`RoomDO.alarmDue()` says when its alarm is set for).
 * A room deals from the fixture deck here, as the app does.
 */

import {
  DAY_MS,
  buildDuelRun,
  buildRun,
  buildStreamRun,
  isEndlessVariantId,
  startOfDay,
} from "@bt/core";
import type { EndlessVariantId, Mode, Player } from "@bt/core";
import { NOW, fixtureDeck } from "../../packages/core/src/__fixtures__/deck.js";
import { RoomDO as BaseRoomDO } from "../room-do.js";
import { RunDO as BaseRunDO } from "../run-do.js";
import { createApp } from "../src/app.js";
import type { Env } from "../src/app.js";

export class RunDO extends BaseRunDO {
  async alarmAt(now: number): Promise<void> {
    await this.onAlarm(now);
  }
}

/** A room that deals from the fixture deck, as the test app does, with the alarm on call. */
export class RoomDO extends BaseRoomDO {
  protected override source(): { deck: readonly Player[]; images: Record<string, never> } {
    return { deck: fixtureDeck, images: {} };
  }

  async alarmAt(now: number): Promise<void> {
    await this.onAlarm(now);
  }

  /** When the room's alarm is set for, or null. */
  async alarmDue(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }
}

/**
 * The app, made on the first request: Daily Ranked's epoch here is two days
 * before the test runs, so today is Game 3 whatever `DAILY_EPOCH` says (a
 * launch date still to come would refuse every start). Not at the top level,
 * where workerd's clock hasn't started.
 */
let made: ReturnType<typeof createApp> | undefined;
function app(): ReturnType<typeof createApp> {
  made ??= createApp({
    deck: fixtureDeck,
    images: {},
    deckVersion: "legends-fixture",
    epoch: startOfDay(new Date()) - 2 * DAY_MS,
    log: () => {},
    fetch: async () => new Response(JSON.stringify({ success: true })),
  });
  return made;
}

const allow = { limit: async () => ({ success: true }) };

/** Dealt as the core determinism test deals it: the fixture deck at its NOW, 25 rounds. */
export function fingerprint(seed: string, mode: Mode, variant?: EndlessVariantId): string {
  return buildRun({
    deck: fixtureDeck,
    seed,
    mode,
    now: NOW,
    maxRounds: 25,
    ...(variant !== undefined ? { variant } : {}),
  })
    .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
    .join("|");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/test/fingerprint") {
      const seed = url.searchParams.get("seed") ?? "";
      const mode = (url.searchParams.get("mode") ?? "endless") as Mode;
      const variant = url.searchParams.get("variant");
      const questions = Number(url.searchParams.get("questions") ?? "0");
      if (questions > 0 && isEndlessVariantId(variant) && url.searchParams.has("duel")) {
        return new Response(
          buildDuelRun({ deck: fixtureDeck, seed, now: NOW, pool: variant, questions })
            .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
            .join("|"),
        );
      }
      if (questions > 0 && isEndlessVariantId(variant)) {
        return new Response(
          buildStreamRun({ deck: fixtureDeck, seed, now: NOW, pool: variant, questions })
            .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
            .join("|"),
        );
      }
      return new Response(
        fingerprint(seed, mode, isEndlessVariantId(variant) ? variant : undefined),
      );
    }
    return app().fetch(request, {
      ...env,
      RUN_ANSWERS: allow,
      RUN_STARTS: allow,
      ROUND_FLOOD: allow,
      FEEDBACK_SENDS: allow,
      RUN_SUBMITS: allow,
      BOARD_LOOKUPS: allow,
    });
  },
  scheduled: (controller: ScheduledController, env: Env) => app().scheduled(controller, env),
} satisfies ExportedHandler<Env>;
