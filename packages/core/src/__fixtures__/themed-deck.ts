/**
 * An invented deck with "Clear the squad" themes (themes.ts), shared by the
 * squad tests and Twitch Mode's.
 */

import { createRng } from "../prng.js";
import type { Player, Position } from "../types.js";

/**
 * An invented deck with themes either side of the threshold: Northfield 22
 * (with loans), Southgate exactly 15, Eastholm 9 (too few); the Testland
 * League 60 and Otherland League 14; the 2000s 30, the 1990s 18, and 12 from
 * the 1980s and 1970s, who make the Classic Era together.
 * Values are seeded and unique per stat, so ties are rare, as in real data.
 */
export function themedDeck(): Player[] {
  const rng = createRng("squad:deck");
  const positions: Position[] = ["GK", "DF", "MF", "FW"];
  const unique = (used: Set<number>, draw: () => number): number => {
    let v = draw();
    while (used.has(v)) v = draw();
    used.add(v);
    return v;
  };
  const caps = new Set<number>();
  const apps = new Set<number>();
  const goals = new Set<number>();
  const ig = new Set<number>();
  return Array.from({ length: 74 }, (_, i) => {
    const clubs: string[] = [];
    if (i < 22) clubs.push("Northfield");
    if (i >= 18 && i < 33) clubs.push("Southgate"); // four of them on loan from Northfield
    if (i >= 40 && i < 49) clubs.push("Eastholm");
    const era =
      i < 30 ? "2000s" : i < 48 ? "1990s" : i < 54 ? "1980s" : i < 60 ? "1970s" : undefined;
    return {
      id: `p${i}`,
      name: `Player ${i}`,
      country: "Testland",
      position: positions[i % 4]!,
      dob: `19${55 + (i % 35)}-0${1 + (i % 9)}-1${i % 10}`,
      iconic: i % 5 === 0,
      ...(era !== undefined ? { era } : {}),
      ...(clubs.length > 0 ? { mainClubs: clubs } : {}),
      leagues: i < 60 ? ["Testland League"] : ["Otherland League"],
      stats: {
        caps: unique(caps, () => 5 + Math.floor(rng.next() * 160)),
        apps: unique(apps, () => 200 + Math.floor(rng.next() * 700)),
        club_goals: unique(goals, () => Math.floor(rng.next() * 500)),
        ct: Math.floor(rng.next() * 30),
        it: Math.floor(rng.next() * 4),
        clubs: 1 + Math.floor(rng.next() * 7),
        ...(i % 3 !== 0
          ? {
              ig: {
                value: unique(ig, () => Math.round(rng.next() * 50000) / 100),
                asOf: "2026-09-01",
              },
            }
          : {}),
      },
    };
  });
}
