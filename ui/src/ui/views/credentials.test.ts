import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderCredentials, type CredentialsProps } from "./credentials.js";

describe("credentials view", () => {
  const base = (): CredentialsProps => ({
    connected: true,
    gatewayUrl: "ws://localhost:18789",
    loading: false,
    saving: false,
    error: null as string | null,
    success: null,
    disconnectDialog: null,
    baseHash: "hash-123",
    profiles: [
      {
        id: "openai:default",
        provider: "openai",
        type: "api_key",
        preview: "sk-••••••abcd",
      },
    ],
    apiKeyForm: { profileId: "", provider: "", email: "", apiKey: "" },
    authFlowLoading: false,
    authFlowError: null as string | null,
    authFlowList: { quickConnect: [], providers: [] },
    authFlowBusy: false,
    authFlowRunning: false,
    authFlowOwned: false,
    authFlowStep: null,
    authFlowAnswer: null as unknown,
    authFlowResult: null,
    authFlowApplyError: null as string | null,
    authFlowProviderId: null,
    authFlowMethodId: null,
    authFlowPendingDefaultModel: null,
    wizardBusy: false,
    wizardError: null as string | null,
    wizardRunning: false,
    wizardOwned: false,
    wizardStep: null,
    wizardAnswer: null as unknown,
    onRefresh: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenAgentProfile: vi.fn(),
    onApiKeyFormChange: vi.fn(),
    onUpsertApiKey: vi.fn(),
    onRequestDeleteProfile: vi.fn(),
    onCancelDeleteProfile: vi.fn(),
    onConfirmDeleteProfile: vi.fn(),
    onStartAuthFlow: vi.fn(),
    onResumeAuthFlow: vi.fn(),
    onCancelAuthFlow: vi.fn(),
    onAuthFlowAnswerChange: vi.fn(),
    onAuthFlowOpenUrl: vi.fn(),
    onAuthFlowContinue: vi.fn(),
    onApplyAuthFlowDefaults: vi.fn(),
    onStartWizard: vi.fn(),
    onResumeWizard: vi.fn(),
    onCancelWizard: vi.fn(),
    onWizardAnswerChange: vi.fn(),
    onWizardContinue: vi.fn(),
  });

  it("renders masked profile inventory", () => {
    const container = document.createElement("div");
    render(renderCredentials(base()), container);
    expect(container.textContent).toContain("Provider Credentials");
    expect(container.textContent).toContain("openai:default");
    expect(container.textContent).toContain("sk-••••••abcd");
  });

  it("uses a password input for API key entry", () => {
    const container = document.createElement("div");
    render(renderCredentials(base()), container);
    const pw = container.querySelectorAll('input[type="password"]');
    expect(pw.length).toBeGreaterThan(0);
  });

  it("renders sensitive wizard text prompts as password inputs", () => {
    const container = document.createElement("div");
    const props = base();
    props.wizardRunning = true;
    props.wizardOwned = true;
    props.wizardStep = {
      id: "step-1",
      type: "text",
      message: "Enter API key",
      sensitive: true,
      placeholder: "wizard-secret",
    };
    props.wizardAnswer = "";
    render(renderCredentials(props), container);
    const wizardPw = container.querySelector('input[type="password"][placeholder="wizard-secret"]');
    expect(wizardPw).not.toBeNull();
  });

  it("shows a resume affordance when wizard is running but step is missing", () => {
    const container = document.createElement("div");
    const props = base();
    props.wizardRunning = true;
    props.wizardOwned = true;
    props.wizardStep = null;
    render(renderCredentials(props), container);
    expect(container.textContent).toContain("Resume wizard");
  });
});
