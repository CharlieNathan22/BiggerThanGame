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
      `"1:apps:alpha>hotel|2:apps:hotel>charlie|3:ct:charlie>juliet|4:ct:juliet>lima|5:ct:lima>bravo|6:ct:bravo>echo|7:ct:echo>foxtrot|8:ig:foxtrot>kilo|9:ig:kilo>india|10:ig:india>delta|11:ct:delta>golf|12:ct:golf>charlie|13:ct:charlie>bravo|14:ct:bravo>hotel|15:ct:hotel>charlie|16:ct:charlie>juliet|17:ct:juliet>echo|18:ct:echo>delta|19:ct:delta>echo|20:ct:echo>delta|21:ct:delta>hotel|22:ct:hotel>kilo|23:ct:kilo>india|24:ct:india>echo|25:ct:echo>bravo"`,
    );
  });

  it("a friendly run is stable", () => {
    expect(fingerprint("friendly:1", "friendly")).toMatchInlineSnapshot(
      `"1:igoals:hotel>lima|2:igoals:lima>alpha|3:age:alpha>foxtrot|4:age:foxtrot>charlie|5:age:charlie>bravo|6:apps:bravo>india|7:apps:india>juliet|8:apps:juliet>delta|9:apps:delta>golf|10:igoals:golf>kilo|11:igoals:kilo>alpha|12:igoals:alpha>kilo|13:ig:kilo>echo|14:ig:echo>kilo|15:ig:kilo>echo|16:ig:echo>kilo|17:ig:kilo>echo|18:ig:echo>india|19:ig:india>bravo|20:ig:bravo>foxtrot"`,
    );
  });

  it("an endless run is stable", () => {
    expect(fingerprint("endless:1", "endless")).toMatchInlineSnapshot(
      `"1:ig:hotel>lima|2:ig:lima>alpha|3:ct:alpha>bravo|4:ct:bravo>echo|5:ct:echo>juliet|6:ct:juliet>kilo|7:apps:kilo>india|8:apps:india>charlie|9:apps:charlie>golf|10:igoals:golf>foxtrot|11:igoals:foxtrot>delta|12:it:delta>india|13:it:india>echo|14:it:echo>india|15:it:india>echo|16:ig:echo>kilo|17:ig:kilo>echo|18:fee:echo>bravo|19:fee:bravo>echo|20:fee:echo>bravo|21:club_goals:bravo>hotel|22:club_goals:hotel>charlie|23:club_goals:charlie>india|24:age:india>alpha|25:age:alpha>delta"`,
    );
  });

  it("an Instagram Endless run is stable", () => {
    const run = buildRun({
      deck: fixtureDeck,
      seed: "endless:instagram:1",
      mode: "endless",
      now: NOW,
      maxRounds: 25,
      variant: "endless-instagram",
    });
    expect(
      run.map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`).join("|"),
    ).toMatchInlineSnapshot(
      `"1:ig:hotel>foxtrot|2:ig:foxtrot>alpha|3:ig:alpha>juliet|4:ig:juliet>bravo|5:ig:bravo>lima|6:ig:lima>echo|7:ig:echo>delta|8:ig:delta>india|9:ig:india>charlie|10:ig:charlie>kilo|11:ig:kilo>bravo|12:ig:bravo>kilo|13:ig:kilo>echo|14:ig:echo>kilo|15:ig:kilo>echo|16:ig:echo>kilo|17:ig:kilo>bravo|18:ig:bravo>alpha|19:ig:alpha>hotel|20:ig:hotel>alpha|21:ig:alpha>bravo|22:ig:bravo>alpha|23:ig:alpha>hotel|24:ig:hotel>alpha|25:ig:alpha>hotel"`,
    );
  });

  it("a second ranked run is stable", () => {
    expect(fingerprint("ranked:2")).toMatchInlineSnapshot(
      `"1:club_goals:bravo>delta|2:club_goals:delta>alpha|3:ct:alpha>hotel|4:ct:hotel>echo|5:ct:echo>juliet|6:ct:juliet>charlie|7:ct:charlie>foxtrot|8:igoals:foxtrot>kilo|9:igoals:kilo>lima|10:apps:lima>golf|11:apps:golf>india|12:apps:india>golf|13:apps:golf>hotel|14:apps:hotel>india|15:apps:india>lima|16:apps:lima>bravo|17:apps:bravo>delta|18:apps:delta>foxtrot|19:apps:foxtrot>bravo|20:apps:bravo>delta|21:apps:delta>bravo|22:apps:bravo>india|23:apps:india>golf|24:apps:golf>alpha|25:apps:alpha>echo"`,
    );
  });
});
