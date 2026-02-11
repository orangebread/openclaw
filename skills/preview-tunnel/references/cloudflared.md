# cloudflared quick tunnel notes

Typical command:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Typical output includes a public URL like:

- `https://<random>.trycloudflare.com`

If the URL isn't immediately visible:

- Poll the `exec` session output with the `process` tool (`action: "log"` or `action: "poll"`).
- Extract the first `https://...` URL and validate it loads in a browser.
