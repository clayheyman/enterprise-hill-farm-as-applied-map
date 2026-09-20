// Tiny JSON-file datastore. No native deps (no sqlite/postgres) so this
// deploys anywhere Node runs with zero install step. Fine for a single-operator
// business doing a handful of jobs a week -- if volume ever outgrows a flat
// file, swap this module out for a real DB without touching the rest of the app.

'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify({ jobs: [], fieldLibrary: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// --- Jobs -------------------------------------------------------------

function listJobs() {
  return readDb().jobs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getJob(id) {
  return readDb().jobs.find((j) => j.id === id) || null;
}

function getJobBySlug(slug) {
  return readDb().jobs.find((j) => j.publicSlug === slug) || null;
}

function saveJob(job) {
  const db = readDb();
  const i = db.jobs.findIndex((j) => j.id === job.id);
  if (i === -1) db.jobs.push(job);
  else db.jobs[i] = job;
  writeDb(db);
  return job;
}

function deleteJob(id) {
  const db = readDb();
  db.jobs = db.jobs.filter((j) => j.id !== id);
  writeDb(db);
}

// --- Field boundary library (reusable across jobs) --------------------

function listFieldLibrary() {
  return readDb().fieldLibrary;
}

function saveFieldLibraryEntry(entry) {
  const db = readDb();
  const i = db.fieldLibrary.findIndex((f) => f.id === entry.id);
  if (i === -1) db.fieldLibrary.push(entry);
  else db.fieldLibrary[i] = entry;
  writeDb(db);
  return entry;
}

function deleteFieldLibraryEntry(id) {
  const db = readDb();
  db.fieldLibrary = db.fieldLibrary.filter((f) => f.id !== id);
  writeDb(db);
}

module.exports = {
  listJobs,
  getJob,
  getJobBySlug,
  saveJob,
  deleteJob,
  listFieldLibrary,
  saveFieldLibraryEntry,
  deleteFieldLibraryEntry,
};
