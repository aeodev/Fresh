/**
 * Forwards Freshchat product events to FreshQA. Because the app is installed on the account,
 * Freshchat delivers conversation and message events here; FreshQA never needs the account's
 * single webhook slot. The install token in the request template names the company.
 */

function forward(payload, eventName) {
  return $request
    .invokeTemplate("postFreshqaEvent", {
      body: JSON.stringify({ event: eventName, data: payload && payload.data ? payload.data : payload }),
    })
    .catch((error) => {
      // Never block Freshchat on a failed forward; FreshQA's reconcile job catches missed events.
      console.error(`FreshQA forward failed for ${eventName}`, error && error.status);
    });
}

function ping(eventName, payload) {
  const host = payload && payload.iparams && payload.iparams.freshqa_host;
  return $request
    .invokeTemplate("postFreshqaInstall", { body: JSON.stringify({ event: eventName, host: host || "" }) })
    .catch((error) => console.error("FreshQA install ping failed", error && error.status));
}

exports = {
  onAppInstallCallback(payload) {
    return ping("install", payload).finally(() => renderData());
  },
  afterAppUpdateCallback(payload) {
    return ping("update", payload).finally(() => renderData());
  },
  onConversationCreateCallback(payload) {
    return forward(payload, "onConversationCreate");
  },
  onConversationUpdateCallback(payload) {
    return forward(payload, "onConversationUpdate");
  },
  onMessageCreateCallback(payload) {
    return forward(payload, "onMessageCreate");
  },
};
