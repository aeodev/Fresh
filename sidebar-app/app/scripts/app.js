/* FreshQA sidebar: shows whether the agent or a person owns this chat, the last agent decision, and two buttons. */
(function () {
  "use strict";
  var client = null;
  var conversationId = "";
  var actor = { id: "", name: "Freshchat agent", email: "" };
  var state = null;
  var el = {};

  function $(id) { return document.getElementById(id); }
  function text(id, value) { $(id).textContent = value == null ? "" : String(value); }
  function show(id, visible) { $(id).hidden = !visible; }

  function parse(result) {
    var body = result && result.response;
    if (typeof body !== "string") return body || {};
    try { return JSON.parse(body); } catch (e) { return {}; }
  }

  function errorMessage(error) {
    var body = parse(error);
    return (body && body.error) || (error && error.message) || "FreshQA could not complete that action.";
  }

  function toast(message) {
    text("toast", message);
    show("toast", true);
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { show("toast", false); }, 2600);
  }

  function resize(height) {
    if (client && client.instance && typeof client.instance.resize === "function") {
      Promise.resolve(client.instance.resize({ height: height + "px" })).catch(function () {});
    }
  }

  function modeLabel(mode) {
    return mode === "live" ? "Live" : mode === "shadow" ? "Shadow" : "Agent off";
  }

  function stateLabel(s) {
    if (s === "agent") return "Agent is replying";
    if (s === "human") return "A person owns this chat";
    if (s === "resolved") return "Resolved";
    return "Not seen by FreshQA yet";
  }

  function render(data) {
    state = data;
    show("loading", false);
    show("error", false);
    show("body", true);
    text("company", data.companyName || "FreshQA");
    $("mode").className = "pill " + (data.mode || "off");
    text("mode", modeLabel(data.mode));
    $("state").className = "pill " + (data.state || "unknown");
    text("state", stateLabel(data.state));
    text("state-reason", data.stateReason || "");

    var turn = data.lastTurn;
    show("turn", Boolean(turn));
    if (turn) {
      $("turn-decision").className = "pill " + turn.decision;
      text("turn-decision", turn.decision === "sent" ? "Sent" : turn.decision === "shadow" ? "Drafted (shadow)" : turn.decision === "handoff" ? "Handed off" : "Error");
      text("turn-confidence", turn.confidence ? Math.round(turn.confidence * 100) + "% confident · " + (turn.citations ? turn.citations.length : 0) + " sources" : "");
      text("turn-answer", turn.answer || "(no answer drafted)");
      text("turn-reason", turn.reason || "");
    }

    var isAgent = data.state === "agent";
    var isHuman = data.state === "human";
    show("takeover", isAgent);
    show("handback", isHuman);
    show("reply-now", isAgent && data.mode !== "off");
    text("hint", data.mode === "off" ? "The agent is switched off for this company. Turn it on in FreshQA → Settings." : isHuman ? "The agent stays quiet until you hand the chat back." : data.mode === "shadow" ? "Shadow mode: the agent drafts replies but sends nothing." : "");
    $("open").href = data.dashboardUrl || "#";
    resize(turn ? 460 : 340);
  }

  function showError(message) {
    show("loading", false);
    show("body", false);
    show("error", true);
    text("error-text", message);
    resize(260);
  }

  function load() {
    if (!conversationId) return Promise.resolve();
    return client.request
      .invokeTemplate("getConversationState", { context: { conversationId: conversationId }, cache: false })
      .then(function (result) { render(parse(result)); })
      .catch(function (error) { showError(errorMessage(error)); });
  }

  function act(action) {
    var buttons = document.querySelectorAll("button[data-action]");
    buttons.forEach(function (b) { b.disabled = true; });
    return client.request
      .invokeTemplate("postConversationAction", { body: JSON.stringify({ conversationId: conversationId, action: action, actor: actor }) })
      .then(function (result) {
        var body = parse(result);
        if (action === "reply_now") toast("Agent: " + ((body.result && body.result.outcome) || "done"));
        else toast(action === "takeover" ? "You own this chat now." : "Handed back to the agent.");
        return load();
      })
      .catch(function (error) { toast(errorMessage(error)); })
      .finally(function () { buttons.forEach(function (b) { b.disabled = false; }); });
  }

  function activate() {
    return client.data.get("conversation").then(function (result) {
      var conversation = (result && result.conversation) || {};
      var id = String(conversation.conversation_id || conversation.id || "");
      if (!id) throw new Error("Open a conversation to use FreshQA.");
      if (id !== conversationId) {
        conversationId = id;
        show("body", false);
        show("loading", true);
      }
      return load();
    });
  }

  function bind() {
    document.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-action]");
      if (button) act(button.getAttribute("data-action"));
    });
    $("refresh").addEventListener("click", function () { load(); });
    if (client.events && typeof client.events.on === "function") {
      ["app.activated", "conversation.propertiesLoaded", "chatConversation.propertiesLoaded"].forEach(function (name) {
        try { client.events.on(name, function () { activate().catch(function (e) { showError(e.message); }); }); } catch (e) { /* older hosts */ }
      });
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
      var agent = (result && (result.loggedInAgent || result.loggedInUser)) || {};
      actor = {
        id: String(agent.id || agent.agent_id || ""),
        name: [agent.first_name, agent.last_name].filter(Boolean).join(" ") || agent.name || agent.email || "Freshchat agent",
        email: agent.email || "",
      };
      resize(340);
      return activate();
    }).catch(function (error) { showError(errorMessage(error)); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
