/**
 * The deck, bundled into the Worker at build time.
 *
 * This is the only place the full deck may be imported (ARCHITECTURE.md §4).
 * Both files are written by `pnpm --filter @bt/deck build`, which must run
 * before Wrangler bundles the Worker and before `pnpm typecheck`.
 *
 * Never import `@bt/deck` here or anywhere in the Worker's runtime code: it
 * reads files with `node:fs`. It is for Worker tests only.
 */

import type { Player } from "@bt/core";
import full from "../../packages/deck/dist/deck.full.json";
import images from "../../packages/deck/dist/images.json";
import type { ImageLookup } from "./payload.js";

// JSON imports are typed from their literal contents (`position: string`, not
// the `Position` union), so they need widening back to the engine's types. The
// deck build validated every record against the schema before writing it.
export const DECK = full.players as unknown as readonly Player[];
export const IMAGES = images as ImageLookup;
