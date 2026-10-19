/* global fetch, AbortSignal, setInterval, console, URL, Buffer, process */
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = JSON.parse(readFileSync(resolve(root, 'lab/.lab-runtime.json'), 'utf8'));
const db = new DatabaseSync(resolve(root, 'lab/.state/provider.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,label TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',faults TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,payload TEXT NOT NULL,route TEXT NOT NULL,status TEXT NOT NULL,due INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS traces(id INTEGER PRIMARY KEY,conversation_id TEXT NOT NULL,at TEXT NOT NULL,stage TEXT NOT NULL,label TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}');
CREATE UNIQUE INDEX IF NOT EXISTS seen_once ON traces(conversation_id,stage,label) WHERE stage='widget-received';`);
const origin = 'http://127.0.0.1:8790';
const worker = 'http://127.0.0.1:8788';
const now = () => new Date().toISOString();
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const trace = (id, stage, label, data = {}) => db.prepare('INSERT OR IGNORE INTO traces(conversation_id,at,stage,label,data) VALUES(?,?,?,?,?)').run(id, now(), stage, label, JSON.stringify(data));
const getConv = id => { const row = db.prepare('SELECT * FROM conversations WHERE id=?').get(id); if (!row) throw Object.assign(Error('Unknown lab conversation'), { status: 404 }); return { ...row, faults: JSON.parse(row.faults) }; };
const messages = id => db.prepare('SELECT payload FROM messages WHERE conversation_id=? ORDER BY created_at,id').all(id).map(row => JSON.parse(row.payload));
const faults = id => ({ route: 'product', delayMs: 0, dropNext: false, duplicateNext: false, readFailures: 0, sendFailures: 0, failureStatus: 503, ...getConv(id).faults });
function updateFaults(id, patch) { const next = { ...faults(id), ...patch }; db.prepare('UPDATE conversations SET faults=? WHERE id=?').run(JSON.stringify(next), id); return next; }
function addMessage(id, text, actor = 'user', type = 'normal') {
  getConv(id);
  const message = { id: randomUUID(), conversation_id: id, app_id: 'app-lab', channel_id: 'lab-web', actor_type: actor, actor_id: actor === 'user' ? 'user-lab' : actor === 'agent' ? 'agent-lab-human' : 'agent-lab-ai', message_type: type, created_time: now(), message_parts: [{ text: { content: text } }] };
  db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(message.id, id, JSON.stringify(message), message.created_time);
  return message;
}
async function request(path, body, sidebar = false) {
  const headers = { 'Content-Type': 'application/json', ...(sidebar ? { Authorization: `Bearer ${runtime.sidebarToken}` } : { Cookie: `fq_session=${runtime.session}` }) };
  const response = await fetch(worker + path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(65_000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.error || `Lab Worker returned ${response.status}`), { status: response.status });
  return data;
}
const base = '/api/companies/connection-lab';
async function publishKnowledge(documents, title) {
  const current = await request(base + '/knowledge');
  if (current.draft) {
    const res = await fetch(worker + base + '/knowledge/versions/' + current.draft.version.id, { method: 'DELETE', headers: { Cookie: `fq_session=${runtime.session}` } });
    if (!res.ok) throw Error('Could not replace the lab draft');
  }
  const { version } = await request(base + '/knowledge/versions', { empty: true, title });
  for (const doc of documents) await request(base + `/knowledge/versions/${version.id}/docs`, { title: doc.title, content: doc.content });
  await request(base + `/knowledge/versions/${version.id}/activate`, {});
  return request(base + '/knowledge');
}
function eventPayload(id, message, route) {
  if (route === 'account') return { action: 'message_create', data: { message } };
  return { event: 'onMessageCreate', data: { message: { conversation_id: id, app_id: 'app-lab', user_id: 'user-lab', status: getConv(id).status, messages: [message] } } };
}
function queueMessage(id, message, applyFaults = true) {
  const config = faults(id);
  const payload = eventPayload(id, message, config.route);
  const dropped = applyFaults && config.dropNext;
  const copies = applyFaults && config.duplicateNext ? 2 : 1;
  for (let n = 0; n < copies; n++) {
    const deliveryId = randomUUID();
    const delay = applyFaults ? config.delayMs : 0;
    db.prepare('INSERT INTO deliveries(id,conversation_id,payload,route,status,due) VALUES(?,?,?,?,?,?)').run(deliveryId, id, JSON.stringify(payload), config.route, dropped ? 'dropped' : 'pending', Date.now() + delay);
    trace(id, dropped ? 'event-dropped' : 'event-queued', dropped ? 'Customer message stored; notification intentionally dropped' : `Notification queued${delay ? ` for ${delay / 1000}s` : ''}${n ? ' (duplicate)' : ''}`, { deliveryId, payload });
  }
  if (applyFaults) updateFaults(id, { dropNext: false, duplicateNext: false });
}
let delivering = false;
async function deliverDue() {
  if (delivering) return;
  delivering = true;
  try {
    for (const row of db.prepare("SELECT * FROM deliveries WHERE status='pending' AND due<=? ORDER BY due LIMIT 20").all(Date.now())) {
      db.prepare("UPDATE deliveries SET status='sending',attempts=attempts+1 WHERE id=?").run(row.id);
      try {
        const endpoint = row.route === 'product' ? '/api/sidebar/events' : `/api/ingest/freshchat/co_lab/${runtime.webhookSecret}`;
        const response = await fetch(worker + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(row.route === 'product' ? { Authorization: `Bearer ${runtime.sidebarToken}` } : {}) }, body: row.payload, signal: AbortSignal.timeout(10_000) });
        const data = await response.json();
        if (!response.ok) throw Error(`Worker rejected notification (${response.status})`);
        db.prepare("UPDATE deliveries SET status='delivered' WHERE id=?").run(row.id);
        trace(row.conversation_id, 'event-delivered', `${row.route === 'product' ? 'Product event' : 'Account webhook'} → Fresh QA · HTTP ${response.status}`, { deliveryId: row.id, result: data });
      } catch (error) {
        const retry = row.attempts < 2;
        db.prepare('UPDATE deliveries SET status=?,due=? WHERE id=?').run(retry ? 'pending' : 'failed', Date.now() + 1000, row.id);
        trace(row.conversation_id, 'event-error', error.message, { retry });
      }
    }
  } finally { delivering = false; }
}
db.exec("UPDATE deliveries SET status='pending' WHERE status='sending'");
setInterval(() => { deliverDue().catch(error => console.error('Lab notification error:', error.message)); }, 200).unref();
let recoveryEvery = 0, nextRecovery = 0;
setInterval(() => {
  if (!recoveryEvery || Date.now() < nextRecovery) return;
  nextRecovery = Date.now() + recoveryEvery;
  fetch(worker + '/__scheduled').catch(error => console.error('Lab recovery tick:', error.message));
}, 1000).unref();
let initialized = false, startupError = '', knowledgeBusy = false;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (req.method !== 'GET' && req.headers.origin && ![origin, 'http://localhost:8790'].includes(req.headers.origin)) return json(res, 403, { error: 'Only the local lab may submit requests.' });
    if (req.headers.host && !['127.0.0.1:8790', 'localhost:8790'].includes(req.headers.host)) return json(res, 403, { error: 'Lab is loopback-only.' });
    let body = {};
    if (req.method !== 'GET') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON required.' });
      const parts = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1_600_000) throw Object.assign(Error('Request too large'), { status: 413 }); parts.push(chunk); }
      body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    }
    // Mock provider REST API. The production Freshchat client connects ONLY to this loopback server.
    if (path.startsWith('/v2/')) {
      if (req.headers.authorization !== 'Bearer lab-transport-only') return json(res, 401, { error: 'Fake lab transport token required' });
      if (path === '/v2/agents') return json(res, 200, { agents: [{ id: 'agent-lab-ai', first_name: 'Ava' }, { id: 'agent-lab-human', first_name: 'Sam' }], pagination: { total_pages: 1 } });
      if (path === '/v2/users/user-lab') return json(res, 200, { id: 'user-lab', first_name: 'Test', last_name: 'Customer' });
      const match = /^\/v2\/conversations\/([a-f0-9-]+)(\/messages)?$/.exec(path);
      if (!match) return json(res, 404, { error: 'Unknown mock provider endpoint' });
      const id = match[1], c = getConv(id), config = faults(id);
      const failure = req.method === 'POST' ? 'sendFailures' : 'readFailures';
      trace(id, 'api-request', `${req.method} ${path}`, { page: url.searchParams.get('page') });
      if (config[failure] > 0) { updateFaults(id, { [failure]: config[failure] - 1 }); trace(id, 'api-error', `Injected HTTP ${config.failureStatus}`, { failure }); return json(res, config.failureStatus, { error: 'Injected lab failure before commit' }); }
      if (!match[2]) return json(res, 200, { conversation_id: id, app_id: 'app-lab', status: c.status, user_id: 'user-lab', channel_id: 'lab-web' });
      if (req.method === 'GET') {
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1), count = Math.min(100, Number(url.searchParams.get('items_per_page')) || 50);
        const all = messages(id).reverse(), start = (page - 1) * count;
        return json(res, 200, { messages: all.slice(start, start + count), ...(start + count < all.length ? { link: { href: `${origin}${path}?page=${page + 1}`, rel: 'next' } } : {}) });
      }
      if (body.actor_type !== 'agent' || body.actor_id !== 'agent-lab-ai') return json(res, 400, { error: 'Only the fake reply agent is allowed' });
      const message = addMessage(id, body.message_parts?.[0]?.text?.content || '', 'bot', body.message_type);
      message.actor_type = 'agent'; message.actor_id = 'agent-lab-ai';
      db.prepare('UPDATE messages SET payload=? WHERE id=?').run(JSON.stringify(message), message.id);
      trace(id, 'reply-stored', 'Fresh QA → provider · agent reply stored', { messageId: message.id });
      queueMessage(id, message, false);
      return json(res, 200, message);
    }
    if (path === '/lab/health') return json(res, 200, { ready: initialized, error: startupError, isolation: 'loopback-only', engine: 'real Fresh QA Worker / D1 / Durable Object / AI', provider: 'mock Freshchat', productionConnected: false });
    if (path === '/lab/conversations' && req.method === 'POST') {
      const id = randomUUID(), label = String(body.label || 'New client test').slice(0, 100);
      db.prepare('INSERT INTO conversations(id,label,created_at) VALUES(?,?,?)').run(id, label, now());
      trace(id, 'widget-init', 'New isolated widget session', { externalId: 'user-lab', restoreId: id, token: 'lab-widget-token' });
      return json(res, 200, { id });
    }
    if (path === '/lab/knowledge' && req.method === 'POST') {
      if (knowledgeBusy) return json(res, 409, { error: 'Lab knowledge is already updating.' });
      const text = String(body.content || '').trim();
      if (text.length < 30 || text.length > 1_000_000) return json(res, 400, { error: 'Paste between 30 and 1,000,000 characters.' });
      knowledgeBusy = true;
      try { const knowledge = await publishKnowledge([{ title: String(body.title || 'Lab knowledge').slice(0, 100), content: text }], 'Imported lab knowledge'); return json(res, 200, knowledge); } finally { knowledgeBusy = false; }
    }
    if (path === '/lab/widget') {
      const id = url.searchParams.get('conversationId');
      const c = getConv(id);
      return json(res, 200, { messages: messages(id), status: c.status, conversationId: id });
    }
    if (path.startsWith('/lab/') && !['/lab/health', '/lab/state'].includes(path) && req.method !== 'POST') return json(res, 405, { error: 'POST required' });
    if (path === '/lab/state') {
      const id = url.searchParams.get('conversationId');
      let detail = null, sidebar = null;
      if (id) {
        getConv(id);
        [detail, sidebar] = await Promise.all([request(base + `/conversations/${id}`).catch(error => error.status === 404 ? null : Promise.reject(error)), request('/api/sidebar/conversation?conversationId=' + id, undefined, true)]);
      }
      const [settings, knowledge] = await Promise.all([request(base + '/agent/settings'), request(base + '/knowledge')]);
      return json(res, 200, { conversations: db.prepare('SELECT id,label,created_at,status FROM conversations ORDER BY created_at DESC LIMIT 50').all(), providerMessages: id ? messages(id) : [], detail, sidebar, settings: settings.settings, knowledge, faults: id ? faults(id) : null, deliveries: id ? db.prepare('SELECT id,status,due,attempts,route FROM deliveries WHERE conversation_id=? ORDER BY due DESC LIMIT 30').all(id) : [], traces: id ? db.prepare('SELECT * FROM traces WHERE conversation_id=? ORDER BY id DESC LIMIT 100').all(id).map(row => ({ ...row, data: JSON.parse(row.data) })) : [], recoveryEvery });
    }
    if (path === '/lab/customer' || path === '/lab/human') {
      const id = String(body.conversationId), text = String(body.text || '').trim();
      if (!text || text.length > 4000) return json(res, 400, { error: 'Enter a message of 1–4,000 characters.' });
      const message = addMessage(id, text, path.endsWith('/human') ? 'agent' : 'user', body.private ? 'private' : 'normal');
      trace(id, path.endsWith('/human') ? 'human-message' : 'widget-send', path.endsWith('/human') ? 'Teammate → provider' : 'Widget → provider · message accepted', { messageId: message.id, text });
      queueMessage(id, message, !path.endsWith('/human'));
      return json(res, 200, { message });
    }
    if (path === '/lab/seen') { getConv(body.conversationId); trace(body.conversationId, 'widget-received', String(body.messageId), { messageId: body.messageId }); return json(res, 200, { ok: true }); }
    if (path === '/lab/faults') {
      const p = body.faults || {};
      const patch = {};
      if (p.route !== undefined) patch.route = p.route === 'account' ? 'account' : 'product';
      if (p.delayMs !== undefined) patch.delayMs = Math.min(180_000, Math.max(0, Number(p.delayMs) || 0));
      for (const name of ['dropNext', 'duplicateNext']) if (p[name] !== undefined) patch[name] = Boolean(p[name]);
      for (const name of ['readFailures', 'sendFailures']) if (p[name] !== undefined) patch[name] = Math.min(3, Math.max(0, Number(p[name]) || 0));
      if (p.failureStatus !== undefined) patch.failureStatus = p.failureStatus === 429 ? 429 : 503;
      const result = updateFaults(body.conversationId, patch); trace(body.conversationId, 'fault-config', 'Connection conditions updated', result); return json(res, 200, result);
    }
    if (path === '/lab/action') {
      const id = String(body.conversationId); getConv(id);
      if (!['enable', 'disable', 'reply_now', 'resolve', 'reopen', 'replay'].includes(body.action)) return json(res, 400, { error: 'Unknown lab action' });
      if (body.action === 'replay') {
        db.prepare("UPDATE deliveries SET status='pending',due=?,attempts=0 WHERE conversation_id=? AND status IN ('dropped','failed')").run(Date.now(), id);
        trace(id, 'recovery', 'Replay dropped / failed notifications'); return json(res, 200, { ok: true });
      }
      if (['resolve', 'reopen'].includes(body.action)) {
        const status = body.action === 'resolve' ? 'resolved' : 'reopened';
        db.prepare('UPDATE conversations SET status=? WHERE id=?').run(status, id);
        const payload = { event: 'onConversationUpdate', data: { conversation: { conversation_id: id, app_id: 'app-lab', status } } };
        await request('/api/sidebar/events', payload, true);
        trace(id, 'conversation-status', 'Provider status: ' + status); return json(res, 200, { ok: true });
      }
      trace(id, body.action === 'reply_now' ? 'recovery' : 'sidebar-action', body.action === 'reply_now' ? 'Manual API recovery check (not automatic delivery)' : 'Sidebar: ' + body.action);
      return json(res, 200, await request('/api/sidebar/conversation', { conversationId: id, action: body.action, actor: { name: 'Lab operator' } }, true));
    }
    if (path === '/lab/settings') {
      const allowed = {}; if (['off', 'shadow', 'live'].includes(body.mode)) allowed.mode = body.mode;
      if (body.typingPace) allowed.typingPace = body.typingPace === 'instant' ? 'instant' : 'natural';
      if (Number.isFinite(body.debounceSeconds)) allowed.debounceSeconds = Math.min(12, Math.max(0, body.debounceSeconds));
      if (body.recoveryEvery !== undefined) { recoveryEvery = [0, 10_000, 600_000].includes(body.recoveryEvery) ? body.recoveryEvery : 0; nextRecovery = Date.now() + recoveryEvery; }
      const response = await fetch(worker + base + '/agent/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: `fq_session=${runtime.session}` }, body: JSON.stringify(allowed) });
      return json(res, response.status, await response.json());
    }
    if (req.method !== 'GET') return json(res, 404, { error: 'Unknown lab endpoint' });
    const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/widget.html': 'widget.html', '/widget.js': 'widget.js', '/widget.css': 'widget.css' };
    if (!files[path]) return json(res, 404, { error: 'Not found' });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[extname(files[path])], 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff' });
    res.end(readFileSync(resolve(root, 'lab/web', files[path])));
  } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.message }); else res.end(); }
});
server.listen(8790, '127.0.0.1', async () => {
  try {
    const knowledge = await request(base + '/knowledge');
    if (!knowledge.active) { const sample = JSON.parse(readFileSync(resolve(root, 'lab/knowledge.json'), 'utf8')); await publishKnowledge(sample.documents, sample.title); }
    initialized = true; console.log('Lab ready. Open http://127.0.0.1:8790');
  } catch (error) { startupError = error.message; console.error('Lab initialization:', error.message); }
});
process.on('SIGTERM', () => { server.close(); db.close(); process.exit(); });
