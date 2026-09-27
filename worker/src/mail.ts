/**
 * A plain-text email as raw MIME (RFC 5322 and 2045), for the Workers
 * `send_email` binding.
 *
 * Email Routing sends an `EmailMessage` built from `cloudflare:email` with the
 * raw message, so the message is written by hand here rather than pulling in a
 * MIME library. It only has to do one thing: a single `text/plain` UTF-8 part.
 *
 * Headers never carry user text. The subject is fixed per kind and must be
 * printable ASCII; the addresses come from config and a secret, and are
 * refused if they contain anything that could start a new header line. User
 * text goes only in the body, which is base64-encoded, so whatever it holds
 * can't be read as MIME structure.
 */

export interface PlainTextMail {
  readonly from: string;
  readonly to: string;
  /** Fixed text chosen by the server. Printable ASCII only. */
  readonly subject: string;
  readonly text: string;
  readonly date: Date;
  /** `<unique@domain>`. Email Routing requires a Message-ID. */
  readonly messageId: string;
}

/** A bare address: one `@`, no spaces, brackets, quotes or control characters. */
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const ADDRESS = /^[^\s@<>()",;:\\[\]\u0000-\u001f\u007f]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const MESSAGE_ID = /^<[^\s<>@]+@[a-z0-9.-]+>$/i;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/** Base64 lines are at most 76 characters (RFC 2045 §6.8). */
const LINE = 76;

export function isPlainAddress(address: string): boolean {
  return ADDRESS.test(address);
}

export function buildPlainTextMime(mail: PlainTextMail): string {
  if (!isPlainAddress(mail.from)) throw new Error("mail: from is not a plain address");
  if (!isPlainAddress(mail.to)) throw new Error("mail: to is not a plain address");
  if (!PRINTABLE_ASCII.test(mail.subject) || mail.subject.length > LINE) {
    throw new Error("mail: subject must be short printable ASCII");
  }
  if (!MESSAGE_ID.test(mail.messageId)) throw new Error("mail: malformed Message-ID");

  const headers = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    `Date: ${rfc5322Date(mail.date)}`,
    `Message-ID: ${mail.messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  const body = new TextEncoder().encode(mail.text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"));
  return `${headers.join("\r\n")}\r\n\r\n${wrap(toBase64(body))}\r\n`;
}

/** `Sat, 19 Sep 2026 14:30:00 +0000`. */
export function rfc5322Date(date: Date): string {
  return date.toUTCString().replace(/GMT$/, "+0000");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function wrap(base64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += LINE) lines.push(base64.slice(i, i + LINE));
  return lines.join("\r\n");
}
