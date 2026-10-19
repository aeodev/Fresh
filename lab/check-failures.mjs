/* global fetch, setTimeout, console */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const host = 'http://127.0.0.1:8790';
const results = [];
async function api(path, body) { const r = await fetch(host + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); assert.equal(r.ok, true, d.error); return d; }
const { id } = await api('/lab/conversations', { label: 'API failure and recovery checks' });
const state = () => api('/lab/state?conversationId=' + id);
const action = action => api('/lab/action', { conversationId: id, action });
const send = text => api('/lab/customer', { conversationId: id, text });
async function wait(question, decision) { const deadline = Date.now() + 60_000; while (Date.now() < deadline) { const s = await state(); if (s.sidebar.lastTurn?.question === question && s.sidebar.lastTurn.decision === decision && (decision !== 'error' || (s.sidebar.needsAttention && s.sidebar.lastTurn.reason.startsWith('Reply incomplete')))) return s; await new Promise(resolve => setTimeout(resolve, 400)); } throw Error('Timed out: ' + question); }
function pass(label) { results.push({ label, result: 'PASS' }); console.log('PASS', label); }
try {
  await api('/lab/settings', { mode: 'live', typingPace: 'instant', debounceSeconds: 0 }); await action('enable');
  for (const failureStatus of [503, 429]) {
    await api('/lab/faults', { conversationId: id, faults: { readFailures: 3, failureStatus } });
    const q = failureStatus === 503 ? 'What plans do you offer?' : 'How long is the free trial?';
    await send(q); const s = await wait(q, 'sent');
    assert.equal(s.sidebar.state, 'agent'); assert.ok(s.traces.filter(t => t.stage === 'api-error' && t.label.includes(String(failureStatus))).length >= 3);
    pass(`HTTP ${failureStatus} read failures exercise real client retries and recover`);
  }
  await api('/lab/faults', { conversationId: id, faults: { sendFailures: 3, failureStatus: 503 } });
  const q = 'Can you explain the subscription plans?';
  const before = (await state()).providerMessages.filter(m => m.actor_type === 'agent').length;
  await send(q); let s = await wait(q, 'error');
  assert.equal(s.sidebar.state, 'agent'); assert.equal(s.sidebar.needsAttention, true);
  assert.equal(s.providerMessages.filter(m => m.actor_type === 'agent').length, before);
  pass('failed public send is held without pausing or creating a reply');
  const next = 'Does the free trial require a credit card?'; await send(next); s = await wait(next, 'sent'); assert.equal(s.sidebar.state, 'agent');
  pass('fresh question recovers after a failed send without re-enabling');
  const forbidden = await fetch(host + '/lab/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://not-the-lab.invalid' }, body: '{}' }); assert.equal(forbidden.status, 403);
  const noConfig = await fetch(host + '/mock/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhook: 'https://not-the-lab.invalid' }) }); assert.equal(noConfig.status, 404);
  pass('cross-origin mutations and editable external webhook targets are rejected');
  await action('disable');
  writeFileSync('lab/.state/failure-check-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), conversationId: id, timing: 'instant pacing / zero debounce', results }, null, 2));
} finally { await action('disable').catch(() => {}); await api('/lab/settings', { mode: 'live', typingPace: 'natural', debounceSeconds: 3, recoveryEvery: 0 }); }
