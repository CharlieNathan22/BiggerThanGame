/**
 * The dialogs' shared rules (modal.ts): a backdrop click closes, a press that
 * starts inside doesn't, nothing closes mid-send, focus goes back to the
 * opener, and a draft survives a close until it's sent.
 */

import { describe, expect, it } from "vitest";
import { createBackdropDismiss, createDraftStore, focusAfterClose } from "../modal";
import type { Focusable } from "../modal";

function dialog(sending = false) {
  let closed = 0;
  const state = { sending };
  const backdrop = createBackdropDismiss({
    canClose: () => !state.sending,
    close: () => void (closed += 1),
  });
  return { backdrop, state, closed: () => closed };
}

describe("a backdrop click", () => {
  it("closes the dialog when the press starts and ends on the backdrop", () => {
    const d = dialog();
    d.backdrop.pointerdown(true);
    d.backdrop.click(true);
    expect(d.closed()).toBe(1);
  });

  it("does nothing for a click inside the dialog", () => {
    const d = dialog();
    d.backdrop.pointerdown(false);
    d.backdrop.click(false);
    expect(d.closed()).toBe(0);
  });

  it("does nothing for a drag that starts inside and ends on the backdrop", () => {
    // Selecting text in a field and letting go outside the dialog: the click
    // lands on the common ancestor, the backdrop.
    const d = dialog();
    d.backdrop.pointerdown(false);
    d.backdrop.click(true);
    expect(d.closed()).toBe(0);
  });

  it("does nothing for a press that starts on the backdrop and ends inside", () => {
    const d = dialog();
    d.backdrop.pointerdown(true);
    d.backdrop.click(false);
    expect(d.closed()).toBe(0);
  });

  it("does nothing while a send is in progress, and works again after", () => {
    const d = dialog(true);
    d.backdrop.pointerdown(true);
    d.backdrop.click(true);
    expect(d.closed()).toBe(0);
    d.state.sending = false;
    d.backdrop.pointerdown(true);
    d.backdrop.click(true);
    expect(d.closed()).toBe(1);
  });

  it("needs its own press each time: a click with no press before it does nothing", () => {
    const d = dialog();
    d.backdrop.pointerdown(true);
    d.backdrop.click(true);
    d.backdrop.click(true);
    expect(d.closed()).toBe(1);
  });
});

describe("focus after closing", () => {
  const el = (name: string, isConnected = true) => {
    const focused: string[] = [];
    const e: Focusable & { name: string; focused: string[] } = {
      name,
      isConnected,
      focused,
      focus: () => void focused.push(name),
    };
    return e;
  };

  it("goes back to the button that opened the dialog", () => {
    const opener = el("Suggest a legend");
    expect(focusAfterClose(opener, el("Play again"))?.name).toBe("Suggest a legend");
  });

  it("falls back when the opener has gone from the page", () => {
    expect(focusAfterClose(el("Publish", false), el("Play again"))?.name).toBe("Play again");
    expect(focusAfterClose(null, undefined, el("Start"))?.name).toBe("Start");
    expect(focusAfterClose(null, el("gone", false))).toBeNull();
  });
});

describe("drafts", () => {
  const store = () =>
    createDraftStore<{ name: string; note: string }>(
      (d) => d.name.trim() === "" && d.note.trim() === "",
    );

  it("survive a close and come back when the form opens again", () => {
    const drafts = store();
    drafts.keep("suggest", { name: "Gianfranco Zola", note: "Chelsea legend" });
    expect(drafts.get("suggest")).toEqual({ name: "Gianfranco Zola", note: "Chelsea legend" });
  });

  it("are kept per form", () => {
    const drafts = store();
    drafts.keep("suggest", { name: "Zola", note: "" });
    drafts.keep("correction:run:7", { name: "", note: "wrong fee" });
    expect(drafts.get("problem")).toBeUndefined();
    expect(drafts.get("correction:run:8")).toBeUndefined();
    expect(drafts.get("correction:run:7")?.note).toBe("wrong fee");
  });

  it("are cleared by a send, and not kept when empty", () => {
    const drafts = store();
    drafts.keep("suggest", { name: "Zola", note: "" });
    drafts.keep("suggest", null);
    expect(drafts.get("suggest")).toBeUndefined();
    drafts.keep("problem", { name: "", note: "   " });
    expect(drafts.get("problem")).toBeUndefined();
  });
});
