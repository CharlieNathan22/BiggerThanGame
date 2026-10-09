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
  "nav.multiplayer": "Multiplayer",

  // Breadcrumb on the Legends pages: Football › Legends
  "breadcrumb.label": "Breadcrumb",
  "breadcrumb.separator": "›",
  // The first step of the trail in structured data (lib/seo.ts); not shown
  "breadcrumb.home": "Home",
  "breadcrumb.football": "Football",
  "breadcrumb.legends": "Legends",
  "breadcrumb.multiplayer": "Multiplayer",
  "breadcrumb.twitch": "Twitch Mode",

  // Footer
  "footer.nav": "Site",
  "footer.credits": "Credits",
  "footer.privacy": "Privacy",
  "footer.leaderboards": "Leaderboards",
  "footer.github": "GitHub",
  "footer.twitch": "Twitch Mode",
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
  "mode.ranked.body":
    "Twenty questions a day, the same for everyone, on a global leaderboard. One go.",
  // The Daily Ranked card: Play, or this device's result today ("15/20 · 312th of 2,400")
  "mode.ranked.play": "Play today's game",
  "mode.ranked.result": "{score} · {rank}",
  // The Daily card once today's game is played, in the button's place: status text, not a button
  "daily.cardDone": "Today's game completed — come back tomorrow",
  "mode.soon": "Coming soon",
  // The Legends page's "Clear the squad" sections, a card per theme
  "themes.club": "Clubs",
  "themes.league": "Leagues",
  "themes.era": "Eras",
  "theme.players": "{players} legends",
  // The Classic Era says what it spans
  "theme.players.era-classic-era": "{players} legends, 1980s and older",
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
  "squad.description.era-classic-era":
    "Clear the Classic Era squad: {players} legends who peaked in the 1980s or before. Higher or lower on goals, caps and trophies, one life and a short clock. Free in your browser.",
  "squad.description.era":
    "Clear the {name} squad: {players} legends at their peak in the {name}. Higher or lower on goals, caps and trophies, one life and a short clock. Free in your browser.",
  // Its start panel, under the theme's name: the squad, then the rules in one line
  // No dashes anywhere in a squad's copy.
  "squad.count.club": "{players} {name} legends. Can you clear the whole squad and win?",
  "squad.count.league": "{players} {name} legends. Can you clear the whole squad and win?",
  "squad.count.era": "{players} legends of the {name}. Can you clear the whole squad and win?",
  "squad.count.era-classic-era":
    "{players} legends of the Classic Era, the 1980s and older. Can you clear the whole squad and win?",
  "squad.rules":
    "One life, 15 seconds for the first question and 10 for the rest, and every player comes up once.",
  // Under the plaque, when the stat counts the whole career: club goals, club
  // appearances, club trophies and the highest transfer fee
  "squad.note.club": "Whole career, not just {name}",
  "squad.note.league": "Whole career, every league",
  "squad.note.era": "Whole career, not just the {name}",

  // The Daily Ranked game page (/football-higher-or-lower/legends/daily). Drafts.
  "daily.title": "Daily Football Legends Quiz — Bigger Than",
  "daily.description":
    "Twenty football legends questions a day, the same for everyone. Higher or lower against a 10-second clock, one go, and a daily leaderboard. Free to play.",
  "daily.subtitle": "Daily Ranked",
  "daily.game": "Game {game}",
  "daily.nextGame": "Next game in {time}",
  "daily.firstGame": "Game 1 starts in {time}",
  "daily.intro":
    "Twenty questions on football legends, the same for everyone today. A wrong answer doesn't end the run. Get all twenty right and keep going in sudden-death bonus rounds.",
  "daily.clock": "15 seconds for the first question, 10 for the rest. One go a day.",
  "daily.nameLabel": "Your name",
  "daily.leaderboardLine": "Your name and score will appear on today's leaderboard.",
  "daily.play": "Play",
  "daily.nameTaken": "That name is taken today — try another",
  "daily.played": "You've already played today's game on this device.",
  "daily.notStarted": "Game 1 hasn't started yet.",
  "daily.loading": "Checking today's game…",
  "daily.lookupFailed": "Couldn't reach the server. Check your connection and try again.",
  "daily.retry": "Try again",
  "daily.resumeHeading": "Your run is still going",
  "daily.resumeBody": "Pick up where you left off. The clock kept running while you were away.",
  "daily.resume": "Carry on",
  "daily.resuming": "Picking up…",
  "daily.resumeFailed": "Couldn't pick up your run. Check your connection and try again.",
  "daily.playedHeading": "Today's result",
  "daily.rank": "{rank} of {total}",
  "daily.unranked": "Your score will be on the leaderboard in a moment.",
  // Under a perfect run's score ("25"): "20/20 +5 bonus"
  "daily.bonusLine": "{target}/{target} +{bonus} bonus",
  // The title bar during the bonus rounds: "20/20 +3"
  "daily.titleBonus": "{target}/{target} +{bonus}",
  // The title bar's bonus, beside "20 / 20" and smaller: "+3", read as "+3 bonus"
  "daily.titleBonusPart": "+{bonus}",
  "daily.titleBonusSpoken": "bonus",
  // The chip at the top of the pitch during the bonus rounds
  "daily.bonusChip": "+{bonus} bonus",
  "daily.bonusLabel": "Bonus rounds",
  "daily.caption": "right out of {target}",
  "daily.captionPerfect": "a perfect twenty, then the bonus",
  // A perfect run's score on the board, for screen readers
  "daily.perfectSpoken": "{score}: twenty out of twenty and {bonus} bonus",
  "daily.leaderboard": "See today's leaderboard",
  // The share: spoiler-free, no player and no figure
  "daily.shareHeading": "Bigger Than #{game} — {score}/{target} 🔥",
  "daily.shareBonus": "⭐ +{bonus} bonus",
  "daily.shareImageHeading": "Bigger Than #{game}",
  "daily.fileName": "bigger-than-daily-{game}.png",
  "daily.gridLabel": "Your game: {right} of {target} right.",
  "daily.gridBonus": "Your game: all {target} right, then {bonus} bonus rounds.",

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
  // The two boards' switch, on both leaderboard pages
  "board.switch": "Leaderboards",
  "board.switch.daily": "Daily Ranked",
  "board.switch.endless": "Endless",

  // The Daily Ranked leaderboard page. Drafts.
  "dailyBoard.title": "Daily Leaderboard: Football Legends Quiz | Bigger Than Game",
  "dailyBoard.description":
    "Today's Daily Ranked scores on Football Legends higher or lower: the same twenty questions for everyone, one go each, ties broken by thinking time.",
  "dailyBoard.headingMode": "Daily Ranked",
  "dailyBoard.framing": "Everyone plays the same questions. Most right answers wins.",
  "dailyBoard.play": "Play today's game",
  "dailyBoard.caption": "Today's Daily Ranked scores",
  "dailyBoard.col.score": "Score",
  "dailyBoard.winnerLine": "{name} got {score} in {game}",
  "dailyBoard.empty": "Nobody has finished today's game yet. Play it to be first.",
  "dailyBoard.notStarted": "Game 1 starts in {time}.",
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
  // The landmark round the progress track
  "progress.region": "Your run",
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
  // Daily Ranked, where a wrong answer or a timeout doesn't end the run
  "live.wrongOn": "{challenger}: {value}. Wrong. On to the next question.",
  "live.timeoutOn": "{challenger}: {value}. Out of time. On to the next question.",
  "live.dailyDone": "{challenger}: {value}. That's the game: {score}.",
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
  "over.otherModes": "Try other modes",
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

  // The Multiplayer hub (/football-higher-or-lower/legends/multiplayer)
  "multiplayer.title": "Football Legends Multiplayer Quiz | Bigger Than Game",
  "multiplayer.description":
    "Football legends higher or lower, played with other people. Twitch Mode puts a streamer against their own chat, and 1v1 and Last Man Standing are coming soon.",
  "multiplayer.heading": "Multiplayer",
  "multiplayer.intro": "Football legends higher or lower, played against other people.",
  "multiplayer.modes": "Multiplayer modes",
  "multiplayer.twitch.name": "Twitch Mode",
  "multiplayer.twitch.body": "Chat vs You.\nPlay a match against your own Twitch chat.",
  "multiplayer.1v1.name": "1v1",
  "multiplayer.1v1.body": "Play a friend head to head.",
  "multiplayer.lastManStanding.name": "Last Man Standing",
  "multiplayer.lastManStanding.body": "Up to 10 players, one mistake and you're out.",
  "multiplayer.reading.heading": "How Twitch Mode works",
  "multiplayer.reading.body":
    "Connect your Twitch channel and pick the questions: all the legends, Instagram followers, or one club, league or era. Each question, your chat votes in the chat box while you lock in your own answer. When the time is up, both answers are revealed and scored. The side with more right after ten or twenty questions wins.",
  // The Legends page's Multiplayer section
  "legends.multiplayer.heading": "Multiplayer",
  "legends.multiplayer.name": "Twitch Mode and more",
  "legends.multiplayer.body":
    "Twitch Mode is live: Streamer vs Chat.\nMore ways to play together are coming soon.",

  // Twitch Mode (/football-higher-or-lower/legends/multiplayer/twitch)
  "twitch.title": "Twitch Football Quiz: Chat vs You | Bigger Than Game",
  "twitch.description":
    "A football quiz for Twitch streamers: play legends higher or lower against your own chat, who vote with !h and !l. Free, with no login or download.",
  "stream.subtitle": "Twitch Mode",
  "stream.tagline": "Chat vs You",
  "stream.setup.label": "Set up your match",
  "stream.step.channel": "Your channel",
  "stream.step.questions": "Pick the questions",
  "stream.step.settings": "Settings",
  "stream.channel.label": "Enter your Twitch channel",
  "stream.channel.placeholder": "Channel name or twitch.tv link",
  "stream.channel.connect": "Connect",
  "stream.channel.empty": "Enter your channel's name.",
  "stream.channel.invalid":
    "That isn't a Twitch channel name: 3 to 25 letters, numbers or underscores.",
  "stream.channel.readOnly": "Read only. We never post in your chat or store what it says.",
  "stream.status.label": "Chat",
  "stream.status.idle": "Not connected",
  "stream.status.connecting": "Connecting to #{channel}…",
  "stream.status.connected": "Connected to #{channel}",
  "stream.status.reconnecting": "Chat disconnected. Reconnecting to #{channel}…",
  "stream.status.failed.not_found":
    "Couldn't find #{channel} on Twitch. Check the name and try again.",
  "stream.status.failed.refused": "Twitch won't let anyone read #{channel}'s chat right now.",
  "stream.status.failed.unreachable":
    "Couldn't reach Twitch chat. Check your connection and try again.",
  "stream.status.retry": "Retry",
  "stream.votes.one": "{count} vote this question",
  "stream.votes.other": "{count} votes this question",
  "stream.pool.label": "Pick the questions",
  "stream.pool.all.name": "All legends",
  "stream.pool.all.body": "Every legend,\nevery stat",
  "stream.pool.instagram.name": "Instagram",
  "stream.pool.instagram.body": "Followers on every question",
  "stream.pool.cap": "Up to {count} questions",
  "stream.settings.questions": "Questions",
  "stream.settings.timer": "Voting time",
  "stream.settings.seconds": "{seconds} s",
  "stream.settings.minute": "1 min",
  "stream.settings.secondsLong": "{seconds} seconds",
  "stream.settings.minuteLong": "1 minute",
  "stream.settings.lowLatency": "Only recommended for low latency streaming due to chat delay.",
  "stream.settings.capped": "This squad has {count} questions.",
  "stream.start": "Start the match",
  "stream.connectFirst": "Connect your channel to start.",
  "stream.hint": "Type {higherShort} or {higher} · {lowerShort} or {lower} in chat",
  "stream.score.chat": "Chat",
  "stream.score.figures": "{chat} – {streamer}",
  "stream.scoreboard.label": "Score: chat {chat}, {channel} {streamer}",
  "stream.yourPick": "Your pick, hidden from chat",
  "stream.lockedIn": "Locked in",
  "stream.endVoting": "End voting",
  "stream.noPick": "No pick",
  "stream.reveal.chatHigher": "Chat said higher",
  "stream.reveal.chatLower": "Chat said lower",
  "stream.reveal.split": "Chat split 50/50",
  "stream.reveal.none": "No votes",
  "stream.reveal.higher": "Higher {percent}%",
  "stream.reveal.lower": "Lower {percent}%",
  "stream.reveal.chatRight": "Chat got it",
  "stream.reveal.chatWrong": "Chat missed",
  "stream.reveal.youRight": "You got it",
  "stream.reveal.youWrong": "You missed",
  "stream.reveal.youNone": "No pick from you",
  "stream.track.label": "Question {round} of {target}",
  "stream.track.region": "The match",
  "stream.result.heading": "Full time",
  "stream.result.chatWins": "Chat wins",
  "stream.result.youWin": "{channel} wins",
  "stream.result.draw": "It's a draw",
  "stream.result.strip": "Question by question",
  "stream.result.again": "Play again",
  "stream.result.changeQuestions": "Change questions",
  "stream.result.changeChannel": "Change channel",
  "stream.result.disconnected": "The match stopped early: the connection to the game dropped.",
  "stream.result.exhausted": "These questions ran out of pairings before the end.",
  "stream.strip.question": "Question {round}: chat {chat}, {channel} {you}.",
  "stream.strip.chat.right": "right",
  "stream.strip.chat.wrong": "wrong",
  "stream.strip.chat.split": "split",
  "stream.strip.chat.none": "no votes",
  "stream.strip.you.right": "right",
  "stream.strip.you.wrong": "wrong",
  "stream.strip.you.none": "no pick",
  "stream.share": "Chat {chat} – {streamer} {channel} on {pool} · Bigger Than Twitch Mode",
  "stream.share.caption": "Chat v {channel} on {pool}",
  "stream.share.mode": "Bigger Than Twitch Mode",
  "stream.pool.share.all": "Football Legends",
  "stream.pool.share.instagram": "Instagram legends",
  "stream.pool.share.theme": "{name} legends",
  "stream.fileName": "bigger-than-twitch-{chat}-{streamer}.png",
  "live.streamLocked": "Locked in.",
  "live.streamQuestion": "Question {round} of {target}. Voting is open.",
  "live.streamReveal": "{challenger}: {value}. {you}. {chat}.",
  "live.streamDone": "{challenger}: {value}. Full time: chat {chat}, {channel} {streamer}.",

  // Stat labels, by StatKey
  "stat.club_goals": "Club goals",
  // "Clear the squad": the figure is the whole career, not just the squad's club,
  // league or era (SQUAD_LABELS in @bt/core)
  "stat.squad.club_goals": "Total career club goals",
  "stat.squad.apps": "All club appearances",
  "stat.squad.ct": "Career club trophies",
  "stat.squad.fee": "Career-high transfer fee",
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
