const fs = require("fs");
const config = require("./config.js");
const { groq } = require("./ai");

function startAutomatedGreetings(client) {
    let morningTriggered = false;
    let nightTriggered = false;

    setInterval(async () => {
        const vnOptions = { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false };
        const timeString = new Intl.DateTimeFormat('vi-VN', vnOptions).format(new Date());
        const [hour, minute] = timeString.split(':').map(Number);

        // ☀️ Chào buổi sáng lúc 07:00 AM
        if (hour === 7 && minute === 0) {
            if (!morningTriggered) {
                morningTriggered = true;
                await sendServerGreeting(client, "chào buổi sáng mới thức dậy, giục giã mọi người tỉnh táo để đi làm/đi học, giọng điệu vui vẻ, tràn đầy năng lượng, kèm lời chúc một ngày mới tốt lành.");
            }
        } else {
            if (hour !== 7) morningTriggered = false; 
        }

        // 🌙 Chúc ngủ ngon lúc 22:00 PM
        if (hour === 22 && minute === 0) {
            if (!nightTriggered) {
                nightTriggered = true;
                await sendServerGreeting(client, "chúc cả server ngủ ngon khi đêm đã muộn, cằn nhằn bắt mọi người tắt máy điện thoại đi ngủ sớm đi kẻo hại sức khỏe, tỏ vẻ không quan tâm nhưng thực chất là đang lo lắng cho họ.");
            }
        } else {
            if (hour !== 22) nightTriggered = false;
        }
    }, 60000); 
}

async function sendServerGreeting(client, themeContext) {
    const channel = await client.channels.fetch(config.ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
    if (!channel) return console.log(`[HỆ THỐNG GREETING] Không tìm thấy channel ID: ${config.ANNOUNCEMENT_CHANNEL_ID}`);

    const lore = fs.existsSync("./lore.txt") ? fs.readFileSync("./lore.txt", "utf8") : "Bạn là Nino, một trợ lý AI thân thiện.";
    const systemPrompt = `${lore}\n\nNhiệm vụ: Hãy viết một lời thông báo gửi đến toàn thể thành viên trong server Discord. Ngữ cảnh: ${themeContext}\n Quy tắc: Không kèm bất kỳ ký hiệu điểm số hệ thống, không chứa code, viết tự nhiên, thân thiện.`;

    try {
        const response = await groq.chat.completions.create({
            model: config.MODEL,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Hãy phát biểu lời chào/chúc của bạn tới mọi người." }],
            temperature: 0.85
        });
        const greetingText = response.choices[0].message.content.trim();
        await channel.send(`` + greetingText);
    } catch (err) {
        console.error("Lỗi khi tạo lời chào tự động từ Groq AI:", err);
    }
}

module.exports = { startAutomatedGreetings, sendServerGreeting };