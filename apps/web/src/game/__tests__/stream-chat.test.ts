/**
 * Twitch Mode's chat: what counts as a vote (commands.ts), the channel as
 * typed (channel.ts), one vote per viewer while voting is open (votes.ts), and
 * the anonymous Twitch source over a fake WebSocket (twitch-anon.ts).
 */

import { describe, expect, it } from "vitest";
import { normaliseChannel } from "../stream/channel";
import type { ChatMessage, ChatStatus } from "../stream/chat-source";
import { LONGEST_COMMAND, VOTE_COMMANDS, parseVote } from "../stream/commands";
import {
  AnonymousTwitchChat,
  BACKOFF,
  GIVE_UP_ATTEMPTS,
  JOIN_TIMEOUT_MS,
  TWITCH_CHAT_URL,
  backoffDelay,
  commandOf,
  tag,
} from "../stream/twitch-anon";
import type { SocketLike } from "../stream/twitch-anon";
import { VoteBox, pickOf, splitPercent } from "../stream/votes";

describe("vote commands", () => {
  it("are exactly six, in any case, with whitespace around them", () => {
    expect(VOTE_COMMANDS.en.higher).toEqual(["!h", "!higher", "higher"]);
    expect(VOTE_COMMANDS.en.lower).toEqual(["!l", "!lower", "lower"]);
    for (const text of [
      "!h",
      "!H",
      "!higher",
      "!Higher",
      "!HIGHER",
      "higher",
      "HiGhEr",
      "  !h  ",
      "\t!higher\n",
    ]) {
      expect(parseVote(text), JSON.stringify(text)).toBe("higher");
    }
    for (const text of ["!l", "!L", "!lower", "!Lower", "lower", "LOWER", " lower "]) {
      expect(parseVote(text), JSON.stringify(text)).toBe("lower");
    }
  });

  it("refuse near-misses", () => {
    for (const text of [
      "h",
      "l",
      "H",
      "hi",
      "!hh",
      "!ll",
      "lowerr",
      "higherr",
      "! h",
      "!h!",
      "!hi",
      "low",
      "!",
      "",
    ]) {
      expect(parseVote(text), JSON.stringify(text)).toBeNull();
    }
  });

  it("ignore a command inside a longer message", () => {
    for (const text of [
      "!h please",
      "I say !h",
      "higher!",
      "go higher",
      "!h !h",
      "lower lower",
      "!higher ok",
    ]) {
      expect(parseVote(text), JSON.stringify(text)).toBeNull();
    }
  });

  it("know the longest command, for the fast path", () => {
    expect(LONGEST_COMMAND).toBe("!higher".length);
  });
});

describe("the channel input", () => {
  it("takes a name, #name or a link, lower-cased", () => {
    const ok = (input: string) => normaliseChannel(input);
    expect(ok("Shroud")).toEqual({ ok: true, channel: "shroud" });
    expect(ok("#Shroud")).toEqual({ ok: true, channel: "shroud" });
    expect(ok("  @some_streamer_99  ")).toEqual({ ok: true, channel: "some_streamer_99" });
    expect(ok("xqc")).toEqual({ ok: true, channel: "xqc" });
    for (const link of [
      "twitch.tv/Shroud",
      "https://www.twitch.tv/shroud",
      "http://twitch.tv/shroud/",
      "https://m.twitch.tv/shroud?ref=x",
      "https://www.twitch.tv/shroud/videos",
    ]) {
      expect(ok(link), link).toEqual({ ok: true, channel: "shroud" });
    }
  });

  it("refuses what Twitch never names a channel", () => {
    expect(normaliseChannel("")).toEqual({ ok: false, problem: "empty" });
    expect(normaliseChannel("   ")).toEqual({ ok: false, problem: "empty" });
    for (const input of [
      "ab",
      "_underscore",
      "has space",
      "dash-name",
      "dot.name",
      "émile",
      "a".repeat(26),
      "#",
      "https://youtube.com/shroud",
      "twitch.tv/",
    ]) {
      expect(normaliseChannel(input), input).toEqual({ ok: false, problem: "invalid" });
    }
    expect(normaliseChannel("a".repeat(25))).toEqual({ ok: true, channel: "a".repeat(25) });
  });
});

describe("the vote box", () => {
  it("counts one vote per viewer, the latest counting", () => {
    const box = new VoteBox();
    box.open();
    box.add("1", "higher");
    box.add("2", "higher");
    box.add("3", "lower");
    box.add("1", "lower");
    box.add("1", "lower");
    expect(box.counts()).toEqual({ higher: 1, lower: 2, voters: 3 });
    expect(box.result()).toEqual({ pick: "lower", voters: 3 });
  });

  it("ignores votes outside the window, and starts each question empty", () => {
    const box = new VoteBox();
    box.add("1", "higher");
    expect(box.counts().voters).toBe(0);
    box.open();
    box.add("1", "higher");
    box.close();
    box.add("2", "lower");
    expect(box.counts()).toEqual({ higher: 1, lower: 0, voters: 1 });
    box.open();
    expect(box.counts()).toEqual({ higher: 0, lower: 0, voters: 0 });
  });

  it("calls a tie a split and no votes none", () => {
    expect(pickOf({ higher: 0, lower: 0, voters: 0 })).toBe("none");
    expect(pickOf({ higher: 4, lower: 4, voters: 8 })).toBe("split");
    expect(pickOf({ higher: 5, lower: 4, voters: 9 })).toBe("higher");
    const box = new VoteBox();
    box.open();
    expect(box.result()).toEqual({ pick: "none", voters: 0 });
    box.add("a", "higher");
    box.add("b", "lower");
    expect(box.result()).toEqual({ pick: "split", voters: 2 });
  });

  it("splits into whole percentages that add up to 100", () => {
    expect(splitPercent({ higher: 2, lower: 1, voters: 3 })).toEqual({ higher: 67, lower: 33 });
    expect(splitPercent({ higher: 1, lower: 1, voters: 2 })).toEqual({ higher: 50, lower: 50 });
    expect(splitPercent({ higher: 0, lower: 0, voters: 0 })).toEqual({ higher: 0, lower: 0 });
  });

  it("keeps up with a big chat", () => {
    const box = new VoteBox();
    box.open();
    for (let i = 0; i < 200_000; i++) box.add(String(i % 50_000), i % 3 === 0 ? "lower" : "higher");
    expect(box.counts().voters).toBe(50_000);
  });
});

// ------------------------------------------------------------ the source

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  /** Lines from Twitch, as one frame. */
  receive(...lines: string[]): void {
    this.onmessage?.({ data: lines.map((l) => `${l}\r\n`).join("") });
  }
  /** The connection drops from Twitch's side. */
  drop(): void {
    this.onerror?.();
    this.close();
  }
}

function rig() {
  const sockets: FakeSocket[] = [];
  let now = 1_000_000;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const chat = new AnonymousTwitchChat({
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    schedule: (fn, ms) => {
      const timer = { at: now + ms, fn, live: true };
      timers.push(timer);
      return () => (timer.live = false);
    },
    now: () => now,
    random: () => 0.5,
  });
  const statuses: ChatStatus[] = [];
  const messages: ChatMessage[] = [];
  chat.onStatus((s) => statuses.push(s));
  chat.onMessage((m) => messages.push(m));
  return {
    chat,
    sockets,
    statuses,
    messages,
    last: () => sockets.at(-1)!,
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (timer.live && timer.at <= now) {
          timer.live = false;
          timer.fn();
        }
      }
    },
    status: () => statuses.at(-1)!,
  };
}

const ROOMSTATE =
  "@emote-only=0;followers-only=-1;r9k=0;room-id=1;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #streamer";

function privmsg(userId: string, text: string): string {
  return (
    `@badge-info=;badges=;color=#1E90FF;display-name=Viewer${userId};emotes=;first-msg=0;flags=;` +
    `id=abc;mod=0;returning-chatter=0;room-id=1;subscriber=0;tmi-sent-ts=1;turbo=0;` +
    `user-id=${userId};user-type= :viewer${userId}!viewer${userId}@viewer${userId}.tmi.twitch.tv PRIVMSG #streamer :${text}`
  );
}

describe("the anonymous Twitch source", () => {
  it("logs in as a guest, asks for tags and joins, and is connected only on ROOMSTATE", () => {
    const r = rig();
    r.chat.connect("streamer");
    expect(r.last().url).toBe(TWITCH_CHAT_URL);
    expect(r.status()).toEqual({ kind: "connecting", channel: "streamer" });
    r.last().onopen?.();
    const [cap, pass, nick, join] = r.last().sent;
    expect(cap).toBe("CAP REQ :twitch.tv/tags twitch.tv/commands");
    expect(pass).toBe("PASS SCHMOOPIIE");
    expect(nick).toMatch(/^NICK justinfan\d+$/);
    expect(join).toBe("JOIN #streamer");
    expect(r.status().kind).toBe("connecting");
    r.last().receive(
      ":tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!",
      ":justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #streamer",
    );
    expect(r.status().kind).toBe("connecting");
    r.last().receive(ROOMSTATE);
    expect(r.status()).toEqual({ kind: "connected", channel: "streamer" });
  });

  it("passes on each message with its user id, and drops long ones unread", () => {
    const r = rig();
    r.chat.connect("streamer");
    r.last().onopen?.();
    r.last().receive(ROOMSTATE);
    r.last().receive(
      privmsg("11", "!h"),
      privmsg("12", "  LOWER "),
      privmsg("13", "this is a long message about the game"),
      privmsg("14", "!higher"),
    );
    expect(r.messages).toEqual([
      { userId: "11", text: "!h" },
      { userId: "12", text: "  LOWER " },
      { userId: "14", text: "!higher" },
    ]);
  });

  it("reads tags exactly, and the command past them", () => {
    const line = privmsg("4242", "!l");
    expect(tag(line, "user-id")).toBe("4242");
    expect(tag(line, "id")).toBe("abc");
    expect(tag(line, "room-id")).toBe("1");
    expect(tag(line, "missing")).toBe("");
    expect(commandOf(line)).toBe("PRIVMSG");
    expect(commandOf(ROOMSTATE)).toBe("ROOMSTATE");
    expect(commandOf(":tmi.twitch.tv RECONNECT")).toBe("RECONNECT");
  });

  it("answers PING", () => {
    const r = rig();
    r.chat.connect("streamer");
    r.last().onopen?.();
    r.last().receive("PING :tmi.twitch.tv");
    expect(r.last().sent.at(-1)).toBe("PONG :tmi.twitch.tv");
  });

  it("reconnects with backoff after a drop, and joins again", () => {
    const r = rig();
    r.chat.connect("streamer");
    r.last().onopen?.();
    r.last().receive(ROOMSTATE);
    r.last().drop();
    const first = r.status();
    expect(first).toMatchObject({ kind: "reconnecting", channel: "streamer", attempt: 1 });
    expect(r.sockets).toHaveLength(1);
    r.advance(backoffDelay(0, 0.5) - 1);
    expect(r.sockets).toHaveLength(1);
    r.advance(1);
    expect(r.sockets).toHaveLength(2);
    // A second drop before it joins waits longer.
    r.last().drop();
    expect(r.status()).toMatchObject({ kind: "reconnecting", attempt: 2 });
    r.advance(backoffDelay(1, 0.5));
    r.last().onopen?.();
    r.last().receive(ROOMSTATE);
    expect(r.status()).toEqual({ kind: "connected", channel: "streamer" });
    expect(r.last().sent).toContain("JOIN #streamer");
  });

  it("follows Twitch's RECONNECT at once", () => {
    const r = rig();
    r.chat.connect("streamer");
    r.last().onopen?.();
    r.last().receive(ROOMSTATE);
    r.last().receive(":tmi.twitch.tv RECONNECT");
    expect(r.status()).toMatchObject({ kind: "reconnecting", attempt: 1 });
    r.advance(BACKOFF.firstMs * (1 + BACKOFF.jitter));
    expect(r.sockets).toHaveLength(2);
  });

  it("backs off exponentially to a ceiling, with jitter", () => {
    expect(backoffDelay(0, 0.5)).toBe(1000);
    expect(backoffDelay(1, 0.5)).toBe(2000);
    expect(backoffDelay(3, 0.5)).toBe(8000);
    expect(backoffDelay(20, 0.5)).toBe(BACKOFF.maxMs);
    expect(backoffDelay(0, 0)).toBe(800);
    expect(backoffDelay(0, 0.9999)).toBeLessThanOrEqual(1200);
  });

  it("says a channel Twitch never confirms isn't there, and doesn't retry", () => {
    const r = rig();
    r.chat.connect("nobodyhere");
    r.last().onopen?.();
    r.advance(JOIN_TIMEOUT_MS);
    expect(r.status()).toEqual({ kind: "failed", channel: "nobodyhere", reason: "not_found" });
    expect(r.last().closed).toBe(true);
    r.advance(60_000);
    expect(r.sockets).toHaveLength(1);
  });

  it("says when Twitch refuses the channel", () => {
    const r = rig();
    r.chat.connect("banned");
    r.last().onopen?.();
    r.last().receive(
      "@msg-id=msg_channel_suspended :tmi.twitch.tv NOTICE #banned :This channel has been suspended.",
    );
    expect(r.status()).toEqual({ kind: "failed", channel: "banned", reason: "refused" });
  });

  it("gives up plainly when Twitch can't be reached at all", () => {
    const r = rig();
    r.chat.connect("streamer");
    for (let i = 0; i < GIVE_UP_ATTEMPTS - 1; i++) {
      r.last().drop();
      expect(r.status().kind).toBe("reconnecting");
      r.advance(BACKOFF.maxMs * 2);
    }
    r.last().drop();
    expect(r.status()).toEqual({ kind: "failed", channel: "streamer", reason: "unreachable" });
  });

  it("closes cleanly, and a connect to another channel leaves the first", () => {
    const r = rig();
    r.chat.connect("one");
    r.last().onopen?.();
    r.last().receive(ROOMSTATE);
    const first = r.last();
    r.chat.connect("two");
    expect(first.closed).toBe(true);
    // The old socket's close changed nothing.
    expect(r.status()).toEqual({ kind: "connecting", channel: "two" });
    first.receive(privmsg("1", "!h"));
    expect(r.messages).toEqual([]);
    r.chat.close();
    expect(r.status()).toEqual({ kind: "idle" });
    r.advance(120_000);
    expect(r.sockets).toHaveLength(2);
  });
});
