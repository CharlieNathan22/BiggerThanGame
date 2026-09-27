<!--
  The persistent title bar (DESIGN.md §12). Static pages render it server-side
  with no JS; the game island reuses it with live scores: "Streak n", or in a
  mode with a win target the score out of it, "n / 20", and "Best n/20". "— Football Legends"
  shows only on the Legends pages (`legends`); elsewhere it is the brand alone
  (DESIGN.md §17), and so is a short landscape screen, where the bar must stay
  one row.

  Site navigation: the brand links home, then Play (the Legends page, marked
  current across the football pages), How to play and About.
  Desktop shows them inline. Phones and short landscape screens get a "Menu"
  built on <details>/<summary>, so it opens with no JS and from the keyboard.
  Esc and a click outside close it: here on the game page, where the island
  hydrates the bar, and through a small inline script in Page.astro on the
  static pages, which find it by `data-menu`.
  It sits on the bar's existing rows and opens as an overlay, so the game's
  fixed-height screen loses nothing. Only one of the two lists is displayed.
-->
<script lang="ts">
  import { t } from "../i18n";
  import { NAV_LINKS, currentPage, type NavLink } from "../lib/nav";
  import { HOME_PATH } from "../lib/paths";

  interface Props {
    /**
     * Streak and best. Shown on the game only; other pages have no run.
     * `target` is the mode's win target (Friendly's 20), or null for none.
     * `rising`: the run is past the previous best, so Best is counting with
     * the streak, and glows gold.
     */
    scores?: { streak: number; best: number; target: number | null; rising?: boolean };
    /** Add "— Football Legends": /football-higher-or-lower/legends and the pages under it. */
    legends?: boolean;
    /** The page being shown, as served (`/about`), for `aria-current`. */
    current?: string;
    /** Stays at the top of the screen as the page scrolls (About, Credits). */
    sticky?: boolean;
  }

  let { scores, legends = false, current, sticky = false }: Props = $props();

  /** A nav link's `aria-current` on this page. */
  function marked(link: NavLink): "page" | "true" | undefined {
    return currentPage(link.href, current, link.section);
  }

  // The element's own `open` is the state, never a binding: hydration would
  // otherwise close a menu opened before the island loaded.
  let menu: HTMLDetailsElement | undefined = $state();

  /** Esc closes the menu; focus goes back to "Menu" if it was inside. */
  function onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !menu?.open) return;
    const inside = menu.contains(document.activeElement);
    menu.open = false;
    if (inside) menu.querySelector("summary")?.focus();
  }

  function onDocumentClick(event: MouseEvent): void {
    if (!menu?.open || !(event.target instanceof Node) || menu.contains(event.target)) return;
    menu.open = false;
  }
</script>

<svelte:document onclick={onDocumentClick} onkeydown={onDocumentKeydown} />

<header class="topbar" class:sticky>
  <a class="title" href={HOME_PATH} aria-current={currentPage(HOME_PATH, current)}>
    <span class="bt">{t("brand.bigger")}<em>{t("brand.than")}</em> {t("brand.game")}</span>
    {#if legends}
      <span class="dash">—</span>
      <span class="fl">{t("brand.football")} <span class="legends">{t("brand.legends")}</span></span
      >
    {/if}
  </a>
  <div class="end">
    {#if scores}
      <div class="scores">
        {#if scores.target === null}
          <div class="score">
            <span>{t("scores.streak")}</span><strong class="num">{scores.streak}</strong>
          </div>
          <div class="score" class:rising={scores.rising}>
            <span>{t("scores.best")}</span><strong class="num">{scores.best}</strong>
          </div>
        {:else}
          <div class="score">
            <span class="sr">{t("scores.score")}</span><strong class="num"
              >{t("scores.of", { score: scores.streak, target: scores.target })}</strong
            >
          </div>
          <div class="score" class:rising={scores.rising}>
            <span>{t("scores.best")}</span><strong class="num"
              >{t("score.of", { score: scores.best, target: scores.target })}</strong
            >
          </div>
        {/if}
      </div>
    {/if}
    <nav class="links" aria-label={t("nav.label")}>
      <ul>
        {#each NAV_LINKS as link (link.href)}
          <li>
            <a href={link.href} aria-current={marked(link)}>{t(link.label)}</a>
          </li>
        {/each}
      </ul>
    </nav>
    <details class="menu" data-menu bind:this={menu}>
      <summary>{t("nav.menu")}</summary>
      <nav class="sheet" aria-label={t("nav.label")}>
        <ul>
          {#each NAV_LINKS as link (link.href)}
            <li>
              <a href={link.href} aria-current={marked(link)}>{t(link.label)}</a>
            </li>
          {/each}
        </ul>
      </nav>
    </details>
  </div>
</header>

<style>
  .topbar {
    /* The menu's sheet hangs from the bar, over the page, above the game's veil. */
    position: relative;
    z-index: var(--z-topbar);
    flex: none;
    /* A raised surface: lighter than the page, a gold hairline and a shadow
       on the edge that faces it. */
    background: var(--bar-bg);
    border-bottom: var(--border) solid var(--chrome-rule);
    box-shadow: var(--bar-shadow);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: var(--bar-pad-y) var(--bar-pad-x);
    flex-wrap: wrap;
    /* Chrome, not content: nothing here selects, and a tap doesn't flash. */
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  /* The long pages keep the bar at the top as they scroll; the page's frame
     clips without making a scroll container, so it sticks to the screen. */
  .topbar.sticky {
    position: sticky;
    top: 0;
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
  /* A 44px touch target however small the type. */
  .title::after {
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
  /* The gold glow, grown on hover, press and keyboard focus. "Legends" is
     gradient-clipped text, which a text-shadow would paint over, so it glows
     through a filter. */
  .bt,
  .fl {
    text-shadow: var(--glow);
    transition: text-shadow var(--dur-hover);
  }
  .title:hover :is(.bt, .fl),
  .title:active :is(.bt, .fl),
  .title:focus-visible :is(.bt, .fl) {
    text-shadow: var(--glow-hover);
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
    text-shadow: none;
    filter: var(--legends-shadow) var(--glow-filter);
    transition: filter var(--dur-hover);
  }
  .title:hover .legends,
  .title:active .legends,
  .title:focus-visible .legends {
    filter: var(--legends-shadow) var(--glow-hover-filter);
  }
  /* Scores and navigation, at the end of the bar; on a narrow screen they wrap
     to a second row together, where the scores already sat. */
  .end {
    display: flex;
    align-items: center;
    gap: var(--nav-gap);
    margin-left: auto;
  }
  .scores {
    display: flex;
    gap: 18px;
    align-items: baseline;
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
    transition:
      color var(--dur-tint) var(--ease),
      text-shadow var(--dur-tint) var(--ease);
  }
  /* On a new best, mid-run: Best turns gold and glows as it counts. */
  .score.rising strong {
    color: var(--best-rising-colour);
    text-shadow: var(--best-rising-glow);
  }

  ul {
    list-style: none;
  }
  /* No underlines: the current page is gold, and hover, press and keyboard
     focus turn a link gold with a stronger glow. */
  nav a {
    position: relative;
    color: var(--dim);
    text-decoration: none;
    text-shadow: var(--glow);
    transition:
      color var(--dur-hover),
      text-shadow var(--dur-hover);
  }
  nav a[aria-current] {
    color: var(--gold);
  }
  nav a:hover,
  nav a:active,
  nav a:focus-visible {
    color: var(--gold);
    text-shadow: var(--glow-strong);
  }

  /* Desktop: the links inline. */
  .links {
    display: none;
  }
  .links ul {
    display: flex;
    gap: var(--nav-gap);
  }
  .links a {
    font-size: var(--fs-nav);
    font-variation-settings: var(--fv-nav);
  }
  .links a::after {
    content: "";
    position: absolute;
    left: -6px;
    right: -6px;
    top: 50%;
    height: var(--target-min);
    transform: translateY(-50%);
  }

  /* Phones: "Menu". Its padding overflows into the bar's own, so it adds no
     height to the row it sits on: the game keeps every pixel it had. */
  summary {
    position: relative;
    display: block;
    padding: var(--menu-pad-y) var(--menu-pad-x);
    margin-block: calc(-1 * var(--menu-pad-y));
    border: var(--border) solid var(--menu-edge);
    border-radius: var(--radius-pill);
    font-size: var(--fs-menu);
    line-height: var(--lh-tight);
    font-variation-settings: var(--fv-nav);
    color: var(--chalk);
    cursor: pointer;
    list-style: none;
    text-shadow: var(--glow);
    box-shadow: var(--glow);
    transition:
      text-shadow var(--dur-hover),
      box-shadow var(--dur-hover);
  }
  summary:hover,
  summary:active,
  summary:focus-visible {
    text-shadow: var(--glow-hover);
    box-shadow: var(--glow-hover);
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::after {
    content: "";
    position: absolute;
    left: -8px;
    right: -8px;
    top: 50%;
    height: var(--target-min);
    transform: translateY(-50%);
  }
  .menu[open] summary {
    background: var(--menu-open-bg);
  }
  /* The open list covers the page below the bar rather than pushing it down. */
  .sheet {
    position: absolute;
    top: calc(100% + var(--border));
    left: 0;
    right: 0;
    padding: var(--menu-sheet-pad);
    background: var(--menu-bg);
    border-bottom: var(--border) solid var(--gold-rule);
    box-shadow: var(--shadow-menu);
  }
  .sheet a {
    display: flex;
    align-items: center;
    min-height: var(--target-min);
    padding: var(--menu-link-pad);
    font-size: var(--fs-menu-link);
    font-variation-settings: var(--fv-nav);
  }

  @media (min-width: 780px) {
    .links {
      display: block;
    }
    .menu {
      display: none;
    }
  }
  /* A landscape phone keeps the menu, however wide, and the bar stays one
     row: the brand alone, without "— Football Legends", so the game fits. */
  @media (orientation: landscape) and (max-height: 500px) {
    .links {
      display: none;
    }
    .menu {
      display: block;
    }
    .dash,
    .fl {
      display: none;
    }
  }
</style>
