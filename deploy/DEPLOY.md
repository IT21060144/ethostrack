# Putting EthosTrack on a website

**Using Netlify?** Follow [NETLIFY.md](NETLIFY.md) instead. This page is for
hosts that run a normal Node.js server (cPanel Node.js app, Render, a VPS).

EthosTrack-web.zip is the whole app in one folder: the website and the part
that stores data run together as one Node.js program. Upload it, give it four
settings, and start it.

## 1. Check what your web portal can run

EthosTrack needs a host that can run **Node.js** (version 18 or newer).

- **Works:** cPanel hosting that has a "Setup Node.js App" (or "Node.js
  Selector") icon, a VPS, or services such as Render, Railway, DigitalOcean
  App Platform or Azure App Service.
- **Does not work:** plain shared hosting that only offers PHP, WordPress or
  file upload ("public_html" only). Those can show web pages but cannot run
  the part that logs in students and saves their study sessions.
- A university portal usually needs the IT team to give you a Node.js app
  space. Show them this page.

## 2. Get a database (free)

The app needs a MongoDB database that the website can reach. Your laptop's
database cannot be used from the internet, so use MongoDB Atlas:

1. Sign up at https://www.mongodb.com/cloud/atlas and create a free (M0)
   cluster.
2. Under **Database Access**, add a user with a password.
3. Under **Network Access**, allow the host's address (or `0.0.0.0/0`,
   "allow from anywhere", if the host does not have a fixed address).
4. Click **Connect > Drivers** and copy the connection string. It looks like
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/ethostrack`.
   Put your password in it and add `/ethostrack` before any `?`.

## 3. The settings (environment variables)

Every host has a page for these ("Environment variables" in cPanel's Node.js
app, Render and Railway).

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGO_URI` | the Atlas connection string from step 2 |
| `JWT_SECRET` | a long random text (see below) |
| `PSEUDONYM_SECRET` | a different long random text |

Optional: `CORS_ORIGIN` is only needed if the website is ever served from a
different address than the app. `PORT` is set by the host; leave it alone.

To make a random text, run this on your Mac in Terminal and copy the result:

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Keep `PSEUDONYM_SECRET` safe and never change it.** It is the key that links
a student's account to their anonymous study data. If it changes, every
existing student loses their history. If it leaks, the anonymous data can be
tied back to people.

## 4. Upload and start

### cPanel with "Setup Node.js App"

1. In **File Manager**, upload `EthosTrack-web.zip` to your home folder (not
   `public_html`) and **Extract** it. You get a folder `EthosTrack-web`.
2. Open **Setup Node.js App > Create Application**:
   - Node.js version: 18 or newer
   - Application mode: Production
   - Application root: `EthosTrack-web`
   - Application URL: a whole address, such as a subdomain like
     `ethostrack.yourdomain.com` (make it first under **Domains** or
     **Subdomains**). A sub-folder address like `yourdomain.com/ethostrack`
     will not work.
   - Application startup file: `app.js`
3. Add the four settings from step 3 under **Environment variables**.
4. Click **Create**, then **Run NPM Install**, then **Restart**.
5. Open the address. You should see the EthosTrack sign-in page.

### Render, Railway or a similar service

1. Put the `EthosTrack-web` folder (from the zip) in a GitHub repository, or
   upload it where the service asks.
2. Build command: `npm install`. Start command: `npm start`.
3. Add the four settings from step 3.
4. Deploy and open the address the service gives you.

### A VPS (your own Linux server)

```
unzip EthosTrack-web.zip && cd EthosTrack-web
npm install --omit=dev
NODE_ENV=production MONGO_URI=... JWT_SECRET=... PSEUDONYM_SECRET=... npm start
```

Keep it running with `pm2` or systemd, and put it behind HTTPS (for example
Caddy or nginx with Let's Encrypt).

## 5. Check it works

- Open `https://YOUR-ADDRESS/api/health`. It should show
  `"status":"ok"` and `"database":"connected"`.
- Create an account on the sign-in page and leave the tab open for a minute.
  The dashboard should show a session in progress.

If the health page says `"database":"disconnected"`, the `MONGO_URI` is wrong
or Atlas's **Network Access** does not allow the host yet. The host's log will
say `[Database] Not reachable yet`.

## What is different from the laptop version

- **Starting by itself when the laptop opens only works on the Mac.** The
  "Install EthosTrack.command" helper runs the app on the laptop itself; a
  website cannot open a browser on a student's computer. On the website,
  tracking starts as soon as the student opens the page and signs in, and
  continues while that tab stays open.
- **Activity in other apps is only seen on the Mac version.** The hosted
  version counts keyboard and mouse use inside the EthosTrack tab only. A
  website is not allowed to see what happens outside its own tab, which is
  also the more privacy-preserving behaviour.
- The website starts with an empty database. The demo account
  (`student@example.com`) only exists on the laptop.

## Making a new zip after changing the code

On the Mac, in the EthosTracker folder:

```
npm run web:bundle
```

This writes a fresh `deploy/EthosTrack-web.zip`. Upload it again the same way
(keep the same settings, especially `PSEUDONYM_SECRET`).
