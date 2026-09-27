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
  "brand.heading": "Bigger Than — Football Legends",
  "scores.streak": "Streak",
  "scores.best": "Best",

  // Site navigation in the title bar: inline on desktop, a menu on phones
  "nav.label": "Main",
  "nav.menu": "Menu",
  "nav.play": "Play",
  "nav.howToPlay": "How to play",
  "nav.about": "About",

  // Breadcrumb on the Legends pages: Football › Legends
  "breadcrumb.label": "Breadcrumb",
  "breadcrumb.separator": "›",
  "breadcrumb.football": "Football",
  "breadcrumb.legends": "Legends",

  // Footer
  "footer.nav": "Site",
  "footer.credits": "Credits",
  "footer.github": "GitHub",
  "footer.feedbackNav": "Feedback",
  "footer.suggest": "Suggest a legend",
  "footer.problem": "Report a problem",

  // Homepage (/). Drafts.
  "home.title": "Bigger Than Game — Higher or Lower With a Twist",
  "home.description":
    "Higher or lower where the stat keeps changing under you. Start with football: two legends, one stat, one hidden number. Free, no sign-up.",
  "home.tagline": "Higher or lower, where the question keeps changing.",
  "home.games": "Games",
  "home.legends.name": "Football Legends",
  "home.legends.body":
    "Two retired football legends, one stat. Is the hidden number higher or lower? Watch out — the stat keeps changing.",

  // The football page (/football-higher-or-lower): football higher or lower in
  // general, and a card per deck. Nothing Legends-specific. Drafts.
  "hub.title": "Football Higher or Lower — Bigger Than Game",
  "hub.description":
    "A free football higher or lower game where the stat keeps changing. Two footballers, one hidden number: higher or lower? No sign-up.",
  "hub.heading": "Football",
  "hub.headingEm": "higher or lower",
  "hub.intro":
    "Two footballers, one stat: is the hidden number higher or lower? Simple, until the stat changes under you. Pick a deck and see how long your run lasts.",
  "hub.decks": "Decks",
  "deck.legends.name": "Legends",
  "deck.legends.body":
    "The retired greats of the game, from caps and goals to trophies and transfer fees.",

  // The Legends deck (/football-higher-or-lower/legends): its intro and the
  // modes. Drafts.
  "legends.title": "Football Legends Higher or Lower — Bigger Than Game",
  "legends.description":
    "Higher or lower with retired football legends, where the stat keeps changing. Play Friendly now, with no clock; Endless and Daily Ranked are on the way.",
  "legends.heading": "Football legends",
  "legends.headingEm": "higher or lower",
  "legends.intro":
    "Two retired legends, one stat. Guess whether the hidden number is higher or lower, and keep the run going. Read the plaque before you pick: every few rounds the stat changes.",
  "legends.modes": "Modes",
  "mode.friendly.name": "Friendly",
  "mode.friendly.body": "No clock — play at your own pace, with every player and every stat.",
  "mode.endless.name": "Endless",
  "mode.endless.body":
    "Unlimited runs against a 10-second clock, with a daily board for your best of the day.",
  "mode.ranked.name": "Daily Ranked",
  "mode.ranked.body": "One run a day, the same for everyone, on a global leaderboard.",
  "mode.soon": "Coming soon",

  // The Friendly game page (/football-higher-or-lower/legends/friendly). Drafts.
  "friendly.title": "Friendly Mode — Football Legends Higher or Lower | Bigger Than Game",
  "friendly.description":
    "Two football legends, one stat, no clock. Guess whether the hidden number is higher or lower — and watch the plaque, because the stat keeps changing. Free, no sign-up.",

  // Start panel
  "start.intro":
    "Two legends, one stat. Guess whether the hidden number is higher or lower. The stat changes as you go — watch the plaque before you pick.",
  "start.cta": "Start the run",
  "start.starting": "Dealing…",
  "start.failed": "Couldn't reach the server. Check your connection and try again.",
  "start.noscript": "Bigger Than needs JavaScript to deal the cards.",
  "start.slowDown": "Lots of runs have started from your connection. Starting in a moment…",

  // Connection trouble mid-run: the reveal waits, the run carries on
  "hitch.reconnecting": "Connection lost. Trying again…",
  "hitch.slowDown": "Slow down a moment — carrying on shortly.",

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
  "live.statChanged":
    "The stat changes to {stat}. {anchor}: {value}. Is {challenger} higher or lower?",
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
  "over.suggest": "Suggest a legend",
  "over.share": "Share result",
  "over.shareImage": "Share image",
  "over.saveImage": "Save image",
  "over.copied": "Copied — paste it anywhere.",
  "over.copyFailed": "Couldn't copy. Select the text below and copy it.",
  "over.shareText": "Your result, to copy",
  "over.imageSaved": "Image saved.",
  "over.imageFailed": "Couldn't make the image. Try sharing the result instead.",

  // Feedback forms: "Suggest a legend", "Report an error" and "Report a problem"
  "feedback.suggest.title": "Suggest a legend",
  "feedback.suggest.intro": "Who should be in the deck? Retired players only.",
  "feedback.suggest.name": "Player's name",
  "feedback.suggest.note": "Anything we should know? (optional)",
  "feedback.report.title": "Report an error",
  "feedback.report.intro":
    "The card that ended your run. Tell us what looks wrong and we'll check it.",
  "feedback.report.card": "What you saw",
  "feedback.report.note": "What's wrong, and where did you find the right figure? (optional)",
  "feedback.report.figure": "{name}: {display}",
  "feedback.report.qualified": "{name}: {display} ({qualifier})",
  "feedback.problem.title": "Report a problem",
  "feedback.problem.intro": "A bug, a typo, something that doesn't look right? Tell us about it.",
  "feedback.problem.note": "What's wrong?",
  "feedback.problem.page": "Sent with the page you were on ({page}) and nothing else about you.",
  "feedback.privacy": "No email address or other details needed.",
  "feedback.nameRequired": "Add the player's name.",
  "feedback.noteRequired": "Tell us what's wrong.",
  "feedback.tooLong": "That's a little long. Trim it down and try again.",
  "feedback.checking": "Checking you're a person…",
  "feedback.checkFailed":
    "The check couldn't load. A content blocker may be stopping challenges.cloudflare.com.",
  "feedback.send": "Send",
  "feedback.sending": "Sending…",
  "feedback.sent": "Thanks — that's with us now.",
  "feedback.failed": "Couldn't send that just now. Give it a moment and try again.",
  "feedback.slowDown":
    "Lots of messages have come from your connection. Take a breather and try again in a minute.",
  "feedback.verifyFailed": "The check didn't go through. Please try again.",
  "feedback.cancel": "Cancel",
  "feedback.close": "Close",

  // Streak titles, by StreakTitleId (@bt/core STREAK_TITLES)
  "title.squad": "Squad player",
  "title.starter": "Starter",
  "title.captain": "Captain",
  "title.legend": "Legend",
  "title.goat": "GOAT",

  // Challenge links
  "challenge.heading": "Beat {score}",
  "challenge.intro":
    "A friend got {score} in a row on this run. Same players, same stats, same order. Can you beat it?",
  "challenge.cta": "Take the challenge",
  "challenge.invalid": "That challenge link didn't check out, so here's a fresh run instead.",
  "challenge.expired": "That challenge has expired — links last 10 days — so here's a fresh run.",
  "challenge.beat": "You beat {score}.",
  "challenge.matched": "You matched {score}. So close.",
  "challenge.short": "{score} to beat. Not this time.",

  // The run's grid, for screen readers
  "grid.label": "Your run: {basic} basic, {uncommon} uncommon and {rare} rare stats right.",
  "grid.miss": "Out on {stat}.",

  // What gets shared
  "share.heading": "Bigger Than — Football Legends",
  "share.score.one": "{score} correct, then out",
  "share.score.other": "{score} in a row",
  "share.endedOn": "Ended on: {stat}",
  "share.endedLabel": "Ended on",
  "share.exhausted": "Went the distance: every pairing dealt",
  "share.challenge": "Can you beat {score}? {url}",
  "share.fileName": "bigger-than-{score}.png",

  // Stat labels, by StatKey
  "stat.club_goals": "Club goals",
  "stat.caps": "International caps",
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
