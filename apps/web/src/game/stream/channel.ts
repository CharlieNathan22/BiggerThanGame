/**
 * The streamer's channel, as typed: a name, `#name`, or a pasted
 * `twitch.tv/name` link (with or without `https://` and `www.`), normalised to
 * the lower-case login Twitch's chat joins by.
 *
 * Twitch logins are letters, digits and underscores, up to 25 characters. New
 * ones need four or more, but some old channels have three (`xqc`), so three
 * is the floor here; a login never starts with an underscore.
 */

export type ChannelProblem = "empty" | "invalid";

export type ChannelInput =
  | { readonly ok: true; readonly channel: string }
  | { readonly ok: false; readonly problem: ChannelProblem };

const LOGIN = /^[a-z0-9][a-z0-9_]{2,24}$/;

/** A pasted link: `twitch.tv/name`, perhaps with a scheme, `www.` or `m.`, and a trailing path. */
const LINK = /^(?:https?:\/\/)?(?:(?:www|m)\.)?twitch\.tv\/([^/?#\s]+)/i;

export function normaliseChannel(input: string): ChannelInput {
  let text = input.trim();
  if (text === "") return { ok: false, problem: "empty" };
  const link = LINK.exec(text);
  if (link !== null) text = link[1] ?? "";
  else if (text.startsWith("#") || text.startsWith("@")) text = text.slice(1);
  const channel = text.toLowerCase();
  return LOGIN.test(channel) ? { ok: true, channel } : { ok: false, problem: "invalid" };
}
