# Testing

## Relay + Web

```sh
cd relay-web
npm install
npm run check
```

For local browser testing:

```sh
THEBUTTON_JOIN_PASSWORD='your-site-password' \
THEBUTTON_RECEIVER_TOKEN='your-receiver-token' \
npm run dev:server
```

Open `http://127.0.0.1:8787`.

## Receiver

```sh
cd receiver-mac
swift run TheReceiverChecks
./script/build_and_run.sh --verify
```

The build script creates `receiver-mac/dist/The Receiver.app` and launches it as a normal Dock app.
