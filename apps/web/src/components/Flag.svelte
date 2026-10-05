<!--
  A country's round flag (circle-flags, ../game/flags.ts): about 1.1em, sized
  before it loads so nothing moves, named by the country for screen readers.
  Nothing for a null country, or, with `keep`, an empty space the flag's size,
  so names in a column line up. `lazy` for flags off the first page.
-->
<script lang="ts">
  import { countryName, flagSrc } from "../game/flags";

  interface Props {
    country: string | null;
    lazy?: boolean;
    /** Keep the flag's space when there's no flag. */
    keep?: boolean;
  }

  let { country, lazy = false, keep = false }: Props = $props();
</script>

{#if country !== null}
  <img
    class="flag"
    src={flagSrc(country)}
    alt={countryName(country)}
    width="16"
    height="16"
    loading={lazy ? "lazy" : "eager"}
    decoding="async"
  />
{:else if keep}
  <span class="flag" aria-hidden="true"></span>
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
  /* The flag itself glows gold, as the site's gold things do; its empty space doesn't. */
  img.flag {
    box-shadow: var(--flag-glow);
  }
</style>
