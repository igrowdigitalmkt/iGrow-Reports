import { describe, expect, it } from "vitest";
import { sortActionsByImportance } from "@/modules/client-portal/action-priority";

describe("sortActionsByImportance", () => {
  it("põe conversões antes de tráfego e engajamento, mesmo com números menores", () => {
    const values: Record<string, number> = {
      "action:page_engagement": 66009, "action:link_click": 10157, "action:landing_page_view": 7112,
      "action:omni_complete_registration": 20, "action:comment": 31, "action:video_view": 53363,
      "action:onsite_conversion.messaging_conversation_started_7d": 5, "action:like": 12,
    };
    const sorted = sortActionsByImportance(Object.keys(values).map(key => ({ key })), key => values[key]).map(item => item.key);
    expect(sorted).toEqual([
      "action:omni_complete_registration", "action:onsite_conversion.messaging_conversation_started_7d",
      "action:landing_page_view", "action:link_click", "action:like", "action:video_view",
      "action:page_engagement", "action:comment",
    ]);
  });
});
