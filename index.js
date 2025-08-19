const express = require('express');
const fetch = require('node-fetch');
const { Mutex } = require('async-mutex');

const app = express();
const PORT = process.env.PORT || 8000;
const HOST = '0.0.0.0';

// Global variables and constants
const POLL_INTERVAL = 5000; // 5 seconds
const RETRY_DELAY = 5000; // 5 seconds
const MAX_HISTORY = 50;

const latestResult100 = {
    "Phien": 0, "Xuc_xac_1": 0, "Xuc_xac_2": 0, "Xuc_xac_3": 0,
    "Tong": 0, "Ket_qua": "Chua co", "id": "Tele@CsTool001"
};
const latestResult101 = {
    "Phien": 0, "Xuc_xac_1": 0, "Xuc_xac_2": 0, "Xuc_xac_3": 0,
    "Tong": 0, "Ket_qua": "Chua co", "id": "Tele@CsTool001"
};

const history100 = [];
const history101 = [];

let lastSid100 = null;
let lastSid101 = null;
let sidForTx = null;

const mutex100 = new Mutex();
const mutex101 = new Mutex();

// Helper functions
function getTaiXiu(d1, d2, d3) {
    const total = d1 + d2 + d3;
    return total <= 10 ? "Xiu" : "Tai";
}

// =========================================================================
// HÀM THUẬT TOÁN DỰ ĐOÁN TÀI XỈU SIÊU VIP
// Thuật toán nâng cấp dựa trên phân tích lịch sử: kết hợp Markov Chain để tính xác suất chuyển tiếp,
// phát hiện các loại cầu (bệt, 1-1, random), và heuristic dựa trên chuỗi gần đây.
// Không thể đảm bảo 100% chính xác vì trò chơi dựa trên ngẫu nhiên, nhưng tối ưu hóa dựa trên mẫu lịch sử.
// =========================================================================
function predictResult(history) {
    if (history.length === 0) {
        return {
            du_doan: "Chua co du lieu",
            do_tin_cay: "0%",
            giai_thich: "Khong co du lieu de phan tich."
        };
    }

    // Chuyển Ket_qua thành 0: Xiu, 1: Tai để dễ tính toán
    const sequence = history.map(res => res.Ket_qua === "Tai" ? 1 : 0);

    // 1. Phát hiện loại cầu gần đây
    let recentPattern = detectPattern(sequence.slice(0, 5)); // Xem 5 kết quả gần nhất

    // 2. Sử dụng Markov Chain để tính xác suất chuyển tiếp
    const markov = buildMarkovChain(sequence);
    const lastState = sequence[0];
    const probTai = markov[lastState][1]; // Xác suất next là Tai
    const probXiu = markov[lastState][0]; // Xác suất next là Xiu

    // 3. Kết hợp heuristic
    let prediction;
    let confidence = Math.max(probTai, probXiu) * 100;
    let explanation = `Dựa trên Markov Chain: Xác suất Tai: ${probTai.toFixed(2)}, Xiu: ${probXiu.toFixed(2)}. `;

    if (recentPattern === 'bet') {
        // Cầu bệt: Nếu chuỗi < 4, tiếp tục; >=4, đảo
        const streak = countStreak(sequence);
        if (streak < 4) {
            prediction = lastState === 1 ? "Tai" : "Xiu";
            explanation += `Cầu bệt đang tiếp diễn (chuỗi ${streak}), dự đoán tiếp tục.`;
        } else {
            prediction = lastState === 1 ? "Xiu" : "Tai";
            explanation += `Cầu bệt dài (${streak}), dự đoán đảo chiều.`;
        }
    } else if (recentPattern === '1-1') {
        // Cầu 1-1: Dự đoán đảo chiều so với kết quả cuối
        prediction = lastState === 1 ? "Xiu" : "Tai";
        explanation += "Cầu 1-1 luân phiên, dự đoán đảo chiều.";
    } else {
        // Random hoặc fallback: Sử dụng Markov
        prediction = probTai > probXiu ? "Tai" : "Xiu";
        explanation += "Không phát hiện cầu rõ ràng, dựa vào xác suất chuyển tiếp.";
    }

    // Điều chỉnh độ tin cậy dựa trên độ dài lịch sử và sự khác biệt prob
    const diff = Math.abs(probTai - probXiu);
    confidence = Math.min(95, confidence + (diff * 50)); // Tối đa 95% để thực tế
    confidence = confidence.toFixed(0) + "%";

    // Nếu lịch sử ngắn (<5), giảm độ tin cậy
    if (history.length < 5) {
        confidence = "50%";
        explanation += " Lịch sử ngắn, độ tin cậy thấp.";
    }

    return {
        du_doan: prediction,
        do_tin_cay: confidence,
        giai_thich: explanation
    };
}

// Helper: Xây dựng Markov Chain (ma trận chuyển tiếp)
function buildMarkovChain(sequence) {
    const transitions = [[0, 0], [0, 0]]; // [from Xiu: to Xiu, to Tai], [from Tai: to Xiu, to Tai]
    let counts = [0, 0]; // Số lần xuất hiện Xiu, Tai

    for (let i = 0; i < sequence.length - 1; i++) {
        const from = sequence[i];
        const to = sequence[i + 1];
        transitions[from][to]++;
        counts[from]++;
    }

    // Tính xác suất, fallback nếu count=0
    const probs = [
        [counts[0] > 0 ? transitions[0][0] / counts[0] : 0.5, counts[0] > 0 ? transitions[0][1] / counts[0] : 0.5],
        [counts[1] > 0 ? transitions[1][0] / counts[1] : 0.5, counts[1] > 0 ? transitions[1][1] / counts[1] : 0.5]
    ];

    return probs;
}

// Helper: Phát hiện pattern gần đây
function detectPattern(recent) {
    if (recent.length < 2) return 'random';

    // Kiểm tra cầu bệt: tất cả giống nhau
    if (recent.every(s => s === recent[0])) return 'bet';

    // Kiểm tra cầu 1-1: luân phiên
    let isAlternating = true;
    for (let i = 1; i < recent.length; i++) {
        if (recent[i] === recent[i-1]) {
            isAlternating = false;
            break;
        }
    }
    if (isAlternating) return '1-1';

    return 'random';
}

// Helper: Đếm chuỗi liên tiếp hiện tại
function countStreak(sequence) {
    if (sequence.length === 0) return 0;
    let streak = 1;
    const last = sequence[0];
    for (let i = 1; i < sequence.length; i++) {
        if (sequence[i] !== last) break;
        streak++;
    }
    return streak;
}
// =========================================================================

async function updateResult(store, history, mutex, result) {
    const release = await mutex.acquire();
    try {
        Object.assign(store, result);
        history.unshift({ ...result });
        if (history.length > MAX_HISTORY) {
            history.pop();
        }
    } finally {
        release();
    }
}

async function pollApi(gid, mutex, resultStore, history, isMd5) {
    const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=${gid}`;
    while (true) {
        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'OK' && Array.isArray(data.data)) {
                if (!isMd5) {
                    const game1008 = data.data.find(g => g.cmd === 1008);
                    if (game1008) {
                        sidForTx = game1008.sid;
                    }
                }

                for (const game of data.data) {
                    if (isMd5 && game.cmd === 2006) {
                        const { sid, d1, d2, d3 } = game;
                        if (sid && sid !== lastSid101 && d1 !== null && d2 !== null && d3 !== null) {
                            lastSid101 = sid;
                            const total = d1 + d2 + d3;
                            const ket_qua = getTaiXiu(d1, d2, d3);
                            const result = {
                                "Phien": sid, "Xuc_xac_1": d1, "Xuc_xac_2": d2, "Xuc_xac_3": d3,
                                "Tong": total, "Ket_qua": ket_qua, "id": "Tele@CsTool001"
                            };
                            await updateResult(resultStore, history, mutex, result);
                            console.log(`[MD5] Phien ${sid} - Tong: ${total}, Ket qua: ${ket_qua}`);
                        }
                    } else if (!isMd5 && game.cmd === 1003) {
                        const { d1, d2, d3 } = game;
                        const sid = sidForTx;
                        if (sid && sid !== lastSid100 && d1 !== null && d2 !== null && d3 !== null) {
                            lastSid100 = sid;
                            const total = d1 + d2 + d3;
                            const ket_qua = getTaiXiu(d1, d2, d3);
                            const result = {
                                "Phien": sid, "Xuc_xac_1": d1, "Xuc_xac_2": d2, "Xuc_xac_3": d3,
                                "Tong": total, "Ket_qua": ket_qua, "id": "Tele@CsTool001"
                            };
                            await updateResult(resultStore, history, mutex, result);
                            console.log(`[TX] Phien ${sid} - Tong: ${total}, Ket qua: ${ket_qua}`);
                            sidForTx = null;
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error fetching API for gid=${gid}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
}

// API endpoints
app.get("/api/taixiu", async (req, res) => {
    const release = await mutex100.acquire();
    try {
        const prediction = predictResult(history100);
        const result = {
            phien: latestResult100.Phien,
            xuc_xac: `${latestResult100.Xuc_xac_1} - ${latestResult100.Xuc_xac_2} - ${latestResult100.Xuc_xac_3}`,
            tong: latestResult100.Tong,
            ket_qua: latestResult100.Ket_qua,
            phien_sau: latestResult100.Phien + 1,
            du_doan: prediction.du_doan,
            do_tin_cay: prediction.do_tin_cay,
            giai_thich: prediction.giai_thich,
            id: latestResult100.id
        };
        res.json(result);
    } finally {
        release();
    }
});

app.get("/api/taixiumd5", async (req, res) => {
    const release = await mutex101.acquire();
    try {
        const prediction = predictResult(history101);
        const result = {
            phien: latestResult101.Phien,
            xuc_xac: `${latestResult101.Xuc_xac_1} - ${latestResult101.Xuc_xac_2} - ${latestResult101.Xuc_xac_3}`,
            tong: latestResult101.Tong,
            ket_qua: latestResult101.Ket_qua,
            phien_sau: latestResult101.Phien + 1,
            du_doan: prediction.du_doan,
            do_tin_cay: prediction.do_tin_cay,
            giai_thich: prediction.giai_thich,
            id: latestResult101.id
        };
        res.json(result);
    } finally {
        release();
    }
});

app.get("/api/history", async (req, res) => {
    const release100 = await mutex100.acquire();
    const release101 = await mutex101.acquire();
    try {
        res.json({
            taixiu: history100,
            taixiumd5: history101
        });
    } finally {
        release100();
        release101();
    }
});

app.get("/", (req, res) => {
    res.send("API Server for TaiXiu is running. Endpoints: /api/taixiu, /api/taixiumd5, /api/history");
});

// Start API polling and server
console.log("Starting TaiXiu API system...");
pollApi("vgmn_100", mutex100, latestResult100, history100, false);
pollApi("vgmn_101", mutex101, latestResult101, history101, true);

app.listen(PORT, HOST, () => {
    console.log(`Server is running at http://${HOST}:${PORT}`);
});
