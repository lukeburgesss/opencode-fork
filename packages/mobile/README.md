# opencode mobile remote (F1 scaffold)

Internet-first Expo scaffold for controlling opencode from a phone.
Uses `fetch` + `EventSource` only; no native modules yet.

Features:

- Session list (`GET /api/session`)
- Prompt send (`POST /api/session/:id/prompt`)
- SSE event view (`GET /api/session/:id/event`)
- Interrupt button (`POST /api/session/:id/interrupt`)
- Permission approve/deny (`GET/POST /api/session/:id/permission…`)

## Pairing

On the desktop/server host (authenticated):

```bash
curl -u opencode:$OPENCODE_SERVER_PASSWORD \
  -X POST http://localhost:4096/api/device/pair \
  -H 'content-type: application/json' \
  -d '{"name":"pixel"}'
# {"data":{"code":"ABCDEFGH","expires_at":1710000000000}}
```

On the phone (public, single-use, 10 minute expiry):

```bash
curl -X POST https://<tunnel-url>/api/device/claim \
  -H 'content-type: application/json' \
  -d '{"code":"ABCDEFGH"}'
# {"data":{"token":"dev_…","deviceID":"…","name":"pixel"}}
```

Use the returned `token` as `Authorization: Bearer dev_…`.
`EventSource` cannot set headers, so SSE accepts `?auth_token=dev_…`.

Manage devices (authenticated or device token):

```bash
curl -H "Authorization: Bearer dev_…" https://<tunnel-url>/api/device
curl -X DELETE -H "Authorization: Bearer dev_…" https://<tunnel-url>/api/device/<deviceID>
```

## Tunnel usage (internet-first)

The phone is on another network, so expose the local server via a tunnel.
Keep `OPENCODE_SERVER_PASSWORD` set; the device token inherits that trust.

Tailscale (private mesh):

```bash
tailscale serve --bg 4096
# phone uses http://<tailnet-name>:4096 with the Bearer device token
```

Cloudflare (public URL):

```bash
cloudflared tunnel --url http://localhost:4096
# phone uses https://<tunnel-url> with the Bearer device token
```

Set the base URL in `app.json` (`extra.opencodeBaseUrl`) or in-app config.
Do not commit tokens.
