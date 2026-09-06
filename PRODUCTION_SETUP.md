# BloxStar production setup

Required Vercel environment variables:

- `DATABASE_URL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=business@bloxistar.com`
- `RESEND_FROM_NAME=BloxStar`
- `RESEND_REPLY_TO=business@bloxistar.com`
- `ADMIN_EMAILS=<comma-separated server-only admin emails>`
- `MOONPAY_SECRET_KEY=<MoonPay server API key>`
- `MOONPAY_WALLET_ADDRESS=<BloxStar destination wallet>`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://www.bloxistar.com/api/public/auth/google/callback`
- `APP_ORIGIN=https://www.bloxistar.com`

Do not put any of these values in the repository except safe placeholders in `.env.example`.

Before the first production deployment, apply `db/schema.sql` to Neon.
Then apply the additive `db/migrations/002_admin_panel.sql` migration to enable the `/admin` workspace tables.
Do not run either migration repeatedly through the application runtime; apply them once through your Neon SQL console/migration workflow.
