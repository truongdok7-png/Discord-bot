const fs = require("fs");

const DB_FILE = "./game_data.json";
const MEMORY_DIR = "./chat_memory"; 
const SHOP_REFRESH_TIME = 1800000; // 30 phút

const ALL_ITEMS = {
    "bánh_ngọt": { name: "Bánh Ngọt Dâu Tây 🍓🍰", price: 5000, points: 10 },
    "hoa": { name: "Bó Hoa Hồng Mới Nở 🌹💐", price: 2500, points: 5 },
    "đá": { name: "Cục Đá Cuội Lấp Lánh 🪨", price: 300, points: -1 },
    "kẹo_mút": { name: "Kẹo Mút Chupa Chups 🍭", price: 1000, points: 2 },
    "trà_sữa": { name: "Trà Sữa Đường Đen 🧋", price: 3500, points: 7 },
    "nước_hoa": { name: "Nước Hoa Pháp Cao Cấp 🧪", price: 8000, points: 15 },
    "sách_nấu_ăn": { name: "Sách Công Thức Làm Bánh 📖", price: 6000, points: 12 },
    "băng_đô": { name: "Băng Đô Tai Thỏ Đáng Yêu 🐰", price: 12000, points: 25 },
    "the_reset": { name: "Thẻ Reset Chỉ Số Toàn Diện 🚨", price: 30000, points: 0 }
};

function loadUserMemory(userId) {
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    const filePath = `${MEMORY_DIR}/${userId}.json`;
    if (!fs.existsSync(filePath)) return [];
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
        return [];
    }
}

function saveUserMemory(userId, memory) {
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    const filePath = `${MEMORY_DIR}/${userId}.json`;
    const limitedMemory = memory.slice(-25);
    fs.writeFileSync(filePath, JSON.stringify(limitedMemory, null, 2));
}

function getAffectionRank(points) {
    if (points < 200) return "👥 Xa lạ (Stranger)";
    if (points < 600) return "💬 Quen biết (Acquaintance)";
    if (points < 1500) return "🤝 Bạn bè thân thiết (Close Friend)";
    if (points < 3500) return "💓 Cảm mến / Crush";
    return "💖 Hẹn hò / Yêu thương (Lover)";
}

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, shop: { current_items: [], next_refresh: 0 } }, null, 2));
    }
    let data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    if (!data.shop) data.shop = { current_items: [], next_refresh: 0 };
    return data;
}

function saveDB(data) { 
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); 
}

function checkAndRefreshShop(db) {
    const now = Date.now();
    if (now > db.shop.next_refresh) {
        const availableKeys = Object.keys(ALL_ITEMS).filter(k => k !== 'the_reset');
        const shuffled = availableKeys.sort(() => 0.5 - Math.random());
        db.shop.current_items = shuffled.slice(0, 3);
        db.shop.next_refresh = now + SHOP_REFRESH_TIME;
        saveDB(db);
    }
}

// =============================================
// 🏦 HÀM TÍNH LÃI SUẤT NGÂN HÀNG 5%/NGÀY
// Lãi tính theo thời gian thực, kể cả khi bot offline.
// Sử dụng lãi kép (compound interest) theo công thức:
//   Số tiền cuối = bank * (1.05)^(số ngày đã trôi qua)
// =============================================
const BANK_INTEREST_RATE = 0.05; // 5% mỗi ngày
const MS_PER_DAY = 86400000;     // 1 ngày = 86,400,000 ms

/**
 * Tính và cộng lãi suất vào tài khoản ngân hàng của user.
 * Gọi hàm này TRƯỚC MỌI thao tác liên quan đến bank (deposit/withdraw/xem số dư).
 * @param {object} user - Đối tượng user trong db.users[uid]
 * @returns {{ interest: number, days: number }} - Lãi vừa cộng thêm và số ngày tính
 */
function applyBankInterest(user) {
    if (!user.bank || user.bank <= 0) return { interest: 0, days: 0 };
    if (!user.bank_last_interest) {
        // Lần đầu tiên: khởi tạo mốc thời gian = hiện tại, không tính lãi
        user.bank_last_interest = Date.now();
        return { interest: 0, days: 0 };
    }

    const now = Date.now();
    const elapsed = now - user.bank_last_interest;
    // Tính số ngày (có thể là số thập phân, ví dụ 0.5 ngày = 12 giờ)
    const daysElapsed = elapsed / MS_PER_DAY;

    if (daysElapsed < 0.0001) return { interest: 0, days: 0 }; // Chưa đủ thời gian

    // Lãi kép: bank * (1 + rate)^days - bank
    const newBank = Math.floor(user.bank * Math.pow(1 + BANK_INTEREST_RATE, daysElapsed));
    const interest = newBank - user.bank;

    if (interest > 0) {
        user.bank = newBank;
        user.bank_last_interest = now;
    }

    return { interest, days: daysElapsed };
}

function checkLoanStatus(userId, db) {
    const user = db.users[userId];
    if (!user) return false;

    if (user.disabled_until && Date.now() >= user.disabled_until) {
        if (user.reset_money_after_ban) {
            user.money = 1000;
            user.reset_money_after_ban = false;
        }
        user.disabled_until = 0;
        saveDB(db);
    }

    if (user.disabled_until && Date.now() < user.disabled_until) {
        return true; 
    }

    if (user.loan && user.loan.status === 'active') {
        if (Date.now() - user.loan.borrowed_at > 600000) {
            // [TÍNH NĂNG MỚI] Nếu user đã mua Bảo Hiểm Tín Dụng Đen (/baohiem), tiêu hao bảo hiểm để miễn hình phạt lần này
            if (user.insurance) {
                user.insurance = false;
                user.loan.status = 'none';
                logTransaction(db, { type: 'baohiem_used', uid: userId, amount: 0, detail: 'Bảo hiểm đã cứu bạn khỏi bị tẩn nợ quá hạn!' });
                saveDB(db);
                return false;
            }
            user.money = 0;
            user.disabled_until = Date.now() + 86400000; 
            user.reset_money_after_ban = true;
            user.loan.status = 'none';
            saveDB(db);
            return true;
        }
    }
    return false;
}

module.exports = {
    MEMORY_DIR,
    ALL_ITEMS,
    BANK_INTEREST_RATE,
    loadUserMemory,
    saveUserMemory,
    getAffectionRank,
    loadDB,
    saveDB,
    checkAndRefreshShop,
    checkLoanStatus,
    applyBankInterest
};

// =============================================
// 🎣 [TÍNH NĂNG MỚI] HỆ THỐNG CÂU CÁ — KIẾM TIỀN
// 🏷️ [TÍNH NĂNG MỚI] HỆ THỐNG DANH HIỆU VIP — TIÊU TIỀN (MONEY SINK)
// Mục đích: cân bằng lại lượng tiền lưu thông trong server, hạn chế lạm phát.
// =============================================

// Bảng cá có thể câu được, kèm tỉ lệ ra (weight) và giá trị bán (Yên).
// Cá hiếm có giá trị cao nhưng tỉ lệ ra thấp -> giữ thu nhập trung bình ổn định, không bơm tiền ồ ạt.
const FISH_TABLE = [
    { key: "ca_rô",      name: "Cá Rô Nhỏ 🐟",          weight: 40, price: 400 },
    { key: "ca_chep",    name: "Cá Chép Vàng 🐠",        weight: 28, price: 900 },
    { key: "tom",        name: "Tôm Càng Xanh 🦐",       weight: 15, price: 1500 },
    { key: "muc",        name: "Mực Ống Tươi 🦑",        weight: 10, price: 2600 },
    { key: "ca_map_mini",name: "Cá Mập Con Hiếm 🦈",     weight: 4,  price: 6000 },
    { key: "rac",        name: "Rác Trôi Sông 🥾",        weight: 3,  price: 0 } // câu hụt, không có thu nhập -> hãm tốc độ bơm tiền
];
const FISH_COOLDOWN_MS = 600000; // 10 phút / lượt câu cá

function rollFish() {
    const totalWeight = FISH_TABLE.reduce((s, f) => s + f.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const fish of FISH_TABLE) {
        if (roll < fish.weight) return fish;
        roll -= fish.weight;
    }
    return FISH_TABLE[0];
}

// Danh hiệu VIP — vật phẩm cosmetic vĩnh viễn, giá tăng dần theo cấp để hút tiền dư trong nền kinh tế.
// Mua danh hiệu KHÔNG cộng thêm điểm thân mật lặp lại được (chỉ +1 lần duy nhất khi mua) để tránh bị lợi dụng farm điểm.
const TITLE_SHOP = [
    { key: "title_tapsu",     name: "🔰 Tập Sự",            price: 10000,  onceAffection: 1, color: "#95a5a6" },
    { key: "title_thanthiet", name: "🌸 Thân Thiết",         price: 35000,  onceAffection: 2, color: "#f472b6" },
    { key: "title_tincau",    name: "💎 Tín Cẩn",            price: 90000,  onceAffection: 3, color: "#60a5fa" },
    { key: "title_dacbiet",   name: "👑 Người Đặc Biệt",      price: 220000, onceAffection: 5, color: "#fbbf24" },
    { key: "title_doiNino",   name: "💍 Danh Hiệu Đặc Biệt Của Nino", price: 500000, onceAffection: 8, color: "#c084fc" }
];

function getOwnedTitleObjects(user) {
    const owned = user.titles || [];
    return TITLE_SHOP.filter(t => owned.includes(t.key));
}

// Đảm bảo các trường dữ liệu mới luôn tồn tại trên user & trên db, không ảnh hưởng tới field cũ.
function ensureNewFeatureFields(db, user) {
    if (!db.economy) {
        db.economy = { total_sink: 0, total_fishing_income: 0, total_fish_caught: 0 };
    }
    if (!db.market) db.market = { listings: [] };
    if (!db.transactionLog) db.transactionLog = [];
    if (!user.titles) user.titles = [];
    if (user.last_fish === undefined) user.last_fish = 0;
    if (!user.rareItems) user.rareItems = [];
    if (user.last_kham === undefined) user.last_kham = 0;
    if (user.total_rare_found === undefined) user.total_rare_found = 0;
    if (user.fish_caught === undefined) user.fish_caught = 0;
    if (!user.first_interaction_at) user.first_interaction_at = Date.now();
    if (user.last_transfer === undefined) user.last_transfer = 0;
    // [TÍNH NĂNG MỚI] Bảo Hiểm Tín Dụng Đen (/baohiem) — money sink mới
    if (user.insurance === undefined) user.insurance = false;
}

module.exports.FISH_TABLE = FISH_TABLE;
module.exports.FISH_COOLDOWN_MS = FISH_COOLDOWN_MS;
module.exports.rollFish = rollFish;
module.exports.TITLE_SHOP = TITLE_SHOP;
module.exports.getOwnedTitleObjects = getOwnedTitleObjects;
module.exports.ensureNewFeatureFields = ensureNewFeatureFields;

// =============================================
// 🗺️ [TÍNH NĂNG MỚI] HỆ THỐNG THÁM HIỂM — ĐỒ HIẾM RANDOM (AI quyết định tên/mô tả)
// 🛒 [TÍNH NĂNG MỚI] CHỢ TRỜI — MUA BÁN / TRAO ĐỔI VẬT PHẨM GIỮA NGƯỜI CHƠI
// 🏅 [TÍNH NĂNG MỚI] HUY HIỆU THÀNH TÍCH — tính sống, không lưu trữ riêng
// 📒 [TÍNH NĂNG MỚI] NHẬT KÝ GIAO DỊCH cho Dashboard
// =============================================

// Độ hiếm được CODE kiểm soát giá + tỉ lệ tăng giá/ngày (AI chỉ được gợi ý % trong khung này để tạo đa dạng).
// Đồ hiếm hơn -> khung % tăng giá mỗi ngày cao hơn -> khuyến khích giữ lâu để "đầu tư".
const RARITY_TIERS = [
    { key: "common",    label: "⚪ Thường",    weight: 50, priceMin: 500,   priceMax: 1500,  growthMin: 0.001, growthMax: 0.004 },
    { key: "rare",      label: "🔵 Hiếm",      weight: 30, priceMin: 1500,  priceMax: 4000,  growthMin: 0.004, growthMax: 0.010 },
    { key: "epic",      label: "🟣 Cực Hiếm",  weight: 15, priceMin: 4000,  priceMax: 9000,  growthMin: 0.010, growthMax: 0.020 },
    { key: "legendary", label: "🟡 Huyền Thoại",weight: 5,  priceMin: 9000,  priceMax: 25000, growthMin: 0.020, growthMax: 0.035 }
];
const KHAMPHA_COOLDOWN_MS = 1800000; // 30 phút / lượt thám hiểm
const ITEM_GROWTH_CAP_DAYS = 60;      // tính lãi gộp tối đa 60 ngày giữ đồ, tránh giá trị tăng vô hạn nếu giữ quá lâu
const ITEM_GROWTH_CAP_MULTIPLIER = 5; // dù tính sao cũng KHÔNG vượt quá 5x giá trị gốc — hàng rào an toàn chống lạm phát
const NPC_SELL_RATE = 0.65;           // bán ngay cho Tiệm Đồ Cổ (NPC) chỉ nhận 65% giá trị hiện tại, đổi lại có tiền ngay không cần chờ người mua

// Tính giá trị HIỆN TẠI của 1 đồ hiếm dựa trên thời gian đã giữ + % tăng giá/ngày được gắn lúc tìm ra.
function getCurrentItemValue(item) {
    const rate = item.growthRatePerDay || 0;
    const daysHeld = (Date.now() - (item.foundAt || Date.now())) / 86400000;
    const effectiveDays = Math.min(daysHeld, ITEM_GROWTH_CAP_DAYS);
    const grown = item.price * Math.pow(1 + rate, effectiveDays);
    const capped = Math.min(grown, item.price * ITEM_GROWTH_CAP_MULTIPLIER);
    return Math.max(item.price, Math.round(capped)); // không bao giờ thấp hơn giá gốc lúc tìm được
}

function rollRarity() {
    const totalWeight = RARITY_TIERS.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const tier of RARITY_TIERS) {
        if (roll < tier.weight) return tier;
        roll -= tier.weight;
    }
    return RARITY_TIERS[0];
}

function genItemId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Huy hiệu thành tích — KHÔNG cộng tiền/điểm, chỉ mang tính sưu tầm/khẳng định, tính trực tiếp từ dữ liệu hiện có.
const BADGE_DEFS = [
    { key: "badge_first_chat", name: "🌱 Người Mới", check: (user, chatCount) => chatCount > 0 },
    { key: "badge_close",      name: "🤝 Bạn Thân",  check: (user) => (user.points || 0) >= 600 },
    { key: "badge_crush",      name: "💓 Crush",      check: (user) => (user.points || 0) >= 1500 },
    { key: "badge_lover",      name: "💖 Người Yêu",  check: (user) => (user.points || 0) >= 3500 },
    { key: "badge_fisherman",  name: "🎣 Cần Thủ",    check: (user) => (user.fish_caught || 0) >= 10 },
    { key: "badge_explorer",   name: "🗺️ Nhà Thám Hiểm", check: (user) => (user.total_rare_found || 0) >= 5 },
    { key: "badge_collector",  name: "🏷️ Sưu Tầm Gia", check: (user) => (user.titles || []).length >= 3 },
    { key: "badge_rich",       name: "💰 Đại Gia",    check: (user) => ((user.money || 0) + (user.bank || 0)) >= 100000 }
];

function getEarnedBadges(user, chatCount) {
    return BADGE_DEFS.filter(b => b.check(user, chatCount));
}

// Ghi nhật ký giao dịch — phục vụ Dashboard (mục Quản trị & An toàn), giới hạn 300 dòng gần nhất.
const BIG_TRANSACTION_THRESHOLD = 50000; // giao dịch >= mức này sẽ được đánh dấu cảnh báo cho Admin chú ý
function logTransaction(db, { type, uid, amount = 0, detail = "" }) {
    if (!db.transactionLog) db.transactionLog = [];
    db.transactionLog.push({
        time: Date.now(),
        type, uid, amount, detail,
        flagged: Math.abs(amount) >= BIG_TRANSACTION_THRESHOLD
    });
    if (db.transactionLog.length > 300) db.transactionLog.shift();
}

module.exports.RARITY_TIERS = RARITY_TIERS;
module.exports.KHAMPHA_COOLDOWN_MS = KHAMPHA_COOLDOWN_MS;
module.exports.rollRarity = rollRarity;
module.exports.genItemId = genItemId;
module.exports.BADGE_DEFS = BADGE_DEFS;
module.exports.getEarnedBadges = getEarnedBadges;
module.exports.logTransaction = logTransaction;
module.exports.BIG_TRANSACTION_THRESHOLD = BIG_TRANSACTION_THRESHOLD;
module.exports.getCurrentItemValue = getCurrentItemValue;
module.exports.NPC_SELL_RATE = NPC_SELL_RATE;

// =============================================
// 🛡️ [TÍNH NĂNG MỚI] BẢO HIỂM TÍN DỤNG ĐEN — /baohiem (Money Sink)
// 🎨 [TÍNH NĂNG MỚI] ĐỔI MÀU TÊN HIỂN THỊ — /doimau (Money Sink)
// Mục đích: thêm 2 hố tiêu tiền mới, không ảnh hưởng tới hệ thống cũ.
// =============================================
const INSURANCE_PRICE = 8000;  // Giá mua 1 lượt Bảo Hiểm Tín Dụng Đen (miễn 1 lần bị "tẩn" do nợ quá hạn Tài Xỉu)
const DOIMAU_PRICE = 7000;     // Giá mỗi lần đổi màu tên hiển thị (role Discord cá nhân)

module.exports.INSURANCE_PRICE = INSURANCE_PRICE;
module.exports.DOIMAU_PRICE = DOIMAU_PRICE;