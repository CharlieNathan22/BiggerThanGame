/**
 * Worker entry. Routing and bindings live in `src/app.ts`; this file only
 * supplies the bundled deck.
 */

import { createApp } from "./src/app.js";
import type { Env } from "./src/app.js";
import { DECK, IMAGES } from "./src/deck.js";

export default createApp({ deck: DECK, images: IMAGES }) satisfies ExportedHandler<Env>;
