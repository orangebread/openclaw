import { describe, expect, it } from "vitest";
import { buildAgentProfileUpdate, deriveAgentProfileForm } from "./agent-profile";

describe("agent profile controller", () => {
  it("builds omit-on-inherit updates (unset, no sentinel values)", () => {
    const original = {
      id: "main",
      model: { primary: "openai/gpt-5-mini", fallbacks: ["openai/gpt-5"] },
      authProfileId: "openai:default",
      imageModel: "openai/gpt-5-mini",
      imageAuthProfileId: "openai:default",
      effectiveTextProvider: "openai",
      effectiveTextModel: "openai/gpt-5-mini",
      effectiveImageProvider: "openai",
      effectiveImageModel: "openai/gpt-5-mini",
      effectiveImageAuthMode: "locked" as const,
    };

    const form = deriveAgentProfileForm(original);
    const update = buildAgentProfileUpdate({
      original,
      form: {
        ...form,
        textModelMode: "inherit",
        textCredMode: "auto",
        imageModelMode: "inherit",
        imageCredMode: "auto",
      },
    });

    expect(update.set).toEqual({});
    expect(update.unset.sort()).toEqual(
      ["authProfileId", "imageAuthProfileId", "imageModel", "model"].sort(),
    );
  });
});

