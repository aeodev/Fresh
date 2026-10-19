/* global document, localStorage, fetch, location, Blob, URL, setInterval */
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let conversationId = localStorage.getItem('freshqa_lab_conversation') || '';
let state = null, ready = false, polling = false, creating = false;
const showError = error => { $('error').hidden = !error; $('error').textContent = error?.message || error || ''; };
async function api(path, body) {
  const response = await fetch(path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Lab request failed');
  return data;
}
function selectConversation(id) {
  conversationId = id; localStorage.setItem('freshqa_lab_conversation', id);
  $('widget').src = '/widget.html?conversationId=' + encodeURIComponent(id);
  showError(null); refresh();
}
async function createConversation() {
  if (creating) return;
  creating = true;
  try { const result = await api('/lab/conversations', { label: 'Client test ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }); selectConversation(result.id); }
  finally { creating = false; }
}
function setSelect(id, value) { if (document.activeElement !== $(id)) $(id).value = value; }
function render(data) {
  state = data;
  $('sessions').innerHTML = data.conversations.map(c => `<button class="session ${c.id === conversationId ? 'active' : ''}" data-conversation="${escape(c.id)}">${escape(c.label)}<small>${escape(c.status)} · ${escape(c.id.slice(0, 8))}</small></button>`).join('');
  const s = data.sidebar;
  const on = s?.state === 'agent';
  $('agent-status').textContent = on ? s.needsAttention ? 'Agent is on · review needed' : 'Fresh QA is on' : s?.state === 'resolved' ? 'Conversation resolved' : s?.state === 'human' ? 'Human is handling this chat' : 'Fresh QA is off';
  $('state-reason').textContent = s?.stateReason || 'Enable this test conversation to allow replies.';
  $('toggle').setAttribute('aria-checked', String(on));
  $('toggle').disabled = !conversationId || s?.state === 'resolved' || (!on && data.settings.mode !== 'live');
  $('toggle').setAttribute('aria-label', on ? 'Pause Fresh QA for this test' : 'Enable Fresh QA for this test');
  $('mode-pill').textContent = 'Lab ' + data.settings.mode;
  setSelect('mode', data.settings.mode); setSelect('pace', data.settings.typingPace);
  const f = data.faults || {};
  setSelect('route', f.route || 'product'); setSelect('delay', String(f.delayMs || 0));
  setSelect('recovery', String(data.recoveryEvery));
  $('drop').classList.toggle('armed', Boolean(f.dropNext)); $('drop').textContent = f.dropNext ? 'Drop armed ✓' : 'Drop next event';
  $('duplicate').classList.toggle('armed', Boolean(f.duplicateNext)); $('duplicate').textContent = f.duplicateNext ? 'Duplicate armed ✓' : 'Duplicate next event';
  const turns = data.detail?.turns || [];
  const turn = s?.lastTurn || turns[turns.length - 1];
  if (turn) {
    const labels = { sent: 'REPLIED', review: 'HELD FOR REVIEW', silent: 'STAYED QUIET', handoff: 'HUMAN HANDOFF', shadow: 'DRAFT ONLY', error: 'CHECK NEEDED' };
    $('turn').innerHTML = `<div class="turn-meta"><span class="decision ${escape(turn.decision)}">${escape(turn.reason === 'Reply in progress' ? 'PREPARING REPLY' : labels[turn.decision] || turn.decision)}</span><span>${Math.round(turn.confidence * 100)}% confidence</span></div><div class="turn-answer">${escape(turn.answer || (turn.decision === 'silent' ? 'No customer reply sent. Watching for the next message.' : 'No customer reply sent.')).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')}</div><div class="turn-reason">${escape(turn.reason)}</div><details><summary>${turn.citations.length} source${turn.citations.length === 1 ? '' : 's'} · ${escape(turn.model || 'no model call')} · ${turn.latencyMs}ms model time</summary>${turn.citations.map(c => `<p><b>${escape(c.heading)}</b><br>${escape(c.excerpt)}</p>`).join('')}</details>`;
  } else $('turn').innerHTML = '<div class="empty"><span>◎</span><strong>No decision yet</strong><p>Send a message from the customer widget to exercise the full connection.</p></div>';
  const version = data.knowledge.active?.version;
  $('knowledge-version').textContent = version ? `v${version.number} · active in lab` : 'No active version';
  $('knowledge-label').textContent = version ? version.title + '. This version belongs only to the lab database.' : 'Preparing isolated test knowledge.';
  const pending = data.deliveries.filter(d => ['pending', 'sending'].includes(d.status)).length;
  const dropped = data.deliveries.filter(d => ['dropped', 'failed'].includes(d.status)).length;
  $('delivery-status').textContent = `${pending} pending · ${dropped} dropped/failed · ${data.deliveries.filter(d => d.status === 'delivered').length} delivered`;
  const journey = [...data.traces, ...(data.detail?.events || []).filter(e => /^turn_(drafted|sent|review|handoff|silent|error|skipped|interrupted)$/.test(e.type)).map(e => ({ at: e.createdAt, stage: e.type, label: ({ turn_drafted: 'Draft created from lab knowledge', turn_sent: 'Reply passed the send gate', turn_review: 'Reply held; agent remains enabled', turn_handoff: 'Human handoff', turn_silent: 'Silence request respected', turn_error: 'Turn needs review', turn_skipped: 'Wake-up safely skipped', turn_interrupted: 'Stale reply interrupted' })[e.type] || e.type, data: e.detail }))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  $('trace-count').textContent = journey.length + ' events';
  $('timeline').innerHTML = journey.map(t => `<details class="trace ${escape(t.stage)}"><label>${escape(new Date(t.at).toLocaleTimeString())} · ${escape(t.stage)}</label><summary>${escape(t.stage === 'widget-received' ? 'Widget received the agent reply' : t.label)}</summary><pre>${escape(JSON.stringify(t.data, null, 2))}</pre></details>`).join('');
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const health = await api('/lab/health'); ready = health.ready;
    $('new').disabled = !ready;
    $('engine').textContent = ready ? 'Real Fresh QA engine + AI' : 'Preparing real engine…';
    $('ready').textContent = ready ? '● Mock provider connected' : health.error || 'Preparing isolated knowledge…';
    if (health.error) throw Error(health.error);
    if (!ready) return;
    if (!conversationId) { await createConversation(); return; }
    try { render(await api('/lab/state?conversationId=' + encodeURIComponent(conversationId))); }
    catch (error) { if (/Unknown lab conversation/.test(error.message)) { conversationId = ''; await createConversation(); } else throw error; }
  } catch (error) { showError(error); }
  finally { polling = false; }
}
async function action(action) { if (!conversationId) return; await api('/lab/action', { conversationId, action }); await refresh(); }
async function changeFaults(patch) { if (!conversationId) return; await api('/lab/faults', { conversationId, faults: patch }); await refresh(); }
function handle(fn) { return async event => { try { showError(null); await fn(event); } catch (error) { showError(error); } }; }
$('new').addEventListener('click', handle(createConversation));
$('sessions').addEventListener('click', event => { const b = event.target.closest('[data-conversation]'); if (b) selectConversation(b.dataset.conversation); });
$('toggle').addEventListener('click', handle(() => action(state?.sidebar?.state === 'agent' ? 'disable' : 'enable')));
for (const name of ['resolve', 'reopen', 'replay']) $(name).addEventListener('click', handle(() => action(name)));
$('poll').addEventListener('click', handle(() => action('reply_now')));
$('mode').addEventListener('change', handle(async () => { await api('/lab/settings', { mode: $('mode').value }); await refresh(); }));
$('pace').addEventListener('change', handle(async () => { await api('/lab/settings', { typingPace: $('pace').value }); await refresh(); }));
$('route').addEventListener('change', handle(() => changeFaults({ route: $('route').value })));
$('delay').addEventListener('change', handle(() => changeFaults({ delayMs: Number($('delay').value) })));
$('drop').addEventListener('click', handle(() => changeFaults({ dropNext: !state?.faults?.dropNext })));
$('duplicate').addEventListener('click', handle(() => changeFaults({ duplicateNext: !state?.faults?.duplicateNext })));
$('api-fault').addEventListener('change', handle(async () => {
  const value = $('api-fault').value;
  await changeFaults({ readFailures: ['read', 'rate'].includes(value) ? 3 : 0, sendFailures: value === 'send' ? 3 : 0, failureStatus: value === 'rate' ? 429 : 503 });
}));
$('recovery').addEventListener('change', handle(async () => { await api('/lab/settings', { recoveryEvery: Number($('recovery').value) }); await refresh(); }));
$('human-form').addEventListener('submit', handle(async event => { event.preventDefault(); await api('/lab/human', { conversationId, text: $('human-text').value, private: $('private').checked }); $('human-text').value = ''; await refresh(); }));
$('knowledge-form').addEventListener('submit', handle(async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; button.textContent = 'Indexing lab knowledge…';
  try { await api('/lab/knowledge', { title: $('knowledge-title').value, content: $('knowledge-text').value }); $('knowledge-text').value = ''; await refresh(); } finally { button.disabled = false; button.textContent = 'Publish lab version'; }
}));
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { $('widget').contentWindow.postMessage({ type: 'lab:prefill', text: button.dataset.preset }, location.origin); }));
$('guide-open').addEventListener('click', () => { $('connection-guide').open = true; $('connection-guide').scrollIntoView({ behavior: 'smooth' }); });
$('export').addEventListener('click', () => {
  if (!state) return;
  const blob = new Blob([JSON.stringify({ environment: 'isolated connection lab', exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `freshqa-lab-${conversationId.slice(0, 8)}.json`; a.click(); URL.revokeObjectURL(url);
});
if (conversationId) $('widget').src = '/widget.html?conversationId=' + encodeURIComponent(conversationId);
refresh(); setInterval(refresh, 1200);
