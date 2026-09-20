# Enterprise Hill Farm Aerial — As-Applied Map Tool

Upload the "flight record" .xlsx you export from the Talos Agro / Agri
Assistant app, get a per-field + overall job summary, draw each field's
boundary once on satellite imagery, and publish a branded map (plus a
one-click PDF) you can send to a client.

It's a plain Node.js app with **zero npm dependencies** — everything is
built on Node's own built-ins (including a from-scratch .xlsx reader), so
there's no `npm install` step to worry about and nothing to break across
Node versions. Data is stored in a flat JSON file (`data/db.json`), which is
plenty for a single-operator business doing a handful of jobs a week.

## Running it locally

```
cp .env.example .env
# edit .env: set ADMIN_PASSWORD to something you'll remember, and set
# SESSION_SECRET to a random string (the command below generates one)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

node server/index.js
```

Then open `http://localhost:3000/admin`, sign in, and upload a flight
record file.

## How a job flows through the tool

1. **Upload** (`/admin`) — drop the .xlsx. The tool groups its rows by
   Talos's internal "Plot ID" into per-field summaries, plus one overall
   total, and creates a draft job.
2. **Review** (`/admin/review/:id`) — set the client name/title, rename or
   recolor each field, and draw each field's boundary on the satellite map
   (draw tool, top-left of the map). Everything autosaves as you go.
3. **Publish** — generates a shareable link (`/map/:slug`). Publishing also
   saves any boundaries you drew into a reusable "field library," keyed to
   Talos's Plot ID — the next job that touches the same field auto-fills its
   name, color, and boundary so you only ever have to trace it once.
4. **Send the link** to your client. They see a branded page with the
   coverage map and a field-by-field table, and can download a PDF of it
   with one click. Nothing is sent automatically — you're always the one
   who shares it.

## Deploying it

Because there's nothing to build and no native dependencies, this deploys
almost anywhere that runs Node 18+. Two good free/cheap options:

**Render.com** (recommended — easiest persistent disk for the data file)
1. Push this folder to a GitHub repo.
2. New → Web Service → connect the repo.
3. Build command: (leave blank / `true`) · Start command: `node server/index.js`
4. Add environment variables `ADMIN_PASSWORD` and `SESSION_SECRET` in the
   Render dashboard.
5. Add a persistent disk mounted at `/opt/render/project/src/data` (Render's
   "Disks" tab) so uploaded jobs survive redeploys — otherwise the free tier
   wipes the filesystem on every deploy/restart.

**Railway.app** — same idea: connect the repo, set the two env vars, add a
volume mounted at `/app/data`.

Either way, once it's deployed you'll have a URL like
`https://ehf-aerial.onrender.com`. That's what you embed into Squarespace.

## Embedding in Squarespace

Squarespace can't run this app itself (no custom backend code), but it can
embed or link to it easily:

**Option A — a "View your field map" button**, e.g. on a service page:
in a Squarespace *Button Block*, set the link to your published map's URL
for that client (or, more commonly, you'll just text/email each client
their own `/map/:slug` link directly — that's the main way this is meant to
be used).

**Option B — embed the admin upload tool for yourself** (optional, mostly
just a convenience so you can jump to it from your own site while logged
in): add a *Code Block* wherever you want the shortcut, e.g.:

```html
<a href="https://YOUR-DEPLOYED-URL.onrender.com/admin"
   style="display:inline-block;padding:12px 20px;background:#12294d;color:#fff;
          border-radius:8px;text-decoration:none;font-weight:600;">
  Upload a new flight record
</a>
```

There's no reason to iframe the admin tool into Squarespace (it's just for
you), but if you ever want a specific published map embedded directly on a
page instead of linked, use a Code Block with:

```html
<iframe src="https://YOUR-DEPLOYED-URL.onrender.com/map/THE-SLUG"
        style="width:100%;height:900px;border:0;border-radius:10px;"
        loading="lazy"></iframe>
```

## Known limitation: field boundaries

Talos's flight-record export doesn't include GPS coordinates or field
boundary shapes — just a rough street address and an internal "Plot ID"
that groups rows into the same field. There's a live "Playback" view inside
the Talos platform that clearly has the real coordinates, but every request
it makes is cryptographically signed by the app itself, so there's no way
to pull that data out automatically from the outside.

That's why boundaries are hand-drawn in this tool instead — trace a field
once on the satellite imagery, and (thanks to the Plot ID matching) it's
remembered automatically from then on. If Talos ever adds a proper KML/
Shapefile export, that would be a clean addition here (a new file format in
`server/lib/`), but hand-drawing is the reliable path today.

## Project layout

```
server/
  index.js            HTTP server + all routes
  lib/
    http.js           tiny router + static file server (no Express)
    xlsx.js, zip.js    from-scratch .xlsx reader (no dependency needed)
    flightRecord.js    turns parsed rows into per-field + overall summaries
    store.js           flat-file JSON datastore (jobs + field library)
    auth.js            signed-cookie admin session (single password)
    id.js, loadEnv.js  small helpers
public/
  admin/               upload, review, and login pages
  map/                 the public client-facing map page
  js/, css/            shared frontend code and styles
data/                  db.json + uploaded originals (gitignored)
```
