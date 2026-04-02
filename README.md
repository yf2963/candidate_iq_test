# IQ Test

NeoDym hiring assessment app with a fixed 80-question reasoning test, image-based questions, a 30-minute hard timer, automatic scoring, anti-cheat event logging, one-time candidate links, and an admin dashboard.

## Current scope

This version is optimized for the fastest path to a hosted working product tonight:

- candidate can open a one-time link and take the test
- results are stored in SQLite
- admin can log in, create candidate links, and review results
- anti-cheat signals are recorded (tab switch, copy/paste, right-click, fullscreen exits)
- frontend and backend run as a single deployable service in production

## Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Express + TypeScript
- **Database:** SQLite (`better-sqlite3`)
- **Email:** Resend (optional until configured)

## Local development

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## Production / Railway

### Railway service setup

1. Create a new Railway project.
2. Add one service for this app.
3. Connect the GitHub repo that contains the `IQ Test` project.
4. Set the root directory to the app folder if your repo contains multiple projects.
5. Set the build command to `npm run build`.
6. Set the start command to `npm start`.
7. Add the required environment variables listed below.
8. Deploy once.
9. Attach a persistent volume before treating the app as durable.
10. After deploy, set `PUBLIC_APP_URL` to the Railway public URL first, then later to your custom domain.

### Build command

```bash
npm run build
```

### Start command

```bash
npm start
```

`npm start` runs the Express server, which in production serves:
- API routes under `/api`
- question images under `/question-images`
- the built frontend from `dist/`
- SPA fallback for non-API, non-static routes

## Required environment variables

Set these in Railway:

```env
PORT=3001
NODE_ENV=production
PUBLIC_APP_URL=https://<your-railway-domain-or-custom-domain>
ADMIN_EMAIL=<admin-email>
ADMIN_PASSWORD=<admin-password>
JWT_SECRET=<long-random-secret>
ADMIN_TOKEN=<legacy-token-placeholder>
RESEND_API_KEY=<optional-until-email-is-configured>
EMAIL_FROM=<sender-email>
COOKIE_SECURE=true
COOKIE_DOMAIN=
VITE_API_BASE_URL=
VITE_ASSET_BASE_URL=
```

### Notes

- `VITE_API_BASE_URL` should stay blank for same-origin production use.
- `VITE_ASSET_BASE_URL` should stay blank for same-origin production asset loading.
- `COOKIE_DOMAIN` can stay blank unless you explicitly need a custom cookie domain.
- `ADMIN_TOKEN` is legacy fallback only; admin login uses email/password cookie auth.

## SQLite persistence / volume requirement

The app stores results in:
- `data/iq-test.db`

On Railway, SQLite persistence is only reliable if you attach a persistent volume and keep the database file on that mounted volume. If you deploy without persistent storage, the database can be lost on restart or redeploy.

Fastest practical rule:
- **for testing:** you can deploy without a volume, but data is disposable
- **for real candidate use:** attach a persistent volume first

If you want stronger durability later, move to Postgres. That is not required for the fastest first deploy.

## Cookie/auth behavior in production

Admin auth uses an HTTP-only cookie named `admin_session`.

Production-safe behavior:
- `sameSite: 'lax'`
- `secure: true` in production (or when `COOKIE_SECURE=true`)
- `path: '/'`
- optional `COOKIE_DOMAIN` override if needed

For same-origin Railway deployment, this is the right default and should not break login.

## What this app already does

- fixed 80-question test in exact configured order
- image-based questions supported
- exact scoring key wired in
- 30-minute timer
- result storage
- one-time links
- anti-cheat event logging
- admin login/dashboard scaffolding

## Important honesty note

This app does **not** make remote testing cheat-proof. It makes cheating more annoying and more visible. That is useful; it is not magic.
