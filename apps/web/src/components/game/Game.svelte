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
  import { FRIENDLY_PATH } from "../../lib/paths";
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
    /** Show "Legends" in the title bar: the page is under /football-higher-or-lower/legends. */
    legends?: boolean;
  }

  let { deck, mode, legends = false }: Props = $props();

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
  let shareStatus = $state("");
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
    shareStatus = "";
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
    shareStatus = "";
    const outcome = await shareResultText(text, platform);
    copyByHand = outcome === "failed" ? text : null;
    shareStatus =
      outcome === "copied" ? t("over.copied") : outcome === "failed" ? t("over.copyFailed") : "";
  }

  async function onShareImage(): Promise<void> {
    if (platform === null || drawing) return;
    drawing = true;
    shareStatus = "";
    try {
      const blob = await renderShareImage(shareCard(game, SITE_LABEL));
      const name = t("share.fileName", { score: game.streak });
      const outcome = await shareResultImage(blob, name, platform);
      shareStatus =
        outcome === "saved"
          ? t("over.imageSaved")
          : outcome === "failed"
            ? t("over.imageFailed")
            : "";
    } catch {
      shareStatus = t("over.imageFailed");
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
  <TitleBar scores={{ streak: game.streak, best: game.best }} {legends} home />

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
            anchorValue={round.anchor.value}
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
        <div
          class="picks"
          role="group"
          aria-label={t("pick.group", { name: round.challenger.name })}
          hidden={phase !== "awaiting"}
        >
          <button class="pick" bind:this={higherButton} onclick={() => pick("higher")}>
            {t("pick.higher")}
          </button>
          <button class="pick" onclick={() => pick("lower")}>{t("pick.lower")}</button>
        </div>
        <p class="hitch" role="status" class:empty={phase !== "revealing" || game.hitch === null}>
          {phase === "revealing" ? hitchText(game.hitch) : ""}
        </p>
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
        <div class="panel">
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
          <div class="shares">
            <button class="ghost" onclick={onShareText}>{t("over.share")}</button>
            <button class="ghost" onclick={onShareImage} disabled={drawing} aria-busy={drawing}>
              {platform?.touch ? t("over.shareImage") : t("over.saveImage")}
            </button>
          </div>
          <p class="status" role="status">{shareStatus}</p>
          {#if copyByHand !== null}
            <textarea class="copy" readonly rows="6" aria-label={t("over.shareText")}
              >{copyByHand}</textarea
            >
          {/if}
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
  }

  .pitch {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    min-height: 0;
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

  .picks {
    position: relative;
    margin-top: 16px;
    display: flex;
    gap: 10px;
  }
  .picks[hidden] {
    display: none;
  }
  .hitch {
    position: relative;
    margin-top: 16px;
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
    min-width: var(--pick-min-w);
    min-height: var(--target-min);
    padding: 11px 20px;
    border: var(--border-pick) solid var(--chalk);
    border-radius: var(--radius-pill);
    background: var(--pick-bg);
    font-size: var(--fs-pick);
    font-variation-settings: var(--fv-button);
    transition:
      background-color var(--dur-hover),
      color var(--dur-hover),
      transform var(--dur-press);
  }
  .pick:hover {
    background: var(--chalk);
    color: var(--night);
  }
  .pick:active {
    transform: scale(var(--press-scale));
  }
  .pick:focus-visible {
    outline: var(--focus-ring) solid var(--tier);
    outline-offset: var(--focus-offset);
  }

  .veil {
    position: absolute;
    inset: 0;
    z-index: 9;
    display: flex;
    background: var(--veil);
    padding: 26px;
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
    margin-top: 20px;
    padding: 14px 34px;
    border-radius: var(--radius-pill);
    background: var(--gold);
    color: var(--ink);
    font-size: var(--fs-cta);
    font-variation-settings: var(--fv-cta);
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
  }
  .shares .ghost,
  .feedback .ghost {
    min-height: var(--target-min);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .shares {
    margin-top: 4px;
    display: flex;
    gap: 10px;
  }
  .shares .ghost {
    margin-top: 0;
    flex: 1;
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
  .panel .status {
    margin-top: 0;
    min-height: 1.4em;
    font-size: var(--fs-lab);
    color: var(--chalk);
    font-variation-settings: var(--fv-caption);
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
    margin-top: 10px;
  }
  .panel .outcome {
    margin-top: 10px;
    font-size: var(--fs-caption);
    color: var(--chalk);
    font-variation-settings: var(--fv-caption);
  }
  .grid {
    margin: 14px auto 0;
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
    margin-top: 5px;
    font-size: var(--fs-caption);
    color: var(--dim);
    font-variation-settings: var(--fv-caption);
  }
  .reason {
    margin-top: 18px;
    padding-top: 16px;
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
</style>
