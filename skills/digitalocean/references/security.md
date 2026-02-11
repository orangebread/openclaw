# DigitalOcean token handling

## Rule

Never paste the token in chat or terminal history.

## Preferred: 1Password CLI

Use `op read` with an item field reference:

```bash
op read 'op://<vault>/<item>/token'
```

Then run `doctl` through `scripts/doctl-with-op.sh` so the token stays in process env only.

## Fallback: environment variable

If 1Password is unavailable, load `DIGITALOCEAN_ACCESS_TOKEN` from your secure shell profile or host secret manager.

Validate auth without printing token:

```bash
doctl account get
```

## Operational guardrails

- Never log `DIGITALOCEAN_ACCESS_TOKEN`.
- Never store token values in repo files.
- Prefer short-lived process environment usage over persistent `doctl auth init`.
