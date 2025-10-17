// server.js
// Node.js version của hệ thống Sicbo (không dùng Python).
// Chạy: `node server.js` (Render sẽ dùng script từ package.json)

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");

//////////////////// CONFIG ////////////////////
const SICBO_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJnaG5mZ3JkemhnYmZ6ZWQiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMTQ0NzIxMTcsImFmZklkIjoiR0VNV0lOIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJnZW0iLCJ0aW1lc3RhbXAiOjE3NTYzNjczNjgyMTAsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiX19pZCI6IjIzOTQxNzdiLWI2YzAtNDk3Yi1iYmI4LTM1NDU0ZWRmM2E4MyIsImlwQWRkcmVzcyI6IjI0MDI6ODAwOjYxZDk6ZTI6ZmMzZjo5ODk6NmEyNDpmNDgzIiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wOC5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiJlMmFlZGU0Zi0zNjRjLTQxMWUtODg0Ni0yY2ZjY2MwNGQyNjI3IiwicmVnVGltZSI6MTc1NjM2NzM2ODIwMywicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwiY3JlYXRlZEF0IjoxNzU2MzY3MzY4MjEwfQ.TUb2LLF6L8uidlouzbrK4kAkoq-NALhyBFIeHwJKLB8";
const USERNAME = "GM_edferdsfgedsg";
const PASSWORD = "111116";
const IP_ADDRESS = "2402:800:61d9:e2:fc3f:989:6a24:f483";
const USER_ID = "e2aede4f-364c-411e-8846-2cfcc04d2627";
const TIMESTAMP = 1756367368210;

const WS_URL = `wss://livearena.gmwin.io/sbxx?token=${SICBO_TOKEN}`;

const HISTORY_FILE = path.join("/tmp", "sicbo_history.json"); // use /tmp on Render
const MAX_HISTORY_RECORDS = 200;
const RECONNECT_DELAY_MS = 3000;
const SEND_CMD_INTERVAL_MS = 5000;

//////////////////// STATE ////////////////////
let sicboResults = []; // newest first
let sicboCurrentSession = null;
let ws = null;
let sendCmdInterval = null;

//////////////////// UTIL ////////////////////
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf8");
      sicboResults = JSON.parse(raw);
      console.log(`📚 Loaded ${sicboResults.length} history records`);
    } else {
      console.log("📚 No existing history file");
    }
  } catch (e) {
    console.error("❌ Error loading history:", e);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(sicboResults), "utf8");
  } catch (e) {
    console.error("❌ Error saving history:", e);
  }
}

function getTX(d1, d2, d3) {
  const s = d1 + d2 + d3;
  if (d1 === d2 && d2 === d3) return "Bộ Ba Đồng Nhất";
  return s >= 11 ? "Tài" : "Xỉu";
}

//////////////////// WEBSOCKET ////////////////////
function sendSicboCmd() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify([6, "Livestream", "Sicbo88Plugin", { cmd: 1950, sC: true }]));
    } catch (e) {
      console.error("❌ Error sending command:", e);
    }
  }
}

function createAuthPayload() {
  return [
    1,
    "Livestream",
    USERNAME,
    PASSWORD,
    {
      info: JSON.stringify({
        ipAddress: IP_ADDRESS,
        wsToken: SICBO_TOKEN,
        userId: USER_ID,
        username: USERNAME,
        timestamp: TIMESTAMP,
        refreshToken: "37fe7e76c4094da698f09384086991c6.258834f1f41c43db9f3034ff942c016d"
      }),
      signature: "2FC543585AB122625B9C0A16C12FDE872E900F967DC47FEA7E3C4FB5801B9A0A9FA6EF1C1C37C8322694185B405ED572EFA8DCAA421B0429DE5DA79E0B406EC5B3FE256B3AA83CE0556FF32A58BB5A66FA03569998D10E75C99546257C8919238F47C588044BDEAA26593E8E7896C78A6E9ACAAC2B16124335F9B21C726CA44F"
    }
  ];
}

function connectWs() {
  try {
    console.log("🔌 Connecting to WebSocket:", WS_URL);
    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      console.log("✅ WebSocket connected.");
      try {
        ws.send(JSON.stringify(createAuthPayload()));
        // send first cmd immediately
        sendSicboCmd();
      } catch (e) {
        console.error("❌ Error on initial send:", e);
      }

      // start periodic send (clear previous if any)
      if (sendCmdInterval) clearInterval(sendCmdInterval);
      sendCmdInterval = setInterval(sendSicboCmd, SEND_CMD_INTERVAL_MS);
    });

    ws.on("message", (data) => {
      try {
        const message = typeof data === "string" ? data : data.toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(message);
        } catch (e) {
          // ignore non-json messages
          // console.log("Non-json message:", message);
          return;
        }

        // Case 1: object with resultRaw and sessionId
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.resultRaw && parsed.sessionId) {
          const newSession = parsed.sessionId;
          const d1 = parseInt(parsed.resultRaw[0], 10);
          const d2 = parseInt(parsed.resultRaw[1], 10);
          const d3 = parseInt(parsed.resultRaw[2], 10);
          if (!sicboCurrentSession || newSession > sicboCurrentSession) {
            sicboCurrentSession = newSession;
            sicboResults.unshift({
              sid: newSession,
              d1, d2, d3,
              timestamp: Date.now()
            });
            if (sicboResults.length > MAX_HISTORY_RECORDS) sicboResults.length = MAX_HISTORY_RECORDS;
            saveHistory();
            console.log(`📥 Phiên mới ${newSession} → Kết quả: [${d1}, ${d2}, ${d3}]`);
          }
          return;
        }

        // Case 2: array where [?, { htr: [...] }, ...] (history response)
        if (Array.isArray(parsed) && parsed.length > 1 && parsed[1] && typeof parsed[1] === "object" && parsed[1].htr) {
          const historyData = parsed[1].htr;
          if (Array.isArray(historyData)) {
            const newRecords = [];
            for (const item of historyData) {
              if (!sicboResults.find(r => r.sid === item.sessionId)) {
                const dices = Array.from(String(item.resultRaw)).map(ch => parseInt(ch, 10));
                newRecords.push({
                  sid: item.sessionId,
                  d1: dices[0],
                  d2: dices[1],
                  d3: dices[2],
                  timestamp: item.st || Date.now()
                });
              }
            }
            if (newRecords.length) {
              sicboResults = newRecords.concat(sicboResults).sort((a, b) => b.sid - a.sid).slice(0, MAX_HISTORY_RECORDS);
              saveHistory();
              console.log(`📦 Đã cập nhật ${newRecords.length} phiên lịch sử mới.`);
            }
          }
          return;
        }

        // else: ignore
      } catch (e) {
        console.error("❌ Parse error (message handler):", e);
      }
    });

    ws.on("close", (code, reason) => {
      console.warn("🔌 WebSocket closed:", code, reason ? reason.toString() : "");
      if (sendCmdInterval) {
        clearInterval(sendCmdInterval);
        sendCmdInterval = null;
      }
      // try reconnect after delay
      setTimeout(() => {
        connectWs();
      }, RECONNECT_DELAY_MS);
    });

    ws.on("error", (err) => {
      console.error("❌ WebSocket error:", err && err.message ? err.message : err);
      // ws will likely emit close after error; ensure reconnect handled there
    });

  } catch (e) {
    console.error("❌ connectWs exception:", e);
    setTimeout(connectWs, RECONNECT_DELAY_MS);
  }
}

//////////////////// API ////////////////////
const app = express();
app.use(cors());

app.get("/api/sicbo/live", (req, res) => {
  const valid = sicboResults.filter(r => r.d1 && r.d2 && r.d3);
  if (!valid.length) return res.json({ message: "Không có dữ liệu." });
  const current = valid[0];
  const total = current.d1 + current.d2 + current.d3;
  res.json({
    Phien: current.sid,
    Xuc_xac_1: current.d1,
    Xuc_xac_2: current.d2,
    Xuc_xac_3: current.d3,
    Tong: total,
    Ket_qua: getTX(current.d1, current.d2, current.d3),
    id: ""
  });
});

app.get("/api/sicbo/history", (req, res) => {
  const valid = sicboResults.filter(r => r.d1 && r.d2 && r.d3);
  if (!valid.length) return res.json({ message: "Không có dữ liệu lịch sử." });
  const lines = valid.map(i => {
    return JSON.stringify({
      session: i.sid,
      dice: [i.d1, i.d2, i.d3],
      total: i.d1 + i.d2 + i.d3,
      result: getTX(i.d1, i.d2, i.d3)
    }, null, 0);
  });
  res.type("text/plain").send(lines.join("\n"));
});

//////////////////// START ////////////////////
const PORT = parseInt(process.env.PORT || "3001", 10);

loadHistory();
connectWs();

app.listen(PORT, () => {
  console.log(`🌐 Server listening on port ${PORT}`);
});
