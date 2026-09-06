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

/**
 * Abandoned-cart reminder email (Resend).
 *
 * The storefront posts { email, subject, html, text } after 20 minutes of
 * inactivity. Sender identity is server controlled, HTML is sanitised, and the
 * endpoint is rate limited per IP and per recipient so it cannot be used as an
 * open mail relay.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/public/abandoned-cart")({
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

        const to = String(body["email"] ?? body["to"] ?? "")
          .trim()
          .toLowerCase();
        if (!EMAIL_RE.test(to)) return json({ ok: false, error: "invalid_email" }, 400);

        const token=cookieValue(request,SESSION_COOKIE); if(!token)return json({ok:false,error:"unauthorized"},401);
        const { db, ensureAuthSchema } = await import("@/lib/db"); await ensureAuthSchema();
        const sql=db();
        const rows=(await sql`SELECT email,expires_at FROM auth_sessions WHERE token=${token} LIMIT 1`) as Array<{email:string;expires_at:string}>;
        const session=rows[0]; if(!session||new Date(session.expires_at).getTime()<Date.now()||session.email.toLowerCase()!==to)return json({ok:false,error:"forbidden"},403);
        if(!(await distributedRateLimit(sql,`cart:ip:${ip}:${to}`,5,60000)))return tooManyRequests(60);
        if(!(await distributedRateLimit(sql,`cart:to:${to}`,1,3600000)))return tooManyRequests(3600);

        const html = sanitizeHtml(body["html"]);
        const text = sanitizeText(body["text"]);
        if (!html && !text) return json({ ok: false, error: "invalid_payload" }, 400);

        const apiKey = process.env["RESEND_API_KEY"];
        if (!apiKey) {
          console.error("[abandoned-cart] RESEND_API_KEY is not configured");
          return json({ ok: false, error: "email_send_failed" }, 500);
        }

        const sender = emailSender();
        const subject = sanitizeSubject(
          body["subject"],
          "You left something in your cart — BloxStar",
        );

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: sender.header,
            to: [to],
            reply_to: sender.replyTo,
            subject,
            ...(html ? { html } : {}),
            ...(text ? { text } : {}),
          }),
        });

        if (!res.ok) {
          const detail = await res.text();
          console.error("[abandoned-cart] resend failed", res.status, detail);
          return json({ ok: false, error: "email_send_failed" }, 502);
        }

        return json({ ok: true });
      },
    },
  },
});
