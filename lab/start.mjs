/* global process, setTimeout, console, fetch */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Refuse occupied ports rather than accidentally attaching to another running app.
for (const port of [8788, 8790]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(Error(`Port ${port} is already in use. Close the previous local lab first.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
const state = resolve(root, 'lab/.state');
mkdirSync(state, { recursive: true, mode: 0o700 });
const hash = value => createHash('sha256').update(value).digest('hex');
const parse = path => Object.fromEntries((existsSync(path) ? readFileSync(path, 'utf8') : '').split('\n').flatMap(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, '$2')]] : [];
}));
const local = parse(resolve(root, '.env'));
const dedicated = parse(resolve(root, 'lab/.dev.vars'));
const key = process.env.FRESHQA_LAB_OPENAI_API_KEY || dedicated.OPENAI_API_KEY || local.OPENAI_API_KEY;
if (!key) throw Error('Set FRESHQA_LAB_OPENAI_API_KEY or OPENAI_API_KEY in lab/.dev.vars. Only the AI key is needed; never add Freshchat credentials.');
// Explicit allowlist: never copy PUBLIC_BASE_URL, encryption keys, Freshchat credentials or production bindings.
writeFileSync(resolve(root, 'lab/.dev.vars'), `OPENAI_API_KEY=${JSON.stringify(key)}\nOPENAI_ANSWER_MODEL=${JSON.stringify(dedicated.OPENAI_ANSWER_MODEL || local.OPENAI_ANSWER_MODEL || 'gpt-5.6-luna')}\nOPENAI_EMBEDDING_MODEL=${JSON.stringify(dedicated.OPENAI_EMBEDDING_MODEL || local.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small')}\nOPENAI_DAILY_REQUEST_LIMIT=500\n`, { mode: 0o600 });
const configFile = resolve(root, 'lab/.lab-runtime.json');
const runtime = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : { session: randomBytes(32).toString('hex'), sidebarToken: randomBytes(32).toString('hex'), webhookSecret: randomBytes(24).toString('hex') };
writeFileSync(configFile, JSON.stringify(runtime), { mode: 0o600 });
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const args = ['--config', resolve(root, 'lab/wrangler.jsonc')];
const persist = ['--persist-to', resolve(state, 'runtime')];
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
async function command(parts) {
  const child = spawn(process.execPath, [wrangler, ...parts, ...args, ...persist], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw Error(`Local lab setup failed: ${output.slice(-2000)}`);
}
await command(['d1', 'migrations', 'apply', 'freshqa-lab', '--local']);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const seed = `INSERT OR IGNORE INTO users(id,email,name,password_hash) VALUES('lab-owner','lab@example.invalid','Lab operator','disabled-login');
INSERT OR IGNORE INTO companies(id,slug,name,created_by) VALUES('co_lab','connection-lab','Apollo · isolated lab','lab-owner');
INSERT OR IGNORE INTO memberships(company_id,user_id,role) VALUES('co_lab','lab-owner','owner');
INSERT OR IGNORE INTO agent_settings(company_id,mode,typing_pace,persona) VALUES('co_lab','live','natural','Use friendly everyday language. Help patiently, one small step at a time when the customer is confused.');
INSERT INTO freshchat_connections(company_id,api_base_url,api_key_enc,app_id,reply_agent_id,reply_agent_name,webhook_secret,verified_at)
VALUES('co_lab','http://127.0.0.1:8790/v2','plain:lab-transport-only','app-lab','agent-lab-ai','Ava',${quote(runtime.webhookSecret)},'2026-01-01')
ON CONFLICT(company_id) DO UPDATE SET api_base_url='http://127.0.0.1:8790/v2',api_key_enc='plain:lab-transport-only',app_id='app-lab',webhook_secret=excluded.webhook_secret;
INSERT OR REPLACE INTO sessions(id,user_id,expires_at) VALUES(${quote(hash(runtime.session))},'lab-owner','2099-01-01T00:00:00Z');
INSERT OR IGNORE INTO sidebar_tokens(token_hash,company_id,label,created_by) VALUES(${quote(hash(runtime.sidebarToken))},'co_lab','Isolated lab sidebar','lab-owner');`;
const seedFile = resolve(state, 'seed.sql');
writeFileSync(seedFile, seed, { mode: 0o600 });
await command(['d1', 'execute', 'freshqa-lab', '--local', '--file', seedFile]);
const log = openSync(resolve(state, 'worker.log'), 'a', 0o600);
const worker = spawn(process.execPath, [wrangler, 'dev', ...args, ...persist, '--local', '--ip', '127.0.0.1', '--port', '8788', '--inspector-port', '15438', '--test-scheduled', '--show-interactive-dev-session=false'], { cwd: root, env, stdio: ['ignore', log, log] });
let stopping = false;
const children = [worker];
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); setTimeout(() => process.exit(), 1500).unref(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
worker.on('exit', () => { if (!stopping) { console.error('Lab Worker stopped. See lab/.state/worker.log.'); stop(); } });
for (let n = 0; n < 100; n++) {
  try { const response = await fetch('http://127.0.0.1:8788/api/health'); if (response.ok && (await response.json()).app === 'FreshQA Connection Lab') break; } catch { /* runtime starting */ }
  if (n === 99) throw Error('Lab Worker did not start. See lab/.state/worker.log.');
  await new Promise(resolve => setTimeout(resolve, 300));
}
const provider = spawn(process.execPath, [resolve(root, 'lab/server.mjs')], { cwd: root, env, stdio: 'inherit' });
children.push(provider);
provider.on('exit', () => { if (!stopping) stop(); });
console.log('Fresh QA Connection Lab: http://127.0.0.1:8790');
console.log('Isolated databases. Mock Freshchat transport. Real Fresh QA Worker and AI. No production messaging.');
