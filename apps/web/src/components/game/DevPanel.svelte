<!--
  `pnpm dev` only: the artificial round-trip delay switch, the a11y check and
  the autopilot that answers every question right (to see the win). Loaded by
  game/dev.ts behind import.meta.env.DEV, so production builds never contain
  it. Developer-facing, so its labels aren't in i18n/en.ts.
-->
<script lang="ts">
  import {
    DEV_DELAYS,
    devAutopilot,
    devDelay,
    runAxe,
    setDevAutopilot,
    setDevDelay,
  } from "../../game/dev";
  import type { DevDelay } from "../../game/dev";

  let current: DevDelay = $state(devDelay());

  let axe = $state("a11y");
  let auto = $state(devAutopilot());

  function toggleAuto(): void {
    auto = !auto;
    setDevAutopilot(auto);
  }

  function choose(ms: DevDelay): void {
    current = ms;
    setDevDelay(ms);
  }

  async function check(): Promise<void> {
    axe = "…";
    const findings = await runAxe();
    axe = `a11y ${findings.length}`;
  }
</script>

<aside class="dev" aria-label="Dev: round-trip delay, a11y check and autopilot">
  <span>delay</span>
  {#each DEV_DELAYS as ms (ms)}
    <button aria-pressed={current === ms} onclick={() => choose(ms)}>
      {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
    </button>
  {/each}
  <button onclick={check} title="Run axe-core; results in the console">{axe}</button>
  <button aria-pressed={auto} onclick={toggleAuto} title="Answer every question right">auto</button>
</aside>

<style>
  /* Deliberately plain and off to one side: this is scaffolding, not design. */
  .dev {
    position: fixed;
    left: 8px;
    bottom: 8px;
    z-index: 100;
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 4px 6px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    font:
      11px/1 ui-monospace,
      monospace;
  }
  button {
    padding: 3px 5px;
    border: 1px solid #666;
    border-radius: 4px;
    font: inherit;
  }
  button[aria-pressed="true"] {
    background: #fff;
    color: #000;
  }
</style>
