// Heartland TV cross-device relay.
// Does not modify camera OCR, recognition, or score/clock logic.
(function () {
  "use strict";
  const BROKER = "wss://broker.emqx.io:8084/mqtt";
  const PREFIX = "heartland-tv/live-36d63c35f15f37a9ecae11e9d34c95b0cfa8cfa9/v1/";
  const KEYS = { score: "htv-score", branding: "htv-branding", display: "htv-display" };
  const TOPICS = {
    score: PREFIX + "score",
    branding: PREFIX + "branding",
    display: PREFIX + "display"
  };
  const PRESENCE_TOPIC = PREFIX + "overlay-presence";
  const ACK_TOPIC = PREFIX + "overlay-ack";
  const instance = "htv-" + Math.random().toString(36).slice(2, 12);
  const isOverlay = !!document.getElementById("bug");
  const latest = { score: 0, branding: 0, display: 0 };
  const pending = {};
  const sent = {};
  const receivers = new Map();
  let lastAcknowledged = "";
  let lastAcknowledgedAt = 0;
  let connected = false;
  let client = null;

  function status(message) {
    const node = document.getElementById("sync-status");
    if (node) node.textContent = "YoloBox live sync: " + message;
    receiverStatus();
  }

  function receiverStatus() {
    const node = document.getElementById("receiver-status");
    if (!node) return;
    if (!connected) {
      node.textContent = "Scoreboard receiver: relay offline. Updates will send when it reconnects.";
      return;
    }
    const now = Date.now();
    for (const [id, at] of receivers) if (now - at > 30000) receivers.delete(id);
    if (!receivers.size) {
      node.textContent = "Scoreboard receiver: no live overlay detected. Refresh the Web URL overlay on the YoloBox.";
      return;
    }
    node.textContent = "Scoreboard receiver: " + receivers.size +
      " overlay" + (receivers.size === 1 ? "" : "s") + " online" +
      (lastAcknowledgedAt && now - lastAcknowledgedAt < 45000 ?
        " — " + lastAcknowledged + " update acknowledged" : " — ready for live updates") +
      ". (A browser preview can also count as an overlay.)";
  }

  function getJSON(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch (error) { return null; }
  }

  function valid(kind, state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    if (kind === "score") {
      return Number.isFinite(state.homeScore) && Number.isFinite(state.awayScore) &&
        state.homeScore >= 0 && state.awayScore >= 0 &&
        Number.isFinite(state.seconds) && Number.isFinite(state.period);
    }
    if (kind === "display") {
      return Number.isFinite(state.scale) && state.scale >= .7 && state.scale <= 2.5;
    }
    return !!state.home && !!state.away &&
      typeof state.home === "object" && typeof state.away === "object";
  }

  function transmit(kind, packet) {
    if (!connected || !client) { pending[kind] = packet; return; }
    try {
      client.publish(TOPICS[kind], JSON.stringify(packet), { qos: 1, retain: true },
        function (error) {
          if (error) {
            pending[kind] = packet;
            status("send failed; will retry");
          }
        });
    } catch (error) {
      pending[kind] = packet;
      status("send failed; will retry");
    }
  }

  function publish(kind) {
    const state = getJSON(KEYS[kind]);
    if (!valid(kind, state)) return;
    // Only a message timestamp; no changes to the camera reader or game clock.
    const sentAt = Math.max(Date.now(), latest[kind] + 1);
    latest[kind] = sentAt;
    const packet = { version: 1, from: instance, sentAt: sentAt, state: state };
    if (JSON.stringify(packet).length > 250000) {
      status("logo file is too large to sync; smaller logos allow branding to update");
      return;
    }
    sent[kind] = sentAt;
    transmit(kind, packet);
  }

  window.htvSync = {
    publishScore: function () { publish("score"); },
    publishBrand: function () { publish("branding"); },
    publishDisplay: function () { publish("display"); },
    publishAll: function () { ["score", "branding", "display"].forEach(publish); },
    isConnected: function () { return connected; }
  };

  function announceOverlay() {
    if (!isOverlay || !connected || !client) return;
    try {
      client.publish(PRESENCE_TOPIC, JSON.stringify({
        version: 1, from: instance, role: "overlay", at: Date.now()
      }), { qos: 0, retain: false });
    } catch (error) {}
  }

  function acknowledge(kind, sentAt, sender) {
    if (!isOverlay || !connected || !client) return;
    try {
      client.publish(ACK_TOPIC, JSON.stringify({
        version: 1, from: instance, to: sender, kind: kind,
        sentAt: sentAt, at: Date.now()
      }), { qos: 0, retain: false });
    } catch (error) {}
  }

  function receive(topic, bytes) {
    let packet;
    try { packet = JSON.parse(bytes.toString()); } catch (error) { return; }
    if (!packet || packet.version !== 1 || packet.from === instance) return;
    if (topic === PRESENCE_TOPIC) {
      if (packet.role === "overlay" && typeof packet.from === "string") {
        receivers.set(packet.from, Date.now());
        receiverStatus();
      }
      return;
    }
    if (topic === ACK_TOPIC) {
      if (packet.to === instance && sent[packet.kind] &&
          packet.sentAt >= sent[packet.kind]) {
        receivers.set(packet.from, Date.now());
        lastAcknowledged = packet.kind === "display" ? "size" :
          packet.kind === "branding" ? "team settings" : "score";
        lastAcknowledgedAt = Date.now();
        receiverStatus();
      }
      return;
    }
    const kind = topic === TOPICS.score ? "score" :
      topic === TOPICS.branding ? "branding" :
      topic === TOPICS.display ? "display" : null;
    if (!kind || !Number.isFinite(packet.sentAt) ||
        !valid(kind, packet.state)) return;
    // A duplicate retained message can still be acknowledged for the sender.
    if (packet.sentAt <= latest[kind]) {
      acknowledge(kind, packet.sentAt, packet.from);
      return;
    }
    latest[kind] = packet.sentAt;
    try {
      localStorage.setItem(KEYS[kind], JSON.stringify(packet.state));
      window.dispatchEvent(new CustomEvent("htv-sync-updated", { detail: { kind: kind } }));
      acknowledge(kind, packet.sentAt, packet.from);
    } catch (error) {
      status("browser storage unavailable");
    }
  }

  if (!window.mqtt || typeof window.mqtt.connect !== "function") {
    status("offline (sync library could not load)");
    return;
  }
  status("connecting");
  try {
    client = window.mqtt.connect(BROKER, {
      clientId: instance, clean: true, reconnectPeriod: 2500,
      connectTimeout: 10000, keepalive: 30, protocolVersion: 4
    });
    client.on("connect", function () {
      connected = true;
      status("connected");
      const subscriptions = Object.values(TOPICS).concat([PRESENCE_TOPIC, ACK_TOPIC]);
      client.subscribe(subscriptions, { qos: 1 }, function (error) {
        if (error) { status("subscription failed; retrying"); return; }
        announceOverlay();
        for (const kind of Object.keys(pending)) {
          const packet = pending[kind];
          delete pending[kind];
          transmit(kind, packet);
        }
      });
    });
    client.on("message", receive);
    client.on("close", function () { connected = false; status("offline; reconnecting"); });
    client.on("offline", function () { connected = false; status("offline; reconnecting"); });
    client.on("error", function () { connected = false; status("connection error; retrying"); });
    // YoloBox Web URL sources keep this heartbeat alive while the actual overlay runs.
    setInterval(function () { announceOverlay(); receiverStatus(); }, 8000);
  } catch (error) {
    status("offline (could not start synchronization)");
  }
})();
