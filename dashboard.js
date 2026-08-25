// ============================================================
// 🖥️ DASHBOARD SERVER — BẢNG ĐIỀU KHIỂN WEB CHO NINO BOT
// Khởi động cùng bot, truy cập tại: http://localhost:3000
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadDB } = require("./database");
const { sendServerGreeting } = require("./cron");

// Mảng lưu log trong bộ nhớ RAM (tối đa 500 dòng)
const MAX_LOG_LINES = 500;
const logBuffer = [];

// ✅ Ghi đè console.log / console.error để bắt log vào buffer
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);

function pushLog(level, ...args) {
    const timestamp = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const message = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    const entry = { time: timestamp, level, message };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
}

console.log = (...args) => {
    originalLog(...args);
    pushLog("INFO", ...args);
};
console.error = (...args) => {
    originalError(...args);
    pushLog("ERROR", ...args);
};
console.warn = (...args) => {
    originalError(...args);
    pushLog("WARN", ...args);
};

// ============================================================
// 🌐 HTTP SERVER
// ============================================================
function startDashboard(client) {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);

        // --- Phục vụ trang HTML chính ---
        if (req.method === "GET" && url.pathname === "/") {
            const htmlPath = path.join(__dirname, "dashboard.html");
            if (fs.existsSync(htmlPath)) {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(fs.readFileSync(htmlPath));
            } else {
                res.writeHead(404);
                res.end("Không tìm thấy dashboard.html");
            }
            return;
        }

        // --- API: Lấy log ---
        if (req.method === "GET" && url.pathname === "/api/logs") {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(logBuffer.slice(-200)));
            return;
        }

        // --- API: Lấy thống kê tổng quan ---
        if (req.method === "GET" && url.pathname === "/api/stats") {
            try {
                const db = loadDB();
                const users = db.users || {};
                const userCount = Object.keys(users).length;
                const totalMoney = Object.values(users).reduce((s, u) => s + (u.money || 0), 0);
                const totalBank = Object.values(users).reduce((s, u) => s + (u.bank || 0), 0);
                const topUsers = Object.entries(users)
                    .map(([id, u]) => ({ id, points: u.points || 0, money: u.money || 0 }))
                    .sort((a, b) => b.points - a.points)
                    .slice(0, 5);

                const botOnline = client && client.isReady();
                const uptime = botOnline ? Math.floor(client.uptime / 1000) : 0;

                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({
                    botOnline,
                    uptime,
                    userCount,
                    totalMoney,
                    totalBank,
                    topUsers,
                    botTag: botOnline ? client.user.tag : "N/A",
                    guildCount: botOnline ? client.guilds.cache.size : 0,
                    channelCount: botOnline ? client.channels.cache.size : 0,
                    ping: botOnline ? client.ws.ping : -1,
                    logCount: logBuffer.length
                }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // --- API: Gửi lệnh /mn (Chào buổi sáng) ---
        if (req.method === "POST" && url.pathname === "/api/mn") {
            try {
                console.log("[DASHBOARD] 🌅 Đã kích hoạt lệnh /mn từ bảng điều khiển!");
                await sendServerGreeting(client, "chào buổi sáng mới thức dậy, giục giã mọi người tỉnh táo để đi làm/đi học, giọng điệu vui vẻ, tràn đầy năng lượng, kèm lời chúc một ngày mới tốt lành.");
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true, message: "✅ Đã gửi lời chào buổi sáng!" }));
            } catch (e) {
                console.error("[DASHBOARD] Lỗi gửi /mn:", e.message);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // --- API: Gửi lệnh /gn (Chúc ngủ ngon) ---
        if (req.method === "POST" && url.pathname === "/api/gn") {
            try {
                console.log("[DASHBOARD] 🌙 Đã kích hoạt lệnh /gn từ bảng điều khiển!");
                await sendServerGreeting(client, "chúc cả server ngủ ngon khi đêm đã muộn, cằn nhằn bắt mọi người tắt máy điện thoại đi ngủ sớm đi kẻo hại sức khỏe, tỏ vẻ không quan tâm nhưng thực chất là đang lo lắng cho họ.");
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true, message: "✅ Đã gửi lời chúc ngủ ngon!" }));
            } catch (e) {
                console.error("[DASHBOARD] Lỗi gửi /gn:", e.message);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // --- API: Xóa log ---
        if (req.method === "POST" && url.pathname === "/api/clear-logs") {
            logBuffer.length = 0;
            console.log("[DASHBOARD] 🧹 Log đã được xóa sạch từ bảng điều khiển.");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // --- API: Gửi thông báo tùy chỉnh tới kênh ---
        if (req.method === "POST" && url.pathname === "/api/announce") {
            let body = "";
            req.on("data", chunk => body += chunk);
            req.on("end", async () => {
                try {
                    const { message } = JSON.parse(body);
                    if (!message || message.trim().length === 0) {
                        res.writeHead(400);
                        return res.end(JSON.stringify({ success: false, error: "Nội dung không được để trống!" }));
                    }
                    const config = require("./config.js");
                    const channel = await client.channels.fetch(config.ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
                    if (channel) {
                        await channel.send(`📢 **[THÔNG BÁO TỪ ADMIN]**\n${message.trim()}`);
                        console.log(`[DASHBOARD] 📢 Admin đã gửi thông báo: "${message.trim()}"`);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ success: true, message: "✅ Đã gửi thông báo vào kênh!" }));
                    } else {
                        res.writeHead(404);
                        res.end(JSON.stringify({ success: false, error: "Không tìm thấy kênh thông báo!" }));
                    }
                } catch (e) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }

        // --- API: Lấy danh sách người dùng ---
        if (req.method === "GET" && url.pathname === "/api/users") {
            try {
                const db = loadDB();
                const users = Object.entries(db.users || {}).map(([id, u]) => ({
                    id,
                    money: u.money || 0,
                    bank: u.bank || 0,
                    points: u.points || 0,
                    inv: (u.inv || []).length,
                    loanActive: u.loan?.status === "active",
                    banned: !!(u.disabled_until && u.disabled_until > Date.now())
                }));
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(users));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // --- API: [TÍNH NĂNG MỚI] Thống kê cân bằng kinh tế (Câu cá / Danh hiệu VIP) ---
        if (req.method === "GET" && url.pathname === "/api/economy") {
            try {
                const db = loadDB();
                const users = db.users || {};
                const economy = db.economy || { total_sink: 0, total_fishing_income: 0, total_fish_caught: 0 };

                const totalCirculating = Object.values(users).reduce((s, u) => s + (u.money || 0) + (u.bank || 0), 0);
                const titleOwnersCount = {};
                Object.values(users).forEach(u => {
                    (u.titles || []).forEach(t => { titleOwnersCount[t] = (titleOwnersCount[t] || 0) + 1; });
                });

                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({
                    totalCirculating,
                    totalSink: economy.total_sink || 0,
                    totalFishingIncome: economy.total_fishing_income || 0,
                    totalFishCaught: economy.total_fish_caught || 0,
                    titleOwnersCount,
                    netFlow: (economy.total_fishing_income || 0) - (economy.total_sink || 0)
                }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // --- API: [TÍNH NĂNG MỚI] Nhật ký giao dịch + Cảnh báo bất thường (Quản trị & An toàn) ---
        if (req.method === "GET" && url.pathname === "/api/transactions") {
            try {
                const db = loadDB();
                const log = (db.transactionLog || []).slice(-50).reverse();
                const flaggedCount = (db.transactionLog || []).filter(t => t.flagged).length;

                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ log, flaggedCount }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // --- API: [TÍNH NĂNG MỚI] Lấy danh sách kênh text để Admin chọn gửi tin nhắn trên Dashboard ---
        if (req.method === "GET" && url.pathname === "/api/channels") {
            try {
                if (!client || !client.isReady()) {
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    return res.end(JSON.stringify([]));
                }
                const channels = [];
                client.guilds.cache.forEach(guild => {
                    guild.channels.cache.forEach(ch => {
                        // Chỉ lấy kênh dạng text (0 = GuildText, 5 = GuildAnnouncement) mà bot xem được
                        if ((ch.type === 0 || ch.type === 5) && ch.viewable) {
                            channels.push({ id: ch.id, name: ch.name, guildName: guild.name });
                        }
                    });
                });
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(channels));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // --- API: [TÍNH NĂNG MỚI] Gửi tin nhắn tới kênh do Admin tự chọn trên Dashboard ---
        if (req.method === "POST" && url.pathname === "/api/send-channel-message") {
            let body = "";
            req.on("data", chunk => body += chunk);
            req.on("end", async () => {
                try {
                    const { channelId, message } = JSON.parse(body);
                    if (!channelId) {
                        res.writeHead(400);
                        return res.end(JSON.stringify({ success: false, error: "Vui lòng chọn kênh muốn gửi!" }));
                    }
                    if (!message || message.trim().length === 0) {
                        res.writeHead(400);
                        return res.end(JSON.stringify({ success: false, error: "Nội dung không được để trống!" }));
                    }
                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (!channel) {
                        res.writeHead(404);
                        return res.end(JSON.stringify({ success: false, error: "Không tìm thấy kênh đã chọn!" }));
                    }
                    await channel.send(message.trim());
                    console.log(`[DASHBOARD] 💬 Admin đã gửi tin nhắn tới kênh #${channel.name}: "${message.trim()}"`);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ success: true, message: `✅ Đã gửi tin nhắn vào #${channel.name}!` }));
                } catch (e) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }

        res.writeHead(404);
        res.end("Not Found");
    });

    const PORT = 3000;
    server.listen(PORT, "127.0.0.1", () => {
        console.log(`🖥️  [DASHBOARD] Bảng điều khiển đang chạy tại: http://localhost:${PORT}`);
        openDashboardInBrowser(PORT);
    });

    return server;
}

// ============================================================
// 🌐 TỰ ĐỘNG MỞ TRÌNH DUYỆT KHI BOT/DASHBOARD KHỞI ĐỘNG XONG
// ============================================================
function openDashboardInBrowser(port) {
    const url = `http://localhost:${port}`;
    const { exec } = require("child_process");

    let command;
    switch (process.platform) {
        case "win32":
            // "" là tiêu đề cửa sổ giả cho lệnh start trên Windows
            command = `start "" "${url}"`;
            break;
        case "darwin":
            command = `open "${url}"`;
            break;
        default:
            command = `xdg-open "${url}"`;
            break;
    }

    exec(command, (err) => {
        if (err) {
            console.error("[DASHBOARD] Không thể tự mở trình duyệt:", err.message);
        } else {
            console.log("[DASHBOARD] 🌐 Đã tự động mở dashboard trên trình duyệt.");
        }
    });
}

module.exports = { startDashboard };
