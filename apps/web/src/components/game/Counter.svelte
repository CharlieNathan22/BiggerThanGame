<!--
  The challenger's number during the reveal: 0 from the tap, counting up once
  the answer lands, and ends on the server's own display string. Frame
  timing comes from `counterFrame`; this only draws it. ARCHITECTURE.md §9.
-->
<script lang="ts">
  import { STATS } from "@bt/core";
  import type { StatKey } from "@bt/core";
  import { countFormat, counterFrame } from "../../game/counter";
  import type { CountClock } from "../../game/machine";
  import type { Timings } from "../../game/timing";
  import Figure from "./Figure.svelte";

  interface Props {
    count: CountClock;
    stat: StatKey;
    /** The revealed value and its display string; null until the answer lands. */
    target: number | null;
    display: string | null;
    timings: Timings;
    reducedMotion: boolean;
  }

  let { count, stat, target, display, timings, reducedMotion }: Props = $props();

  let shown: string | null = $state(null);
  /** While counting, the final figure, which sizes the box. */
  let reserve: string | undefined = $state(undefined);

  $effect(() => {
    // Everything the loop reads, captured so the effect restarts when the answer lands.
    const clock = count;
    const value = target;
    const final = display;
    const format = final === null ? null : countFormat(final);
    let frame = 0;

    const draw = (): void => {
      const f = counterFrame(clock, value, performance.now(), timings, reducedMotion);
      if (f.kind === "done") {
        shown = final;
        reserve = undefined;
        return;
      }
      if (f.kind === "hidden") {
        shown = null;
        reserve = undefined;
      } else if (f.kind === "count") {
        shown = format === null ? null : format(f.value);
        reserve = final ?? undefined;
      } else {
        shown = STATS[stat].zero;
        reserve = undefined;
      }
      frame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(frame);
  });
</script>

<Figure display={shown} {reserve} />
