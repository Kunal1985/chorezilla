const fs = require('fs');
const http = require('http');
const path = require('path');
const { openDatabase } = require('./db');
const { createStore } = require('./store');
const { readCookie, sessionCookie, clearCookie } = require('./auth');

const SITE = path.join(__dirname, '..', 'site');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

function cookieSecure(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  return req.headers['x-forwarded-proto'] === 'https';
}

function sendJson(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload)
  }, extraHeaders));
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1_000_000) {
        const err = new Error('That was too big.');
        err.status = 413;
        reject(err);
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        const error = new Error('Send JSON.');
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host = '';
  try { host = new URL(origin).host; } catch (err) {
    const error = new Error('Bad origin.');
    error.status = 403;
    throw error;
  }
  const expected = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (host !== expected) {
    const error = new Error('Cross-site request blocked.');
    error.status = 403;
    throw error;
  }
}

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  if (rel.includes('\0')) {
    res.writeHead(400);
    res.end('Bad path');
    return;
  }
  const file = path.resolve(SITE, rel);
  const root = path.resolve(SITE);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end('Nope');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

function createHandler(store) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      if (pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
        await routeApi(req, res, store, pathname);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }
      serveStatic(req, res, pathname);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong.' : err.message });
    }
  };
}

async function routeApi(req, res, store, pathname) {
  const token = readCookie(req, 'cz_session');
  const actor = store.memberForToken(token);
  const secure = cookieSecure(req);
  const method = req.method;

  if (method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && pathname === '/api/households') {
    const body = await readBody(req);
    const result = store.createHousehold(body);
    sendJson(res, 201, result.state, { 'set-cookie': sessionCookie(result.token, { secure, maxAge: 30 * 24 * 60 * 60 }) });
    return;
  }

  if (method === 'POST' && pathname === '/api/lookup') {
    const body = await readBody(req);
    sendJson(res, 200, store.lookup(body.code));
    return;
  }

  if (method === 'POST' && pathname === '/api/join') {
    const body = await readBody(req);
    const result = store.join(body);
    sendJson(res, 201, result.state, { 'set-cookie': sessionCookie(result.token, { secure, maxAge: 30 * 24 * 60 * 60 }) });
    return;
  }

  if (method === 'POST' && pathname === '/api/login') {
    const body = await readBody(req);
    const result = store.login(body);
    sendJson(res, 200, result.state, { 'set-cookie': sessionCookie(result.token, { secure, maxAge: 30 * 24 * 60 * 60 }) });
    return;
  }

  if (method === 'POST' && pathname === '/api/logout') {
    store.endSession(token);
    sendJson(res, 200, { ok: true }, { 'set-cookie': clearCookie({ secure }) });
    return;
  }

  if (!actor) {
    sendJson(res, 401, { error: 'Sign in again.' });
    return;
  }

  if (method === 'GET' && (pathname === '/api/state' || pathname === '/api/me')) {
    sendJson(res, 200, store.stateFor(actor));
    return;
  }

  if (method === 'GET' && pathname === '/api/export') {
    if (actor.role !== 'parent') {
      sendJson(res, 403, { error: 'Parents only.' });
      return;
    }
    const state = store.stateFor(actor);
    const payload = JSON.stringify(state, null, 2);
    const filename = 'chorezilla-' + String(state.family.name || 'household').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json';
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload)
    });
    res.end(payload);
    return;
  }

  if (method === 'POST' && pathname === '/api/members') {
    sendJson(res, 201, store.addMember(actor.id, await readBody(req)));
    return;
  }

  const memberMatch = pathname.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch && method === 'PATCH') {
    sendJson(res, 200, store.updateMember(actor.id, memberMatch[1], await readBody(req)));
    return;
  }
  if (memberMatch && method === 'DELETE') {
    sendJson(res, 200, store.deleteMember(actor.id, memberMatch[1]));
    return;
  }

  if (method === 'POST' && pathname === '/api/slots') {
    sendJson(res, 201, store.saveSlot(actor.id, await readBody(req)));
    return;
  }
  const slotMatch = pathname.match(/^\/api\/slots\/([^/]+)$/);
  if (slotMatch && method === 'PATCH') {
    const body = await readBody(req);
    if (body.active != null && body.title == null) {
      sendJson(res, 200, store.setSlotActive(actor.id, slotMatch[1], Boolean(body.active)));
      return;
    }
    sendJson(res, 200, store.saveSlot(actor.id, body, slotMatch[1]));
    return;
  }

  if (method === 'POST' && pathname === '/api/checkins') {
    sendJson(res, 200, store.saveCheckin(actor.id, await readBody(req)));
    return;
  }
  const approveMatch = pathname.match(/^\/api\/checkins\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    sendJson(res, 200, store.approveCheckin(actor.id, approveMatch[1]));
    return;
  }

  if (method === 'PUT' && pathname === '/api/prizes') {
    sendJson(res, 200, store.savePrize(actor.id, await readBody(req)));
    return;
  }
  if (method === 'PATCH' && pathname === '/api/family') {
    const body = await readBody(req);
    sendJson(res, 200, store.renameFamily(actor.id, body.name));
    return;
  }
  if (method === 'POST' && pathname === '/api/invite') {
    sendJson(res, 200, store.regenerateInvite(actor.id));
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
}

function start(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const opened = openDatabase(dataDir);
  const store = createStore(opened.db, {
    hashN: options.hashN || Number(process.env.HASH_N || 16384),
    maxFails: options.maxFails || Number(process.env.LOGIN_MAX_FAILS || 8)
  });
  const server = http.createServer(createHandler(store));
  server.db = opened.db;
  server.dbFile = opened.file;
  const port = options.port != null ? options.port : Number(process.env.PORT || 8080);
  const host = options.host || (options.port === 0 ? '127.0.0.1' : (process.env.HOST || '0.0.0.0'));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().then(server => {
    const address = server.address();
    console.log('Chorezilla listening on http://' + (address.address === '0.0.0.0' ? 'localhost' : address.address) + ':' + address.port);
    console.log('Database ' + server.dbFile);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { start, createHandler };
