import { createFileRoute } from "@tanstack/react-router";
import {
  EMAIL_RE,
  emailSender,
  sanitizeHtml,
  sanitizeSubject,
  sanitizeText,
} from "@/lib/email-guard";
import { clientIp, distributedRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { cookieValue, SESSION_COOKIE } from "@/lib/auth";
import { sameOrigin } from "@/lib/http";
import { sendResendEmail } from "@/lib/resend";

/**
 * Transactional email relay (Resend).
 *
 * The caller may only pick the recipient, subject and body copy. Sender
 * identity (from / from name / reply-to) is server controlled, HTML is
 * sanitised, and the endpoint is rate limited per IP and per recipient.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/public/email/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
        const ip = clientIp(request);

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "invalid_payload" }, 400);
        }

        const toRaw = body["to"] ?? body["email"];
        const to = (Array.isArray(toRaw) ? toRaw : [toRaw])
          .map((v) =>
            String(v ?? "")
              .trim()
              .toLowerCase(),
          )
          .filter((v) => EMAIL_RE.test(v))
          .slice(0, 5);
        if (to.length === 0) return json({ ok: false, error: "invalid_email" }, 400);

        const token = cookieValue(request, SESSION_COOKIE);
        if (!token) return json({ ok: false, error: "unauthorized" }, 401);
        const { db, ensureAuthSchema } = await import("@/lib/db");
        await ensureAuthSchema();
        const sql = db();
        const sess = (await sql`SELECT email, admin, expires_at FROM auth_sessions WHERE token=${token} LIMIT 1`) as Array<{email:string;admin:boolean;expires_at:string}>;
        const session = sess[0];
        if (!session || new Date(session.expires_at).getTime() < Date.now()) return json({ ok: false, error: "unauthorized" }, 401);
        if (!(await distributedRateLimit(sql, `email:ip:${ip}:${session.email}`, 10, 60000))) return tooManyRequests(60);
        if (!(await distributedRateLimit(sql, `email:user:${session.email}`, 30, 3600000))) return tooManyRequests(3600);
        const allowed = new Set([session.email.toLowerCase(), ...((process.env["ADMIN_EMAILS"]||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean))]);
        if (to.some(x=>!allowed.has(x))) return json({ ok: false, error: "recipient_not_allowed" }, 403);

        const apiKey = process.env["RESEND_API_KEY"];
        if (!apiKey) {
          console.error("[email/send] RESEND_API_KEY is not configured");
          return json({ ok: false, error: "email_send_failed" }, 500);
        }

        // Sender identity is never taken from the request body.
        const sender = emailSender();
        const subject = sanitizeSubject(body["subject"], "BloxStar");
        const html = sanitizeHtml(body["html"]);
        const text = sanitizeText(body["text"]);
        if (!html && !text) return json({ ok: false, error: "invalid_payload" }, 400);

        const sent = await sendResendEmail({
          from: sender.header,
          to,
          reply_to: sender.replyTo,
          subject,
          ...(html ? { html } : {}),
          ...(text ? { text } : {}),
        });
        if (!sent.ok) {
          return json({ ok: false, error: "email_send_failed" }, 502);
        }

        return json({ ok: true });
      },
    },
  },
});
