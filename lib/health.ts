// Shared health-check helper used by the Vercel health endpoint.
// Reports runtime config presence and a live database ping.

export interface HealthReport {
  ok: boolean;
  env: Record<string, boolean | string | null>;
  database: boolean;
  databaseError: string | null;
  googleReady: boolean;
  timestamp: string;
}

export async function healthReport(): Promise<HealthReport> {
  const resendKey = (process.env["RESEND_API_KEY"] || "").trim();
  const env = {
    DATABASE_URL: !!process.env["DATABASE_URL"],
    RESEND_API_KEY: !!resendKey,
    RESEND_MODE: !resendKey ? "missing" : resendKey.startsWith("re_") ? "direct" : "invalid-key",
    GOOGLE_CLIENT_ID: !!process.env["GOOGLE_CLIENT_ID"],
    GOOGLE_CLIENT_SECRET: !!process.env["GOOGLE_CLIENT_SECRET"],
    MOONPAY_SECRET_KEY: !!process.env["MOONPAY_SECRET_KEY"],
    APP_ORIGIN: process.env["APP_ORIGIN"] || null,
  };

  let dbOk = false;
  let dbError: string | null = null;
  if (env.DATABASE_URL) {
    try {
      const { db } = await import("@/lib/db");
      await db()`SELECT 1`;
      dbOk = true;
    } catch (e) {
      dbError = e instanceof Error ? e.message : "unknown";
    }
  }

  const googleReady = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET;
  const ok = env.DATABASE_URL && env.RESEND_API_KEY && googleReady && dbOk;

  return { ok, env, database: dbOk, databaseError: dbError, googleReady, timestamp: new Date().toISOString() };
}
