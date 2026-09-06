import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight, safeHandler, sameOrigin } from "@/lib/http";
import { clientIp, distributedRateLimit } from "@/lib/rate-limit";
import { sessionCookie, newToken, isAdminEmail } from "@/lib/auth";

export const Route = createFileRoute("/api/public/auth/verify-code")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) =>
        safeHandler(request, "auth/verify-code", async () => {
          const json = (body: unknown, status = 200) => jsonResponse(request, body, status);

          if (!sameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
          let body: Record<string, unknown>;
          try {
            body = (await request.json()) as Record<string, unknown>;
          } catch {
            return json({ ok: false, error: "invalid" }, 400);
          }

          const email = String(body["email"] ?? "")
            .trim()
            .toLowerCase();
          const code = String(body["code"] ?? "").trim();
          if (!email || !/^\d{4,8}$/.test(code)) return json({ ok: false, error: "invalid" }, 400);

          if (!process.env["DATABASE_URL"]) {
            console.error("[auth/verify-code] DATABASE_URL is not configured");
            return json({ ok: false, error: "not-configured" }, 500);
          }

          const { db, ensureAuthSchema } = await import("@/lib/db");
          await ensureAuthSchema();
          const sql = db();
          if (!(await distributedRateLimit(sql, `otpverify:ip:${clientIp(request)}`, 20, 900000))) return json({ ok: false, error: "rate_limited" }, 429);
          if (!(await distributedRateLimit(sql, `otpverify:email:${email}`, 10, 900000))) return json({ ok: false, error: "rate_limited" }, 429);

          const rows = (await sql`
            SELECT id, code, expires_at, attempts FROM auth_codes
            WHERE email = ${email}
            ORDER BY created_at DESC
            LIMIT 1
          `) as Array<{ id: string; code: string; expires_at: string; attempts: number }>;

          const row = rows[0];
          if (!row) return json({ ok: false, error: "expired" }, 400);
          if (new Date(row.expires_at).getTime() < Date.now()) {
            await sql`DELETE FROM auth_codes WHERE id = ${row.id}`;
            return json({ ok: false, error: "expired" }, 400);
          }
          if (row.attempts >= 5) {
            await sql`DELETE FROM auth_codes WHERE id = ${row.id}`;
            return json({ ok: false, error: "expired" }, 429);
          }
          if (String(row.code).trim() !== code) {
            await sql`UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ${row.id}`;
            return json({ ok: false, error: "invalid" }, 400);
          }

          await sql`DELETE FROM auth_codes WHERE id = ${row.id}`;

          const token = newToken();
          const admin = isAdminEmail(email);
          try {
            await sql`
              INSERT INTO auth_sessions (token, email, admin, expires_at)
              VALUES (${token}, ${email}, ${admin}, now() + interval '30 days')
            `;
          } catch (error) {
            console.error("[auth/verify-code] session insert failed", error);
            return json({ ok: false, error: "invalid" }, 500);
          }

          const response = json({ ok: true, email, admin });
          response.headers.set("set-cookie", sessionCookie(token));
          return response;
        }),
    },
  },
});
