/**
 * Server-controlled email sender settings and HTML sanitising.
 *
 * The browser may only choose the recipient, subject and body copy. Sender
 * identity (from / from name / reply-to) always comes from server env, and any
 * HTML body is stripped of active content so a caller cannot inject scripts,
 * frames or spoofed sender headers into a mail sent from our domain.
 */

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailSender() {
  const from = (process.env["RESEND_FROM_EMAIL"] || "business@bloxistar.com").trim();
  const fromName = (process.env["RESEND_FROM_NAME"] || "BloxStar").trim();
  const replyTo = (process.env["RESEND_REPLY_TO"] || from).trim();
  return { from, fromName, replyTo, header: `${fromName} <${from}>` };
}

/** Remove scripts, frames, event handlers and javascript: URLs from client HTML. */
export function sanitizeHtml(input: unknown): string | undefined {
  if (input == null) return undefined;
  let html = String(input).slice(0, 100000);
  html = html
    .replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/data:text\/html/gi, "");
  return html.trim() || undefined;
}

export function sanitizeText(input: unknown): string | undefined {
  if (input == null) return undefined;
  const text = String(input).slice(0, 20000).trim();
  return text || undefined;
}

export function sanitizeSubject(input: unknown, fallback: string): string {
  const subject = String(input ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  return subject || fallback;
}
