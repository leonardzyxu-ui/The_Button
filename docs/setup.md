# Setup

## Secrets

Set these on Render and locally when running the relay:

- `THEBUTTON_JOIN_PASSWORD` - shared password visitors type before joining.
- `THEBUTTON_RECEIVER_TOKEN` - private token The Receiver uses to connect.
- `UPSTASH_REDIS_REST_URL` - Upstash Redis REST URL.
- `UPSTASH_REDIS_REST_TOKEN` - Upstash Redis REST token.
- `THEBUTTON_IP_HASH_SALT` - optional salt for hashed IP audit/rate-limit metadata.

Do not commit real values. The app intentionally reads them from environment variables or the macOS Keychain.

## Render

Deploy from this folder using `render.yaml`. The service root is `relay-web/`, so Render will install and run only the Node relay/site package.

Render Free can sleep after inactivity. The Receiver keeps a WebSocket heartbeat while your Mac is awake and online, which gives near-instant events and keeps the service warm during active use.

### Hostname Miswire Check

The production relay is healthy only when:

```sh
curl https://the-button.onrender.com/health
```

returns JSON with `service: "the-button"`.

If `/health` returns a Django/WSGI 404 page, the Render hostname is pointed at the wrong service. The local Node relay code is not the blocker if `cd relay-web && npm run check` passes and a local `PORT=8787 npm start` responds at `http://127.0.0.1:8787/health` with `service: "the-button"`.

Fix in Render Dashboard:

- Service name: `the-button`.
- Repository: `leonardzyxu-ui/The_Button`.
- Branch: `main`.
- Root directory: `relay-web`.
- Build command: `npm ci && npm run build`.
- Start command: `npm start`.
- Runtime: Node.
- Environment variables: the secrets listed above.

After relinking or redeploying, rerun `/health` and confirm the JSON service identity before using The Button as the primary scouting relay.

## Receiver

The Receiver stores its relay URL, private receiver token, and local permanent-delete admin password in Keychain. The first screen asks for them if missing.
