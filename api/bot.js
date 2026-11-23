const DAY_ORDER = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const EVENING_HOURS = ["18h", "19h", "20h", "21h"];
const WEEKEND_DAY_HOURS = ["08h", "09h", "10h", "14h", "15h", "16h", "17h"];

const DEFAULT_CONFIG = {
  master_active: true,
  level_mode: "TB_YEU_COBAN", // TB_YEU_COBAN | ONLY_WEAK | ALL
  block_difficult: true,      // Chặn Đổi GS & Yêu cầu GS nữ
  portal_token: "",
  grades: { "7": false, "8": true, "9": true, "10": false },
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
  const DRY_RUN = process.env.DRY_RUN !== "false";

  async function getConfig() {
    const r = await fetch(`${FIREBASE_URL}/config.json`);
    const data = await r.json();
    if (!data) {
      await updateConfig(DEFAULT_CONFIG);
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    return {
      ...DEFAULT_CONFIG,
      ...data,
      grades: { ...DEFAULT_CONFIG.grades, ...(data.grades || {}) },
      slots: data.slots || {}
    };
  }

  async function updateConfig(newData) {
    await fetch(`${FIREBASE_URL}/config.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newData)
    });
  }

  async function callTele(method, payload) {
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  // Sắp xếp khung giờ chuẩn thứ tự T2 -> CN, giờ tăng dần
  function getSortedActiveSlots(slotsObj) {
    return Object.keys(slotsObj || {})
      .filter((k) => slotsObj[k] === true)
      .sort((a, b) => {
        const [dA, hA] = a.split("_");
        const [dB, hB] = b.split("_");
        const dayDiff = DAY_ORDER.indexOf(dA) - DAY_ORDER.indexOf(dB);
        if (dayDiff !== 0) return dayDiff;
        return parseInt(hA, 10) - parseInt(hB, 10);
      });
  }

  function buildMainMenu(config) {
    const levelLabels = {
      TB_YEU_COBAN: "🎯 Lọc: TB/Yếu/Cơ bản (Né Giỏi/NC)",
      ONLY_WEAK: "🔥 Lọc: Bắt buộc ghi TB/Yếu/Mất gốc",
      ALL: "⚡ Lọc: Nhận mọi học lực"
    };

    // Hàng chọn Khối lớp (7, 8, 9, 10)
    const gradeRow = ["7", "8", "9", "10"].map((g) => ({
      text: `${config.grades[g] ? "🟢" : "⬜"} Lớp ${g}`,
      callback_data: `GRADE_${g}`
    }));

    // Hiển thị các khung giờ ĐANG BẬT (🟢) để tắt nhanh 1 chạm
    const activeSlots = getSortedActiveSlots(config.slots);
    const activeSlotRows = [];
    for (let i = 0; i < activeSlots.length; i += 3) {
      activeSlotRows.push(
        activeSlots.slice(i, i + 3).map((k) => ({
          text: `🟢 ${k.replace("_", " ")}`,
          callback_data: `QUICK_OFF_${k}`
        }))
      );
    }

    const activeCount = activeSlots.length;
    const summaryText =
      `🎛 <b>BẢNG ĐIỀU KHIỂN SĂN LỚP FUNiX</b>\n` +
      `• Trạng thái: <b>${config.master_active ? "ĐANG SĂN (24/7)" : "ĐÃ TẠM DỪNG"}</b>\n` +
      `• Khung giờ đang mở: <b>${activeCount} khung</b>` +
      (activeCount > 0 ? ` (${activeSlots.map((s) => s.replace("_", " ")).join(", ")})` : " <i>(Chưa chọn giờ nào)</i>");

    return {
      text: summaryText,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: config.master_active ? "⏸ TẠM DỪNG TOÀN BỘ BOT" : "▶️ BẬT LẠI SĂN LỚP",
              callback_data: "TOGGLE_MASTER"
            }
          ],
          [
            {
              text: levelLabels[config.level_mode] || levelLabels.TB_YEU_COBAN,
              callback_data: "CYCLE_LEVEL"
            }
          ],
          [
            {
              text: config.block_difficult ? "🛡 Né Đổi GS & GS Nữ: BẬT" : "⚠️ Né Đổi GS & GS Nữ: TẮT",
              callback_data: "TOGGLE_DIFFICULT"
            }
          ],
          gradeRow,
          ...activeSlotRows,
          [
            {
              text: "📅 CHỌN NHIỀU KHUNG GIỜ TRỐNG (+ / -)",
              callback_data: "OPEN_PICKER_EVENING"
            }
          ]
        ]
      }
    };
  }

  // Bảng chọn nhanh nhiều khung giờ trống (Tối T2-CN hoặc Cuối tuần Sáng/Chiều)
  function buildSlotPicker(config, tab = "EVENING") {
    const rows = [];

    if (tab === "EVENING") {
      DAY_ORDER.forEach((day) => {
        const dayBtn = { text: day, callback_data: `TOGGLE_DAY_${day}` };
        const hourBtns = EVENING_HOURS.map((h) => {
          const key = `${day}_${h}`;
          const isOn = !!config.slots[key];
          return {
            text: `${isOn ? "🟢" : "⬜"}${h}`,
            callback_data: `PICK_${tab}_${key}`
          };
        });
        rows.push([dayBtn, ...hourBtns]);
      });
    } else {
      ["T7", "CN"].forEach((day) => {
        rows.push([{ text: `--- ${day} (Sáng & Chiều) ---`, callback_data: "NOOP" }]);
        for (let i = 0; i < WEEKEND_DAY_HOURS.length; i += 4) {
          rows.push(
            WEEKEND_DAY_HOURS.slice(i, i + 4).map((h) => {
              const key = `${day}_${h}`;
              const isOn = !!config.slots[key];
              return {
                text: `${isOn ? "🟢" : "⬜"} ${day} ${h}`,
                callback_data: `PICK_${tab}_${key}`
              };
            })
          );
        }
      });
    }

    // Nút chuyển qua lại giữa Khung Tối và Cuối tuần Sáng/Chiều
    rows.push([
      {
        text: tab === "EVENING" ? "☀️ Xem giờ Sáng/Chiều T7-CN" : "🌙 Xem giờ Tối T2-CN (18h-21h)",
        callback_data: tab === "EVENING" ? "OPEN_PICKER_WEEKEND" : "OPEN_PICKER_EVENING"
      }
    ]);

    // Nút chọn nhanh hàng loạt
    rows.push([
      { text: "⚡ Bật hết tối T2-CN", callback_data: `BULK_ALL_EVENING_${tab}` },
      { text: "🗑 Bỏ chọn tất cả", callback_data: `BULK_CLEAR_${tab}` }
    ]);

    rows.push([{ text: "✅ XONG & QUAY LẠI MENU", callback_data: "BACK_MENU" }]);

    return {
      text:
        `📅 <b>CHỌN NHIỀU KHUNG GIỜ TRỐNG</b>\n` +
        `Chạm vào từng giờ để bật (🟢) hoặc tắt (⬜). Bấm tên Thứ (VD: <b>T7</b>) để bật/tắt cả buổi tối ngày đó:`,
      reply_markup: { inline_keyboard: rows }
    };
  }

  // =========================================================================
  // 1. CHẾ ĐỘ TEST NHANH QUA TRÌNH DUYỆT (?test=good hoặc ?test=bad)
  // =========================================================================
  let incomingEmailText = "";
  if (req.method === "GET") {
    const testType = req.query?.test;
    if (testType === "bad") {
      incomingEmailText = `
        ID tìm Mentor/Gia sư: 69169
        Môn: Hóa học lớp 9 - Cơ bản - Học thử
        Thời gian học thật: Lịch học: 1b/tuần. T7 18h00-19h00
        Ghi chú: KHTN 9 - Đổi GS HV Văn 2k12. Yêu cầu: GS NỮ
      `;
    } else if (testType === "good") {
      incomingEmailText = `
        ID tìm Mentor/Gia sư: 99999
        Môn: Hóa học lớp 9 - Cơ bản
        Thù lao lớp học thật: 63,000
        Thời gian học thật: Lịch học: 1b/tuần. T7 18h00-19h00
        Ghi chú: Học viên ngoan, cần củng cố kiến thức cơ bản
      `;
    } else {
      return res.status(200).send("Bot săn lớp đang hoạt động. Dùng ?test=good hoặc ?test=bad để test.");
    }
  }

  const body = req.body || {};

  // =========================================================================
  // 2. XỬ LÝ LỆNH & NÚT BẤM ĐIỀU KHIỂN TRÊN TELEGRAM
  // =========================================================================
  if (req.method === "POST" && (body.message || body.callback_query)) {
    const chatId = String(body.message?.chat.id || body.callback_query?.message.chat.id);
    if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID) return res.status(200).send("Unauthorized");

    const text = (body.message?.text || "").trim();
    const action = body.callback_query?.data || "";
    const msgId = body.callback_query?.message.message_id;
    let config = await getConfig();

    if (body.callback_query) {
      await callTele("answerCallbackQuery", { callback_query_id: body.callback_query.id });
    }

    if (action === "NOOP") return res.status(200).send("OK");

    // Các thao tác bấm nút -> Sửa trực tiếp tin nhắn hiện tại cho gọn màn hình
    if (action) {
      let view = null;

      if (action === "TOGGLE_MASTER") {
        config.master_active = !config.master_active;
        await updateConfig(config);
        view = buildMainMenu(config);
      } else if (action === "CYCLE_LEVEL") {
        const order = ["TB_YEU_COBAN", "ONLY_WEAK", "ALL"];
        config.level_mode = order[(order.indexOf(config.level_mode) + 1) % order.length];
        await updateConfig(config);
        view = buildMainMenu(config);
      } else if (action === "TOGGLE_DIFFICULT") {
        config.block_difficult = !config.block_difficult;
        await updateConfig(config);
        view = buildMainMenu(config);
      } else if (action.startsWith("GRADE_")) {
        const g = action.replace("GRADE_", "");
        config.grades[g] = !config.grades[g];
        await updateConfig(config);
        view = buildMainMenu(config);
      } else if (action.startsWith("QUICK_OFF_")) {
        const key = action.replace("QUICK_OFF_", "");
        delete config.slots[key];
        await updateConfig(config);
        view = buildMainMenu(config);
      } else if (action === "OPEN_PICKER_EVENING") {
        view = buildSlotPicker(config, "EVENING");
      } else if (action === "OPEN_PICKER_WEEKEND") {
        view = buildSlotPicker(config, "WEEKEND");
      } else if (action === "BACK_MENU") {
        view = buildMainMenu(config);
      } else if (action.startsWith("PICK_")) {
        const [, tab, day, hour] = action.split("_");
        const key = `${day}_${hour}`;
        if (config.slots[key]) delete config.slots[key];
        else config.slots[key] = true;
        await updateConfig(config);
        view = buildSlotPicker(config, tab);
      } else if (action.startsWith("TOGGLE_DAY_")) {
        const day = action.replace("TOGGLE_DAY_", "");
        const allOn = EVENING_HOURS.every((h) => config.slots[`${day}_${h}`]);
        EVENING_HOURS.forEach((h) => {
          if (allOn) delete config.slots[`${day}_${h}`];
          else config.slots[`${day}_${h}`] = true;
        });
        await updateConfig(config);
        view = buildSlotPicker(config, "EVENING");
      } else if (action.startsWith("BULK_ALL_EVENING_")) {
        const tab = action.replace("BULK_ALL_EVENING_", "");
        DAY_ORDER.forEach((d) => EVENING_HOURS.forEach((h) => (config.slots[`${d}_${h}`] = true)));
        await updateConfig(config);
        view = buildSlotPicker(config, tab);
      } else if (action.startsWith("BULK_CLEAR_")) {
        const tab = action.replace("BULK_CLEAR_", "");
        config.slots = {};
        await updateConfig(config);
        view = buildSlotPicker(config, tab);
      }

      if (view && msgId) {
        await callTele("editMessageText", {
          chat_id: chatId,
          message_id: msgId,
          text: view.text,
          parse_mode: "HTML",
          reply_markup: view.reply_markup
        });
      }
      return res.status(200).send("OK");
    }

    // Lệnh gõ nhanh bằng text trên điện thoại (VD: /gio T2 19h 20h, T7 18h 19h)
    if (text.startsWith("/gio ")) {
      const raw = text.replace("/gio ", "").toUpperCase();
      const parts = raw.split(/[,;]+/);
      parts.forEach((p) => {
        const dayMatch = p.match(/T[2-7]|CN/);
        const hours = p.match(/\d{1,2}H/g);
        if (dayMatch && hours) {
          hours.forEach((h) => {
            const normH = String(parseInt(h, 10)).padStart(2, "0") + "h";
            config.slots[`${dayMatch[0]}_${normH}`] = true;
          });
        }
      });
      await updateConfig(config);
      const view = buildMainMenu(config);
      await callTele("sendMessage", { chat_id: chatId, text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
    } else if (text.startsWith("/token ")) {
      config.portal_token = text.replace("/token ", "").trim();
      await updateConfig(config);
      await callTele("sendMessage", { chat_id: chatId, text: "✅ Đã lưu Token Portal mới!" });
    } else if (text === "/menu" || text === "/start") {
      const view = buildMainMenu(config);
      await callTele("sendMessage", { chat_id: chatId, text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
    }
    return res.status(200).send("OK");
  }

  // =========================================================================
  // 3. XỬ LÝ PHÂN TÍCH EMAIL ĐỔ VỀ
  // =========================================================================
  const rawText = incomingEmailText || body.text || body.html || "";
  if (!rawText) return res.status(200).send("Empty payload");

  const config = await getConfig();
  if (!config.master_active) return res.status(200).json({ status: "Bỏ qua: Bot đang tạm dừng" });

  const classId = (rawText.match(/ID tìm Mentor\/Gia sư:\s*(\d+)/i) || [])[1];
  const monHoc = (rawText.match(/Môn:\s*(.+)/i) || [])[1] || "";
  const lichHoc = (rawText.match(/Thời gian học thật:\s*(.+)/i) || [])[1] || "";
  const ghiChu = (rawText.match(/Ghi chú:\s*(.+)/i) || [])[1] || "";
  const namSinh = (rawText.match(/Năm sinh học viên:\s*(\d{4})/i) || [])[1] || "";

  if (!classId) return res.status(200).json({ status: "Không tìm thấy ID lớp" });

  // Bước 1: Chặn Đổi GS & GS Nữ (nếu đang bật)
  if (config.block_difficult && /đổi\s*gs|đổi\s*gia\s*sư|gs\s*nữ|gia\s*sư\s*nữ/i.test(ghiChu)) {
    return res.status(200).json({ status: `Chặn lớp ${classId}: Dính Đổi GS hoặc GS nữ` });
  }

  // Bước 2: Kiểm tra Khối lớp (ưu tiên đọc từ tên Môn, dự phòng suy ra từ Năm sinh)
  let detectedGrade = (monHoc.match(/(?:lớp|khtn|hóa|học)\s*(7|8|9|10)\b/i) || [])[1];
  if (!detectedGrade && namSinh) {
    const g = 2021 - parseInt(namSinh, 10); // Năm học 2026-2027: 2k12 -> lớp 9, 2k13 -> lớp 8
    if (g >= 7 && g <= 10) detectedGrade = String(g);
  }
  if (!detectedGrade || !config.grades[detectedGrade]) {
    return res.status(200).json({ status: `Chặn lớp ${classId}: Khối ${detectedGrade || "?"} đang tắt` });
  }

  // Bước 3: Kiểm tra khung giờ có đang mở (🟢) không
  const requiredSlots = extractSlotKeys(lichHoc);
  const isAvailable = requiredSlots.length > 0 && requiredSlots.every((s) => config.slots[s] === true);
  if (!isAvailable) {
    return res.status(200).json({ status: `Bỏ qua lớp ${classId}: Khung ${requiredSlots.join(", ")} chưa mở` });
  }

  // Bước 4: Lọc học lực theo chế độ đã chọn
  const combinedInfo = `${monHoc} ${ghiChu}`;
  const isHighLevel = /nâng\s*cao|chuyên|hsg|học\s*sinh\s*giỏi|bồi\s*dưỡng|ôn\s*thi\s*chuyên/i.test(combinedInfo);
  const isWeakOrAvg = /trung\s*bình|yếu|kém|mất\s*gốc|hổng|chậm|lấy\s*lại\s*gốc/i.test(combinedInfo);

  if (config.level_mode === "TB_YEU_COBAN" && isHighLevel) {
    return res.status(200).json({ status: `Chặn lớp ${classId}: Lớp Nâng cao / Chuyên` });
  }
  if (config.level_mode === "ONLY_WEAK" && !isWeakOrAvg) {
    return res.status(200).json({ status: `Bỏ qua lớp ${classId}: Không ghi rõ TB/Yếu/Mất gốc` });
  }

  // Bước 5: Chốt lớp (Test hoặc API thật)
  let claimSuccess = false;
  if (DRY_RUN) {
    claimSuccess = true;
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
    // Khóa đúng khung giờ vừa chốt để không nhận trùng
    requiredSlots.forEach((s) => delete config.slots[s]);
    await updateConfig(config);

    const tag = DRY_RUN ? "🧪 [TEST] " : "🎉 ";
    const menu = buildMainMenu(config);
    await callTele("sendMessage", {
      chat_id: ADMIN_CHAT_ID,
      text:
        `${tag}<b>ĐÃ CHỐT LỚP ${classId} (Lớp ${detectedGrade})!</b>\n` +
        `🔒 Đã khóa khung: <b>${requiredSlots.join(", ")}</b>\n` +
        `📚 <b>Môn:</b> ${monHoc.trim()}\n` +
        `⏰ <b>Lịch:</b> ${lichHoc.trim()}\n` +
        `📝 <b>Ghi chú:</b> ${ghiChu.trim()}\n\n` +
        menu.text,
      parse_mode: "HTML",
      reply_markup: menu.reply_markup
    });
    return res.status(200).json({ status: "Thành công", locked_slots: requiredSlots });
  }

  return res.status(200).json({ status: "Gọi API thất bại" });
};

function extractSlotKeys(lichHocStr) {
  const results = [];
  const dayMatches = lichHocStr.match(/T[2-7]|CN/gi) || [];
  const hourMatches = lichHocStr.match(/(\d{1,2})h\d{2}/gi) || [];
  if (dayMatches.length > 0 && hourMatches.length === 1) {
    const h = String(parseInt(hourMatches[0], 10)).padStart(2, "0") + "h";
    dayMatches.forEach((d) => results.push(`${d.toUpperCase()}_${h}`));
  } else if (dayMatches.length === hourMatches.length) {
    dayMatches.forEach((d, i) => {
      const h = String(parseInt(hourMatches[i], 10)).padStart(2, "0") + "h";
      results.push(`${d.toUpperCase()}_${h}`);
    });
  }
  return results;
}
