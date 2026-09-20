// Minimal stateless cookie auth. This tool has exactly one admin user (Clay),
// so a full accounts/session system is overkill -- a signed, expiring cookie
// checked against a single password from the environment is enough, and it
// survives server restarts (free hosting tiers sleep/restart often) since
// there's no server-side session store to lose.

'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'ehf_admin';
const SESSION_HOURS = 24 * 14; // 2 weeks

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET must be set in the environment (see .env.example)');
  }
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

function createSessionCookie() {
  const expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `${expires}`;
  const sig = sign(payload);
  const token = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_HOURS * 3600}; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }
  return Date.now() < parseInt(payload, 10);
}

function checkPassword(candidate) {
  const actual = process.env.ADMIN_PASSWORD;
  if (!actual) throw new Error('ADMIN_PASSWORD must be set in the environment (see .env.example)');
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(actual));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  createSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  checkPassword,
};
