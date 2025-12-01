// ==UserScript==
// @name         WS Manager Auto Token (Gemwin)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Hook WebSocket, lấy token và auto reload sau 18h trên Gemwin
// @author       Bạn
// @match        https://play.gemwin.vip/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  const FIREBASE_URL = "https://fir-data-8026b-default-rtdb.firebaseio.com/tokenfr.json";
  const RECONNECT_INTERVAL_MS = 4 * 60 * 1000; // 4 phút restart WS
  const AUTO_RELOAD_HOURS = 18; // reload sau 18h
  const AUTO_RELOAD_MS = AUTO_RELOAD_HOURS * 60 * 60 * 1000;

  let countdownMs = RECONNECT_INTERVAL_MS;
  let countdownTimer = null;
  let wsInstance = null;
  let cleanupFns = [];
  let lastRestartAt = null;

  /* ---------- Firebase save (PUT - ghi đè) ---------- */
  function saveFixData(packet) {
    fetch(FIREBASE_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: packet, ts: Date.now(), type: "send" })
    })
    .then(r => r.json())
    .then(res => console.log("✅ Đã ghi Firebase:", res))
    .catch(e => console.error("❌ Firebase lỗi:", e));
  }

  /* ---------- Overlay UI ---------- */
  function createOverlay() {
    if (document.getElementById("ws-manager-overlay")) return;

    const box = document.createElement("div");
    box.id = "ws-manager-overlay";
    box.style = `
      position: fixed; top: 10px; right: 10px; z-index: 2147483647;
      background: rgba(0,0,0,0.9); color: #cfc; padding: 12px;
      font-family: monospace; font-size: 13px; width: 360px;
      border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.6);
    `;

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700">WS Manager</div>
        <button id="ws-force-btn" style="background:#2b2; border:none; padding:6px 8px; border-radius:6px; cursor:pointer">Force reconnect</button>
      </div>
      <hr style="margin:8px 0; border:none; border-top:1px solid rgba(255,255,255,0.06)" />
      <div style="max-height:120px; overflow:auto; margin-bottom:8px;">
        <div><b>🔑 Token:</b> <span id="ws-token">—</span></div>
        <div style="margin-top:6px"><b>🖊 Signature:</b> <span id="ws-sign">—</span></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <div style="flex:1">
          <div style="font-size:12px;color:#ddd">Next reconnect in</div>
          <div id="ws-countdown" style="font-size:18px;font-weight:700">--:--</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;color:#ddd">Last restart</div>
          <div id="ws-last" style="font-size:12px">—</div>
        </div>
      </div>
      <div style="font-size:12px;color:#aaa">Logs:</div>
      <pre id="ws-log" style="height:80px; overflow:auto; background:rgba(0,0,0,0.2); padding:6px; border-radius:6px; margin-top:6px; color:#bff">ready...</pre>
    `;

    document.body.appendChild(box);

    document.getElementById("ws-force-btn").addEventListener("click", () => {
      logToUI("Manual force reconnect pressed");
      doRestartCycle();
    });
  }

  function logToUI(msg) {
    const el = document.getElementById("ws-log");
    if (!el) return;
    const t = new Date().toLocaleTimeString();
    el.textContent = `[${t}] ${msg}\n` + el.textContent;
  }

  function updateOverlayToken(token, signature) {
    const tEl = document.getElementById("ws-token");
    const sEl = document.getElementById("ws-sign");
    if (tEl) tEl.textContent = token || "—";
    if (sEl) sEl.textContent = signature || "—";
  }

  function updateOverlayCountdown(ms) {
    const el = document.getElementById("ws-countdown");
    if (!el) return;
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    el.textContent = `${mm}:${ss}`;
  }

  function updateLastRestart() {
    const el = document.getElementById("ws-last");
    if (!el) return;
    el.textContent = lastRestartAt ? new Date(lastRestartAt).toLocaleString() : "—";
  }

  /* ---------- Token/signature extraction ---------- */
  function extractTokenAndSignature(packet) {
    try {
      const infoStr = packet[4] && packet[4].info;
      const signature = packet[4] && packet[4].signature;
      if (!infoStr) return { token: null, signature: signature || null };
      const infoObj = JSON.parse(infoStr);
      return { token: infoObj.wsToken || null, signature: signature || null };
    } catch (e) {
      console.warn("⚠️ parse info error", e);
      return { token: null, signature: null };
    }
  }

  /* ---------- Hook WebSocket ---------- */
  function installWSHook() {
    if (window.__WS_HOOK_INSTALLED) return;
    window.__WS_HOOK_INSTALLED = true;

    const NativeWS = window.WebSocket;
    const ProxyWS = new Proxy(NativeWS, {
      construct(target, args) {
        const ws = new target(...args);
        wsInstance = ws;
        logToUI("WebSocket constructed: " + (args && args[0] ? args[0] : "unknown-url"));

        cleanupFns.forEach(fn => { try { fn(); } catch{} });
        cleanupFns = [];

        const origSend = ws.send;
        ws.send = function(data) {
          let parsed = data;
          if (typeof data === "string") {
            try { parsed = JSON.parse(data); } catch {}
          }

          if (
            Array.isArray(parsed) &&
            parsed.length >= 5 &&
            parsed[0] === 1 &&
            parsed[1] === "MiniGame" &&
            parsed[2] === "GM_hnam14zz" &&
            (parsed[3] === "hnam1402" || parsed[3] === hnam1402)
          ) {
            logToUI("Matched SEND packet");
            const { token, signature } = extractTokenAndSignature(parsed);
            updateOverlayToken(token || "❌ Không có token", signature || "❌ Không có signature");
            saveFixData(parsed);
          }

          return origSend.apply(this, arguments);
        };

        const onClose = () => logToUI("WebSocket closed");
        ws.addEventListener("close", onClose);
        cleanupFns.push(() => ws.removeEventListener("close", onClose));

        return ws;
      }
    });

    window.WebSocket = ProxyWS;
    logToUI("WS hook installed");
  }

  /* ---------- Restart cycle ---------- */
  function cleanupWS() {
    logToUI("Cleaning up WS...");
    try {
      cleanupFns.forEach(fn => { try { fn(); } catch{} });
      cleanupFns = [];
      if (wsInstance && typeof wsInstance.close === "function") {
        try { wsInstance.close(); } catch(e) { console.warn(e); }
      }
      wsInstance = null;
    } catch (e) {
      console.warn("Error during cleanup:", e);
    }
  }

  function doRestartCycle() {
    cleanupWS();
    setTimeout(() => {
      installWSHook();
      lastRestartAt = Date.now();
      updateLastRestart();
      logToUI("Restart cycle completed");
    }, 200);
    countdownMs = RECONNECT_INTERVAL_MS;
    updateOverlayCountdown(countdownMs);
  }

  /* ---------- Countdown ---------- */
  function startCountdown() {
    if (countdownTimer) return;
    countdownTimer = setInterval(() => {
      countdownMs -= 1000;
      if (countdownMs <= 0) {
        updateOverlayCountdown(0);
        logToUI("Countdown reached 0 -> performing restart");
        doRestartCycle();
      } else {
        updateOverlayCountdown(countdownMs);
      }
    }, 1000);
  }

  /* ---------- Auto reload sau 18h ---------- */
  setTimeout(() => {
    logToUI("⏰ Auto reload sau 18h để lấy token mới");
    location.reload();
  }, AUTO_RELOAD_MS);

  /* ---------- Init ---------- */
  createOverlay();
  installWSHook();
  updateOverlayCountdown(countdownMs);
  startCountdown();
  updateLastRestart();
  logToUI("WS Manager started. Auto-restart every " + (RECONNECT_INTERVAL_MS/60000) + " minutes. Auto-reload every " + AUTO_RELOAD_HOURS + "h");
})();
