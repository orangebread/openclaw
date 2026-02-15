import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { resolveConfigDir } from "../utils.js";

export function loadDotEnv(opts?: { quiet?: boolean; skipCwd?: boolean }) {
  const quiet = opts?.quiet ?? true;
  const skipCwd = opts?.skipCwd ?? process.env.OPENCLAW_DOTENV_SKIP_CWD === "1";

  // Load from process CWD first (dotenv default) unless explicitly disabled.
  if (!skipCwd) {
    dotenv.config({ quiet });
  }

  // Then load global fallback: ~/.openclaw/.env (or OPENCLAW_STATE_DIR/.env),
  // without overriding any env vars already present.
  const globalEnvPath = path.join(resolveConfigDir(process.env), ".env");
  if (!fs.existsSync(globalEnvPath)) {
    return;
  }

  dotenv.config({ quiet, path: globalEnvPath, override: false });
}
