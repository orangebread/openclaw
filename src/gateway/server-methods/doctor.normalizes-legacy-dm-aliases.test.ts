let writtenConfig: unknown = null;

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  writeConfigFile: vi.fn(async (cfg: unknown) => {
    writtenConfig = cfg;
  }),
}));

vi.mock("../../config/config.js", () => {
  return {
    readConfigFileSnapshot: mocks.readConfigFileSnapshot,
    writeConfigFile: mocks.writeConfigFile,
  };
});

const { doctorHandlers } = await import("./doctor.js");

function legacyDmSnapshot() {
  return {
    path: "/tmp/openclaw.json",
    exists: true,
    raw: "{}",
    parsed: {},
    resolved: {},
    valid: true,
    config: {
      channels: {
        slack: { dm: { enabled: true, policy: "open", allowFrom: ["*"] } },
        discord: { dm: { enabled: true, policy: "allowlist", allowFrom: ["123"] } },
      },
    },
    issues: [],
    warnings: [],
    legacyIssues: [],
  };
}

describe("doctor.plan / doctor.fix", () => {
  it("surfaces legacy dm.* keys as a fixable doctor.plan issue", async () => {
    mocks.readConfigFileSnapshot.mockResolvedValue(legacyDmSnapshot());

    let ok: boolean | null = null;
    let result: unknown = null;
    await doctorHandlers["doctor.plan"]({
      params: {},
      respond: (success, res) => {
        ok = success;
        result = res;
      },
    } as unknown as Parameters<(typeof doctorHandlers)["doctor.plan"]>[0]);

    expect(ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      fixAvailable: true,
    });
    const issues = (result as { issues: Array<{ code: string }> }).issues;
    expect(issues.some((i) => i.code === "config.legacy.values")).toBe(true);
  });

  it("migrates legacy dm.* keys to dmPolicy/allowFrom in doctor.fix", async () => {
    writtenConfig = null;
    mocks.readConfigFileSnapshot.mockResolvedValue(legacyDmSnapshot());

    let ok: boolean | null = null;
    let result: unknown = null;
    await doctorHandlers["doctor.fix"]({
      params: {},
      respond: (success, res) => {
        ok = success;
        result = res;
      },
    } as unknown as Parameters<(typeof doctorHandlers)["doctor.fix"]>[0]);

    expect(ok).toBe(true);
    expect(result).toMatchObject({ ok: true, changed: true, restartRequired: true });

    expect(writtenConfig).toMatchObject({
      channels: {
        slack: {
          dmPolicy: "open",
          allowFrom: ["*"],
          dm: { enabled: true },
        },
        discord: {
          dmPolicy: "allowlist",
          allowFrom: ["123"],
          dm: { enabled: true },
        },
      },
    });
  });
});
