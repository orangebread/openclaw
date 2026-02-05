import fs from "node:fs";
import path from "node:path";

export function loadJsonFile(pathname: string): unknown {
  try {
    if (!fs.existsSync(pathname)) {
      return undefined;
    }
    const raw = fs.readFileSync(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function saveJsonFile(pathname: string, data: unknown) {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const tmp = path.join(dir, `${path.basename(pathname)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });

  try {
    fs.renameSync(tmp, pathname);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // Windows doesn't reliably support atomic replace via rename when dest exists.
    if (code === "EPERM" || code === "EEXIST") {
      fs.copyFileSync(tmp, pathname);
      try {
        fs.chmodSync(pathname, 0o600);
      } catch {
        // best-effort
      }
      try {
        fs.unlinkSync(tmp);
      } catch {
        // best-effort
      }
      return;
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort
    }
    throw err;
  }

  try {
    fs.chmodSync(pathname, 0o600);
  } catch {
    // best-effort
  }
}
