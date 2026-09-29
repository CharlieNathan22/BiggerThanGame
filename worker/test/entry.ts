/**
 * The Worker the workerd tests run (worker/src/__tests__/workerd.test.ts): the
 * real app, the real Durable Object and a local D1 on the fixture deck, with Turnstile
 * always passing and the rate limits always allowing. Never deployed.
 *
 * Two test-only extras: `GET /test/fingerprint?seed=&mode=` deals a run in
 * workerd, for the cross-runtime determinism check; and `RunDO.alarmAt(now)`
 * runs the Durable Object's alarm as at a chosen moment.
 */

import { buildRun } from "@bt/core";
import type { Mode } from "@bt/core";
import { NOW, fixtureDeck } from "../../packages/core/src/__fixtures__/deck.js";
import { RunDO as BaseRunDO } from "../run-do.js";
import { createApp } from "../src/app.js";
import type { Env } from "../src/app.js";

export class RunDO extends BaseRunDO {
  async alarmAt(now: number): Promise<void> {
    await this.onAlarm(now);
  }
}

const app = createApp({
  deck: fixtureDeck,
  images: {},
  deckVersion: "legends-fixture",
  log: () => {},
  fetch: async () => new Response(JSON.stringify({ success: true })),
});

const allow = { limit: async () => ({ success: true }) };

/** Dealt as the core determinism test deals it: the fixture deck at its NOW, 25 rounds. */
export function fingerprint(seed: string, mode: Mode): string {
  return buildRun({ deck: fixtureDeck, seed, mode, now: NOW, maxRounds: 25 })
    .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
    .join("|");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/test/fingerprint") {
      const seed = url.searchParams.get("seed") ?? "";
      const mode = (url.searchParams.get("mode") ?? "endless") as Mode;
      return new Response(fingerprint(seed, mode));
    }
    return app.fetch(request, {
      ...env,
      RUN_ANSWERS: allow,
      RUN_STARTS: allow,
      ROUND_FLOOD: allow,
      FEEDBACK_SENDS: allow,
      RUN_SUBMITS: allow,
    });
  },
  scheduled: (controller: ScheduledController, env: Env) => app.scheduled(controller, env),
} satisfies ExportedHandler<Env>;
