import assert from "node:assert/strict";
import test from "node:test";
import { enrichHumanReviewQueue } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-queue-context.mjs";

test("screening observations add locations, reason, users, and priority", () => {
  const result = enrichHumanReviewQueue({
    items: [{ requirement_id: "WCAG-2.2-SC-2.4.7", human_actions: ["Inspect focus"] }],
    observations: [{
      requirement_id: "SCREEN-FOCUS-1",
      profile_requirement_id: "WCAG-2.2-SC-2.4.7",
      location: "Checkout > Continue",
      observation: "Focus indicator is not visible.",
      affected_users: ["keyboard users", "low-vision users"],
      priority: "P1"
    }]
  });
  assert.deepEqual(result[0].related_screening_observation_ids, ["SCREEN-FOCUS-1"]);
  assert.deepEqual(result[0].target_locations, ["Checkout > Continue"]);
  assert.deepEqual(result[0].affected_users, ["keyboard users", "low-vision users"]);
  assert.equal(result[0].priority, "P1");
  assert.equal(result[0].source, "screening_observation");
  assert.match(result[0].reason, /Focus indicator/u);
  assert.equal(result[0].status, "open");
});

test("profile coverage items stay explicit when no observation exists", () => {
  const [item] = enrichHumanReviewQueue({
    items: [{ requirement_id: "WCAG-2.2-SC-1.1.1" }],
    observations: []
  });
  assert.equal(item.source, "profile_coverage");
  assert.equal(item.priority, "P2");
  assert.deepEqual(item.target_locations, []);
  assert.match(item.reason, /profile requirement/u);
});

test("same requirement and same target cannot be queued twice", () => {
  assert.throws(() => enrichHumanReviewQueue({
    items: [
      { requirement_id: "WCAG-2.2-SC-2.1.1", target_locations: ["Dialog"] },
      { requirement_id: "WCAG-2.2-SC-2.1.1", target_locations: ["Dialog"] }
    ]
  }), /Duplicate human review queue item/u);
});
