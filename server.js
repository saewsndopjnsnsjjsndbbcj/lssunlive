const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const axios = require("axios");

const PORT = process.env.PORT || 10000; // FIX CHO RENDER
const WS_ID = "mrtinhios";
const WS_KEY = "vantinhk11pq";

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let latestKey = null;
let waitingResult = null;
let latestResult = null;

// Phân tích gói "end"
function parseEndData(data) {
  const match = data.match(/#(\d+)[^\{]*\{(\d+)-(\d+)-(\d+)\}/);
  if (!match) return null;

  const phien = parseInt(match[1]);
  const xuc_xac = [parseInt(match[2]), parseInt(match[3]), parseInt(match[4])];
  const tong = xuc_xac.reduce((a, b) => a + b, 0);
  const ket_qua = tong >= 11 ? "Tài" : "Xỉu";

  return { phien, xuc_xac, tong, ket_qua };
}

// Lấy MD5 cuối chuỗi
function extractMd5(data) {
  const match = data.match(/[0-9a-f]{32}$/i);
  return match ? match[0] : null;
}

// Gửi realtime qua WebSocket
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.authenticated) {
      client.send(msg);
    }
  });
}

// Xác thực WebSocket
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = url.searchParams.get("id");
  const key = url.searchParams.get("key");

  if (id === WS_ID && key === WS_KEY) {
    ws.authenticated = true;
    ws.send(JSON.stringify({ status: "connected" }));
  } else {
    ws.send(JSON.stringify({ status: "unauthorized" }));
    ws.close();
  }
});

// API trả kết quả
app.get("/ditmemay/api/68gb/taixiu/mrtinhios", (req, res) => {
  if (latestResult) {
    res.json(latestResult);
  } else {
    res.status(404).json({ message: "Chưa có dữ liệu" });
  }
});

// Đọc Firebase mỗi 3 giây
setInterval(async () => {
  try {
    const res = await axios.get(
      "https://api6868-2a84a-default-rtdb.asia-southeast1.firebasedatabase.app/taixiu_sessions.json"
    );

    const data = res.data;
    if (!data) return;

    const keys = Object.keys(data).sort();
    const latest = keys[keys.length - 1];

    if (latestKey === latest) return; // Không trùng phiên
    latestKey = latest;

    const item = data[latest];

    if (item.type === "end") {
      const parsed = parseEndData(item.data);
      if (parsed) {
        waitingResult = parsed;
        console.log("🕐 Chờ MD5:", parsed);
      }
    }

    if (item.type === "start" && waitingResult) {
      const md5 = extractMd5(item.data);
      if (md5) {
        latestResult = {
          Phien: waitingResult.phien,
          Xuc_xac_1: waitingResult.xuc_xac[0],
          Xuc_xac_2: waitingResult.xuc_xac[1],
          Xuc_xac_3: waitingResult.xuc_xac[2],
          Tong: waitingResult.tong,
          Ket_qua: waitingResult.ket_qua,
          Md5: md5,
        };
        broadcast(latestResult);
        console.log("✅ Gửi kết quả:", latestResult);
        waitingResult = null;
      }
    }
  } catch (err) {
    console.error("❌ Lỗi đọc dữ liệu:", err.message);
  }
}, 3000);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server chạy trên PORT: ${PORT}`);
  console.log(`🔗 WebSocket dùng: wss://<tên-app>.onrender.com/?id=${WS_ID}&key=${WS_KEY}`);
  console.log(`🔗 API: https://<tên-app>.onrender.com/ditmemay/api/68gb/taixiu/mrtinhios`);
});
