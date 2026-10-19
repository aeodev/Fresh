/* FreshQA sidebar: one control for this chat, with the latest decision close at hand. */
(function () {
  "use strict";
  let client = null;
  let conversationId = "";
  let actor = { id: "", name: "Freshchat agent", email: "" };
  let pollTimer = null;
  let active = true;
  let pendingLoad = null;
  let lastLoadedId = "";
  let lastLoadedAt = 0;
  let cooldownUntil = 0;
  let lastData = null;
  const POLL_MS = 30000;
  const COOLDOWN_MS = 65000;

  function $(id) { return document.getElementById(id); }
  function text(id, value) { $(id).textContent = value === null || value === undefined ? "" : String(value); }
  function show(id, visible) { $(id).hidden = !visible; }

  function parse(result) {
    const body = result && result.response;
    if (typeof body !== "string") return body || {};
    try { return JSON.parse(body); } catch { return {}; }
  }

  function errorMessage(error) {
    const body = parse(error);
    return (body && (body.error || body.message)) || (error && error.message) || "FreshQA could not complete that action.";
  }

  function toast(message) {
    text("toast", message);
    show("toast", true);
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { show("toast", false); }, 2600);
  }

  function resize(height) {
    if (client && client.instance && typeof client.instance.resize === "function") {
      Promise.resolve(client.instance.resize({ height: height + "px" })).catch(function () { return undefined; });
    }
  }

  function fitHeight() {
    resize(Math.max(190, Math.ceil(document.querySelector(".shell").getBoundingClientRect().height + 6)));
  }

  function modeLabel(mode) {
    return mode === "live" ? "Live" : mode === "shadow" ? "Shadow" : "Agent off";
  }

  function render(data) {
    show("loading", false);
    show("error", false);
    show("body", true);
    text("company", data.companyName || "FreshQA");
    $("mode").className = "pill " + (data.mode || "off");
    text("mode", modeLabel(data.mode));
    const on = data.state === "agent";
    const toggle = $("toggle");
    toggle.setAttribute("aria-checked", on ? "true" : "false");
    toggle.setAttribute("aria-label", on ? "Pause FreshQA for this chat" : "Turn on FreshQA for this chat");
    toggle.setAttribute("data-action", on ? "disable" : "enable");
    toggle.disabled = data.state === "resolved" || (!on && data.mode !== "live");
    let title = "Agent is off";
    let description = "Turn on to read this chat and answer the latest open customer message.";
    if (data.mode !== "live") {
      title = data.mode === "shadow" ? "Company is in Shadow mode" : "Company agent is off";
      description = "Set the company agent to Live in FreshQA settings to reply here.";
    } else if (data.state === "resolved") {
      title = "Conversation resolved";
      description = "Reopen the conversation in Freshchat before using the agent.";
    } else if (on) {
      title = data.needsAttention ? "Agent is on, review needed" : "Agent is on";
      description = data.stateReason || "Watching for the next customer message.";
    } else if (data.state === "human") {
      title = "Agent is paused";
      description = "A person is handling this chat. Turn on when you want FreshQA to take over.";
    }
    text("status-title", title);
    text("status-copy", description);
    show("attention", Boolean(data.needsAttention));
    text("attention-text", data.stateReason || "This chat needs a person to check it.");

    const turn = data.lastTurn;
    show("turn", Boolean(turn && data.state !== "unknown"));
    if (turn) {
      $("turn-decision").className = "pill " + turn.decision;
      text("turn-decision", turn.decision === "sent" ? "Replied" : turn.decision === "silent" ? "Stayed quiet" : turn.decision === "review" ? "Held for review" : turn.decision === "shadow" ? "Drafted" : turn.decision === "handoff" ? "Handed off" : "Needs review");
      text("turn-answer", turn.decision === "silent" ? "No message sent. The next customer message can be answered." : turn.answer || "");
      text("turn-reason", turn.reason || "");
      show("turn-answer", Boolean(turn.answer || turn.decision === "silent"));
      show("turn-reason", Boolean(turn.reason));
    }
    fitHeight();
  }

  function showError(message) {
    show("loading", false);
    show("body", false);
    show("error", true);
    text("error-text", message);
    fitHeight();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!active || document.hidden || !conversationId) return;
    pollTimer = setTimeout(function () { load(); }, Math.max(POLL_MS, cooldownUntil - Date.now()));
  }

  function limited(error) {
    return Number(error && error.status) === 429 || /(?:50 requests|requests per minute|rate.?limit|too many requests)/i.test(errorMessage(error));
  }

  function requestError(error) {
    if (limited(error)) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
      const message = "Freshchat is temporarily limiting app requests. Retrying in about a minute.";
      if (lastData) toast(message); else showError(message);
    } else showError(errorMessage(error));
  }

  function load(force) {
    if (!conversationId || !active || document.hidden) return Promise.resolve();
    if (pendingLoad) return pendingLoad;
    if (Date.now() < cooldownUntil || (!force && lastLoadedId === conversationId && Date.now() - lastLoadedAt < 2000)) {
      schedulePoll();
      return Promise.resolve();
    }
    const requestedId = conversationId;
    lastLoadedId = requestedId;
    lastLoadedAt = Date.now();
    clearTimeout(pollTimer);
    pendingLoad = client.request
      .invokeTemplate("getConversationState", { context: { conversationId: requestedId }, cache: false })
      .then(function (result) {
        if (requestedId !== conversationId) return;
        lastData = parse(result);
        render(lastData);
      })
      .catch(function (error) { if (requestedId === conversationId) requestError(error); })
      .finally(function () {
        pendingLoad = null;
        if (requestedId !== conversationId) load(); else schedulePoll();
      });
    return pendingLoad;
  }

  function act(action) {
    if (Date.now() < cooldownUntil) { toast("Freshchat is limiting requests. Please wait about a minute."); return Promise.resolve(); }
    const buttons = document.querySelectorAll("button[data-action]");
    buttons.forEach(function (b) { b.disabled = true; });
    return client.request
      .invokeTemplate("postConversationAction", { body: JSON.stringify({ conversationId: conversationId, action: action, actor: actor }) })
      .then(function () {
        toast(action === "disable" ? "Agent paused for this chat." : "Agent is reading this chat.");
        return load(true);
      })
      .catch(function (error) { if (limited(error)) requestError(error); else toast(errorMessage(error)); })
      .finally(function () { buttons.forEach(function (b) { b.disabled = false; }); });
  }

  function activate() {
    return client.data.get("conversation").then(function (result) {
      const conversation = (result && result.conversation) || {};
      const id = String(conversation.conversation_id || conversation.id || "");
      if (!id) throw new Error("Open a conversation to use FreshQA.");
      if (id !== conversationId) {
        conversationId = id;
        lastData = null;
        show("body", false);
        show("loading", true);
      }
      return load();
    });
  }

  function bind() {
    document.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-action]");
      if (button) act(button.getAttribute("data-action"));
    });
    $("refresh").addEventListener("click", function () { load(); });
    window.addEventListener("pagehide", function () { active = false; clearTimeout(pollTimer); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) clearTimeout(pollTimer); else if (active) load(); });
    if (client.events && typeof client.events.on === "function") {
      ["app.activated", "conversation.propertiesLoaded", "chatConversation.propertiesLoaded"].forEach(function (name) {
        try { client.events.on(name, function () { active = true; activate().catch(function (e) { showError(e.message); }); }); } catch { /* older hosts */ }
      });
      try { client.events.on("app.deactivated", function () { active = false; clearTimeout(pollTimer); }); } catch { /* older hosts */ }
    }
  }

  function init() {
    if (!window.app || typeof window.app.initialized !== "function") {
      showError("Freshchat did not initialize the app. Upload an FDK-packed ZIP (see README).");
      return;
    }
    window.app.initialized().then(function (c) {
      client = c;
      bind();
      return client.data.get("loggedInAgent").catch(function () { return {}; });
    }).then(function (result) {
      const agent = (result && (result.loggedInAgent || result.loggedInUser)) || {};
      actor = {
        id: String(agent.id || agent.agent_id || ""),
        name: [agent.first_name, agent.last_name].filter(Boolean).join(" ") || agent.name || agent.email || "Freshchat agent",
        email: agent.email || "",
      };
      resize(205);
      return activate();
    }).catch(function (error) { showError(errorMessage(error)); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
