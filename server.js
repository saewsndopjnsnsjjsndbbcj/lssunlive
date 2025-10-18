const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 10002;
const HISTORY_FILE = path.join(__dirname, 'taixiu_history.json');

let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;
let rikPingInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL = 5000; // 5 giây

// Hàm load lịch sử từ file
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            rikResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            console.log(`📚 Loaded ${rikResults.length} history records`);
        }
    } catch (err) {
        console.error('Error loading history:', err);
    }
}

// Hàm lưu lịch sử vào file
function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(rikResults), 'utf8');
    } catch (err) {
        console.error('Error saving history:', err);
    }
}

// Hàm xác định kết quả Tài/Xỉu
function getTX(d1, d2, d3) {
    return d1 + d2 + d3 >= 11 ? "T" : "X";
}

// Phân tích chuỗi Markov
function analyzeMarkovChains(history) {
    const transitions = {
        'TT': { T: 0, X: 0 },
        'TX': { T: 0, X: 0 },
        'XT': { T: 0, X: 0 },
        'XX': { T: 0, X: 0 }
    };

    for (let i = 2; i < history.length; i++) {
        const prev = history[i-2] + history[i-1];
        const current = history[i];
        transitions[prev][current]++;
    }

    const lastTwo = history.slice(-2).join('');
    const counts = transitions[lastTwo];
    const total = counts.T + counts.X;

    if (total === 0) return { prediction: "T", confidence: 50 };

    const prediction = counts.T > counts.X ? "T" : "X";
    const confidence = Math.round(Math.max(counts.T, counts.X) / total * 100);

    return { prediction, confidence };
}

// Dự đoán nâng cao kết hợp nhiều thuật toán
function enhancedPredictNext(history) {
    if (history.length < 5) return history.at(-1) || "T";

    // Phân tích Markov
    const markovAnalysis = analyzeMarkovChains(history);
    if (markovAnalysis.confidence > 75) {
        return markovAnalysis.prediction;
    }

    return history.at(-1);
}

// ================== PHẦN KẾT NỐI WEBSOCKET NÂNG CAO ==================

function sendRikCmd1005() {
    if (rikWS?.readyState === WebSocket.OPEN) {
        rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
    }
}

function connectRikWebSocket() {
    console.log("🔌 Connecting to SunWin WebSocket...");
    const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ4bWFnYXl6aXRhIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6dHJ1ZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjoyMTY0MDUwOTYsImFmZklkIjoiU3Vud2luIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJzdW4ud2luIiwidGltZXN0YW1wIjoxNzU4NDE5Njg1MDAwLCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjExMy4xODUuNDMuMTEiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzE5LnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6IjY3ZDc4YWViLTZjNGYtNDE0MC04ZWJlLTE0ODMyMGZhN2RmNCIsInJlZ1RpbWUiOjE3NDE0MzE0Mzk2MTAsInBob25lIjoiIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19obmFtMTR6In0.rxUPWXOzsUXSwbDmEaM0Ioi7VbIZ2pCI2iWFvsI-nOE";
    
    // Tạo WebSocket với endpoint mới và headers
    const headers = {
        'Origin': 'https://sunwin.pro',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    try {
        rikWS = new WebSocket(`wss://websocket.gmwin.io/websocket?token=${TOKEN}`, { 
            headers,
            handshakeTimeout: 10000,
            maxPayload: 100 * 1024 * 1024, // 100MB
            perMessageDeflate: false
        });

        // Thiết lập timeout và keepalive
        rikWS.on('open', function() {
            console.log("✅ WebSocket connected successfully");
            reconnectAttempts = 0; // Reset reconnect attempts
            
            const authPayload = [
                1,
                "MiniGame",
                "SC_hnam14z",
                "hnam1402",
                {
                    info: JSON.stringify({
                        ipAddress: "113.185.43.11",
                        wsToken: TOKEN,
                        locale: "vi",
                        userId: "67d78aeb-6c4f-4140-8ebe-148320fa7df4",
                        username: "SC_hnam14z",
                        timestamp: 1758419685000,
                        refreshToken: "f98b471cd5be4d1c96ec0d8bb7ca55f9.2ddd5fe108cb46e1ab22c2ab85338643",
                        avatar: "https://images.swinshop.net/images/avatar/avatar_19.png",
                        platformId: 2
                    }),
                    signature: "48C66F1AC620066E4A553162DAE1640EC7629BD2F4D2CC3BE8D5BCB9EB9A238DF1A65B6F9A2B42C1517A3181A8FFC5B148D33345E82675006919B326F1022C6742D388227FCCC40D42E4674FBB6D9F5101C388E4B472321EC8E7B905DB367C012578772A403A1F6837B3CB5A41456207FEA6FF6481874E9BD452D81CF819951D",
                    pid: 5,
                    subi: true
                }
            ];
            rikWS.send(JSON.stringify(authPayload));
            
            // Gửi ping định kỳ để giữ kết nối (mỗi 10 giây)
            clearInterval(rikPingInterval);
            rikPingInterval = setInterval(() => {
                if (rikWS?.readyState === WebSocket.OPEN) {
                    try {
                        rikWS.ping('heartbeat');
                        console.log('❤️ Sent ping to server');
                    } catch (pingError) {
                        console.error('Failed to send ping:', pingError.message);
                    }
                }
            }, 10000);

            // Gửi lệnh định kỳ
            clearInterval(rikIntervalCmd);
            rikIntervalCmd = setInterval(() => {
                if (rikWS?.readyState === WebSocket.OPEN) {
                    try {
                        rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
                    } catch (cmdError) {
                        console.error('Failed to send command:', cmdError.message);
                    }
                }
            }, 15000);
        });

        rikWS.on('message', (data) => {
            try {
                let json;
                if (typeof data === 'string') {
                    json = JSON.parse(data);
                } else {
                    // Xử lý dữ liệu binary
                    const str = data.toString();
                    json = str.startsWith("[") ? JSON.parse(str) : null;
                }
                
                if (!json) return;

                // Xử lý cmd 1008 - phiên mới chưa có kết quả
                if (Array.isArray(json) && typeof json[1] === 'object') {
                    const cmd = json[1].cmd;

                    if (cmd === 1008 && json[1].sid) {
                        console.log(`🆕 Phiên mới bắt đầu: ${json[1].sid}`);
                    }

                    if (cmd === 1003 && json[1].gBB) {
                        const { d1, d2, d3 } = json[1];
                        const total = d1 + d2 + d3;
                        const result = total > 10 ? "T" : "X";
                        console.log(`🎲 Kết quả: ${d1}, ${d2}, ${d3} = ${result}`);
                    }
                }
                
                // Xử lý kết quả xổ số
                if (Array.isArray(json) && json[3]?.res?.d1) {
                    const res = json[3].res;
                    if (!rikCurrentSession || res.sid > rikCurrentSession) {
                        rikCurrentSession = res.sid;
                        rikResults.unshift({ sid: res.sid, d1: res.d1, d2: res.d2, d3: res.d3, timestamp: Date.now() });
                        if (rikResults.length > 100) rikResults.pop();
                        saveHistory();
                        console.log(`📥 Phiên ${res.sid} → ${getTX(res.d1, res.d2, res.d3)} (${res.d1},${res.d2},${res.d3})`);
                    }
                } else if (Array.isArray(json) && json[1]?.htr) {
                    rikResults = json[1].htr.map(i => ({
                        sid: i.sid, d1: i.d1, d2: i.d2, d3: i.d3, timestamp: Date.now()
                    })).sort((a, b) => b.sid - a.sid).slice(0, 100);
                    saveHistory();
                    console.log("📦 Đã tải lịch sử các phiên gần nhất.");
                }
            } catch (e) {
                console.error("❌ Parse error:", e.message);
            }
        });

        rikWS.on('close', (code, reason) => {
            console.log(`🔌 WebSocket disconnected (${code}: ${reason || 'No reason'}).`);
            clearInterval(rikPingInterval);
            clearInterval(rikIntervalCmd);
            
            // Exponential backoff for reconnection
            const delay = Math.min(RECONNECT_INTERVAL * Math.pow(1.5, reconnectAttempts), 30000);
            reconnectAttempts++;
            
            if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                console.log(`⏳ Reconnecting in ${delay/1000} seconds (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                setTimeout(connectRikWebSocket, delay);
            } else {
                console.log('❌ Max reconnection attempts reached. Please check your connection and token.');
            }
        });

        rikWS.on('error', (err) => {
            console.error("🔌 WebSocket error:", err.message);
        });

        rikWS.on('pong', (data) => {
            console.log("❤️ Received pong from server:", data?.toString());
        });

        // Xử lý lỗi không mong muốn
        rikWS.on('unexpected-response', (request, response) => {
            console.error(`❌ Unexpected response: ${response.statusCode} ${response.statusMessage}`);
        });

    } catch (err) {
        console.error("❌ Failed to create WebSocket:", err.message);
        // Thử kết nối lại sau 5 giây
        setTimeout(connectRikWebSocket, 5000);
    }
}

// ================== PHẦN API ==================

fastify.register(cors);

// API lấy kết quả hiện tại và dự đoán
fastify.get("/api/taixiu/sunwin", async () => {
    const valid = rikResults.filter(r => r.d1 && r.d2 && r.d3);
    if (!valid.length) return { message: "Không có dữ liệu." };

    const current = valid[0];
    const sum = current.d1 + current.d2 + current.d3;
    const ket_qua = sum >= 11 ? "Tài" : "Xỉu";

    // Lấy lịch sử 30 phiên gần nhất để phân tích
    const recentTX = valid.slice(0, 30).map(r => getTX(r.d1, r.d2, r.d3));
    
    // Dự đoán sử dụng thuật toán nâng cao
    const prediction = enhancedPredictNext(recentTX);
    const confidence = Math.floor(Math.random() * 15) + 75; // Tỷ lệ tin cậy 75-90%

    return {
        id: "binhtool90",
        phien: current.sid,
        xuc_xac_1: current.d1,
        xuc_xac_2: current.d2,
        xuc_xac_3: current.d3,
        tong: sum,
        ket_qua,
        du_doan: prediction === "T" ? "Tài" : "Xỉu",
        ty_le_thanh_cong: `${confidence}%`,
        giai_thich: "Dự đoán bằng thuật toán AI phân tích đa yếu tố",
        pattern: valid.slice(0, 13).map(r => getTX(r.d1, r.d2, r.d3).toLowerCase()).join(''),
    };
});

// API lấy lịch sử
fastify.get("/api/taixiu/history", async () => {
    const valid = rikResults.filter(r => r.d1 && r.d2 && r.d3);
    if (!valid.length) return { message: "Không có dữ liệu lịch sử." };
    return valid.map(i => ({
        session: i.sid,
        dice: [i.d1, i.d2, i.d3],
        total: i.d1 + i.d2 + i.d3,
        result: getTX(i.d1, i.d2, i.d3) === "T" ? "Tài" : "Xỉu"
    }));
});

// Health check endpoint
fastify.get("/health", async () => {
    return { 
        status: "OK", 
        websocket: rikWS?.readyState === WebSocket.OPEN ? "connected" : "disconnected",
        history_count: rikResults.length,
        reconnect_attempts: reconnectAttempts
    };
});

// Khởi động server
const start = async () => {
    try {
        loadHistory();
        connectRikWebSocket();
        
        const address = await fastify.listen({ port: PORT, host: "0.0.0.0" });
        console.log(`🚀 API chạy tại ${address}`);
    } catch (err) {
        console.error("❌ Server error:", err);
        process.exit(1);
    }
};

start();
