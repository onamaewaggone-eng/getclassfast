const DAY_ORDER = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const EVENING_HOURS = ["18h", "19h", "20h", "21h"];
const WEEKEND_DAY_HOURS = ["08h", "09h", "10h", "14h", "15h", "16h", "17h"];

const DEFAULT_CONFIG = {
  master_active: true,
  level_mode: "TB_YEU_COBAN", // TB_YEU_COBAN | ONLY_WEAK | ALL
  block_difficult: true,
  portal_token: "",
  grades: { "7": false, "8": true, "9": true, "10": false },
  slots: {
    "T2_19h": true,
    "T3_19h": true,
    "T3_20h": true
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

    const gradeRow = ["7", "8", "9", "10"].map((g) => ({
      text: `${config.grades[g] ? "🟢" : "⬜"} Lớp ${g}`,
      callback_data: `GRADE_${g}`
    }));

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

    rows.push([
      {
        text: tab === "EVENING" ? "☀️ Xem giờ Sáng/Chiều T7-CN" : "🌙 Xem giờ Tối T2-CN (18h-21h)",
        callback_data: tab === "EVENING" ? "OPEN_PICKER_WEEKEND" : "OPEN_PICKER_EVENING"
      }
    ]);

    rows.push([
      { text: "⚡ Bật hết tối T2-CN", callback_data: `BULK_ALL_EVENING_${tab}` },
      { text: "🗑 Bỏ chọn tất cả", callback_data: `BULK_CLEAR_${tab}` }
    ]);

    rows.push([{ text: "✅ XONG & QUAY LẠI MENU", callback_data: "BACK_MENU" }]);

    return {
      text:
        `📅 <b>CHỌN NHIỀU KHUNG GIỜ TRỐNG</b>\n` +
        `Chạm vào từng giờ để bật (🟢) hoặc tắt (⬜). Bấm tên Thứ (VD: <b>T3</b>) để bật/tắt cả buổi tối ngày đó:`,
      reply_markup: { inline_keyboard: rows }
    };
  }

  // Hàm lõi phân tích nội dung mail & chốt lớp
  async function processEmail(rawText, isManualTest = false) {
    const config = await getConfig();
    if (!config.master_active) {
      return { ok: false, reason: "Bot đang ở trạng thái TẠM DỪNG." };
    }

    const classId = (rawText.match(/ID tìm Mentor\/Gia sư:\s*(\d+)/i) || [])[1];
    const monHoc = (rawText.match(/Môn:\s*(.+)/i) || [])[1] || "";
    const lichHoc = (rawText.match(/Thời gian học thật:\s*(.+)/i) || [])[1] || "";
    const ghiChu = (rawText.match(/Ghi chú:\s*(.+)/i) || [])[1] || "";
    const namSinh = (rawText.match(/Năm sinh học viên:\s*(\d{4})/i) || [])[1] || "";

    if (!classId) return { ok: false, reason: "Không tìm thấy ID lớp trong mail." };

    if (config.block_difficult && /đổi\s*gs|đổi\s*gia\s*sư|gs\s*nữ|gia\s*sư\s*nữ/i.test(ghiChu)) {
      return { ok: false, reason: `Chặn lớp ${classId}: Dính từ khóa Đổi GS hoặc GS nữ.` };
    }

    let detectedGrade = (monHoc.match(/(?:lớp|khtn|hóa|học)\s*(7|8|9|10)\b/i) || [])[1];
    if (!detectedGrade && namSinh) {
      const g = 2021 - parseInt(namSinh, 10);
      if (g >= 7 && g <= 10) detectedGrade = String(g);
    }
    if (!detectedGrade || !config.grades[detectedGrade]) {
      return { ok: false, reason: `Chặn lớp ${classId}: Khối ${detectedGrade || "?"} đang tắt.` };
    }

    const requiredSlots = extractSlotKeys(lichHoc);
    const isAvailable = requiredSlots.length > 0 && requiredSlots.every((s) => config.slots[s] === true);
    if (!isAvailable) {
      return {
        ok: false,
        reason: `Bỏ qua lớp ${classId}: Khung [${requiredSlots.join(", ") || "Không rõ"}] chưa bật hoặc đã bị khóa.`
      };
    }

    const combinedInfo = `${monHoc} ${ghiChu}`;
    const isHighLevel = /nâng\s*cao|chuyên|hsg|học\s*sinh\s*giỏi|bồi\s*dưỡng|ôn\s*thi\s*chuyên/i.test(combinedInfo);
    const isWeakOrAvg = /trung\s*bình|yếu|kém|mất\s*gốc|hổng|chậm|lấy\s*lại\s*gốc/i.test(combinedInfo);

    if (config.level_mode === "TB_YEU_COBAN" && isHighLevel) {
      return { ok: false, reason: `Chặn lớp ${classId}: Lớp Nâng cao / Chuyên.` };
    }
    if (config.level_mode === "ONLY_WEAK" && !isWeakOrAvg) {
      return { ok: false, reason: `Bỏ qua lớp ${classId}: Không ghi rõ TB/Yếu/Mất gốc.` };
    }

    let claimSuccess = false;
    if (DRY_RUN || isManualTest) {
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
      requiredSlots.forEach((s) => delete config.slots[s]);
      await updateConfig(config);

      const tag = DRY_RUN || isManualTest ? "🧪 [TEST] " : "🎉 ";
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
      return { ok: true, reason: `Đã chốt lớp ${classId}, khóa khung ${requiredSlots.join(", ")}` };
    }

    return { ok: false, reason: `Gọi API chốt lớp ${classId} thất bại.` };
  }

  // =========================================================================
  // 1. TEST QUA TRÌNH DUYỆT (Hỗ trợ ?test=good&lich=T2%2019h00-20h00)
  // =========================================================================
  if (req.method === "GET") {
    const testType = req.query?.test;
    if (testType === "bad") {
      const result = await processEmail(
        `ID tìm Mentor/Gia sư: 69169\nMôn: Hóa học lớp 9 - Cơ bản\nThời gian học thật: T2 19h00-20h00\nGhi chú: Đổi GS. Yêu cầu: GS NỮ`,
        true
      );
      return res.status(200).json(result);
    }
    if (testType === "good") {
      const customLich = req.query?.lich || "T2 19h00-20h00";
      const result = await processEmail(
        `ID tìm Mentor/Gia sư: 99999\nMôn: Hóa học lớp 9 - Cơ bản\nThời gian học thật: Lịch học: 1b/tuần. ${customLich}\nGhi chú: Học viên lực học trung bình, cần củng cố kiến thức`,
        true
      );
      return res.status(200).json(result);
    }
    return res.status(200).send("Bot săn lớp đang hoạt động.");
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

    // Lệnh TEST trực tiếp trong Telegram (VD: /test T2 19h hoặc /test T3 20h)
    if (text.startsWith("/test")) {
      const rawSched = text.replace("/test", "").trim() || "T2 19h";
      const normSched = rawSched.replace(/(\d{1,2})h(?!\d)/gi, "$1h00");
      const fakeMail =
        `ID tìm Mentor/Gia sư: ${Math.floor(10000 + Math.random() * 90000)}\n` +
        `Môn: Hóa học lớp 9 - Cơ bản\n` +
        `Thời gian học thật: Lịch học: 1b/tuần. ${normSched}\n` +
        `Ghi chú: Học viên lực học trung bình, cần củng cố kiến thức cơ bản`;

      const result = await processEmail(fakeMail, true);
      if (!result.ok) {
        await callTele("sendMessage", {
          chat_id: chatId,
          text: `⚠️ <b>[KẾT QUẢ TEST]</b>\n${result.reason}`
        });
      }
      return res.status(200).send("OK");
    }

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
  // 3. XỬ LÝ MAIL THẬT ĐỔ VỀ TỪ WEBHOOK GMAIL
  // =========================================================================
  const rawText = body.text || body.html || "";
  if (!rawText) return res.status(200).send("Empty payload");

  const result = await processEmail(rawText, false);
  return res.status(200).json(result);
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
