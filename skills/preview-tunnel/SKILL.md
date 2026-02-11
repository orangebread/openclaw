---
name: preview-tunnel
description: "Start a local dev server and expose it via a tunnel (cloudflared preferred) to produce a preview URL. Requires explicit confirmation before creating a public URL and includes a stop procedure."
metadata:
  {
    "openclaw":
      {
        "emoji": "🛟",
        "requires": { "bins": ["cloudflared"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "cloudflared",
              "bins": ["cloudflared"],
              "label": "Install cloudflared (brew)",
            },
            {
              "id": "apt",
              "kind": "apt",
              "package": "cloudflared",
              "bins": ["cloudflared"],
              "label": "Install cloudflared (apt)",
            },
          ],
      },
  }
---

# Preview Tunnel Skill

Use this only when PR-based previews are unavailable or the user explicitly requests a tunnel preview.

## Safety + confirmation (required)

Before starting any tunnel, ask the user to confirm:

- The app/port to expose (e.g. `http://127.0.0.1:3000`)
- Whether the URL will be public on the internet (cloudflared quick tunnels are public)
- Expected runtime (e.g. “up to 30 minutes”)

If the user says “don’t deploy”, do not use this skill unless they explicitly override that instruction.

## Start flow (cloudflared preferred)

1. Start the app server (repo-specific). Prefer background execution and record the `exec` session id:
   - Example: `pnpm dev` (or `npm run dev`)

2. Start the tunnel:
   - `cloudflared tunnel --url http://127.0.0.1:<port>`

3. Extract the public URL from the tunnel output (look for `https://...trycloudflare.com`).

4. Persist metadata under the workspace:
   - `preview/current.json` (best-effort)
   - Include: `publicUrl`, `localUrl`, `serverSessionId`, `tunnelSessionId`, `startedAt`

## Stop flow (required)

To stop the preview:

1. Kill the tunnel session via the `process` tool (`action: "kill"`) using the recorded `tunnelSessionId`.
2. Kill the server session via the `process` tool using the recorded `serverSessionId`.
3. Update `preview/current.json` with `stoppedAt`.

## Notes

- Prefer PR previews (Vercel/Netlify/Fly/etc.) when available.
- Tunnels require the gateway host to stay online.
- If the user prefers tailnet-only exposure, consider Tailscale Serve instead of a public tunnel (still requires confirmation).
