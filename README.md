# BloxStar

Standalone storefront built with TanStack Start + Vite, deployed on Vercel.

## Development

```bash
npm install
npm run dev      # http://localhost:8080
npm run build
npm run typecheck
```

## Environment variables

See `.env.example`. Required in production:

- `DATABASE_URL` — Postgres (Neon) connection string
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` — transactional email
- `ADMIN_EMAILS` — comma-separated admin accounts
