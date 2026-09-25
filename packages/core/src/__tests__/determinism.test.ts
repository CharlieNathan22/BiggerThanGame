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
import type { Mode } from "../types.js";

function fingerprint(seed: string, mode: Mode = "ranked"): string {
  return buildRun({ deck: fixtureDeck, seed, mode, now: NOW, maxRounds: 25 })
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
      `"1:caps:hotel>foxtrot|2:caps:foxtrot>bravo|3:ig:bravo>india|4:ig:india>alpha|5:ig:alpha>echo|6:ig:echo>lima|7:club_goals:lima>kilo|8:club_goals:kilo>delta|9:club_goals:delta>charlie|10:club_goals:charlie>juliet|11:clubs:juliet>golf|12:clubs:golf>india|13:clubs:india>delta|14:clubs:delta>hotel|15:clubs:hotel>golf|16:clubs:golf>echo|17:clubs:echo>foxtrot|18:clubs:foxtrot>delta|19:clubs:delta>india|20:clubs:india>juliet|21:clubs:juliet>kilo|22:clubs:kilo>delta|23:clubs:delta>alpha|24:clubs:alpha>delta|25:clubs:delta>juliet"`,
    );
  });

  it("a friendly run is stable", () => {
    expect(fingerprint("friendly:1", "friendly")).toMatchInlineSnapshot(
      `"1:club_goals:hotel>lima|2:club_goals:lima>alpha|3:club_goals:alpha>delta|4:caps:delta>foxtrot|5:caps:foxtrot>bravo|6:caps:bravo>echo|7:ig:echo>juliet|8:ig:juliet>kilo|9:ig:kilo>india|10:ig:india>charlie|11:club_goals:charlie>golf|12:club_goals:golf>charlie|13:club_goals:charlie>delta|14:club_goals:delta>hotel|15:club_goals:hotel>delta|16:club_goals:delta>hotel|17:club_goals:hotel>alpha|18:club_goals:alpha>hotel|19:club_goals:hotel>foxtrot|20:club_goals:foxtrot>delta|21:club_goals:delta>foxtrot|22:club_goals:foxtrot>hotel|23:club_goals:hotel>golf|24:club_goals:golf>charlie|25:club_goals:charlie>foxtrot"`,
    );
  });

  it("a second ranked run is stable", () => {
    expect(fingerprint("ranked:2")).toMatchInlineSnapshot(
      `"1:caps:alpha>foxtrot|2:caps:foxtrot>hotel|3:caps:hotel>echo|4:ig:echo>bravo|5:ig:bravo>charlie|6:ig:charlie>juliet|7:ig:juliet>kilo|8:ig:kilo>india|9:club_goals:india>delta|10:club_goals:delta>lima|11:club_goals:lima>golf|12:club_goals:golf>hotel|13:club_goals:hotel>foxtrot|14:club_goals:foxtrot>juliet|15:club_goals:juliet>india|16:club_goals:india>bravo|17:club_goals:bravo>golf|18:club_goals:golf>hotel|19:club_goals:hotel>foxtrot|20:club_goals:foxtrot>charlie|21:club_goals:charlie>bravo|22:club_goals:bravo>india|23:club_goals:india>golf|24:club_goals:golf>charlie|25:club_goals:charlie>delta"`,
    );
  });
});
