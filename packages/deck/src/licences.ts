/**
 * Image licences: which ones an image may carry, and where each one's legal
 * text lives.
 *
 * A licence is a legal obligation, not a convenience (DESIGN.md §13): CC
 * licences require attribution with a link to the licence itself, so the
 * credits page must link to the exact licence the photo was released under —
 * including a jurisdiction port, which is a different legal text from the
 * unported version.
 */

/** Unported licences an image may carry. */
export const ALLOWED_LICENCES = [
  "CC0",
  "PD",
  "CC-BY-2.0",
  "CC-BY-2.5",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC-BY-SA-2.0",
  "CC-BY-SA-2.5",
  "CC-BY-SA-3.0",
  "CC-BY-SA-4.0",
] as const;

/**
 * Versions that were ported to national jurisdictions. 4.0 was written to be
 * international and has no ports, so a `CC-BY-4.0-XX` code is always a mistake.
 */
export const PORTED_VERSIONS = ["2.0", "2.5", "3.0"] as const;

/**
 * A jurisdiction-ported licence, as Wikimedia Commons names them:
 * `CC-BY-3.0-BR`, `CC-BY-SA-2.5-ES`. The suffix is the two-letter jurisdiction
 * code in upper case; it becomes the lower-case path segment of the licence URL.
 */
const PORTED = /^CC-(BY|BY-SA)-(2\.0|2\.5|3\.0)-([A-Z]{2})$/;

/** Unported CC-BY and CC-BY-SA, any allowed version. */
const UNPORTED = /^CC-(BY|BY-SA)-(\d\.\d)$/;

export const LICENCE_RULE =
  "licence must be CC0, PD, CC-BY-{2.0,2.5,3.0,4.0}, CC-BY-SA-{2.0,2.5,3.0,4.0}, " +
  "or a 2.0/2.5/3.0 jurisdiction port with an upper-case country suffix, e.g. CC-BY-3.0-BR";

export function isAllowedLicence(licence: string): boolean {
  return (ALLOWED_LICENCES as readonly string[]).includes(licence) || PORTED.test(licence);
}

/**
 * The licence's canonical URL on creativecommons.org, for the credits page.
 *
 *   CC-BY-4.0        → https://creativecommons.org/licenses/by/4.0/
 *   CC-BY-SA-2.5-ES  → https://creativecommons.org/licenses/by-sa/2.5/es/
 *   CC0              → https://creativecommons.org/publicdomain/zero/1.0/
 *   PD               → undefined (public domain has no licence to link to)
 *
 * Throws for anything `isAllowedLicence` rejects; the schema has already
 * refused those, so reaching here with one is a bug.
 */
export function licenceUrl(licence: string): string | undefined {
  if (licence === "PD") return undefined;
  if (licence === "CC0") return "https://creativecommons.org/publicdomain/zero/1.0/";

  const ported = PORTED.exec(licence);
  if (ported !== null) {
    const [, kind, version, jurisdiction] = ported;
    return ccUrl(kind!, version!, jurisdiction!.toLowerCase());
  }

  const unported = UNPORTED.exec(licence);
  if (unported !== null && isAllowedLicence(licence)) {
    const [, kind, version] = unported;
    return ccUrl(kind!, version!);
  }

  throw new Error(`no licence URL for ${JSON.stringify(licence)}: not an allowed licence`);
}

function ccUrl(kind: string, version: string, jurisdiction?: string): string {
  const path = [kind.toLowerCase(), version, ...(jurisdiction !== undefined ? [jurisdiction] : [])];
  return `https://creativecommons.org/licenses/${path.join("/")}/`;
}
