import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie, cookieValue, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { jsonResponse, preflight, safeHandler, sameOrigin } from "@/lib/http";

export const Route = createFileRoute("/api/public/auth/session")({
  server: { handlers: {
    OPTIONS: async ({ request }) => preflight(request),
    GET: async ({ request }) => validate(request),
    POST: async ({ request }) => validate(request),
    DELETE: async ({ request }) => safeHandler(request, "auth/session/logout", async () => {
      if (!sameOrigin(request)) return jsonResponse(request, { ok: false, error: "forbidden" }, 403);
      const token = cookieValue(request, SESSION_COOKIE);
      if (token && process.env["DATABASE_URL"]) {
        try { const { db } = await import("@/lib/db"); await db()`DELETE FROM auth_sessions WHERE token = ${token}`; } catch (e) { console.error("[auth/session/logout] failed", e instanceof Error ? e.name : "unknown"); }
      }
      const res = jsonResponse(request, { ok: true }); res.headers.set("set-cookie", clearSessionCookie()); return res;
    }),
  }},
});

async function validate(request: Request): Promise<Response> {
  return safeHandler(request, "auth/session", async () => {
    const json = (body: unknown, status = 200) => jsonResponse(request, body, status);
    const token = cookieValue(request, SESSION_COOKIE);
    if (!token || !process.env["DATABASE_URL"]) return json({ ok: false }, 401);
    const { db } = await import("@/lib/db"); const sql = db();
    const rows = (await sql`SELECT email, admin, expires_at FROM auth_sessions WHERE token = ${token} LIMIT 1`) as Array<{email:string;admin:boolean;expires_at:string}>;
    const row=rows[0];
    if(!row) return json({ok:false},401);
    if(new Date(row.expires_at).getTime()<Date.now()){ await sql`DELETE FROM auth_sessions WHERE token=${token}`; const res=json({ok:false},401); res.headers.set("set-cookie",clearSessionCookie()); return res; }
    return json({ok:true,email:row.email,admin:isAdminEmail(row.email)});
  });
}
