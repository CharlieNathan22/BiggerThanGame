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

<section class="boards" aria-labelledby="{uid}-tabs-label">
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
    {#if board !== null && view !== null}
      <p class="meta">
        <span>{totalText(view.total)}</span>
        <span aria-hidden="true">·</span>
        <span
          >{t(`leaderboard.resets.${period}`, { time: countdownText(board.resetsAt, now) })}</span
        >
      </p>
      <p class="winner">
        <span class="lab">{t(`leaderboard.winner.${period}`)}</span>
        {winnerText(board.previous)}
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
              <th scope="col" class="num">{t("leaderboard.col.streak")}</th>
            </tr>
          </thead>
          <tbody>
            {#each view.rows as row (row.key)}
              <tr class:mine={row.mine} aria-current={row.mine ? "true" : undefined}>
                <td class="rank">{row.rank}</td>
                <td class:retired={row.nickname === null}>
                  {row.nickname ?? t("leaderboard.retired")}
                  {#if row.mine}<span class="you">{t("leaderboard.you")}</span>{/if}
                </td>
                <td class="num">{row.streak}</td>
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
      <button type="button" class="retry" onclick={() => open(period, true)}>
        {t("leaderboard.retry")}
      </button>
    {:else}
      <p class="empty" role="status">{t("leaderboard.loading")}</p>
    {/if}
  </div>
</section>

<section class="device" aria-labelledby="{uid}-device">
  <h2 id="{uid}-device">{t("leaderboard.device")}</h2>
  <p>{t("leaderboard.deviceIntro")}</p>
  {#if ready && runs.length > 0}
    <table>
      <caption class="sr">{t("leaderboard.device")}</caption>
      <thead>
        <tr>
          <th scope="col" class="rank">{t("leaderboard.col.rank")}</th>
          <th scope="col">{t("leaderboard.col.date")}</th>
          <th scope="col" class="num">{t("leaderboard.col.streak")}</th>
        </tr>
      </thead>
      <tbody>
        {#each runs as run, i (i)}
          <tr>
            <td class="rank">{i + 1}</td>
            <td>{formatDate(run.date)}</td>
            <td class="num">{run.score}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if ready}
    <p class="empty">{t("leaderboard.deviceEmpty")}</p>
  {/if}
</section>

<style>
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .boards,
  .device {
    margin-top: 24px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    border-bottom: var(--border) solid var(--rule);
  }
  [role="tab"] {
    flex: 1 1 0;
    min-height: var(--target-min);
    padding: 0 10px;
    border-bottom: 3px solid transparent;
    color: var(--dim);
    font-size: var(--fs-body);
    font-variation-settings: var(--fv-caption);
  }
  [role="tab"][aria-selected="true"] {
    border-bottom-color: var(--gold);
    color: var(--chalk);
    font-variation-settings: var(--fv-strong);
  }
  [role="tab"]:hover {
    color: var(--chalk);
  }
  [role="tab"]:focus-visible,
  .panel:focus-visible,
  .retry:focus-visible {
    outline: var(--focus-ring) solid var(--gold);
    outline-offset: var(--focus-offset);
  }
  .panel {
    padding-top: 14px;
  }
  .meta,
  .winner {
    margin: 0 0 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 0 8px;
    color: var(--dim);
  }
  .winner .lab {
    color: var(--chalk);
    font-variation-settings: var(--fv-strong);
  }
  .winner .lab::after {
    content: ":";
  }
  table {
    width: 100%;
    margin-top: 12px;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 10px 8px;
    border-bottom: var(--border) solid var(--rule);
    text-align: left;
    overflow-wrap: anywhere;
  }
  th {
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-caps);
  }
  .rank {
    width: 4.5em;
  }
  .num {
    width: 5em;
    text-align: right;
  }
  .retired {
    color: var(--dim);
    font-style: italic;
  }
  tr.mine td {
    background: var(--btn2-bg-hover);
    color: var(--chalk);
    font-variation-settings: var(--fv-strong);
  }
  .you {
    margin-left: 8px;
    padding: 0 8px;
    border: var(--border) solid var(--gold);
    border-radius: var(--radius-pill);
    font-size: var(--fs-lab);
    color: var(--gold);
  }
  .ownline {
    margin-top: 12px;
    color: var(--chalk);
    font-variation-settings: var(--fv-strong);
  }
  .empty {
    margin-top: 12px;
    color: var(--dim);
  }
  .retry {
    min-height: var(--target-min);
    margin-top: 8px;
    padding: 0 20px;
    border: var(--btn2-border) solid var(--btn2-edge);
    border-radius: var(--radius-pill);
    color: var(--btn2-text);
  }
</style>
