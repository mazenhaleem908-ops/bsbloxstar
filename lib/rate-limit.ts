import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export function clientIp(request: Request): string {
  // Prefer Vercel's trusted forwarded chain; do not trust arbitrary client headers
  // when an upstream proxy is absent.
  const h = request.headers;
  const forwarded = h.get("x-forwarded-for") || h.get("x-real-ip") || "";
  return (forwarded.split(",")[0] || "unknown").trim().slice(0, 64) || "unknown";
}

/** Distributed fixed-window limiter backed by Neon. Atomic upsert makes it safe
 * across Vercel isolates/regions. The in-memory limiter is intentionally gone. */
export async function distributedRateLimit(sql: Sql, key: string, limit: number, windowMs: number): Promise<boolean> {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const rows = (await sql`
    INSERT INTO rate_limit_buckets (key, window_start, hits)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      window_start = CASE
        WHEN rate_limit_buckets.window_start <= now() - (${windowSeconds} * interval '1 second') THEN now()
        ELSE rate_limit_buckets.window_start
      END,
      hits = CASE
        WHEN rate_limit_buckets.window_start <= now() - (${windowSeconds} * interval '1 second') THEN 1
        ELSE rate_limit_buckets.hits + 1
      END
    RETURNING hits
  `) as Array<{ hits: number }>;
  return Number(rows[0]?.hits ?? limit + 1) <= limit;
}

export const tooManyRequests = (retryAfterSeconds = 60) =>
  new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds), "cache-control": "no-store" },
  });
