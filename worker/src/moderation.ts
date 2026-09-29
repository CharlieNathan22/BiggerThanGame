/**
 * Nickname moderation (DESIGN.md §13): the blocklist check behind
 * `POST /api/run/submit`.
 *
 * The name is read as its skeleton (`nicknameSkeleton`, @bt/core): invisible
 * characters stripped, NFKC, homoglyphs and leetspeak folded to a–z, repeated
 * letters kept as runs. A raw blocklist is defeated by leetspeak within a day.
 * Then two tiers:
 *
 * - **anywhere** terms — long, unambiguous ones — are matched inside the name,
 *   so `xXslurXx` is caught;
 * - **word** terms — short ones, and impersonation such as `admin` — only as a
 *   whole word or the whole name, so Scunthorpe, Dickson and badminton pass.
 *
 * A term matches a stretch of the name when its letters are the same, each
 * repeated **at least** as often as in the term: `fuuuck` matches `fuck`, and
 * a term spelt with a double letter needs one, so the word for a country
 * doesn't match the slur that differs from it by a letter. A few innocent
 * words that contain an anywhere term (place names, mostly) are allowed
 * through by `ALLOWED_WORDS`.
 *
 * **The list isn't in the repo as text.** The repo is public, so
 * `blocklist-data.ts` holds each term only as a salted hash of its letters,
 * with its tier, length and the repeats it needs. Anyone can test a guess
 * against it; nobody can read it. The plain list is `worker/blocklist.local.txt`
 * (gitignored), and `pnpm blocklist:build` regenerates the data from it.
 */

import { looseLetters, nicknameSkeleton } from "@bt/core";
import type { Run, Skeleton } from "@bt/core";
import { BLOCKLIST } from "./blocklist-data.js";

export type TermTier = "any" | "word";

/** One blocked term, as `blocklist-data.ts` holds it. */
export interface BlockedTerm {
  readonly tier: TermTier;
  /** `termHash` of the term's letters, each repeat once. */
  readonly hash: string;
  /** How many letters that is. */
  readonly length: number;
  /** Each letter's minimum repeat, where any is over one. */
  readonly runs?: readonly number[];
}

/** Mixed into every hash, so the data isn't a lookup table for plain FNV. */
const SALT = "bt:names:1";

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * A term's letters as 52 bits in base 36: two 32-bit FNV-1a passes, salted
 * differently, the second cut to 20 bits. Synchronous and fast; a collision
 * would only ever refuse a name.
 */
export function termHash(letters: string): string {
  const a = fnv1a(`${SALT}|${letters}`, 0x811c9dc5);
  const b = fnv1a(`${letters}|${SALT}`, 0x2f5a3c1d);
  return (a * 2 ** 20 + (b & 0xfffff)).toString(36);
}

/**
 * Innocent words holding an anywhere term, read as skeleton letters. A match
 * wholly inside one of these doesn't count.
 */
export const ALLOWED_WORDS: readonly string[] = [
  "scunthorpe",
  "penistone",
  "wankdorf",
  "swank",
  "therapist",
  "slutsky",
  "snigger",
  "retardant",
];

/** Hash → each term's minimum repeats (undefined: none needed). */
type ByHash = Map<string, (readonly number[] | undefined)[]>;

interface Index {
  /** Anywhere terms by length. */
  readonly any: Map<number, ByHash>;
  /** Word terms by length. */
  readonly word: Map<number, ByHash>;
  /** The first half of every anywhere term's hash, to rule out most stretches cheaply. */
  readonly anyFirst: Set<number>;
  readonly longest: number;
}

function buildIndex(terms: readonly BlockedTerm[]): Index {
  const index: Index = { any: new Map(), word: new Map(), anyFirst: new Set(), longest: 0 };
  let longest = 0;
  for (const term of terms) {
    const byLength = index[term.tier];
    let byHash = byLength.get(term.length);
    if (byHash === undefined) byLength.set(term.length, (byHash = new Map()));
    const list = byHash.get(term.hash) ?? [];
    list.push(term.runs);
    byHash.set(term.hash, list);
    if (term.tier === "any") {
      index.anyFirst.add(Math.floor(Number.parseInt(term.hash, 36) / 2 ** 20));
      longest = Math.max(longest, term.length);
    }
  }
  return { ...index, longest };
}

/** Whether `runs` repeat each letter at least as often as the term needs. */
function repeatsMeet(runs: readonly Run[], needed: readonly number[] | undefined): boolean {
  if (needed === undefined) return true;
  return needed.every((n, i) => (runs[i]?.count ?? 0) >= n);
}

function matches(byHash: ByHash | undefined, runs: readonly Run[]): boolean {
  if (byHash === undefined) return false;
  const found = byHash.get(termHash(looseLetters(runs)));
  return found?.some((needed) => repeatsMeet(runs, needed)) ?? false;
}

/** `ALLOWED_WORDS` as skeleton letters, each repeat once, as names are compared. */
const ALLOWED_LETTERS = ALLOWED_WORDS.map((w) => looseLetters(nicknameSkeleton(w).whole));

/** Positions of `letters` inside allowed words, which a match may not lie wholly within. */
function allowedSpans(letters: string): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  for (const word of ALLOWED_LETTERS) {
    for (let at = letters.indexOf(word); at !== -1; at = letters.indexOf(word, at + 1)) {
      spans.push([at, at + word.length]);
    }
  }
  return spans;
}

/** `termHash`'s first pass, as it stands after the salt: each stretch carries on from here. */
const FIRST_START = fnv1a(`${SALT}|`, 0x811c9dc5);

/**
 * Every stretch of the name against the anywhere terms. The first half of the
 * hash is rolled forward a letter at a time from each start, so a stretch no
 * term could be costs one multiply; only a hit is hashed in full.
 */
function containsAnywhereTerm(index: Index, runs: readonly Run[]): boolean {
  const letters = looseLetters(runs);
  let allowed: readonly (readonly [number, number])[] | undefined;
  for (let start = 0; start < letters.length; start += 1) {
    let h = FIRST_START;
    const last = Math.min(letters.length, start + index.longest);
    for (let end = start + 1; end <= last; end += 1) {
      h = Math.imul(h ^ letters.charCodeAt(end - 1), 16777619) >>> 0;
      if (!index.anyFirst.has(h)) continue;
      const stretch = runs.slice(start, end);
      if (!matches(index.any.get(end - start), stretch)) continue;
      allowed ??= allowedSpans(letters);
      if (allowed.some(([from, to]) => start >= from && end <= to)) continue;
      return true;
    }
  }
  return false;
}

export interface Moderator {
  /** True when the nickname passes. */
  (nickname: string): boolean;
  /** The same, for a skeleton already worked out (`nicknameSkeleton`). */
  readonly skeleton: (skeleton: Skeleton) => boolean;
}

/** A moderator over a term list; `moderate` is over the shipped one. */
export function createModerator(terms: readonly BlockedTerm[]): Moderator {
  const index = buildIndex(terms);
  const bySkeleton = (skeleton: Skeleton): boolean => {
    for (const runs of [skeleton.whole, skeleton.bare]) {
      if (containsAnywhereTerm(index, runs)) return false;
    }
    for (const runs of [skeleton.whole, skeleton.bare, ...skeleton.words]) {
      if (matches(index.word.get(runs.length), runs)) return false;
    }
    return true;
  };
  return Object.assign((nickname: string) => bySkeleton(nicknameSkeleton(nickname)), {
    skeleton: bySkeleton,
  });
}

/** True when the nickname passes the blocklist. */
export const moderate: Moderator = createModerator(BLOCKLIST);

/**
 * A term as `blocklist-data.ts` holds it, from its plain spelling. Used by
 * `pnpm blocklist:build` and the tests; never at request time.
 */
export function blockedTerm(tier: TermTier, term: string): BlockedTerm {
  const runs = nicknameSkeleton(term).whole;
  if (runs.length === 0) throw new Error(`blocklist term has no letters: ${term}`);
  const needed = runs.map((r) => r.count);
  return {
    tier,
    hash: termHash(looseLetters(runs)),
    length: runs.length,
    ...(needed.some((n) => n > 1) ? { runs: needed } : {}),
  };
}
