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
  "nav.leaderboards": "Leaderboards",
  "nav.howToPlay": "How to play",
  "nav.about": "About",

  // Breadcrumb on the Legends pages: Football › Legends
  "breadcrumb.label": "Breadcrumb",
  "breadcrumb.separator": "›",
  // The first step of the trail in structured data (lib/seo.ts); not shown
  "breadcrumb.home": "Home",
  "breadcrumb.football": "Football",
  "breadcrumb.legends": "Legends",

  // Footer
  "footer.nav": "Site",
  "footer.credits": "Credits",
  "footer.privacy": "Privacy",
  "footer.leaderboards": "Leaderboards",
  "footer.github": "GitHub",
  "footer.feedbackNav": "Feedback",
  "footer.suggest": "Suggest a legend",
  "footer.problem": "Report a problem",

  // Homepage (/). Drafts.
  "home.title": "Higher or Lower Games With a Twist | Bigger Than Game",
  "home.description":
    "A free higher or lower game where the question keeps changing. Start with football legends: two players, one stat, one hidden number. No sign-up needed.",
  "home.tagline": "Higher or lower, where the question keeps changing.",
  "home.intro":
    "Bigger Than is a free higher or lower game that plays in your browser. The first game is football: two retired legends, one stat and one hidden number. Guess higher or lower to keep your run going, and watch the plaque, because the stat changes as you play.",
  "home.games": "Games",
  "home.managers.name": "Football Managers",
  "home.managers.body": "Higher or lower with the greatest managers in the game's history.",
  "home.legends.name": "Football Legends",
  "home.legends.body":
    "Test your knowledge on football legends. Features the greatest retired footballers in history.",

  // The football page (/football-higher-or-lower): football higher or lower in
  // general, and a card per deck. Nothing Legends-specific. Drafts.
  "hub.title": "Football Higher or Lower Game, Free Online | Bigger Than Game",
  "hub.description":
    "Play football higher or lower free in your browser. Two footballers, one stat: is the hidden number higher or lower? The stat changes as you play. No sign-up.",
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
  "legends.title": "Football Legends Quiz: Higher or Lower | Bigger Than Game",
  "legends.description":
    "A football legends quiz played as higher or lower: retired greats, ten stats from caps to transfer fees, and a question that keeps changing. Free to play.",
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
    "Unlimited runs against a 10-second clock, with boards for the day, the week and the month.",
  "mode.endless.leaderboard": "See leaderboards",
  "mode.instagram.name": "Instagram Endless",
  "mode.instagram.body":
    "Every question is Instagram followers. Unlimited runs against a 10-second clock.",
  // The start panel's subtitle and the breadcrumb, under "Endless"
  "mode.instagram.subtitle": "Instagram",
  // On the Legends page's Instagram Endless card, from this device's best; {best} is filled in there
  "mode.yourBest": "Your best: {best}",
  "mode.ranked.name": "Daily Ranked",
  "mode.ranked.body": "One run a day, the same for everyone, on a global leaderboard.",
  "mode.soon": "Coming soon",
  // The Legends page's "Clear the squad" sections, a card per theme
  "themes.club": "Clubs",
  "themes.league": "Leagues",
  "themes.era": "Eras",
  "theme.players": "{players} legends",
  // A theme card's best, from this device: {best} and {of} are filled in there
  "theme.best": "Best {best}/{of}",
  "theme.cleared": "Cleared ✓",

  // A "Clear the squad" theme's game page. Drafts.
  "squad.title.club": "{name} Legends Higher or Lower | Bigger Than Game",
  "squad.title.league": "{name} Legends Higher or Lower | Bigger Than Game",
  "squad.title.era": "{name} Football Legends Higher or Lower | Bigger Than Game",
  // Within the search checks' 110 to 170 characters, from "Inter" to "Paris Saint-Germain"
  "squad.description.club":
    "Clear the {name} squad: {players} legends, one at a time. Higher or lower on goals, caps and trophies, with one life and a short clock. Free in your browser.",
  "squad.description.league":
    "Clear the {name} squad: {players} legends, one at a time. Higher or lower on goals, caps and trophies, with one life and a short clock. Free in your browser.",
  "squad.description.era":
    "Clear the {name} squad: {players} legends at their peak in the {name}. Higher or lower on goals, caps and trophies, one life and a short clock. Free in your browser.",
  // Its start panel, under the theme's name: the squad, then the rules in one line
  // No dashes anywhere in a squad's copy.
  "squad.count.club": "{players} {name} legends. Can you clear the whole squad and win?",
  "squad.count.league": "{players} {name} legends. Can you clear the whole squad and win?",
  "squad.count.era": "{players} legends of the {name}. Can you clear the whole squad and win?",
  "squad.rules":
    "One life, 15 seconds for the first question and 10 for the rest, and every player comes up once.",
  // Under the plaque, when the stat is club goals
  "squad.note.club": "Whole career, not just {name}",
  "squad.note.league": "Whole career, every league",
  "squad.note.era": "Whole career, not just the {name}",

  // The Endless game page (/football-higher-or-lower/legends/endless). Drafts.
  "endless.title": "Endless Football Legends Higher or Lower | Bigger Than Game",
  "endless.description":
    "How long a streak can you build? Endless higher or lower on football legends, ten seconds a question, and the stat keeps changing. Free in your browser, no sign-up.",

  // The Instagram Endless game page (/football-higher-or-lower/legends/endless/instagram). Drafts.
  "instagram.title": "Football Legends Instagram Higher or Lower | Bigger Than Game",
  "instagram.description":
    "Who has more Instagram followers? Endless higher or lower on football legends, every question a follower count, ten seconds each. Free in your browser, no sign-up.",

  // The Endless leaderboard page. Drafts.
  "leaderboard.title": "Endless Leaderboard: Football Legends | Bigger Than Game",
  "leaderboard.description":
    "Today's, this week's and this month's best Endless streaks on Football Legends higher or lower. Every run is different, and the longest streak wins.",
  "leaderboard.headingMode": "Endless",
  "leaderboard.headingBoard": "Leaderboard",
  "leaderboard.framing": "Every run is different. Longest streak wins.",
  "leaderboard.play": "Play Endless",
  "leaderboard.tabs": "Leaderboard period",
  "leaderboard.tab.day": "Today",
  "leaderboard.tab.week": "This week",
  "leaderboard.tab.month": "This month",
  "leaderboard.caption.day": "Today's best Endless streaks",
  "leaderboard.caption.week": "This week's best Endless streaks",
  "leaderboard.caption.month": "This month's best Endless streaks",
  "leaderboard.col.rank": "Rank",
  "leaderboard.col.name": "Name",
  "leaderboard.col.streak": "Streak",
  "leaderboard.retired": "Retired name",
  "leaderboard.you": "You",
  "leaderboard.pinnedPlace": "{rank} of {total}",
  "leaderboard.pinnedThen": "{rank} of {total} when published",
  "leaderboard.pinnedJump": "{place} · Go to page {page}",
  "leaderboard.range": "{from}–{to} of {total}",
  "leaderboard.page": "Page {page} of {pages}",
  "leaderboard.pages": "Leaderboard pages",
  "leaderboard.previous": "Previous",
  "leaderboard.next": "Next",
  "leaderboard.previousPage": "Previous page",
  "leaderboard.nextPage": "Next page",
  "leaderboard.pageNumber": "Page {page}",
  "leaderboard.total.one": "1 player",
  "leaderboard.total.other": "{total} players",
  "leaderboard.empty": "Nobody's on this board yet. Play a run and publish it to be first.",
  "leaderboard.loading": "Loading the board…",
  "leaderboard.failed": "Couldn't load the board. Check your connection and try again.",
  "leaderboard.retry": "Try again",
  "leaderboard.resets.day": "Resets in {time}",
  "leaderboard.resets.week": "Resets in {time}",
  "leaderboard.resets.month": "Resets in {time}",
  "leaderboard.winnerLine": "{name} got a {streak} streak {when}",
  "leaderboard.device": "On this device",
  "leaderboard.deviceIntro":
    "Your 10 best Endless runs on this device, published or not. Kept in this browser only.",
  "leaderboard.deviceEmpty": "No Endless runs on this device yet.",
  "leaderboard.col.date": "Date",
  "leaderboard.noscript": "The leaderboard needs JavaScript to load.",
  "time.days.one": "1 day",
  "time.days.other": "{n} days",
  "time.hours.one": "1 hour",
  "time.hours.other": "{n} hours",
  "time.minutes.one": "1 minute",
  "time.minutes.other": "{n} minutes",
  "time.join": "{a} {b}",

  // The Friendly game page (/football-higher-or-lower/legends/friendly). Drafts.
  "friendly.title": "Play Football Legends Higher or Lower | Bigger Than Game",
  "friendly.description":
    "Twenty higher or lower questions on football legends, with no timer. Watch the plaque, because the stat changes as you play. Free in your browser, no sign-up.",

  // Start panel
  "start.intro":
    "Football Legends features the greatest footballers of all time who no longer play professionally. Guess whether the hidden number is higher or lower. Watch the plaque, the stat changes as you play.",
  "start.introTarget":
    "Football Legends features the greatest footballers of all time who no longer play professionally. Guess whether the hidden number is higher or lower. Watch the plaque, the stat changes as you play. Get all {target} right to win.",
  "start.introEndless":
    "Football Legends features the greatest footballers of all time who no longer play professionally. Guess whether the hidden number is higher or lower, and keep the streak going as long as you can. Watch the plaque, the stat changes as you play.",
  "start.introInstagram":
    "Football Legends features the greatest footballers of all time who no longer play professionally. Every question is Instagram followers: is the hidden count higher or lower? Counts are snapshots, dated on each card.",
  // Endless's start panel, under the intro: the clock, and where to play without one
  "start.clock": "Endless has a 10-second clock.",
  "start.noClock": "Rather play without one?",
  "start.playFriendly": "Play Friendly",
  "start.leaderboard": "See the leaderboard",
  // Endless before it launches: the page exists, the Start button doesn't
  "start.checkFailed": "We couldn't check your connection. Press Start to try again.",
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
  // In place of "Incorrect" when the clock ran out
  "verdict.timeout": "Time's up",
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

  // The countdown on the plaque, in a timed mode
  "clock.label": "Time left",
  // Said once per question by screen readers, never a count every second
  "clock.warning": "{seconds} seconds left",

  // The streak title so far, under the title bar in Endless
  "chip.label": "Title",

  // Screen reader announcements
  "live.question": "{stat}. {anchor}: {value}. Is {challenger} higher or lower?",
  "live.statChanged":
    "The stat changes to {stat}. {anchor}: {value}. Is {challenger} higher or lower?",
  "live.correct": "{challenger}: {value}. Correct. Streak {streak}.",
  "live.correctOf": "{challenger}: {value}. Correct. {score} of {target}.",
  "live.won": "{challenger}: {value}. Correct — that's all {score}. You won!",
  "live.squadCleared": "{challenger}: {value}. Correct. You've cleared the {squad} squad!",
  "live.wrong": "{challenger}: {value}. Wrong. The run is over.",
  "live.timeout": "{challenger}: {value}. Out of time. The run is over.",
  "live.newHighScore": "New high score!",
  "live.matchedBest": "You matched your best.",

  // Game over
  "over.caption.one": "correct, then out",
  "over.caption.other": "in a row",
  "over.caption.won": "a perfect run",
  "over.caption.squad": "through the squad",
  "over.won": "You won",
  "over.squadCleared": "Squad cleared",
  "over.best": "Best {best}",
  "over.newHighScore": "New high score",
  "over.matchedBest": "Matched your best",
  "over.separator": "·",
  "over.exhausted": "You've been through every pairing this run could deal. That's the whole deck.",
  "over.network": "The connection dropped. Your streak of {streak} stands.",
  "over.networkSaved": "Connection lost — your streak of {streak} is saved.",
  "over.timeout": "Out of time.",
  "over.challenge": "Challenge a friend",
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
  // Endless: publishing the run to the leaderboard (a dialog), and where it landed
  "over.publish": "Publish to leaderboard",
  "over.publishedRank": "{rank} of {total} {when}",
  "over.leaderboard": "Leaderboard",
  "over.beatBest": "Your best {when} is {best} — beat it to move up the leaderboard",
  "publish.title": "Publish your run",
  "publish.intro":
    "Put your streak of {streak} on the Endless leaderboards for today, this week and this month.",
  "publish.nickname": "Nickname",
  "publish.shuffle": "Another name",
  "publish.showCountry": "Show my country flag",
  "publish.stored":
    "We store your nickname and your score, and nothing else about you. There's no account.",
  "publish.checking": "Checking you're a person…",
  "publish.send": "Publish",
  "publish.sending": "Publishing…",
  "publish.cancel": "Cancel",
  "publish.close": "Close",
  "publish.done": "Published.",
  "publish.kept": "Your best {when} is still {best}, so the leaderboard keeps that run.",
  "publish.rank": "{rank} of {total} {when}",
  "publish.see": "See the leaderboard",
  "publish.rejected": "That name isn't available — try another name.",
  "publish.tooShort": "Names are 3 to 20 characters, with at least one letter or number.",
  "publish.tooLong": "Names are 3 to 20 characters.",
  "publish.characters": "Use letters, numbers, spaces, and _ - or . only.",
  "publish.expired":
    "Runs can be published for 30 minutes after they end, and this one's past that.",
  "publish.already": "This run is already on the leaderboard.",
  "publish.slowDown":
    "Lots of runs are being published from your connection. Try again in a minute.",
  "publish.checkFailed": "The check didn't go through. Try again.",
  "publish.failed": "Couldn't reach the server. Check your connection and try again.",
  "publish.unpublishable": "This run can't go on the leaderboard.",
  "period.day.current": "today",
  "period.week.current": "this week",
  "period.month.current": "this month",
  "period.day.previous": "yesterday",
  "period.week.previous": "last week",
  "period.month.previous": "last month",

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
  "title.favourite": "Fan favourite",
  "title.clubLegend": "Club legend",
  "title.worldClass": "World class",
  "title.immortal": "Immortal",

  // Challenge links
  "challenge.heading": "Beat {score}",
  "challenge.intro":
    "A friend's streak was {score}. You get a run of your own: new players, new stats. Can you beat it?",
  "challenge.headingPerfect": "Match {score}",
  "challenge.introPerfect":
    "A friend won this run, {score}. Same players, same stats, same order. Can you match it?",
  "challenge.cta": "Take the challenge",
  "challenge.invalid": "That challenge link didn't check out, so here's a fresh run instead.",
  "challenge.expired": "That challenge has expired — links last 10 days — so here's a fresh run.",
  // A challenge link on the Friendly page, from before challenges moved to Endless
  "challenge.retired": "This challenge link has expired — play Friendly.",
  // What the "Challenge a friend" button shares: "Beat 12 — <link>"
  "challenge.share": "{heading} — {url}",
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
  "share.headingInstagram": "Bigger Than — Instagram Endless",
  // "Clear the squad"'s score line
  "share.squadCleared": "I cleared the {squad} squad 🏆",
  "share.squadProgress": "{score}/{target} through the {squad} squad",
  "share.score.one": "{score} correct, then out",
  "share.score.other": "{score} in a row",
  "share.endedOn": "Ended on: {stat}",
  "share.endedLabel": "Ended on",
  "share.timedOut": "Out of time on: {stat}",
  "share.timedOutLabel": "Out of time on",
  // Endless names the two players that ended the run, never their figures
  "share.endedPlayers": "{lead} — {anchor} v {challenger}",
  "share.exhausted": "Went the distance: every pairing dealt",
  "share.fileName": "bigger-than-{score}.png",

  // Stat labels, by StatKey
  "stat.club_goals": "Club goals",
  // "Clear the squad": the figure is the whole career, not goals for the squad's club
  "stat.squad.club_goals": "Total career club goals",
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
