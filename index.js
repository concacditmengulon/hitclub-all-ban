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
// HÀM THUẬT TOÁN DỰ ĐOÁN TÀI XỈU
// Vui lòng thay thế nội dung của hàm này bằng thuật toán của bạn
// =========================================================================
function predictResult(history) {
    // Thuật toán ví dụ: Dự đoán ngược lại kết quả phiên trước
    // Bạn có thể thay thế bằng thuật toán phức tạp của bạn ở đây
    if (history.length === 0) {
        return {
            du_doan: "Chua co du lieu",
            do_tin_cay: "0%",
            giai_thich: "Khong co du lieu de phan tich."
        };
    }

    const lastResult = history[0];
    const prediction = lastResult.Ket_qua === "Tai" ? "Xiu" : "Tai";
    const confidence = "55%"; // Ví dụ, bạn có thể tính toán con số này
    const explanation = "Du doan dua tren phien truoc. Ket qua phien truoc la " + lastResult.Ket_qua;
    
    return {
        du_doan: prediction,
        do_tin_cay: confidence,
        giai_thich: explanation
    };
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
