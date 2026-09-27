/**
 * Site configuration. One place for values that would otherwise be repeated
 * across pages and components.
 */

/**
 * Where corrections can be emailed, for the about page. In the game, the
 * feedback forms send through `/api/feedback` instead.
 */
export const CORRECTIONS_EMAIL = "corrections@biggerthangame.com";

/**
 * The R2 custom domain that serves player photos (ARCHITECTURE.md §9). Card
 * URLs are built only through `imageUrl` / `srcsetFor` from `@bt/core`.
 */
export const IMAGE_BASE = "https://img.biggerthangame.com";

/** The site's origin, for challenge links. Matches `site` in astro.config.mjs. */
export const SITE_URL = "https://biggerthangame.com";

/** The public source repository, linked from the footer. */
export const GITHUB_URL = "https://github.com/CharlieNathan22/BiggerThanGame";

/** How the site's address is written on the share image. */
export const SITE_LABEL = "biggerthangame.com";

/**
 * The Turnstile widget's site key, for the feedback forms. Public by design:
 * it only identifies the widget, and the secret stays in the Worker. From the
 * Turnstile dashboard; the widget allows biggerthangame.com, www and localhost.
 */
export const TURNSTILE_PROD_SITE_KEY = "0x4AAAAAAFE-kLACTXmVHqjj";

/**
 * Cloudflare's published test site key, which always passes. `pnpm dev` uses
 * it, paired with the always-pass test secret in `.dev.vars` (CLAUDE.md).
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

export const TURNSTILE_SITE_KEY = import.meta.env.DEV
  ? TURNSTILE_TEST_SITE_KEY
  : TURNSTILE_PROD_SITE_KEY;
