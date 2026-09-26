/**
 * Every piece of text the game shows, in English.
 *
 * A flat keyed object with `{placeholder}` interpolation (`t()` in ./index.ts).
 * Components never hold user-facing string literals; they look text up here.
 * Another language is another file with the same keys — `Messages` makes the
 * compiler list any key it's missing. There is no language switching yet.
 *
 * Stat labels are keyed by `StatKey`. A test keeps them equal to `STATS` in
 * `@bt/core`, which is what the server sends in `stat.label`.
 */

export const en = {
  // Title bar
  "brand.bigger": "Bigger",
  "brand.than": "Than",
  "brand.game": "Game",
  "brand.football": "Football",
  "brand.legends": "Legends",
  "brand.footballLegends": "Football Legends",
  "scores.streak": "Streak",
  "scores.best": "Best",

  // Footer
  "footer.nav": "Site",
  "footer.about": "About",
  "footer.credits": "Credits",
  "footer.howToPlay": "How to play",

  // Start panel
  "start.intro":
    "Two legends, one stat. Guess whether the hidden number is higher or lower. The stat changes as you go — watch the plaque before you pick.",
  "start.cta": "Start the run",
  "start.starting": "Dealing…",
  "start.failed": "Couldn't reach the server. Check your connection and try again.",
  "start.noscript": "Bigger Than needs JavaScript to deal the cards.",

  // The pitch
  "pitch.label": "The two players",
  "card.unknown": "?",
  "pick.group": "Is {name}'s number higher or lower?",
  "pick.higher": "Higher",
  "pick.lower": "Lower",
  "qual.fee": "{year}",
  "qual.ig": "as of {date}",

  // Screen reader announcements
  "live.question": "{stat}. {anchor}: {value}. Is {challenger} higher or lower?",
  "live.correct": "{challenger}: {value}. Correct. Streak {streak}.",
  "live.wrong": "{challenger}: {value}. Wrong. The run is over.",

  // Game over
  "over.caption.one": "correct, then out",
  "over.caption.other": "in a row",
  "over.best": "Best {best}",
  "over.newBest": "New best",
  "over.separator": "·",
  "over.exhausted": "You've been through every pairing this run could deal. That's the whole deck.",
  "over.network": "The connection dropped. Your streak of {streak} stands.",
  "over.again": "Play again",
  "over.report": "Something wrong with that card?",
  "over.reportEmail": "Or email {email}",
  "over.reportSubject":
    "Correction: {anchor} v {challenger}, {stat} ({anchorValue} v {challengerValue})",

  // Stat labels, by StatKey
  "stat.club_goals": "Club goals",
  "stat.caps": "Caps",
  "stat.apps": "Club appearances",
  "stat.ig": "Instagram followers",
  "stat.fee": "Highest transfer fee",
  "stat.igoals": "International goals",
  "stat.ct": "Club trophies",
  "stat.it": "International trophies",
  "stat.clubs": "Clubs played for",
  "stat.age": "Age",
} as const;

export type MessageKey = keyof typeof en;
