/* global fetch, setTimeout, console */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const host = 'http://127.0.0.1:8790';
const results = [];
async function api(path, body) {
  const response = await fetch(host + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); assert.equal(response.ok, true, data.error); return data;
}
const health = await api('/lab/health'); assert.equal(health.productionConnected, false); assert.equal(health.ready, true);
const { id } = await api('/lab/conversations', { label: 'Automated isolated connection checks' });
const state = () => api('/lab/state?conversationId=' + id);
const action = action => api('/lab/action', { conversationId: id, action });
const send = text => api('/lab/customer', { conversationId: id, text });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(label, predicate, timeout = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { const s = await state(); if (predicate(s)) { results.push({ label, result: 'PASS', elapsedMs: Date.now() - started }); console.log('PASS', label); return s; } await sleep(400); }
  throw Error('Timed out: ' + label);
}
try {
  await api('/lab/settings', { mode: 'live', typingPace: 'instant', debounceSeconds: 0, recoveryEvery: 0 });
  await action('enable');
  await send('Hey this is development team, please do not reply. Thanks.');
  let s = await wait('exact silence request stays enabled', s => s.sidebar.lastTurn?.decision === 'silent');
  assert.equal(s.sidebar.state, 'agent'); assert.equal(s.providerMessages.filter(m => m.actor_type === 'agent').length, 0);
  await api('/lab/faults', { conversationId: id, faults: { duplicateNext: true } });
  await send('What plans do you offer here?');
  s = await wait('real AI plan reply through product event and REST transport', s => s.sidebar.lastTurn?.decision === 'sent');
  assert.match(s.sidebar.lastTurn.answer, /24\.99/); assert.equal(s.providerMessages.filter(m => m.actor_type === 'agent').length, 1);
  assert.ok(s.traces.some(t => t.stage === 'api-request' && t.label.startsWith('GET')));
  assert.ok(s.traces.some(t => t.stage === 'reply-stored'));
  await sleep(1500); s = await state(); assert.equal(s.providerMessages.filter(m => m.actor_type === 'agent').length, 1); console.log('PASS duplicate event does not duplicate public reply'); results.push({ label: 'duplicate event does not duplicate reply', result: 'PASS' });
  await send('What is the exact balance on my personal account?');
  s = await wait('unsupported account question is held without pausing', s => s.sidebar.lastTurn?.decision === 'review'); assert.equal(s.sidebar.state, 'agent');
  await send("I'm confused. Can you help me reset my password one step at a time?");
  s = await wait('supported next question recovers and offers guided help', s => s.sidebar.lastTurn?.decision === 'sent' && /reset my password/.test(s.sidebar.lastTurn.question));
  assert.match(s.sidebar.lastTurn.answer, /Forgot Password/i); assert.ok(s.sidebar.lastTurn.answer.length < 650);
  await api('/lab/faults', { conversationId: id, faults: { dropNext: true } });
  const before = s.providerMessages.filter(m => m.actor_type === 'agent').length;
  await send('I clicked Forgot Password. What do I do now?');
  await sleep(2000); s = await state(); assert.equal(s.providerMessages.filter(m => m.actor_type === 'agent').length, before); assert.ok(s.deliveries.some(d => d.status === 'dropped'));
  console.log('PASS missing notification is visible separately from stored message'); results.push({ label: 'dropped event is visible and does not secretly bypass the transport', result: 'PASS' });
  await action('replay');
  s = await wait('replaying dropped event recovers through real pipeline', s => s.sidebar.lastTurn?.decision === 'sent' && s.sidebar.lastTurn.question.startsWith('I clicked Forgot'));
  assert.match(s.sidebar.lastTurn.answer, /email/i);
  await api('/lab/settings', { mode: 'shadow' });
  await send('Do you have a free trial?');
  s = await wait('shadow drafts without a customer-facing send', s => s.sidebar.lastTurn?.decision === 'shadow');
  const shadowCount = s.providerMessages.filter(m => m.actor_type === 'agent').length;
  await api('/lab/settings', { mode: 'live' });
  await api('/lab/human', { conversationId: id, text: 'Private teammate note.', private: true });
  await sleep(1000); assert.equal((await state()).sidebar.state, 'agent');
  await api('/lab/human', { conversationId: id, text: 'Hi, Sam here. I will take over.' });
  s = await wait('real teammate event transfers ownership', s => s.sidebar.state === 'human');
  await send('What are your plans?'); await sleep(2000); s = await state(); assert.equal(s.providerMessages.filter(m => m.actor_type === 'agent').length, shadowCount + 2);
  await action('resolve'); await wait('resolved status stops the agent', s => s.sidebar.state === 'resolved');
  await action('reopen'); s = await wait('reopened chat requires explicit sidebar enable', s => s.sidebar.state !== 'resolved'); assert.notEqual(s.sidebar.state, 'agent');
  await action('enable');
  await api('/lab/faults', { conversationId: id, faults: { route: 'account', delayMs: 1000 } });
  await send('Does the free trial need a credit card?');
  s = await wait('account webhook route and delayed notification deliver a grounded answer', s => s.sidebar.lastTurn?.decision === 'sent' && s.sidebar.lastTurn.question.includes('credit card'));
  assert.match(s.sidebar.lastTurn.answer, /no|doesn.t|not/i);
  await action('disable');
  writeFileSync('lab/.state/check-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), environment: 'isolated local full Worker + mock provider + real AI', timing: 'instant pacing / zero debounce for checks', conversationId: id, results }, null, 2));
  console.log(`Completed ${results.length} checks. No production messaging.`);
} finally { await api('/lab/settings', { mode: 'live', typingPace: 'natural', debounceSeconds: 3, recoveryEvery: 0 }); }
