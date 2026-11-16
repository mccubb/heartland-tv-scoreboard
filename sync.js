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
    display: PREFIX + "display",
    logoHome: PREFIX + "logo-home",
    logoAway: PREFIX + "logo-away"
  };
  const PRESENCE_TOPIC = PREFIX + "overlay-presence";
  const ACK_TOPIC = PREFIX + "overlay-ack";
  const instance = "htv-" + Math.random().toString(36).slice(2, 12);
  const isOverlay = !!document.getElementById("bug");
  const latest = { score: 0, branding: 0, display: 0, logoHome: 0, logoAway: 0 };
  const lastLogoSource = { home: null, away: null };
  const logoGeneration = { home: 0, away: 0 };
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

  // Always send team names, ranks, records, and colors without embedded logo data.
  // A big PNG should NEVER prevent the ordinary scoreboard settings from arriving.
  function brandWithoutLogos(state) {
    const copy = { ...state, home: { ...state.home }, away: { ...state.away } };
    delete copy.home.logo;
    delete copy.away.logo;
    return copy;
  }

  function publish(kind) {
    const stored = getJSON(KEYS[kind]);
    if (!valid(kind, stored)) return;
    const state = kind === "branding" ? brandWithoutLogos(stored) : stored;
    // Only sync metadata; never alter the score calculation or camera reader.
    const sentAt = Math.max(Date.now(), latest[kind] + 1);
    latest[kind] = sentAt;
    const packet = { version: 1, from: instance, sentAt: sentAt, state: state };
    if (JSON.stringify(packet).length > 220000) {
      status("update was unexpectedly too large; check the controller fields");
      return;
    }
    sent[kind] = sentAt;
    transmit(kind, packet);
  }

  function compactLogo(src) {
    if (!src || !/^data:image\/(png|jpeg|webp);base64,/.test(src)) return Promise.resolve("");
    if (src.length < 170000) return Promise.resolve(src);
    return new Promise(async function(resolve) {
      try {
        const img = new Image();
        img.src = src;
        await img.decode();
        for (const maxPixels of [384, 256, 192]) {
          const ratio = Math.min(1, maxPixels / img.naturalWidth, maxPixels / img.naturalHeight);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          const webp = canvas.toDataURL("image/webp", maxPixels === 384 ? .82 : .7);
          if (webp.length < 190000) { resolve(webp); return; }
        }
      } catch (error) {}
      resolve(null);
    });
  }

  function publishLogo(side, src, force) {
    if (!force && lastLogoSource[side] === src) return;
    lastLogoSource[side] = src;
    const generation = ++logoGeneration[side];
    compactLogo(src).then(function(logo) {
      // If a newer logo was selected during encoding, discard the older operation.
      if (generation !== logoGeneration[side]) return;
      if (logo === null) {
        status("one team logo is too large to send, but records, rankings and colors are synced");
        return;
      }
      const kind = side === "home" ? "logoHome" : "logoAway";
      const sentAt = Math.max(Date.now(), latest[kind] + 1);
      latest[kind] = sentAt;
      sent[kind] = sentAt;
      transmit(kind, { version: 1, from: instance, sentAt: sentAt, logo: logo });
    });
  }

  function publishBrand(forceLogos) {
    const brand = getJSON(KEYS.branding);
    if (!valid("branding", brand)) return;
    publish("branding");
    for (const side of ["home", "away"]) {
      publishLogo(side, brand[side].logo || "", !!forceLogos);
    }
  }

  window.htvSync = {
    publishScore: function () { publish("score"); },
    publishBrand: function () { publishBrand(false); },
    publishDisplay: function () { publish("display"); },
    publishAll: function () { publish("score"); publishBrand(true); publish("display"); },
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
          packet.kind === "branding" ? "team settings" :
          packet.kind === "logoHome" || packet.kind === "logoAway" ? "team logo" : "score";
        lastAcknowledgedAt = Date.now();
        receiverStatus();
      }
      return;
    }
    const kind = topic === TOPICS.score ? "score" :
      topic === TOPICS.branding ? "branding" :
      topic === TOPICS.display ? "display" :
      topic === TOPICS.logoHome ? "logoHome" :
      topic === TOPICS.logoAway ? "logoAway" : null;
    if (!kind || !Number.isFinite(packet.sentAt)) return;
    const isLogo = kind === "logoHome" || kind === "logoAway";
    if (isLogo) {
      if (typeof packet.logo !== "string" || packet.logo.length > 230000 ||
          (packet.logo && !/^data:image\/(png|jpeg|webp);base64,/.test(packet.logo))) return;
    } else if (!valid(kind, packet.state)) return;

    if (packet.sentAt <= latest[kind]) {
      acknowledge(kind, packet.sentAt, packet.from);
      return;
    }
    latest[kind] = packet.sentAt;
    try {
      if (isLogo) {
        const side = kind === "logoHome" ? "home" : "away";
        const brand = getJSON(KEYS.branding) || { home: {}, away: {} };
        brand[side] = { ...(brand[side] || {}), logo: packet.logo };
        localStorage.setItem(KEYS.branding, JSON.stringify(brand));
        window.dispatchEvent(new CustomEvent("htv-sync-updated", { detail: { kind: "branding" } }));
      } else if (kind === "branding") {
        const brand = getJSON(KEYS.branding) || {};
        const home = { ...(brand.home || {}), ...packet.state.home };
        const away = { ...(brand.away || {}), ...packet.state.away };
        // New metadata packets omit .logo, so preserve the last received image.
        const merged = { ...brand, ...packet.state, home: home, away: away };
        localStorage.setItem(KEYS.branding, JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent("htv-sync-updated", { detail: { kind: kind } }));
      } else {
        localStorage.setItem(KEYS[kind], JSON.stringify(packet.state));
        window.dispatchEvent(new CustomEvent("htv-sync-updated", { detail: { kind: kind } }));
      }
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
