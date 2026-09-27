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
  // A mode with a win target (Friendly's twenty) shows the score out of it
  "scores.score": "Score",
  "scores.of": "{score} / {target}",
  "score.of": "{score}/{target}",

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
  "home.managers.name": "Football Managers",
  "home.managers.body": "Higher or lower with the greatest managers in the game's history.",
  "home.legends.name": "Football Legends",
  "home.legends.body":
    "Test your knowledge on football legends. Features the greatest retired footballers in history.",

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
  "legends.heading": "Football Legends",
  // The heading's second line: "Higher" and "Lower" in gold, "or" in white
  "legends.headingHigher": "Higher",
  "legends.headingOr": "or",
  "legends.headingLower": "Lower",
  "legends.intro":
    "Higher or lower game for football legends. Guess if the number is higher or lower to keep the run going. The question will change throughout the game, so make sure to read the plaque.",
  "legends.modes": "Modes",
  "mode.friendly.name": "Friendly",
  // A "\n" is a line break on the card
  "mode.friendly.body": "Twenty questions, no timer.\nGet them all right to win.",
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
    "Football Legends features the greatest footballers of all time who no longer play professionally. Guess whether the hidden number is higher or lower. Watch the plaque, the stat changes as you play.",
  "start.introTarget":
    "Football Legends features the greatest footballers of all time who no longer play professionally. Guess whether the hidden number is higher or lower. Watch the plaque, the stat changes as you play. Get all {target} right to win.",
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
  // On the challenger's half when the verdict lands; the live region says it too
  "verdict.correct": "Correct",
  "verdict.incorrect": "Incorrect",
  "qual.fee": "{year}",
  "qual.ig": "as of {date}",

  // The progress track, in a mode with a win target
  "progress.label": "Progress",
  "progress.question": "Question {round} of {target}",
  "progress.final": "Final question — question {round} of {target}",
  // On the plaque while round one's cards slide in, before the wheel spins
  "plaque.question": "Question {round}",
  "plaque.questionOf": "Question {round} of {target}",
  // On the plaque and under the track while the last question is on screen
  "final.tag": "Final question",

  // Screen reader announcements
  "live.question": "{stat}. {anchor}: {value}. Is {challenger} higher or lower?",
  "live.statChanged":
    "The stat changes to {stat}. {anchor}: {value}. Is {challenger} higher or lower?",
  "live.correct": "{challenger}: {value}. Correct. Streak {streak}.",
  "live.correctOf": "{challenger}: {value}. Correct. {score} of {target}.",
  "live.won": "{challenger}: {value}. Correct — that's all {score}. You won!",
  "live.wrong": "{challenger}: {value}. Wrong. The run is over.",
  "live.newHighScore": "New high score!",
  "live.matchedBest": "You matched your best.",

  // Game over
  "over.caption.one": "correct, then out",
  "over.caption.other": "in a row",
  "over.caption.won": "a perfect run",
  "over.won": "You won",
  "over.best": "Best {best}",
  "over.newHighScore": "New high score",
  "over.matchedBest": "Matched your best",
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

  // The score badge after a right answer; at a milestone, with its title
  "badge.milestone": "{score} · {title}",

  // Streak titles, by StreakTitleId (@bt/core STREAK_TITLES, one table per mode)
  "title.squad": "Squad player",
  "title.starter": "Starter",
  "title.captain": "Captain",
  "title.legend": "Legend",
  "title.goat": "GOAT",

  // Challenge links
  "challenge.heading": "Beat {score}",
  "challenge.intro":
    "A friend scored {score} on this run. Same players, same stats, same order. Can you beat it?",
  "challenge.headingPerfect": "Match {score}",
  "challenge.introPerfect":
    "A friend won this run, {score}. Same players, same stats, same order. Can you match it?",
  "challenge.cta": "Take the challenge",
  "challenge.invalid": "That challenge link didn't check out, so here's a fresh run instead.",
  "challenge.expired": "That challenge has expired — links last 10 days — so here's a fresh run.",
  "challenge.beat": "You beat {score}.",
  "challenge.matched": "You matched {score}. So close.",
  "challenge.short": "{score} to beat. Not this time.",
  "challenge.matchedPerfect": "You matched {score}. Perfect.",
  "challenge.shortPerfect": "{score} to match. Not this time.",

  // The run's grid, for screen readers
  "grid.label": "Your run: {basic} basic, {uncommon} uncommon and {rare} rare stats right.",
  "grid.miss": "Out on {stat}.",
  "grid.of": "{score} of {target} right.",

  // What gets shared
  "share.heading": "Bigger Than — Football Legends",
  "share.score.one": "{score} correct, then out",
  "share.score.other": "{score} in a row",
  "share.endedOn": "Ended on: {stat}",
  "share.endedLabel": "Ended on",
  "share.exhausted": "Went the distance: every pairing dealt",
  "share.challenge": "Can you beat {score}? {url}",
  "share.challengePerfect": "Can you match {score}? {url}",
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
