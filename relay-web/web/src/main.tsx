import React from "react";
import { createRoot } from "react-dom/client";
import { Bell, LogOut, Menu, Send, Settings, ShieldAlert, X } from "lucide-react";
import { joinDevice, pressButton, sendMessage, sendNuke, siteWebSocketURL } from "./api";
import { clearSession, loadSession, saveSession } from "./session";
import type { ConversationMessage, DeviceSession, SiteSocketMessage } from "./types";
import "./styles.css";

function App() {
  const [session, setSession] = React.useState<DeviceSession | null>(() => loadSession());
  const [joinName, setJoinName] = React.useState(session?.displayName || "");
  const [joinPassword, setJoinPassword] = React.useState("");
  const [messages, setMessages] = React.useState<ConversationMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [status, setStatus] = React.useState("Disconnected");
  const [notice, setNotice] = React.useState("");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [nukeConfirm, setNukeConfirm] = React.useState("");
  const [nukeMessage, setNukeMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const wsRef = React.useRef<WebSocket | null>(null);

  React.useEffect(() => {
    if (!session) {
      return;
    }

    let closed = false;
    let reconnect: number | undefined;

    const connect = () => {
      setStatus("Connecting");
      const socket = new WebSocket(siteWebSocketURL(session));
      wsRef.current = socket;

      socket.addEventListener("open", () => {
        setStatus("Connected");
      });

      socket.addEventListener("message", event => {
        const payload = JSON.parse(String(event.data)) as SiteSocketMessage;
        if (payload.type === "snapshot") {
          setMessages(payload.messages);
          setStatus(payload.receiverOnline ? "Connected" : "Receiver offline");
          return;
        }
        if (payload.type === "message") {
          setMessages(previous => appendMessage(previous, payload.message));
          return;
        }
        if (payload.type === "deleted" || payload.type === "banned") {
          clearSession();
          setSession(null);
          setMessages([]);
          setNotice(payload.type === "banned" ? "This device was permanently deleted." : "Leo deleted this device. Send a new request to come back.");
          return;
        }
        if (payload.type === "error") {
          setNotice(payload.message);
        }
      });

      socket.addEventListener("close", () => {
        if (closed) {
          return;
        }
        setStatus("Reconnecting");
        reconnect = window.setTimeout(connect, 1400);
      });
    };

    connect();
    const ping = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);

    return () => {
      closed = true;
      window.clearInterval(ping);
      if (reconnect) {
        window.clearTimeout(reconnect);
      }
      wsRef.current?.close();
    };
  }, [session]);

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await joinDevice({
        password: joinPassword,
        displayName: joinName,
        existing: session
      });
      const next = {
        deviceId: response.device.deviceId,
        deviceSecret: response.deviceSecret,
        displayName: response.device.displayName
      };
      saveSession(next);
      setSession(next);
      setMessages(response.messages);
      setJoinPassword("");
      setStatus(response.receiverOnline ? "Connected" : "Receiver offline");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not join.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePress() {
    if (!session) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await pressButton(session);
      setNotice(response.deliveredToReceiver
        ? "Leo's Receiver received the button press."
        : "Sent to the relay, but Leo's Receiver has not confirmed it yet.");
    } catch (error) {
      handleSessionError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !draft.trim()) return;
    const text = draft;
    setDraft("");
    try {
      const response = await sendMessage(session, text);
      setMessages(previous => appendMessage(previous, response.message));
    } catch (error) {
      setDraft(text);
      handleSessionError(error);
    }
  }

  async function handleNuke() {
    if (!session || nukeConfirm !== "yes") {
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await sendNuke(session, nukeMessage);
      setNotice(response.deliveredToReceiver
        ? "Leo's Receiver received The Nuke."
        : "Nuke reached the relay, but Leo's Receiver has not confirmed it yet.");
      setSettingsOpen(false);
      setNukeConfirm("");
      setNukeMessage("");
    } catch (error) {
      handleSessionError(error);
    } finally {
      setBusy(false);
    }
  }

  function handleSessionError(error: unknown) {
    const message = error instanceof Error ? error.message : "Request failed.";
    if (message.toLowerCase().includes("request access") || message.toLowerCase().includes("permanently")) {
      clearSession();
      setSession(null);
      setMessages([]);
    }
    setNotice(message);
  }

  function logout() {
    clearSession();
    setSession(null);
    setMessages([]);
    setNotice("Signed out on this browser.");
  }

  if (!session) {
    return (
      <main className="gate-shell">
        <section className="gate-panel squircle">
          <div className="brand-row">
            <span className="brand-dot" />
            <span>The Button</span>
          </div>
          <h1>Get Leo's attention.</h1>
          <form onSubmit={handleJoin} className="gate-form">
            <label>
              Name
              <input value={joinName} onChange={event => setJoinName(event.target.value)} maxLength={32} autoFocus />
            </label>
            <label>
              Password
              <input value={joinPassword} onChange={event => setJoinPassword(event.target.value)} type="password" />
            </label>
            <button className="primary-button squircle" disabled={busy || !joinName.trim() || !joinPassword}>
              {busy ? "Checking..." : "Enter The Button"}
            </button>
          </form>
          {notice && <p className="notice">{notice}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-row">
          <span className="brand-dot" />
          <span>The Button</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
          </button>
          <button className="icon-button" title="Log out" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="button-stage">
        <div className="mobile-chip squircle">
          <Menu size={14} />
          <span>{session.displayName}</span>
        </div>
        <button className="big-red-button" onClick={handlePress} disabled={busy}>
          <span>Press</span>
          <span>The Big Red</span>
          <span>Button</span>
        </button>
      </section>

      <aside className="message-panel squircle">
        <h2>Message Leo</h2>
        <div className="thread">
          {messages.length === 0 ? (
            <p className="empty-thread">No messages yet.</p>
          ) : messages.map(message => (
            <article className={`message ${message.from}`} key={message.id}>
              <div className="message-meta">
                <strong>{message.from === "leo" ? "Leo" : "You"}</strong>
                <time>{formatTime(message.createdAt)}</time>
              </div>
              <p>{message.text}</p>
            </article>
          ))}
        </div>
        <form className="composer" onSubmit={handleMessage}>
          <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Type a message..." maxLength={1200} />
          <button className="send-button" title="Send" disabled={!draft.trim()}>
            <Send size={18} />
          </button>
        </form>
      </aside>

      <footer className="statusbar">
        <span className={status === "Connected" ? "status-dot ok" : "status-dot"} />
        <span>{status}</span>
        <span>Logged in as {session.displayName}</span>
      </footer>

      {notice && <div className="toast squircle">{notice}</div>}

      {settingsOpen && (
        <div className="modal-backdrop">
          <section className="settings-panel squircle">
            <nav className="settings-nav">
              <h2>Settings</h2>
              <button className="settings-tab active"><ShieldAlert size={17} /> The Nuke</button>
              <button className="settings-tab"><Bell size={17} /> Status</button>
            </nav>
            <div className="settings-content">
              <button className="close-button" title="Close" onClick={() => setSettingsOpen(false)}><X size={18} /></button>
              <h2>The Nuke</h2>
              <p className="danger-copy">This will force Leo's Receiver to the front and cover it red with white text.</p>
              <div className="nuke-preview squircle">
                <button className="mini-nuke" type="button">The<br />Nuke</button>
              </div>
              <label className="confirm-label">
                Type yes to confirm
                <input value={nukeConfirm} onChange={event => setNukeConfirm(event.target.value)} placeholder="yes" />
              </label>
              <label className="confirm-label">
                Message for Leo
                <textarea
                  value={nukeMessage}
                  onChange={event => setNukeMessage(event.target.value)}
                  placeholder="Optional, but it will appear on Leo's red Nuke screen."
                  maxLength={240}
                  rows={4}
                />
              </label>
              <button className="nuke-submit squircle" disabled={nukeConfirm !== "yes" || busy} onClick={handleNuke}>
                Nuke Leo's Receiver
              </button>
              <p className="muted">This is intentionally annoying and immediate.</p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function appendMessage(messages: ConversationMessage[], message: ConversationMessage): ConversationMessage[] {
  return messages.some(item => item.id === message.id) ? messages : [...messages, message];
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
