const Groq = require("groq-sdk");
const fs = require("fs");
const config = require("./config.js");
const { loadUserMemory, saveUserMemory, loadDB, saveDB, getAffectionRank, ensureNewFeatureFields } = require("./database");

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

async function askAI(question, userId, displayName) {
    let memory = loadUserMemory(userId);
    
    const db = loadDB();
    const user = db.users[userId] || { points: 0, money: 0, bank: 0, inv: [] };
    db.users[userId] = user; // [TÍNH NĂNG MỚI] đảm bảo tham chiếu được lưu lại vào db
    ensureNewFeatureFields(db, user); // [TÍNH NĂNG MỚI] đảm bảo titles/rareItems/first_interaction_at... luôn tồn tại
    const lore = fs.existsSync("./lore.txt") ? fs.readFileSync("./lore.txt", "utf8") : "Bạn là Nino, một trợ lý AI thân thiện.";
    const rank = getAffectionRank(user.points);
    
    let dynamicTrait = "";
    if (user.points < 200) {
        dynamicTrait = "Mức độ thân thiết hiện tại: Còn khá xa lạ, mới quen. Hãy giữ giọng điệu lịch sự, thân thiện nhưng chưa quá suồng sã.";
    } else if (user.points < 600) {
        dynamicTrait = "Mức độ thân thiết hiện tại: Đã quen biết nhau một thời gian. Hãy trò chuyện thoải mái, vui vẻ, cởi mở hơn.";
    } else if (user.points < 1500) {
        dynamicTrait = "Mức độ thân thiết hiện tại: Đã khá thân thiết, giống bạn bè lâu năm. Hãy trò chuyện gần gũi, thoải mái đùa giỡn nhẹ nhàng.";
    } else {
        dynamicTrait = "Mức độ thân thiết hiện tại: Rất thân thiết. Hãy trò chuyện cực kỳ gần gũi, ấm áp, quan tâm chân thành như một người bạn thân lâu năm.";
    }

    const systemPrompt = `${lore}\n\n[HỆ THỐNG THÂN THIẾT]: ${dynamicTrait}\n\nTHÔNG TIN NGƯỜI DÙNG:\nTên hiển thị: ${displayName}\nCấp độ thân thiết hiện tại: ${rank}\nĐiểm thân thiết: ${user.points.toFixed(2)}\nTài sản: ${user.money} Yên\nTúi đồ: ${user.inv.join(", ")}.
    Quy tắc bắt buộc: 
    1. Phản hồi tự nhiên với tư cách Nino, một trợ lý AI thân thiện, bám sát theo [HỆ THỐNG THÂN THIẾT] ở trên.
    2. Tự đánh giá mức độ thân thiện trong lời nói của người dùng và HOÀN TOÀN tự quyết định việc có cộng/trừ điểm hay không, đây chỉ là khung tham khảo: nếu câu nói thân thiện, dễ chịu -> cộng khoảng +0.5 điểm; nếu thô lỗ, cộc cằn, xúc phạm -> trừ khoảng -2 điểm; nếu bình thường, trung tính -> 0 điểm (không đổi). Quyền đánh giá có thực sự cộng/trừ hay không là do bạn tự quyết định dựa trên ngữ cảnh, không bắt buộc phải áp dụng máy móc.
    3. TUYỆT ĐỐI KHÔNG nhập vai bị lẫn: không đề cập, nhắc tới, hiển thị điểm số, "điểm thân thiết", cấp độ, hay bất kỳ thuật ngữ hệ thống/game nào trong NỘI DUNG câu trả lời — phải trò chuyện hoàn toàn tự nhiên như một trợ lý AI thật đang nói chuyện, không lộ ra đây là một hệ thống có tính điểm.
    4. KHÔNG sử dụng dấu ** hoặc bất kỳ ký hiệu markdown nào để diễn tả hành động/cảm xúc (ví dụ không viết "*cười*", "**vui vẻ**", "*gật đầu*"). Toàn bộ cảm xúc phải được diễn tả bằng chính lời nói và ngữ điệu tự nhiên trong câu thoại.
    5. Format câu trả lời: [POINTS_CHANGE: số_điểm] Nội dung phản hồi. (Riêng phần [POINTS_CHANGE: ...] sẽ bị hệ thống tự động cắt bỏ trước khi gửi cho người dùng nên không tính là vi phạm quy tắc số 3, nhưng phần "Nội dung phản hồi" thì phải tuân thủ tuyệt đối quy tắc số 3 và 4.)`;

    const messages = [{ role: "system", content: systemPrompt }, ...memory.slice(-10), { role: "user", content: question }];
    
    const response = await groq.chat.completions.create({ model: config.MODEL, messages, temperature: 0.8 });
    const fullResponse = response.choices[0].message.content;
    
    const match = fullResponse.match(/\[POINTS_CHANGE:\s*([+-]?[0-9]*\.?[0-9]+)\]/);
    const pChange = match ? parseFloat(match[1]) : 0;
    const answer = fullResponse.replace(/\[POINTS_CHANGE:\s*([+-]?[0-9]*\.?[0-9]+)\]/, "").trim();

    db.users[userId] = { ...user, points: (user.points || 0) + pChange };
    saveDB(db);
    
    memory.push({ role: "user", content: question }, { role: "assistant", content: answer });
    saveUserMemory(userId, memory);
    
    return answer;
}

module.exports = { askAI, groq };