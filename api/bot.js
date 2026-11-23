const DEFAULT_CONFIG = {
  master_active: true,
  strict_mode: true,
  portal_token: "",
  slots: {
    "T7_18h": true,
    "T7_19h": true,
    "CN_18h": true,
    "CN_19h": true
  }
};

module.exports = async function handler(req, res) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const ADMIN_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "");
  const FIREBASE_URL = process.env.FIREBASE_URL;
  const DRY_RUN = process.env.DRY_RUN !== "false"; // Mặc định true để test an toàn

  // Hàm đọc/ghi cấu hình qua Firebase REST API
  async function getConfig() {
    const r = await fetch(`${FIREBASE_URL}/config.json`);
    const data = await r.json();
    if (!data) {
      await updateConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    return { ...DEFAULT_CONFIG, ...data, slots: data.slots || DEFAULT_CONFIG.slots };
  }

  async function updateConfig(newData) {
    await fetch(`${FIREBASE_URL}/config.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newData)
    });
  }

  async function sendTele(chatId, text, replyMarkup = null) {
    const payload = { chat_id: chatId, text, parse_mode: "HTML" };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function sendTeleMenu(chatId, title, config) {
    const slotKeys = Object.keys(config.slots || {});
    const slotButtons = [];
    for (let i = 0; i < slotKeys.length; i += 2) {
      slotButtons.push(
        slotKeys.slice(i, i + 2).map((k) => ({
          text: `${config.slots[k] ? "🟢" : "🔒"} ${k.replace("_", " ")}`,
          callback_data: `SLOT_${k}`
        }))
      );
    }

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: config.master_active ? "⏸ TẠM DỪNG TOÀN BỘ BOT" : "▶️ BẬT LẠI SĂN LỚP",
            callback_data: "TOGGLE_MASTER"
          }
        ],
        [
          {
            text: config.strict_mode ? "🎯 Lọc: Chỉ HS Yếu/Mất gốc" : "⚡ Lọc: Tất cả lớp 8-9",
            callback_data: "TOGGLE_MODE"
          }
        ],
        ...slotButtons
      ]
    };
    await sendTele(chatId, title, keyboard);
  }

  // =========================================================================
  // 1. CHẾ ĐỘ TEST NHANH TRÊN TRÌNH DUYỆT ĐIỆN THOẠI (?test=good hoặc ?test=bad)
  // =========================================================================
  let incomingEmailText = "";
  if (req.method === "GET") {
    const testType = req.query?.test;
    if (testType === "bad") {
      // Giả lập đúng ca khó trong ảnh (Đổi GS + GS nữ)
      incomingEmailText = `
        ID tìm Mentor/Gia sư: 69169
        Môn: Hóa học lớp 9 - Cơ bản - Học thử
        Thời gian học thật: Lịch học: 1b/tuần. T7 18h00-19h00
        Ghi chú: KHTN 9 - Đổi GS HV Văn 2k12. Yêu cầu: GS NỮ
      `;
    } else if (testType === "good") {
      // Giả lập ca chuẩn khớp kèo (Hóa 9 mất gốc + T7 18h)
      incomingEmailText = `
        ID tìm Mentor/Gia sư: 99999
        Môn: Hóa học lớp 9 - Cơ bản
        Thời gian học thật: Lịch học: 1b/tuần. T7 18h00-19h00
        Ghi chú: Học sinh mất gốc Hóa, lực học trung bình yếu cần kèm sát từ đầu
      `;
    } else {
      return res.status(200).send("Bot săn lớp đang hoạt động. Dùng ?test=good hoặc ?test=bad để chạy thử.");
    }
  }

  const body = req.body || {};

  // =========================================================================
  // 2. XỬ LÝ LỆNH & NÚT BẤM TỪ TELEGRAM TRÊN ĐIỆN THOẠI
  // =========================================================================
  if (req.method === "POST" && (body.message || body.callback_query)) {
    const chatId = String(body.message?.chat.id || body.callback_query?.message.chat.id);
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID) return res.status(200).send("Unauthorized");

    const text = (body.message?.text || "").trim();
    const action = body.callback_query?.data || "";
    let config = await getConfig();

    if (body.callback_query) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: body.callback_query.id })
      });
    }

    if (action === "TOGGLE_MASTER") {
      config.master_active = !config.master_active;
      await updateConfig(config);
      await sendTeleMenu(chatId, config.master_active ? "🟢 <b>ĐÃ BẬT HỆ THỐNG</b>" : "🔴 <b>ĐÃ NGỪNG NHẬN LỚP</b>", config);
    } else if (action === "TOGGLE_MODE") {
      config.strict_mode = !config.strict_mode;
      await updateConfig(config);
      await sendTeleMenu(chatId, "🎯 <b>ĐÃ ĐỔI CHẾ ĐỘ LỌC TỪ KHÓA</b>", config);
    } else if (action.startsWith("SLOT_")) {
      const key = action.replace("SLOT_", "");
      config.slots[key] = !config.slots[key];
      await updateConfig(config);
      await sendTeleMenu(chatId, `⏱ Đã cập nhật khung <b>${key.replace("_", " ")}</b>:`, config);
    } else if (text.startsWith("/add ")) {
      const key = text.replace("/add ", "").trim().toUpperCase();
      config.slots[key] = true;
      await updateConfig(config);
      await sendTeleMenu(chatId, `➕ Đã thêm khung <b>${key.replace("_", " ")}</b>:`, config);
    } else if (text.startsWith("/del ")) {
      const key = text.replace("/del ", "").trim().toUpperCase();
      delete config.slots[key];
      await updateConfig(config);
      await sendTeleMenu(chatId, `🗑 Đã xóa khung <b>${key.replace("_", " ")}</b>:`, config);
    } else if (text.startsWith("/token ")) {
      config.portal_token = text.replace("/token ", "").trim();
      await updateConfig(config);
      await sendTele(chatId, "✅ Đã lưu Token Portal mới!");
    } else if (text === "/menu" || text === "/start") {
      await sendTeleMenu(chatId, "🎛 <b>BẢNG ĐIỀU KHIỂN SĂN LỚP FUNiX</b>", config);
    }
    return res.status(200).send("OK");
  }

  // =========================================================================
  // 3. XỬ LÝ PHÂN TÍCH MAIL (TỪ WEBHOOK THẬT HOẶC TỪ LINK ?test=)
  // =========================================================================
  const rawText = incomingEmailText || body.text || body.html || "";
  if (!rawText) return res.status(200).send("Empty payload");

  const config = await getConfig();
  if (!config.master_active) return res.status(200).json({ status: "Bỏ qua: Bot đang tạm dừng" });

  const classId = (rawText.match(/ID tìm Mentor\/Gia sư:\s*(\d+)/i) || [])[1];
  const monHoc = (rawText.match(/Môn:\s*(.+)/i) || [])[1] || "";
  const lichHoc = (rawText.match(/Thời gian học thật:\s*(.+)/i) || [])[1] || "";
  const ghiChu = (rawText.match(/Ghi chú:\s*(.+)/i) || [])[1] || "";

  if (!classId) return res.status(200).json({ status: "Không tìm thấy ID lớp" });

  // Lớp 1: Chặn Đổi GS & Yêu cầu GS nữ
  if (/đổi\s*gs|đổi\s*gia\s*sư|gs\s*nữ|gia\s*sư\s*nữ/i.test(ghiChu)) {
    return res.status(200).json({ status: `Đã chặn lớp ${classId}: Dính từ khóa Đổi GS hoặc GS nữ` });
  }

  // Lớp 2: Kiểm tra khối 8, 9
  if (!/(lớp\s*8|lớp\s*9|khtn\s*8|khtn\s*9|hóa\s*8|hóa\s*9)/i.test(monHoc)) {
    return res.status(200).json({ status: `Đã chặn lớp ${classId}: Không phải khối 8-9` });
  }

  // Lớp 3: Kiểm tra khung giờ còn trống (🟢)
  const requiredSlots = extractSlotKeys(lichHoc);
  const isAvailable = requiredSlots.length > 0 && requiredSlots.every((s) => config.slots[s] === true);
  if (!isAvailable) {
    return res.status(200).json({ status: `Bỏ qua lớp ${classId}: Khung ${requiredSlots.join(", ")} đã khóa hoặc chưa bật` });
  }

  // Lớp 4: Kiểm tra từ khóa mất gốc / yếu / trung bình
  const hasPriority = /mất\s*gốc|trung\s*bình|kém|yếu|hổng|chậm|lấy\s*lại\s*gốc/i.test(ghiChu + " " + monHoc);
  if (config.strict_mode && !hasPriority) {
    await sendTele(ADMIN_CHAT_ID, `ℹ️ Lớp 8-9 khớp lịch <b>${requiredSlots.join(", ")}</b> (không ghi mất gốc):\n📚 ${monHoc.trim()}\n📝 ${ghiChu.trim()}`);
    return res.status(200).json({ status: "Chỉ gửi thông báo, không tự bấm" });
  }

  // Bước chốt đơn (Chế độ Test hoặc Bắn API thật)
  let claimSuccess = false;
  if (DRY_RUN) {
    claimSuccess = true; // Giả lập chốt thành công
  } else {
    const claimRes = await fetch("URL_API_NHAN_LOP_CUA_FUNIX", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.portal_token}`
      },
      body: JSON.stringify({ id: Number(classId) })
    });
    claimSuccess = claimRes.ok;
  }

  if (claimSuccess) {
    requiredSlots.forEach((s) => (config.slots[s] = false));
    await updateConfig(config);

    const tag = DRY_RUN ? "🧪 [CHẾ ĐỘ TEST] " : "🎉 ";
    await sendTeleMenu(
      ADMIN_CHAT_ID,
      `${tag}<b>ĐÃ CHỐT LỚP ${classId}!</b>\n🔒 Đã tự khóa khung: <b>${requiredSlots.join(", ")}</b>\n📚 <b>Môn:</b> ${monHoc.trim()}\n⏰ <b>Lịch:</b> ${lichHoc.trim()}\n📝 <b>Ghi chú:</b> ${ghiChu.trim()}`,
      config
    );
    return res.status(200).json({ status: "Thành công", locked_slots: requiredSlots });
  }

  return res.status(200).json({ status: "Gọi API thất bại" });
};

function extractSlotKeys(lichHocStr) {
  const results = [];
  const dayMatches = lichHocStr.match(/T[2-7]|CN/gi) || [];
  const hourMatches = lichHocStr.match(/(\d{1,2})h\d{2}/gi) || [];
  if (dayMatches.length > 0 && hourMatches.length === 1) {
    const h = hourMatches[0].match(/(\d{1,2})h/i)[1] + "h";
    dayMatches.forEach((d) => results.push(`${d.toUpperCase()}_${h}`));
  } else if (dayMatches.length === hourMatches.length) {
    dayMatches.forEach((d, i) => {
      const h = hourMatches[i].match(/(\d{1,2})h/i)[1] + "h";
      results.push(`${d.toUpperCase()}_${h}`);
    });
  }
  return results;
}
