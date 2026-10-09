/**
 * The Multiplayer hub's modes, as cards (DESIGN.md §17). A mode is live when
 * it has a page: its card links there. One without is a "Coming soon" card,
 * not a link. A mode goes live by giving it its `href`, never by changing the
 * hub's markup.
 */

import type { MessageKey } from "../i18n";
import { TWITCH_PATH } from "./paths";

export interface MultiplayerMode {
  readonly id: "twitch" | "1v1" | "last-man-standing";
  readonly name: MessageKey;
  readonly body: MessageKey;
  /** Its page when it's live; null while it's coming soon. */
  readonly href: string | null;
  /** An original icon (never a platform's logo or marks). */
  readonly icon?: "chat-vs-player";
}

export const MULTIPLAYER_MODES: readonly MultiplayerMode[] = [
  {
    id: "twitch",
    name: "multiplayer.twitch.name",
    body: "multiplayer.twitch.body",
    href: TWITCH_PATH,
    icon: "chat-vs-player",
  },
  { id: "1v1", name: "multiplayer.1v1.name", body: "multiplayer.1v1.body", href: null },
  {
    id: "last-man-standing",
    name: "multiplayer.lastManStanding.name",
    body: "multiplayer.lastManStanding.body",
    href: null,
  },
];
