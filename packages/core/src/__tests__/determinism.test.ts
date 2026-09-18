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
    expect(fingerprint("ranked:1")).toMatchInlineSnapshot(`"1:caps:alpha>foxtrot|2:caps:foxtrot>hotel|3:caps:hotel>echo|4:caps:echo>juliet|5:caps:juliet>kilo|6:ig:kilo>india|7:ig:india>charlie|8:club_goals:charlie>lima|9:club_goals:lima>bravo|10:club_goals:bravo>golf|11:club_goals:golf>delta|12:club_goals:delta>india|13:club_goals:india>alpha|14:club_goals:alpha>charlie|15:club_goals:charlie>juliet|16:club_goals:juliet>foxtrot|17:club_goals:foxtrot>juliet|18:club_goals:juliet>golf|19:club_goals:golf>hotel|20:club_goals:hotel>golf|21:club_goals:golf>hotel|22:club_goals:hotel>india|23:club_goals:india>hotel|24:club_goals:hotel>kilo|25:club_goals:kilo>charlie"`);
  });

  it("a second ranked run is stable", () => {
    expect(fingerprint("ranked:2")).toMatchInlineSnapshot(`"1:caps:alpha>foxtrot|2:caps:foxtrot>hotel|3:fee:hotel>delta|4:fee:delta>kilo|5:ig:kilo>lima|6:ig:lima>bravo|7:club_goals:bravo>golf|8:club_goals:golf>charlie|9:club_goals:charlie>juliet|10:club_goals:juliet>india|11:ig:india>echo|12:ig:echo>lima|13:ig:lima>echo|14:ig:echo>bravo|15:ig:bravo>delta|16:ig:delta>foxtrot|17:ig:foxtrot>delta|18:ig:delta>foxtrot|19:ig:foxtrot>lima|20:ig:lima>foxtrot|21:ig:foxtrot>delta|22:ig:delta>foxtrot|23:ig:foxtrot>juliet|24:ig:juliet>charlie|25:ig:charlie>bravo"`);
  });
});
