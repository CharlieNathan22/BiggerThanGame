<!--
  The Endless leaderboard (client:load, on its own static page): tabs for
  today, this week and this month, each the top 50, ten rows to a page, with
  the player's own row highlighted, the total, the countdown to the reset and
  the previous period's winner; then this device's own 10 best runs, which
  need no network. Renders the view from ../game/leaderboard.ts; no rules
  here. All text comes from ../i18n.

  Tabs follow the ARIA tabs pattern: one tab stop, arrow keys, Home and End
  move between them, and each panel is labelled by its tab. A new tab starts
  on its first page. Every rank is the server's; nothing is put into the
  list. When the player's own entry isn't on the page on show, their live
  position (POST /api/board/endless/me, asked once, only on a device that has
  published) is pinned above the table, apart from it; in the top 50 it is a
  button to its page. The table keeps ten rows' height on every page, so the
  page controls under it never move.
-->
<script lang="ts">
  import type { BoardPeriod, BoardResponse } from "@bt/core";
  import { onMount, tick } from "svelte";
  import { formatDate, t } from "../i18n";
  import { browserStorage } from "../game/best";
  import { deviceId, publishedKey, readRuns, readStandings, runsKey } from "../game/device";
  import type { LocalRun, Standing } from "../game/device";
  import {
    boardView,
    clampPage,
    countdownText,
    fetchBoard,
    goToPage,
    loadMine,
    ownPosition,
    pageCount,
    pageRows,
    pageText,
    pinnedRow,
    pinnedText,
    rangeText,
    selectPeriod,
    totalText,
    winnerLine,
  } from "../game/leaderboard";
  import type { MineState, Paging } from "../game/leaderboard";

  const PERIODS: readonly BoardPeriod[] = ["day", "week", "month"];
  const uid = $props.id();

  type Load =
    | { readonly status: "loading" }
    | { readonly status: "failed" }
    | { readonly status: "ok"; readonly board: BoardResponse };

  let paging = $state<Paging>(selectPeriod("day"));
  let loads = $state<Partial<Record<BoardPeriod, Load>>>({});
  let now = $state(Date.now());
  let standings = $state<Standing[]>([]);
  /** The live lookup of the player's own position; asked once, on load. */
  let mine = $state<MineState>({ status: "none" });
  let runs = $state<LocalRun[]>([]);
  let ready = $state(false);
  /** "Page 2 of 5", said once the page has changed; nothing on a new tab. */
  let pageNote = $state("");
  let tabs: HTMLButtonElement[] = $state([]);
  let numbers: HTMLButtonElement[] = $state([]);
  let panel: HTMLDivElement | undefined = $state();

  const period = $derived(paging.period);
  const load = $derived(loads[period]);
  const board = $derived(load?.status === "ok" ? load.board : null);
  const own = $derived(board === null ? null : ownPosition(period, board.key, mine, standings));
  const view = $derived(board === null ? null : boardView(board, own));
  const winner = $derived(board === null ? null : winnerLine(board.previous, period));
  const rows = $derived(view?.rows ?? []);
  const page = $derived(clampPage(paging.page, rows.length));
  const pages = $derived(pageCount(rows.length));
  const shown = $derived(pageRows(rows, page));
  const pinned = $derived(view === null ? null : pinnedRow(view, page));
  const pageList = $derived(Array.from({ length: pages }, (_, i) => i));

  async function open(p: BoardPeriod, force = false): Promise<void> {
    if (!force && loads[p]?.status === "ok") return;
    loads = { ...loads, [p]: { status: "loading" } };
    const fetched = await fetchBoard((input, init) => fetch(input, init), p);
    loads = {
      ...loads,
      [p]: fetched === null ? { status: "failed" } : { status: "ok", board: fetched },
    };
  }

  onMount(() => {
    standings = readStandings(browserStorage, publishedKey("legends", "endless"), Date.now());
    runs = readRuns(browserStorage, runsKey("legends", "endless"));
    ready = true;
    void open("day");
    // Where this device stands now: only if it has published to a current period.
    if (standings.length > 0) {
      mine = { status: "loading" };
      void loadMine(
        (input, init) => fetch(input, init),
        standings,
        () => deviceId(browserStorage, () => crypto.randomUUID()),
      ).then((state) => (mine = state));
    }
    const timer = setInterval(() => {
      now = Date.now();
      // Past the reset, this period's board is a new one.
      if (board !== null && now >= board.resetsAt) void open(period, true);
    }, 30_000);
    return () => clearInterval(timer);
  });

  function select(p: BoardPeriod, focus = false): void {
    paging = selectPeriod(p);
    pageNote = "";
    void open(p);
    if (focus) void tick().then(() => tabs[PERIODS.indexOf(p)]?.focus());
  }

  /**
   * Shows page `to`. Focus stays on the control pressed; if that is now
   * disabled (Previous on the first page, Next on the last), it moves to the
   * page's own number.
   */
  async function go(to: number, from: HTMLButtonElement | null): Promise<void> {
    paging = goToPage(paging, to, rows.length);
    pageNote = pageText(paging.page, rows.length);
    await tick();
    if (from === null || from.disabled || !from.isConnected) numbers[page]?.focus();
  }

  /** From the pinned row to the page with the player's own row, and focus on that row. */
  async function jump(to: number): Promise<void> {
    await go(to, null);
    panel?.querySelector<HTMLElement>("tr.mine")?.focus();
  }

  function onTabKey(event: KeyboardEvent, index: number): void {
    const last = PERIODS.length - 1;
    const to =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    const next = PERIODS[to];
    if (next !== undefined) select(next, true);
  }
</script>

<section class="boards glass" aria-labelledby="{uid}-tabs-label">
  <h2 class="sr" id="{uid}-tabs-label">{t("leaderboard.tabs")}</h2>
  <div class="tabs" role="tablist" aria-label={t("leaderboard.tabs")}>
    {#each PERIODS as p, i (p)}
      <button
        bind:this={tabs[i]}
        type="button"
        role="tab"
        id="{uid}-tab-{p}"
        aria-selected={period === p}
        aria-controls="{uid}-panel"
        tabindex={period === p ? 0 : -1}
        onclick={() => select(p)}
        onkeydown={(e) => onTabKey(e, i)}
      >
        {t(`leaderboard.tab.${p}`)}
      </button>
    {/each}
  </div>

  <div
    class="panel"
    role="tabpanel"
    id="{uid}-panel"
    aria-labelledby="{uid}-tab-{period}"
    tabindex="0"
    bind:this={panel}
  >
    <!-- Each board, and each state of it, fades in as the game's cards' text does. -->
    {#key `${period}:${load?.status ?? "loading"}`}
      <div class="develop">
        {#if board !== null && view !== null}
          <p class="meta">
            <span>{totalText(view.total)}</span>
            <span aria-hidden="true">{t("over.separator")}</span>
            <span
              >{t(`leaderboard.resets.${period}`, {
                time: countdownText(board.resetsAt, now),
              })}</span
            >
          </p>
          {#if winner !== null}
            <!-- "HardyOffside889 got a 23 streak yesterday": the name and number in gold. -->
            <p class="winner">
              {#each winner as part, i (i)}<span class:gold={part.gold}>{part.text}</span>{/each}
            </p>
          {/if}
          {#if rows.length === 0 && pinned === null}
            <p class="empty">{t("leaderboard.empty")}</p>
          {:else}
            <!-- Ten rows' height on every page (and room for the pinned row
                 when the player has one), so the controls under it stay put. -->
            <div class="rows" class:pinnable={view.own !== null}>
              {#if pinned !== null}
                <!-- The player's own position, live, above the table and apart
                     from it: never one of its rows, never counted in it. -->
                {#if pinned.page !== null}
                  {@const to = pinned.page}
                  <button
                    type="button"
                    class="pinned jump"
                    class:retired={pinned.nickname === null}
                    onclick={() => jump(to)}
                  >
                    <span class="rank num">{pinned.rank}</span>
                    <span class="who">
                      <span class="line">
                        <span class="nick">{pinned.nickname ?? t("leaderboard.retired")}</span>
                        <span class="you">{t("leaderboard.you")}</span>
                      </span>
                      <span class="sub">{pinnedText(pinned)}</span>
                    </span>
                    <span class="streak num">{pinned.streak}</span>
                  </button>
                {:else}
                  <p class="pinned" class:retired={pinned.nickname === null}>
                    <span class="rank num">{pinned.rank}</span>
                    <span class="who">
                      <span class="line">
                        <span class="nick">{pinned.nickname ?? t("leaderboard.retired")}</span>
                        <span class="you">{t("leaderboard.you")}</span>
                      </span>
                      <span class="sub">{pinnedText(pinned)}</span>
                    </span>
                    <span class="streak num">{pinned.streak}</span>
                  </p>
                {/if}
              {/if}
              <table>
                <caption class="sr">{t(`leaderboard.caption.${period}`)}</caption>
                <thead>
                  <tr>
                    <th scope="col" class="rank">{t("leaderboard.col.rank")}</th>
                    <th scope="col">{t("leaderboard.col.name")}</th>
                    <th scope="col" class="streak">{t("leaderboard.col.streak")}</th>
                  </tr>
                </thead>
                {#key page}
                  <tbody class="develop">
                    {#each shown as row (row.key)}
                      <tr
                        class:mine={row.mine}
                        aria-current={row.mine ? "true" : undefined}
                        tabindex={row.mine ? -1 : undefined}
                      >
                        <td class="rank num">{row.rank}</td>
                        <td class="name" class:retired={row.nickname === null}>
                          <span class="line">
                            <span class="nick">{row.nickname ?? t("leaderboard.retired")}</span>
                            {#if row.mine}<span class="you">{t("leaderboard.you")}</span>{/if}
                          </span>
                        </td>
                        <td class="streak num">{row.streak}</td>
                      </tr>
                    {/each}
                  </tbody>
                {/key}
              </table>
            </div>
            {#if pages > 1}
              <nav class="pager" aria-label={t("leaderboard.pages")}>
                <button
                  type="button"
                  class="secondary step prev"
                  aria-label={t("leaderboard.previousPage")}
                  disabled={page === 0}
                  onclick={(e) => go(page - 1, e.currentTarget)}
                >
                  <svg class="arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M10.5 6h-9M5.5 2l-4 4 4 4" />
                  </svg>
                  {t("leaderboard.previous")}
                </button>
                <ol class="numbers">
                  {#each pageList as i (i)}
                    <li>
                      <button
                        bind:this={numbers[i]}
                        type="button"
                        class="secondary pnum"
                        aria-label={t("leaderboard.pageNumber", { page: i + 1 })}
                        aria-current={i === page ? "page" : undefined}
                        onclick={(e) => go(i, e.currentTarget)}
                      >
                        {i + 1}
                      </button>
                    </li>
                  {/each}
                </ol>
                <button
                  type="button"
                  class="secondary step next"
                  aria-label={t("leaderboard.nextPage")}
                  disabled={page === pages - 1}
                  onclick={(e) => go(page + 1, e.currentTarget)}
                >
                  {t("leaderboard.next")}
                  <svg class="arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M1.5 6h9M6.5 2l4 4-4 4" />
                  </svg>
                </button>
              </nav>
            {/if}
            {#if rows.length > 0}
              <p class="range">{rangeText(page, rows.length)}</p>
            {/if}
          {/if}
        {:else if load?.status === "failed"}
          <p class="empty" role="alert">{t("leaderboard.failed")}</p>
          <p class="retryrow">
            <button type="button" class="secondary" onclick={() => open(period, true)}>
              {t("leaderboard.retry")}
            </button>
          </p>
        {:else}
          <p class="empty" role="status">{t("leaderboard.loading")}</p>
        {/if}
      </div>
    {/key}
    <p class="sr" aria-live="polite">{pageNote}</p>
  </div>
</section>

<section class="device" aria-labelledby="{uid}-device">
  <h2 id="{uid}-device">{t("leaderboard.device")}</h2>
  <p>{t("leaderboard.deviceIntro")}</p>
  {#if ready && runs.length > 0}
    <div class="glass develop">
      <table>
        <caption class="sr">{t("leaderboard.device")}</caption>
        <thead>
          <tr>
            <th scope="col" class="rank">{t("leaderboard.col.rank")}</th>
            <th scope="col">{t("leaderboard.col.date")}</th>
            <th scope="col" class="streak">{t("leaderboard.col.streak")}</th>
          </tr>
        </thead>
        <tbody>
          {#each runs as run, i (i)}
            <tr>
              <td class="rank num">{i + 1}</td>
              <td>{formatDate(run.date)}</td>
              <td class="streak num">{run.score}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if ready}
    <p class="empty">{t("leaderboard.deviceEmpty")}</p>
  {/if}
</section>

<style>
  /* The boards in the cards' glass (Card.astro): the same surface, edge,
     radius and shadow. Tabs are the secondary button's outlined pills; the
     previous winner and the streaks are in the game's gold. Every value is a
     token (tokens.css, "The Endless leaderboard page"). */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .glass {
    padding: var(--board-pad);
    border: var(--border) solid var(--card-edge);
    border-radius: var(--card-radius);
    background: var(--card-surface);
    box-shadow: var(--card-shadow);
  }
  .boards {
    margin-top: var(--board-top);
  }
  .device .glass {
    margin-top: var(--board-inner-gap);
  }

  .tabs {
    display: flex;
    justify-content: center;
    gap: var(--board-tab-gap);
  }
  [role="tab"] {
    flex: 1 1 0;
    max-width: var(--board-tab-max-w);
    min-height: var(--target-min);
    padding: var(--board-tab-pad);
    border: var(--btn2-border) solid transparent;
    border-radius: var(--radius-pill);
    color: var(--dim);
    font-size: var(--fs-body);
    font-variation-settings: var(--fv-cta);
    white-space: nowrap;
    transition:
      color var(--dur-hover),
      background-color var(--dur-hover),
      box-shadow var(--dur-hover),
      transform var(--dur-press);
  }
  [role="tab"]:hover {
    color: var(--chalk);
  }
  [role="tab"]:active {
    transform: scale(var(--press-scale));
  }
  [role="tab"][aria-selected="true"] {
    border-color: var(--btn2-edge);
    background: var(--btn2-bg);
    color: var(--btn2-text);
    box-shadow: var(--glow);
    text-shadow: var(--glow);
  }
  [role="tab"][aria-selected="true"]:hover {
    background: var(--btn2-bg-hover);
    box-shadow: var(--glow-hover);
  }
  [role="tab"]:focus-visible {
    outline: var(--focus-ring) solid var(--chalk);
    outline-offset: var(--focus-offset);
  }
  .panel:focus-visible {
    outline: var(--focus-ring) solid var(--gold);
    outline-offset: var(--focus-offset);
    border-radius: var(--field-radius);
  }

  /* The board keeps its height while it loads, fails or is empty, so what's
     below doesn't jump as the states change. */
  .panel {
    min-height: var(--board-min-h);
    margin-top: var(--board-inner-gap);
  }
  .develop {
    animation: board-in var(--dur-intro-fade) var(--ease-intro) both;
  }
  @keyframes board-in {
    from {
      opacity: 0;
      transform: translateY(var(--board-rise));
    }
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 8px;
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-meta);
    text-align: center;
  }
  /* The previous period's winner, one line: the name and the number in gold
     with its glow. */
  .winner {
    margin-top: var(--board-inner-gap);
    text-align: center;
    font-size: var(--fs-body);
    color: var(--dim);
  }
  .winner .gold {
    color: var(--gold);
    text-shadow: var(--glow);
    font-variation-settings: var(--fv-strong);
  }

  /* Ten rows' height whatever the page holds, plus the pinned row's when the
     player has an entry, so the page controls never move. */
  .rows {
    margin-top: var(--board-inner-gap);
    min-height: calc(
      var(--board-head-h) + var(--board-row-h) * var(--board-page-rows) + var(--board-rules-h)
    );
  }
  .rows.pinnable {
    min-height: calc(
      var(--board-head-h) + var(--board-pin-h) + var(--board-pin-gap) + var(--board-row-h) *
        var(--board-page-rows) + var(--board-rules-h)
    );
  }
  table {
    width: 100%;
    border-collapse: collapse;
    /* Fixed columns, so a long name ends in an ellipsis and every row is one height. */
    table-layout: fixed;
  }
  th,
  td {
    padding: var(--board-cell-pad);
    border-bottom: var(--border) solid var(--rule);
    text-align: left;
  }
  thead th {
    height: var(--board-head-h);
  }
  tbody td {
    height: var(--board-row-h);
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  th {
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-caps);
  }
  td {
    font-size: var(--fs-body);
    color: var(--chalk);
  }
  .rank {
    width: var(--board-rank-w);
  }
  td.rank {
    color: var(--dim);
  }
  th.streak,
  td.streak {
    width: var(--board-streak-w);
    text-align: right;
  }
  td.streak {
    color: var(--gold);
  }
  /* A name and, on the player's own row, the "You" pill, on one line. */
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .nick {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .retired .nick {
    color: var(--dim);
    font-style: italic;
  }
  /* The player's own row: a gold wash and a "You" pill. */
  tr.mine td {
    background: var(--board-mine-bg);
    font-variation-settings: var(--fv-strong);
  }
  tr.mine td.num {
    font-variation-settings: var(--fv-num);
  }
  tr.mine td.rank {
    color: var(--gold);
  }
  tr.mine td:first-child {
    border-radius: var(--field-radius) 0 0 var(--field-radius);
  }
  tr.mine td:last-child {
    border-radius: 0 var(--field-radius) var(--field-radius) 0;
  }
  tr.mine:focus-visible {
    outline: var(--focus-ring) solid var(--chalk);
    outline-offset: calc(-1 * var(--focus-ring));
  }
  .you {
    flex: none;
    padding: var(--badge-pad);
    border: var(--border) solid var(--gold);
    border-radius: var(--radius-pill);
    font-size: var(--fs-badge);
    line-height: var(--lh-body);
    color: var(--gold);
    font-variation-settings: var(--fv-caps);
  }

  /* The player's own position, pinned above the table and apart from it: the
     same columns as the table's rows, a line taller for where it stands, in
     the "You" style, with a gap and a gold rule under it. In the top 50 it is
     a button to its page. */
  .pinned {
    display: grid;
    grid-template-columns: var(--board-rank-w) minmax(0, 1fr) var(--board-streak-w);
    align-items: center;
    width: 100%;
    min-height: var(--board-pin-h);
    margin: 0 0 var(--board-pin-gap);
    border-bottom: var(--btn2-border) solid var(--gold-rule);
    border-radius: var(--field-radius);
    background: var(--board-mine-bg);
    font-size: var(--fs-body);
    color: var(--chalk);
    font-variation-settings: var(--fv-strong);
    text-align: left;
  }
  .pinned > span {
    padding: var(--board-cell-pad);
  }
  .pinned .rank {
    color: var(--gold);
    font-variation-settings: var(--fv-num);
  }
  .pinned .streak {
    color: var(--gold);
    text-align: right;
    font-variation-settings: var(--fv-num);
  }
  .who {
    min-width: 0;
  }
  .sub {
    display: block;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-meta);
  }
  .jump {
    cursor: pointer;
    transition: background-color var(--dur-hover);
  }
  .jump:hover {
    background: var(--btn2-bg-hover);
  }
  .jump .sub {
    color: var(--gold);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .jump:focus-visible {
    outline: var(--focus-ring) solid var(--chalk);
    outline-offset: calc(-1 * var(--focus-ring));
  }

  /* Previous, the page numbers, Next: the site's secondary buttons. Two rows
     on a phone (Previous and Next, the numbers under them), one from 560px. */
  .pager {
    margin-top: var(--board-inner-gap);
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-areas:
      "prev next"
      "numbers numbers";
    gap: var(--board-page-gap);
    align-items: center;
  }
  .prev {
    grid-area: prev;
    justify-self: start;
  }
  .next {
    grid-area: next;
    justify-self: end;
  }
  .numbers {
    grid-area: numbers;
    display: flex;
    justify-content: center;
    gap: var(--board-page-gap);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* Not the prose lists' spacing between items: the numbers sit in one line. */
  .numbers li {
    display: flex;
    margin: 0;
  }
  .pager button {
    min-height: var(--target-min);
  }
  .pager .step {
    gap: 6px;
    padding: 0 var(--board-step-pad-x);
  }
  .pager .pnum {
    width: var(--target-min);
    padding: 0;
  }
  .pager .pnum[aria-current="page"] {
    background: var(--gold);
    color: var(--ink);
    text-shadow: none;
  }
  .arrow {
    flex: none;
    width: var(--btn2-icon);
    height: var(--btn2-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: var(--btn2-icon-stroke);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (min-width: 560px) {
    .pager {
      grid-template-columns: 1fr auto 1fr;
      grid-template-areas: "prev numbers next";
    }
  }
  .range {
    margin-top: var(--board-page-gap);
    text-align: center;
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-meta);
  }

  .empty {
    margin-top: var(--board-inner-gap);
    text-align: center;
  }
  .retryrow {
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .develop {
      animation: none;
    }
    [role="tab"] {
      transition: none;
    }
  }
</style>
