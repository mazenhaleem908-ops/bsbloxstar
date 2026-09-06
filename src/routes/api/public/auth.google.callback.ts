// Google OAuth 2.0 / OIDC — step 2: Google redirects here with ?code&state.
// The code is exchanged server-side (client secret + PKCE verifier), the ID
// token claims are validated, and a real Neon `auth_sessions` row is created —
// the exact same session the email-OTP login produces.
//
// The browser is then redirected back to the storefront with a single-use
// hand-off code (never the session token itself).
import { createFileRoute } from "@tanstack/react-router";

import { isAdminEmail, newToken, randomUrlSafe, sessionCookie, verifyOidcJwt } from "@/lib/auth";
import { preflight } from "@/lib/http";
import { clientIp, distributedRateLimit } from "@/lib/rate-limit";

type StateRow = {
  code_verifier: string;
  redirect_uri: string;
  return_to: string;
  nonce: string;
  expires_at: string;
};

export const Route = createFileRoute("/api/public/auth/google/callback")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const providerError = url.searchParams.get("error");

        let returnTo = "/";
        const back = (params: Record<string, string>) => {
          const query = new URLSearchParams(params).toString();
          return new Response(null, {
            status: 302,
            headers: {
              location: `${returnTo}${returnTo.includes("?") ? "&" : "?"}${query}`,
              "cache-control": "no-store",
            },
          });
        };

        try {
          if (providerError) return back({ bs_google_error: "denied" });
          if (!code || !state) return back({ bs_google_error: "invalid-response" });

          const clientId = process.env["GOOGLE_CLIENT_ID"];
          const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
          if (!clientId || !clientSecret || !process.env["DATABASE_URL"]) {
            console.error("[auth/google/callback] not configured");
            return back({ bs_google_error: "not-configured" });
          }

          const { db, ensureAuthSchema } = await import("@/lib/db");
          await ensureAuthSchema();
          const sql = db();
          if (!(await distributedRateLimit(sql, `googlecb:ip:${clientIp(request)}`, 30, 900000))) return back({ bs_google_error: "rate-limited" });

          const rows = (await sql`
            SELECT code_verifier, redirect_uri, return_to, nonce, expires_at
            FROM auth_oauth_states WHERE state = ${state} LIMIT 1
          `) as StateRow[];
          const pending = rows[0];
          // Single use: the state row is consumed whether or not it is valid.
          await sql`DELETE FROM auth_oauth_states WHERE state = ${state}`;
          if (!pending) return back({ bs_google_error: "expired" });
          returnTo = pending.return_to || "/";
          if (new Date(pending.expires_at).getTime() < Date.now()) {
            return back({ bs_google_error: "expired" });
          }

          const tokenEndpoint =
            process.env["GOOGLE_TOKEN_ENDPOINT"] || "https://oauth2.googleapis.com/token";
          const tokenRes = await fetch(tokenEndpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: pending.redirect_uri,
              grant_type: "authorization_code",
              code_verifier: pending.code_verifier,
            }),
          });
          if (!tokenRes.ok) {
            console.error(
              "[auth/google/callback] token exchange failed",
              tokenRes.status,
              await tokenRes.text(),
            );
            return back({ bs_google_error: "exchange-failed" });
          }

          const tokens = (await tokenRes.json()) as { id_token?: string };
          const claims = tokens.id_token ? await verifyOidcJwt(tokens.id_token, clientId) : null;
          if (!claims) return back({ bs_google_error: "invalid-token" });

          const iss = String(claims["iss"] ?? "");
          const audClaim = claims["aud"];
          const aud = Array.isArray(audClaim) ? audClaim.map(String) : [String(audClaim ?? "")];
          const exp = Number(claims["exp"] ?? 0);
          const email = String(claims["email"] ?? "")
            .trim()
            .toLowerCase();
          const emailVerified =
            claims["email_verified"] === true || claims["email_verified"] === "true";

          const expectedIssuer = process.env["GOOGLE_ISSUER"] || "";
          const issuerOk = expectedIssuer
            ? iss === expectedIssuer
            : iss === "https://accounts.google.com" || iss === "accounts.google.com";
          if (!issuerOk) {
            return back({ bs_google_error: "invalid-token" });
          }
          if (!aud.includes(clientId)) return back({ bs_google_error: "invalid-token" });
          if (!exp || exp * 1000 < Date.now()) return back({ bs_google_error: "invalid-token" });
          if (String(claims["nonce"] ?? "") !== String(pending.nonce ?? "")) return back({ bs_google_error: "invalid-token" });
          if (!email || !emailVerified) return back({ bs_google_error: "unverified-email" });

          const admin = isAdminEmail(email);
          const token = newToken();
          await sql`
            INSERT INTO auth_sessions (token, email, admin, expires_at)
            VALUES (${token}, ${email}, ${admin}, now() + interval '30 days')
          `;

          const name =
            String(claims["name"] ?? "").trim() ||
            String(claims["given_name"] ?? "").trim() ||
            email.split("@")[0] ||
            "Player";
          const picture = String(claims["picture"] ?? "");

          const handoff = randomUrlSafe(24);
          await sql`DELETE FROM auth_login_codes WHERE expires_at < now()`;
          await sql`
            INSERT INTO auth_login_codes (code, token, email, admin, name, picture, expires_at)
            VALUES (${handoff}, ${token}, ${email}, ${admin}, ${name}, ${picture}, now() + interval '2 minutes')
          `;

          // The email is already proven by Google, so no OTP is required.
          const response = back({ bs_google_code: handoff });
          response.headers.set("set-cookie", sessionCookie(token));
          return response;
        } catch (error) {
          console.error("[auth/google/callback] failed", error);
          return back({ bs_google_error: "server_error" });
        }
      },
    },
  },
});
