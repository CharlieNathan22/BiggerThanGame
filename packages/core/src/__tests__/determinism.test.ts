/**
 * Cross-runtime determinism.
 *
 * The engine must produce byte-identical runs in Node, in the browser and in
 * workerd. Daily Ranked depends on every player worldwide getting the same
 * sequence, and the Worker re-derives rounds to verify guesses — if the
 * runtimes can disagree about what round 12 was, none of that holds.
 *
 * The fingerprints below are golden values. If one changes, either the engine
 * changed (update them deliberately, and expect every in-flight Ranked run to
 * shift) or a runtime has diverged (a real bug — investigate).
 *
 * Run this same file under workerd as part of the Worker integration suite.
 */

import { describe, expect, it } from "vitest";
import { buildRun } from "../sequence.js";
import { createRng, hashSeed } from "../prng.js";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";

function fingerprint(seed: string): string {
  return buildRun({ deck: fixtureDeck, seed, now: NOW, maxRounds: 25 })
    .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
    .join("|");
}

describe("golden fingerprints", () => {
  it("hashSeed is stable across runtimes", () => {
    expect(hashSeed("ranked:1")).toBe(2_557_020_607);
    expect(hashSeed("endless:abc")).toBe(4_049_995_445);
  });

  it("the raw PRNG stream is stable", () => {
    const rng = createRng("golden");
    const first = [rng.next(), rng.next(), rng.next()].map((n) => n.toFixed(12));
    expect(first).toMatchInlineSnapshot(`
      [
        "0.594323272817",
        "0.943420797819",
        "0.303835050669",
      ]
    `);
  });

  it("a ranked run is stable", () => {
    expect(fingerprint("ranked:1")).toMatchInlineSnapshot(
      `"1:caps:hotel>foxtrot|2:caps:foxtrot>lima|3:ig:lima>echo|4:ig:echo>alpha|5:ig:alpha>delta|6:ig:delta>kilo|7:club_goals:kilo>juliet|8:club_goals:juliet>bravo|9:club_goals:bravo>golf|10:club_goals:golf>charlie|11:ig:charlie>india|12:ig:india>foxtrot|13:ig:foxtrot>delta|14:ig:delta>juliet|15:ig:juliet>delta|16:ig:delta>foxtrot|17:ig:foxtrot>india|18:ig:india>echo|19:ig:echo>kilo|20:ig:kilo>echo|21:ig:echo>lima|22:ig:lima>echo|23:ig:echo>bravo|24:ig:bravo>alpha|25:ig:alpha>kilo"`,
    );
  });

  it("a second ranked run is stable", () => {
    expect(fingerprint("ranked:2")).toMatchInlineSnapshot(
      `"1:caps:alpha>foxtrot|2:caps:foxtrot>kilo|3:caps:kilo>hotel|4:ig:hotel>delta|5:ig:delta>bravo|6:ig:bravo>lima|7:ig:lima>echo|8:ig:echo>juliet|9:club_goals:juliet>charlie|10:club_goals:charlie>golf|11:club_goals:golf>india|12:club_goals:india>delta|13:club_goals:delta>hotel|14:club_goals:hotel>foxtrot|15:club_goals:foxtrot>lima|16:club_goals:lima>delta|17:club_goals:delta>foxtrot|18:club_goals:foxtrot>hotel|19:club_goals:hotel>foxtrot|20:club_goals:foxtrot>charlie|21:club_goals:charlie>bravo|22:club_goals:bravo>india|23:club_goals:india>golf|24:club_goals:golf>charlie|25:club_goals:charlie>delta"`,
    );
  });
});
