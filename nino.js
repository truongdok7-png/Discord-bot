const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require("fs");
const config = require("./config.js");
const commandsList = require("./commands");
const { startAutomatedGreetings } = require("./cron");
const { askAI, groq } = require("./ai");
const { handleInteraction } = require("./interaction");
const { MEMORY_DIR, loadDB, saveDB, saveUserMemory, checkLoanStatus, TITLE_SHOP, ensureNewFeatureFields } = require("./database");
const { startDashboard } = require("./dashboard");

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers // [TÍNH NĂNG MỚI] Cần để nhận event guildMemberAdd cho lời chào mừng thành viên mới
    ] 
});

// ==========================================
// 🖥️ KHỞI ĐỘNG BẢNG ĐIỀU KHIỂN WEB
// Truy cập tại: http://localhost:3000
// ==========================================
startDashboard(client);

// ==========================================
// 🏷️ [TÍNH NĂNG MỚI] TỰ ĐỘNG TẠO ROLE DANH HIỆU TRONG SERVER
// Mỗi danh hiệu trong Cửa Hàng Danh Hiệu VIP sẽ tương ứng với 1 role Discord.
// Nếu role chưa tồn tại trong server, bot sẽ tự tạo (cần quyền "Manage Roles").
// ID role được lưu lại trong game_data.json (db.titleRoleIds) để dùng khi gán cho người mua.
// ==========================================
async function ensureTitleRoles(client) {
    const db = loadDB();
    if (!db.titleRoleIds) db.titleRoleIds = {};

    for (const guild of client.guilds.cache.values()) {
        for (const title of TITLE_SHOP) {
            const roleName = title.name.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
            const mapKey = `${guild.id}_${title.key}`;

            let role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) {
                try {
                    role = await guild.roles.create({
                        name: roleName,
                        color: title.color || null,
                        mentionable: false,
                        reason: "Tự động tạo role Danh Hiệu VIP cho Nino Bot"
                    });
                    console.log(`🏷️ [ROLE] Đã tạo role mới "${roleName}" tại server "${guild.name}".`);
                } catch (err) {
                    console.error(`❌ [ROLE] Không thể tạo role "${roleName}" tại "${guild.name}": ${err.message} (Kiểm tra lại quyền "Manage Roles" của bot!)`);
                    continue;
                }
            }
            db.titleRoleIds[mapKey] = role.id;
        }
    }
    saveDB(db);
}

// ==========================================
// 🚀 KHỞI TẠO BOT & ĐĂNG KÝ LỆNH SLASH
// ==========================================
client.once('ready', async () => {
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }

    const rest = new REST({ version: '10' }).setToken(config.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: commandsList });
        console.log("🤖 Nino Bot v3.6 đã sẵn sàng vận hành!");
        console.log(`🖥️  Dashboard đang chạy tại: http://localhost:3000`);
        console.log(`📡 Bot tag: ${client.user.tag}`);
        console.log(`🏠 Đang phục vụ ${client.guilds.cache.size} server(s)`);
    } catch (error) {
        console.error("Lỗi khi đăng ký Slash Commands:", error);
    }

    // [TÍNH NĂNG MỚI] Tự động tạo role Danh Hiệu VIP nếu chưa có trong server
    await ensureTitleRoles(client);
    
    // Kích hoạt bộ thời gian tự động chào sáng / chúc tối
    startAutomatedGreetings(client);
});

// ==========================================
// ⚙️ XỬ LÝ LỆNH INTERACTION GAME
// ==========================================
client.on('interactionCreate', async (interaction) => {
    await handleInteraction(interaction, client);
});

// ==========================================
// 💬 XỬ LÝ TIN NHẮN CHAT TỰ ĐỘNG
// ==========================================
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    
    let db = loadDB();
    const uid = message.author.id;

    if (!db.users[uid]) {
        db.users[uid] = { points: 0, money: 0, bank: 0, bank_last_interest: Date.now(), inv: [], last_daily: 0, loan: { status: 'none', borrowed_at: 0, last_borrowed: 0 }, disabled_until: 0, reset_money_after_ban: false };
    }
    ensureNewFeatureFields(db, db.users[uid]); // [TÍNH NĂNG MỚI]

    if (message.content === "!clear") { 
        saveUserMemory(message.author.id, []); 
        return message.reply("🧹 Lịch sử chat bộ nhớ bền vững trên file JSON của bạn đã dọn dẹp sạch sẽ."); 
    }

    const isDM = message.channel.isDMBased();
    let shouldReply = false;

    if (isDM) {
        shouldReply = true; 
    } else if (message.mentions.has(client.user)) {
        shouldReply = true;
    } else if (message.content.toLowerCase().includes('nino')) {
        shouldReply = true;
    } else {
        const randomChance = Math.random(); 
        if (randomChance < 0.00003) { 
            shouldReply = true;
            console.log(`[NINO INTERRUPT] Đã kích hoạt xen vào cuộc chuyện của ${message.author.username}`);
        }
    }

    if (!shouldReply) return;

    const isBanned = checkLoanStatus(uid, db);
    if (isBanned) {
        return message.reply("💥 **[LUẬT SÒNG BẠC]** Biến đi chỗ khác! *(Bạn đang bị đóng băng tính năng 24h do nợ quá hạn)*.");
    }

    await message.channel.sendTyping();
    const answer = await askAI(message.content, message.author.id, message.member?.displayName || message.author.username);
    
    if (answer.length > 2000) {
        await message.reply(answer.slice(0, 1950) + "\n*(Tin nhắn quá dài nên mình cắt bớt nha...)*");
    } else {
        await message.reply(answer);
    }
});

// ==========================================
// 👋 [TÍNH NĂNG MỚI] TỰ ĐỘNG CHÀO MỪNG THÀNH VIÊN MỚI
// Gửi vào kênh ID: 1450562451979370676
// Cần Intent "Server Members Intent" (bật trong Discord Developer Portal) + GatewayIntentBits.GuildMembers
// ==========================================
const WELCOME_CHANNEL_ID = "1450562451979370676";

client.on('guildMemberAdd', async (member) => {
    try {
        const channel = await client.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
        if (!channel) {
            console.error(`❌ [WELCOME] Không tìm thấy kênh ID ${WELCOME_CHANNEL_ID}. Kiểm tra lại ID hoặc quyền xem kênh của bot.`);
            return;
        }

        const welcomePrompt = `Bạn là Nino, một trợ lý AI thân thiện, hãy viết 1 lời chào mừng ngắn (dưới 40 từ) cho thành viên mới tên "${member.displayName || member.user.username}" vừa vào server. Giữ giọng điệu vui vẻ, ấm áp, thân thiện. Không dùng dấu **, không nhắc tới điểm số hay hệ thống. Chỉ trả lời đúng nội dung lời chào, không thêm gì khác.`;

        let welcomeText = `Chào mừng ${member.displayName || member.user.username} đã đến với server nhé! Rất vui được gặp bạn.`;
        try {
            const response = await groq.chat.completions.create({
                model: config.MODEL,
                messages: [{ role: "user", content: welcomePrompt }],
                temperature: 0.9
            });
            welcomeText = response.choices[0].message.content.trim();
        } catch (err) {
            console.error("Lỗi tạo lời chào mừng từ AI:", err.message);
        }

        await channel.send(`👋 ${member} ${welcomeText}`);
    } catch (err) {
        console.error("Lỗi gửi lời chào mừng thành viên mới:", err.message);
    }
});

client.login(config.TOKEN);
