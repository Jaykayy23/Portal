# SomoExpress — Merchant Delivery Portal

A merchant delivery request & pricing tool for SomoExpress's interim operating
model: merchants log delivery requests with distance-based pricing, ops/admin
assign riders, and everyone gets one-tap WhatsApp/SMS alerts.

This is a single **Next.js** application — the UI and the API live in the same
project and run as one process.

```
somoexpress-portal/
├── app/
│   ├── api/          Route Handlers (the JSON API)
│   ├── login/        Login screen
│   ├── setup/        First-run admin creation
│   └── portal/       The signed-in app, one route per tab
├── components/       React components, grouped by feature
├── lib/              Database, auth, pricing, formatting
├── data/db.json      Your data lives here
├── middleware.ts     Redirects anonymous visitors to /login
├── Dockerfile
└── docker-compose.yml
```

---

## 1. Local installation (your own computer)

**Requirements:** [Node.js](https://nodejs.org) 18.18 or newer.

```bash
cd somoexpress-portal
npm install
cp .env.example .env
```

Open `.env` and set a real `JWT_SECRET` (a long random string — the example file
shows a one-line command to generate one). Then:

```bash
npm run build
```

```bash
npm start
```

Open **http://localhost:4000**. The first screen asks you to create the admin
account — that's the account you'll use to create merchant and ops accounts, add
riders, set pricing, and configure API keys.

For development with hot reloading, use `npm run dev` instead of
`build` + `start`.

To stop the server, `Ctrl+C` in that terminal. Your data (accounts, riders,
deliveries, pricing, settings) is saved in `data/db.json` and is still there next
time you start it.

### Running for other people on your local network

Replace `localhost` with your computer's local IP address (e.g.
`http://192.168.1.20:4000`) — find it with `ipconfig` (Windows) or
`ifconfig`/`ip a` (Mac/Linux). Make sure your firewall allows inbound
connections on port 4000.

---

## 2. Web server installation (a real deployment)

### Option A — Docker (recommended, least fiddly)

**Requirements:** Docker and Docker Compose on the server.

```bash
cd somoexpress-portal
cp .env.example .env
# edit .env and set a real JWT_SECRET

docker compose up -d --build
```

The app runs on port 4000 of that server, with its data persisted in a Docker
volume (`somoexpress-data`) so it survives container restarts and rebuilds.

Put a reverse proxy in front of it for HTTPS on your real domain. Example with
**Nginx**:

```nginx
server {
    listen 80;
    server_name portal.somoexpress.example;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then get a certificate (e.g. `certbot --nginx -d portal.somoexpress.example`)
and Nginx/Certbot will handle HTTPS from there.

### Option B — Plain Node.js on the server (no Docker)

**Requirements:** Node.js 18.18+ and a process manager so the app restarts if it
crashes or the server reboots.

```bash
cd somoexpress-portal
npm ci
cp .env.example .env
# edit .env: set a real JWT_SECRET

npm run build

npm install -g pm2
pm2 start npm --name somoexpress -- start
pm2 save
pm2 startup   # follow the printed instructions so it survives a reboot
```

Then put the same kind of Nginx reverse-proxy config in front of it. To use a
port other than 4000, change the `-p` flag in the `start` script in
`package.json`.

### A note on where this can run

`data/db.json` is a file on a real disk, which means the app needs **one
long-running instance with persistent storage**. Docker, a VPS, or any
always-on Node host is fine.

It will *not* work correctly on a serverless platform (Vercel, Netlify
Functions, Lambda), because each invocation gets its own ephemeral filesystem —
writes would silently vanish or diverge between instances. If you need to deploy
there, migrate `lib/db.ts` to a hosted database first (see section 5).

---

## 3. First-run walkthrough

1. Open the app. Since no accounts exist yet, you'll be asked to create the
   **admin account** — username, phone number, and password. This becomes your
   first login.
2. Log in as admin, go to **Accounts**, and create:
   - **Ops team** accounts for whoever assigns riders day-to-day.
   - **Merchant** accounts for each corporate client (Jumia, Mr Wu, etc.) — each
     merchant only ever sees their own delivery requests.
3. Go to **Riders** and add your internal fleet (name, phone, motorbike
   registration number, and model — all required).
4. Go to **Pricing settings** and set the base fare, rate per km, minimum fare,
   minimum negotiable %, and the ops team's alert phone number.
5. Go to **Settings** to optionally add a logo and any API keys (Google Maps,
   WhatsApp, SMS, or others — see section 4 on what these actually do today).
6. Hand out login credentials to your merchants and ops team. Each account
   creation/reset screen shows the password **once** — write it down before
   closing that dialog.

---

## 4. What's real vs. what's a manual trigger

- **Passwords** are hashed with bcrypt on the server and never stored or
  transmitted in plain text after account creation.
- **Sessions** are a signed JWT in an `httpOnly` cookie. Page JavaScript can't
  read it, so a cross-site scripting bug can't steal a login. Every request
  re-checks the account in the database, which means **deactivating an account
  locks that person out immediately** rather than whenever their token expires.
- **Pricing** is calculated server-side from the saved parameters. The form shows
  a live preview, but the number that actually gets logged is recomputed by the
  server, so a client can't submit a fabricated price — nor a request filed under
  another merchant's name.
- **Merchant isolation** is enforced on the server before rendering: a merchant's
  browser never receives another merchant's deliveries at all.
- **Google Maps** (autocomplete + driving-distance lookup) is a real, working
  integration once an admin adds a Maps API key with Places API and Distance
  Matrix API enabled (with billing on) in Settings. Restrict that key by HTTP
  referrer in Google Cloud Console — it is sent to every **signed-in** browser,
  because the Maps JavaScript SDK has to run client-side.
- **WhatsApp/SMS alerts** work today as one-tap `wa.me` / `sms:` links that
  pre-fill the message — whoever's at the keyboard taps send. The WhatsApp and
  SMS **API key fields** in Settings are there so a developer can wire up true
  unattended sending later (e.g. Twilio, Africa's Talking, or Meta's WhatsApp
  Business API). That requires the server to call the provider directly using the
  stored key, which isn't implemented yet. Start from `whatsappOtpKey` and
  `smsApiKey` in `app/api/settings/route.ts`.

---

## 5. Backing up your data

Everything lives in one file: `data/db.json`. Back it up like you would any file
— copy it somewhere safe on a schedule. If you're running via Docker, back up the
`somoexpress-data` volume instead:

```bash
docker run --rm -v somoexpress-data:/data -v $(pwd):/backup alpine tar czf /backup/somoexpress-backup.tar.gz /data
```

Writes are serialized and written atomically (to a temp file, then renamed), so a
crash mid-write can't truncate the database.

If your delivery volume outgrows a single JSON file (heavy concurrent writes, a
need for real reporting/queries, or a multi-instance deploy), migrate
`lib/db.ts` to a real database — every route and page only calls the two
functions that module exports (`getDb` and `updateDb`), so that's a contained
change.

---

## 6. Troubleshooting

- **"Could not reach the server"** on the login screen — the app isn't running,
  or a reverse proxy in front of it is misconfigured.
- **Google Maps button stays disabled** — no Maps key has been saved in Settings
  yet, or the key doesn't have Places API + Distance Matrix API enabled with
  billing on. Check the browser console for the specific Google error.
- **Everyone is bounced back to the login screen** — `JWT_SECRET` changed (or is
  being generated fresh on each restart), which invalidates every existing
  session cookie. Set a fixed secret in `.env`.
- **`npm start` fails with EADDRINUSE** — something else is already on port 4000.
- **Forgot the admin password** — stop the server, open `data/db.json`, find the
  admin account under `accounts`, and either restore an earlier backup or ask a
  developer to run a small script using `lib/password.ts`'s `hashPassword()` to
  set a new hash directly in the file.

---

## 7. Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `JWT_SECRET` | insecure dev default (warns on boot) | Signs session cookies. **Set this.** |
| `JWT_EXPIRES_IN` | `30d` | How long a login stays valid. |
| `SOMO_DB_PATH` | `./data/db.json` | Where the database file lives. |
| `PORT` | `4000` | Used by the Docker image. Local runs set the port via the `-p` flag in `package.json`. |
| `BUILD_STANDALONE` | unset | Set to `1` at build time for a self-contained Docker output. The Dockerfile does this; you don't need to. |
