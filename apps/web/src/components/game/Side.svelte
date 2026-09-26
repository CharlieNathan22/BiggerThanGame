<!--
  One full-bleed half of the pitch: a player's monogram, name, country and
  figure. Photos arrive in M4; for now every card is the monogram treatment.
-->
<script lang="ts">
  import type { PlayerCard } from "@bt/core";
  import type { Snippet } from "svelte";
  import { initial } from "../../game/view";

  interface Props {
    side: "a" | "b";
    player: PlayerCard | null;
    /** The verdict colour, on the challenger's half only. */
    verdict?: "hit" | "miss" | null;
    /** The small print under the figure. */
    qualifier?: string;
    /** The figure: a number, a count-up or the "?". */
    value?: Snippet;
    /** Anything below the figure — the challenger's Higher / Lower. */
    children?: Snippet;
  }

  let { side, player, verdict = null, qualifier = "", value, children }: Props = $props();
</script>

<div class="side {side}" class:hit={verdict === "hit"} class:miss={verdict === "miss"}>
  {#if player}
    <div class="monogram" aria-hidden="true">{initial(player.name)}</div>
    <div class="who">
      <div class="name">{player.name}</div>
      <div class="meta">{player.country}</div>
    </div>
    <div class="value">
      {@render value?.()}
      <div class="qual">{qualifier}</div>
    </div>
    {@render children?.()}
  {/if}
</div>

<style>
  .side {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px 20px;
    text-align: center;
    transition: background-color var(--dur-side) var(--ease);
  }
  .side.a {
    background: var(--night);
  }
  .side.b {
    background: var(--night-2);
  }
  .side.hit {
    background: var(--hit);
  }
  .side.miss {
    background: var(--miss);
  }
  .monogram {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: var(--fs-monogram);
    color: var(--monogram);
    pointer-events: none;
    user-select: none;
    line-height: var(--lh-tight);
  }
  .who {
    position: relative;
    max-width: var(--who-w);
  }
  .name {
    font-size: var(--fs-name);
    line-height: var(--lh-name);
    font-variation-settings: var(--fv-name);
    letter-spacing: var(--tracking-name);
  }
  .meta {
    margin-top: 6px;
    font-size: var(--fs-meta);
    color: var(--dim);
    font-variation-settings: var(--fv-meta);
  }
  .value {
    position: relative;
    margin-top: 14px;
    min-height: var(--value-min-h);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .qual {
    margin-top: 5px;
    font-size: var(--fs-qual);
    color: var(--dim);
    font-variation-settings: var(--fv-caption);
  }
</style>
