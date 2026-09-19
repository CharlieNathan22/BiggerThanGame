/**
 * viability.md — can the engine actually do what the ramp asks of it?
 *
 * This is the report that answers questions the design document can only pose.
 * Whether the 30–80% band is reachable at all; which stats die to tie
 * exclusion; whether two stats are so correlated that switching between them is
 * pointless. Read it after every deck change.
 */

import { STATS, STAT_KEYS, bandForRound, gap, isEligible, withinBand } from "@bt/core";
import type { Band, Player, StatKey } from "@bt/core";

/** The distinct bands the ramp uses, with a label for the report. */
export const REPORT_BANDS: ReadonlyArray<{ label: string; rounds: string; band: Band }> = [
  { label: "opening", rounds: "1–10", band: bandForRound(1) },
  { label: "early", rounds: "11–18", band: bandForRound(11) },
  { label: "middle", rounds: "19–26", band: bandForRound(19) },
  { label: "late", rounds: "27–34", band: bandForRound(27) },
  { label: "hard", rounds: "35–42", band: bandForRound(35) },
  { label: "knife edge", rounds: "43+", band: bandForRound(43) },
];

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
      const g = gap(a, b);
      for (const band of REPORT_BANDS) {
        // Band-exempt stats ignore the band entirely; every non-tied pair counts.
        const ok = STATS[key].bandExempt === true ? true : withinBand(g, band.band);
        if (ok) pairsByBand[band.label] = (pairsByBand[band.label] ?? 0) + 1;
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

/** Above this, a pair is correlated enough that switching between them is flat. */
export const CORRELATION_WARN = 0.8;

export function viabilityReport(players: readonly Player[], now: Date): string {
  const lines: string[] = [];
  lines.push("# Deck viability");
  lines.push("");
  lines.push(`Generated ${now.toISOString().slice(0, 10)} from ${players.length} players.`);
  lines.push("");
  lines.push("Counts are **unordered pairs that clear the band**, before the recently-seen");
  lines.push("queue takes its cut. A stat showing 0 at a band cannot be dealt there and will");
  lines.push("force relaxation every time the wheel picks it.");
  lines.push("");

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
    const exempt = STATS[row.stat].bandExempt === true ? " *" : "";
    const cells = [
      `${STATS[row.stat].label}${exempt}`,
      String(row.eligible),
      String(row.distinctValues),
      String(row.tiedPairs),
      ...REPORT_BANDS.map((b) => String(row.pairsByBand[b.label] ?? 0)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push(
    "`*` band-exempt — matched on tie exclusion alone, so every band shows the same count.",
  );
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
