import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const requests = JSON.parse(readFileSync(new URL("../config/requests.json", import.meta.url), "utf8"));

describe("Freshchat app package", () => {
  it("declares every request used by the app", () => {
    expect(Object.keys(manifest.modules.common.requests).sort()).toEqual(Object.keys(requests).sort());
  });

  it("mounts the conversation sidebar", () => {
    expect(manifest.modules.chat_conversation.location.conversation_user_info.url).toBe("index.html");
  });
});
