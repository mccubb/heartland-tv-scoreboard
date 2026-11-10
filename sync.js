// Heartland TV cross-device state relay.
// This file ONLY transfers the already-confirmed scoreboard values between browsers.
// Camera capture, OCR, confidence checks, confirmation, and scoring rules live unchanged in camera-reader.js.
(function () {
  "use strict";
  const BROKER = "wss://broker.emqx.io:8084/mqtt";
  const PREFIX = "heartland-tv/live-36d63c35f15f37a9ecae11e9d34c95b0cfa8cfa9/v1/";
  const KEYS = { score: "htv-score", branding: "htv-branding" };
  const TOPICS = { score: PREFIX + "score", branding: PREFIX + "branding" };
  const instance = "htv-" + Math.random().toString(36).slice(2, 12);
  const latest = { score: 0, branding: 0 };
  const pending = {};
  let connected = false;
  let client = null;

  function status(message) {
    const node = document.getElementById("sync-status");
    if (node) node.textContent = "YoloBox live sync: " + message;
  }

  function getJSON(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function valid(kind, state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    if (kind === "score") {
      return Number.isFinite(state.homeScore) && Number.isFinite(state.awayScore) &&
        state.homeScore >= 0 && state.awayScore >= 0 &&
        Number.isFinite(state.seconds) && Number.isFinite(state.period);
    }
    return !!state.home && !!state.away &&
      typeof state.home === "object" && typeof state.away === "object";
  }

  function publish(kind) {
    const state = getJSON(KEYS[kind]);
    if (!valid(kind, state)) return;
    // Timestamp is synchronization metadata only. Do not change the reader's state or clock.
    const sentAt = Math.max(Date.now(), latest[kind] + 1);
    latest[kind] = sentAt;
    const packet = { version: 1, from: instance, sentAt: sentAt, state: state };
    const json = JSON.stringify(packet);
    // Public broker packet limits; oversized logos should not interfere with score updates.
    if (json.length > 250000) {
      status("team logo too large to send; scores still work");
      return;
    }
    if (connected && client) {
      client.publish(TOPICS[kind], json, { qos: 1, retain: true }, function (error) {
        if (error) { pending[kind] = packet; status("disconnected; retrying"); }
      });
    } else {
      pending[kind] = packet;
    }
  }

  // Called after the existing reader or manual controls save their values.
  window.htvSync = {
    publishScore: function () { publish("score"); },
    publishBrand: function () { publish("branding"); },
    isConnected: function () { return connected; }
  };

  function receive(topic, bytes) {
    const kind = topic === TOPICS.score ? "score" :
      topic === TOPICS.branding ? "branding" : null;
    if (!kind) return;
    let packet;
    try { packet = JSON.parse(bytes.toString()); } catch (error) { return; }
    if (!packet || packet.version !== 1 || packet.from === instance ||
        !Number.isFinite(packet.sentAt) || packet.sentAt <= latest[kind] ||
        !valid(kind, packet.state)) return;

    latest[kind] = packet.sentAt;
    // Update only the shared scoreboard/branding keys. Never touch htv-camera.
    try {
      localStorage.setItem(KEYS[kind], JSON.stringify(packet.state));
      // The overlay already redraws every 200ms; other browser tabs get a storage event.
      // The controller's own draw loop reads the same storage key.
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
      clientId: instance,
      clean: true,
      reconnectPeriod: 2500,
      connectTimeout: 10000,
      keepalive: 30,
      protocolVersion: 4
    });
    client.on("connect", function () {
      connected = true;
      status("connected");
      client.subscribe([TOPICS.score, TOPICS.branding], { qos: 1 }, function (error) {
        if (error) { status("subscription failed; retrying"); return; }
        for (const kind of ["score", "branding"]) {
          if (!pending[kind]) continue;
          const queued = pending[kind];
          delete pending[kind];
          client.publish(TOPICS[kind], JSON.stringify(queued), { qos: 1, retain: true },
            function (publishError) {
              if (publishError) { pending[kind] = queued; status("send failed; retrying"); }
            });
        }
      });
    });
    client.on("message", receive);
    client.on("close", function () { connected = false; status("offline; reconnecting"); });
    client.on("offline", function () { connected = false; status("offline; reconnecting"); });
    client.on("error", function () { connected = false; status("connection error; retrying"); });
  } catch (error) {
    status("offline (could not start synchronization)");
  }
})();
