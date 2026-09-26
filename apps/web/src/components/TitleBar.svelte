<!--
  The persistent title bar (DESIGN.md §12). Static pages render it server-side
  with no JS; the game island reuses it with live scores.
-->
<script lang="ts">
  import { t } from "../i18n";

  interface Props {
    /** Streak and best. Shown on the game only; other pages have no run. */
    scores?: { streak: number; best: number };
    /** Make the title a link to the game. Off on the game itself. */
    home?: boolean;
  }

  let { scores, home = false }: Props = $props();
</script>

<header class="topbar">
  <svelte:element this={home ? "a" : "div"} class="title" href={home ? "/" : undefined}>
    <span class="bt">{t("brand.bigger")}<em>{t("brand.than")}</em> {t("brand.game")}</span>
    <span class="dash">—</span>
    <span class="fl">{t("brand.football")} <span class="legends">{t("brand.legends")}</span></span>
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
    display: flex;
    align-items: baseline;
    gap: 9px;
    flex-wrap: wrap;
    line-height: var(--lh-tight);
    color: inherit;
    text-decoration: none;
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
