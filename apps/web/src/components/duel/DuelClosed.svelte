<!--
  A 1v1 room that has gone: expired, unknown, closed by its host, or open in
  another tab. One line saying which, and a button to make a new one.
-->
<script lang="ts">
  import { t } from "../../i18n";

  interface Props {
    /** Why, in words. */
    message: string;
    oncreate: () => void;
    button?: HTMLButtonElement | undefined;
  }

  let { message, oncreate, button = $bindable() }: Props = $props();
</script>

<div class="closed">
  <h1 class="title">{t("duel.subtitle")}</h1>
  <p class="message" role="alert">{message}</p>
  <button class="cta" bind:this={button} onclick={oncreate}>{t("duel.closed.create")}</button>
</div>

<style>
  .closed {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--stream-head-gap);
    width: var(--duel-panel-w);
    margin: 0 auto;
    padding: var(--stream-panel-pad);
    border: 1px solid var(--card-edge);
    border-radius: var(--card-radius);
    background: var(--card-surface);
    box-shadow: var(--card-shadow);
    color: var(--chalk);
    text-align: center;
  }
  .title {
    margin: 0;
    font-size: var(--fs-stream-score);
    font-variation-settings: var(--fv-caps);
    line-height: 1.05;
    color: var(--gold);
    text-shadow: var(--glow);
  }
  .message {
    margin: 0;
    font-size: var(--fs-stream-hint);
  }
  .cta {
    width: min(var(--stream-start-w), 100%);
    min-height: var(--stream-start-h);
    padding: 0 var(--start-cta-pad-x);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--gold);
    color: var(--ink);
    font: inherit;
    font-size: var(--fs-stream-start);
    font-variation-settings: var(--fv-caps);
    box-shadow: var(--glow);
    cursor: pointer;
  }
  .cta:hover,
  .cta:focus-visible {
    box-shadow: var(--glow-hover);
  }
  .cta:focus-visible {
    outline: 2px solid var(--chalk);
    outline-offset: 3px;
  }
</style>
