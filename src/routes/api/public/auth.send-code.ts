import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight, safeHandler, sameOrigin } from "@/lib/http";
import { clientIp, distributedRateLimit } from "@/lib/rate-limit";
import { sendResendEmail } from "@/lib/resend";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const Route = createFileRoute("/api/public/auth/send-code")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) =>
        safeHandler(request, "auth/send-code", async () => {
          const json = (body: unknown, status = 200) => jsonResponse(request, body, status);

          if (!sameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
          let body: Record<string, unknown>;
          try {
            body = (await request.json()) as Record<string, unknown>;
          } catch {
            return json({ ok: false, error: "invalid_email" }, 400);
          }

          const email = String(body["email"] ?? "")
            .trim()
            .toLowerCase();
          if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);

          if (!process.env["DATABASE_URL"]) {
            console.error("[auth/send-code] DATABASE_URL is not configured");
            return json({ ok: false, error: "not-configured" }, 500);
          }
          const apiKey = process.env["RESEND_API_KEY"];
          if (!apiKey) {
            console.error("[auth/send-code] RESEND_API_KEY is not configured");
            return json({ ok: false, error: "not-configured" }, 500);
          }

          const { db, ensureAuthSchema } = await import("@/lib/db");
          await ensureAuthSchema();
          const sql = db();
          if (!(await distributedRateLimit(sql, `otp:ip:${clientIp(request)}`, 10, 3600000))) return json({ ok: false, error: "rate_limited" }, 429);
          if (!(await distributedRateLimit(sql, `otp:email:${email}`, 5, 3600000))) return json({ ok: false, error: "rate_limited" }, 429);

          // one code per minute, per email
          const recent = await sql`
            SELECT created_at FROM auth_codes
            WHERE email = ${email} AND created_at > now() - interval '60 seconds'
            LIMIT 1
          `;
          if (recent.length > 0) return json({ ok: false, error: "rate_limited" }, 429);

          const bytes = new Uint32Array(1);
          crypto.getRandomValues(bytes);
          const code = String(100000 + ((bytes[0] ?? 0) % 900000));

          try {
            await sql`DELETE FROM auth_codes WHERE email = ${email}`;
            await sql`
              INSERT INTO auth_codes (email, code, expires_at)
              VALUES (${email}, ${code}, now() + interval '10 minutes')
            `;
          } catch (insertError) {
            console.error("[auth/send-code] db insert failed", insertError);
            return json({ ok: false, error: "send-failed" }, 500);
          }

          // Fully server-controlled email. Any client-supplied `from`, `fromName`,
          // `replyTo`, `subject`, `html` or `text` is ignored: the sender identity
          // comes only from the server environment and the OTP body is rendered
          // from the server-side template below.
          const from = process.env["RESEND_FROM_EMAIL"] || "business@bloxistar.com";
          const fromName = process.env["RESEND_FROM_NAME"] || "BloxStar";
          const replyTo = process.env["RESEND_REPLY_TO"] || from;
          const subject = "Your BloxStar verification code";
          const html =
            `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#111">` +
            `<p>Your BloxStar verification code is:</p>` +
            `<p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p>` +
            `<p>It expires in 10 minutes. If you didn't request it, you can ignore this email.</p>` +
            `<p style="color:#666;font-size:13px">— ${fromName}</p>` +
            `</div>`;
          const text = `Your BloxStar verification code is ${code}. It expires in 10 minutes.`;


          const sent = await sendResendEmail({
            from: `${fromName} <${from}>`,
            to: [email],
            reply_to: replyTo,
            subject,
            html,
            text,
          });
          if (!sent.ok) {
            return json({ ok: false, error: "email_send_failed" }, 502);
          }

          return json({ ok: true });
        }),
    },
  },
});
