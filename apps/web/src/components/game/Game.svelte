<!--
  The game island (client:load). Renders `GameState` from the controller and
  forwards the player's input to it; no game rules live here. All text comes
  from ../../i18n.
-->
<script lang="ts">
  import type { Guess } from "@bt/core";
  import { onMount, tick } from "svelte";
  import { CORRECTIONS_EMAIL, IMAGE_BASE } from "../../config";
  import { statLabel, t } from "../../i18n";
  import { TIER_COLOUR } from "../../lib/tiers";
  import { createApi } from "../../game/api";
  import type { Fetch } from "../../game/api";
  import { GameController } from "../../game/controller";
  import { initialState, shouldSpin } from "../../game/machine";
  import type { GameState } from "../../game/machine";
  import { createPreloader } from "../../game/photos";
  import { TIMINGS, readTimings } from "../../game/timing";
  import type { Timings } from "../../game/timing";
  import { announcement, hitchText, overCaption, qualifierText, reportHref } from "../../game/view";
  import TitleBar from "../TitleBar.svelte";
  import Counter from "./Counter.svelte";
  import Figure from "./Figure.svelte";
  import Plaque from "./Plaque.svelte";
  import Side from "./Side.svelte";

  let game: GameState = $state(initialState());
  let controller: GameController | null = $state(null);
  let timings: Timings = $state(TIMINGS);
  let reducedMotion = $state(false);

  let higherButton: HTMLButtonElement | undefined = $state();
  let againButton: HTMLButtonElement | undefined = $state();

  onMount(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = motion.matches;
    const onMotion = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
    motion.addEventListener("change", onMotion);

    const root = getComputedStyle(document.documentElement);
    timings = readTimings((property) => root.getPropertyValue(property));

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
    });
    const unsubscribe = c.subscribe((s) => (game = s));
    controller = c;

    return () => {
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

  function start(): void {
    controller?.start();
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

<div class="game" style:--tier={TIER_COLOUR[tier]}>
  <TitleBar scores={{ streak: game.streak, best: game.best }} />

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
        <p class="hitch" role="status" hidden={phase !== "revealing" || game.hitch === null}>
          {phase === "revealing" ? hitchText(game.hitch) : ""}
        </p>
      {/if}
    </Side>

    <Plaque stat={game.plaque} {spinIndex} spinTo={round?.stat ?? null} {timings} {reducedMotion} />

    <p class="sr" aria-live="polite">{announcement(game)}</p>

    {#if phase === "idle" || phase === "starting"}
      <div class="veil">
        <div class="panel">
          <h1>{t("brand.bigger")}<em>{t("brand.than")}</em></h1>
          <div class="sublegend">{t("brand.footballLegends")}</div>
          <p>{t("start.intro")}</p>
          <button
            class="cta"
            disabled={controller === null || phase === "starting"}
            onclick={start}
          >
            {phase === "starting" ? t("start.starting") : t("start.cta")}
          </button>
          {#if game.startFailed}
            <p class="problem" role="alert">{t("start.failed")}</p>
          {/if}
          <p class="problem" role="status" hidden={!(phase === "starting" && resting)}>
            {phase === "starting" && resting ? t("start.slowDown") : ""}
          </p>
        </div>
      </div>
    {:else if phase === "over"}
      <div class="veil">
        <div class="panel">
          <div class="final num">{game.streak}</div>
          <div class="finalcap">{overCaption(game.streak)}</div>
          <div class="best">
            {newBest ? t("over.newBest") : t("over.best", { best: game.best })}
          </div>
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
          {#if round && reveal}
            <a class="ghost" href={reportHref(CORRECTIONS_EMAIL, round, reveal)}>
              {t("over.report")}
            </a>
            <div class="email">{t("over.reportEmail", { email: CORRECTIONS_EMAIL })}</div>
          {/if}
        </div>
      </div>
    {/if}
  </main>
</div>

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
  .hitch[hidden],
  .problem[hidden] {
    display: none;
  }
  .pick {
    min-width: var(--pick-min-w);
    padding: 11px 20px;
    border: var(--border-pick) solid var(--chalk);
    border-radius: var(--radius-pill);
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
    align-items: center;
    justify-content: center;
    background: var(--veil);
    padding: 26px;
  }
  .panel {
    max-width: var(--panel-w);
    text-align: center;
    width: 100%;
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
  .ghost:focus-visible {
    outline: var(--focus-ring-thin) solid var(--gold);
    outline-offset: var(--focus-offset);
  }
  .email {
    margin-top: 4px;
    font-size: var(--fs-lab);
    color: var(--faint);
    font-variation-settings: var(--fv-meta);
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
