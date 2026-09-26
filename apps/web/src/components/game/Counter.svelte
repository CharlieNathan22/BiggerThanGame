<!--
  The challenger's number during the reveal: scrambles from the tap, counts up
  once the answer lands, and ends on the server's own display string. Frame
  timing comes from `counterFrame`; this only draws it. ARCHITECTURE.md §9.
-->
<script lang="ts">
  import type { StatKey } from "@bt/core";
  import { counterFrame, formatFigure, scrambleValue } from "../../game/counter";
  import type { CountClock } from "../../game/machine";
  import type { Timings } from "../../game/timing";
  import Figure from "./Figure.svelte";

  interface Props {
    count: CountClock;
    stat: StatKey;
    /** The anchor's value, already on screen; scales the scramble. */
    anchorValue: number;
    /** The revealed value and its display string; null until the answer lands. */
    target: number | null;
    display: string | null;
    timings: Timings;
    reducedMotion: boolean;
  }

  let { count, stat, anchorValue, target, display, timings, reducedMotion }: Props = $props();

  let shown: string | null = $state(null);

  $effect(() => {
    // Everything the loop reads, captured so the effect restarts when the answer lands.
    const clock = count;
    const value = target;
    const final = display;
    let frame = 0;
    let lastTick = -1;

    const draw = (): void => {
      const f = counterFrame(clock, value, performance.now(), timings, reducedMotion);
      if (f.kind === "done") {
        shown = final;
        return;
      }
      if (f.kind === "hidden") shown = null;
      else if (f.kind === "count") shown = formatFigure(stat, f.value);
      else if (f.tick !== lastTick) {
        // Decorative, and before the answer exists: the browser's randomness is fine.
        lastTick = f.tick;
        shown = formatFigure(stat, scrambleValue(anchorValue, Math.random()));
      }
      frame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(frame);
  });
</script>

<Figure display={shown} />
