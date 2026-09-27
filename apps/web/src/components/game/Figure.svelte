<!--
  A card's number, with its unit set smaller, or the "?" of a hidden value.
  Digits are tabular (`.num`), so a figure's width doesn't change as they do. With
  `reserve` (the count-up's final figure) the box is sized for that instead,
  with the number centred in it, where the 0 it counts from already sat, so
  nothing clips and the count starts without a jump.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import { splitDisplay } from "../../game/counter";

  interface Props {
    /** The formatted figure; null for a value the player hasn't seen. */
    display: string | null;
    /** The figure this one is counting towards, which sizes the box. */
    reserve?: string | undefined;
  }

  let { display, reserve }: Props = $props();

  const parts = $derived(display === null ? null : splitDisplay(display));
  const ghost = $derived(reserve === undefined ? null : splitDisplay(reserve));
</script>

{#if parts === null}
  <div class="unknown num">{t("card.unknown")}</div>
{:else}
  <div class="fig num" class:reserved={ghost !== null}>
    {#if ghost}
      <span class="ghost" aria-hidden="true"
        >{ghost.main}{#if ghost.suffix}<span class="suffix">{ghost.suffix}</span>{/if}</span
      >
    {/if}
    <span
      >{parts.main}{#if parts.suffix}<span class="suffix">{parts.suffix}</span>{/if}</span
    >
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
  /* The final figure, unseen, sets the width; the live one sits on top of it. */
  .reserved {
    display: grid;
    justify-items: center;
  }
  .reserved > span {
    grid-area: 1 / 1;
  }
  .ghost {
    visibility: hidden;
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
