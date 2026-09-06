/**
 * End-to-end auth verification harness.
 *
 * Lives inside the project so the `@/` alias resolves for any project imports.
 * Run against a running dev server:
 *
 *   BASE_URL=http://localhost:8080 TEST_EMAIL=you@example.com bun scripts/verify-auth.mjs
 *
 * Requires the same environment the app needs: DATABASE_URL (Neon),
 * RESEND_API_KEY, RESEND_FROM_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MOONPAY_SECRET_KEY,
 * GOOGLE_CLIENT_SECRET.
 */
import { neon } from "@neondatabase/serverless";

const BASE = process.env.BASE_URL || "http://localhost:8080";
const EMAIL = (process.env.TEST_EMAIL || "verify+otp@bloxistar.com").toLowerCase();

let cookie = "";
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function health() {
  const res = await fetch(`${BASE}/api/public/auth/health`);
  const body = await res.json();
  const missing = Object.entries(body.env ?? {})
    .filter(([, v]) => !v)
    .map(([k]) => k);
  record(
    "auth health / env",
    res.ok && body.ok === true,
    missing.length ? `missing env: ${missing.join(", ")}` : "all env present",
  );
  return body;
}

async function emailOtp() {
  const send = await fetch(`${BASE}/api/public/auth/send-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL }),
  });
  const sendBody = await send.json().catch(() => ({}));
  if (!send.ok || sendBody.ok !== true) {
    record("email otp / send-code", false, `${send.status} ${JSON.stringify(sendBody)}`);
    return;
  }
  record("email otp / send-code", true, "code issued + email dispatched");

  if (!process.env.DATABASE_URL) {
    record("email otp / verify-code", false, "cannot read issued code: DATABASE_URL not set");
    return;
  }
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT code FROM auth_codes WHERE email = ${EMAIL} ORDER BY created_at DESC LIMIT 1
  `;
  const code = rows[0]?.code;
  if (!code) {
    record("email otp / verify-code", false, "no auth_codes row found for test email");
    return;
  }

  const verify = await fetch(`${BASE}/api/public/auth/verify-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, code }),
  });
  const vBody = await verify.json().catch(() => ({}));
  const setCookie = verify.headers.get("set-cookie") || "";
  cookie = setCookie.split(";")[0] || "";
  const ok = verify.ok && vBody.ok === true && !!cookie;
  record("email otp / verify-code", ok, ok ? "HttpOnly session cookie issued" : JSON.stringify(vBody));
  if (!ok) return;

  const session = await fetch(`${BASE}/api/public/auth/session`, { headers: cookie ? { cookie } : {} });
  const sBody = await session.json().catch(() => ({}));
  record(
    "email otp / session",
    session.ok && String(sBody.email ?? "").toLowerCase() === EMAIL,
    JSON.stringify(sBody),
  );
}

async function googleOauth() {
  const res = await fetch(`${BASE}/api/public/auth/google/start?return=/`, { redirect: "manual" });
  const location = res.headers.get("location") || "";
  if (res.status !== 302) {
    record("google oauth / start", false, `expected 302, got ${res.status}`);
    return;
  }
  if (!location.startsWith("https://accounts.google.com/")) {
    record("google oauth / start", false, `not redirected to Google: ${location}`);
    return;
  }
  const u = new URL(location);
  const need = ["client_id", "redirect_uri", "state", "code_challenge", "scope"];
  const missing = need.filter((k) => !u.searchParams.get(k));
  record(
    "google oauth / start",
    missing.length === 0 && u.searchParams.get("code_challenge_method") === "S256",
    missing.length ? `missing params: ${missing.join(", ")}` : "authorize URL with PKCE S256",
  );
  if (missing.length) return;

  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT state FROM auth_oauth_states WHERE state = ${u.searchParams.get("state")} LIMIT 1
    `;
    record("google oauth / state persisted", rows.length === 1, `${rows.length} row(s)`);
  } else {
    record("google oauth / state persisted", false, "DATABASE_URL not set");
  }

  const cb = await fetch(`${BASE}/api/public/auth/google/callback?error=access_denied&state=x`, {
    redirect: "manual",
  });
  record(
    "google oauth / callback error handling",
    cb.status === 302 && (cb.headers.get("location") || "").includes("bs_google_error"),
    `${cb.status} ${cb.headers.get("location")}`,
  );
}

await health();
await emailOtp();
await googleOauth();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
