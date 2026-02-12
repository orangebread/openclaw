import type { ComponentData } from "@buape/carbon";
import { describe, expect, it } from "vitest";
import { buildWorkflowApprovalCustomId, parseWorkflowApprovalData } from "./workflow-approvals.js";

describe("workflow approvals", () => {
  it("encodes approval id and action", () => {
    const customId = buildWorkflowApprovalCustomId("abc-123", "approve");
    expect(customId).toBe("workflowapproval:id=abc-123;action=approve");
  });

  it("encodes special characters in approval id", () => {
    const customId = buildWorkflowApprovalCustomId("abc=123;test", "deny");
    expect(customId).toBe("workflowapproval:id=abc%3D123%3Btest;action=deny");
  });

  it("parses component data", () => {
    const parsed = parseWorkflowApprovalData({
      id: "abc-123",
      action: "approve",
    } as unknown as ComponentData);
    expect(parsed).toEqual({ approvalId: "abc-123", action: "approve" });
  });

  it("parses encoded approval ids", () => {
    const parsed = parseWorkflowApprovalData({
      id: "abc%3D123%3Btest",
      action: "deny",
    } as unknown as ComponentData);
    expect(parsed).toEqual({ approvalId: "abc=123;test", action: "deny" });
  });
});
