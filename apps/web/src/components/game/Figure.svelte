<!--
  A card's number, with its unit set smaller, or the "?" of a hidden value.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import { splitDisplay } from "../../game/counter";

  interface Props {
    /** The formatted figure; null for a value the player hasn't seen. */
    display: string | null;
  }

  let { display }: Props = $props();

  const parts = $derived(display === null ? null : splitDisplay(display));
</script>

{#if parts === null}
  <div class="unknown num">{t("card.unknown")}</div>
{:else}
  <div class="fig num">
    {parts.main}{#if parts.suffix}<span class="suffix">{parts.suffix}</span>{/if}
  </div>
{/if}

<style>
  .fig,
  .unknown {
    font-size: var(--fs-fig);
    line-height: var(--lh-tight);
  }
  .fig {
    color: var(--tier);
    transition: color var(--dur-tint) var(--ease);
  }
  .unknown {
    color: var(--unknown);
    font-variation-settings: var(--fv-num);
  }
  .suffix {
    font-size: var(--fs-suffix);
    margin-left: 0.1em;
    font-variation-settings: var(--fv-suffix);
  }
</style>
