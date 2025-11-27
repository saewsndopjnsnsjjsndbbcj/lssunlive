const Fastify = require("fastify");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const fetch = require('node-fetch'); // Mày phải cài cái này: npm i node-fetch

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 10002;
const HISTORY_FILE = path.join(__dirname, 'taixiu_history.json');
const FIREBASE_URL = 'https://fir-data-8026b-default-rtdb.firebaseio.com/tokenfr.json'; // Link firebase của mày đây

let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;
let reconnectTimeout = null;
let heartbeatInterval = null;
let pingInterval = null;
let isAuthenticated = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// Biến theo dõi trạng thái heartbeat
let lastPongTime = Date.now();
let heartbeatTimeout = null;
let isConnectionHealthy = false;
const HEARTBEAT_INTERVAL = 8000; // 8 giây
const HEARTBEAT_TIMEOUT = 12000; // 12 giây
const PING_INTERVAL = 25000; // 25 giây

// ==================== LẤY TOKEN TỪ FIREBASE ====================
async function getAuthData() {
    console.log('🔥 Đang lấy thông tin xác thực từ Firebase...');
    try {
        const response = await fetch(FIREBASE_URL);
        if (!response.ok) {
            throw new Error(`Đéo lấy được dữ liệu, status: ${response.status}`);
        }
        const firebaseData = await response.json();
        
        // Bóc tách dữ liệu từ cái cấu trúc lồn của mày
        const dataArray = firebaseData.data;
        const username1 = dataArray[2]; // "GM_hnam14zz"
        const username2 = dataArray[3]; // "hnam1402"
        const authObject = dataArray[4];
        
        const infoString = authObject.info;
        const signature = authObject.signature;
        
        // Parse cái info JSON string
        const infoObject = JSON.parse(infoString);
        const wsToken = infoObject.wsToken;

        console.log('✅ Lấy thông tin xác thực thành công!');
        return {
            wsToken,
            username1,
            username2,
            info: infoString,
            signature
        };
    } catch (err) {
        console.error('❌ Lỗi vãi lồn khi lấy dữ liệu từ Firebase:', err.message);
        return null; // Trả về null nếu có lỗi
    }
}


// Load lịch sử
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

// Lưu lịch sử
function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(rikResults), 'utf8');
    } catch (err) {
        console.error('Error saving history:', err);
    }
}

// Xác định Tài/Xỉu
function getTX(d1, d2, d3) {
    return d1 + d2 + d3 >= 11 ? "T" : "X";
}

// ==================== PING/PONG/HEARTBEAT SYSTEM ====================

// Gửi heartbeat (ping định kỳ)
function sendHeartbeat() {
    if (rikWS?.readyState === WebSocket.OPEN && isAuthenticated) {
        try {
            const pingData = JSON.stringify({
                type: 'heartbeat',
                timestamp: Date.now(),
                session: rikCurrentSession
            });
            
            rikWS.ping(pingData);
            console.log("❤️ Sent heartbeat ping");
            
            heartbeatTimeout = setTimeout(() => {
                const timeSinceLastPong = Date.now() - lastPongTime;
                if (timeSinceLastPong > HEARTBEAT_TIMEOUT) {
                    console.log("💔 No pong response within timeout, reconnecting...");
                    isConnectionHealthy = false;
                    reconnectWebSocket();
                }
            }, HEARTBEAT_TIMEOUT);
            
        } catch (err) {
            console.error("Heartbeat ping error:", err);
            isConnectionHealthy = false;
        }
    }
}

// Gửi ping keep-alive (WebSocket native ping)
function sendKeepAlivePing() {
    if (rikWS?.readyState === WebSocket.OPEN && isAuthenticated) {
        try {
            const pingMsg = JSON.stringify({
                type: 'keepalive',
                timestamp: Date.now(),
                health: isConnectionHealthy ? 'good' : 'bad'
            });
            rikWS.ping(pingMsg);
            console.log("📡 Sent keep-alive ping");
        } catch (err) {
            console.error("Keep-alive ping error:", err);
        }
    }
}

// Xử lý khi nhận được pong
function handlePong(data) {
    lastPongTime = Date.now();
    isConnectionHealthy = true;
    
    if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
    }
    
    try {
        if (data) {
            const pongData = data.toString();
            console.log("🫀 Received pong:", pongData.substring(0, 100));
        } else {
            console.log("🫀 Received pong response");
        }
    } catch (err) {
        console.log("🫀 Received pong response");
    }
}

// Kiểm tra trạng thái kết nối
function checkConnectionHealth() {
    const timeSinceLastPong = Date.now() - lastPongTime;
    const wasHealthy = isConnectionHealthy;
    
    if (timeSinceLastPong > HEARTBEAT_TIMEOUT) {
        isConnectionHealthy = false;
        if (wasHealthy) {
            console.log("🚨 Connection health changed: healthy → unhealthy");
            reconnectWebSocket();
        }
    } else {
        isConnectionHealthy = true;
        if (!wasHealthy && isAuthenticated) {
            console.log("✅ Connection health changed: unhealthy → healthy");
        }
    }
    
    return isConnectionHealthy;
}

// ==================== WEBSOCKET COMMANDS ====================

// Gửi lệnh định kỳ
function sendPeriodicCommands() {
    if (rikWS?.readyState === WebSocket.OPEN && isAuthenticated) {
        if (!checkConnectionHealth()) {
            console.log("⚠️ Skipping commands due to unhealthy connection");
            return;
        }
        
        try {
            const cmd1005 = [6, "MiniGame", "taixiuPlugin", { "cmd": 1005, "sid": rikCurrentSession || 0 }];
            rikWS.send(JSON.stringify(cmd1005));
            
            const cmd10001 = [6, "MiniGame", "lobbyPlugin", { "cmd": 10001 }];
            rikWS.send(JSON.stringify(cmd10001));
            
            const cmd1003 = [6, "MiniGame", "taixiuPlugin", { "cmd": 1003 }];
            rikWS.send(JSON.stringify(cmd1003));
            
            console.log("📤 Sent periodic commands: 1005, 10001, 1003");
        } catch (err) {
            console.error("Error sending commands:", err);
        }
    }
}

// Reconnect WebSocket
function reconnectWebSocket() {
    console.log("🔄 Manual reconnection triggered");
    clearTimeout(reconnectTimeout);
    clearInterval(heartbeatInterval);
    clearInterval(pingInterval);
    clearTimeout(heartbeatTimeout);
    connectWebSocket();
}

// ==================== WEBSOCKET CONNECTION ====================

async function connectWebSocket() {
    console.log(`🔌 Connecting to WebSocket... Attempt ${reconnectAttempts + 1}`);
    
    // LẤY DỮ LIỆU TỪ FIREBASE TRƯỚC KHI KẾT NỐI
    const authData = await getAuthData();
    if (!authData) {
        console.error('Đéo kết nối được vì không lấy được token. Thử lại sau 10 giây...');
        setTimeout(connectWebSocket, 10000);
        return;
    }
    
    try {
        if (rikWS) {
            rikWS.removeAllListeners();
            if (rikWS.readyState === WebSocket.OPEN) {
                rikWS.close();
            }
        }

        clearInterval(rikIntervalCmd);
        clearInterval(heartbeatInterval);
        clearInterval(pingInterval);
        clearTimeout(heartbeatTimeout);
        clearTimeout(reconnectTimeout);

        // DÙNG TOKEN VỪA LẤY ĐƯỢC
        const websocketUrl = `wss://websocket.gmwin.io/websocket?token=${authData.wsToken}`;
        console.log('Connecting to:', websocketUrl);
        
        rikWS = new WebSocket(websocketUrl, {
            handshakeTimeout: 10000,
            perMessageDeflate: false
        });

        rikWS.on('open', () => {
            console.log("✅ WebSocket connected");
            clearTimeout(reconnectTimeout);
            reconnectAttempts = 0;
            isAuthenticated = false;
            lastPongTime = Date.now();
            isConnectionHealthy = true;
            
            // DÙNG DỮ LIỆU VỪA LẤY ĐƯỢC ĐỂ TẠO PAYLOAD
            const authPayload = [
                1,
                "MiniGame",
                authData.username1, // "GM_hnam14zz"
                authData.username2, // "hnam1402"
                {
                    "info": authData.info,
                    "pid": 5, // Cái này giữ nguyên hoặc mày tự xem
                    "signature": authData.signature,
                    "subi": true // Cái này giữ nguyên hoặc mày tự xem
                }
            ];
            
            rikWS.send(JSON.stringify(authPayload));
            console.log("🔐 Sent authentication");
        });

        rikWS.on('message', (data) => {
            try {
                const json = JSON.parse(data.toString());
                console.log("📨 Received:", JSON.stringify(json).substring(0, 200) + "...");
                
                if (Array.isArray(json) && json[0] === 1 && json[1] === true) {
                    isAuthenticated = true;
                    isConnectionHealthy = true;
                    console.log("✅ Authentication successful");
                    
                    clearInterval(rikIntervalCmd);
                    rikIntervalCmd = setInterval(sendPeriodicCommands, 3000);
                    
                    clearInterval(heartbeatInterval);
                    heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
                    
                    clearInterval(pingInterval);
                    pingInterval = setInterval(sendKeepAlivePing, PING_INTERVAL);
                    
                    setInterval(checkConnectionHealth, 5000);
                    
                    setTimeout(sendPeriodicCommands, 500);
                    setTimeout(sendHeartbeat, 1000);
                    setTimeout(sendKeepAlivePing, 2000);
                    return;
                }
                
                if (Array.isArray(json) && json[1]?.cmd === 1008 && json[1]?.sid) {
                    const sid = json[1].sid;
                    if (!rikCurrentSession || sid > rikCurrentSession) {
                        rikCurrentSession = sid;
                        console.log(`📋 Phiên hiện tại: ${sid}`);
                    }
                    return;
                }
                
                if (Array.isArray(json) && (json[1]?.cmd === 1003 || json[1]?.cmd === 1004) && 
                    json[1]?.d1 !== undefined && json[1]?.d2 !== undefined && json[1]?.d3 !== undefined) {
                    
                    const res = json[1];
                    if (rikCurrentSession && (!rikResults[0] || rikResults[0].sid !== rikCurrentSession)) {
                        rikResults.unshift({ 
                            sid: rikCurrentSession, 
                            d1: res.d1, 
                            d2: res.d2, 
                            d3: res.d3, 
                            timestamp: Date.now() 
                        });
                        if (rikResults.length > 100) rikResults.pop();
                        saveHistory();
                        console.log(`🎲 Phiên ${rikCurrentSession} → ${getTX(res.d1, res.d2, res.d3)} (${res.d1},${res.d2},${res.d3})`);
                    }
                    return;
                }
                
                if (Array.isArray(json) && json[1]?.cmd === 1005 && json[1]?.htr) {
                    const newHistory = json[1].htr.map(i => ({
                        sid: i.sid, 
                        d1: i.d1, 
                        d2: i.d2, 
                        d3: i.d3, 
                        timestamp: Date.now()
                    })).sort((a, b) => b.sid - a.sid);
                    
                    if (newHistory.length > 0) {
                        rikResults = newHistory.slice(0, 100);
                        saveHistory();
                        console.log(`📦 Loaded ${newHistory.length} history records`);
                    }
                    return;
                }
                
            } catch (e) {
                console.error("Parse error:", e.message);
            }
        });

        rikWS.on('close', (code, reason) => {
            console.log(`🔌 WebSocket closed: ${code} - ${reason}`);
            isAuthenticated = false;
            isConnectionHealthy = false;
            clearInterval(rikIntervalCmd);
            clearInterval(heartbeatInterval);
            clearInterval(pingInterval);
            clearTimeout(heartbeatTimeout);
            
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            console.log(`Reconnecting in ${delay}ms...`);
            
            reconnectTimeout = setTimeout(connectWebSocket, delay);
        });

        rikWS.on('error', (err) => {
            console.error("WebSocket error:", err.message);
            isAuthenticated = false;
            isConnectionHealthy = false;
        });

        rikWS.on('ping', (data) => {
            console.log("📡 Received ping from server");
            rikWS.pong(data);
            console.log("🫀 Sent pong response to server");
        });

        rikWS.on('pong', (data) => {
            handlePong(data);
        });

        rikWS.on('unexpected-response', (request, response) => {
            console.log(`🚨 Unexpected response: ${response.statusCode}`);
        });

    } catch (err) {
        console.error("Failed to create WebSocket:", err.message);
        reconnectTimeout = setTimeout(connectWebSocket, 5000);
    }
}

// ==================== API ENDPOINTS ====================

fastify.register(require('@fastify/cors'));

fastify.get("/api/taixiu/sunwin", async () => {
    const valid = rikResults.filter(r => r.d1 !== undefined && r.d2 !== undefined && r.d3 !== undefined);
    if (!valid.length) return { message: "Không có dữ liệu." };

    const current = valid[0];
    const sum = current.d1 + current.d2 + current.d3;
    
    const timeSinceLastPong = Date.now() - lastPongTime;
    const heartbeatStatus = timeSinceLastPong < HEARTBEAT_TIMEOUT ? "healthy" : "stale";
    
    return {
        phien: current.sid,
        xuc_xac_1: current.d1,
        xuc_xac_2: current.d2,
        xuc_xac_3: current.d3,
        tong: sum,
        ket_qua: sum >= 11 ? "Tài" : "Xỉu",
        phien_hien_tai: rikCurrentSession || current.sid + 1,
        status: isAuthenticated ? "connected" : "disconnected",
        connection_health: {
            status: heartbeatStatus,
            last_pong: new Date(lastPongTime).toISOString(),
            time_since_last_pong: timeSinceLastPong + "ms",
            is_healthy: isConnectionHealthy,
            reconnect_attempts: reconnectAttempts
        }
    };
});

fastify.get("/api/taixiu/history", async () => {
    const valid = rikResults.filter(r => r.d1 !== undefined && r.d2 !== undefined && r.d3 !== undefined);
    return valid.map(i => ({
        phien: i.sid,
        xuc_xac_1: i.d1,
        xuc_xac_2: i.d2,
        xuc_xac_3: i.d3,
        tong: i.d1 + i.d2 + i.d3,
        ket_qua: getTX(i.d1, i.d2, i.d3) === "T" ? "Tài" : "Xỉu"
    }));
});

// API health check
fastify.get("/health", async () => {
    const timeSinceLastPong = Date.now() - lastPongTime;
    return {
        status: isAuthenticated ? "connected" : "disconnected",
        websocket_ready: rikWS?.readyState === WebSocket.OPEN,
        authenticated: isAuthenticated,
        connection_healthy: isConnectionHealthy,
        last_pong: new Date(lastPongTime).toISOString(),
        time_since_last_pong: timeSinceLastPong + "ms",
        current_session: rikCurrentSession,
        history_count: rikResults.length,
        reconnect_attempts: reconnectAttempts
    };
});

// API manual reconnect
fastify.post("/reconnect", async () => {
    reconnectWebSocket();
    return { message: "Reconnection triggered" };
});

// ==================== START SERVER ====================

const start = async () => {
    try {
        loadHistory();
        connectWebSocket();
        
        await fastify.listen({ port: PORT, host: "0.0.0.0" });
        console.log(`🚀 API chạy tại port ${PORT}`);
        console.log(`❤️  Heartbeat system: ${HEARTBEAT_INTERVAL}ms interval, ${HEARTBEAT_TIMEOUT}ms timeout`);
        console.log(`📡 Ping interval: ${PING_INTERVAL}ms`);
    } catch (err) {
        console.error("Server error:", err);
        process.exit(1);
    }
};

start();
