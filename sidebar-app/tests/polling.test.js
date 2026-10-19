import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../app/scripts/app.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function setup(invoke) {
  const events = {};
  const listeners = {};
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, setAttribute() {}, addEventListener(name, fn) { listeners[id + ":" + name] = fn; } });
    return elements.get(id);
  };
  const document = {
    hidden: false,
    getElementById: element,
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 220 }) }),
    querySelectorAll: () => [],
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  const client = {
    data: { get: vi.fn(async (name) => name === "conversation" ? { conversation: { id: "chat-1" } } : {}) },
    events: { on(name, fn) { events[name] = fn; } },
    request: { invokeTemplate: invoke },
    instance: { resize: async () => {} },
  };
  const window = { app: { initialized: async () => client }, addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(source, { document, window, Date, setTimeout, clearTimeout, Promise });
  listeners.DOMContentLoaded();
  return { events, listeners, document };
}

describe("sidebar request pacing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces activation bursts and polls at most every 30 seconds", async () => {
    const invoke = vi.fn(async () => ({ response: JSON.stringify({ state: "unknown", mode: "live" }) }));
    const { events } = setup(invoke);
    await flush();
    events["app.activated"]();
    events["conversation.propertiesLoaded"]();
    events["chatConversation.propertiesLoaded"]();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29999);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not overlap slow requests", async () => {
    let resolve;
    const invoke = vi.fn(() => new Promise((done) => { resolve = done; }));
    const { events } = setup(invoke);
    await flush();
    events["app.activated"]();
    await vi.advanceTimersByTimeAsync(60000);
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve({ response: JSON.stringify({ state: "unknown", mode: "live" }) });
    await flush();
  });

  it("pauses hidden and deactivated panels", async () => {
    const invoke = vi.fn(async () => ({ response: JSON.stringify({ state: "unknown", mode: "live" }) }));
    const { events, document, listeners } = setup(invoke);
    await flush();
    document.hidden = true;
    listeners.visibilitychange();
    await vi.advanceTimersByTimeAsync(60000);
    expect(invoke).toHaveBeenCalledTimes(1);
    document.hidden = false;
    listeners.visibilitychange();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(2);
    events["app.deactivated"]();
    await vi.advanceTimersByTimeAsync(60000);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("backs off for 65 seconds after a rate limit, including manual refresh", async () => {
    const invoke = vi.fn().mockRejectedValueOnce({ status: 429, message: "You have exceeded the limit of 50 requests per minute" }).mockResolvedValue({ response: JSON.stringify({ state: "unknown", mode: "live" }) });
    const { listeners } = setup(invoke);
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    listeners["refresh:click"]();
    await flush();
    await vi.advanceTimersByTimeAsync(59999);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
