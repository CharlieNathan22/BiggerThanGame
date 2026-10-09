<!--
  Twitch Mode's chat status, always on screen during setup and play:
  connecting, "Connected to #name", a drop and the reconnect, or why it can't
  connect at all, with Retry whenever chat isn't connected. A polite live
  region, so the changes are heard; the dot is decoration beside the words.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import type { ChatStatus } from "../../game/stream/chat-source";
  import { statusText, statusTone } from "../../game/stream/view";

  interface Props {
    status: ChatStatus;
    /** Connects again, now. */
    onretry: () => void;
    /** Smaller, for the strip over the pitch. */
    compact?: boolean;
  }

  let { status, onretry, compact = false }: Props = $props();
  const tone = $derived(statusTone(status));
  const retry = $derived(status.kind === "reconnecting" || status.kind === "failed");
</script>

<div class="status {tone}" class:compact>
  <span class="dot" aria-hidden="true"></span>
  <p class="words" role="status">{statusText(status)}</p>
  {#if retry}
    <button type="button" class="retry" onclick={onretry}>{t("stream.status.retry")}</button>
  {/if}
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    font-size: var(--fs-stream-status);
    color: var(--chalk);
  }
  .words {
    margin: 0;
    min-width: 0;
  }
  .dot {
    flex: none;
    width: 0.7em;
    height: 0.7em;
    border-radius: 50%;
    background: var(--faint);
  }
  .ok .dot {
    background: var(--stream-status-ok);
    box-shadow: 0 0 8px var(--stream-status-ok);
  }
  .busy .dot {
    background: var(--stream-status-warn);
  }
  .bad .dot {
    background: var(--stream-status-bad);
  }
  .bad .words {
    color: var(--stream-status-bad);
  }
  .retry {
    min-height: var(--target-min);
    padding: 0 var(--btn2-pad-x);
    border: var(--btn2-border) solid var(--btn2-edge);
    border-radius: var(--radius-pill);
    background: var(--btn2-bg);
    color: var(--btn2-text);
    font: inherit;
    font-variation-settings: var(--fv-caps);
    cursor: pointer;
    text-shadow: var(--glow);
  }
  .retry:hover,
  .retry:focus-visible {
    background: var(--btn2-bg-hover);
    box-shadow: var(--glow-hover);
  }
</style>
