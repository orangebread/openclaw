import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";
import { formatValidationErrors, ProtocolSchemas } from "./index.js";

const makeError = (overrides: Partial<ErrorObject>): ErrorObject => ({
  keyword: "type",
  instancePath: "",
  schemaPath: "#/",
  params: {},
  message: "validation error",
  ...overrides,
});

describe("formatValidationErrors", () => {
  it("returns unknown validation error when missing errors", () => {
    expect(formatValidationErrors(undefined)).toBe("unknown validation error");
    expect(formatValidationErrors(null)).toBe("unknown validation error");
  });

  it("returns unknown validation error when errors list is empty", () => {
    expect(formatValidationErrors([])).toBe("unknown validation error");
  });

  it("formats additionalProperties at root", () => {
    const err = makeError({
      keyword: "additionalProperties",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at root: unexpected property 'token'");
  });

  it("formats additionalProperties with instancePath", () => {
    const err = makeError({
      keyword: "additionalProperties",
      instancePath: "/auth",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at /auth: unexpected property 'token'");
  });

  it("formats message with path for other errors", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err])).toBe("at /auth: must have required property 'token'");
  });

  it("de-dupes repeated entries", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err, err])).toBe(
      "at /auth: must have required property 'token'",
    );
  });
});

describe("ProtocolSchemas", () => {
  it("includes channels catalog/install/repair + doctor schemas", () => {
    expect(ProtocolSchemas.ChannelsCatalogParams).toBeDefined();
    expect(ProtocolSchemas.ChannelsCatalogResult).toBeDefined();
    expect(ProtocolSchemas.ChannelsInstallParams).toBeDefined();
    expect(ProtocolSchemas.ChannelsInstallResult).toBeDefined();
    expect(ProtocolSchemas.ChannelsRepairParams).toBeDefined();
    expect(ProtocolSchemas.ChannelsRepairResult).toBeDefined();
    expect(ProtocolSchemas.GatewayRestartParams).toBeDefined();
    expect(ProtocolSchemas.DoctorPlanParams).toBeDefined();
    expect(ProtocolSchemas.DoctorPlanResult).toBeDefined();
    expect(ProtocolSchemas.DoctorFixParams).toBeDefined();
    expect(ProtocolSchemas.DoctorFixResult).toBeDefined();
  });
});
