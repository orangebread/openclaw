import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import type { ChannelsProps } from "./channels.types.ts";
import { renderChannels } from "./channels.ts";

function stringifyTemplate(value: unknown): string {
  if (value == null || typeof value === "boolean") {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyTemplate(entry)).join("");
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "strings" in value &&
    "values" in value &&
    Array.isArray((value as TemplateResult).strings)
  ) {
    const template = value as TemplateResult;
    let output = "";
    for (let i = 0; i < template.strings.length; i += 1) {
      output += template.strings[i];
      if (i < template.values.length) {
        output += stringifyTemplate(template.values[i]);
      }
    }
    return output;
  }
  return "";
}

function createProps(overrides: Partial<ChannelsProps> = {}): ChannelsProps {
  return {
    connected: true,
    loading: false,
    snapshot: {
      ts: Date.now(),
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channels: { whatsapp: { configured: false } },
      channelAccounts: { whatsapp: [] },
      channelDefaultAccountId: { whatsapp: "default" },
    },
    catalog: [],
    catalogLoading: false,
    catalogError: null,
    lastError: null,
    lastSuccessAt: null,
    whatsappMessage: null,
    whatsappQrDataUrl: null,
    whatsappConnected: null,
    whatsappBusy: false,
    configSchema: null,
    configSchemaLoading: false,
    configForm: {},
    configUiHints: {},
    configSaving: false,
    configFormDirty: false,
    nostrProfileFormState: null,
    nostrProfileAccountId: null,
    onRefresh: () => undefined,
    onWhatsAppStart: () => undefined,
    onWhatsAppWait: () => undefined,
    onWhatsAppLogout: () => undefined,
    onConfigPatch: () => undefined,
    onConfigSave: () => undefined,
    onConfigReload: () => undefined,
    onNostrProfileEdit: () => undefined,
    onNostrProfileCancel: () => undefined,
    onNostrProfileFieldChange: () => undefined,
    onNostrProfileSave: () => undefined,
    onNostrProfileImport: () => undefined,
    onNostrProfileToggleAdvanced: () => undefined,
    setupChannelId: null,
    onSetupChannel: () => undefined,
    onChannelToggle: () => undefined,
    installBusy: null,
    installError: null,
    installSuccess: null,
    onInstallChannel: () => undefined,
    onEnableChannel: () => undefined,
    restartBusy: false,
    restartError: null,
    onRestartGateway: () => undefined,
    ...overrides,
  };
}

describe("renderChannels ghost cards", () => {
  it("renders Install action for uninstalled catalog channels", () => {
    const template = renderChannels(
      createProps({
        catalog: [
          {
            id: "matrix",
            label: "Matrix",
            installed: false,
            configured: false,
            enabled: false,
            hasSchema: true,
            blurb: "Matrix channel",
            install: { npmSpec: "@openclaw/matrix" },
          },
        ],
      }),
    );
    const htmlString = stringifyTemplate(template);
    expect(htmlString).toContain("Matrix");
    expect(htmlString).toContain("Install");
  });

  it("shows restart-required state for installed channels that are not yet loaded", () => {
    const template = renderChannels(
      createProps({
        catalog: [
          {
            id: "matrix",
            label: "Matrix",
            installed: true,
            configured: false,
            enabled: true,
            hasSchema: false,
            blurb: "Matrix channel",
            install: { npmSpec: "@openclaw/matrix" },
          },
        ],
      }),
    );
    const htmlString = stringifyTemplate(template);
    expect(htmlString).toContain("Restart gateway");
    expect(htmlString).not.toContain(">Install<");
    expect(htmlString).not.toContain(">Set up<");
  });

  it("renders Enable action for installed but disabled channels", () => {
    const template = renderChannels(
      createProps({
        catalog: [
          {
            id: "matrix",
            label: "Matrix",
            installed: true,
            configured: false,
            enabled: false,
            hasSchema: false,
            blurb: "Matrix channel",
          },
        ],
      }),
    );
    const htmlString = stringifyTemplate(template);
    expect(htmlString).toContain("Enable");
    expect(htmlString).not.toContain("Restart gateway");
    expect(htmlString).not.toContain(">Install<");
    expect(htmlString).not.toContain(">Set up<");
  });
});
