const { SlashCommandBuilder } = require('discord.js');

const commandsList = [
    new SlashCommandBuilder().setName('work').setDescription('Đi làm kiếm lương khởi điểm 2,000 Yên (Cooldown 5 phút)'),
    new SlashCommandBuilder().setName('shop').setDescription('Xem danh sách cửa hàng ngẫu nhiên xoay tua 30 phút'),
    
    new SlashCommandBuilder().setName('bank').setDescription('Quản lý tài sản (Gửi/Rút tiền tiết kiệm)')
        .addStringOption(option => 
            option.setName('action')
                .setDescription('Chọn hành động muốn thực hiện')
                .setRequired(true)
                .addChoices(
                    { name: '💰 Gửi tiền (Deposit)', value: 'deposit' },
                    { name: '💸 Rút tiền (Withdraw)', value: 'withdraw' }
                ))
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('Số tiền Yên muốn giao dịch')
                .setRequired(true)),

    new SlashCommandBuilder().setName('date').setDescription('Cùng Nino đi chơi với các hoạt động ngẫu nhiên từ AI (Cooldown 1 tiếng)'),
    new SlashCommandBuilder().setName('inv').setDescription('Kiểm tra túi đồ và tài sản Yên hiện có'),
    new SlashCommandBuilder().setName('affection').setDescription('Kiểm tra cấp độ thân thiết và điểm thân thiết'),
    new SlashCommandBuilder().setName('daily').setDescription('Nhận quà lì xì may mắn hàng ngày (24 giờ một lần)'),
    new SlashCommandBuilder().setName('taixiu').setDescription('Sòng bạc Tài Xỉu thế giới ngầm (Tích hợp hệ thống Vay Nóng Tín Dụng Đen)')
        .addIntegerOption(option => option.setName('bet').setDescription('Số tiền Yên muốn cược').setRequired(true)),
    new SlashCommandBuilder().setName('gift').setDescription('Mở GUI kho đồ cá nhân để bấm chọn quà tặng gửi Nino'),
    new SlashCommandBuilder().setName('testgreet').setDescription('🤖 (Admin Test) Ép Nino gửi lời chào tự động ngay lập tức'),
    new SlashCommandBuilder().setName('mn').setDescription('Gọi Nino chúc buổi sáng vào kênh chung (Dựa trên mức thân thiết tối đa)'),
    new SlashCommandBuilder().setName('gn').setDescription('Gọi Nino chúc ngủ ngon vào kênh chung (Dựa trên mức thân thiết tối đa)'),

    // ====== [TÍNH NĂNG MỚI] Kiếm tiền & Tiêu tiền cân bằng kinh tế ======
    new SlashCommandBuilder().setName('cauca').setDescription('🎣 Đi câu cá kiếm thêm Yên (Cooldown 10 phút)'),
    new SlashCommandBuilder().setName('danhhieu').setDescription('🏷️ Mở cửa hàng Danh Hiệu VIP — tiêu Yên để đổi danh hiệu vĩnh viễn'),

    // ====== [TÍNH NĂNG MỚI] Hồ sơ & Tiện ích ======
    new SlashCommandBuilder().setName('profile').setDescription('🪪 Xem hồ sơ đầy đủ: điểm, hạng, tài sản, danh hiệu, huy hiệu, kỷ niệm'),
    new SlashCommandBuilder().setName('help').setDescription('📖 Danh sách đầy đủ tất cả lệnh của bot'),
    new SlashCommandBuilder().setName('top').setDescription('🏆 Bảng xếp hạng điểm thân mật Top 10 ngay trong Discord'),

    // ====== [TÍNH NĂNG MỚI] Thám hiểm đồ hiếm (AI tạo tên/mô tả) ======
    new SlashCommandBuilder().setName('khampha').setDescription('🗺️ Đi thám hiểm tìm đồ hiếm (AI tự sáng tạo, Cooldown 30 phút)'),

    // ====== [TÍNH NĂNG MỚI] Chợ trời — mua bán/trao đổi vật phẩm giữa người chơi ======
    new SlashCommandBuilder().setName('market')
        .setDescription('🛒 Chợ trời — mua bán đồ hiếm & vật phẩm giữa người chơi')
        .addSubcommand(sub => sub.setName('sell').setDescription('Đăng bán 1 đồ hiếm của bạn lên chợ')
            .addStringOption(o => o.setName('item_id').setDescription('Mã đồ hiếm (xem trong /inv)').setRequired(true))
            .addIntegerOption(o => o.setName('price').setDescription('Giá bán mong muốn (Yên)').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('Xem danh sách đồ hiếm đang được rao bán'))
        .addSubcommand(sub => sub.setName('cancel').setDescription('Hủy bài rao bán của bạn')
            .addStringOption(o => o.setName('item_id').setDescription('Mã đồ hiếm muốn hủy bán').setRequired(true))),

    // ====== [TÍNH NĂNG MỚI] Chuyển tiền & tặng vật phẩm trực tiếp giữa người chơi ======
    new SlashCommandBuilder().setName('transfer').setDescription('💸 Chuyển Yên cho người chơi khác (mất phí giao dịch nhỏ)')
        .addUserOption(o => o.setName('target').setDescription('Người nhận tiền').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Số Yên muốn chuyển').setRequired(true)),
    new SlashCommandBuilder().setName('give').setDescription('🎁 Tặng trực tiếp 1 đồ hiếm cho người chơi khác (miễn phí)')
        .addUserOption(o => o.setName('target').setDescription('Người nhận đồ hiếm').setRequired(true))
        .addStringOption(o => o.setName('item_id').setDescription('Mã đồ hiếm muốn tặng (xem trong /inv)').setRequired(true)),

    // ====== [TÍNH NĂNG MỚI] Thêm 2 chức năng Tiêu Tiền (Money Sink) ======
    new SlashCommandBuilder().setName('baohiem').setDescription('🛡️ Mua bảo hiểm tránh bị Băng Đảng "tẩn" khi nợ quá hạn Tài Xỉu (Tiêu Yên)'),
    new SlashCommandBuilder().setName('doimau').setDescription('🎨 Tiêu Yên để đổi màu tên hiển thị (role riêng) trong server')
        .addStringOption(o => o.setName('color').setDescription('Mã màu HEX muốn đổi, ví dụ: #FF69B4').setRequired(true))
];

module.exports = commandsList;