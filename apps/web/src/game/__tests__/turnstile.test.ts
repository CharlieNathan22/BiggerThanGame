import { describe, expect, it } from "vitest";
import { TURNSTILE_SCRIPT, createTurnstileLoader } from "../turnstile";
import type { ScriptDocument, Turnstile, TurnstileHost } from "../turnstile";
import { TURNSTILE_SITE_KEY, TURNSTILE_TEST_SITE_KEY } from "../../config";

interface FakeScript {
  src: string;
  async: boolean;
  defer: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  removed: boolean;
  remove(): void;
}

function fakeScript(): FakeScript {
  const script: FakeScript = {
    src: "",
    async: false,
    defer: false,
    onload: null,
    onerror: null,
    removed: false,
    remove: () => {
      script.removed = true;
    },
  };
  return script;
}

function fakeDocument(): ScriptDocument & { scripts: FakeScript[] } {
  const scripts: FakeScript[] = [];
  return {
    scripts,
    createElement: fakeScript,
    head: { append: (node) => void scripts.push(node as FakeScript) },
  };
}

const api: Turnstile = {
  render: () => "w1",
  reset: () => {},
  remove: () => {},
  execute: () => {},
};

describe("createTurnstileLoader", () => {
  it("adds nothing until it's asked", () => {
    const doc = fakeDocument();
    createTurnstileLoader(doc, {});
    expect(doc.scripts).toHaveLength(0);
  });

  it("adds Cloudflare's script once, for explicit rendering, and resolves every caller", async () => {
    const doc = fakeDocument();
    const host: TurnstileHost = {};
    const load = createTurnstileLoader(doc, host);
    const first = load();
    const second = load();
    expect(doc.scripts).toHaveLength(1);
    const script = doc.scripts[0]!;
    expect(script.src).toBe(TURNSTILE_SCRIPT);
    expect(script.src).toMatch(/^https:\/\/challenges\.cloudflare\.com\/.*render=explicit/);
    expect(script.async).toBe(true);

    host.turnstile = api;
    script.onload?.();
    expect(await first).toBe(api);
    expect(await second).toBe(api);
    expect(await load()).toBe(api);
    expect(doc.scripts).toHaveLength(1);
  });

  it("forgets a failed load, so opening the form again tries again", async () => {
    const doc = fakeDocument();
    const host: TurnstileHost = {};
    const load = createTurnstileLoader(doc, host);
    const failed = load();
    doc.scripts[0]!.onerror?.();
    await expect(failed).rejects.toThrow();
    expect(doc.scripts[0]!.removed).toBe(true);

    const retry = load();
    expect(doc.scripts).toHaveLength(2);
    host.turnstile = api;
    doc.scripts[1]!.onload?.();
    expect(await retry).toBe(api);
  });

  it("fails a script that loads without defining turnstile", async () => {
    const doc = fakeDocument();
    const load = createTurnstileLoader(doc, {});
    const pending = load();
    doc.scripts[0]!.onload?.();
    await expect(pending).rejects.toThrow();
  });
});

describe("site key", () => {
  it("is Cloudflare's always-pass test key in dev and tests", () => {
    expect(TURNSTILE_TEST_SITE_KEY).toBe("1x00000000000000000000AA");
    expect(TURNSTILE_SITE_KEY).toBe(TURNSTILE_TEST_SITE_KEY);
  });
});
