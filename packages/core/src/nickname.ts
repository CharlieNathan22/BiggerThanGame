/**
 * Nicknames for the Endless boards (DESIGN.md §13): the rules a name must
 * meet, the skeleton moderation reads, and the generated default.
 *
 * - **Rules** (`checkNickname`): 3–20 characters once cleaned (NFKC, trimmed,
 *   inner spaces collapsed); Latin-script letters (é, ü and ø are fine),
 *   digits, space, `_`, `-` and `.`; at least one letter or digit. Latin only
 *   because moderation can only read what its blocklist can: a name in another
 *   script gets the same calm "try another name" as a blocked one.
 * - **Skeleton** (`nicknameSkeleton`): what the blocklist is checked against,
 *   after zero-width and direction characters are stripped, NFKC, homoglyphs
 *   and leetspeak folded to ASCII letters and accents dropped. Repeated
 *   letters are kept as runs (`niiice` is `n i×3 c e`), so a check can match
 *   `fuuuck` without turning an innocent double letter into a single one. The
 *   whole name, and each word in it (split at spaces, `_ - .` and camel case),
 *   are both given.
 * - **Generator** (`generateNickname`): adjective + football noun + a 2–3 digit
 *   number, e.g. `SwiftVolley42`. Most players keep it, which keeps the
 *   moderation surface small. Randomness is passed in: never `Math.random`.
 *
 * The blocklist itself is not here. It is the Worker's (worker/src/moderation.ts)
 * and never ships to the browser.
 */

export const NICKNAME_LIMITS = { min: 3, max: 20 } as const;

export type NicknameProblem =
  /** Under 3 characters once cleaned, or no letter or digit at all. */
  | "short"
  /** Over 20. */
  | "long"
  /** A character that's none of the allowed ones: an emoji, a symbol. */
  | "characters"
  /** Letters from a script other than Latin: "try another name". */
  | "script";

export type NicknameCheck =
  | { readonly ok: true; readonly nickname: string }
  | { readonly ok: false; readonly problem: NicknameProblem };

/** Zero-width, direction and other invisible formatting characters. */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // Arabic letter mark
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer inherent vowels
  [0x180b, 0x180f], // Mongolian variation selectors and vowel separator
  [0x200b, 0x200f], // zero-width space, joiners, direction marks
  [0x202a, 0x202e], // direction embeddings and overrides
  [0x2060, 0x206f], // word joiner, invisible operators, direction isolates
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // zero-width no-break space
  [0xffa0, 0xffa0], // halfwidth Hangul filler
];

function isInvisible(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to);
}

/** The text without its invisible characters. */
function stripInvisible(text: string): string {
  return Array.from(text)
    .filter((c) => !isInvisible(c))
    .join("");
}

const LETTER = /^\p{L}$/u;
const LATIN = /^\p{Script=Latin}$/u;
const ALLOWED_MARK = /^[0-9 _.-]$/;

/** The name as it would be stored: NFKC, invisible characters gone, spaces trimmed and collapsed. */
export function cleanNickname(raw: string): string {
  return stripInvisible(raw.normalize("NFKC")).replace(/\s+/gu, " ").trim();
}

/** Whether `raw` makes a nickname, and the cleaned name if so. */
export function checkNickname(raw: string): NicknameCheck {
  const nickname = cleanNickname(raw);
  const chars = Array.from(nickname);
  let script = false;
  let other = false;
  let alphanumeric = false;
  for (const c of chars) {
    if (LETTER.test(c)) {
      if (LATIN.test(c)) alphanumeric = true;
      else script = true;
    } else if (ALLOWED_MARK.test(c)) {
      if (c >= "0" && c <= "9") alphanumeric = true;
    } else {
      other = true;
    }
  }
  if (chars.length > NICKNAME_LIMITS.max) return { ok: false, problem: "long" };
  if (script) return { ok: false, problem: "script" };
  if (other) return { ok: false, problem: "characters" };
  if (chars.length < NICKNAME_LIMITS.min || !alphanumeric) return { ok: false, problem: "short" };
  return { ok: true, nickname };
}

// ------------------------------------------------------------ skeleton

/** One letter and how many times it repeats in a row. */
export interface Run {
  readonly letter: string;
  readonly count: number;
}

export interface Skeleton {
  /** The whole name, words run together. */
  readonly whole: readonly Run[];
  /**
   * The same without the digits at either end of each word, which leetspeak
   * would otherwise fold into letters: `Admin42` is `admina` whole but `admin` bare.
   */
  readonly bare: readonly Run[];
  /** Each word on its own, and each again without its end digits where it has them. */
  readonly words: readonly (readonly Run[])[];
}

/**
 * Letters from other scripts, and Latin letters NFD can't take apart, that
 * pass for ASCII letters. Folded before accents are dropped.
 */
// prettier-ignore
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  // Cyrillic
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t",
  у: "y", х: "x", ѕ: "s", і: "i", ї: "i", ј: "j", ԁ: "d", ԛ: "q", ԝ: "w", ү: "y", һ: "h",
  ı: "i", ɡ: "g", ɩ: "i", ʀ: "r",
  // Greek
  α: "a", β: "b", γ: "y", δ: "d", ε: "e", ζ: "z", η: "n", ι: "i", κ: "k", μ: "u", ν: "v",
  ο: "o", ρ: "p", σ: "o", ς: "c", τ: "t", υ: "u", χ: "x", ω: "w",
  // Latin letters NFD leaves whole
  ł: "l", ø: "o", đ: "d", ħ: "h", ŧ: "t", ß: "ss", æ: "ae", œ: "oe", þ: "th", ð: "d", ŋ: "n",
};

/** Digits and symbols standing in for letters. */
// prettier-ignore
const LEET: Readonly<Record<string, string>> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "€": "e",
};

/** Splits a cleaned name into words: at spaces, `_ - .` and camel case. */
function splitWords(name: string): string[] {
  return name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[\s_.-]+/u)
    .filter((w) => w !== "");
}

/** A word's letters, folded to a–z, as runs. Anything that isn't a letter by then is dropped. */
function toRuns(word: string): Run[] {
  const letters: string[] = [];
  for (const raw of Array.from(word.toLowerCase())) {
    const c = HOMOGLYPHS[raw] ?? LEET[raw] ?? raw;
    for (const ch of Array.from(c.normalize("NFD"))) {
      if (ch >= "a" && ch <= "z") letters.push(ch);
    }
  }
  const runs: Run[] = [];
  for (const letter of letters) {
    const last = runs.at(-1);
    if (last !== undefined && last.letter === letter) {
      runs[runs.length - 1] = { letter, count: last.count + 1 };
    } else {
      runs.push({ letter, count: 1 });
    }
  }
  return runs;
}

/** Runs one after another, a run meeting its own letter merged: "ad" + "dy" is a d×2 y. */
function joinRuns(parts: readonly (readonly Run[])[]): Run[] {
  const joined: Run[] = [];
  for (const run of parts.flat()) {
    const last = joined.at(-1);
    if (last !== undefined && last.letter === run.letter) {
      joined[joined.length - 1] = { letter: run.letter, count: last.count + run.count };
    } else {
      joined.push(run);
    }
  }
  return joined;
}

function sameRuns(a: readonly Run[], b: readonly Run[]): boolean {
  return (
    a.length === b.length && a.every((r, i) => r.letter === b[i]?.letter && r.count === b[i]?.count)
  );
}

/** What moderation reads: the name's letters folded to a–z, whole and word by word. */
export function nicknameSkeleton(raw: string): Skeleton {
  const name = stripInvisible(raw).normalize("NFKC");
  const split = splitWords(name);
  const full = split.map(toRuns).filter((w) => w.length > 0);
  const stripped = split
    .map((w) => toRuns(w.replace(/^\d+|\d+$/g, "")))
    .filter((w) => w.length > 0);
  const words = [...full];
  for (const w of stripped) {
    if (!words.some((v) => sameRuns(v, w))) words.push(w);
  }
  // The whole name is its words run together, so "Ad Min" reads as "admin".
  return { whole: joinRuns(full), bare: joinRuns(stripped), words };
}

/** Runs as their letters, each once: `n i×3 c e` → `nice`. */
export function looseLetters(runs: readonly Run[]): string {
  return runs.map((r) => r.letter).join("");
}

/**
 * The name as moderation and uniqueness compare it: the whole skeleton, each
 * repeat once (`SwiftVolley42` → `swiftvoleya`). Stored beside the name.
 */
export function normaliseNickname(raw: string): string {
  return looseLetters(nicknameSkeleton(raw).whole);
}

// ------------------------------------------------------------ generator

// prettier-ignore
export const NICKNAME_ADJECTIVES: readonly string[] = [
  "Swift", "Bold", "Clever", "Golden", "Silver", "Mighty", "Quick", "Calm", "Brave", "Lucky",
  "Sharp", "Steady", "Nimble", "Rapid", "Deft", "Cool", "Smooth", "Classic", "Royal", "Iron",
  "Wild", "Bright", "Sly", "Keen", "Grand", "Noble", "Epic", "Sunny", "Stellar", "Solid",
  "Fierce", "Crafty", "Cheeky", "Hardy", "Lively", "Proud", "Silky", "Speedy", "True", "Loyal",
];

// prettier-ignore
export const NICKNAME_NOUNS: readonly string[] = [
  "Volley", "Header", "Striker", "Keeper", "Winger", "Libero", "Sweeper", "Playmaker", "Nutmeg",
  "Rabona", "Chip", "Panenka", "Tackle", "Cross", "Corner", "Dribble", "Flick", "Backheel",
  "Crossbar", "Goalpost", "Penalty", "Freekick", "Hattrick", "Midfield", "Captain", "Pitch",
  "Boot", "Whistle", "Terrace", "Derby", "Kickoff", "Offside", "Scissors", "Bicycle", "Stepover",
  "Trophy", "Anthem", "Dugout", "Touchline", "Wall",
];

/** Numbers the generator never uses: hate-group codes and the crude ones. */
export const NICKNAME_SKIPPED_NUMBERS: readonly number[] = [14, 18, 28, 69, 88, 187, 311, 420, 666];

/** The generator's numbers: 10 to 999, less the skipped ones. */
export const NICKNAME_NUMBERS: readonly number[] = Array.from(
  { length: 990 },
  (_, i) => i + 10,
).filter((n) => !NICKNAME_SKIPPED_NUMBERS.includes(n));

/**
 * A default nickname, e.g. `SwiftVolley42`. `random` returns a number in
 * [0, 1): the browser passes one backed by `crypto.getRandomValues`.
 */
export function generateNickname(random: () => number): string {
  const pick = <T>(list: readonly T[]): T => {
    const i = Math.min(list.length - 1, Math.floor(random() * list.length));
    const item = list[i];
    if (item === undefined) throw new Error("empty word list");
    return item;
  };
  return `${pick(NICKNAME_ADJECTIVES)}${pick(NICKNAME_NOUNS)}${pick(NICKNAME_NUMBERS)}`;
}
