// config.js
// Đọc cấu hình từ file .env thay vì config.json (để không lộ TOKEN/API KEY khi đưa code lên Github)
require("dotenv").config();

const config = {
  TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  MODEL: process.env.MODEL,
  ANNOUNCEMENT_CHANNEL_ID: process.env.ANNOUNCEMENT_CHANNEL_ID,
};

// Kiểm tra nhanh, cảnh báo nếu thiếu biến bắt buộc trong .env
const required = ["TOKEN", "CLIENT_ID", "GROQ_API_KEY"];
for (const key of required) {
  if (!config[key]) {
    console.warn(`⚠️  [CONFIG] Thiếu biến môi trường cho "${key}" trong file .env`);
  }
}

module.exports = config;
