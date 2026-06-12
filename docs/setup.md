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

## Receiver

The Receiver stores its relay URL, private receiver token, and local permanent-delete admin password in Keychain. The first screen asks for them if missing.

