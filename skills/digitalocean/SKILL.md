---
name: digitalocean
description: Manage DigitalOcean droplets and App Platform with doctl using plan-first, approval-gated workflows and secure token sourcing (1Password/env, never pasted).
homepage: https://docs.digitalocean.com/reference/doctl/
metadata:
  {
    "openclaw":
      {
        "emoji": "🌊",
        "requires": { "bins": ["doctl"], "env": ["DIGITALOCEAN_ACCESS_TOKEN"] },
        "primaryEnv": "DIGITALOCEAN_ACCESS_TOKEN",
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "doctl",
              "bins": ["doctl"],
              "label": "Install doctl (brew)",
            },
            {
              "id": "apt",
              "kind": "apt",
              "package": "doctl",
              "bins": ["doctl"],
              "label": "Install doctl (apt)",
            },
          ],
      },
  }
---

# DigitalOcean

Use this skill when provisioning or deploying on DigitalOcean with strict human confirmation before any cost-bearing action.

## Security requirements

- Never ask the user to paste a DigitalOcean token into chat.
- Prefer 1Password-backed execution, then env var fallback.
- Never print tokens, write tokens to files, or echo secret values.
- Always run a read-only inventory and plan first, then ask for explicit approval before apply.

See `references/security.md` for the secure token flow.

## Setup (one-time)

Verify tools:

```bash
doctl version
```

If using 1Password, follow `skills/1password/SKILL.md` first.

## Read-only inventory (safe default)

```bash
doctl account get
doctl balance get
doctl projects list
doctl compute droplet list
doctl apps list
```

## Approval-gated execution model

1. Gather inventory and proposed changes.
2. Show exact resources, regions, sizes, and expected spend impact.
3. Ask for explicit approval (`yes`/`approve`) before any create/update/delete command.
4. Execute.
5. Return created/updated resource IDs and rollback command.

## Common commands (only after approval)

Create a droplet:

```bash
doctl compute droplet create <name> \
  --region <region> \
  --size <size-slug> \
  --image <image-slug-or-id> \
  --ssh-keys <fingerprint-or-id> \
  --tag-names <tag1,tag2>
```

Delete a droplet:

```bash
doctl compute droplet delete <droplet-id> --force
```

Create an App Platform app from spec:

```bash
doctl apps create --spec <app-spec.yaml>
```

Update an App Platform app:

```bash
doctl apps update <app-id> --spec <app-spec.yaml>
```

## Token-safe wrapper

Use the helper script in `scripts/doctl-with-op.sh` when a token is in 1Password:

```bash
bash skills/digitalocean/scripts/doctl-with-op.sh \
  'op://<vault>/<item>/token' \
  compute droplet list
```

For all command variants and flags, check:

```bash
doctl --help
doctl apps --help
doctl compute droplet --help
```
