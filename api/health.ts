// Vercel serverless health endpoint — GET /api/health
// Standalone function (not a TanStack route) so it works even when
// the SSR server is starting up. Returns 200 when healthy, 503 otherwise.
import { healthReport } from "../lib/health";

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default async function handler(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === "HEAD") return new Response(null, { status: 200, headers: HEADERS });
  if (method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { ...HEADERS, allow: "GET, HEAD" },
    });
  }
  const report = await healthReport();
  return new Response(JSON.stringify(report), {
    status: report.ok ? 200 : 503,
    headers: HEADERS,
  });
}
