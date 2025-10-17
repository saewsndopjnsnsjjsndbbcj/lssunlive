const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJoZWxsb2tpZXRkZXB6YWkiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50Ijp0cnVlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjI2MzE1MDI1MiwiYWZmSWQiOiIwYjA4ZDA0YjI1YmNkMGFkNDQ4NGMwZjlkYmQ1NmM0ZSIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc1Nzc2NzEwNjI0NCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjI0MDI6ODAwOjYyY2Q6YjRkMTo4YzY0OmEzYzk6MTJiZjpjMTlhIiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wOS5wbmciLCJwbGF0Zm9ybUlkIjoxLCJ1c2VySWQiOiJjZGJhZjU5OC1lNGVmLTQ3ZjgtYjRhNi1hNDg4MTA5OGRiODYiLCJyZWdUaW1lIjoxNzQ5MTk0MTM2MTY1LCJwaG9uZSI6Ijg0MzY5ODIzODAwIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19oZWxsb2tpZXRuZTIxMiJ9.ObqvJUUyS_yUN6VtK8-6NS5iV2cK5cGEMmrAFnzUOaI";
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";

const fastify = Fastify({ logger: false });
const PORT = 8000;
const HISTORY_FILE = path.join(__dirname, 'taixiu_history.json');

let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;

function parseLines(lines) {
  const arr = lines.map(l => (typeof l === 'string' ? JSON.parse(l) : l));
  return arr.map(item => ({
    session: item.session,
    dice: item.dice,
    total: item.total,
    result: item.result,
    tx: item.total >= 11 ? 'T' : 'X'
  })).sort((a, b) => a.session - b.session);
}

function lastN(arr, n) {
  return arr.slice(Math.max(0, arr.length - n));
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function majority(obj) {
  let maxK = null,
    maxV = -Infinity;
  for (const k in obj)
    if (obj[k] > maxV) {
      maxV = obj[k];
      maxK = k;
    }
  return {
    key: maxK,
    val: maxV
  };
}

function sum(nums) {
  return nums.reduce((a, b) => a + b, 0);
}

function avg(nums) {
  return nums.length ? sum(nums) / nums.length : 0;
}


function extractFeatures(history) {
  const tx = history.map(h => h.tx);
  const totals = history.map(h => h.total);
  const last = (k = 1) => history.at(-k);
  const features = {
    tx,
    totals,
    freq: tx.reduce((a, v) => {
      a[v] = (a[v] || 0) + 1;
      return a;
    }, {})
  };

  features.lastDice = last(1)?.dice || [];
  features.last3Dice = history.slice(-3).map(h => h.dice);

  let runs = [],
    cur = tx[0],
    len = 1;
  for (let i = 1; i < tx.length; i++) {
    if (tx[i] === cur) len++;
    else {
      runs.push({
        val: cur,
        len
      });
      cur = tx[i];
      len = 1;
    }
  }
  if (tx.length) runs.push({
    val: cur,
    len
  });
  features.runs = runs;
  features.maxRun = runs.reduce((m, r) => Math.max(m, r.len), 0) || 0;

  features.meanTotal = avg(totals);
  features.stdTotal = Math.sqrt(avg(totals.map(t => Math.pow(t - features.meanTotal, 2))));
  features.entropy = entropy(tx);

  return features;
}

function entropy(arr) {
  if (!arr.length) return 0;
  const freq = arr.reduce((a, v) => {
    a[v] = (a[v] || 0) + 1;
    return a;
  }, {});
  const n = arr.length;
  let e = 0;
  for (const k in freq) {
    const p = freq[k] / n;
    e -= p * Math.log2(p);
  }
  return e;
}


function algo1_cycle3(history) {
  const tx = history.map(h => h.tx);
  if (tx.length < 6) return null;
  const p = tx.slice(-6, -3).join(''),
    q = tx.slice(-3).join('');
  if (p === q) return tx.at(-1);
  return null;
}

function algo2_alternate2(history) {
  const tx = history.map(h => h.tx).slice(-4);
  if (tx.length < 4) return null;
  const set = new Set(tx);
  if (set.size === 2) {
    if (tx[0] === tx[2] && tx[1] === tx[3] && tx[0] !== tx[1]) {
      return tx.at(-1) === 'T' ? 'X' : 'T';
    }
  }
  return null;
}

function algo3_threeRepeat(history) {
  const tx = history.map(h => h.tx);
  const last3 = tx.slice(-3);
  if (last3.length === 3 && last3[0] === last3[1] && last3[1] === last3[2]) return last3[0];
  return null;
}

function algo4_double2pattern(history) {
  const tx = history.map(h => h.tx).slice(-4);
  if (tx.length === 4 && tx[0] === tx[1] && tx[2] === tx[3] && tx[0] !== tx[2]) {
    return tx.at(-1) === 'T' ? 'X' : 'T';
  }
  return null;
}

function algo5_freqRebalance(history) {
  const tx = history.map(h => h.tx);
  const freq = tx.reduce((a, v) => {
    a[v] = (a[v] || 0) + 1;
    return a;
  }, {});
  if ((freq['T'] || 0) > (freq['X'] || 0)) return 'X';
  if ((freq['X'] || 0) > (freq['T'] || 0)) return 'T';
  return null;
}

function algo6_longRunReversal(history) {
  const f = extractFeatures(history);
  if (f.maxRun >= 3) {
    return history.at(-1).tx === 'T' ? 'X' : 'T';
  }
  return null;
}

function algo7_threePatternReversal(history) {
  const tx = history.map(h => h.tx).slice(-3);
  if (tx.length === 3 && tx[0] !== tx[1] && tx[1] === tx[2]) {
    return tx.at(-1) === 'T' ? 'X' : 'T';
  }
  return null;
}

function algo8_probabilistic50(history) {
  return Math.random() < 0.5 ? 'T' : 'X';
}

function algo9_twoOneSwitch(history) {
  const tx = history.map(h => h.tx).slice(-3);
  if (tx.length === 3 && tx[0] === tx[1] && tx[1] !== tx[2]) {
    return tx[2] === 'T' ? 'X' : 'T';
  }
  return null;
}

function algo10_newSequenceFollow(history) {
  const tx = history.map(h => h.tx);
  if (tx.length < 6) return null;
  const last6 = tx.slice(-6).join('');
  if (!tx.slice(0, -6).join('').includes(last6)) return tx.at(-1);
  return null;
}


function algoA_markov(history) {
  const tx = history.map(h => h.tx);
  const order = 2;
  if (tx.length < order + 1) return null;
  const transitions = {};
  for (let i = 0; i <= tx.length - order - 0; i++) {
    const key = tx.slice(i, i + order).join('');
    const next = tx[i + order];
    transitions[key] = transitions[key] || {
      T: 0,
      X: 0
    };
    transitions[key][next]++;
  }
  const lastKey = tx.slice(-order).join('');
  const counts = transitions[lastKey];
  if (!counts) return null;
  return (counts['T'] >= counts['X']) ? 'T' : 'X';
}

function algoB_ngram(history) {
  const tx = history.map(h => h.tx);
  const k = 3;
  if (tx.length < k + 1) return null;
  const lastGram = tx.slice(-k).join('');
  let counts = {
    T: 0,
    X: 0
  };
  for (let i = 0; i <= tx.length - k - 1; i++) {
    const gram = tx.slice(i, i + k).join('');
    if (gram === lastGram) counts[tx[i + k]]++;
  }
  if (counts.T === counts.X) return null;
  return counts.T > counts.X ? 'T' : 'X';
}

function algoC_entropy(history) {
  const tx = history.map(h => h.tx);
  if (tx.length < 8) return null;
  const eRecent = entropy(tx.slice(-8));
  const eOlder = entropy(tx.slice(0, Math.max(0, tx.length - 8)));
  if (eRecent < 0.9 && eOlder - eRecent > 0.2) {
    return tx.at(-1);
  }
  if (eRecent > 1.0 && eRecent - eOlder > 0.2) {
    return tx.at(-1) === 'T' ? 'X' : 'T';
  }
  return null;
}

function algoD_dicePattern(history) {
  const map = {};
  for (const h of history) {
    const d = h.dice;
    const uniq = unique(d);
    let kind = 'distinct';
    if (uniq.length === 1) kind = 'triple';
    else if (uniq.length === 2) kind = 'pair';
    map[kind] = map[kind] || {
      T: 0,
      X: 0
    };
    map[kind][h.tx] = (map[kind][h.tx] || 0) + 1;
  }
  const lastDice = history.at(-1).dice;
  const lastKind = unique(lastDice).length === 1 ? 'triple' : (unique(lastDice).length === 2 ? 'pair' : 'distinct');
  const counts = map[lastKind];
  if (!counts) return null;
  if (counts.T === counts.X) return null;
  return counts.T > counts.X ? 'T' : 'X';
}

function algoE_runMomentum(history) {
  const tx = history.map(h => h.tx);
  if (tx.length < 6) return null;
  let runs = [];
  let cur = tx[0],
    len = 1;
  for (let i = 1; i < tx.length; i++) {
    if (tx[i] === cur) len++;
    else {
      runs.push({
        val: cur,
        len
      });
      cur = tx[i];
      len = 1;
    }
  }
  runs.push({
    val: cur,
    len
  });
  const lastRuns = runs.slice(-3).map(r => r.len);
  if (lastRuns.length < 3) return null;
  if (lastRuns[2] > lastRuns[1] && lastRuns[1] > lastRuns[0]) {
    return tx.at(-1);
  }
  if (lastRuns[2] < lastRuns[1] && lastRuns[1] < lastRuns[0]) {
    return tx.at(-1) === 'T' ? 'X' : 'T';
  }
  return null;
}

function algoF_windowSimilarity(history) {
  const tx = history.map(h => h.tx);
  const win = 6;
  if (tx.length < win * 2) return null;
  const target = tx.slice(-win).join('');
  let best = {
    score: -1,
    next: null
  };
  for (let i = 0; i <= tx.length - win - 1 - win; i++) {
    const w = tx.slice(i, i + win).join('');
    const score = similarity(w, target);
    if (score > best.score) {
      best.score = score;
      best.next = tx[i + win];
    }
  }
  if (best.score <= 0) return null;
  return best.next;
}

function similarity(a, b) {
  if (a.length !== b.length) return 0;
  let m = 0;
  for (let i = 0; i < a.length; i++)
    if (a[i] === b[i]) m++;
  return m / a.length;
}


class SEIUEnsemble {
  constructor(algorithms, opts = {}) {
    this.algs = algorithms;
    this.weights = {};
    this.emaAlpha = opts.emaAlpha ?? 0.15;
    this.minWeight = opts.minWeight ?? 0.01;
    this.historyWindow = opts.historyWindow ?? 100;
    for (const a of algorithms) this.weights[a.id] = 1;
  }

  fitInitial(history) {
    const window = lastN(history, this.historyWindow);
    if (!window.length) return;
    const algScores = {};
    for (const a of this.algs) algScores[a.id] = 0;
    for (let i = 3; i < window.length; i++) {
      const prefix = window.slice(0, i);
      const actual = window[i].tx;
      for (const a of this.algs) {
        const pred = a.fn(prefix);
        if (pred && pred === actual) algScores[a.id]++;
      }
    }
    let total = 0;
    for (const id in algScores) {
      const w = (algScores[id] || 0) + 1;
      this.weights[id] = w;
      total += w;
    }
    for (const id in this.weights) this.weights[id] = Math.max(this.minWeight, this.weights[id] / total);
  }

  updateWithOutcome(historyPrefix, actualTx) {
    for (const a of this.algs) {
      const pred = a.fn(historyPrefix);
      const correct = pred === actualTx ? 1 : 0;
      const target = (this.weights[a.id] || 0) * (1 + (correct ? 0.5 : -0.5));
      const old = this.weights[a.id] || 0.001;
      const nw = this.emaAlpha * target + (1 - this.emaAlpha) * old;
      this.weights[a.id] = Math.max(this.minWeight, nw);
    }
    const s = Object.values(this.weights).reduce((a, b) => a + b, 0) || 1;
    for (const id in this.weights) this.weights[id] /= s;
  }

  predict(history) {
    const votes = {};
    for (const a of this.algs) {
      const pred = a.fn(history);
      if (!pred) continue;
      votes[pred] = (votes[pred] || 0) + (this.weights[a.id] || 0);
    }
    if (!votes['T'] && !votes['X']) {
      const fallback = algo5_freqRebalance(history) || 'T';
      return {
        prediction: fallback === 'T' ? 'Tài' : 'Xỉu',
        confidence: 0.5,
        votes
      };
    }
    const {
      key: best,
      val: bestVal
    } = majority(votes);
    const total = Object.values(votes).reduce((a, b) => a + b, 0);
    const confidence = Math.min(0.99, Math.max(0.01, total > 0 ? bestVal / total : 0.5));
    return {
      prediction: best === 'T' ? 'Tài' : 'Xỉu',
      confidence,
      votes
    };
  }
}


const ALL_ALGS = [{
  id: 'algo1',
  fn: (h) => algo1_cycle3(h)
}, {
  id: 'algo2',
  fn: (h) => algo2_alternate2(h)
}, {
  id: 'algo3',
  fn: (h) => algo3_threeRepeat(h)
}, {
  id: 'algo4',
  fn: (h) => algo4_double2pattern(h)
}, {
  id: 'algo5',
  fn: (h) => algo5_freqRebalance(h)
}, {
  id: 'algo6',
  fn: (h) => algo6_longRunReversal(h)
}, {
  id: 'algo7',
  fn: (h) => algo7_threePatternReversal(h)
}, {
  id: 'algo8',
  fn: (h) => algo8_probabilistic50(h)
}, {
  id: 'algo9',
  fn: (h) => algo9_twoOneSwitch(h)
}, {
  id: 'algo10',
  fn: (h) => algo10_newSequenceFollow(h)
}, {
  id: 'A_markov',
  fn: (h) => algoA_markov(h)
}, {
  id: 'B_ngram',
  fn: (h) => algoB_ngram(h)
}, {
  id: 'C_entropy',
  fn: (h) => algoC_entropy(h)
}, {
  id: 'D_dice',
  fn: (h) => algoD_dicePattern(h)
}, {
  id: 'E_runmom',
  fn: (h) => algoE_runMomentum(h)
}, {
  id: 'F_window',
  fn: (h) => algoF_windowSimilarity(h)
}];


class SEIUManager {
  constructor(opts = {}) {
    this.history = [];
    this.ensemble = new SEIUEnsemble(ALL_ALGS, {
      emaAlpha: opts.emaAlpha ?? 0.12,
      historyWindow: opts.historyWindow ?? 200
    });
    this.warm = false;
  }

  loadInitial(lines) {
    this.history = parseLines(lines);
    this.ensemble.fitInitial(this.history);
    this.warm = true;
  }

  pushRecord(record) {
    const parsed = {
      session: record.session,
      dice: record.dice,
      total: record.total,
      result: record.result,
      tx: record.total >= 11 ? 'T' : 'X'
    };
    this.history.push(parsed);
    const prefix = this.history.slice(0, -1);
    if (prefix.length >= 3) {
      this.ensemble.updateWithOutcome(prefix, parsed.tx);
    }
  }

  getPrediction() {
    return this.ensemble.predict(this.history);
  }

  inspect() {
    return {
      weights: { ...this.ensemble.weights
      },
      lastPrediction: this.getPrediction(),
      historyLen: this.history.length,
      last5: this.history.slice(-5)
    };
  }
}


const seiuManager = new SEIUManager();

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      rikResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      seiuManager.loadInitial(rikResults);
      console.log(`📚 Đã tải ${rikResults.length} bản ghi lịch sử vào hệ thống dự đoán.`);
    }
  } catch (err) {
    console.error('❌ Lỗi khi tải lịch sử:', err);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(rikResults, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Lỗi khi lưu lịch sử:', err);
  }
}

function decodeBinaryMessage(data) {
  try {
    const message = Buffer.from(data).toString('utf-8');
    if (message.startsWith('[') || message.startsWith('{')) {
      return JSON.parse(message);
    }
    return null;
  } catch (e) {
    return null;
  }
}

function sendRikCmd1005() {
  if (rikWS?.readyState === WebSocket.OPEN) {
    rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
  }
}

function connectRikWebSocket() {
  console.log("🔌 Đang kết nối đến WebSocket...");
  rikWS = new WebSocket(`${WS_URL}${TOKEN}`);

  rikWS.on("open", () => {
    const authPayload = [
      1,
      "MiniGame",
      "SC_hellokietne212",
      "kiet2012",
      {
        info: JSON.stringify({
          ipAddress: "2402:800:62cd:b4d1:8c64:a3c9:12bf:c19a",
          wsToken: TOKEN,
          userId: "cdbaf598-e4ef-47f8-b4a6-a4881098db86",
          username: "SC_hellokietne212",
          timestamp: Date.now(),
          refreshToken: "840b0b6c5308474190cbff20de9d4fbf.c637a02d4ee143b49ddcb817cd2a773b",
        }),
        signature: "473ABDDDA6BDD74D8F0B6036223B0E3A002A518203A9BB9F95AD763E3BF969EC2CBBA61ED1A3A9E217B52A4055658D7BEA38F89B806285974C7F3F62A9400066709B4746585887D00C9796552671894F826E69EFD234F6778A5DDC24830CEF68D51217EF047644E0B0EB1CB26942EB34AEF114AEC36A6DF833BB10F7D122EA5E",
        pid: 5,
        subi: true
      }
    ];
    rikWS.send(JSON.stringify(authPayload));
    clearInterval(rikIntervalCmd);
    rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
  });

  rikWS.on("message", (data) => {
    try {
      const json = typeof data === 'string' ? JSON.parse(data) : decodeBinaryMessage(data);
      if (!json) return;

      if (typeof json === 'object' && json !== null && json.session && Array.isArray(json.dice)) {
        const record = {
          session: json.session,
          dice: json.dice,
          total: json.total,
          result: json.result
        };
        seiuManager.pushRecord(record);
        if (!rikCurrentSession || record.session > rikCurrentSession) {
          rikCurrentSession = record.session;
          rikResults.unshift(record);
          if (rikResults.length > 100) rikResults.pop();
          saveHistory();
          console.log(`📥 Phiên mới ${record.session} → ${record.result}`);
        }
      } else if (Array.isArray(json) && json[1]?.htr) {
        const newHistory = json[1].htr.map(i => ({
          session: i.sid,
          dice: [i.d1, i.d2, i.d3],
          total: i.d1 + i.d2 + i.d3,
          result: (i.d1 + i.d2 + i.d3 >= 11) ? "Tài" : "Xỉu"
        })).sort((a, b) => b.session - a.session);
        seiuManager.loadInitial(newHistory);
        rikResults = newHistory.slice(0, 100);
        saveHistory();
        console.log("📦 Đã tải lịch sử các phiên gần nhất.");
      }
    } catch (e) {
      console.error("❌ Parse error:", e.message);
    }
  });

  rikWS.on("close", () => {
    console.log("🔌 WebSocket ngắt kết nối. Đang kết nối lại...");
    setTimeout(connectRikWebSocket, 5000);
  });

  rikWS.on("error", (err) => {
    console.error("🔌 WebSocket error:", err.message);
    rikWS.close();
  });
}

loadHistory();
connectRikWebSocket();
fastify.register(cors);

fastify.get("/api/taixiu/sunwin", async () => {
  const valid = rikResults.filter(r => r.dice?.length === 3);
  if (!valid.length) return {
    message: "Không có dữ liệu."
  };

  const current = valid[0];
  const {
    session,
    dice,
    total,
    result
  } = current;

  const prediction = seiuManager.getPrediction();

  return {
    id: "@hellokietne21",
    phien: session,
    xuc_xac_1: dice[0],
    xuc_xac_2: dice[1],
    xuc_xac_3: dice[2],
    tong: total,
    ket_qua: result,
    du_doan: prediction.prediction,
    ty_le_thanh_cong: `${(prediction.confidence * 100).toFixed(0)}%`,
    giai_thich: "Dự đoán bởi thuật toán kết hợp đa mô hình (SEIU-MAX)",
  };
});

fastify.get("/api/taixiu/history", async () => {
  const valid = rikResults.filter(r => r.dice?.length === 3);
  if (!valid.length) return {
    message: "Không có dữ liệu lịch sử."
  };
  return valid.map(i => ({
    session: i.session,
    dice: i.dice,
    total: i.total,
    result: i.result
  }));
});

const start = async () => {
  try {
    const address = await fastify.listen({
      port: PORT,
      host: "0.0.0.0"
    });
    console.log(`🚀 API chạy tại ${address}`);
  } catch (err) {
    console.error("❌ Server error:", err);
    process.exit(1);
  }
};

start();