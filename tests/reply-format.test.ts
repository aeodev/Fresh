import { expect, it } from "vitest";
import { formatReply } from "../shared/reply-format";

it("expands dangling duration hyphens and separates numbered steps", () => {
  expect(formatReply('1. Choose a 1-, 3-, 6-, or 12-month plan.\n2. Click Subscribe Now.'))
    .toBe('1. Choose a 1-month, 3-month, 6-month, or 12-month plan.\n\n2. Click Subscribe Now.');
});

it("preserves ranges, plain durations, and existing step spacing", () => {
  const reply = '1. Choose a plan for 1, 3, 6, or 12 months.\n\n2. Activation takes 1-3 days.';
  expect(formatReply(reply)).toBe(reply);
});
