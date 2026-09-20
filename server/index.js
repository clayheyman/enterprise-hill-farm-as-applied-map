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
const { summarizeFlightRecords } = require('./lib/flightRecord');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const FIELD_COLORS = ['#2e6f40', '#c98a1f', '#2f5f8a', '#8a3f2f', '#6a4f8a', '#3f8a7a', '#8a2f5f', '#5f8a2f'];

const router = new Router();

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
      const saved =
        (f.plotId && library.find((l) => l.plotId === f.plotId)) ||
        (f.fieldName && library.find((l) => l.name.toLowerCase() === f.fieldName.toLowerCase())) ||
        (f.location && library.find((l) => l.location && l.location.toLowerCase() === f.location.toLowerCase())) ||
        null;
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
    let entry = library.find((l) =>
      (f.plotId && l.plotId === f.plotId) ||
      (!f.plotId && l.name === f.displayName) ||
      (f.location && l.location && l.location.toLowerCase() === f.location.toLowerCase())
    );
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
