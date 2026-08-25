const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require("fs");
const config = require("./config.js");
const { groq } = require("./ai");
const { sendServerGreeting } = require("./cron");
const { 
    ALL_ITEMS, BANK_INTEREST_RATE, loadUserMemory, saveUserMemory, getAffectionRank, 
    loadDB, saveDB, checkAndRefreshShop, checkLoanStatus, applyBankInterest,
    FISH_TABLE, FISH_COOLDOWN_MS, rollFish, TITLE_SHOP, getOwnedTitleObjects, ensureNewFeatureFields,
    RARITY_TIERS, KHAMPHA_COOLDOWN_MS, rollRarity, genItemId, BADGE_DEFS, getEarnedBadges, logTransaction,
    getCurrentItemValue, NPC_SELL_RATE, INSURANCE_PRICE, DOIMAU_PRICE
} = require("./database");

const COOLDOWN_TIME = 300000;       // 5 phút làm việc
const DATE_COOLDOWN_TIME = 3600000; // 1 tiếng đi chơi

const workCooldowns = new Map();
const dateCooldowns = new Map();
const activeDates = new Map(); 

// ====== [TÍNH NĂNG MỚI] Nhắc nhở qua DM khi cooldown lệnh đã hết ======
function scheduleCooldownReminder(discordUser, cooldownMs, label) {
    setTimeout(async () => {
        try {
            await discordUser.send(`⏰ **[NHẮC NHỞ]** Lệnh \`${label}\` của bạn đã hồi xong, dùng lại được rồi nè!`);
        } catch (err) {
            // Người dùng tắt DM hoặc đã chặn bot, bỏ qua không cần báo lỗi.
        }
    }, cooldownMs);
}

async function handleInteraction(interaction, client) {
    let db = loadDB();
    const uid = interaction.user.id;
    
    if (!db.users[uid]) {
        db.users[uid] = { 
            points: 0, 
            money: 0, 
            bank: 0, 
            bank_last_interest: Date.now(),
            inv: [], 
            last_daily: 0, 
            loan: { status: 'none', borrowed_at: 0, last_borrowed: 0 }, 
            disabled_until: 0, 
            reset_money_after_ban: false 
        };
    }

    // [TÍNH NĂNG MỚI] Đảm bảo các trường dữ liệu mới (titles, rareItems, first_interaction_at...) luôn có sẵn ngay từ lần tương tác đầu tiên
    ensureNewFeatureFields(db, db.users[uid]);

    // 🏦 Tự động cộng lãi suất ngân hàng 5%/ngày theo thời gian thực (kể cả khi bot offline)
    applyBankInterest(db.users[uid]);
    saveDB(db);

    const isBanned = checkLoanStatus(uid, db);
    if (isBanned) {
        const remaining = db.users[uid].disabled_until - Date.now();
        const hours = Math.floor(remaining / 3600000);
        const mins = Math.floor((remaining % 3600000) / 60000);
        const banMessage = `❌ **[HỆ THỐNG PHẠT - LUẬT GIANG HỒ]** Bạn đã bùng tiền nợ của Băng Đảng quá 10 phút! Đại ca đã sai đàn em hung tợn đến "tẩn" bạn một trận nhừ tử và tịch thu toàn bộ tài sản trong ví. Hệ thống sòng bài đã khóa, quay lại sau \`${hours} giờ ${mins} phút\` để nhận \`1,000 Yên\` tiền bảo kê tái khởi nghiệp!`;
        
        if (interaction.deferred || interaction.replied) return interaction.followUp({ content: banMessage, ephemeral: true });
        return interaction.reply({ content: banMessage, ephemeral: true });
    }

    // --- 🛠️ MENU CHỌN QUÀ ---
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'gift_select_menu') {
            const itemKey = interaction.values[0];
            const user = db.users[uid];
            const itemIndex = user.inv.indexOf(itemKey);

            if (itemIndex === -1) {
                return interaction.reply({ content: "❌ **[HỆ THỐNG]** Vật phẩm này không còn tồn tại trong ví đồ của bạn nữa!", ephemeral: true });
            }

            user.inv.splice(itemIndex, 1);
            const pointChange = ALL_ITEMS[itemKey] ? ALL_ITEMS[itemKey].points : 0.25;
            user.points += pointChange;
            saveDB(db);

            let ninoReaction = "Cảm ơn bạn nhiều nhé, mình rất thích món quà này!";
            if (itemKey === 'bánh_ngọt') ninoReaction = "Oa, cái này nhìn ngon quá! Cảm ơn bạn nha!";
            if (itemKey === 'đá') ninoReaction = "Ơ... cục đá này... cũng thú vị đấy, cảm ơn bạn đã nghĩ tới mình.";
            if (itemKey === 'băng_đô') ninoReaction = "Cái này xinh thật đấy, cảm ơn bạn nhiều nha! 👑";

            return interaction.reply({
                content: `🎁 ${interaction.user} đã mở túi đồ và tặng món quà **${ALL_ITEMS[itemKey]?.name || itemKey}** cho Nino!\n🎀 **Nino:** "${ninoReaction}"\n📊 **Điểm thân thiết hiện tại:** \`${user.points.toFixed(2)}\`đ (Mốc: \`${getAffectionRank(user.points)}\`)`
            });
        }
    }

    // --- NÚT BẤM (BUTTONS) ---
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('buy_')) {
            const itemKey = interaction.customId.replace('buy_', '');
            const targetItem = ALL_ITEMS[itemKey];

            checkAndRefreshShop(db);
            if (itemKey !== 'the_reset' && !db.shop.current_items.includes(itemKey)) {
                return interaction.reply({ content: "❌ **[HỆ THỐNG]** Vật phẩm này đã hết hạn bán hoặc shop đã đổi ca mới!", ephemeral: true });
            }

            if (db.users[uid].money < targetItem.price) {
                return interaction.reply({ content: `❌ **[HỆ THỐNG]** Số dư không đủ! Cần \`${targetItem.price} Yên\`.`, ephemeral: true });
            }

            db.users[uid].money -= targetItem.price;
            if (itemKey === 'the_reset') {
                db.users[uid] = { points: 0, money: 0, bank: 0, inv: [], last_daily: 0, loan: { status: 'none', borrowed_at: 0, last_borrowed: 0 }, disabled_until: 0, reset_money_after_ban: false };
                saveUserMemory(uid, []); 
                saveDB(db);
                return interaction.reply({ content: "🚨 **[HỆ THỐNG RESET]** Đã kích hoạt Thẻ Reset! Toàn bộ dữ liệu quay về số 0.", ephemeral: true });
            } else {
                db.users[uid].inv.push(itemKey);
                saveDB(db);
                return interaction.reply({ content: `🛒 **[HỆ THỐNG]** Đã mua thành công **${targetItem.name}**!`, ephemeral: true });
            }
        }

        if (interaction.customId.startsWith('title_buy_')) {
            const titleKey = interaction.customId.replace('title_buy_', '');
            const targetTitle = TITLE_SHOP.find(t => t.key === titleKey);
            const user = db.users[uid];
            ensureNewFeatureFields(db, user);

            if (!targetTitle) {
                return interaction.reply({ content: "❌ **[HỆ THỐNG]** Danh hiệu này không tồn tại!", ephemeral: true });
            }
            if (user.titles.includes(titleKey)) {
                return interaction.reply({ content: "❌ **[HỆ THỐNG]** Bạn đã sở hữu danh hiệu này rồi!", ephemeral: true });
            }
            if (user.money < targetTitle.price) {
                return interaction.reply({ content: `❌ **[HỆ THỐNG]** Số dư không đủ! Cần \`${targetTitle.price} Yên\`.`, ephemeral: true });
            }

            user.money -= targetTitle.price;
            user.titles.push(titleKey);
            user.points += targetTitle.onceAffection;
            db.economy.total_sink += targetTitle.price;
            logTransaction(db, { type: 'danhhieu', uid, amount: -targetTitle.price, detail: targetTitle.name });
            saveDB(db);

            // [TÍNH NĂNG MỚI] Tự động gán role Discord tương ứng với danh hiệu vừa mua
            let roleNotice = "";
            if (interaction.guild && interaction.member) {
                const mapKey = `${interaction.guild.id}_${titleKey}`;
                const roleId = db.titleRoleIds && db.titleRoleIds[mapKey];
                if (roleId) {
                    try {
                        await interaction.member.roles.add(roleId);
                        roleNotice = `\n🎖️ Role **${targetTitle.name.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim()}** đã được gắn vào tài khoản Discord của bạn!`;
                    } catch (err) {
                        console.error("Lỗi gán role danh hiệu:", err.message);
                        roleNotice = `\n⚠️ Không thể tự gán role (có thể bot thiếu quyền "Manage Roles" hoặc role của bot đang thấp hơn role danh hiệu). Vui lòng báo Admin kiểm tra lại!`;
                    }
                } else {
                    roleNotice = `\n⚠️ Chưa tìm thấy role tương ứng, hãy thử khởi động lại bot 1 lần để hệ thống tự tạo role.`;
                }
            } else {
                roleNotice = `\n💡 Bạn đang mua qua DM nên role chỉ được gắn khi dùng lệnh \`/danhhieu\` ngay trong server nhé.`;
            }

            return interaction.reply({
                content: `🏷️ **[DANH HIỆU VIP]** Bạn đã đổi thành công danh hiệu **${targetTitle.name}**!\n💸 Đã trừ \`${targetTitle.price} Yên\` ra khỏi ví.\n💳 Số dư còn lại: \`${user.money} Yên\`${roleNotice}`,
                ephemeral: true
            });
        }


        // ====== [TÍNH NĂNG MỚI] Mua đồ hiếm trên Chợ Trời (giao dịch giữa người chơi) ======
        if (interaction.customId.startsWith('market_buy_')) {
            const listingId = interaction.customId.replace('market_buy_', '');
            ensureNewFeatureFields(db, db.users[uid]);
            const listIndex = db.market.listings.findIndex(l => l.id === listingId);

            if (listIndex === -1) {
                return interaction.reply({ content: "❌ **[CHỢ TRỜI]** Vật phẩm này đã được mua hoặc bị hủy bán rồi!", ephemeral: true });
            }

            const listing = db.market.listings[listIndex];
            if (listing.sellerId === uid) {
                return interaction.reply({ content: "❌ **[CHỢ TRỜI]** Bạn không thể tự mua đồ của chính mình!", ephemeral: true });
            }

            const buyer = db.users[uid];
            if (buyer.money < listing.price) {
                return interaction.reply({ content: `❌ **[CHỢ TRỜI]** Số dư không đủ! Cần \`${listing.price.toLocaleString('vi-VN')} Yên\`.`, ephemeral: true });
            }

            const MARKET_TAX_RATE = 0.05; // phí chợ 5% — hố tiêu tiền chống lạm phát
            const tax = Math.ceil(listing.price * MARKET_TAX_RATE);
            const sellerReceives = listing.price - tax;

            buyer.money -= listing.price;
            buyer.rareItems.push(listing.item);

            if (!db.users[listing.sellerId]) {
                db.users[listing.sellerId] = { points: 0, money: 0, bank: 0, inv: [], rareItems: [] };
            }
            ensureNewFeatureFields(db, db.users[listing.sellerId]);
            db.users[listing.sellerId].money += sellerReceives;

            db.economy.total_sink += tax;
            db.market.listings.splice(listIndex, 1);
            logTransaction(db, { type: 'market_buy', uid, amount: listing.price, detail: `Mua "${listing.item.name}" từ ${listing.sellerId}` });
            saveDB(db);

            return interaction.reply({
                content: `🛒 **[CHỢ TRỜI - GIAO DỊCH THÀNH CÔNG]** Bạn đã mua **${listing.item.name}** với giá \`${listing.price.toLocaleString('vi-VN')} Yên\`!\n💸 Người bán nhận được \`${sellerReceives.toLocaleString('vi-VN')} Yên\` (đã trừ phí chợ ${MARKET_TAX_RATE * 100}%).`,
                ephemeral: true
            });
        }

        // ====== [TÍNH NĂNG MỚI] Bán đồ hiếm ngay cho NPC (Tiệm Đồ Cổ) — đảm bảo luôn kiếm được tiền dù không có ai mua ======
        if (interaction.customId.startsWith('npc_sell_')) {
            const itemId = interaction.customId.replace('npc_sell_', '');
            const user = db.users[uid];
            ensureNewFeatureFields(db, user);
            const itemIndex = user.rareItems.findIndex(it => it.id === itemId);

            if (itemIndex === -1) {
                return interaction.reply({ content: "❌ **[TIỆM ĐỒ CỔ]** Vật phẩm này không còn trong túi của bạn nữa (có thể đã bán/tặng/đăng chợ rồi)!", ephemeral: true });
            }

            const item = user.rareItems[itemIndex];
            const currentValue = getCurrentItemValue(item);
            const sellPrice = Math.round(currentValue * NPC_SELL_RATE);

            user.rareItems.splice(itemIndex, 1);
            user.money += sellPrice;
            logTransaction(db, { type: 'npc_sell', uid, amount: sellPrice, detail: item.name });
            saveDB(db);

            return interaction.reply({
                content: `🏪 **[TIỆM ĐỒ CỔ]** Đã bán **${item.name}** (giá trị hiện tại \`${currentValue.toLocaleString('vi-VN')} Yên\`) lấy \`${sellPrice.toLocaleString('vi-VN')} Yên\` (${NPC_SELL_RATE * 100}% giá trị, vì bán gấp cho NPC).\n💳 Số dư hiện tại: \`${user.money.toLocaleString('vi-VN')} Yên\``,
                ephemeral: true
            });
        }

        if (interaction.customId.startsWith('date_choice_')) {
            const lastDate = dateCooldowns.get(uid);
            const now = Date.now();
            if (lastDate && (now - lastDate) < DATE_COOLDOWN_TIME) {
                return interaction.reply({ content: "⏳ Bạn đang trong thời gian chờ hồi sức đi chơi!", ephemeral: true });
            }

            const session = activeDates.get(uid);
            if (!session) {
                return interaction.reply({ content: "❌ Lịch trình đi chơi này đã hết hạn, vui lòng dùng lại lệnh \`/date\` nhé!", ephemeral: true });
            }

            const choiceId = interaction.customId.replace('date_choice_', '');
            const choiceText = choiceId === '1' ? session.opt1 : session.opt2;

            activeDates.delete(uid);
            await interaction.deferReply({ ephemeral: false });

            const isSpecialEvent = Math.random() > 0.55;
            const fixedPoints = 40;   
            const bonusPoints = 150;  
            const finalPoints = isSpecialEvent ? bonusPoints : fixedPoints;

            const user = db.users[uid];
            const rank = getAffectionRank(user.points);

            const datePrompt = `Bạn là một Người kể chuyện (Narrator) ẩn danh, đang tường thuật lại một buổi đi chơi vui vẻ, ấm áp giữa hai người bạn. Nhân vật gồm có: 1. Người dùng tên là: ${interaction.user.username} 2. Nino, một người bạn AI vui vẻ, thân thiện, hài hước nhẹ nhàng. Hoạt động: "${choiceText}". Mức độ thân thiết: "${rank}". Hãy viết đoạn truyện ngắn dưới góc nhìn ngôi thứ ba diễn tả buổi đi chơi này, tập trung vào không khí vui vẻ, thoải mái giữa hai người bạn. Không dùng ngôi thứ nhất dẫn chuyện. ${isSpecialEvent ? `[SỰ KIỆN THÚ VỊ BẤT NGỜ]: Diễn tả một tình huống bất ngờ vui nhộn xảy ra trong lúc đi chơi.` : `[BUỔI ĐI CHƠI BÌNH THƯỜNG]: Buổi đi chơi diễn ra suôn sẻ.`} Yêu cầu: Không ghi điểm số, viết ngắn gọn súc tích trong khoảng 200 từ để tránh tràn ký tự Discord.`;

            try {
                const response = await groq.chat.completions.create({
                    model: config.MODEL,
                    messages: [{ role: "system", content: "Bạn là một người kể chuyện ngôi thứ ba, giọng văn nhẹ nhàng, vui vẻ." }, { role: "user", content: datePrompt }],
                    temperature: 0.85
                });
                const dateStory = response.choices[0].message.content.trim();

                db.users[uid].points += finalPoints;
                saveDB(db);
                dateCooldowns.set(uid, now);
                scheduleCooldownReminder(interaction.user, DATE_COOLDOWN_TIME, '/date');

                let memory = loadUserMemory(uid);
                memory.push(
                    { role: "user", content: `Kỉ niệm đi chơi: Hai đứa mình cùng đi làm việc này: ${choiceText}` },
                    { role: "assistant", content: `[Nhật ký sự kiện đi chơi của hệ thống]: ${dateStory}` }
                );
                saveUserMemory(uid, memory);

                await interaction.editReply({ content: `🎉 **[ĐI CHƠI]** Buổi đi chơi đã được quyết định!`, components: [] });

                const headerText = `🎈 **BUỔI ĐI CHƠI CỦA ${interaction.user} & NINO**\n📍 **Hoạt động được chọn:** \`${choiceText}\`\n\n`;
                const footerText = `\n\n🏆 **KẾT QUẢ BUỔI ĐI CHƠI:**\n${isSpecialEvent ? `✨ **[SỰ KIỆN BẤT NGỜ]** Một khoảnh khắc thú vị ngoài dự kiến làm buổi đi chơi thêm đáng nhớ!` : `☕ Buổi đi chơi diễn ra vô cùng suôn sẻ và ấm cúng.`}\n📈 **Điểm thân thiết tích lũy:** \`+${finalPoints} điểm\`\n📊 **Cấp độ mới:** \`${getAffectionRank(db.users[uid].points)}\` (Tổng: \`${db.users[uid].points.toFixed(2)}đ\`)`;
                
                const fullMessage = `${headerText}${dateStory}${footerText}`;

                if (fullMessage.length > 2000) {
                    await interaction.channel.send({ content: `${headerText}${dateStory}` });
                    await interaction.channel.send({ content: footerText });
                } else {
                    await interaction.channel.send({ content: fullMessage });
                }

            } catch (err) {
                console.error(err);
                await interaction.followUp({ content: "❌ Trục trặc hệ thống xử lý kịch bản AI!", ephemeral: true });
            }
        }

        if (interaction.customId === 'tx_borrow') {
            const user = db.users[uid];
            const now = Date.now();

            if (user.loan && user.loan.status === 'active') {
                return interaction.reply({ content: "❌ Bạn đang vướng một khoản nợ chưa thanh toán! Mau gom tiền trả nợ đi đã nếu không muốn rước họa vào thân.", ephemeral: true });
            }
            if (user.loan && user.loan.last_borrowed && (now - user.loan.last_borrowed < 86400000)) {
                return interaction.reply({ content: "❌ Bạn đã dùng hết hạn mức tín dụng đen của hôm nay! Tên trùm gầm gừ: \"Bộ coi địa bàn của tao là cái máy phát tiền từ thiện đấy à?! Mai quay lại!\"", ephemeral: true });
            }

            user.money += 2000;
            user.loan = { status: 'active', borrowed_at: now, last_borrowed: now };
            saveDB(db);

            return interaction.reply({
                content: `💸 **[VAY NÓNG THÀNH CÔNG]** Bạn đã nhận **2,000 Yên** tiền nóng từ Quỹ Đen của Băng Đảng!\n⏱️ **Thời hạn quy định:** Bạn có đúng **10 phút** để kiếm tiền bấm nút Hoàn Nợ. Quá hạn, luật giang hồ thực thi: ví về 0 và cấm cửa sòng bạc trong 24 giờ.\n💳 Số dư hiện tại: \`${user.money} Yên\`. Bạn có thể bấm nút Trả Nợ ở bảng Tài Xỉu bất kỳ lúc nào!`,
                ephemeral: true
            });
        }

        if (interaction.customId === 'tx_paydebt') {
            const user = db.users[uid];
            if (!user.loan || user.loan.status !== 'active') {
                return interaction.reply({ content: "❌ Bạn hiện tại không có khoản nợ máu nào cần thanh toán cả!", ephemeral: true });
            }
            if (user.money < 2000) {
                return interaction.reply({ content: `❌ Bạn không có đủ \`2,000 Yên\` để trả nợ! (Số dư hiện tại: \`${user.money} Yên\`). Hãy tranh thủ đi \`/work\` bốc vác kiếm thêm tiền giải nguy nhé!`, ephemeral: true });
            }

            user.money -= 2000;
            user.loan.status = 'none';
            saveDB(db);

            return interaction.reply({
                content: `🎉 **[ĐÃ TRẢ SÒNG PHẲNG]** Bạn đã hoàn trả sòng phẳng 2,000 Yên cho Băng Đảng!\n🚬 **Tên thu nợ ném đi điếu thuốc, cười khẩy:** "Biết điều đấy nhóc... Tưởng định ôm tiền chạy cơ, lần sau có máu liều thì tự nạp thêm tiền vào mà chơi nghe chưa!"`,
                ephemeral: true
            });
        }

        if (interaction.customId.startsWith('tx_tai_') || interaction.customId.startsWith('tx_xiu_')) {
            const isBetTai = interaction.customId.startsWith('tx_tai_');
            const betAmount = parseInt(interaction.customId.replace(isBetTai ? 'tx_tai_' : 'tx_xiu_', ''));
            const user = db.users[uid];

            if (user.money < betAmount) {
                return interaction.reply({ content: "❌ Tiền cược sòng bạc phải lớn hơn 0!", ephemeral: true });
            }

            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const d3 = Math.floor(Math.random() * 6) + 1;
            const totalDice = d1 + d2 + d3;
            const diceResult = (totalDice >= 11) ? "Tài" : "Xỉu";
            const userWon = (isBetTai && totalDice >= 11) || (!isBetTai && totalDice <= 10);

            if (userWon) {
                user.money += betAmount;
                saveDB(db);
                return interaction.reply({
                    content: `🎲 **[SÒNG BẠC CHỢ ĐEN — CHIẾN THẮNG]**\n🎰 Kết quả bát xóc: \`[${d1}, ${d2}, ${d3}]\` ➔ Tổng điểm: **${totalDice}** (**${diceResult}**)\n🎉 Nhà cái chung tiền! Bạn ăn trọn mốc cược, cộng \`+${betAmount} Yên\` vào tài khoản.\n💳 Số dư mới: \`${user.money} Yên\`.`
                });
            } else {
                user.money -= betAmount;
                saveDB(db);
                return interaction.reply({
                    content: `🎲 **[SÒNG BẠC CHỢ ĐEN — THẤT BẠI]**\n🎰 Kết quả bát xóc: \`[${d1}, ${d2}, ${d3}]\` ➔ Tổng điểm: **${totalDice}** (**${diceResult}**)\n😭 Bạn đen lắm! Nhà cái đã hốt sạch tiền cược, trừ trắng \`-${betAmount} Yên\`.\n💳 Số dư mới: \`${user.money} Yên\`.`
                });
            }
        }
    }

    if (!interaction.isChatInputCommand()) return;

    // --- LỆNH SLASH COMMANDS ---
    if (interaction.commandName === 'testgreet') {
        await interaction.reply({ content: "⏳ Đang ép hệ thống AI tạo lời chào mẫu ngay lập tức...", ephemeral: true });
        await sendServerGreeting(client, "chào buổi sáng mới thức dậy, giục giã mọi người tỉnh táo để đi làm/đi học, giọng điệu vui vẻ, tràn đầy năng lượng, kèm lời chúc một ngày mới tốt lành.");
        return interaction.followUp({ content: "✅ Đã ép gửi lệnh thành công vào channel chỉ định!", ephemeral: true });
    }

    else if (interaction.commandName === 'mn') {
        await interaction.deferReply({ ephemeral: true });
        const lore = fs.existsSync("./lore.txt") ? fs.readFileSync("./lore.txt", "utf8") : "Bạn là Nino, một trợ lý AI thân thiện.";
        const systemPrompt = `${lore}\n\n[MỨC ĐỘ THÂN THIẾT]: Mức tối đa, rất thân thiết.\n\nNhiệm vụ: Viết một lời chào buổi sáng ngẫu nhiên, vui vẻ, ấm áp gửi tới mọi người. Không chứa mã code, không kèm điểm số.`;
        
        try {
            const response = await groq.chat.completions.create({
                model: config.MODEL,
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Hãy nói lời chào buổi sáng đi!" }],
                temperature: 0.9
            });
            const text = response.choices[0].message.content.trim();
            const channel = await client.channels.fetch(config.ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
            if (channel) {
                await channel.send(text);
                await interaction.editReply("✅ Đã gửi lời chào buổi sáng vào kênh thông báo thành công!");
            } else {
                await interaction.editReply("❌ Không tìm thấy kênh thông báo, nhưng đây là lời chào: " + text);
            }
        } catch (err) {
            console.error(err);
            await interaction.editReply("❌ AI đang ngái ngủ, không thể tạo lời chào lúc này!");
        }
    }

    else if (interaction.commandName === 'gn') {
        await interaction.deferReply({ ephemeral: true });
        const lore = fs.existsSync("./lore.txt") ? fs.readFileSync("./lore.txt", "utf8") : "Bạn là Nino, một trợ lý AI thân thiện.";
        const systemPrompt = `${lore}\n\n[MỨC ĐỘ THÂN THIẾT]: Mức tối đa, rất thân thiết.\n\nNhiệm vụ: Viết một lời chúc ngủ ngon ngẫu nhiên, ấm áp, dễ thương gửi tới mọi người. Không chứa mã code, không kèm điểm số.`;
        
        try {
            const response = await groq.chat.completions.create({
                model: config.MODEL,
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Hãy chúc ngủ ngon đi!" }],
                temperature: 0.9
            });
            const text = response.choices[0].message.content.trim();
            const channel = await client.channels.fetch(config.ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
            if (channel) {
                await channel.send(text);
                await interaction.editReply("✅ Đã gửi lời chúc ngủ ngon vào kênh thông báo thành công!");
            } else {
                await interaction.editReply("❌ Không tìm thấy kênh thông báo, nhưng đây là lời chúc: " + text);
            }
        } catch (err) {
            console.error(err);
            await interaction.editReply("❌ AI đang ngủ gật rồi, không thể tạo lời chúc lúc này!");
        }
    }

    else if (interaction.commandName === 'daily') {
        const user = db.users[uid];
        const now = Date.now();

        if (user.last_daily && (now - user.last_daily < 86400000)) {
            const diff = 86400000 - (now - user.last_daily);
            const hours = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            return interaction.reply({ content: `⏳ **[HỆ THỐNG DAILY]** Hôm nay bạn đã nhận thưởng rồi! Vui lòng đợi thêm \`${hours} giờ ${mins} phút\` nữa để tiếp tục nhận nhé.`, ephemeral: true });
        }

        const dailyReward = Math.floor(Math.random() * (2000 - 500 + 1)) + 500;
        user.money += dailyReward;
        user.last_daily = now;
        saveDB(db);

        await interaction.reply({
            content: `🎁 **[QUÀ TẶNG HÀNG NGÀY]** Bạn đã điểm danh thành công!\n💝 Nino gửi cho bạn một phong bao nhỏ: \"Đây là quà nhỏ mình chuẩn bị cho bạn hôm nay nè!\"\n💰 Bạn nhận được: \`+${dailyReward} Yên\`\n💳 Tài sản tích lũy hiện tại: \`${user.money} Yên\`.`
        });
    }

    else if (interaction.commandName === 'taixiu') {
        const bet = interaction.options.getInteger('bet');
        if (bet <= 0) return interaction.reply({ content: "❌ Tiền cược sòng bạc phải lớn hơn 0!", ephemeral: true });

        const user = db.users[uid];
        
        let loanNotice = "";
        if (user.loan && user.loan.status === 'active') {
            const timeElapsed = Date.now() - user.loan.borrowed_at;
            const minsLeft = Math.ceil((600000 - timeElapsed) / 60000);
            loanNotice = `\n⚠️ *CẢNH BÁO: Bạn đang nợ Băng Đảng 2,000 Yên! Thời gian còn lại trước khi bị xử lý: ${minsLeft} phút.*`;
        }

        const txRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tx_tai_${bet}`).setLabel('🎲 Đặt Tài (11-18)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`tx_xiu_${bet}`).setLabel('🎲 Đặt Xỉu (3-10)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('tx_paydebt').setLabel('💸 Trả Nợ Đại Ca (2000đ)').setStyle(ButtonStyle.Secondary)
        );

        if (user.money < bet) {
            const borrowRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('tx_borrow').setLabel('💵 Vay Nóng Tín Dụng Đen 2,000 Yên').setStyle(ButtonStyle.Primary)
            );
            return interaction.reply({
                content: `❌ **[SÒNG BẠC THẾ GIỚI NGẦM]** Bạn không đủ vốn để theo mức cược \`${bet} Yên\` (Ví hiện tại chỉ còn: \`${user.money} Yên\`).\n\n👉 Bạn có muốn bấm nút phía dưới để Vay Nóng **2,000 Yên** từ Quỹ của Đại Ca để làm liều lật kèo không? (Giới hạn thanh toán trong vòng 10 phút, quá hạn sẽ chịu luật giang hồ Tẩn Tịch Thu!)${loanNotice}`,
                components: [borrowRow],
                ephemeral: true
            });
        }

        await interaction.reply({
            content: `🎰 **SÒNG BẠC THẾ GIỚI NGẦM CHỢ ĐEN** 🎰\n💰 Mức cược thiết lập: \` ${bet} Yên \`\n💳 Tiền mặt hiện có: \` ${user.money} Yên \`\n\n*Nhấp chọn một trong các nút tương ứng bên dưới để đặt cửa. Thắng làm vua, thua làm lại:*${loanNotice}`,
            components: [txRow],
            ephemeral: true
        });
    }

    else if (interaction.commandName === 'work') {
        const lastWork = workCooldowns.get(uid);
        const now = Date.now();

        if (lastWork && (now - lastWork) < COOLDOWN_TIME) {
            const diff = COOLDOWN_TIME - (now - lastWork);
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            return interaction.reply({ content: `⏳ **[HỆ THỐNG]** Bạn đang kiệt sức! Vui lòng quay lại sau \`${mins} phút ${secs} giây\` nữa.`, ephemeral: true });
        }

        let base = 2000;
        let jobName = "Bốc vác tự do 📦";
        const userInv = db.users[uid].inv || [];

        if (userInv.includes("nước_hoa")) {
            base = 5500;
            jobName = "Tiếp viên nhà hàng cao cấp 🥂";
        } else if (userInv.includes("sách_nấu_ăn")) {
            base = 3500;
            jobName = "Phụ bếp tiệm bánh ngọt 🧁";
        }

        let event = Math.random();
        let bonus = 0;
        let statusMsg = `Bạn đã hoàn thành ca làm việc **${jobName}** một cách chăm chỉ.`;
        
        if (event > 0.85) { 
            bonus = Math.floor(base * 0.5);
            statusMsg = `Xuất sắc! Tiến độ công việc **${jobName}** vượt bậc, bạn được thưởng thêm hiệu suất công việc.`; 
        }
        else if (event < 0.15) { 
            bonus = -Math.floor(base * 0.3);
            statusMsg = `Rủi ro! Bạn sơ ý làm hỏng tài liệu/đồ đạc tại nơi làm việc, hệ thống khấu trừ tiền phạt lỗi.`; 
        }
        
        const totalEarned = base + bonus;
        db.users[uid].money += totalEarned;
        workCooldowns.set(uid, now); 
        scheduleCooldownReminder(interaction.user, COOLDOWN_TIME, '/work');
        logTransaction(db, { type: 'work', uid, amount: totalEarned, detail: jobName });
        saveDB(db);

        await interaction.reply({
            content: `⚙️ **[HỆ THỐNG WORK]**\n💼 **Công việc:** \`${jobName}\`\n📝 **Trạng thái:** ${statusMsg}\n💰 **Thu nhập:** \`+${totalEarned} Yên\` (Lương gốc: \`${base} Yên\`)\n💳 **Số dư ví hiện tại:** \`${db.users[uid].money} Yên\``
        });
    } 

    else if (interaction.commandName === 'bank') {
        const action = interaction.options.getString('action');
        const amount = interaction.options.getInteger('amount');
        const user = db.users[uid];

        if (amount <= 0) {
            return interaction.reply({ content: "❌ **[NGÂN HÀNG]** Số tiền giao dịch phải lớn hơn 0 Yên!", ephemeral: true });
        }

        if (user.bank === undefined) user.bank = 0;
        if (user.bank_last_interest === undefined) user.bank_last_interest = Date.now();

        if (action === 'deposit') {
            if (user.money < amount) {
                return interaction.reply({ content: `❌ **[NGÂN HÀNG]** Bạn không đủ tiền mặt trong ví! (Hiện có: \`${user.money} Yên\`)`, ephemeral: true });
            }
            user.money -= amount;
            user.bank += amount;
            saveDB(db);
            return interaction.reply({
                content: `💰 **[HỆ THỐNG BANK - GỬI TIỀN]**\n📥 Bạn đã đưa \`${amount} Yên\` cho Nino giữ hộ.\n📈 *Tiền gửi tại đây sẽ tự động sinh lãi suất \`5%/ngày\` theo thời gian thực, dù bot có offline cũng không ảnh hưởng!*\n🎀 **Nino:** *\"Yên tâm, mình sẽ giữ tiền cẩn thận cho bạn nhé!\"*\n💳 **Ví mặt:** \`${user.money} Yên\` | 🏦 **Két sắt Nino giữ:** \`${user.bank} Yên\``,
                ephemeral: true
            });
        } 
        else if (action === 'withdraw') {
            if (user.bank < amount) {
                return interaction.reply({ content: `❌ **[NGÂN HÀNG]** Két sắt của Nino không đủ tiền để rút! (Hiện có: \`${user.bank} Yên\`)`, ephemeral: true });
            }

            let affectionNotice = "";
            if (user.points < 1500) {
                user.points = Math.max(0, user.points - 5);
                affectionNotice = `\n⚠️ *Nino nhắc nhở bạn rút tiền tiêu xài cẩn thận nhé! Trừ \`-5\` điểm thân thiết.*`;
            }

            user.bank -= amount;
            user.money += amount;
            saveDB(db);
            
            return interaction.reply({
                content: `💸 **[HỆ THỐNG BANK - RÚT TIỀN]**\n📤 Đã rút thành công \`${amount} Yên\` ra ví tiền mặt.\n🎀 **Nino:** *\"Nhớ xài tiền cẩn thận nhé bạn ơi!\"*${affectionNotice}\n💳 **Ví mặt:** \`${user.money} Yên\` | 🏦 **Két sắt Nino giữ:** \`${user.bank} Yên\``,
                ephemeral: true
            });
        }
    }

    else if (interaction.commandName === 'shop') {
        checkAndRefreshShop(db);
        let timeLeft = Math.ceil((db.shop.next_refresh - Date.now()) / 1000 / 60);
        let shopMenu = `🏪 **CỬA HÀNG QUÀ TẶNG XOAY TUA (Reset sau: ${timeLeft} phút)** 🏪\n\n`;
        const row = new ActionRowBuilder();
        
        let index = 1;
        for (const key of db.shop.current_items) {
            const item = ALL_ITEMS[key];
            shopMenu += `**${index}**. **${item.name}** — Giá: \`${item.price} Yên\`\n`;
            row.addComponents(new ButtonBuilder().setCustomId(`buy_${key}`).setLabel(`${index}`).setStyle(ButtonStyle.Primary));
            index++;
        }
        
        const resetItem = ALL_ITEMS["the_reset"];
        shopMenu += `**4**. **${resetItem.name}** — Giá: \`${resetItem.price} Yên\` (Cố định)\n`;
        row.addComponents(new ButtonBuilder().setCustomId('buy_the_reset').setLabel('4').setStyle(ButtonStyle.Danger));
        
        shopMenu += "\n*Nhấp vào các nút số phía dưới tương ứng để mua món hàng cậu cần!*";
        await interaction.reply({ content: shopMenu, components: [row], ephemeral: true });
    }

    else if (interaction.commandName === 'date') {
        const lastDate = dateCooldowns.get(uid);
        const now = Date.now();

        if (lastDate && (now - lastDate) < DATE_COOLDOWN_TIME) {
            const diff = DATE_COOLDOWN_TIME - (now - lastDate);
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            return interaction.reply({ content: `⏳ **[HỆ THỐNG ĐI CHƠI]** Nino nhắc: \"Mình cần nghỉ ngơi một chút đã nha!\". Quay lại sau \`${mins} phút ${secs} giây\` nữa.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const user = db.users[uid];
        const rank = getAffectionRank(user.points);

        const menuPrompt = `Bạn là hệ thống thiết kế hoạt động đi chơi cùng Nino. Hãy tạo ra đúng 2 ý tưởng hoạt động đi chơi ngắn gọn phù hợp cấp mốc thân thiết: "${rank}". Định dạng bắt buộc: Lựa chọn 1 | Lựa chọn 2. Mỗi lựa chọn dưới 35 ký tự, ngăn cách nhau duy nhất bằng dấu "|". Không viết thêm gì khác.`;

        try {
            const response = await groq.chat.completions.create({
                model: config.MODEL,
                messages: [{ role: "user", content: menuPrompt }],
                temperature: 0.85
            });

            const rawOptions = response.choices[0].message.content.trim();
            const parts = rawOptions.split('|').map(p => p.trim());
            
            const opt1 = parts[0] || "Cùng nhau đi dạo phố mua sắm 🛍️";
            const opt2 = parts[1] || "Gặp nhau ở quán trà chiều bàn chuyện ☕";

            activeDates.set(uid, { opt1, opt2 });

            const dateRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('date_choice_1').setLabel('Lựa chọn 1').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('date_choice_2').setLabel('Lựa chọn 2').setStyle(ButtonStyle.Primary)
            );

            await interaction.editReply({
                content: `🌹 **[HỆ THỐNG ĐI CHƠI LINH HOẠT]**\nNino đang đợi bạn lên tiếng đấy. AI đã thiết lập sẵn 2 phương án dựa trên độ thân thiết của hai bạn:\n\n**1️⃣ Lựa chọn 1:** ${opt1}\n**2️⃣ Lựa chọn 2:** ${opt2}\n\n*Hãy click vào nút phía dưới để quyết định hành trình hôm nay:*`,
                components: [dateRow]
            });

        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: "❌ AI gặp lỗi trong lúc lên lịch trình, vui lòng thử lại sau ít phút!" });
        }
    }

    else if (interaction.commandName === 'gift') {
        const user = db.users[uid];

        if (!user.inv || user.inv.length === 0) {
            return interaction.reply({ content: "❌ **[HỆ THỐNG]** Kho đồ của bạn hiện tại đang trống rỗng! Hãy ghé qua lệnh `/shop` mua vài thứ trước khi muốn tặng quà cho Nino nhé.", ephemeral: true });
        }

        const itemCounts = {};
        user.inv.forEach(key => {
            itemCounts[key] = (itemCounts[key] || 0) + 1;
        });

        const giftSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('gift_select_menu')
            .setPlaceholder('👉 Bấm vào đây để chọn món quà muốn tặng...');

        Object.keys(itemCounts).forEach(key => {
            const itemDetails = ALL_ITEMS[key] || { name: key, points: 0 };
            giftSelectMenu.addOptions({
                label: `${itemDetails.name} (Số lượng: x${itemCounts[key]})`,
                description: `Tăng +${itemDetails.points} điểm thân thiết khi tặng.`,
                value: key
            });
        });

        const row = new ActionRowBuilder().addComponents(giftSelectMenu);

        await interaction.reply({
            content: `🎒 **KHO QUÀ TẶNG CỦA BẠN**\nNino đang chờ xem bạn chọn quà gì đấy... Hãy chọn một món vật phẩm có sẵn dưới thanh Menu để gửi tặng nhé:`,
            components: [row],
            ephemeral: true
        });
    } 

    else if (interaction.commandName === 'inv') {
        if (db.users[uid].bank === undefined) db.users[uid].bank = 0;
        ensureNewFeatureFields(db, db.users[uid]);
        const readableInv = db.users[uid].inv.map(k => ALL_ITEMS[k]?.name || k).join(", ");
        const rareItemsText = db.users[uid].rareItems.length > 0
            ? db.users[uid].rareItems.map(it => {
                const curVal = getCurrentItemValue(it);
                const grownTag = curVal > it.price ? ` _(gốc ${it.price.toLocaleString('vi-VN')})_` : "";
                return `${it.rarityLabel} **${it.name}** — \`${curVal.toLocaleString('vi-VN')} Yên\`${grownTag} (ID: \`${it.id}\`)`;
              }).join("\n")
            : "_Chưa có đồ hiếm nào, dùng `/khampha` để đi tìm!_";
        await interaction.reply(`🎒 **KHO HÀNG CỦA BẠN:**\n💰 **Tiền mặt ví:** \`${db.users[uid].money} Yên\`\n🏦 **Két sắt tiết kiệm (Bank):** \`${db.users[uid].bank} Yên\` *(lãi suất ${BANK_INTEREST_RATE * 100}%/ngày, tự động cộng theo thời gian thực)*\n📦 **Danh sách vật phẩm:** ${readableInv || "_Trống không_"}\n\n🗺️ **Đồ hiếm (Thám hiểm):**\n${rareItemsText}`);
    }

    else if (interaction.commandName === 'affection') {
        const rank = getAffectionRank(db.users[uid].points);
        await interaction.reply({ content: `📊 **[HỆ THỐNG THÂN THIẾT]**\n📈 **Điểm tích lũy:** \`${db.users[uid].points.toFixed(2)}\` điểm.\n👑 **Mốc thân thiết:** \`${rank}\``, ephemeral: true });
    }

    // ====== [TÍNH NĂNG MỚI] /cauca — Kiếm tiền (Money Faucet có kiểm soát) ======
    else if (interaction.commandName === 'cauca') {
        const user = db.users[uid];
        ensureNewFeatureFields(db, user);
        const now = Date.now();

        if (user.last_fish && (now - user.last_fish) < FISH_COOLDOWN_MS) {
            const diff = FISH_COOLDOWN_MS - (now - user.last_fish);
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            return interaction.reply({ content: `⏳ **[HỆ THỐNG CÂU CÁ]** Cần câu vẫn chưa thả lại được! Đợi thêm \`${mins} phút ${secs} giây\` nữa nhé.`, ephemeral: true });
        }

        const fish = rollFish();
        user.last_fish = now;
        scheduleCooldownReminder(interaction.user, FISH_COOLDOWN_MS, '/cauca');

        if (fish.price === 0) {
            saveDB(db);
            return interaction.reply({
                content: `🎣 **[CÂU CÁ]** Bạn thả câu cả buổi nhưng chỉ vớt được **${fish.name}**...\n🎀 **Nino:** \"Không sao đâu, lần sau chắc chắn sẽ khá hơn!\"\n💰 Thu nhập: \`0 Yên\`.`
            });
        }

        user.money += fish.price;
        db.economy.total_fishing_income += fish.price;
        db.economy.total_fish_caught += 1;
        user.fish_caught = (user.fish_caught || 0) + 1;
        logTransaction(db, { type: 'cauca', uid, amount: fish.price, detail: fish.name });
        saveDB(db);

        return interaction.reply({
            content: `🎣 **[CÂU CÁ THÀNH CÔNG]** Bạn câu được: **${fish.name}**!\n💰 Bán được: \`+${fish.price} Yên\`\n💳 Số dư ví hiện tại: \`${user.money} Yên\``
        });
    }

    // ====== [TÍNH NĂNG MỚI] /danhhieu — Tiêu tiền (Money Sink chống lạm phát) ======
    else if (interaction.commandName === 'danhhieu') {
        const user = db.users[uid];
        ensureNewFeatureFields(db, user);

        let shopMenu = `🏷️ **CỬA HÀNG DANH HIỆU VIP** 🏷️\n💳 Số dư hiện tại: \`${user.money} Yên\`\n\n*Danh hiệu là vật phẩm vĩnh viễn dùng để khẳng định đẳng cấp, không thể bán lại. Mua xong sẽ được cộng một lần điểm thân thiết nhỏ.*\n\n`;
        const row1 = new ActionRowBuilder();
        const row2 = new ActionRowBuilder();

        TITLE_SHOP.forEach((t, idx) => {
            const owned = user.titles.includes(t.key);
            shopMenu += `${owned ? "✅" : "▫️"} **${t.name}** — \`${t.price.toLocaleString('vi-VN')} Yên\` ${owned ? "_(Đã sở hữu)_" : ""}\n`;
            const btn = new ButtonBuilder()
                .setCustomId(`title_buy_${t.key}`)
                .setLabel(t.name.replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 25))
                .setStyle(owned ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setDisabled(owned);
            if (idx < 3) row1.addComponents(btn); else row2.addComponents(btn);
        });

        await interaction.reply({ content: shopMenu, components: [row1, row2], ephemeral: true });
    }

    // ====== [TÍNH NĂNG MỚI] /profile — Hồ sơ tổng hợp + Huy hiệu + Kỷ niệm ======
    else if (interaction.commandName === 'profile') {
        const user = db.users[uid];
        ensureNewFeatureFields(db, user);
        saveDB(db);

        const rank = getAffectionRank(user.points);
        const ownedTitles = getOwnedTitleObjects(user);
        const memory = loadUserMemory(uid);
        const badges = getEarnedBadges(user, memory.length);
        const daysKnown = Math.floor((Date.now() - user.first_interaction_at) / 86400000);

        let anniversaryNote = "";
        if ([30, 100, 365, 730].includes(daysKnown)) {
            anniversaryNote = `\n\n🎉 **[KỶ NIỆM]** Hôm nay là đúng tròn \`${daysKnown}\` ngày bạn và Nino quen biết nhau!`;
        }

        const titlesText = ownedTitles.length > 0 ? ownedTitles.map(t => t.name).join(", ") : "_Chưa có_";
        const badgesText = badges.length > 0 ? badges.map(b => b.name).join(", ") : "_Chưa có_";

        await interaction.reply({
            content: `🪪 **HỒ SƠ CỦA ${interaction.user.username}**\n\n📈 **Điểm thân thiết:** \`${user.points.toFixed(2)}\`\n👑 **Mốc thân thiết:** \`${rank}\`\n💰 **Ví tiền mặt:** \`${user.money.toLocaleString('vi-VN')} Yên\`\n🏦 **Két tiết kiệm:** \`${(user.bank || 0).toLocaleString('vi-VN')} Yên\`\n📅 **Đã quen Nino:** \`${daysKnown}\` ngày\n🏷️ **Danh hiệu:** ${titlesText}\n🎖️ **Huy hiệu:** ${badgesText}\n🗺️ **Đồ hiếm đang giữ:** \`${user.rareItems.length}\` món${anniversaryNote}`,
            ephemeral: true
        });
    }

    // ====== [TÍNH NĂNG MỚI] /help — Danh sách lệnh ======
    else if (interaction.commandName === 'help') {
        await interaction.reply({
            content: `📖 **DANH SÁCH LỆNH NINO BOT**\n\n` +
                `**💬 Trò chuyện**\n@Nino <tin nhắn> hoặc nhắn DM — Chat trực tiếp với Nino\n\`!clear\` — Xóa lịch sử trò chuyện\n\n` +
                `**🪪 Hồ sơ & tiện ích**\n\`/profile\` \`/affection\` \`/inv\` \`/top\`\n\n` +
                `**💰 Kiếm tiền**\n\`/work\` (5p) \`/cauca\` (10p) \`/khampha\` (30p) \`/daily\` (24h) \`/taixiu\`\n\n` +
                `**🛍️ Tiêu tiền**\n\`/shop\` \`/gift\` \`/danhhieu\` \`/bank\` \`/baohiem\` \`/doimau\`\n\n` +
                `**🛒 Giao dịch giữa người chơi**\n\`/market sell|list|cancel\` \`/transfer\` \`/give\`\n\n` +
                `**🎈 Đi chơi**\n\`/date\` (1h)`,
            ephemeral: true
        });
    }

    // ====== [TÍNH NĂNG MỚI] /top — Bảng xếp hạng điểm thân thiết ======
    else if (interaction.commandName === 'top') {
        const ranking = Object.entries(db.users)
            .map(([id, u]) => ({ id, points: u.points || 0 }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);

        if (ranking.length === 0) {
            return interaction.reply({ content: "📊 Chưa có dữ liệu người chơi nào.", ephemeral: true });
        }

        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
        const lines = ranking.map((u, i) => `${medals[i]} <@${u.id}> — \`${u.points.toFixed(2)}\` điểm`);

        await interaction.reply({ content: `🏆 **BẢNG XẾP HẠNG ĐIỂM THÂN MẬT — TOP 10**\n\n${lines.join("\n")}` });
    }

    // ====== [TÍNH NĂNG MỚI] /khampha — Thám hiểm đồ hiếm (AI sáng tạo tên/mô tả, code kiểm soát giá) ======
    else if (interaction.commandName === 'khampha') {
        const user = db.users[uid];
        ensureNewFeatureFields(db, user);
        const now = Date.now();

        if (user.last_kham && (now - user.last_kham) < KHAMPHA_COOLDOWN_MS) {
            const diff = KHAMPHA_COOLDOWN_MS - (now - user.last_kham);
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            return interaction.reply({ content: `⏳ **[THÁM HIỂM]** Bạn vừa thám hiểm xong, cần nghỉ ngơi! Đợi thêm \`${mins} phút ${secs} giây\` nữa nhé.`, ephemeral: true });
        }

        await interaction.deferReply();
        user.last_kham = now;
        scheduleCooldownReminder(interaction.user, KHAMPHA_COOLDOWN_MS, '/khampha');

        const tier = rollRarity();
        const price = Math.floor(Math.random() * (tier.priceMax - tier.priceMin + 1)) + tier.priceMin;
        const khamPrompt = `Bạn là hệ thống sáng tạo vật phẩm cho game nhập vai cùng Nino. Hãy nghĩ ra TÊN và MÔ TẢ ngắn (dưới 20 từ) cho một vật phẩm độc đáo, kỳ lạ hoặc thú vị mà người chơi vừa tìm thấy lúc thám hiểm, phù hợp độ hiếm "${tier.label}". Đồng thời chọn 1 số % tăng giá trị mỗi ngày nếu giữ lại, nằm trong khoảng từ ${(tier.growthMin * 100).toFixed(1)}% đến ${(tier.growthMax * 100).toFixed(1)}% (đồ hiếm hơn thì chọn % cao hơn trong khoảng). Định dạng bắt buộc, chỉ trả lời đúng 1 dòng duy nhất: TÊN: <tên vật phẩm kèm 1 emoji phù hợp> | MÔ TẢ: <mô tả ngắn> | TANG: <số %, ví dụ 1.2>. Không thêm chữ nào khác.`;

        let itemName = "Vật Phẩm Bí Ẩn 🎁";
        let itemDesc = "Một món đồ kỳ lạ chưa ai biết rõ nguồn gốc.";
        let growthRatePerDay = (tier.growthMin + tier.growthMax) / 2; // fallback mặc định nếu AI lỗi: lấy trung bình khung

        try {
            const response = await groq.chat.completions.create({
                model: config.MODEL,
                messages: [{ role: "user", content: khamPrompt }],
                temperature: 1.0
            });
            const raw = response.choices[0].message.content.trim();
            const nameMatch = raw.match(/TÊN:\s*(.+?)\s*\|/);
            const descMatch = raw.match(/MÔ TẢ:\s*(.+?)\s*\|/);
            const growthMatch = raw.match(/TANG:\s*([0-9.]+)/);
            if (nameMatch) itemName = nameMatch[1].trim();
            if (descMatch) itemDesc = descMatch[1].trim();
            if (growthMatch) {
                const aiRate = parseFloat(growthMatch[1]) / 100;
                // [AN TOÀN] Luôn ép % do AI chọn về đúng khung của độ hiếm tương ứng, tránh AI trả về số bất thường gây lạm phát.
                growthRatePerDay = Math.min(Math.max(aiRate, tier.growthMin), tier.growthMax);
            }
        } catch (err) {
            console.error("Lỗi tạo đồ hiếm từ AI:", err.message);
        }

        const newItem = { id: genItemId(), name: itemName, desc: itemDesc, rarity: tier.key, rarityLabel: tier.label, price, growthRatePerDay, foundAt: now };
        user.rareItems.push(newItem);
        user.total_rare_found = (user.total_rare_found || 0) + 1;
        saveDB(db);

        const npcSellRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`npc_sell_${newItem.id}`).setLabel(`Bán ngay cho NPC (~${Math.round(price * NPC_SELL_RATE).toLocaleString('vi-VN')} Yên)`).setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({
            content: `🗺️ **[THÁM HIỂM THÀNH CÔNG]** ${tier.label}\n\n✨ **${newItem.name}**\n📝 *${newItem.desc}*\n💰 Giá trị gốc: \`${price.toLocaleString('vi-VN')} Yên\`\n📈 Tăng giá: \`~${(growthRatePerDay * 100).toFixed(2)}%/ngày\` nếu giữ lại (tối đa x${5} sau ${60} ngày)\n🆔 Mã vật phẩm: \`${newItem.id}\`\n\n*Giữ lại để giá trị tăng dần, dùng \`/market sell\` để rao bán cho người chơi khác lấy giá cao hơn, \`/give\` để tặng, hoặc bấm nút dưới để bán ngay lấy tiền liền!*`,
            components: [npcSellRow]
        });
    }

    // ====== [TÍNH NĂNG MỚI] /market — Chợ trời mua bán/trao đổi giữa người chơi ======
    else if (interaction.commandName === 'market') {
        const sub = interaction.options.getSubcommand();
        const user = db.users[uid];
        ensureNewFeatureFields(db, user);

        if (sub === 'sell') {
            const itemId = interaction.options.getString('item_id');
            const price = interaction.options.getInteger('price');
            const itemIndex = user.rareItems.findIndex(it => it.id === itemId);

            if (itemIndex === -1) {
                return interaction.reply({ content: "❌ **[CHỢ TRỜI]** Không tìm thấy đồ hiếm này trong túi của bạn! Kiểm tra lại mã vật phẩm bằng `/inv`.", ephemeral: true });
            }
            if (price <= 0) {
                return interaction.reply({ content: "❌ **[CHỢ TRỜI]** Giá bán phải lớn hơn 0!", ephemeral: true });
            }
            const maxAllowedPrice = getCurrentItemValue(user.rareItems[itemIndex]) * 3;
            if (price > maxAllowedPrice) {
                return interaction.reply({ content: `❌ **[CHỢ TRỜI]** Giá bán quá cao so với giá trị thật! Tối đa \`${maxAllowedPrice.toLocaleString('vi-VN')} Yên\` (gấp 3 lần giá gốc) để tránh thổi giá phá nền kinh tế.`, ephemeral: true });
            }

            const [item] = user.rareItems.splice(itemIndex, 1);
            db.market.listings.push({ id: item.id, sellerId: uid, item, price, listedAt: Date.now() });
            saveDB(db);

            return interaction.reply({ content: `🛒 **[CHỢ TRỜI]** Bạn đã đăng bán **${item.name}** với giá \`${price.toLocaleString('vi-VN')} Yên\`. Dùng \`/market list\` để theo dõi!`, ephemeral: true });
        }

        if (sub === 'list') {
            if (!db.market.listings.length) {
                return interaction.reply({ content: "🛒 **[CHỢ TRỜI]** Hiện chợ trời đang trống, chưa ai rao bán gì cả!", ephemeral: true });
            }

            let listText = `🛒 **CHỢ TRỜI — ĐỒ HIẾM ĐANG RAO BÁN**\n\n`;
            const row = new ActionRowBuilder();
            const shown = db.market.listings.slice(0, 5);

            shown.forEach((l, idx) => {
                listText += `**${idx + 1}.** ${l.item.rarityLabel} **${l.item.name}**\n📝 _${l.item.desc}_\n💰 Giá: \`${l.price.toLocaleString('vi-VN')} Yên\` — 👤 Người bán: <@${l.sellerId}>\n\n`;
                row.addComponents(new ButtonBuilder().setCustomId(`market_buy_${l.id}`).setLabel(`Mua #${idx + 1}`).setStyle(ButtonStyle.Success));
            });

            if (db.market.listings.length > 5) listText += `_...và ${db.market.listings.length - 5} món khác, dùng lại lệnh sau khi các món trên được mua._`;

            return interaction.reply({ content: listText, components: [row], ephemeral: true });
        }

        if (sub === 'cancel') {
            const itemId = interaction.options.getString('item_id');
            const listIndex = db.market.listings.findIndex(l => l.id === itemId && l.sellerId === uid);

            if (listIndex === -1) {
                return interaction.reply({ content: "❌ **[CHỢ TRỜI]** Không tìm thấy bài rao bán này của bạn!", ephemeral: true });
            }

            const [listing] = db.market.listings.splice(listIndex, 1);
            user.rareItems.push(listing.item);
            saveDB(db);

            return interaction.reply({ content: `↩️ **[CHỢ TRỜI]** Đã hủy bài rao bán **${listing.item.name}**, vật phẩm đã trả về túi đồ của bạn.`, ephemeral: true });
        }
    }

    // ====== [TÍNH NĂNG MỚI] /transfer — Chuyển Yên cho người chơi khác ======
    else if (interaction.commandName === 'transfer') {
        const target = interaction.options.getUser('target');
        const amount = interaction.options.getInteger('amount');
        const user = db.users[uid];
        ensureNewFeatureFields(db, user);
        const now = Date.now();

        if (target.id === uid) {
            return interaction.reply({ content: "❌ **[CHUYỂN TIỀN]** Bạn không thể tự chuyển tiền cho chính mình!", ephemeral: true });
        }
        if (target.bot) {
            return interaction.reply({ content: "❌ **[CHUYỂN TIỀN]** Không thể chuyển tiền cho bot!", ephemeral: true });
        }
        if (amount <= 0) {
            return interaction.reply({ content: "❌ **[CHUYỂN TIỀN]** Số tiền phải lớn hơn 0!", ephemeral: true });
        }

        const TRANSFER_COOLDOWN_MS = 60000;
        if (user.last_transfer && (now - user.last_transfer) < TRANSFER_COOLDOWN_MS) {
            return interaction.reply({ content: "⏳ **[CHUYỂN TIỀN]** Bạn vừa chuyển tiền xong, vui lòng đợi 1 phút nữa!", ephemeral: true });
        }

        const TRANSFER_TAX_RATE = 0.03; // phí chuyển tiền — hố tiêu tiền, hạn chế giặt tiền/spam
        const tax = Math.ceil(amount * TRANSFER_TAX_RATE);
        const totalCost = amount + tax;

        if (user.money < totalCost) {
            return interaction.reply({ content: `❌ **[CHUYỂN TIỀN]** Số dư không đủ! Cần \`${totalCost.toLocaleString('vi-VN')} Yên\` (đã gồm phí ${TRANSFER_TAX_RATE * 100}%).`, ephemeral: true });
        }

        if (!db.users[target.id]) {
            db.users[target.id] = { points: 0, money: 0, bank: 0, bank_last_interest: Date.now(), inv: [], last_daily: 0, loan: { status: 'none', borrowed_at: 0, last_borrowed: 0 }, disabled_until: 0, reset_money_after_ban: false };
        }
        ensureNewFeatureFields(db, db.users[target.id]);

        user.money -= totalCost;
        db.users[target.id].money += amount;
        user.last_transfer = now;
        db.economy.total_sink += tax;
        logTransaction(db, { type: 'transfer', uid, amount, detail: `Chuyển cho ${target.id}` });
        saveDB(db);

        return interaction.reply({
            content: `💸 **[CHUYỂN TIỀN THÀNH CÔNG]** Bạn đã chuyển \`${amount.toLocaleString('vi-VN')} Yên\` cho ${target}!\n📉 Phí giao dịch: \`${tax.toLocaleString('vi-VN')} Yên\` (${TRANSFER_TAX_RATE * 100}%)\n💳 Số dư còn lại: \`${user.money.toLocaleString('vi-VN')} Yên\``
        });
    }

    // ====== [TÍNH NĂNG MỚI] /give — Tặng trực tiếp đồ hiếm miễn phí cho người chơi khác ======
    else if (interaction.commandName === 'give') {
        const target = interaction.options.getUser('target');
        const itemId = interaction.options.getString('item_id');
        const user = db.users[uid];
        ensureNewFeatureFields(db, user);

        if (target.id === uid) {
            return interaction.reply({ content: "❌ **[TẶNG ĐỒ]** Bạn không thể tự tặng cho chính mình!", ephemeral: true });
        }
        if (target.bot) {
            return interaction.reply({ content: "❌ **[TẶNG ĐỒ]** Không thể tặng đồ cho bot!", ephemeral: true });
        }

        const itemIndex = user.rareItems.findIndex(it => it.id === itemId);
        if (itemIndex === -1) {
            return interaction.reply({ content: "❌ **[TẶNG ĐỒ]** Không tìm thấy đồ hiếm này trong túi của bạn!", ephemeral: true });
        }

        const [item] = user.rareItems.splice(itemIndex, 1);

        if (!db.users[target.id]) {
            db.users[target.id] = { points: 0, money: 0, bank: 0, bank_last_interest: Date.now(), inv: [], last_daily: 0, loan: { status: 'none', borrowed_at: 0, last_borrowed: 0 }, disabled_until: 0, reset_money_after_ban: false };
        }
        ensureNewFeatureFields(db, db.users[target.id]);
        db.users[target.id].rareItems.push(item);
        saveDB(db);

        return interaction.reply({ content: `🎁 **[TẶNG ĐỒ THÀNH CÔNG]** Bạn đã tặng **${item.name}** cho ${target}!` });
    }

    // ====== [TÍNH NĂNG MỚI] /baohiem — Mua Bảo Hiểm Tín Dụng Đen (Tiêu tiền / Money Sink) ======
    // Miễn 1 lần bị "tẩn" + tịch thu tài sản khi nợ Tài Xỉu quá hạn 10 phút (xem checkLoanStatus trong database.js).
    else if (interaction.commandName === 'baohiem') {
        const user = db.users[uid];
        ensureNewFeatureFields(db, user);

        if (user.insurance) {
            return interaction.reply({
                content: `🛡️ **[BẢO HIỂM TÍN DỤNG ĐEN]** Bạn đang sở hữu sẵn 1 lượt bảo hiểm chưa dùng tới, chưa cần mua thêm đâu!`,
                ephemeral: true
            });
        }
        if (user.money < INSURANCE_PRICE) {
            return interaction.reply({
                content: `❌ **[BẢO HIỂM TÍN DỤNG ĐEN]** Số dư không đủ! Cần \`${INSURANCE_PRICE.toLocaleString('vi-VN')} Yên\` để mua bảo hiểm (Hiện có: \`${user.money.toLocaleString('vi-VN')} Yên\`).`,
                ephemeral: true
            });
        }

        user.money -= INSURANCE_PRICE;
        user.insurance = true;
        db.economy.total_sink += INSURANCE_PRICE;
        logTransaction(db, { type: 'baohiem', uid, amount: -INSURANCE_PRICE, detail: 'Mua Bảo Hiểm Tín Dụng Đen' });
        saveDB(db);

        return interaction.reply({
            content: `🛡️ **[BẢO HIỂM TÍN DỤNG ĐEN — MUA THÀNH CÔNG]**\n💸 Đã trừ \`${INSURANCE_PRICE.toLocaleString('vi-VN')} Yên\` ra khỏi ví.\n🎀 **Nino:** \"Biết lo xa phòng thân cũng tốt đấy. Lần tới nợ Tài Xỉu mà quá hạn, bảo hiểm này sẽ tự động cứu bạn khỏi bị Băng Đảng xử một lần duy nhất, nhưng đừng có ỷ y mà vay nóng linh tinh nữa nhé!\"\n💳 Số dư còn lại: \`${user.money.toLocaleString('vi-VN')} Yên\``,
            ephemeral: true
        });
    }

    // ====== [TÍNH NĂNG MỚI] /doimau — Đổi Màu Tên Hiển Thị qua Role Discord (Tiêu tiền / Money Sink) ======
    else if (interaction.commandName === 'doimau') {
        if (!interaction.guild || !interaction.member) {
            return interaction.reply({ content: "❌ **[ĐỔI MÀU TÊN]** Lệnh này chỉ dùng được trong server, không dùng được qua DM!", ephemeral: true });
        }

        const colorInput = interaction.options.getString('color').trim();
        const hexRegex = /^#?[0-9A-Fa-f]{6}$/;
        if (!hexRegex.test(colorInput)) {
            return interaction.reply({ content: "❌ **[ĐỔI MÀU TÊN]** Mã màu không hợp lệ! Hãy nhập đúng định dạng mã HEX, ví dụ: `#FF69B4`.", ephemeral: true });
        }
        const hexColor = colorInput.startsWith('#') ? colorInput : `#${colorInput}`;

        const user = db.users[uid];
        ensureNewFeatureFields(db, user);

        if (user.money < DOIMAU_PRICE) {
            return interaction.reply({
                content: `❌ **[ĐỔI MÀU TÊN]** Số dư không đủ! Cần \`${DOIMAU_PRICE.toLocaleString('vi-VN')} Yên\` (Hiện có: \`${user.money.toLocaleString('vi-VN')} Yên\`).`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            if (!db.colorRoleIds) db.colorRoleIds = {};
            const mapKey = `${interaction.guild.id}_${uid}`;
            let role = null;
            const existingRoleId = db.colorRoleIds[mapKey];
            if (existingRoleId) {
                role = interaction.guild.roles.cache.get(existingRoleId) || await interaction.guild.roles.fetch(existingRoleId).catch(() => null);
            }

            if (role) {
                await role.setColor(hexColor, "Đổi màu tên qua lệnh /doimau");
            } else {
                role = await interaction.guild.roles.create({
                    name: `🎨 ${interaction.user.username}`,
                    color: hexColor,
                    mentionable: false,
                    reason: "Tạo role màu tên cá nhân qua lệnh /doimau"
                });
                db.colorRoleIds[mapKey] = role.id;
            }

            if (!interaction.member.roles.cache.has(role.id)) {
                await interaction.member.roles.add(role);
            }

            user.money -= DOIMAU_PRICE;
            db.economy.total_sink += DOIMAU_PRICE;
            logTransaction(db, { type: 'doimau', uid, amount: -DOIMAU_PRICE, detail: `Đổi màu tên thành ${hexColor}` });
            saveDB(db);

            await interaction.editReply({
                content: `🎨 **[ĐỔI MÀU TÊN THÀNH CÔNG]** Tên hiển thị của bạn giờ mang màu \`${hexColor}\`!\n💸 Đã trừ \`${DOIMAU_PRICE.toLocaleString('vi-VN')} Yên\` ra khỏi ví.\n🎀 **Nino:** \"Màu này đẹp đấy, hợp với bạn lắm!\"\n💳 Số dư còn lại: \`${user.money.toLocaleString('vi-VN')} Yên\``,
            });
        } catch (err) {
            console.error("Lỗi đổi màu tên:", err.message);
            await interaction.editReply({ content: "❌ **[ĐỔI MÀU TÊN]** Có lỗi xảy ra (có thể bot thiếu quyền \"Manage Roles\" hoặc role của bot đang thấp hơn role muốn tạo)! Vui lòng báo Admin kiểm tra lại." });
        }
    }
}

module.exports = { handleInteraction };