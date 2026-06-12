# The Button + The Receiver

The Button is a tiny public website for getting Leo's attention. The Receiver is Leo's private macOS app that listens for button presses, messages, and Nuke events.

Everything lives inside this folder on purpose:

- `relay-web/` - Render-ready Node service, React website, WebSocket relay, tests.
- `receiver-mac/` - SwiftPM macOS app for The Receiver.
- `docs/` - setup, deployment, and testing notes.

The accepted visual reference is:

```text
/Users/leoxu/.codex/generated_images/019ebb53-a5f5-7173-8f6c-6350dd0e3cf7/ig_07a1425b726152cd016a2be7879074819b882ec5db44c6d076.png
```

## Local Quick Start

```sh
cd relay-web
npm install
THEBUTTON_JOIN_PASSWORD='your-site-password' \
THEBUTTON_RECEIVER_TOKEN='your-receiver-token' \
npm run dev:server
```

In another terminal:

```sh
cd receiver-mac
./script/build_and_run.sh
```

Configure The Receiver with the local relay URL and receiver token.

