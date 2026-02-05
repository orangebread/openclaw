import { describe, expect, it } from "vitest";
import { WizardSession } from "./session.js";

describe("WizardSession", () => {
  it("marks sensitive text prompts", async () => {
    const session = new WizardSession(async (prompter) => {
      await prompter.text({ message: "Secret", sensitive: true });
    });

    const first = await session.next();
    expect(first.done).toBe(false);
    expect(first.step?.type).toBe("text");
    expect(first.step?.sensitive).toBe(true);

    await session.answer(String(first.step?.id ?? ""), "ok");
    const done = await session.next();
    expect(done.done).toBe(true);
    expect(done.status).toBe("done");
  });
});
