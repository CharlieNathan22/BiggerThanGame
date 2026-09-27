/**
 * viability.md — can the engine actually do what the ramp asks of it?
 *
 * This is the report that answers questions the design document can only pose.
 * Whether the 30–80% band is reachable at all; which stats die to tie
 * exclusion; whether two stats are so correlated that switching between them is
 * pointless. Read it after every deck change.
 */

import {
  BAND_SCHEDULES,
  ICONIC_ROUNDS,
  STATS,
  STAT_KEYS,
  bandFor,
  bandForRound,
  isEligible,
  pairFits,
  percentiles,
  WIN_ROUNDS,
} from "@bt/core";
import type { Band, Mode, Player, StatKey } from "@bt/core";

/** Names for the long schedule's bands, in order. */
const BAND_LABELS = ["opening", "early", "middle", "late", "hard", "knife edge"] as const;

/** The rounds of `mode`'s schedule that use `band`, e.g. `"1–8"`, or "" if none do. */
export function roundsWith(mode: Mode, band: Band): string {
  let from = 1;
  const spans: string[] = [];
  for (const row of BAND_SCHEDULES[mode]) {
    if (JSON.stringify(row.band) === JSON.stringify(band)) {
      const to = Math.min(row.upTo, WIN_ROUNDS[mode] ?? Infinity);
      spans.push(to === Infinity ? `${from}+` : from === to ? `${from}` : `${from}–${to}`);
    }
    from = row.upTo + 1;
  }
  return spans.join(", ");
}

/** One band the report counts pairs for. */
export interface ReportBand {
  readonly label: string;
  /** Where the band falls, in each schedule that uses it. */
  readonly rounds: string;
  /** A mode and round that use it: counts use `bandFor(stat, round, mode)`. */
  readonly mode: Mode;
  readonly round: number;
  readonly band: Band;
}

const same = (a: Band, b: Band): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The distinct bands the ramp uses, with a label for the report: the long
 * schedule's, some of which Friendly reuses over fewer rounds, then any band
 * only Friendly uses. Counts use
 * `bandFor(stat, round, mode)`, which adds the volatility floor for Instagram —
 * the same band the engine applies. `rounds` says where each band falls in
 * both schedules.
 */
export const REPORT_BANDS: readonly ReportBand[] = (() => {
  const long = BAND_SCHEDULES.endless.map((row, i, rows): ReportBand => {
    const friendly = roundsWith("friendly", row.band);
    const endless = roundsWith("endless", row.band);
    return {
      label: BAND_LABELS[i] ?? `band ${i + 1}`,
      rounds: friendly === "" ? endless : `${endless}; Friendly ${friendly}`,
      mode: "endless",
      round: i === 0 ? 1 : rows[i - 1]!.upTo + 1,
      band: row.band,
    };
  });
  const own: ReportBand[] = [];
  BAND_SCHEDULES.friendly.forEach((row, i, rows) => {
    if (long.some((b) => same(b.band, row.band)) || own.some((b) => same(b.band, row.band))) return;
    const rounds = roundsWith("friendly", row.band);
    own.push({
      label: `Friendly ${rounds}`,
      rounds: `Friendly ${rounds}`,
      mode: "friendly",
      round: i === 0 ? 1 : rows[i - 1]!.upTo + 1,
      band: row.band,
    });
  });
  return [...long, ...own];
})();

/** Bands in `mode`'s schedule that the report doesn't cover. Always empty; a test holds it there. */
export function uncoveredBands(mode: Mode): Band[] {
  return BAND_SCHEDULES[mode]
    .map((row) => row.band)
    .filter((band) => !REPORT_BANDS.some((b) => same(b.band, band)));
}

export interface StatViability {
  readonly stat: StatKey;
  readonly eligible: number;
  readonly distinctValues: number;
  readonly tiedPairs: number;
  /** Valid pairs per band, keyed by band label. */
  readonly pairsByBand: Readonly<Record<string, number>>;
}

function valuesFor(players: readonly Player[], key: StatKey, now: Date): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const p of players) {
    if (!isEligible(p, key, now)) continue;
    const v = STATS[key].get(p, now);
    if (v !== undefined) out.push([p.id, v]);
  }
  return out;
}

export function statViability(players: readonly Player[], key: StatKey, now: Date): StatViability {
  const values = valuesFor(players, key, now);
  const table = percentiles(players, key, now);
  const bands = REPORT_BANDS.map((b) => ({
    label: b.label,
    band: bandFor(key, b.round, b.mode),
  }));
  const pairsByBand: Record<string, number> = {};
  for (const b of REPORT_BANDS) pairsByBand[b.label] = 0;

  let tied = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const a = values[i]![1];
      const b = values[j]![1];
      if (a === b) {
        tied += 1;
        continue; // ties are excluded everywhere, so they count for no band
      }
      // The engine's own test, so the report and the deal can't disagree.
      for (const { label, band } of bands) {
        if (pairFits(table, a, b, band)) pairsByBand[label] = (pairsByBand[label] ?? 0) + 1;
      }
    }
  }

  return {
    stat: key,
    eligible: values.length,
    distinctValues: new Set(values.map(([, v]) => v)).size,
    tiedPairs: tied,
    pairsByBand,
  };
}

/**
 * Spearman rank correlation between two stats, over players eligible for both.
 *
 * Rank rather than Pearson because the stats are wildly different scales and
 * what matters is whether they order players the same way — which is exactly
 * what makes a stat switch pointless.
 */
export function rankCorrelation(
  players: readonly Player[],
  a: StatKey,
  b: StatKey,
  now: Date,
): number | undefined {
  const pairs: Array<[number, number]> = [];
  for (const p of players) {
    if (!isEligible(p, a, now) || !isEligible(p, b, now)) continue;
    const va = STATS[a].get(p, now);
    const vb = STATS[b].get(p, now);
    if (va === undefined || vb === undefined) continue;
    pairs.push([va, vb]);
  }
  if (pairs.length < 4) return undefined;

  const rank = (values: readonly number[]): number[] => {
    const order = values.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
    const ranks = new Array<number>(values.length).fill(0);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[order[k]![1]] = avg;
      i = j + 1;
    }
    return ranks;
  };

  const ra = rank(pairs.map(([x]) => x));
  const rb = rank(pairs.map(([, y]) => y));
  const n = ra.length;
  const mean = (n + 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i]! - mean;
    const y = rb[i]! - mean;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return undefined;
  return num / Math.sqrt(da * db);
}

export interface IconicViability {
  readonly stat: StatKey;
  /** Iconic players eligible for the stat. */
  readonly iconicEligible: number;
  /** Players eligible for the stat, i.e. possible anchors. */
  readonly anchors: number;
  /** Anchors with at least one non-tied iconic challenger within the opening band. */
  readonly anchorsWithIconic: number;
}

/**
 * Can the iconic preference (DESIGN.md §10) be honoured at the opening band?
 *
 * An anchor with no iconic challenger in band always falls back to the whole
 * deck. Static, before the recently-seen queue takes its cut — simulation.md
 * reports how often the preference actually falls back in play.
 */
export function iconicViability(
  players: readonly Player[],
  key: StatKey,
  now: Date,
): IconicViability {
  // Every mode opens on the same band.
  const band = bandFor(key, 1, "endless");
  const table = percentiles(players, key, now);
  const values = valuesFor(players, key, now);
  const iconicIds = new Set(players.filter((p) => p.iconic === true).map((p) => p.id));
  const iconic = values.filter(([id]) => iconicIds.has(id));

  let anchorsWithIconic = 0;
  for (const [id, v] of values) {
    const reachable = iconic.some(([otherId, w]) => {
      if (otherId === id) return false;
      return pairFits(table, v, w, band);
    });
    if (reachable) anchorsWithIconic += 1;
  }

  return { stat: key, iconicEligible: iconic.length, anchors: values.length, anchorsWithIconic };
}

/** Above this, a pair is correlated enough that switching between them is flat. */
export const CORRELATION_WARN = 0.8;

export function viabilityReport(players: readonly Player[], now: Date): string {
  const lines: string[] = [];
  lines.push("# Deck viability");
  lines.push("");
  lines.push(`Generated ${now.toISOString().slice(0, 10)} from ${players.length} players.`);
  lines.push("");
  lines.push("Counts are **unordered pairs that clear the band**, before the recently-seen");
  lines.push("queue takes its cut. Bands are in rank distance — how far apart two players sit");
  lines.push("in the deck's spread for the stat — and Instagram also needs the volatility floor,");
  lines.push("exactly as the engine deals them. A stat showing 0 at a band cannot be dealt there");
  lines.push("and will force relaxation every time the wheel picks it.");
  lines.push("");

  lines.push("| Band | Rank distance | Rounds |");
  lines.push("|---|---|---|");
  for (const b of REPORT_BANDS) {
    const range = `${b.band.floor}–${b.band.ceiling ?? "no ceiling"}`;
    lines.push(`| ${b.label} | ${range} | ${b.rounds} |`);
  }
  lines.push("");
  for (const mode of Object.keys(BAND_SCHEDULES) as Mode[]) {
    for (const band of uncoveredBands(mode)) {
      lines.push(`> ${mode}'s band ${JSON.stringify(band)} is not covered by this report.`);
      lines.push("");
    }
  }

  const header = [
    "Stat",
    "Eligible",
    "Distinct",
    "Tied pairs",
    ...REPORT_BANDS.map((b) => b.label),
  ];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`|${header.map(() => "---").join("|")}|`);

  const rows = STAT_KEYS.map((key) => statViability(players, key, now));
  for (const row of rows) {
    const cells = [
      STATS[row.stat].label,
      String(row.eligible),
      String(row.distinctValues),
      String(row.tiedPairs),
      ...REPORT_BANDS.map((b) => String(row.pairsByBand[b.label] ?? 0)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");

  // Anything that cannot be dealt somewhere is the headline finding.
  const dead: string[] = [];
  for (const row of rows) {
    for (const b of REPORT_BANDS) {
      if ((row.pairsByBand[b.label] ?? 0) === 0) {
        dead.push(
          `- **${STATS[row.stat].label}** has no valid pair at the ${b.label} band (${b.rounds}).`,
        );
      }
    }
    if (row.eligible < 2) {
      dead.push(
        `- **${STATS[row.stat].label}** has fewer than two eligible players — it can never fire.`,
      );
    }
  }
  lines.push("## Problems");
  lines.push("");
  lines.push(dead.length > 0 ? dead.join("\n") : "None. Every stat can be dealt at every band.");
  lines.push("");

  const iconicCount = players.filter((p) => p.iconic === true).length;
  const windows = (Object.entries(ICONIC_ROUNDS) as Array<[Mode, number]>)
    .map(([mode, n]) => `${mode} 1–${n}`)
    .join(", ");
  lines.push("## Iconic preference");
  lines.push("");
  lines.push(
    `${iconicCount} of ${players.length} players are iconic. Early rounds prefer an iconic ` +
      `challenger (${windows}). An anchor with no iconic challenger in the opening band always ` +
      `falls back to the whole deck; \`simulation.md\` reports how often that happens in play.`,
  );
  lines.push("");
  const opening = bandForRound(1, "endless");
  const beyond = (Object.entries(ICONIC_ROUNDS) as Array<[Mode, number]>).filter(
    ([mode, n]) => JSON.stringify(bandForRound(n, mode)) !== JSON.stringify(opening),
  );
  for (const [mode] of beyond) {
    lines.push(
      `> ${mode}'s window runs past the opening band; its later rounds are not covered here.`,
    );
    lines.push("");
  }
  lines.push("| Stat | Iconic eligible | Anchors with an iconic challenger |");
  lines.push("|---|---|---|");
  for (const key of STAT_KEYS) {
    const v = iconicViability(players, key, now);
    const share = v.anchors === 0 ? 0 : v.anchorsWithIconic / v.anchors;
    lines.push(
      `| ${STATS[key].label} | ${v.iconicEligible} | ` +
        `${v.anchorsWithIconic} of ${v.anchors} (${(share * 100).toFixed(0)}%) |`,
    );
  }
  lines.push("");
  lines.push("Rare stats never open a run, but the wheel can switch to them at round 3, well");
  lines.push("inside every mode's window, so they are listed too.");
  lines.push("");

  lines.push("## Stat correlation");
  lines.push("");
  lines.push("Spearman rank correlation. A high value means the two stats order players the");
  lines.push("same way, so switching between them asks the same question twice — which is what");
  lines.push("the correlated-pair exclusion in `wheel.ts` exists to prevent.");
  lines.push("");
  lines.push("| Pair | ρ | |");
  lines.push("|---|---|---|");

  const seen = new Set<string>();
  const correlations: Array<[StatKey, StatKey, number]> = [];
  for (const a of STAT_KEYS) {
    for (const b of STAT_KEYS) {
      if (a === b) continue;
      const pairKey = [a, b].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const r = rankCorrelation(players, a, b, now);
      if (r !== undefined) correlations.push([a, b, r]);
    }
  }
  correlations.sort((x, y) => Math.abs(y[2]) - Math.abs(x[2]));
  for (const [a, b, r] of correlations.slice(0, 12)) {
    const flag = Math.abs(r) >= CORRELATION_WARN ? "**exclude**" : "";
    lines.push(`| ${STATS[a].label} / ${STATS[b].label} | ${r.toFixed(2)} | ${flag} |`);
  }
  lines.push("");
  lines.push(
    `Pairs at or above ρ = ${CORRELATION_WARN} should be in \`CORRELATED_PAIRS\` in \`stats.ts\`.`,
  );
  lines.push("");

  return lines.join("\n");
}
