// One Durable Object per (company, conversation). It is the agent's single-threaded seat for that chat:
// it debounces bursts of customer messages into one answer and never runs two turns at once.

import { DurableObject } from "cloudflare:workers";
import { PermanentTurnError, runTurn } from "../agent/pipeline";
import type { Env } from "../env";

type Key = { companyId: string; conversationId: string };
const MAX_WAIT_MS = 12_000;

export function conversationObjectId(env: Env, companyId: string, conversationId: string) {
  return env.CONVERSATIONS.idFromName(`${companyId}:${conversationId}`);
}

export class ConversationObject extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();

  /** Called on every ingest. Customer messages schedule a (debounced) turn; everything else just wakes the object. */
  async notify(input: Key & { kind: "customer_message" | "other"; debounceMs: number }): Promise<void> {
    await this.ctx.storage.put("key", { companyId: input.companyId, conversationId: input.conversationId } satisfies Key);
    if (input.kind !== "customer_message") return;
    const now = Date.now();
    const firstPending = (await this.ctx.storage.get<number>("firstPendingAt")) ?? null;
    const target = now + Math.max(0, input.debounceMs);
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) {
      await this.ctx.storage.put("firstPendingAt", now);
      await this.ctx.storage.setAlarm(target);
      return;
    }
    // Extend the debounce for a burst, but never beyond MAX_WAIT_MS after the first message.
    const cap = (firstPending ?? now) + MAX_WAIT_MS;
    await this.ctx.storage.setAlarm(Math.min(target, cap));
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.delete("firstPendingAt");
    await this.runSerialized("alarm");
  }

  /** Manual trigger from the dashboard or sidebar ("reply now"). */
  async runNow(): Promise<{ outcome: string }> {
    return this.runSerialized("manual");
  }

  private runSerialized(trigger: string): Promise<{ outcome: string }> {
    const next = this.queue.then(async () => {
      const key = await this.ctx.storage.get<Key>("key");
      if (!key) return { outcome: "skipped:no_key" };
      try {
        return await runTurn(this.env, { ...key, trigger });
      } catch (error) {
        if (error instanceof PermanentTurnError) return { outcome: "error:permanent" };
        throw error; // alarm retries with backoff; manual callers see the error
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
