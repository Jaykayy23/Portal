# SomoExpress — Merchant Delivery Portal

A merchant delivery request & pricing tool for SomoExpress's interim
operating model: merchants log delivery requests with distance-based
pricing, ops/admin assign riders, and everyone gets one-tap WhatsApp/SMS
alerts.

This package has two parts:

```
somoexpress-portal/
├── backend/     Node.js + Express API, with a JSON-file database
├── frontend/    Plain HTML/CSS/JS — no build step required
├── docker-compose.yml
└── README.md    (this file)
```

The backend serves the frontend itself by default, so for most installs you
only run **one** thing.

---

## 1. Local installation (your own computer)

**Requirements:** [Node.js](https://nodejs.org) 18 or newer.

```bash
cd somoexpress-portal/backend
npm install
cp .env.example .env
```

Open `.env` and set a real `JWT_SECRET` (a long random string — the example
file shows a one-line command to generate one). Leaving the default in place
is fine for trying the app out on your own machine, but not for anything
real.

```bash
npm start
```

Open **http://localhost:4000** in a browser. The first screen will ask you
to create the admin account — that's the account you'll use to create
merchant and ops accounts afterward, add riders, set pricing, and configure
API keys.

To stop the server, `Ctrl+C` in that terminal. Your data (accounts, riders,
deliveries, pricing, settings) is saved in `backend/data/db.json` and is
still there next time you run `npm start`.

### Running two machines on your local network

If other people on the same office network need to reach it, replace
`localhost` with your computer's local IP address (e.g.
`http://192.168.1.20:4000`) — find it with `ipconfig` (Windows) or
`ifconfig`/`ip a` (Mac/Linux). Make sure your firewall allows inbound
connections on port 4000.

---

## 2. Web server installation (a real deployment)

You have two reasonable options. Pick whichever your team is comfortable
maintaining.

### Option A — Docker (recommended, least fiddly)

**Requirements:** Docker and Docker Compose on the server.

```bash
cd somoexpress-portal
cp .env.example .env
# edit .env and set a real JWT_SECRET

docker compose up -d --build
```

The app is now running on port 4000 of that server, with its data persisted
in a Docker volume (`somoexpress-data`) so it survives container restarts
and rebuilds.

Put a reverse proxy in front of it for HTTPS on your real domain. Example
with **Nginx**:

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

**Requirements:** Node.js 18+ on the server, and a process manager so the
app restarts if it crashes or the server reboots.

```bash
cd somoexpress-portal/backend
npm install --omit=dev
cp .env.example .env
# edit .env: real JWT_SECRET, and set PORT if 4000 is taken

npm install -g pm2
pm2 start server.js --name somoexpress
pm2 save
pm2 startup   # follow the printed instructions so it survives a reboot
```

Then put the same kind of Nginx reverse-proxy config as Option A in front of
it, pointing `proxy_pass` at whatever `PORT` you chose.

### Serving frontend and backend from different places

By default the backend serves the frontend folder itself, which is simplest.
If you'd rather host the frontend separately (e.g. a static host like
Netlify/Vercel/GitHub Pages) with the API on its own server:

1. Deploy `frontend/` to your static host as-is.
2. In `frontend/index.html`, change the config line near the top:
   ```html
   <script>window.SOMO_API_BASE = 'https://api.yourdomain.example/api';</script>
   ```
3. Deploy `backend/` on its own server (Docker or plain Node, as above), and
   set `CORS_ORIGIN` in its `.env` to your frontend's exact origin, e.g.
   `CORS_ORIGIN=https://portal.yourdomain.example`.

---

## 3. First-run walkthrough

1. Open the app. Since no accounts exist yet, you'll be asked to create the
   **admin account** — username, phone number, and password. This becomes
   your first login.
2. Log in as admin, go to **Accounts**, and create:
   - **Ops team** accounts for whoever assigns riders day-to-day.
   - **Merchant** accounts for each corporate client (Jumia, Mr Wu, etc.) —
     each merchant only ever sees their own delivery requests.
3. Go to **Riders** and add your internal fleet (name, phone, motorbike
   registration number, and model — all required).
4. Go to **Pricing settings** and set the base fare, rate per km, minimum
   fare, minimum negotiable %, and the ops team's alert phone number.
5. Go to **Settings** to optionally add a logo and any API keys (Google
   Maps, WhatsApp, SMS, or others — see the note below on what these
   actually do today).
6. Hand out login credentials to your merchants and ops team. Each account
   creation/reset screen shows the password **once** — write it down before
   closing that dialog.

---

## 4. What's real vs. what's a manual trigger

- **Passwords** are hashed with bcrypt on the server and never stored or
  transmitted in plain text after account creation.
- **Pricing** is calculated server-side from the saved parameters — the
  frontend shows a live preview, but the number that actually gets logged
  is recomputed by the backend, so a client can't submit a fabricated price.
- **Google Maps** (autocomplete + driving-distance lookup) is a real,
  working integration once an admin adds a Maps API key with Places API and
  Distance Matrix API enabled (with billing on) in Settings. Restrict that
  key by HTTP referrer in Google Cloud Console — it's sent to every logged-in
  browser because the Maps JavaScript SDK has to run client-side.
- **WhatsApp/SMS alerts** work today as one-tap `wa.me` / `sms:` links that
  pre-fill the message — whoever's at the keyboard taps send. The WhatsApp
  and SMS **API key fields** in Settings are there so a developer can wire
  up true unattended sending later (e.g. Twilio, Africa's Talking, or Meta's
  WhatsApp Business API) — that requires the backend to call that provider
  directly using the stored key, which isn't implemented yet in this
  package. Search for `whatsappOtpKey` and `smsApiKey` in
  `backend/src/routes/settings.js` as the starting point for that work.

---

## 5. Backing up your data

Everything lives in one file: `backend/data/db.json`. Back it up like you
would any file — copy it somewhere safe on a schedule. If you're running
via Docker, back up the `somoexpress-data` volume instead
(`docker run --rm -v somoexpress-data:/data -v $(pwd):/backup alpine tar czf /backup/somoexpress-backup.tar.gz /data`).

If your delivery volume outgrows a single JSON file (heavy concurrent
writes, need for real reporting/queries), migrate `backend/src/db.js` to a
real database — every route file only calls the functions that module
exports, so that's a contained change.

---

## 6. Troubleshooting

- **"Could not reach the server"** on the login screen — the backend isn't
  running, or the frontend's `SOMO_API_BASE` points somewhere wrong.
- **Google Maps button stays disabled** — no Maps key has been saved in
  Settings yet, or the key doesn't have Places API + Distance Matrix API
  enabled with billing on.
- **Forgot the admin password** — stop the server, open
  `backend/data/db.json`, find your admin account under `accounts`, and
  either restore an earlier backup or ask a developer to run a small script
  using `backend/src/auth.js`'s `hashPassword()` to set a new hash directly
  in the file.
