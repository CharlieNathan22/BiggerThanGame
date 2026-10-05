<!--
  The game island (client:load). Renders `GameState` from the controller and
  forwards the player's input to it; no game rules live here. All text comes
  from ../../i18n.

  One island for both modes on the Legends deck, driven by per-mode settings
  in @bt/core: Friendly's twenty questions with a progress track, and
  Endless's streak against a clock, with a Turnstile check on Start and
  challenge links.
-->
<script lang="ts">
  import { CHALLENGES, WIN_ROUNDS, generateNickname } from "@bt/core";
  import type { Guess, SitePage } from "@bt/core";
  import type { PitchCard } from "../../game/view";
  import { onMount, tick } from "svelte";
  import { IMAGE_BASE, SITE_LABEL, SITE_URL, TURNSTILE_SITE_KEY } from "../../config";
  import { statLabel, t } from "../../i18n";
  import { FRIENDLY_PATH, LEADERBOARD_PATH, isLegendsPath } from "../../lib/paths";
  import { TIER_COLOUR } from "../../lib/tiers";
  import { createApi, createEndlessApi } from "../../game/api";
  import type { EndlessApi, Fetch, GameApi } from "../../game/api";
  import { bestKey, browserStorage, readBest, saveBest } from "../../game/best";
  import {
    deviceId,
    publishedKey,
    readNickname,
    readShowCountry,
    readStandings,
    recordRun,
    runsKey,
    saveStandings,
    standingsOf,
  } from "../../game/device";
  import {
    beatText,
    cryptoRandom,
    panelText,
    publishOffer,
    publishRun,
    rememberPublished,
    startingNickname,
  } from "../../game/publish";
  import type { PublishOutcome } from "../../game/publish";
  import type { BestDeck } from "../../game/best";
  import { readChallenge, withoutChallenge } from "../../game/challenge";
  import { GameController } from "../../game/controller";
  import {
    arrivedFrom,
    linkedFeedback,
    reportedRound,
    sendFeedback,
    sitePage,
  } from "../../game/feedback";
  import type { Draft, FeedbackKind, ReportedRound } from "../../game/feedback";
  import { createDraftStore, focusAfterClose } from "../../game/modal";
  import { initialState, shouldSpin } from "../../game/machine";
  import { NO_NOTICE, TimedNotice } from "../../game/notice";
  import type { NoticeState } from "../../game/notice";
  import type { Challenge, GameMode, GameState } from "../../game/machine";
  import { createPreloader } from "../../game/photos";
  import {
    challengeHeading,
    challengeIntro,
    challengeResult,
    challengeText,
    endingNames,
    gridCells,
    gridLabel,
    outcomeText,
    shareCard,
    shareText,
    titleText,
  } from "../../game/share";
  import {
    browserSharePlatform,
    renderShareImage,
    shareResultImage,
    shareResultText,
  } from "../../game/share-actions";
  import type { SharePlatform } from "../../game/share-actions";
  import { TIMINGS, readTimings } from "../../game/timing";
  import type { Timings } from "../../game/timing";
  import { LEAVE_ENDPOINT, createLeaveReporter } from "../../game/leave";
  import { createHumanCheck, createTurnstileLoader, loadWhenIdle } from "../../game/turnstile";
  import type {
    HumanCheck,
    IdleHost,
    ScriptDocument,
    Turnstile,
    TurnstileHost,
  } from "../../game/turnstile";
  import {
    anchorFading,
    anchorFigure,
    announcement,
    bankedText,
    bestOutcome,
    canSkipTitle,
    challengeNotice,
    hitchText,
    overCaption,
    isFinalQuestion,
    isIntro,
    onNewBest,
    pitchCards,
    plaqueLead,
    plaqueStage,
    progressText,
    qualifierText,
    scoreBadge,
    scoreFigure,
    titleCard,
    titleChip,
    topClock,
    trackSteps,
    verdictLabel,
  } from "../../game/view";
  import TitleBar from "../TitleBar.svelte";
  import Clock from "./Clock.svelte";
  import Counter from "./Counter.svelte";
  import FeedbackModal from "./FeedbackModal.svelte";
  import Figure from "./Figure.svelte";
  import Plaque from "./Plaque.svelte";
  import PublishModal from "./PublishModal.svelte";
  import Side from "./Side.svelte";
  import Track from "./Track.svelte";

  interface Props {
    /**
     * The deck and mode being played, which name the local best
     * (`bt:best:legends:friendly`). The mode also sets how a score reads: out
     * of its win target, with the progress track, where it has one (`WIN_ROUNDS`);
     * whether questions have a clock (`QUESTION_LIMITS`); and whether runs
     * offer challenge links (`CHALLENGES`).
     */
    deck: BestDeck;
    mode: GameMode;
    /** The game page's path, for the title bar: "Legends" under /legends, and the current page. */
    path: string;
  }

  let { deck, mode, path }: Props = $props();

  let game: GameState = $state(initialState());
  let controller: GameController | null = $state(null);
  let timings: Timings = $state(TIMINGS);
  let reducedMotion = $state(false);

  let higherButton: HTMLButtonElement | undefined = $state();
  let againButton: HTMLButtonElement | undefined = $state();
  let startButton: HTMLButtonElement | undefined = $state();
  /** Where Endless's Turnstile check renders, if it ever needs the player. */
  let turnstileBox: HTMLElement | undefined = $state();
  /** Endless's run-start check. Its widget goes when the start panel does. */
  let humanCheck: HumanCheck | null = null;
  const releaseCheck = () => () => humanCheck?.release();

  /** The open feedback form, if any; the round a report is about; the page a problem names. */
  let feedback = $state<FeedbackKind | null>(null);
  let feedbackReport = $state<ReportedRound | null>(null);
  let feedbackPage = $state<SitePage>(FRIENDLY_PATH);
  /** Where focus goes back to when the form closes. */
  let feedbackOpener: HTMLElement | null = null;
  let loadTurnstile = $state<(() => Promise<Turnstile>) | null>(null);

  /** Endless: the API, which holds what proves a finished run to the boards. */
  let endlessApi: EndlessApi | null = null;
  /** The token that publishes the run just ended; null when there's nothing to publish. */
  let publishable = $state<string | null>(null);
  /** The flag the publish dialog offers: the code the server saw at the run's start. */
  let publishCountry = $state<string | null>(null);
  let publishOpen = $state(false);
  /**
   * In Publish's place: after publishing, "412th of 3,208 today"; for a run
   * that can't move the boards, "Your best today is 18 — beat it…".
   */
  let boardLine = $state<{ readonly text: string; readonly beat: boolean } | null>(null);
  /** The name last published under, offered again for the next run. */
  let publishButton: HTMLButtonElement | undefined = $state();

  let platform: SharePlatform | null = $state(null);
  /** What the last share did: "Copied", "Image saved", or a problem. Announced. */
  let shareNote = $state<NoticeState>(NO_NOTICE);
  // Shows for --dur-notice, then fades and clears (game/notice.ts).
  const shareNotes = new TimedNotice({
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    timings: () => timings,
    reducedMotion: () => reducedMotion,
    onChange: (state) => (shareNote = state),
  });
  /** The share text, shown to copy by hand when the clipboard refused it. */
  let copyByHand: string | null = $state(null);
  let drawing = $state(false);

  onMount(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = motion.matches;
    const onMotion = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
    motion.addEventListener("change", onMotion);

    const root = getComputedStyle(document.documentElement);
    timings = readTimings((property) => root.getPropertyValue(property));

    platform = browserSharePlatform();
    // The DOM's own types are wider than the loader needs; it touches only these parts.
    const loader = createTurnstileLoader(
      document as unknown as ScriptDocument,
      window as unknown as TurnstileHost,
    );
    loadTurnstile = loader;
    // Endless checks on Start, so its script loads once this page is idle (or
    // on the first press, if that comes sooner). Friendly only ever loads it
    // for a feedback form.
    if (mode === "endless") loadWhenIdle(window as unknown as IdleHost, loader);

    // The footer's feedback links. Static pages have no island, so there they
    // go to this page's #suggest and #problem, which open the form here on
    // load; the page they came from is the referrer. On this page they open it
    // directly.
    const linked = linkedFeedback(location.hash);
    if (linked !== null) {
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
      openFeedback(linked, null, arrivedFrom(document.referrer, location.origin));
    }
    const onLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link =
        event.target instanceof Element ? event.target.closest("a[data-feedback]") : null;
      const kind = linkedFeedback(link?.getAttribute("data-feedback") ?? "");
      if (!(link instanceof HTMLElement) || kind === null) return;
      event.preventDefault();
      openFeedback(kind, link, sitePage(location.pathname));
    };
    // A hash typed or followed on this page without a reload.
    const onHashChange = () => {
      const kind = linkedFeedback(location.hash);
      if (kind === null) return;
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
      openFeedback(kind, null, sitePage(location.pathname));
    };
    document.addEventListener("click", onLinkClick);
    window.addEventListener("hashchange", onHashChange);

    // Leaving mid-run: a beacon saying where the run was (game/leave.ts).
    const leaves = createLeaveReporter((body) => {
      try {
        navigator.sendBeacon(LEAVE_ENDPOINT, new Blob([body], { type: "application/json" }));
      } catch {
        // Telemetry only: a browser without beacons loses nothing.
      }
    });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leaves.report(game, mode, "hidden");
    };
    const onPageHide = () => leaves.report(game, mode, "pagehide");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    // A challenge link in the URL frames the first run; a plainly broken one
    // starts a plain run with a note, as a forged one would. On the Friendly
    // page an old link is only noted: challenges have moved to Endless.
    const param = readChallenge(location.search, mode);
    const challenge: Challenge | null =
      param.kind === "link"
        ? { status: "offered", link: param.link }
        : param.kind === "broken"
          ? { status: "refused", reason: "invalid" }
          : param.kind === "retired"
            ? { status: "retired" }
            : null;

    let fetchFn: Fetch = (input, init) => fetch(input, init);
    let removeDevPanel: (() => void) | undefined;
    // pnpm dev only: the delay switch. The dynamic import sits in a branch a
    // production build removes, so neither it nor the panel ships.
    if (import.meta.env.DEV) {
      const dev = import("../../game/dev");
      const plain = fetchFn;
      fetchFn = async (input, init) => (await dev).withDevDelay(plain)(input, init);
      void dev.then((d) => (removeDevPanel = d.mountDevPanel()));
    }

    const schedule = (fn: () => void, ms: number): (() => void) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    };
    if (mode === "endless") {
      endlessApi = createEndlessApi(
        fetchFn,
        (humanCheck = createHumanCheck(
          loader,
          () => turnstileBox ?? null,
          TURNSTILE_SITE_KEY,
          schedule,
        )),
      );
    }
    const api: GameApi = endlessApi ?? createApi(fetchFn);

    const key = bestKey(deck, mode);
    const c = new GameController({
      api,
      mode,
      preload: createPreloader(IMAGE_BASE, () => new Image()),
      timings,
      now: () => performance.now(),
      schedule,
      reducedMotion: () => reducedMotion,
      best: readBest(browserStorage, key),
      saveBest: (best) => void saveBest(browserStorage, key, best),
      challenge,
      // Endless: every run goes on this device's board, published or not, and
      // one that scored can be published if it beats the day's published best.
      onOver: (over) => {
        if (endlessApi === null || over.end === null) return;
        recordRun(browserStorage, runsKey(deck, mode), {
          score: over.streak,
          date: localDate(),
          end: over.end,
        });
        const offer =
          over.streak > 0
            ? publishOffer(
                over.streak,
                over.runId,
                readStandings(browserStorage, publishedKey(deck, mode), Date.now()),
              )
            : null;
        publishable = offer?.kind === "publish" ? endlessApi.publishToken() : null;
        publishCountry = endlessApi.country();
        boardLine = offer?.kind === "beat" ? { text: beatText(offer.best), beat: true } : null;
      },
    });
    const unsubscribe = c.subscribe((s) => (game = s));
    controller = c;

    return () => {
      document.removeEventListener("click", onLinkClick);
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      removeDevPanel?.();
      unsubscribe();
      c.destroy();
      shareNotes.destroy();
      motion.removeEventListener("change", onMotion);
    };
  });

  /** The mode's win target — Friendly's 20 — or null for a mode without one. */
  const target = $derived(WIN_ROUNDS[mode]);
  const phase = $derived(game.phase);
  const round = $derived(game.round);
  const reveal = $derived(game.reveal);
  const judged = $derived((phase === "verdict" || phase === "over") && reveal !== null);
  /** Phases in which the round's wheel has started (and, after, stays landed). */
  const wheeling = $derived(
    phase === "spinning" ||
      phase === "awaiting" ||
      phase === "revealing" ||
      phase === "verdict" ||
      phase === "sliding" ||
      phase === "over",
  );
  const spinIndex = $derived(round !== null && shouldSpin(round) && wheeling ? round.index : null);
  /** The title card at a run's start: "Question 1 of 20", or "Beat 7/20". */
  const titleCardText = $derived(titleCard(game, mode));
  /** The cards on the pitch; three during the carousel to the next pair. */
  const cards = $derived(pitchCards(game));
  const anchorShows = $derived(anchorFigure(game));
  const anchorFades = $derived(anchorFading(game));
  /** The carousel's length while it runs, for the cards' own glide; else 0. */
  const gliding = $derived(phase === "sliding" ? timings.slide : 0);
  /** The first deal's kick-off: round one's cards sliding in. */
  const intro = $derived(isIntro(game));
  /** "Question 1 of 20" on the plaque until round one's wheel spins into the stat. */
  const lead = $derived(plaqueLead(game, mode));
  const tier = $derived(game.plaque?.tier ?? "basic");
  // A slow-down is a pause, not a wait on the network: the number rests at "?"
  // rather than scrambling until it's over.
  const resting = $derived(game.hitch?.kind === "slowDown");
  /** Against the previous best: a new high score, a match, or neither. */
  const best = $derived(bestOutcome(game));
  const offered = $derived(game.challenge?.status === "offered" ? game.challenge.link : null);
  const notice = $derived(challengeNotice(game));
  const won = $derived(game.end === "won");
  const title = $derived(titleText(game.streak, mode));
  const result = $derived(challengeResult(game));
  const cells = $derived(gridCells(game.history, mode));
  const steps = $derived(trackSteps(game, mode));
  const finalQuestion = $derived(isFinalQuestion(game, mode));
  const verdictText = $derived(verdictLabel(game));
  /** "3/20" at the top of the pitch after a right answer, Friendly only. */
  const badge = $derived(scoreBadge(game, mode));
  const report = $derived(reportedRound(game));
  /** Endless: the streak title the run holds so far, at the top of the pitch. */
  const chip = $derived(titleChip(game, mode));

  /**
   * `performance.now()`, every frame while a question's clock runs: the one
   * time the big clock and the plaque's line both draw from, so they can't
   * disagree with each other or with the controller's timeout.
   */
  let now = $state(0);
  $effect(() => {
    if (game.clock === null) return;
    now = performance.now();
    let raf = 0;
    const frame = () => {
      now = performance.now();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
  /** Endless: the big clock at the top of the pitch. */
  const clockTop = $derived(topClock(game, now));

  /**
   * The score badge is on screen, in the clock's spot: from the moment it is
   * put in until its own animation has played out (it stays in the page,
   * invisible, after that).
   */
  let badgeShowing = $state(false);
  const badgeIn = () => {
    badgeShowing = true;
    return () => (badgeShowing = false);
  };
  /** The badge's entrance-and-exit animation (not its glow or sheen) has ended. */
  function onBadgeEnd(event: AnimationEvent): void {
    if (event.target !== event.currentTarget) return;
    if (/(^|-)badge(-fade)?$/.test(event.animationName)) badgeShowing = false;
  }
  /** A run banked after the connection dropped: "your streak of n is saved". */
  const banked = $derived(bankedText(game, mode));
  /** A signed challenge to share, in a mode with them, once the run is over. */
  const canChallenge = $derived(CHALLENGES[mode] && game.link !== null);

  /** The small print under a card's figure. */
  function cardQualifier(card: PitchCard): string {
    if (round === null) return "";
    switch (card.role) {
      case "anchor":
        return anchorShows ? qualifierText(anchorShows.stat, anchorShows.qualifier) : "";
      case "leaving":
        return qualifierText(round.stat.key, round.anchor.qualifier);
      case "challenger":
      case "carried":
        return (judged || card.role === "carried") && reveal
          ? qualifierText(round.stat.key, reveal.qualifier)
          : "";
      case "incoming":
        return "";
    }
  }

  /** Today in the player's own time zone, for the local board: `2026-09-29`. */
  function localDate(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Publishes the run; a name it went through under is the next dialog's starting name. */
  async function publish(
    nickname: string,
    turnstileToken: string,
    showCountry: boolean,
  ): Promise<PublishOutcome> {
    if (publishable === null) return { kind: "unpublishable" };
    const outcome = await publishRun((input, init) => fetch(input, init), {
      token: publishable,
      nickname,
      deviceId: deviceId(browserStorage, () => crypto.randomUUID()),
      turnstileToken,
      showCountry,
    });
    rememberPublished(browserStorage, outcome, showCountry);
    return outcome;
  }

  function closePublish(): void {
    publishOpen = false;
    void tick().then(() => focusAfterClose(publishButton, againButton)?.focus());
  }

  /**
   * What was typed into a form closed without sending, by form, for this page
   * visit only (memory, never storage): it comes back when the form opens
   * again. A report's draft is about its own card.
   */
  const feedbackDrafts = createDraftStore<Draft>(
    (d) => d.name.trim() === "" && d.note.trim() === "",
  );
  function draftKey(kind: FeedbackKind, report: ReportedRound | null): string {
    return kind === "correction" && report !== null
      ? `correction:${report.runId}:${report.round}`
      : kind;
  }
  /** The open form's draft key, set as it opens. */
  let feedbackDraftKey = $state("");
  /**
   * Keeps a draft under the key of the form that is open now: a send that
   * ends after its form has closed still clears that form's draft, not
   * whichever form is open by then.
   */
  function keepDraftFor(key: string): (draft: Draft | null) => void {
    return (draft) => feedbackDrafts.keep(key, draft);
  }
  /** The nickname typed into the publish dialog and left unpublished. */
  let publishDraft = $state<string | undefined>(undefined);

  function start(): void {
    publishable = null;
    boardLine = null;
    publishOpen = false;
    shareNotes.clear();
    copyByHand = null;
    // The link has done its job once a run starts from it; a reload shouldn't replay it.
    const rest = withoutChallenge(location.search);
    if (rest !== location.search) {
      history.replaceState(history.state, "", `${location.pathname}${rest}${location.hash}`);
    }
    controller?.start();
  }

  /** Challenge links point at the site; under `pnpm dev`, at the dev server. */
  function site(): string {
    return import.meta.env.DEV ? location.origin : SITE_URL;
  }

  async function onShareText(): Promise<void> {
    if (platform === null) return;
    const text = shareText(
      game.streak,
      game.history,
      game.end,
      site(),
      mode,
      endingNames(game, mode),
    );
    await shareOut(text);
  }

  /** "Beat n" and the link: a friend's own fresh run against this score. */
  async function onChallenge(): Promise<void> {
    const text = challengeText(game.link, site(), mode);
    if (text !== null) await shareOut(text);
  }

  async function shareOut(text: string): Promise<void> {
    if (platform === null) return;
    const show = shareNotes.begin();
    const outcome = await shareResultText(text, platform);
    copyByHand = outcome === "failed" ? text : null;
    show(
      outcome === "copied" ? t("over.copied") : outcome === "failed" ? t("over.copyFailed") : "",
    );
  }

  async function onShareImage(): Promise<void> {
    if (platform === null || drawing) return;
    drawing = true;
    const show = shareNotes.begin();
    try {
      const blob = await renderShareImage(shareCard(game, SITE_LABEL, mode));
      const name = t("share.fileName", { score: game.streak });
      const outcome = await shareResultImage(blob, name, platform);
      show(
        outcome === "saved"
          ? t("over.imageSaved")
          : outcome === "failed"
            ? t("over.imageFailed")
            : "",
      );
    } catch {
      show(t("over.imageFailed"));
    } finally {
      drawing = false;
    }
  }

  /**
   * Opens a form. `opener` gets focus back when it closes; by default, whatever
   * has focus now. A deep link on load has no opener, and falls back below.
   */
  function openFeedback(
    kind: FeedbackKind,
    opener: HTMLElement | null = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
    page: SitePage = sitePage(location.pathname),
  ): void {
    if (feedback !== null) return;
    if (kind === "correction" && report === null) return;
    feedbackOpener = opener;
    feedbackReport = kind === "correction" ? report : null;
    feedbackDraftKey = draftKey(kind, feedbackReport);
    feedbackPage = page;
    feedback = kind;
  }

  function closeFeedback(): void {
    if (feedback === null) return;
    const back = focusAfterClose(feedbackOpener, againButton, startButton);
    feedback = null;
    feedbackOpener = null;
    void tick().then(() => back?.focus());
  }

  function pick(guess: Guess): void {
    controller?.guess(guess);
  }

  function onKeydown(event: KeyboardEvent): void {
    // Any key skips the title card and the hold, and is used for nothing else:
    // it can't answer, as there's no question yet.
    if (canSkipTitle(game)) {
      controller?.skip();
      return;
    }
    if (phase !== "awaiting" || event.repeat) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      pick("higher");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      pick("lower");
    }
  }

  // Keep keyboard play possible without reaching for Tab: when the picks come
  // back and focus was lost with the last ones, put it on Higher; when the run
  // ends, on Play again.
  $effect(() => {
    if (phase === "awaiting") {
      tick().then(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) higherButton?.focus();
      });
    } else if (phase === "over") {
      tick().then(() => againButton?.focus());
    }
  });
</script>

<!-- A tap or click anywhere skips the title card and the hold. -->
<svelte:window
  onkeydown={onKeydown}
  onclick={() => {
    if (canSkipTitle(game)) controller?.skip();
  }}
/>

<div class="game" style:--tier={TIER_COLOUR[tier]} inert={feedback !== null || publishOpen}>
  <TitleBar
    scores={{ streak: game.streak, best: game.best, target, rising: onNewBest(game) }}
    legends={isLegendsPath(path)}
    current={path}
  />
  {#if target !== null}
    <Track
      {steps}
      answered={game.history.length}
      label={progressText(game, mode)}
      final={finalQuestion}
    />
  {/if}

  <main class="pitch" class:intro class:quick={game.repeat} aria-label={t("pitch.label")}>
    <!-- Keyed by card, not by half: during the carousel the challenger's card
         moves into the anchor's place as the same element, photo and all. -->
    {#each cards as card (card.key)}
      <Side
        side={card.place === 1 ? "b" : "a"}
        place={card.place}
        {gliding}
        incoming={card.role === "incoming"}
        fading={card.role === "anchor" && anchorFades}
        {intro}
        player={card.player}
        verdict={card.role === "challenger" && judged && reveal
          ? reveal.correct
            ? "hit"
            : "miss"
          : null}
        qualifier={cardQualifier(card)}
      >
        {#snippet value()}
          {#if card.role === "anchor"}
            {#if anchorShows}
              <Figure display={anchorShows.display} />
            {/if}
          {:else if card.role === "leaving" && round}
            <Figure display={round.anchor.display} />
          {:else if card.role === "carried" && reveal}
            <Figure display={reveal.display} />
          {:else if card.role === "incoming"}
            <Figure display={null} />
          {:else if phase === "revealing" && round && game.count && !resting}
            <Counter
              count={game.count}
              stat={round.stat.key}
              target={reveal?.value ?? null}
              display={reveal?.display ?? null}
              {timings}
              {reducedMotion}
            />
          {:else if reveal}
            <Figure display={reveal.display} />
          {:else if round}
            <Figure display={null} />
          {/if}
        {/snippet}
        {#if card.place === 1 && round}
          <!-- One slot for Higher / Lower, the connection note and the verdict
               label, kept whether they show or not, so the text above never moves. -->
          <div class="slot">
            <div
              class="picks"
              role="group"
              aria-label={t("pick.group", { name: card.player.name })}
              hidden={phase !== "awaiting"}
            >
              <button class="pick" bind:this={higherButton} onclick={() => pick("higher")}>
                <svg class="arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path d="M6 10.5V1.5M2 5.5l4-4 4 4" />
                </svg>
                {t("pick.higher")}
              </button>
              <button class="pick" onclick={() => pick("lower")}>
                {t("pick.lower")}
                <svg class="arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path d="M6 1.5v9M2 6.5l4 4 4-4" />
                </svg>
              </button>
            </div>
            <p
              class="hitch"
              role="status"
              class:empty={phase !== "revealing" || game.hitch === null}
            >
              {phase === "revealing" ? hitchText(game.hitch) : ""}
            </p>
            <!-- "Correct" / "Incorrect" with the verdict colour, until the
                 slide to the next pair or the game-over panel. The live region
                 already says it, so screen readers skip this. -->
            {#if verdictText !== null && reveal && card.role === "challenger"}
              <p class="verdict" class:right={reveal.correct} aria-hidden="true">
                <svg class="mark" viewBox="0 0 12 12" focusable="false">
                  {#if reveal.correct}
                    <path d="M2.2 6.4l2.6 2.6 5-5.8" />
                  {:else}
                    <path d="M3 3l6 6M9 3l-6 6" />
                  {/if}
                </svg>
                {verdictText}
              </p>
            {/if}
          </div>
        {/if}
      </Side>
    {/each}

    <!-- No plaque before a run: there's nothing on it yet, and its glow would
         show faintly through the start panel. -->
    {#if phase !== "idle" && phase !== "starting"}
      <Plaque
        stat={game.plaque}
        {spinIndex}
        spinTo={round?.stat ?? null}
        {timings}
        {reducedMotion}
        final={finalQuestion}
        {lead}
        stage={plaqueStage(game)}
        clock={game.clock}
        {now}
      />
    {/if}

    {#if mode === "endless"}
      <!-- The question's clock, big, at the top; it steps aside for the score badge. -->
      <Clock clock={clockTop} {reducedMotion} aside={badgeShowing} />
    {/if}

    {#if chip !== "" && phase !== "idle" && phase !== "starting" && phase !== "over"}
      <!-- Endless: the title the streak has earned so far. -->
      <p class="chip"><span class="sr">{t("chip.label")}: </span>{chip}</p>
    {/if}

    {#if titleCardText !== null}
      <!-- The title card: large in the centre, then shrinking and gliding
           into the plaque, which takes over its words. The live region says
           it, so screen readers skip this. -->
      <div class="titlecard" aria-hidden="true">
        <p class="titletext">{titleCardText}</p>
      </div>
    {/if}

    <p class="sr" aria-live="polite">{announcement(game, mode)}</p>
    {#if phase !== "idle" && phase !== "starting"}
      <!-- The start panel's heading, "Football Legends", goes with it; the page keeps one. -->
      <h1 class="sr">{t("brand.heading")}</h1>
    {/if}

    {#if badge !== null}
      <!-- The new score, at the top of the pitch. The live region already
           says it, so screen readers skip this. Replays for each answer. -->
      {#key badge.key}
        <p
          class="badge"
          class:milestone={badge.milestone}
          aria-hidden="true"
          {@attach badgeIn}
          onanimationend={onBadgeEnd}
        >
          <span class="badgetext">{badge.text}</span>
        </p>
      {/key}
    {/if}

    <p
      class="notice"
      class:underclock={mode === "endless"}
      role="status"
      class:empty={notice === "" || phase === "idle" || badge !== null}
    >
      {phase === "idle" ? "" : notice}
    </p>

    {#if phase === "idle" || phase === "starting"}
      <div class="veil">
        <!-- The brand, the deck and the mode, then what to do; side by side on
             a landscape phone, so it fits. The deck is the page's heading; the
             brand above it is a line of its own. -->
        <div class="panel start" class:clocked={mode === "endless"}>
          <div class="head">
            <div class="brand">
              {t("brand.bigger")} <em>{t("brand.than")}</em>
              {t("brand.game")}
            </div>
            <h1 class="deckname">{t("brand.footballLegends")}</h1>
            <div class="modename"><span>{t(`mode.${mode}.name`)}</span></div>
          </div>
          <div class="lead">
            <div class="blurb">
              <div class="intro">
                {#if offered}
                  <p class="beat">{challengeHeading(offered.score, mode)}</p>
                  <p>{challengeIntro(offered.score, mode)}</p>
                {:else if target !== null}
                  <p>{t("start.introTarget", { target })}</p>
                {:else}
                  <p>{t(mode === "endless" ? "start.introEndless" : "start.intro")}</p>
                {/if}
              </div>
              {#if mode === "endless"}
                <p class="clockline">
                  {t("start.clock")}
                  {t("start.noClock")} <a href={FRIENDLY_PATH}>{t("start.playFriendly")}</a>
                  <span aria-hidden="true">{t("over.separator")}</span>
                  <a href={LEADERBOARD_PATH}>{t("start.leaderboard")}</a>
                </p>
              {/if}
            </div>
            <!-- The room above Start, which gives way on a small screen. -->
            <div class="startgap" aria-hidden="true"></div>
            <button
              class="cta"
              bind:this={startButton}
              disabled={controller === null || phase === "starting"}
              onclick={start}
            >
              {phase === "starting"
                ? t("start.starting")
                : offered
                  ? t("challenge.cta")
                  : t("start.cta")}
            </button>
            {#if mode === "endless"}
              <!-- Turnstile's widget, shown only when it needs the player. -->
              <div class="turnstile" bind:this={turnstileBox} {@attach releaseCheck}></div>
            {/if}
            {#if game.startFailed}
              <p class="problem" role="alert">
                {game.checkFailed ? t("start.checkFailed") : t("start.failed")}
              </p>
            {/if}
            <p class="problem" role="status" class:empty={!(phase === "starting" && resting)}>
              {phase === "starting" && resting ? t("start.slowDown") : ""}
            </p>
            <p class="problem" role="status" class:empty={notice === ""}>{notice}</p>
          </div>
        </div>
      </div>
    {:else if phase === "over"}
      <div class="veil">
        <!-- Stacked; on a short landscape screen, the score beside the actions. -->
        <div class="panel over">
          <div class="scoreboard" class:won>
            {#if won}
              <!-- The win: a trophy and "You won" in gold leaf, rising in over
                   a burst of gold. Still, and all there, with reduced motion. -->
              <div class="burst" aria-hidden="true"></div>
              <svg class="trophy" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M7 3h10v5a5 5 0 0 1-10 0V3zM7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10M12 13v4M8.5 21h7M9.5 17h5l.5 4h-6z"
                />
              </svg>
              <p class="wontitle">{t("over.won")}</p>
            {/if}
            <div class="final num">
              {game.streak}{#if target !== null}<span class="of">/{target}</span>{/if}
            </div>
            <div class="finalcap">{overCaption(game)}</div>
            {#if title}
              <div class="sublegend title">{title}</div>
            {/if}
            <!-- In the best line's place, so the panel is no taller. -->
            {#if best === "new"}
              <div class="highscore">{t("over.newHighScore")}</div>
            {:else if best === "matched"}
              <div class="best matched">{t("over.matchedBest")}</div>
            {:else}
              <div class="best">{t("over.best", { best: scoreFigure(game.best, mode) })}</div>
            {/if}
            {#if result}
              <p class="outcome">{outcomeText(result.outcome, result.target, mode)}</p>
            {/if}
            {#if cells.length > 0}
              <div class="grid" role="img" aria-label={gridLabel(game.history, mode)}>
                {#each cells as cell, i (i)}
                  <span
                    class="cell"
                    class:miss={cell.kind === "miss"}
                    class:empty={cell.kind === "empty"}
                    style:--cell={cell.kind === "hit" ? TIER_COLOUR[cell.tier] : undefined}
                    aria-hidden="true"
                  ></span>
                {/each}
              </div>
            {/if}
          </div>
          <div class="actions">
            {#if round && reveal}
              <div class="reason">
                <span class="lab">{statLabel(round.stat.key)}</span>
                <b>{round.anchor.name}</b>
                {round.anchor.display}
                <span aria-hidden="true">{t("over.separator")}</span>
                <b>{round.challenger.name}</b>
                {reveal.display}
                {#if game.end === "deck-exhausted"}
                  <p class="note">{t("over.exhausted")}</p>
                {:else if game.end === "timeout"}
                  <p class="note">{t("over.timeout")}</p>
                {/if}
              </div>
            {:else if banked !== ""}
              <div class="reason">
                <p class="note">{banked}</p>
              </div>
            {/if}
            <button class="cta" bind:this={againButton} onclick={start}>{t("over.again")}</button>
            <!-- Secondary to Play again: gold outline and text. The icons are
               decoration; each button is named by its words. -->
            <div class="shares">
              <button class="secondary" onclick={onShareText}>
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
                  />
                </svg>
                {t("over.share")}
              </button>
              <button
                class="secondary"
                onclick={onShareImage}
                disabled={drawing}
                aria-busy={drawing}
              >
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  {#if platform?.touch}
                    <path
                      d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
                    />
                  {:else}
                    <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 20h14" />
                  {/if}
                </svg>
                {platform?.touch ? t("over.shareImage") : t("over.saveImage")}
              </button>
              {#if canChallenge}
                <button class="secondary" onclick={onChallenge}>
                  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
                  </svg>
                  {t("over.challenge")}
                </button>
              {/if}
            </div>
            {#if boardLine !== null}
              <!-- Endless, once published: where it landed today; or the best to beat. And the board. -->
              <p class="published" class:stacked={boardLine.beat}>
                {boardLine.text}
                {#if !boardLine.beat}<span aria-hidden="true">{t("over.separator")}</span>{/if}
                <a href={LEADERBOARD_PATH}>{t("over.leaderboard")}</a>
              </p>
            {:else if publishable !== null}
              <!-- Endless: opt-in. The dialog takes the nickname and sends it. -->
              <button
                class="secondary publish"
                bind:this={publishButton}
                onclick={() => (publishOpen = true)}
              >
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 20h16M7 16V10M12 16V5M17 16v-8" />
                </svg>
                {t("over.publish")}
              </button>
            {/if}
            <p class="status" class:fading={shareNote.fading} role="status">{shareNote.text}</p>
            {#if copyByHand !== null}
              <textarea class="copy" readonly rows="6" aria-label={t("over.shareText")}
                >{copyByHand}</textarea
              >
            {/if}
          </div>
          <div class="feedback">
            {#if report}
              <button class="ghost" onclick={() => openFeedback("correction")}>
                {t("over.report")}
              </button>
            {/if}
            <button class="ghost" onclick={() => openFeedback("suggest")}>
              {t("over.suggest")}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </main>
</div>

{#if publishOpen && publishable !== null && loadTurnstile !== null}
  <PublishModal
    streak={game.streak}
    nickname={startingNickname(publishDraft, readNickname(browserStorage), () =>
      generateNickname(cryptoRandom),
    )}
    siteKey={TURNSTILE_SITE_KEY}
    {loadTurnstile}
    country={publishCountry}
    showCountry={readShowCountry(browserStorage)}
    {publish}
    boardHref={LEADERBOARD_PATH}
    onpublished={(response) => {
      boardLine = { text: panelText(response), beat: !response.periods.day.improved };
      saveStandings(browserStorage, publishedKey(deck, mode), standingsOf(response), Date.now());
    }}
    ondraft={(nickname) => (publishDraft = nickname ?? undefined)}
    onclose={closePublish}
  />
{/if}

{#if feedback !== null && loadTurnstile !== null}
  <FeedbackModal
    kind={feedback}
    report={feedbackReport}
    page={feedbackPage}
    {timings}
    {reducedMotion}
    siteKey={TURNSTILE_SITE_KEY}
    {loadTurnstile}
    send={(body) => sendFeedback((input, init) => fetch(input, init), body)}
    draft={feedbackDrafts.get(feedbackDraftKey)}
    ondraft={keepDraftFor(feedbackDraftKey)}
    onclose={closeFeedback}
  />
{/if}

<style>
  .game {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    /* A game, not a document: nothing selects on a long press or a
       double-click, and a tap doesn't flash. The copy-by-hand share box
       below is the one exception. */
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* The site background, static here (tokens.css): it shows through the
     halves at rest and on the start and game-over panels. The halves are
     cards placed by transform (Side.svelte): stacked on a phone, side by side
     from 780px wide and on a landscape phone, where the plaque moves to the
     top. They slide in and out past the pitch's edges, so it clips. */
  .pitch {
    flex: 1;
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-grain), var(--bg-lights), var(--bg-vignette);
    /* The title card's length, shared with the plaque's arrival. */
    --title-dur: var(--dur-title);
  }
  /* Play again: the quicker title card. */
  .pitch.quick {
    --title-dur: var(--dur-title-quick);
  }

  /* The title card at a run's start. The words sit where the plaque's are and
     are drawn larger (--title-grow); the card rises in (to 30% of the time),
     holds, then shrinks back to the plaque's size (55% to 85%) while the whole
     layer glides from the centre to the plaque (on a landscape phone the
     plaque is at the top), and fades as the plaque fades in under it. */
  .titlecard {
    position: absolute;
    inset: 0;
    z-index: 6;
    pointer-events: none;
    --title-from-y: 0px;
    animation: title-glide var(--title-dur) var(--ease-title) both;
  }
  .titletext {
    position: absolute;
    left: 50%;
    top: 50%;
    white-space: nowrap;
    font-size: var(--fs-plaque);
    font-variation-settings: var(--fv-plaque);
    line-height: var(--lh-plaque);
    color: var(--title-colour);
    text-shadow: var(--glow-hover);
    transform: translate(-50%, -50%) scale(var(--title-grow));
    animation: title-text var(--title-dur) var(--ease-title) both;
  }
  @media (orientation: landscape) and (max-height: 500px) {
    .titlecard {
      --title-from-y: calc(50% - var(--plaque-h) / 2 - var(--plaque-top-gap));
    }
    .titletext {
      top: calc(var(--plaque-h) / 2 + var(--plaque-top-gap));
    }
  }
  @keyframes title-glide {
    0%,
    55% {
      transform: translateY(var(--title-from-y));
    }
    85%,
    100% {
      transform: none;
    }
  }
  @keyframes title-text {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(calc(var(--title-grow) * var(--title-enter-scale)));
    }
    30%,
    55% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(var(--title-grow));
    }
    85% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(1);
    }
  }
  /* Reduced motion: no glide and no scaling; the words fade in and out where
     they are (base.css stops the rest). */
  @media (prefers-reduced-motion: reduce) {
    .titletext {
      animation: title-fade var(--title-dur) linear both !important;
    }
  }
  @keyframes title-fade {
    0% {
      opacity: 0;
    }
    30%,
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  .slot {
    position: relative;
    /* Never squeezed, so Higher / Lower are never pushed out of the half. */
    flex: none;
    margin-top: var(--picks-gap);
    min-height: var(--target-min);
    display: grid;
    place-items: center;
  }
  .slot > * {
    grid-area: 1 / 1;
  }
  .picks {
    display: flex;
    gap: var(--pick-gap);
  }
  /* Hidden, but still holding its room. */
  .picks[hidden] {
    display: flex;
    visibility: hidden;
  }
  .hitch {
    padding: 7px 14px;
    border-radius: var(--radius-pill);
    background: var(--hitch-bg);
    font-size: var(--fs-qual);
    color: var(--chalk);
    font-variation-settings: var(--fv-caption);
  }
  /* The verdict label, in the slot Higher / Lower have left: a pill in the
     verdict colour with white text, a dark ring like the plaque's and a glow
     of its own colour. It rises in; with reduced motion it simply appears. */
  .verdict {
    display: inline-flex;
    align-items: center;
    gap: var(--verdict-gap);
    padding: var(--verdict-pad);
    border-radius: var(--radius-pill);
    background: var(--verdict-miss-bg);
    color: var(--verdict-text);
    font-size: var(--fs-verdict);
    font-variation-settings: var(--fv-verdict);
    letter-spacing: var(--tracking-verdict);
    line-height: var(--lh-tight);
    white-space: nowrap;
    box-shadow: var(--verdict-miss-shadow);
    pointer-events: none;
    animation: verdict-in var(--dur-verdict-in) var(--ease-verdict) both;
  }
  .verdict.right {
    background: var(--verdict-hit-bg);
    box-shadow: var(--verdict-hit-shadow);
  }
  .mark {
    flex: none;
    width: var(--verdict-icon);
    height: var(--verdict-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: var(--verdict-icon-stroke);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @keyframes verdict-in {
    from {
      opacity: 0;
      transform: translateY(var(--verdict-rise)) scale(var(--verdict-from-scale));
    }
  }
  .hitch.empty,
  .problem.empty,
  .notice.empty {
    display: none;
  }
  /* Endless: the clock has the top; a challenge notice (round one only) goes
     under it, in the chip's place (the chip comes later in a run). */
  .notice.underclock {
    top: var(--game-clock-under);
  }
  /* Landscape phones: under the plaque, where the score badge goes. */
  @media (orientation: landscape) and (max-height: 500px) {
    .notice.underclock {
      top: calc(var(--plaque-top-gap) + var(--plaque-h) + var(--score-badge-below-plaque));
    }
  }
  /* The score badge. Over the divide at the top on a desktop, under the
     plaque on a landscape phone (where the plaque is at the top), and at the
     top of the top half on a portrait phone, close to the track and above
     the face. It rises in, a sheen crosses it and its glow pulses, it holds,
     then it leaves: --dur-score-badge in all, from the verdict, so it is going
     as the next question settles. Reduced motion: a fade in and out. */
  .badge {
    position: absolute;
    left: 50%;
    top: var(--score-badge-top);
    z-index: 6;
    margin: 0;
    overflow: hidden;
    padding: var(--score-badge-pad);
    border-radius: var(--radius-pill);
    background: var(--score-badge-bg);
    color: var(--score-badge-text);
    font-size: var(--fs-score-badge);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--tracking-score-badge);
    text-indent: var(--tracking-score-badge);
    line-height: var(--lh-tight);
    white-space: nowrap;
    pointer-events: none;
    box-shadow: var(--score-badge-glow);
    transform: translateX(-50%);
    animation:
      badge var(--dur-score-badge) var(--ease) both,
      badge-glow var(--dur-score-badge-pulse) var(--ease) var(--score-badge-in-at) 1;
  }
  .badge.milestone {
    --score-badge-glow: var(--score-badge-glow-milestone);
    --score-badge-glow-peak: var(--score-badge-glow-milestone-peak);
  }
  /* The sheen, once, as it settles in. */
  .badge::after {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--score-badge-sheen);
    opacity: 0;
    transform: translateX(-100%);
    animation: badge-sheen var(--dur-score-badge-sheen) var(--ease-sheen) var(--score-badge-in-at)
      both;
  }
  .badgetext {
    position: relative;
  }
  @media (orientation: landscape) and (max-height: 500px) {
    .badge {
      top: calc(var(--plaque-top-gap) + var(--plaque-h) + var(--score-badge-below-plaque));
    }
  }
  @keyframes badge {
    0% {
      opacity: 0;
      transform: translateX(-50%) translateY(var(--score-badge-rise))
        scale(var(--score-badge-from-scale));
    }
    15%,
    80% {
      opacity: 1;
      transform: translateX(-50%);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) translateY(calc(-0.5 * var(--score-badge-rise)));
    }
  }
  @keyframes badge-glow {
    50% {
      box-shadow: var(--score-badge-glow-peak);
    }
  }
  @keyframes badge-sheen {
    from {
      opacity: 1;
      transform: translateX(-100%);
    }
    to {
      opacity: 1;
      transform: translateX(100%);
    }
  }
  @keyframes badge-fade {
    0%,
    100% {
      opacity: 0;
    }
    15%,
    80% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .badge {
      animation: badge-fade var(--dur-score-badge) linear both !important;
    }
  }

  .notice {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    width: max-content;
    max-width: calc(100% - 32px);
    padding: 8px 16px;
    border-radius: var(--radius-pill);
    background: var(--notice-bg);
    font-size: var(--fs-qual);
    line-height: var(--lh-body);
    text-align: center;
    color: var(--chalk);
    font-variation-settings: var(--fv-caption);
  }
  .pick {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--pick-arrow-gap);
    min-width: var(--pick-w);
    min-height: max(var(--pick-h), var(--target-min));
    padding: 0 var(--pick-pad-x);
    border: var(--border-pick) solid var(--chalk);
    border-radius: var(--radius-pill);
    background: var(--pick-bg);
    font-size: var(--fs-pick);
    font-variation-settings: var(--fv-button);
    /* Room for the ring, drawn only on hover and keyboard focus. */
    outline: var(--pick-ring-w) solid transparent;
    outline-offset: var(--pick-ring-offset);
    box-shadow: var(--glow);
    text-shadow: var(--glow);
    transition:
      background-color var(--dur-hover),
      color var(--dur-hover),
      outline-color var(--dur-hover),
      box-shadow var(--dur-hover),
      transform var(--dur-press);
  }
  .arrow {
    flex: none;
    width: var(--pick-arrow);
    height: var(--pick-arrow);
    fill: none;
    stroke: currentColor;
    stroke-width: var(--pick-arrow-stroke);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* A mouse or trackpad: the button turns white inside a gold ring. Touch
     screens skip this, so a tapped button doesn't stay lit. */
  @media (hover: hover) {
    .pick:hover {
      background: var(--chalk);
      color: var(--night);
      outline-color: var(--pick-ring);
      box-shadow: var(--glow-hover);
    }
  }
  .pick:focus-visible {
    background: var(--chalk);
    color: var(--night);
    outline-color: var(--pick-ring);
    box-shadow: var(--glow-hover);
  }
  /* Pressed, on touch above all: white, pushed in and glowing. */
  .pick:active {
    background: var(--chalk);
    color: var(--night);
    transform: scale(var(--press-scale));
    box-shadow: var(--glow-hover);
  }

  .veil {
    position: absolute;
    inset: 0;
    z-index: 9;
    display: flex;
    background: var(--bg-grain), var(--bg-lights), var(--bg-vignette), var(--veil);
    padding: var(--veil-pad);
    /* A tall game-over panel on a short screen scrolls rather than clipping. */
    overflow-y: auto;
  }
  .panel {
    max-width: var(--panel-w);
    text-align: center;
    width: 100%;
    /* Centres in the veil, and still scrolls from the top when it overflows. */
    margin: auto;
  }
  .panel .brand {
    /* Bold, as it was when it was the heading. */
    font-weight: bold;
    font-size: var(--fs-display);
    line-height: var(--lh-display);
    font-variation-settings: var(--fv-display);
    letter-spacing: var(--tracking-display);
  }
  .panel .brand em {
    font-style: normal;
    color: var(--gold);
  }
  /* The start panel: "Bigger Than Game" in the site's gold glow, sized to
     stay on one line on a phone; "Football Legends" in Cinzel, gold leaf with
     a glow; the mode beneath in gold. */
  /* Nearer the top than the centre, with room under the title bar; wider than
     other panels so the names stay on one line on a phone. */
  .panel.start {
    max-width: var(--start-w);
    margin: var(--start-top) auto auto;
  }
  /* The panel takes the veil's height, so the room above Start
     (--start-cta-top) can give way, down to --cta-top, when there's more to
     say than the screen has room for (Endless's clock note on a 568px-tall
     phone) and Start stays on screen. Where it all fits, nothing moves. */
  @media not ((orientation: landscape) and (max-height: 500px)) {
    .panel.start {
      align-self: stretch;
      margin-bottom: 0;
      display: flex;
      flex-direction: column;
    }
    .start .lead {
      flex: 1 1 auto;
      /* Its height is the panel's, not its content's, so the gap can give way. */
      min-height: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .start .lead > * {
      flex-shrink: 0;
      align-self: stretch;
    }
    .start .lead > .cta {
      align-self: center;
    }
    .start .lead > .startgap {
      flex: 0 1 var(--start-cta-top);
      min-height: var(--cta-top);
    }
  }
  .start .brand {
    font-size: var(--fs-start-brand);
    white-space: nowrap;
    text-shadow: var(--heading-glow);
  }
  .deckname {
    margin-top: var(--deckname-top);
    font-family: var(--font-display);
    font-weight: var(--fw-legends);
    font-size: var(--fs-deckname);
    letter-spacing: var(--tracking-legends);
    /* Balances the tracking after the last letter, so the line centres. */
    text-indent: var(--tracking-legends);
    line-height: var(--lh-tight);
    white-space: nowrap;
    background: var(--legends-gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: var(--legends-shadow) var(--glow-filter);
  }
  /* The glow on the letters themselves (an inline span), not the line's box. */
  .modename {
    margin-top: var(--modename-top);
    font-size: var(--fs-modename);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--tracking-modename);
    text-indent: var(--tracking-modename);
    text-transform: uppercase;
    color: var(--gold);
  }
  .modename span {
    text-shadow: var(--modename-glow);
  }
  /* Start the run: bigger than the panel's other buttons, with more room
     above it, so on a desktop it sits near the middle of the screen. */
  .start .cta {
    margin-top: 0;
    min-height: var(--start-cta-h);
    padding: 0 var(--start-cta-pad-x);
    font-size: var(--fs-start-cta);
  }
  @media (orientation: landscape) and (max-height: 500px) {
    /* A landscape phone: the names and the text side by side on one line,
       and a bigger, wider Start centred beneath both, the whole panel in the
       middle of the screen. */
    .panel.start {
      max-width: var(--start-w-wide);
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: var(--over-col-gap);
      row-gap: var(--start-row-gap);
      align-items: center;
      margin: auto;
    }
    .start .lead {
      display: contents;
    }
    .start .intro > p:first-child {
      margin-top: 0;
    }
    .startgap {
      display: none;
    }
    /* Endless has its clock note too: Start and the note go under the names,
       the intro beside them, so it all fits a phone's height. */
    .start.clocked {
      grid-template-rows: auto auto auto;
    }
    .start.clocked .head {
      grid-column: 1;
      grid-row: 1;
    }
    .start.clocked .blurb {
      display: contents;
    }
    .start.clocked .intro {
      grid-column: 2;
      grid-row: 1 / span 3;
    }
    .start.clocked .cta {
      grid-column: 1;
      grid-row: 2;
    }
    .start.clocked .clockline {
      grid-column: 1;
      grid-row: 3;
      margin-top: 0;
      align-self: start;
      /* As wide as the names' column, never widening it. */
      width: 0;
      min-width: 100%;
    }
    .start .cta,
    .start .problem {
      grid-column: 1 / -1;
      justify-self: center;
    }
    .start .cta {
      min-width: var(--start-cta-min-w);
    }
  }
  .sublegend {
    margin-top: 8px;
    font-family: var(--font-display);
    font-weight: var(--fw-sublegend);
    font-size: var(--fs-sublegend);
    letter-spacing: var(--tracking-sublegend);
    text-indent: var(--tracking-sublegend);
    background: var(--legends-gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: var(--legends-shadow);
  }
  .panel p {
    margin-top: 14px;
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    color: var(--dim);
  }
  .cta {
    margin-top: var(--cta-top);
    min-height: var(--cta-h);
    padding: 0 var(--cta-pad-x);
    border-radius: var(--radius-pill);
    background: var(--gold);
    color: var(--ink);
    font-size: var(--fs-cta);
    font-variation-settings: var(--fv-cta);
    box-shadow: var(--glow);
    transition:
      box-shadow var(--dur-hover),
      transform var(--dur-press);
  }
  .cta:hover,
  .cta:active,
  .cta:focus-visible {
    box-shadow: var(--glow-hover);
  }
  .cta:active {
    transform: scale(var(--press-scale));
  }
  .cta:focus-visible {
    outline: var(--focus-ring) solid var(--chalk);
    outline-offset: var(--focus-offset);
  }
  .cta:disabled {
    cursor: default;
  }
  /* Endless's start panel: the clock, Friendly for anyone who'd rather play
     without one, and the leaderboard. */
  .clockline {
    color: var(--dim);
  }
  .clockline a {
    color: var(--gold);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* Turnstile's widget: empty, and taking no room, unless it needs the player. */
  .turnstile:empty {
    display: none;
  }
  .turnstile {
    margin-top: 12px;
    display: flex;
    justify-content: center;
  }
  /* Endless's streak title, at the top of the pitch where Friendly's track
     and badge sit. Gives way to the score badge while that shows. */
  .chip {
    position: absolute;
    top: var(--chip-top);
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    padding: var(--chip-pad);
    border-radius: var(--radius-pill);
    border: 1px solid var(--chip-edge);
    background: var(--chip-bg);
    color: var(--chip-text);
    font-size: var(--fs-chip);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--chip-tracking);
    text-indent: var(--chip-tracking);
    text-transform: uppercase;
    white-space: nowrap;
    pointer-events: none;
  }
  /* Landscape phones: the plaque holds the top centre and the clock the top
     left, so the chip sits at the top right, level with the plaque. */
  @media (orientation: landscape) and (max-height: 500px) {
    .chip {
      top: calc(var(--plaque-top-gap) + var(--plaque-h) / 2);
      left: auto;
      right: 12px;
      transform: translateY(-50%);
    }
  }
  .ghost {
    margin-top: 12px;
    font-size: var(--fs-ghost);
    color: var(--dim);
    text-decoration: underline;
    text-underline-offset: 3px;
    display: block;
    width: 100%;
    text-shadow: var(--glow);
    transition: text-shadow var(--dur-hover);
  }
  .ghost:hover,
  .ghost:active,
  .ghost:focus-visible {
    text-shadow: var(--glow-hover);
  }
  .feedback .ghost {
    min-height: var(--target-min);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Share and Save image: secondary to Play again, the same height, radius
     and type, with a gold outline and gold text. Side by side, or one to a
     row when they don't fit. */
  .shares {
    margin-top: var(--shares-top);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--btn2-gap);
  }
  .secondary {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--btn2-icon-gap);
    min-height: var(--cta-h);
    padding: 0 var(--btn2-pad-x);
    border: var(--btn2-border) solid var(--btn2-edge);
    border-radius: var(--radius-pill);
    background: var(--btn2-bg);
    color: var(--btn2-text);
    font-size: var(--fs-btn2);
    font-variation-settings: var(--fv-cta);
    white-space: nowrap;
    box-shadow: var(--glow);
    text-shadow: var(--glow);
    transition:
      background-color var(--dur-hover),
      box-shadow var(--dur-hover),
      transform var(--dur-press);
  }
  .secondary:hover,
  .secondary:active,
  .secondary:focus-visible {
    background: var(--btn2-bg-hover);
    box-shadow: var(--glow-hover);
  }
  .secondary:active {
    transform: scale(var(--press-scale));
  }
  .secondary:focus-visible {
    outline: var(--focus-ring) solid var(--chalk);
    outline-offset: var(--focus-offset);
  }
  .secondary:disabled {
    cursor: progress;
  }
  .icon {
    flex: none;
    width: var(--btn2-icon);
    height: var(--btn2-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: var(--btn2-icon-stroke);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* Endless: Publish, a row of its own under the shares, the same button. */
  .secondary.publish {
    flex: none;
    width: 100%;
    margin-top: var(--btn2-gap);
  }
  /* In Publish's place: the day's rank once published, or the best to beat; and the board. */
  .published {
    margin-top: var(--btn2-gap);
    min-height: var(--target-min);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0 6px;
    font-size: var(--fs-lab);
    color: var(--chalk);
    font-variation-settings: var(--fv-caption);
  }
  /* The best to beat is a sentence of its own: the link goes under it. */
  .published.stacked {
    flex-direction: column;
    text-align: center;
  }
  .published a {
    display: inline-flex;
    align-items: center;
    min-height: var(--target-min);
    color: var(--gold);
    text-underline-offset: 3px;
  }
  .feedback {
    display: flex;
    flex-wrap: wrap;
    column-gap: 10px;
  }
  .feedback .ghost {
    margin-top: 0;
    flex: 1 1 auto;
    width: auto;
  }
  .ghost:disabled {
    cursor: progress;
  }
  /* Its height is reserved, so the panel doesn't move as a note comes and goes. */
  .panel .status {
    margin-top: 0;
    min-height: 1.4em;
    font-size: var(--fs-lab);
    color: var(--chalk);
    font-variation-settings: var(--fv-caption);
    transition: opacity var(--dur-notice-fade) var(--ease);
  }
  .panel .status.fading {
    opacity: 0;
  }
  .copy {
    margin-top: 8px;
    width: 100%;
    padding: 8px 10px;
    border: var(--border) solid var(--rule);
    border-radius: 8px;
    background: var(--night-2);
    color: var(--chalk);
    font: inherit;
    font-size: var(--fs-lab);
    resize: none;
    /* The one thing in the game meant to be selected: it's there to copy. */
    -webkit-user-select: text;
    user-select: text;
  }
  .copy:focus-visible {
    outline: var(--focus-ring-thin) solid var(--gold);
    outline-offset: var(--focus-offset);
  }
  .ghost:focus-visible {
    outline: var(--focus-ring-thin) solid var(--gold);
    outline-offset: var(--focus-offset);
  }

  .panel .beat {
    margin-top: 16px;
    font-size: var(--fs-heading);
    color: var(--gold);
    font-variation-settings: var(--fv-heading);
  }
  .sublegend.title {
    margin-top: var(--over-title-top);
  }
  .panel .outcome {
    margin-top: 10px;
    font-size: var(--fs-caption);
    color: var(--chalk);
    font-variation-settings: var(--fv-caption);
  }
  .grid {
    margin: var(--over-grid-top) auto 0;
    /* Ten to a row, as in the share text. */
    max-width: calc(var(--grid-cell) * 10 + var(--grid-gap) * 9);
    display: flex;
    flex-wrap: wrap;
    gap: var(--grid-gap);
    justify-content: center;
  }
  .cell {
    width: var(--grid-cell);
    height: var(--grid-cell);
    border-radius: var(--grid-radius);
    background: var(--cell);
  }
  /* A round of the challenge the run didn't reach. */
  .cell.empty {
    background: none;
    box-shadow: inset 0 0 0 var(--border) var(--grid-empty-edge);
  }
  /* The miss is a cross as well as a colour. */
  .cell.miss {
    background:
      linear-gradient(45deg, transparent 43%, var(--chalk) 43% 57%, transparent 57%),
      linear-gradient(-45deg, transparent 43%, var(--chalk) 43% 57%, transparent 57%), var(--miss);
  }

  .final {
    font-size: var(--fs-final);
    line-height: var(--lh-final);
    color: var(--gold);
  }
  /* "/20" after the score: the same gold, smaller. */
  .final .of {
    font-size: var(--final-of-size);
    color: var(--dim);
  }

  /* The win. Everything animates from a hidden start to its natural state, so
     with reduced motion (base.css stops every animation) the panel is simply
     all there; the burst's natural state is spent. */
  .scoreboard.won {
    position: relative;
    isolation: isolate;
  }
  .burst {
    position: absolute;
    z-index: -1;
    left: 50%;
    top: 0;
    width: 150%;
    aspect-ratio: 1;
    transform: translate(-50%, -30%);
    background: var(--won-burst);
    opacity: 0;
    pointer-events: none;
    animation: burst var(--dur-win-burst) var(--ease) both;
  }
  .trophy {
    display: block;
    margin: 0 auto;
    width: var(--won-trophy);
    height: var(--won-trophy);
    fill: none;
    stroke: var(--gold);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: var(--glow-filter);
    animation: win-in var(--dur-win) var(--ease-win) both;
  }
  .panel .wontitle {
    /* .panel p sets these for body text. */
    margin-top: var(--won-gap);
    font-family: var(--font-display);
    font-weight: var(--fw-sublegend);
    font-size: var(--fs-won);
    line-height: var(--lh-tight);
    letter-spacing: var(--tracking-sublegend);
    text-indent: var(--tracking-sublegend);
    background: var(--won-shine), var(--legends-gradient);
    background-size:
      250% 100%,
      100% 100%;
    background-position:
      150% 0,
      0 0;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: var(--legends-shadow) var(--glow-filter);
    animation:
      win-in var(--dur-win) var(--ease-win) var(--win-stagger) both,
      shine var(--dur-win-shine) var(--ease) calc(var(--dur-win) + var(--win-stagger)) both;
  }
  .won .final {
    margin-top: var(--won-gap);
    animation: win-in var(--dur-win) var(--ease-win) calc(var(--win-stagger) * 2) both;
  }
  @keyframes win-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(var(--win-from-scale));
    }
  }
  @keyframes burst {
    from {
      opacity: 1;
      transform: translate(-50%, -30%) scale(0.2);
    }
    40% {
      opacity: 1;
    }
    to {
      opacity: 0;
      transform: translate(-50%, -30%) scale(1);
    }
  }
  @keyframes shine {
    from {
      background-position:
        150% 0,
        0 0;
    }
    to {
      background-position:
        -50% 0,
        0 0;
    }
  }
  .finalcap,
  .best {
    margin-top: var(--over-cap-top);
    font-size: var(--fs-caption);
    color: var(--dim);
    font-variation-settings: var(--fv-caption);
  }
  /* A new high score: gold, glowing, popping in once the panel is up (after
     the win's own entrance on a win), then one brighter pulse of glow. With
     reduced motion it is simply there. */
  .highscore {
    margin-top: var(--over-cap-top);
    font-size: var(--fs-highscore);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--tracking-highscore);
    text-indent: var(--tracking-highscore);
    text-transform: uppercase;
    color: var(--gold);
    text-shadow: var(--glow-hover);
    animation:
      highscore-in var(--dur-highscore-in) var(--ease-win) var(--highscore-delay) both,
      highscore-pulse var(--dur-highscore-pulse) var(--ease)
        calc(var(--highscore-delay) + var(--dur-highscore-in)) 1;
  }
  @keyframes highscore-in {
    from {
      opacity: 0;
      transform: scale(var(--highscore-from-scale));
    }
  }
  @keyframes highscore-pulse {
    50% {
      text-shadow: var(--highscore-pulse-glow);
    }
  }
  /* Matching the best is quieter: the caption's size, in chalk. */
  .best.matched {
    color: var(--chalk);
  }
  .reason {
    margin-top: var(--reason-top);
    padding-top: var(--reason-pad);
    border-top: var(--border) solid var(--rule);
    font-size: var(--fs-reason);
    line-height: var(--lh-reason);
  }
  .reason .lab {
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-caps);
    display: block;
    margin-bottom: 7px;
  }
  .reason b {
    font-variation-settings: var(--fv-strong);
  }
  .panel .reason .note {
    margin-top: 8px;
  }

  /* Wide enough for Share and Save image side by side. */
  .panel.over {
    max-width: var(--over-w);
  }

  /* A short landscape screen: the score on the left, the reason and the
     buttons on the right, the feedback links across the bottom, so the panel
     fits without scrolling. */
  @media (orientation: landscape) and (max-height: 500px) {
    .panel.over {
      max-width: var(--over-w-wide);
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: var(--over-col-gap);
      align-items: center;
    }
    .over .feedback {
      grid-column: 1 / -1;
    }
    .over .reason {
      margin-top: 0;
      padding-top: 0;
      border-top: 0;
    }
    .over .reason .lab {
      display: inline;
      margin: 0 6px 0 0;
    }
  }
</style>
