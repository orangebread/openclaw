import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderAgentProfile } from "./agent-profile";

describe("agent profile view", () => {
  const base = () => ({
    connected: true,
    loading: false,
    saving: false,
    dirty: true,
    error: null as string | null,
    agents: [
      {
        id: "main",
        effectiveTextProvider: "openai",
        effectiveTextModel: "openai/gpt-5-mini",
        effectiveImageProvider: "openai",
        effectiveImageModel: "openai/gpt-5-mini",
        effectiveImageAuthMode: "auto" as const,
      },
    ],
    selectedAgentId: "main",
    form: {
      agentId: "main",
      textModelMode: "inherit" as const,
      textModelPrimary: "",
      textModelFallbacks: "",
      textCredMode: "locked" as const,
      textAuthProfileId: "anthropic:default",
      imageModelMode: "inherit" as const,
      imageModelPrimary: "",
      imageModelFallbacks: "",
      imageCredMode: "auto" as const,
      imageAuthProfileId: "",
    },
    authProfiles: [{ id: "anthropic:default", provider: "anthropic", type: "api_key" }],
    models: [],
    onRefresh: vi.fn(),
    onSelectAgent: vi.fn(),
    onFormChange: vi.fn(),
    onSave: vi.fn(),
    onOpenCredentials: vi.fn(),
    onRunOnboardingWizard: vi.fn(),
  });

  it("disables save when locked profile provider mismatches selected provider", () => {
    const container = document.createElement("div");
    render(renderAgentProfile(base()), container);

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Save",
    ) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();
    expect(saveButton?.disabled).toBe(true);
    expect(container.textContent).toContain("Fix before saving");
    expect(container.textContent).toContain("Go to Credentials");
  });

  it("shows inherited image lock when image is auto and providers match", () => {
    const container = document.createElement("div");
    const props = base();
    props.form.textAuthProfileId = "openai:default";
    props.authProfiles = [{ id: "openai:default", provider: "openai", type: "api_key" }];
    render(renderAgentProfile(props), container);
    expect(container.textContent).toContain("Inherited (from text)");
  });
});
