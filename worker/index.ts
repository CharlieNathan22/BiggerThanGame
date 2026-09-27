/**
 * Worker entry. Routing and bindings live in `src/app.ts`; this file only
 * supplies the bundled deck and the one workerd-only constructor the app needs.
 */

import { EmailMessage } from "cloudflare:email";
import { createApp } from "./src/app.js";
import type { Env } from "./src/app.js";
import { DECK, IMAGES } from "./src/deck.js";

export default createApp({
  deck: DECK,
  images: IMAGES,
  emailMessage: (from, to, raw) => new EmailMessage(from, to, raw),
}) satisfies ExportedHandler<Env>;
