<!--
  A country's round flag (circle-flags, ../game/flags.ts): about 1.1em, sized
  before it loads so nothing moves, named by the country for screen readers.
  Nothing for a null country, or, with `unknown` (the boards), an original
  "?" in a circle the flag's size, shape and glow, its fill muted, named
  "Country not shown", so names in a column line up and every entry has a mark.
  `lazy` for flags off the first page.
-->
<script lang="ts">
  import { flagMark } from "../game/flags";

  interface Props {
    country: string | null;
    lazy?: boolean;
    /** With no country, the "?" mark in the flag's place rather than nothing. */
    unknown?: boolean;
  }

  let { country, lazy = false, unknown = false }: Props = $props();

  const mark = $derived(flagMark(country));
</script>

{#if mark.kind === "flag"}
  <img
    class="flag"
    src={mark.src}
    alt={mark.name}
    width="16"
    height="16"
    loading={lazy ? "lazy" : "eager"}
    decoding="async"
  />
{:else if unknown}
  <svg
    class="flag unknown"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    role="img"
    aria-label={mark.name}
    focusable="false"
  >
    <circle class="disc" cx="8" cy="8" r="8" />
    <path class="hook" d="M5.7 6.1a2.3 2.3 0 1 1 3.5 2c-.8.5-1.2 1-1.2 1.9" />
    <circle class="dot" cx="8" cy="12.4" r="1" />
  </svg>
{/if}

<style>
  .flag {
    flex: none;
    display: inline-block;
    width: var(--flag-size);
    height: var(--flag-size);
    border-radius: 50%;
    vertical-align: var(--flag-align);
  }
  /* Every mark in a flag's place glows gold, as the site's gold things do. */
  img.flag,
  svg.flag {
    box-shadow: var(--flag-glow);
  }
  /* "Unknown", not a flag: a muted disc, the "?" in the dim text colour. */
  .disc {
    fill: var(--flag-unknown-fill);
  }
  .hook {
    fill: none;
    stroke: var(--flag-unknown-ink);
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dot {
    fill: var(--flag-unknown-ink);
  }
</style>
