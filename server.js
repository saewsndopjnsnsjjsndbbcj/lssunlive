import express from "express";
import cors from "cors";
import fs from "fs";
import WebSocket from "ws";

const SICBO_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJnaG5mZ3JkemhnYmZ6ZWQiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMTQ0NzIxMTcsImFmZklkIjoiR0VNV0lOIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJnZW0iLCJ0aW1lc3RhbXAiOjE3NTYzNjczNjgyMTAsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjQwMjo4MDA6NjFkOTplMjpmYzNmOjk4OTo2YTI0OmY0ODMiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzA4LnBuZyIsInBsYXRmb3JtSWQiOjQsInVzZXJJZCI6ImUyYWVkZTRmLTM2NGMtNDExZS04ODQ2LTJjZmNjMDRkMjYyNyIsInJlZ1RpbWUiOjE3NTYzNjczNjgyMDMsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fZWRmZXJkc2ZnZWRzZyJ9.TUb2LLF6L8uidlouzbrK4kAkoq-NALhyBFIeHwJKLB8";
const USERNAME = "GM_edferdsfgedsg";
const PASSWORD = "111116";
const IP_ADDRESS = "2402:800:61d9:e2:fc3f:989:6a24:f483";
const USER_ID = "e2aede4f-364c-411e-8846-2cfcc04d2627";
const TIMESTAMP = 1756367368210;

const HISTORY_FILE = "sicbo_history.json";
const MAX_HISTORY_RECORDS = 200;
const RECONNECT_DELAY = 3000;

let sicboResults = [];
let sicboCurrentSession = null;
let ws = null;

// ================= Utilities =================
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      sicboResults = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      console.log(`📚 Loaded ${sicboResults.length} history records`);
    }
  } catch (err) {
    console.error("❌ Error loading history:", err);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(sicboResults));
  } catch (err) {
    console.error("❌ Error saving history:", err);
  }
}

function getTX(d1, d2, d3) {
  const s = d1 + d2 + d3;
  if (d1 === d2 && d2 === d3) return "Bộ Ba Đồng Nhất";
  return s >= 11 ? "Tài" : "Xỉu";
}

// ================= WebSocket =================
function sendSicboCmd() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify([6, "Livestream", "Sicbo88Plugin", { cmd: 1950, sC: true }]));
    } catch (err) {
      console.error("❌ Error sending command:", err);
    }
  }
}

function startWS() {
  ws = new WebSocket(`wss://livearena.gmwin.io/sbxx?token=${SICBO_TOKEN}`);

  ws.on("open", () => {
    console.log("✅ WebSocket connected");
    const authPayload = [
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
          refreshToken:
            "37fe7e76c4094da698f09384086991c6.258834f1f41c43db9f3034ff942c016d",
        }),
        signature:
          "2FC543585AB122625B9C0A16C12FDE872E900F967DC47FEA7E3C4FB5801B9A0A9FA6EF1C1C37C8322694185B405ED572EFA8DCAA421B0429DE5DA79E0B406EC5B3FE256B3AA83CE0556FF32A58BB5A66FA03569998D10E75C99546257C8919238F47C588044BDEAA26593E8E7896C78A6E9ACAAC2B16124335F9B21C726CA44F",
      },
    ];
    ws.send(JSON.stringify(authPayload));
    sendSicboCmd();
    setInterval(sendSicboCmd, 5000);
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // ====== TRƯỜNG HỢP KẾT QUẢ MỚI ======
      if (data.resultRaw && data.sessionId) {
        const dices = String(data.resultRaw).split("").map((n) => parseInt(n));
        if (dices.length === 3) {
          const [d1, d2, d3] = dices;
          const sid = data.sessionId;
          if (!sicboCurrentSession || sid > sicboCurrentSession) {
            sicboCurrentSession = sid;
            sicboResults.unshift({
              sid,
              d1,
              d2,
              d3,
              timestamp: Date.now(),
            });
            if (sicboResults.length > MAX_HISTORY_RECORDS) sicboResults.pop();
            saveHistory();
            console.log(`📥 Phiên mới ${sid} → [${d1}, ${d2}, ${d3}]`);
          }
        }
      }

      // ====== TRƯỜNG HỢP NHẬN LỊCH SỬ ======
      else if (Array.isArray(data) && data[1]?.htr) {
        const htr = data[1].htr;
        const newRecords = [];
        for (const item of htr) {
          if (!sicboResults.some((r) => r.sid === item.sessionId)) {
            const dices = String(item.resultRaw)
              .split("")
              .map((n) => parseInt(n));
            if (dices.length === 3) {
              newRecords.push({
                sid: item.sessionId,
                d1: dices[0],
                d2: dices[1],
                d3: dices[2],
                timestamp: item.st || Date.now(),
              });
            }
          }
        }
        if (newRecords.length) {
          sicboResults = [...newRecords, ...sicboResults]
            .sort((a, b) => b.sid - a.sid)
            .slice(0, MAX_HISTORY_RECORDS);
          saveHistory();
          console.log(`📦 Đã cập nhật ${newRecords.length} phiên lịch sử mới`);
        }
      }
    } catch (err) {
      console.error("❌ Parse error:", err);
    }
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket closed. Reconnecting...");
    setTimeout(startWS, RECONNECT_DELAY);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });
}

// ================= API =================
const app = express();
app.use(cors());

app.get("/api/sicbo/live", (req, res) => {
  const valid = sicboResults.filter((r) => r.d1 && r.d2 && r.d3);
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
    id: "@toolquocthinh",
  });
});

app.get("/api/sicbo/history", (req, res) => {
  const valid = sicboResults.filter((r) => r.d1 && r.d2 && r.d3);
  if (!valid.length) return res.json({ message: "Không có dữ liệu lịch sử." });

  const history = valid.map((i) => ({
    Phien: i.sid,
    Xuc_xac: [i.d1, i.d2, i.d3],
    Tong: i.d1 + i.d2 + i.d3,
    Ket_qua: getTX(i.d1, i.d2, i.d3),
    Thoi_gian: new Date(i.timestamp).toLocaleString("vi-VN"),
  }));

  res.json({
    id: "@toolquocthinh",
    tong_so_phien: history.length,
    lich_su: history,
  });
});

// ================= MAIN =================
const PORT = process.env.PORT || 3001;
loadHistory();
startWS();

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
