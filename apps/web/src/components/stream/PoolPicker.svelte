<!--
  Twitch Mode's question picker: the pools as small tiles in the cards' glass,
  All legends and Instagram on a row of their own, then Clubs, Leagues and
  Eras. The themes come
  from the same list as the squad pages (themes.json), so a new theme appears
  here on its own, in centred rows. A squad shorter than the longest match
  says how many questions it has.

  A radio group: one tab stop, arrow keys to move, each tile a native radio
  with its name and line as its label.
-->
<script lang="ts">
  import type { StreamPool } from "@bt/core";
  import { t } from "../../i18n";
  import type { MessageKey } from "../../i18n";
  import type { PoolOption } from "../../game/stream/settings";
  import { count } from "../../game/publish";
  import { themeText } from "../../game/variant";

  interface Props {
    options: readonly PoolOption[];
    /** Each theme's colours, as its card's custom properties (lib/themes.ts `themeColours`). */
    colours: Readonly<Record<string, string>>;
    value: StreamPool;
    onchange: (pool: StreamPool) => void;
  }

  let { options, colours, value, onchange }: Props = $props();

  /** The rows: the whole deck's two pools together and unlabelled, then the squads by type. */
  const GROUPS: readonly {
    id: string;
    kinds: readonly PoolOption["kind"][];
    label?: MessageKey;
  }[] = [
    { id: "deck", kinds: ["all", "instagram"] },
    { id: "club", kinds: ["club"], label: "themes.club" },
    { id: "league", kinds: ["league"], label: "themes.league" },
    { id: "era", kinds: ["era"], label: "themes.era" },
  ];

  const groups = $derived(
    GROUPS.map((group) => ({
      ...group,
      options: options.filter((o) => group.kinds.includes(o.kind)),
    })).filter((group) => group.options.length > 0),
  );

  function name(option: PoolOption): string {
    if (option.kind === "all") return t("stream.pool.all.name");
    if (option.kind === "instagram") return t("stream.pool.instagram.name");
    return option.theme?.name ?? "";
  }

  function line(option: PoolOption): string {
    if (option.kind === "all") return t("stream.pool.all.body");
    if (option.kind === "instagram") return t("stream.pool.instagram.body");
    if (option.theme === undefined) return "";
    const players = themeText("theme.players", option.theme, {
      players: count(option.theme.players),
    });
    return option.cap === null
      ? players
      : `${players} ${t("over.separator")} ${t("stream.pool.cap", { count: option.cap })}`;
  }
</script>

<fieldset class="picker">
  <legend>{t("stream.pool.label")}</legend>
  {#each groups as group (group.id)}
    <div class="group">
      {#if group.label !== undefined}
        <p class="grouplabel" aria-hidden="true">{t(group.label)}</p>
      {/if}
      <div class="tiles">
        {#each group.options as option (option.pool)}
          <label
            class="tile"
            class:coloured={option.theme !== undefined && colours[option.theme.id] !== undefined}
            class:chosen={option.pool === value}
            style={option.theme !== undefined ? colours[option.theme.id] : undefined}
          >
            <input
              type="radio"
              name="stream-pool"
              value={option.pool}
              checked={option.pool === value}
              onchange={() => onchange(option.pool)}
            />
            <span class="name">{name(option)}</span>
            <span class="line">{line(option)}</span>
          </label>
        {/each}
      </div>
    </div>
  {/each}
</fieldset>

<style>
  .picker {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  /* Named for screen readers; sighted players have the step's heading above it. */
  legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .group + .group {
    margin-top: 10px;
  }
  .grouplabel {
    margin: 0 0 6px;
    text-align: center;
    font-size: var(--fs-stream-status);
    color: var(--gold);
    text-shadow: var(--glow);
  }
  /* Centred rows: a short last row (or a group of one) sits in the middle. */
  .tiles {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--stream-tile-gap);
  }
  .tile {
    position: relative;
    display: flex;
    /* One width for every tile, two to a row on a phone. */
    flex: 0 0 min(var(--stream-tile-w), calc(50% - var(--stream-tile-gap) / 2));
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: var(--stream-tile-min-h);
    text-align: center;
    padding: var(--stream-tile-pad);
    border: 1px solid var(--card-edge);
    border-radius: calc(var(--card-radius) * 0.6);
    background: var(--card-surface);
    box-shadow: var(--card-shadow);
    overflow: hidden;
    cursor: pointer;
    transition:
      border-color var(--dur-hover),
      box-shadow var(--dur-hover);
  }
  /* The theme's two colours along the top edge, as on its card. */
  .tile.coloured::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    background: linear-gradient(90deg, var(--theme-1), var(--theme-2));
  }
  .tile:hover,
  .tile:focus-within {
    border-color: var(--card-edge-hover);
    box-shadow: var(--card-shadow-lifted);
  }
  .tile:focus-within {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  /* Chosen: a gold edge drawn inside the same 1px border, so nothing in the
     tile (or its row) moves or rewraps. */
  .tile.chosen {
    border-color: var(--gold);
    box-shadow:
      inset 0 0 0 1px var(--gold),
      var(--glow-hover);
  }
  input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .name {
    font-size: var(--fs-stream-side);
    font-variation-settings: var(--fv-nav);
    color: var(--card-name);
  }
  .coloured .name {
    color: var(--theme-text-1);
  }
  .chosen .name {
    color: var(--gold);
  }
  .line {
    /* A "\n" in the line is a line break. */
    white-space: pre-line;
    font-size: var(--fs-stream-status);
    color: var(--card-body);
  }
</style>
