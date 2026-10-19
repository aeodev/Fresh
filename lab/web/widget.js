/* global document, URLSearchParams, location, fetch, window, parent, setInterval */
const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get('conversationId');
let connected = true, sending = false, lastIds = '', rendered = new Set();
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Widget request failed'); return data;
}
async function poll() {
  if (!id || !connected) return;
  try {
    const data = await api('/lab/widget?conversationId=' + encodeURIComponent(id));
    $('connection').textContent = data.status === 'resolved' ? 'Conversation resolved' : 'Connected to lab provider';
    const visible = data.messages.filter(m => m.message_type === 'normal');
    const ids = visible.map(m => m.id).join(',');
    if (ids !== lastIds) {
      lastIds = ids;
      if (visible.length) $('messages').replaceChildren();
      for (const message of visible) {
        const element = document.createElement('div'); element.className = 'message ' + message.actor_type;
        const bubble = document.createElement('div'); bubble.className = 'bubble'; const text = message.message_parts.map(p => p.text?.content || '').join('\n');
        for (const part of text.split(/(\*\*[^*\n]+\*\*)/g)) {
          if (part.startsWith('**') && part.endsWith('**') && part.length > 4) { const strong = document.createElement('strong'); strong.textContent = part.slice(2, -2); bubble.append(strong); }
          else bubble.append(document.createTextNode(part));
        }
        const label = document.createElement('small'); label.textContent = (message.actor_type === 'user' ? 'You' : message.actor_id === 'agent-lab-ai' ? 'Ava · Fresh QA' : 'Sam · teammate') + ' · ' + new Date(message.created_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        element.append(bubble, label); $('messages').append(element);
        if (!rendered.has(message.id) && message.actor_type === 'agent') api('/lab/seen', { conversationId: id, messageId: message.id }).catch(() => {});
        rendered.add(message.id);
      }
      $('messages').scrollTop = $('messages').scrollHeight;
    }
  } catch (error) { $('error').hidden = false; $('error').textContent = error.message; }
}
async function send(event) {
  event?.preventDefault(); if (!id || !connected || sending || !$('message').value.trim()) return;
  sending = true; $('send').disabled = true; $('error').hidden = true;
  try { await api('/lab/customer', { conversationId: id, text: $('message').value }); $('message').value = ''; await poll(); }
  catch (error) { $('error').hidden = false; $('error').textContent = error.message; }
  finally { sending = false; $('send').disabled = !connected; }
}
$('compose').addEventListener('submit', send);
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } });
$('offline').addEventListener('click', () => { connected = !connected; $('connection').textContent = connected ? 'Reconnecting…' : 'Widget disconnected'; $('send').disabled = !connected; $('message').disabled = !connected; $('offline').setAttribute('aria-label', connected ? 'Disconnect widget' : 'Reconnect widget'); if (connected) poll(); });
window.addEventListener('message', event => { if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'lab:prefill') return; $('message').value = String(event.data.text || '').slice(0, 4000); $('message').focus(); });
$('session').textContent = id ? 'Session ' + id.slice(0, 8) : 'Create a test conversation';
$('send').disabled = !id; $('message').disabled = !id;
poll(); setInterval(poll, 800);
