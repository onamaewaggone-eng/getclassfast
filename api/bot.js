const DAY_ORDER = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const EVENING_HOURS = ["18h", "19h", "20h", "21h"];
const WEEKEND_DAY_HOURS = ["08h", "09h", "10h", "14h", "15h", "16h", "17h"];

const DEFAULT_CONFIG = {
  master_active: true,
  level_mode: "TB_YEU_COBAN",
  block_difficult: true,
  portal_cookie: "",
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

  function extractPortalLink(html, text) {
    if (html) {
      const anchorRegex = /<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      for (const match of html.matchAll(anchorRegex)) {
        const url = match[1].replace(/&amp;/g, "&").trim();
        const innerText = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (/NHẤN ĐỂ TRUY CẬP PORTAL/i.test(innerText)) {
          return url;
        }
      }
      const fallbackHtml = html.match(/href=["'](https?:\/\/[^"']*(?:portal|funix)[^"']*)["']/i);
      if (fallbackHtml && fallbackHtml[1]) {
        return fallbackHtml[1].replace(/&amp;/g, "&").trim();
      }
    }
    if (text) {
      const textMatch = text.match(/https?:\/\/[^\s<>"]+/i);
      if (textMatch) return textMatch[0].trim();
    }
    return "";
  }

  // Hàm lõi phân tích nội dung mail & khớp lịch đa định dạng
  async function processEmail(rawText, rawHtml = "", isManualTest = false) {
    const config = await getConfig();
    if (!config.master_active) {
      return { ok: false, reason: "Bot đang ở trạng thái TẠM DỪNG." };
    }

    const plainFromHtml = rawHtml
      ? rawHtml
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
      : "";
    const searchableText = `${rawText || ""}\n${plainFromHtml}`;

    const classId = (searchableText.match(/ID tìm Mentor\/Gia sư:\s*(\d+)/i) || [])[1];
    const monHoc = (searchableText.match(/Môn:\s*(.+)/i) || [])[1] || "";
    const lichHoc = (searchableText.match(/Thời gian học thật:\s*(.+)/i) || [])[1] || "";
    const batDauBlock = (searchableText.match(/Thời gian bắt đầu học:\s*([\s\S]*?)(?=Thời gian học thật:|Thời lượng:|$)/i) || [])[1] || "";
    const ghiChu = (searchableText.match(/Ghi chú:\s*(.+)/i) || [])[1] || "";
    const namSinh = (searchableText.match(/Năm sinh học viên:\s*(\d{4})/i) || [])[1] || "";
    const portalLink = extractPortalLink(rawHtml, rawText);

    if (!classId) return { ok: false, reason: "Không tìm thấy ID lớp trong mail." };

    // 1. Chặn Đổi GS & Yêu cầu GS Nữ
    if (config.block_difficult && /đổi\s*gs|đổi\s*gia\s*sư|gs\s*nữ|gia\s*sư\s*nữ/i.test(ghiChu)) {
      return { ok: false, reason: `Chặn lớp ${classId}: Dính từ khóa Đổi GS hoặc GS nữ.` };
    }

    // 2. Kiểm tra Khối lớp (từ Môn hoặc suy ra từ Năm sinh)
    let detectedGrade = (monHoc.match(/(?:lớp|khtn|hóa|học)\s*(7|8|9|10)\b/i) || [])[1];
    if (!detectedGrade && namSinh) {
      const g = 2021 - parseInt(namSinh, 10);
      if (g >= 7 && g <= 10) detectedGrade = String(g);
    }
    if (!detectedGrade || !config.grades[detectedGrade]) {
      return { ok: false, reason: `Chặn lớp ${classId}: Khối ${detectedGrade || "?"} đang tắt.` };
    }

    // 3. Phân tích lịch học (hỗ trợ cả Thứ, Khoảng rảnh "18h-21h thứ 2-3-4-6-7", và Ngày dd/mm/yyyy)
    const scheduleInfo = parseScheduleInfo(lichHoc, batDauBlock);
    if (scheduleInfo.candidateSlots.length === 0) {
      return {
        ok: false,
        reason: `Bỏ qua lớp ${classId}: Không nhận diện được ngày/giờ từ "${lichHoc.trim() || batDauBlock.trim()}".`
      };
    }

    let matchedSlots = [];
    if (scheduleInfo.isFlexible) {
      // Lịch dạng "rảnh: Từ 18h-21h thứ 2-3-4-6-7, tuần 2b" -> tìm các khung đang mở (🟢) của bạn nằm trong vùng rảnh
      const openCandidates = scheduleInfo.candidateSlots.filter((s) => config.slots[s] === true);
      // Ưu tiên chọn các ngày khác nhau trước (tránh xếp dồn 2 buổi vào cùng 1 tối)
      const picked = [];
      const usedDays = new Set();
      for (const slot of openCandidates) {
        const d = slot.split("_")[0];
        if (!usedDays.has(d)) {
          picked.push(slot);
          usedDays.add(d);
          if (picked.length >= scheduleInfo.sessionsNeeded) break;
        }
      }
      if (picked.length < scheduleInfo.sessionsNeeded) {
        for (const slot of openCandidates) {
          if (!picked.includes(slot)) {
            picked.push(slot);
            if (picked.length >= scheduleInfo.sessionsNeeded) break;
          }
        }
      }
      if (picked.length >= scheduleInfo.sessionsNeeded) {
        matchedSlots = picked;
      }
    } else {
      // Lịch cố định (VD: "T7 18h00-19h00" hoặc "ngày 25/11/2026 19h00-20h00")
      const allOpen = scheduleInfo.candidateSlots.every((s) => config.slots[s] === true);
      if (allOpen) matchedSlots = scheduleInfo.candidateSlots;
    }

    if (matchedSlots.length === 0) {
      return {
        ok: false,
        reason:
          `Bỏ qua lớp ${classId}: Lịch yêu cầu [${scheduleInfo.candidateSlots.join(", ")}] ` +
          `(${scheduleInfo.isFlexible ? `cần ${scheduleInfo.sessionsNeeded}b` : "cố định"}) không khớp giờ trống của bạn.`
      };
    }

    // 4. Lọc học lực
    const combinedInfo = `${monHoc} ${ghiChu}`;
    const isHighLevel = /nâng\s*cao|chuyên|hsg|học\s*sinh\s*giỏi|bồi\s*dưỡng|ôn\s*thi\s*chuyên/i.test(combinedInfo);
    const isWeakOrAvg = /trung\s*bình|yếu|kém|mất\s*gốc|hổng|chậm|lấy\s*lại\s*gốc|chưa\s*theo\s*kịp|không\s*theo\s*kịp|[0-6](?:[.,]\d)?\s*đ/i.test(combinedInfo);

    if (config.level_mode === "TB_YEU_COBAN" && isHighLevel) {
      return { ok: false, reason: `Chặn lớp ${classId}: Lớp Nâng cao / Chuyên.` };
    }
    if (config.level_mode === "ONLY_WEAK" && !isWeakOrAvg) {
      return { ok: false, reason: `Bỏ qua lớp ${classId}: Không ghi rõ TB/Yếu/Mất gốc.` };
    }

    // 5. Tự động click link giữ chỗ
    let clickStatusNote = "";
    if (DRY_RUN || isManualTest) {
      clickStatusNote = "🧪 [TEST] Đã giả lập click link giữ chỗ.";
    } else if (portalLink) {
      try {
        const headers = {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        };
        if (config.portal_cookie) headers["Cookie"] = config.portal_cookie;

        const clickRes = await fetch(portalLink, { method: "GET", redirect: "follow", headers });
        const finalUrl = clickRes.url || portalLink;
        if (/login|signin|auth/i.test(finalUrl)) {
          clickStatusNote = "⚠️ Link yêu cầu đăng nhập — hãy bấm ngay nút bên dưới để mở trên Safari!";
        } else {
          clickStatusNote = `⚡ Đã tự click link giữ chỗ (HTTP ${clickRes.status}) — bấm nút bên dưới để xác nhận ngay!`;
        }
      } catch (err) {
        clickStatusNote = `⚠️ Lỗi tự mở link (${err.message}) — bấm nút bên dưới mở ngay!`;
      }
    } else {
      clickStatusNote = "⚠️ Không tìm thấy URL trong mail — mở Gmail bấm ngay!";
    }

    // Khóa đúng các khung giờ đã khớp
    matchedSlots.forEach((s) => delete config.slots[s]);
    await updateConfig(config);

    const tag = DRY_RUN || isManualTest ? "🧪 [TEST] " : "🚨 ";
    const linkRow = portalLink
      ? [[{ text: "👉 MỞ LINK GIỮ CHỖ TRÊN SAFARI NGAY", url: portalLink }]]
      : [];

    await callTele("sendMessage", {
      chat_id: ADMIN_CHAT_ID,
      text:
        `${tag}<b>ĐÃ KHỚP & GIỮ CHỖ LỚP ${classId} (Lớp ${detectedGrade})!</b>\n` +
        `${clickStatusNote}\n` +
        `🔒 Đã khóa khung: <b>${matchedSlots.join(", ")}</b>\n` +
        `📚 <b>Môn:</b> ${monHoc.trim()}\n` +
        `⏰ <b>Lịch mail:</b> ${lichHoc.trim() || batDauBlock.trim()}\n` +
        `📝 <b>Ghi chú:</b> ${ghiChu.trim()}`,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: linkRow.length > 0 ? { inline_keyboard: linkRow } : undefined
    });

    return { ok: true, reason: `Đã xử lý lớp ${classId}`, matchedSlots, portalLink };
  }

  // =========================================================================
  // 1. GET REQUEST
  // =========================================================================
  if (req.method === "GET") {
    return res.status(200).send("Bot săn lớp (Hỗ trợ lịch rảnh & ngày dương lịch) đang hoạt động.");
  }

  const body = req.body || {};

  // =========================================================================
  // 2. XỬ LÝ LỆNH & NÚT BẤM TRÊN TELEGRAM
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

    // Lệnh /test: Nếu gõ "/test" không kèm gì sẽ test đúng mẫu mail "18h-21h thứ 2-3-4-6-7, tuần 2b"
    if (text.startsWith("/test")) {
      const customLich = text.replace("/test", "").trim();
      const fakeText = customLich
        ? `ID tìm Mentor/Gia sư: ${Math.floor(10000 + Math.random() * 90000)}\n` +
          `Môn: Hóa học lớp 9 - Cơ bản\n` +
          `Thời gian học thật: ${customLich}\n` +
          `Ghi chú: Học viên lực học trung bình, cần củng cố kiến thức cơ bản`
        : `ID tìm Mentor/Gia sư: 69647\n` +
          `Môn: Hóa học lớp 9 - Cơ bản - Học thử\n` +
          `Thời gian bắt đầu học: Từ 18:00 tới 19:00 ngày 24/11/2026\n` +
          `Thời gian học thật: rảnh: Từ 18h-21h thứ 2-3-4-6-7 , tuần 2b\n` +
          `Ghi chú: hóa 9, thi giữa kì 5,5d, chưa theo kịp các bạn, muốn nhờ gs hỗ trợ cơ bản`;
      const fakeHtml = `<a href="https://portal.funix.edu.vn/">NHẤN ĐỂ TRUY CẬP PORTAL</a>`;

      const result = await processEmail(fakeText, fakeHtml, true);
      if (!result.ok) {
        await callTele("sendMessage", {
          chat_id: chatId,
          text: `⚠️ <b>[KẾT QUẢ TEST]</b>\n${result.reason}`,
          parse_mode: "HTML"
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
    } else if (text.startsWith("/cookie ")) {
      config.portal_cookie = text.replace("/cookie ", "").trim();
      await updateConfig(config);
      await callTele("sendMessage", { chat_id: chatId, text: "✅ Đã lưu Cookie Portal dự phòng!" });
    } else if (text === "/menu" || text === "/start") {
      const view = buildMainMenu(config);
      await callTele("sendMessage", { chat_id: chatId, text: view.text, parse_mode: "HTML", reply_markup: view.reply_markup });
    }
    return res.status(200).send("OK");
  }

  // =========================================================================
  // 3. XỬ LÝ MAIL THẬT TỪ PIPEDREAM
  // =========================================================================
  const rawText = body.text || "";
  const rawHtml = body.html || "";
  if (!rawText && !rawHtml) return res.status(200).send("Empty payload");

  const result = await processEmail(rawText, rawHtml, false);
  return res.status(200).json(result);
};

// ============================================================================
// BỘ PHÂN TÍCH LỊCH HỌC ĐA ĐỊNH DẠNG (THỨ, KHOẢNG RẢNH, VÀ NGÀY DD/MM/YYYY)
// ============================================================================
function extractDaysFromText(str) {
  const days = new Set();

  // Dạng "thứ 2-3-4-6-7" hoặc "thứ 2, 4, 6" hoặc "thứ 2, thứ 5"
  const thuGroups = str.match(/thứ\s*[2-7](?:\s*[-,\/&và]\s*(?:thứ\s*)?[2-7])*/gi) || [];
  thuGroups.forEach((grp) => {
    const nums = grp.match(/[2-7]/g) || [];
    nums.forEach((n) => days.add(`T${n}`));
  });

  // Dạng viết tắt "T2", "T3", ..., "T7", "CN", "Chủ nhật"
  const shortMatches = str.match(/\bT[2-7]\b|\bCN\b|chủ\s*nhật/gi) || [];
  shortMatches.forEach((m) => {
    if (/chủ\s*nhật/i.test(m)) days.add("CN");
    else days.add(m.toUpperCase());
  });

  // Dạng ngày dương lịch "24/11/2026" hoặc "24/11" -> tự quy đổi ra Thứ (T2..CN)
  const dateMatches = [...str.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/g)];
  dateMatches.forEach((m) => {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = m[3] ? parseInt(m[3], 10) : 2026;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const dt = new Date(Date.UTC(year, month - 1, day));
      const dowMap = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
      days.add(dowMap[dt.getUTCDay()]);
    }
  });

  return Array.from(days);
}

function extractHoursFromText(str) {
  const hours = new Set();

  // Dạng khoảng giờ: "18h-21h", "18h00-19h00", "18:00 tới 19:00", "18h00 đến 20h00"
  const rangeRegex = /(\d{1,2})[:h](\d{2})?\s*(?:-|–|tới|đến)\s*(\d{1,2})[:h](\d{2})?/gi;
  const ranges = [...str.matchAll(rangeRegex)];

  if (ranges.length > 0) {
    ranges.forEach((r) => {
      const startH = parseInt(r[1], 10);
      const endH = parseInt(r[3], 10);
      if (endH > startH) {
        // VD: 18h-19h -> [18h]; 18h-21h -> [18h, 19h, 20h]
        for (let h = startH; h < endH; h++) {
          hours.add(String(h).padStart(2, "0") + "h");
        }
      } else {
        hours.add(String(startH).padStart(2, "0") + "h");
      }
    });
  } else {
    // Dạng giờ đơn lẻ: "19h", "19h30", "19:00"
    const singleMatches = [...str.matchAll(/\b(\d{1,2})(?:h\d{0,2}|:\d{2})\b/gi)];
    singleMatches.forEach((m) => {
      const h = parseInt(m[1], 10);
      if (h >= 6 && h <= 23) hours.add(String(h).padStart(2, "0") + "h");
    });
  }

  return Array.from(hours);
}

function parseScheduleInfo(lichHocStr, batDauStr) {
  const source = lichHocStr && lichHocStr.trim() ? lichHocStr : batDauStr;
  const days = extractDaysFromText(source);
  const hours = extractHoursFromText(source);

  // Số buổi/tuần (VD: "tuần 2b" hoặc "2b/tuần" -> 2 buổi)
  const sessionMatch = source.match(/(\d+)\s*b(?:uổi)?/i);
  const sessionsNeeded = sessionMatch ? parseInt(sessionMatch[1], 10) : 1;

  // Nhận diện lịch rảnh linh hoạt vs lịch cố định
  const isFlexible =
    /rảnh/i.test(source) ||
    days.length > sessionsNeeded ||
    hours.length > 1;

  // Nếu dòng Thời gian học thật không có ngày/giờ, lấy dự phòng từ Thời gian bắt đầu học
  const finalDays = days.length > 0 ? days : extractDaysFromText(batDauStr);
  const finalHours = hours.length > 0 ? hours : extractHoursFromText(batDauStr);

  const candidateSlots = [];
  finalDays.forEach((d) => {
    finalHours.forEach((h) => {
      candidateSlots.push(`${d}_${h}`);
    });
  });

  return {
    candidateSlots,
    isFlexible,
    sessionsNeeded
  };
}
