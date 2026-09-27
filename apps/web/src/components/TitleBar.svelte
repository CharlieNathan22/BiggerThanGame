<!--
  The persistent title bar (DESIGN.md §12). Static pages render it server-side
  with no JS; the game island reuses it with live scores. "— Football Legends"
  shows only on the Legends pages (`legends`); elsewhere it is the brand alone
  (DESIGN.md §17).
-->
<script lang="ts">
  import { t } from "../i18n";
  import { HOME_PATH } from "../lib/paths";

  interface Props {
    /** Streak and best. Shown on the game only; other pages have no run. */
    scores?: { streak: number; best: number };
    /** Make the title a link to the homepage. Off on the homepage itself. */
    home?: boolean;
    /** Add "— Football Legends": /football-higher-or-lower/legends and the pages under it. */
    legends?: boolean;
  }

  let { scores, home = false, legends = false }: Props = $props();
</script>

<header class="topbar">
  <svelte:element this={home ? "a" : "div"} class="title" href={home ? HOME_PATH : undefined}>
    <span class="bt">{t("brand.bigger")}<em>{t("brand.than")}</em> {t("brand.game")}</span>
    {#if legends}
      <span class="dash">—</span>
      <span class="fl">{t("brand.football")} <span class="legends">{t("brand.legends")}</span></span
      >
    {/if}
  </svelte:element>
  {#if scores}
    <div class="scores">
      <div class="score">
        <span>{t("scores.streak")}</span><strong class="num">{scores.streak}</strong>
      </div>
      <div class="score">
        <span>{t("scores.best")}</span><strong class="num">{scores.best}</strong>
      </div>
    </div>
  {/if}
</header>

<style>
  .topbar {
    flex: none;
    background: var(--ink);
    border-bottom: var(--border) solid var(--gold-rule);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 9px 16px;
    flex-wrap: wrap;
  }
  .title {
    position: relative;
    display: flex;
    align-items: baseline;
    gap: 9px;
    flex-wrap: wrap;
    /* As tall as the "Legends" line, so the bar keeps its height on pages
       without it. */
    min-height: var(--fs-legends);
    align-content: center;
    line-height: var(--lh-tight);
    color: inherit;
    text-decoration: none;
  }
  /* As a link, a 44px touch target however small the type. */
  a.title::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    min-height: var(--target-min);
    height: 100%;
    transform: translateY(-50%);
  }
  .bt {
    font-size: var(--fs-brand);
    font-variation-settings: var(--fv-brand);
    letter-spacing: var(--tracking-brand);
  }
  .bt em {
    font-style: normal;
    color: var(--gold);
  }
  .dash {
    color: var(--faint);
    font-size: var(--fs-dash);
  }
  .fl {
    font-size: var(--fs-sub);
    color: var(--dim);
    font-variation-settings: var(--fv-sub);
    display: flex;
    align-items: baseline;
    gap: 7px;
  }
  .legends {
    font-family: var(--font-display);
    font-weight: var(--fw-legends);
    font-style: normal;
    font-size: var(--fs-legends);
    letter-spacing: var(--tracking-legends);
    background: var(--legends-gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: var(--legends-shadow);
  }
  .scores {
    display: flex;
    gap: 18px;
    align-items: baseline;
    margin-left: auto;
  }
  .score {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .score span {
    font-size: var(--fs-score-label);
    color: var(--dim);
    font-variation-settings: var(--fv-label);
  }
  .score strong {
    font-size: var(--fs-score);
  }
</style>
