<!--
  The Endless leaderboard (client:load, on its own static page): tabs for
  today, this week and this month, each the top 100 with the player's own row
  highlighted, their rank out of the total, the countdown to the reset and the
  previous period's winner; then this device's own 10 best runs, which need no
  network. Renders the view from ../game/leaderboard.ts; no rules here. All
  text comes from ../i18n.

  Tabs follow the ARIA tabs pattern: one tab stop, arrow keys, Home and End
  move between them, and each panel is labelled by its tab.
-->
<script lang="ts">
  import type { BoardPeriod, BoardResponse } from "@bt/core";
  import { onMount, tick } from "svelte";
  import { formatDate, t } from "../i18n";
  import { browserStorage } from "../game/best";
  import { publishedKey, readRuns, readStandings, runsKey } from "../game/device";
  import type { LocalRun, Standing } from "../game/device";
  import { boardView, countdownText, fetchBoard, totalText, winnerText } from "../game/leaderboard";

  const PERIODS: readonly BoardPeriod[] = ["day", "week", "month"];
  const uid = $props.id();

  type Load =
    | { readonly status: "loading" }
    | { readonly status: "failed" }
    | { readonly status: "ok"; readonly board: BoardResponse };

  let period = $state<BoardPeriod>("day");
  let loads = $state<Partial<Record<BoardPeriod, Load>>>({});
  let now = $state(Date.now());
  let standings = $state<Standing[]>([]);
  let runs = $state<LocalRun[]>([]);
  let ready = $state(false);
  let tabs: HTMLButtonElement[] = $state([]);

  const load = $derived(loads[period]);
  const board = $derived(load?.status === "ok" ? load.board : null);
  const own = $derived(
    board === null ? undefined : standings.find((s) => s.period === period && s.key === board.key),
  );
  const view = $derived(board === null ? null : boardView(board, own));

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
    const timer = setInterval(() => {
      now = Date.now();
      // Past the reset, this period's board is a new one.
      if (board !== null && now >= board.resetsAt) void open(period, true);
    }, 30_000);
    return () => clearInterval(timer);
  });

  function select(p: BoardPeriod, focus = false): void {
    period = p;
    void open(p);
    if (focus) void tick().then(() => tabs[PERIODS.indexOf(p)]?.focus());
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
          <p class="winner">
            <span class="winnerlab">{t(`leaderboard.winner.${period}`)}</span>
            <span class="winnername" class:none={board.previous.winner === null}
              >{winnerText(board.previous)}</span
            >
          </p>
          {#if view.rows.length === 0}
            <p class="empty">{t("leaderboard.empty")}</p>
          {:else}
            <table>
              <caption class="sr">{t(`leaderboard.caption.${period}`)}</caption>
              <thead>
                <tr>
                  <th scope="col" class="rank">{t("leaderboard.col.rank")}</th>
                  <th scope="col">{t("leaderboard.col.name")}</th>
                  <th scope="col" class="streak">{t("leaderboard.col.streak")}</th>
                </tr>
              </thead>
              <tbody>
                {#each view.rows as row (row.key)}
                  <tr class:mine={row.mine} aria-current={row.mine ? "true" : undefined}>
                    <td class="rank num">{row.rank}</td>
                    <td class:retired={row.nickname === null}>
                      {row.nickname ?? t("leaderboard.retired")}
                      {#if row.mine}<span class="you">{t("leaderboard.you")}</span>{/if}
                    </td>
                    <td class="streak num">{row.streak}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#if view.ownLine !== null}
            <p class="ownline">{view.ownLine}</p>
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
  /* The previous period's winner: the game-over panel's small label, then the
     name in gold with its glow. */
  .winner {
    margin-top: var(--board-inner-gap);
    text-align: center;
  }
  .winnerlab {
    display: block;
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-caps);
  }
  .winnername {
    display: block;
    margin-top: 2px;
    font-size: var(--fs-body);
    color: var(--gold);
    text-shadow: var(--glow);
    font-variation-settings: var(--fv-strong);
  }
  .winnername.none {
    color: var(--dim);
    text-shadow: none;
    font-variation-settings: var(--fv-caption);
  }

  table {
    width: 100%;
    margin-top: var(--board-inner-gap);
    border-collapse: collapse;
  }
  .device table {
    margin-top: 0;
  }
  th,
  td {
    padding: var(--board-cell-pad);
    border-bottom: var(--border) solid var(--rule);
    text-align: left;
    overflow-wrap: anywhere;
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
  .retired {
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
  tr.mine td:first-child {
    border-radius: var(--field-radius) 0 0 var(--field-radius);
  }
  tr.mine td:last-child {
    border-radius: 0 var(--field-radius) var(--field-radius) 0;
  }
  .you {
    display: inline-block;
    margin-left: 8px;
    padding: var(--badge-pad);
    border: var(--border) solid var(--gold);
    border-radius: var(--radius-pill);
    font-size: var(--fs-badge);
    line-height: var(--lh-body);
    color: var(--gold);
    font-variation-settings: var(--fv-caps);
    vertical-align: middle;
  }
  .ownline {
    margin-top: var(--board-inner-gap);
    text-align: center;
    color: var(--gold);
    text-shadow: var(--glow);
    font-variation-settings: var(--fv-strong);
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
