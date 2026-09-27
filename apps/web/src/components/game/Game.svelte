<!--
  The game island (client:load). Renders `GameState` from the controller and
  forwards the player's input to it; no game rules live here. All text comes
  from ../../i18n.
-->
<script lang="ts">
  import type { Guess, SitePage } from "@bt/core";
  import { onMount, tick } from "svelte";
  import { IMAGE_BASE, SITE_LABEL, SITE_URL, TURNSTILE_SITE_KEY } from "../../config";
  import { statLabel, t } from "../../i18n";
  import { FRIENDLY_PATH, isLegendsPath } from "../../lib/paths";
  import { TIER_COLOUR } from "../../lib/tiers";
  import { createApi } from "../../game/api";
  import type { Fetch } from "../../game/api";
  import { bestKey, browserStorage, readBest, saveBest } from "../../game/best";
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
  import type { FeedbackKind, ReportedRound } from "../../game/feedback";
  import { initialState, shouldSpin } from "../../game/machine";
  import { NO_NOTICE, TimedNotice } from "../../game/notice";
  import type { NoticeState } from "../../game/notice";
  import type { Challenge, GameState } from "../../game/machine";
  import { createPreloader } from "../../game/photos";
  import {
    challengeResult,
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
  import { createTurnstileLoader } from "../../game/turnstile";
  import type { ScriptDocument, Turnstile, TurnstileHost } from "../../game/turnstile";
  import {
    announcement,
    challengeNotice,
    hitchText,
    overCaption,
    qualifierText,
  } from "../../game/view";
  import TitleBar from "../TitleBar.svelte";
  import Counter from "./Counter.svelte";
  import FeedbackModal from "./FeedbackModal.svelte";
  import Figure from "./Figure.svelte";
  import Plaque from "./Plaque.svelte";
  import Side from "./Side.svelte";

  interface Props {
    /** The deck and mode being played, which name the local best (`bt:best:legends:friendly`). */
    deck: BestDeck;
    mode: "friendly";
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

  /** The open feedback form, if any; the round a report is about; the page a problem names. */
  let feedback = $state<FeedbackKind | null>(null);
  let feedbackReport = $state<ReportedRound | null>(null);
  let feedbackPage = $state<SitePage>(FRIENDLY_PATH);
  /** Where focus goes back to when the form closes. */
  let feedbackOpener: HTMLElement | null = null;
  let loadTurnstile = $state<(() => Promise<Turnstile>) | null>(null);

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
    loadTurnstile = createTurnstileLoader(
      document as unknown as ScriptDocument,
      window as unknown as TurnstileHost,
    );

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

    // A challenge link in the URL frames the first run; a plainly broken one
    // starts a fresh run with a note, as a forged one would.
    const param = readChallenge(location.search);
    const challenge: Challenge | null =
      param.kind === "link"
        ? { status: "offered", link: param.link }
        : param.kind === "broken"
          ? { status: "refused", reason: "invalid" }
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

    const key = bestKey(deck, mode);
    const c = new GameController({
      api: createApi(fetchFn),
      preload: createPreloader(IMAGE_BASE, () => new Image()),
      timings,
      now: () => performance.now(),
      schedule: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      reducedMotion: () => reducedMotion,
      best: readBest(browserStorage, key),
      saveBest: (best) => void saveBest(browserStorage, key, best),
      challenge,
    });
    const unsubscribe = c.subscribe((s) => (game = s));
    controller = c;

    return () => {
      document.removeEventListener("click", onLinkClick);
      window.removeEventListener("hashchange", onHashChange);
      removeDevPanel?.();
      unsubscribe();
      c.destroy();
      shareNotes.destroy();
      motion.removeEventListener("change", onMotion);
    };
  });

  const phase = $derived(game.phase);
  const round = $derived(game.round);
  const reveal = $derived(game.reveal);
  const anchorShown = $derived(
    phase === "awaiting" || phase === "revealing" || phase === "verdict" || phase === "over",
  );
  const judged = $derived((phase === "verdict" || phase === "over") && reveal !== null);
  const spinIndex = $derived(
    round !== null && shouldSpin(round) && phase !== "dealing" && phase !== "starting"
      ? round.index
      : null,
  );
  const tier = $derived(game.plaque?.tier ?? "basic");
  // A slow-down is a pause, not a wait on the network: the number rests at "?"
  // rather than scrambling until it's over.
  const resting = $derived(game.hitch?.kind === "slowDown");
  const newBest = $derived(game.streak > 0 && game.streak > game.bestBefore);
  const offered = $derived(game.challenge?.status === "offered" ? game.challenge.link : null);
  const notice = $derived(challengeNotice(game));
  const title = $derived(titleText(game.streak));
  const result = $derived(challengeResult(game));
  const cells = $derived(gridCells(game.history));
  const report = $derived(reportedRound(game));

  function start(): void {
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
    const text = shareText(game.streak, game.history, game.end, game.link, site());
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
      const blob = await renderShareImage(shareCard(game, SITE_LABEL));
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
    feedbackPage = page;
    feedback = kind;
  }

  function closeFeedback(): void {
    if (feedback === null) return;
    const back = feedbackOpener?.isConnected ? feedbackOpener : (againButton ?? startButton);
    feedback = null;
    feedbackOpener = null;
    void tick().then(() => back?.focus());
  }

  function pick(guess: Guess): void {
    controller?.guess(guess);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (phase !== "awaiting" || event.altKey || event.ctrlKey || event.metaKey) return;
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

<svelte:window onkeydown={onKeydown} />

<div class="game" style:--tier={TIER_COLOUR[tier]} inert={feedback !== null}>
  <TitleBar
    scores={{ streak: game.streak, best: game.best }}
    legends={isLegendsPath(path)}
    current={path}
  />

  <main class="pitch" aria-label={t("pitch.label")}>
    <Side
      side="a"
      player={round?.anchor ?? null}
      qualifier={anchorShown && round ? qualifierText(round.stat.key, round.anchor.qualifier) : ""}
    >
      {#snippet value()}
        {#if anchorShown && round}
          <Figure display={round.anchor.display} />
        {/if}
      {/snippet}
    </Side>

    <Side
      side="b"
      player={round?.challenger ?? null}
      verdict={judged && reveal ? (reveal.correct ? "hit" : "miss") : null}
      qualifier={judged && round && reveal ? qualifierText(round.stat.key, reveal.qualifier) : ""}
    >
      {#snippet value()}
        {#if phase === "revealing" && round && game.count && !resting}
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
      {#if round}
        <!-- One slot for Higher / Lower and the connection note, kept whether
             they show or not, so the text above never moves. -->
        <div class="slot">
          <div
            class="picks"
            role="group"
            aria-label={t("pick.group", { name: round.challenger.name })}
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
          <p class="hitch" role="status" class:empty={phase !== "revealing" || game.hitch === null}>
            {phase === "revealing" ? hitchText(game.hitch) : ""}
          </p>
        </div>
      {/if}
    </Side>

    <Plaque stat={game.plaque} {spinIndex} spinTo={round?.stat ?? null} {timings} {reducedMotion} />

    <p class="sr" aria-live="polite">{announcement(game)}</p>
    {#if phase !== "idle" && phase !== "starting"}
      <!-- The start panel's heading goes with it; the page keeps one. -->
      <h1 class="sr">{t("brand.heading")}</h1>
    {/if}

    <p class="notice" role="status" class:empty={notice === "" || phase === "idle"}>
      {phase === "idle" ? "" : notice}
    </p>

    {#if phase === "idle" || phase === "starting"}
      <div class="veil">
        <div class="panel">
          <h1>{t("brand.bigger")}<em>{t("brand.than")}</em></h1>
          <div class="sublegend">{t("brand.footballLegends")}</div>
          {#if offered}
            <p class="beat">{t("challenge.heading", { score: offered.score })}</p>
            <p>{t("challenge.intro", { score: offered.score })}</p>
          {:else}
            <p>{t("start.intro")}</p>
          {/if}
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
          {#if game.startFailed}
            <p class="problem" role="alert">{t("start.failed")}</p>
          {/if}
          <p class="problem" role="status" class:empty={!(phase === "starting" && resting)}>
            {phase === "starting" && resting ? t("start.slowDown") : ""}
          </p>
          <p class="problem" role="status" class:empty={notice === ""}>{notice}</p>
        </div>
      </div>
    {:else if phase === "over"}
      <div class="veil">
        <!-- Stacked; on a short landscape screen, the score beside the actions. -->
        <div class="panel over">
          <div class="scoreboard">
            <div class="final num">{game.streak}</div>
            <div class="finalcap">{overCaption(game.streak)}</div>
            {#if title}
              <div class="sublegend title">{title}</div>
            {/if}
            <div class="best">
              {newBest ? t("over.newBest") : t("over.best", { best: game.best })}
            </div>
            {#if result}
              <p class="outcome">{outcomeText(result.outcome, result.target)}</p>
            {/if}
            {#if cells.length > 0}
              <div class="grid" role="img" aria-label={gridLabel(game.history)}>
                {#each cells as cell, i (i)}
                  <span
                    class="cell"
                    class:miss={cell.kind === "miss"}
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
                {/if}
              </div>
            {:else if game.end === "network"}
              <div class="reason">
                <p class="note">{t("over.network", { streak: game.streak })}</p>
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
            </div>
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
     halves at rest and on the start and game-over panels. */
  .pitch {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    min-height: 0;
    background: var(--bg-grain), var(--bg-lights), var(--bg-vignette);
  }
  @media (min-width: 780px) {
    .pitch {
      flex-direction: row;
    }
  }
  /* A landscape phone: stacked halves would be two thin strips with the plaque
     across both, so they go side by side, and the plaque moves to the top. */
  @media (orientation: landscape) and (max-height: 500px) {
    .pitch {
      flex-direction: row;
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
  .hitch.empty,
  .problem.empty,
  .notice.empty {
    display: none;
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
  .panel h1 {
    font-size: var(--fs-display);
    line-height: var(--lh-display);
    font-variation-settings: var(--fv-display);
    letter-spacing: var(--tracking-display);
  }
  .panel h1 em {
    font-style: normal;
    color: var(--gold);
  }
  .sublegend {
    margin-top: 8px;
    font-family: var(--font-display);
    font-weight: var(--fw-sublegend);
    font-size: var(--fs-sublegend);
    letter-spacing: var(--tracking-sublegend);
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
  .finalcap,
  .best {
    margin-top: var(--over-cap-top);
    font-size: var(--fs-caption);
    color: var(--dim);
    font-variation-settings: var(--fv-caption);
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
