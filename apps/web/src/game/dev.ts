/**
 * Developer tools for `pnpm dev`: an artificial delay on every round request,
 * to watch the reveal hold and settle on a slow connection (ARCHITECTURE.md §9).
 *
 * Only ever loaded behind `import.meta.env.DEV` with a dynamic import, so a
 * production build drops this module, and the panel with it, entirely. Its
 * labels are for developers, not players, so they stay here rather than in
 * i18n/en.ts, which ships.
 *
 * The setting survives a reload (localStorage), and `?delay=800` in the URL
 * sets it, which is handy in a headless browser.
 *
 * And `?mockEnd=won`, to see a run end as won where the autopilot can't reach
 * it — a "Clear the squad" theme, whose answers only the server knows: the
 * guess goes to the server as usual, and its verdict for that round comes back
 * rewritten as a right answer that ends the run, `won` ("Squad cleared"). The
 * figures are the server's own; only the verdict and the ending are made up,
 * so the score is the round it fired on. Like everything here it never ships:
 * the build's `scan:dist` fails if "mockEnd" reaches `apps/web/dist`.
 *
 * It also runs an accessibility check: axe-core against the page as it
 * stands, from the panel's "a11y" button or `window.__btAxe()` in a headless
 * browser. Violations are logged to the console. axe-core is a root
 * devDependency and, like the rest of this module, never ships.
 *
 * And an **autopilot**, to reach the end of Friendly's twenty questions — the
 * win screen — without knowing the answers: the panel's "auto" button, or
 * `?auto=1`. For each question it asks the server about the round on screen
 * first (Friendly is stateless, so asking is harmless), then presses the right
 * button. Turn it off mid-run and answer wrong to see a loss at n/20. It only
 * clicks the page's own buttons; the game itself is untouched.
 */

import { mount, unmount } from "svelte";
import DevPanel from "../components/game/DevPanel.svelte";
import type { Fetch } from "./api";

export const DEV_DELAYS = [0, 200, 800, 3000] as const;
export type DevDelay = (typeof DEV_DELAYS)[number];

const STORAGE_KEY = "bt:dev:delay";
const ROUND_ENDPOINT = "/api/round/next";
const GUESS_ENDPOINT = "/api/round/guess";

/** `?mockEnd=won`: the next guess's verdict ends the run as won (see above). */
const mockEnd = new URLSearchParams(location.search).get("mockEnd") === "won";

let delay: DevDelay = initialDelay();

/** The run in play and the round on screen, as seen passing through `withDevDelay`. */
let inPlay: { runId: string; round: number } | null = null;
let autopilot = new URLSearchParams(location.search).get("auto") === "1";
/** The round the autopilot last answered, so it answers each once. */
let piloted: string | null = null;

export function devAutopilot(): boolean {
  return autopilot;
}

export function setDevAutopilot(on: boolean): void {
  autopilot = on;
}

export function devDelay(): DevDelay {
  return delay;
}

export function setDevDelay(ms: DevDelay): void {
  delay = ms;
  try {
    localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    // Storage unavailable: the setting lasts until reload.
  }
}

/**
 * `fetchFn`, but each request waits the current delay before it goes. It also
 * notes the run id and the round each response deals, for the autopilot.
 */
export function withDevDelay(fetchFn: Fetch): Fetch {
  return async (input, init) => {
    const ms = delay;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    const res = await fetchFn(input, init);
    void res
      .clone()
      .json()
      .then(track, () => {});
    return res;
  };
}

/**
 * `fetchFn`, but under `?mockEnd=won` a guess's response comes back as a right
 * answer that ends the run `won`: the server's reveal (its figure), marked
 * right, with its challenge link if it sent one, else one at the reveal's
 * round. Every other request, and every request without the flag, untouched.
 */
export function withMockEnd(fetchFn: Fetch): Fetch {
  if (!mockEnd) return fetchFn;
  return async (input, init) => {
    const res = await fetchFn(input, init);
    if (!input.endsWith(GUESS_ENDPOINT) || !res.ok) return res;
    const body = (await res.json()) as {
      reveal: { round: number };
      challenge?: { runId: string; score: number; sig: string };
      result?: string;
    };
    const runId = runIdOf(init.body);
    const won = {
      reveal: { ...body.reveal, correct: true },
      end: "won",
      challenge: { ...(body.challenge ?? { runId, sig: "mock" }), score: body.reveal.round },
      result: body.result ?? "mock",
    };
    console.info("mockEnd: round", body.reveal.round, "ends the run as won");
    return new Response(JSON.stringify(won), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

/** The run id in a guess's token, which the client can read: it's signed, not encrypted. */
function runIdOf(body: BodyInit | null | undefined): string {
  try {
    const { token } = JSON.parse(String(body)) as { token: string };
    const payload = JSON.parse(atob(token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/")));
    return String((payload as { runId?: unknown }).runId ?? "");
  } catch {
    return "";
  }
}

function track(body: unknown): void {
  if (typeof body !== "object" || body === null) return;
  const b = body as { runId?: unknown; round?: { index?: unknown }; next?: { index?: unknown } };
  if (typeof b.runId === "string" && typeof b.round?.index === "number") {
    inPlay = { runId: b.runId, round: b.round.index };
  } else if (inPlay !== null && typeof b.next?.index === "number") {
    inPlay = { ...inPlay, round: b.next.index };
  }
}

/**
 * Which answer is right for the round on screen: asks the server with
 * "higher" and reads its verdict. Dev only — it spends an answer of the run's
 * rate limit, which twenty rounds stay well inside.
 */
async function rightAnswer(runId: string, round: number): Promise<"higher" | "lower"> {
  const res = await fetch(ROUND_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "friendly", runId, round, guess: "higher" }),
  });
  const body = (await res.json()) as { reveal?: { correct?: boolean } };
  return body.reveal?.correct === true ? "higher" : "lower";
}

/** One autopilot step: when Higher / Lower are showing for a round not yet answered, answer it. */
async function pilot(): Promise<void> {
  if (!autopilot || inPlay === null) return;
  const key = `${inPlay.runId}#${inPlay.round}`;
  const picks = document.querySelectorAll<HTMLButtonElement>(".picks:not([hidden]) .pick");
  if (piloted === key || picks.length !== 2) return;
  piloted = key;
  try {
    const answer = await rightAnswer(inPlay.runId, inPlay.round);
    picks[answer === "higher" ? 0 : 1]?.click();
  } catch (err) {
    piloted = null;
    console.warn("autopilot: couldn't ask the server", err);
  }
}

/** One axe finding, trimmed to what's worth reading in a console. */
export interface AxeFinding {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly targets: readonly string[];
}

/** Runs axe-core over the page and logs the violations. Dev only. */
export async function runAxe(): Promise<AxeFinding[]> {
  const axe = (await import("axe-core")).default;
  const results = await axe.run(document, { resultTypes: ["violations"] });
  const findings = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    targets: v.nodes.map((n) => n.target.join(" ")),
  }));
  if (findings.length === 0) console.info("axe: no violations");
  else console.warn(`axe: ${findings.length} violation(s)`, findings);
  return findings;
}

declare global {
  interface Window {
    /** `pnpm dev` only: see `runAxe`. */
    __btAxe?: () => Promise<AxeFinding[]>;
  }
}

/** Puts the delay switch on the page. Returns a function that removes it. */
export function mountDevPanel(): () => void {
  window.__btAxe = runAxe;
  const panel = mount(DevPanel, { target: document.body });
  const timer = setInterval(() => void pilot(), 250);
  return () => {
    clearInterval(timer);
    delete window.__btAxe;
    void unmount(panel);
  };
}

function initialDelay(): DevDelay {
  const fromUrl = parseDelay(new URLSearchParams(location.search).get("delay"));
  if (fromUrl !== undefined) return fromUrl;
  try {
    return parseDelay(localStorage.getItem(STORAGE_KEY)) ?? 0;
  } catch {
    return 0;
  }
}

function parseDelay(raw: string | null): DevDelay | undefined {
  const n = Number(raw);
  return raw !== null && (DEV_DELAYS as readonly number[]).includes(n)
    ? (n as DevDelay)
    : undefined;
}
