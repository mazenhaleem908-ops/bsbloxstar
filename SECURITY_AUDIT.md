# BloxStar Security + Production Readiness Audit

Audit target: `bloxistar-wallet-server-fix.zip`

## Results

| Area | Result | Notes |
|---|---|---|
| 1. Payment / Order security | PASS* | Orders are created only after server-side MoonPay transaction verification. Admin confirm requires `paymentVerified`. Crypto remains manual/pending in the existing UI flow. |
| 2. Stock reservation races | PASS | Atomic PostgreSQL `create_order_atomic`; sorted item locking; unique `intent_id`; failed statement rolls back reservation. |
| 3. Unavailable products | PASS | Backend rejects catalogue entries where `a !== true` and validates prices server-side. |
| 4. Rate limiting | PASS | Vercel-safe distributed limiter backed by Neon, applied to OTP, Google, orders, wallet and email-sensitive paths. |
| 5. Sessions | PASS | Authentication token is an HttpOnly/Secure/SameSite cookie; localStorage keeps only non-secret display state. |
| 6. Password/auth code | PASS | Legacy local password authentication no longer authenticates or stores passwords. Email OTP and Google OIDC remain. |
| 7. Google OAuth | PASS | PKCE S256 + single-use state + nonce + Google JWKS RSA signature verification + issuer/audience/expiry/nbf/azp/email_verified checks. |
| 8. Email APIs | PASS | Authentication required; sender controlled server-side; recipient restrictions, HTML sanitization and distributed limits. |
| 9. Security headers | PASS | HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame protection and CSP added in Vercel config. |
| 10. API authorization | PASS* | Sensitive routes require the server session; orders are scoped by authenticated email; admin is derived server-side from `ADMIN_EMAILS`. |
| 11. Neon / database | PASS* | Parameterized queries and atomic DB functions. Production should apply `db/schema.sql` using a migration-capable DB role and keep runtime DB credentials least-privileged. |
| 12. Secrets | PASS | No real Resend/Google/MoonPay/DB secret is included. `.env` and `.env.*` are ignored except `.env.example`. |
| 13. Legacy cleanup | PASS | Removed legacy provider runtime/auth files, Lovable runtime remnants, Firebase references and old payment-provider runtime references. |
| 14. 341 products | PASS | `src/lib/catalog.ts` SHA-256 is unchanged from the supplied ZIP; catalog contains 341 entries. |
| 15. Production tests | FAIL (environment) | Full production build/E2E could not be executed in this audit container because the supplied `node_modules` is incomplete (`vite` is missing) and npm registry installation timed out. Browser/Neon/MoonPay live tests therefore remain to be run in CI/Vercel. |

## Important deployment requirement

`MOONPAY_SECRET_KEY` must be configured in Vercel. The backend now fails closed unless it can verify the completed MoonPay transaction server-side. The verification checks the completed status, USD amount, BloxStar destination wallet and the authenticated customer's `externalCustomerId`.

The frontend sends the authenticated account email as MoonPay `externalCustomerId` so a completed transaction cannot simply be reused from another BloxStar account.

## Database migration

Apply `db/schema.sql` once to the production Neon database before deploying this version. The schema includes the distributed rate-limit table, atomic order functions, reservation expiry support and atomic wallet operations.

Runtime code is not permitted to trust client-supplied prices, payment status, admin identity or authentication tokens.

## Why this is not marked READY FOR PRODUCTION

The source-level Critical/High issues requested in the audit were addressed, but a truthful production sign-off requires the actual deployed environment to pass TypeScript, production build, live Email OTP, live Google OAuth, live MoonPay verification, concurrency tests and browser smoke tests. Those live tests could not be completed here because the uploaded project does not contain a complete installable dependency tree and external npm installation timed out.

Do not treat this report as proof that the current Vercel deployment is already running this exact ZIP.
