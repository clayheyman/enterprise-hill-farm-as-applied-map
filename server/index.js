'use strict';

require('./lib/loadEnv').loadEnv();

const http = require('http');
const path = require('path');
const fs = require('fs');

const { Router, sendJson, send, serveStatic, readRawBody, readJsonBody } = require('./lib/http');
const auth = require('./lib/auth');
const store = require('./lib/store');
const { generateId } = require('./lib/id');
const { readFirstSheetAsRecords } = require('./lib/xlsx');
const { summarizeFlightRecords, MU_TO_ACRE, round } = require('./lib/flightRecord');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const FIELD_COLORS = ['#2e6f40', '#c98a1f', '#2f5f8a', '#8a3f2f', '#6a4f8a', '#3f8a7a', '#8a2f5f', '#5f8a2f'];

const router = new Router();

// ---- field-library matching -------------------------------------------
//
// Finds the single best field-library match for a flight-record field.
// Matching by plotId or fieldName is precise -- those are meant to
// uniquely identify one field -- but `location` is very often just a
// generic road-level address shared by several distinct fields (this is
// especially true for entries synced in from Talos's Field Management,
// which have no plotId at all). So a location match is only trusted when
// it uniquely identifies exactly one library candidate; otherwise every
// field sharing that address would incorrectly collapse onto whichever
// entry happened to come first, which is exactly the "all fields show the
// same one boundary" bug this guards against.
function matchLibraryEntry(library, { plotId, fieldName, location }) {
  if (plotId) {
    const byPlot = library.find((l) => l.plotId === plotId);
    if (byPlot) return byPlot;
  }
  if (fieldName) {
    const byName = library.find((l) => l.name.toLowerCase() === fieldName.toLowerCase());
    if (byName) return byName;
  }
  if (location) {
    const byLocation = library.filter((l) => l.location && l.location.toLowerCase() === location.toLowerCase());
    if (byLocation.length === 1) return byLocation[0];
  }
  return null;
}

// ---- auth helpers ------------------------------------------------------

function requireAuthApi(req, res) {
  if (!auth.isAuthenticated(req)) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return false;
  }
  return true;
}

function requireAuthPage(req, res) {
  if (!auth.isAuthenticated(req)) {
    send(res, 302, '', { Location: '/admin/login' });
    return false;
  }
  return true;
}

// ---- auth routes --------------------------------------------------------

router.post('/api/admin/login', async (req, res) => {
  const body = await readJsonBody(req);
  if (auth.checkPassword(body.password)) {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.createSessionCookie() });
  } else {
    sendJson(res, 401, { error: 'Wrong password' });
  }
});

router.post('/api/admin/logout', async (req, res) => {
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearSessionCookie() });
});

// ---- admin pages ----------------------------------------------------------

router.get('/admin/login', async (req, res) => {
  if (auth.isAuthenticated(req)) return send(res, 302, '', { Location: '/admin' });
  serveStatic(PUBLIC_DIR, '/admin/login.html', res);
});

router.get('/admin', async (req, res) => {
  if (!requireAuthPage(req, res)) return;
  serveStatic(PUBLIC_DIR, '/admin/upload.html', res);
});

router.get('/admin/review/:id', async (req, res) => {
  if (!requireAuthPage(req, res)) return;
  const job = store.getJob(req.params.id);
  if (!job) return send(res, 404, 'Job not found');
  serveStatic(PUBLIC_DIR, '/admin/review.html', res);
});

// ---- admin JSON API ---------------------------------------------------

router.get('/api/admin/jobs', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  sendJson(res, 200, { jobs: store.listJobs() });
});

router.get('/api/admin/jobs/:id', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  const job = store.getJob(req.params.id);
  if (!job) return sendJson(res, 404, { error: 'Job not found' });
  sendJson(res, 200, { job });
});

router.post('/api/admin/upload', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  const filename = req.query.filename || 'flight-record.xlsx';
  const buf = await readRawBody(req, { limit: 25 * 1024 * 1024 });

  let records;
  try {
    ({ records } = readFirstSheetAsRecords(buf));
  } catch (err) {
    return sendJson(res, 400, { error: `Could not read that file as an .xlsx flight record export: ${err.message}` });
  }
  if (!records.length) {
    return sendJson(res, 400, { error: 'No flight rows found in that file.' });
  }

  const { overall, fields } = summarizeFlightRecords(records);

  const id = generateId();
  const storedName = `${id}-${filename}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  fs.writeFileSync(path.join(UPLOADS_DIR, storedName), buf);

  // Try to auto-match saved boundaries from the field library by plotId, then
  // fieldName, then location (same fallback order used to group passes into
  // fields in the first place -- see flightRecord.js).
  const library = store.listFieldLibrary();

  const job = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'draft',
    publicSlug: null,
    sourceFile: { originalName: filename, storedName },
    clientName: '',
    clientEmail: '',
    jobTitle: `${overall.date || 'Flight'} job — ${overall.location || ''}`.trim(),
    notes: '',
    overall,
    fields: fields.map((f, i) => {
      const saved = matchLibraryEntry(library, { plotId: f.plotId, fieldName: f.fieldName, location: f.location });
      return {
        ...f,
        fieldId: generateId(),
        displayName: saved?.name || f.fieldName || f.label,
        color: saved?.color || FIELD_COLORS[i % FIELD_COLORS.length],
        boundary: saved?.boundary || null,
      };
    }),
  };

  store.saveJob(job);
  sendJson(res, 200, { id: job.id });
});

router.put('/api/admin/jobs/:id', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  const job = store.getJob(req.params.id);
  if (!job) return sendJson(res, 404, { error: 'Job not found' });
  const body = await readJsonBody(req);

  const editable = ['clientName', 'clientEmail', 'jobTitle', 'notes'];
  editable.forEach((k) => {
    if (typeof body[k] === 'string') job[k] = body[k];
  });

  if (Array.isArray(body.fields)) {
    body.fields.forEach((patch) => {
      const f = job.fields.find((x) => x.fieldId === patch.fieldId);
      if (!f) return;
      if (typeof patch.displayName === 'string') f.displayName = patch.displayName;
      if (typeof patch.color === 'string') f.color = patch.color;
      if (patch.boundary === null || (patch.boundary && patch.boundary.type === 'Polygon')) {
        f.boundary = patch.boundary;
      }
    });
  }

  job.updatedAt = new Date().toISOString();
  store.saveJob(job);
  sendJson(res, 200, { job });
});

router.post('/api/admin/jobs/:id/publish', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  const job = store.getJob(req.params.id);
  if (!job) return sendJson(res, 404, { error: 'Job not found' });
  if (!job.publicSlug) job.publicSlug = generateId(12);
  job.status = 'published';
  job.updatedAt = new Date().toISOString();
  store.saveJob(job);

  // Save any newly-drawn boundaries into the reusable field library, keyed by
  // plot id / field name / location (same fallback order as matching above).
  const library = store.listFieldLibrary();
  job.fields.forEach((f) => {
    if (!f.boundary) return;
    let entry = matchLibraryEntry(library, { plotId: f.plotId, fieldName: f.displayName, location: f.location });
    if (!entry) {
      entry = {
        id: generateId(),
        plotId: f.plotId || null,
        name: f.displayName,
        location: f.location || null,
        color: f.color,
        boundary: f.boundary,
      };
    } else {
      entry.boundary = f.boundary;
      entry.color = f.color;
      entry.name = f.displayName;
      entry.location = f.location || entry.location || null;
    }
    entry.lastUsedAt = new Date().toISOString();
    store.saveFieldLibraryEntry(entry);
  });

  sendJson(res, 200, { job });
});

router.post('/api/admin/jobs/:id/unpublish', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  const job = store.getJob(req.params.id);
  if (!job) return sendJson(res, 404, { error: 'Job not found' });
  job.status = 'draft';
  store.saveJob(job);
  sendJson(res, 200, { job });
});

router.delete('/api/admin/jobs/:id', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  store.deleteJob(req.params.id);
  sendJson(res, 200, { ok: true });
});

router.get('/api/admin/field-library', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  sendJson(res, 200, { fields: store.listFieldLibrary() });
});

router.delete('/api/admin/field-library/:id', async (req, res) => {
  if (!requireAuthApi(req, res)) return;
  store.deleteFieldLibraryEntry(req.params.id);
  sendJson(res, 200, { ok: true });
});

// ---- Talos field-boundary sync (bookmarklet) --------------------------
//
// The "Sync fields from Talos" bookmarklet runs on manage.talosagcenter.com
// (while Clay is logged into Talos) and POSTs the field boundaries it reads
// straight from Talos's own page back to this endpoint. Because that request
// comes from Talos's origin rather than a logged-in tab of this app, it can't
// carry our admin session cookie -- so it's gated by a separate long-lived
// token (FIELD_SYNC_TOKEN) sent as a Bearer header instead, and CORS is opened
// only for Talos's origin on this one route.

const SYNC_ALLOWED_ORIGIN = 'https://manage.talosagcenter.com';

function withSyncCors(res) {
  res.setHeader('Access-Control-Allow-Origin', SYNC_ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

router.add('OPTIONS', '/api/admin/field-library/sync', async (req, res) => {
  withSyncCors(res);
  send(res, 204, '');
});

function isValidPolygon(g) {
  return (
    g &&
    g.type === 'Polygon' &&
    Array.isArray(g.coordinates) &&
    Array.isArray(g.coordinates[0]) &&
    g.coordinates[0].length >= 3 &&
    g.coordinates[0].every((pt) => Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number')
  );
}

router.post('/api/admin/field-library/sync', async (req, res) => {
  withSyncCors(res);
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!auth.checkSyncToken(token)) {
    return sendJson(res, 401, { error: 'Invalid or missing sync token' });
  }

  const body = await readJsonBody(req);
  const incoming = Array.isArray(body.fields) ? body.fields : [];
  if (!incoming.length) return sendJson(res, 400, { error: 'No fields provided' });

  const library = store.listFieldLibrary();
  let created = 0;
  let updated = 0;

  incoming.forEach((f, i) => {
    const name = String(f.name || '').trim();
    if (!name || !isValidPolygon(f.boundary)) return; // skip anything malformed, don't fail the whole sync

    let entry = library.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!entry) {
      entry = {
        id: generateId(),
        plotId: null,
        name,
        location: f.address || null,
        color: FIELD_COLORS[(library.length + created) % FIELD_COLORS.length],
        boundary: f.boundary,
      };
      library.push(entry);
      created += 1;
    } else {
      entry.boundary = f.boundary;
      entry.location = f.address || entry.location || null;
      updated += 1;
    }
    // Talos's own API reports area in Chinese "mu" units here too (same
    // quirk as the flight-record export -- see MU_TO_ACRE in
    // flightRecord.js), so convert before storing it for display.
    entry.talosAcres = typeof f.area === 'number' ? round(f.area * MU_TO_ACRE, 2) : entry.talosAcres || null;
    entry.lastUsedAt = new Date().toISOString();
    entry.syncedFromTalosAt = new Date().toISOString();
    store.saveFieldLibraryEntry(entry);
  });

  sendJson(res, 200, { ok: true, created, updated, total: incoming.length });
});

// ---- public (client-facing) routes -------------------------------------

router.get('/map/:slug', async (req, res) => {
  const job = store.getJobBySlug(req.params.slug);
  if (!job || job.status !== 'published') return send(res, 404, 'Map not found');
  serveStatic(PUBLIC_DIR, '/map/view.html', res);
});

router.get('/api/public/:slug', async (req, res) => {
  const job = store.getJobBySlug(req.params.slug);
  if (!job || job.status !== 'published') return sendJson(res, 404, { error: 'Not found' });
  // Only expose what a client should see.
  sendJson(res, 200, {
    job: {
      jobTitle: job.jobTitle,
      clientName: job.clientName,
      overall: job.overall,
      fields: job.fields.map((f) => ({
        fieldId: f.fieldId,
        displayName: f.displayName,
        taskType: f.taskType,
        crop: f.crop,
        totalAcres: f.totalAcres,
        totalAmount: f.totalAmount,
        totalAmountLb: f.totalAmountLb,
        totalAmountGal: f.totalAmountGal,
        unit: f.unit,
        avgRatePerAcre: f.avgRatePerAcre,
        passCount: f.passCount,
        color: f.color,
        boundary: f.boundary,
      })),
    },
  });
});

// ---- static + fallback --------------------------------------------------

const server = http.createServer(async (req, res) => {
  const handled = await router.handle(req, res);
  if (handled) return;

  if (req.method === 'GET') {
    if (req.pathname === '/') {
      send(res, 302, '', { Location: '/admin' });
      return;
    }
    if (serveStatic(PUBLIC_DIR, req.pathname, res)) return;
  }

  send(res, 404, 'Not found');
});

server.listen(PORT, () => {
  console.log(`Enterprise Hill Farm as-applied map tool running on http://localhost:${PORT}`);
});
