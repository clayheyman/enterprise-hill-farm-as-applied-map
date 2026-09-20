// Tiny router + static file server built only on Node's built-in `http`
// module. There's no Express here (npm registry access is blocked in some
// environments this gets built in) -- this covers exactly what the app
// needs: path-param routes, JSON/raw body reading, and serving /public.

'use strict';

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj, extraHeaders = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
}

function sendFile(res, filePath, extraHeaders = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => send(res, 404, 'Not found'));
  res.writeHead(200, { 'Content-Type': type, ...extraHeaders });
  stream.pipe(res);
}

function readRawBody(req, { limit = 25 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readRawBody(req, { limit: 2 * 1024 * 1024 });
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Serves a file out of `rootDir` for the given url pathname, preventing
 * directory traversal. Returns true if it handled the request.
 */
function serveStatic(rootDir, urlPathname, res) {
  const safeSuffix = path.normalize(decodeURIComponent(urlPathname)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(rootDir, safeSuffix);
  if (!filePath.startsWith(rootDir)) {
    send(res, 403, 'Forbidden');
    return true;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return true;
  }
  return false;
}

/** Simple path-param route matcher: pattern "/admin/review/:id" against "/admin/review/abc". */
function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (pp !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    this.routes.push({ method, pattern, handler });
  }
  get(pattern, handler) { this.add('GET', pattern, handler); }
  post(pattern, handler) { this.add('POST', pattern, handler); }
  put(pattern, handler) { this.add('PUT', pattern, handler); }
  delete(pattern, handler) { this.add('DELETE', pattern, handler); }

  async handle(req, res) {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    req.query = Object.fromEntries(parsed.searchParams.entries());
    req.pathname = parsed.pathname;

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = matchRoute(route.pattern, parsed.pathname);
      if (!params) continue;
      req.params = params;
      try {
        await route.handler(req, res);
      } catch (err) {
        console.error(`Error handling ${req.method} ${parsed.pathname}:`, err);
        if (!res.headersSent) {
          sendJson(res, err.statusCode || 500, { error: err.message || 'Internal server error' });
        }
      }
      return true;
    }
    return false;
  }
}

module.exports = { Router, send, sendJson, sendFile, serveStatic, readRawBody, readJsonBody };
