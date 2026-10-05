/**
 * Country codes for the leaderboards' flags (DESIGN.md §13): the ISO 3166-1
 * alpha-2 codes there is a flag for in apps/web/public/flags (circle-flags, MIT,
 * vendored at HatScripts/circle-flags@379588b5). A web test holds this list
 * and the files together.
 *
 * A published run's country is Cloudflare's `request.cf.country` for the
 * publishing connection, kept only if the player leaves "Show my country flag"
 * ticked and only if it is one of these: Cloudflare's "XX" (unknown) and "T1"
 * (Tor) are not, so they give no flag. Nothing finer than the code is ever
 * kept. The UK's nations have flags too (gb-eng, gb-sct, gb-wls, gb-nir), but
 * Cloudflare only ever says GB, so they aren't codes a run can carry.
 */

// prettier-ignore
export const FLAG_COUNTRIES: ReadonlySet<string> = new Set([
  "AC", "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AN", "AO", "AQ", "AR", "AS", "AT", "AU", "AW",
  "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ",
  "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL",
  "CM", "CN", "CO", "CP", "CQ", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DG", "DJ", "DK",
  "DM", "DO", "DZ", "EA", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "EU", "FI", "FJ", "FK", "FM",
  "FO", "FR", "FX", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ",
  "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "IC", "ID", "IE", "IL",
  "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM",
  "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV",
  "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR",
  "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO",
  "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS",
  "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH",
  "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SU", "SV", "SX", "SY", "SZ", "TA",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UK", "UM", "UN", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF",
  "WS", "XK", "YE", "YT", "YU", "ZA", "ZM", "ZW",
]);

/** A country code there is a flag for, upper case; null for anything else. */
export function flagCountry(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const upper = code.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) && FLAG_COUNTRIES.has(upper) ? upper : null;
}
