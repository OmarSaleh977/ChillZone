import { ephemeral, respond, getOrCreateWebhook, sendWebhookMessage, editWebhookMessage, deleteWebhookMessage, sendMessage, createThread, addThreadMember, sendDM, fetchMember, fetchUser, editInteractionResponse, followUp, defer, EPHEMERAL } from "../discord.js";
import { getState, setState, deleteState } from "../db.js";

function parseQuantity(qty) {
  if (!qty || typeof qty !== "string") return 0;
  const clean = qty.replace(/[^0-9.k]/gi, "").trim().toLowerCase();
  let num = parseFloat(clean.replace("k", "")) || 0;
  if (clean.includes("k")) num *= 1000;
  if (num < 100) return 0;
  return Math.round(num);
}

function formatQuantity(qty) {
  return parseQuantity(qty).toString();
}

function goldEmbed(offer, applicantsText) {
  const payment = offer.paymentMethod?.toLowerCase().includes("vodafone") ? "💸 Vodafone Cash" : (offer.paymentMethod || "N/A");
  return {
    color: 0x800080,
    description:
      `**By:** <@${offer.userId}> ${payment} | ${offer.price || "N/A"} | 🪙 Quantity | ${formatQuantity(offer.goldAmount)}\n` +
      `**Applicants:** ${applicantsText || "None"}\n` +
      `**Remaining Quantity:** ${formatQuantity(offer.remainingAmount)}\n`,
  };
}

function goldButtons(uniqueKey, offer) {
  const disabled = offer.completed || parseFloat(parseQuantity(offer.remainingAmount || "0")) <= 0;
  return [
    {
      type: 1,
      components: [
        { type: 2, custom_id: `apply_gold_${uniqueKey}`, label: "Apply for Offer", style: 3, emoji: { name: "✅" }, disabled },
        { type: 2, custom_id: `edit_gold_${uniqueKey}`, label: "Edit", style: 1, emoji: { name: "✏️" } },
        { type: 2, custom_id: `delete_gold_${uniqueKey}`, label: "Delete", style: 4, emoji: { name: "🗑️" } },
      ],
    },
  ];
}

function formatApplicants(applicants) {
  if (!applicants || applicants.length === 0) return "None";
  return applicants.map(app => `${app.operation === "WTB" ? "WTB 💸" : "WTS 🙋"} <@${app.userId}> ${formatQuantity(app.amount)}`).join("\n");
}

export async function handleGoldInteraction(interaction, env) {
  const { customId, user } = interaction;
  const db = env.DB;
  const token = env.BOT_TOKEN;

  if (customId === "gold_button") {
    const submissionKey = crypto.randomUUID().slice(0, 8);
    await setState(db, `gold_flow_${submissionKey}`, { step: "operation", userId: user.id });
    return {
      type: 4,
      data: {
        content: "يرجى اختيار نوع العرض:",
        components: [{
          type: 1,
          components: [{
            type: 3, custom_id: `operation_select_gold_${submissionKey}`, placeholder: "Select Operation",
            options: [
              { label: "WTS (Want to Sell)", value: "WTS", emoji: { name: "🙋" } },
              { label: "WTB (Want to Buy)", value: "WTB", emoji: { name: "💸" } },
            ],
          }],
        }],
        flags: EPHEMERAL,
      },
    };
  }

  if (customId.startsWith("operation_select_gold_")) {
    const submissionKey = customId.split("_")[3];
    const operation = interaction.data.values[0];
    await setState(db, `gold_flow_${submissionKey}`, { step: "payment", userId: user.id, operation });
    return {
      type: 7,
      data: {
        content: `يرجى اختيار طريقة الدفع لعرض ${operation}:`,
        components: [{
          type: 1,
          components: [{
            type: 3, custom_id: `payment_select_gold_${submissionKey}_${operation}`, placeholder: "Select Payment Method",
            options: [
              { label: "Vodafone Cash", value: "Vodafone Cash", emoji: { name: "💸" } },
              { label: "USDT", value: "USDT", emoji: { name: "🟡" } },
            ],
          }],
        }],
      },
    };
  }

  if (customId.startsWith("payment_select_gold_")) {
    const parts = customId.split("_");
    const submissionKey = parts[3];
    const operation = parts[4];
    const paymentMethod = interaction.data.values[0];
    await setState(db, `gold_flow_${submissionKey}`, { step: "char", userId: user.id, operation, paymentMethod });
    return {
      type: 7,
      data: {
        content: "اختر Payment Character الخاص بك (اختياري):",
        components: [{
          type: 1,
          components: [{
            type: 3, custom_id: `select_payment_char_gold_${submissionKey}_${operation}_${paymentMethod}`, placeholder: "اختر Payment Character (اختياري)",
            options: [
              { label: "Skip - هكتب الاسم يدويًا في الثريد", value: "skip", emoji: { name: "⏭️" } },
            ],
          }],
        }],
      },
    };
  }

  if (customId.startsWith("select_payment_char_gold_")) {
    const parts = customId.split("_");
    const submissionKey = parts[4];
    const operation = parts[5];
    const paymentMethod = parts[6];
    const selectedValue = interaction.data.values[0];
    const characterName = (selectedValue !== "skip" && selectedValue !== "none") ? selectedValue : "N/A";
    await setState(db, `gold_flow_${submissionKey}`, { step: "modal", userId: user.id, operation, paymentMethod, characterName });
    return modal({
      custom_id: `gold_offer_modal_${submissionKey}_${operation}_${paymentMethod}_${encodeURIComponent(characterName)}`,
      title: "عرض الذهب",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "gold_amount", label: "الكمية", style: 1, required: true, placeholder: "أدخل الكمية (مثلاً: 500, 1700, 2500)" }] },
        { type: 1, components: [{ type: 4, custom_id: "custom_price", label: "السعر لكل مليون (رقم فقط)", style: 1, required: true, placeholder: paymentMethod === "Vodafone Cash" ? "مثلاً: 1600 (EGP)" : "مثلاً: 30 (USDT)" }] },
      ],
    });
  }

  if (customId.startsWith("gold_offer_modal_")) {
    const parts = customId.split("_");
    const submissionKey = parts[3];
    const operation = parts[4];
    const paymentMethod = parts[5];
    const characterName = parts[6] ? decodeURIComponent(parts[6]) : "N/A";

    const goldAmountInput = interaction.data.components?.[0]?.components?.[0]?.value?.trim() ||
      interaction.data.components?.find(r => r.components?.[0]?.custom_id === "gold_amount")?.components?.[0]?.value?.trim();
    const customPriceInput = interaction.data.components?.[1]?.components?.[0]?.value?.trim() ||
      interaction.data.components?.find(r => r.components?.[0]?.custom_id === "custom_price")?.components?.[0]?.value?.trim();

    if (!goldAmountInput || !customPriceInput) {
      return ephemeral("الكمية والسعر مطلوبان!");
    }

    const goldAmountNum = parseQuantity(goldAmountInput);
    if (goldAmountNum <= 0) return ephemeral("كمية غير صالحة! أدخل قيمة لا تقل عن 100.");
    const customPriceNum = parseFloat(customPriceInput);
    if (isNaN(customPriceNum) || customPriceNum <= 0) return ephemeral("سعر غير صالح! أدخل رقم إيجابي.");

    const unit = paymentMethod === "Vodafone Cash" ? "EGP" : "USDT";
    const price = `${customPriceNum} ${unit} per 1M`;
    const uniqueKey = crypto.randomUUID();
    const goldChannelId = env.GOLD_CHANNEL_ID;

    const webhook = await getOrCreateWebhook(goldChannelId, token, db);
    const offer = {
      userId: user.id, operation, goldAmount: goldAmountNum.toString(),
      remainingAmount: goldAmountNum.toString(), price, paymentMethod,
      characterName, messageId: null, channelId: goldChannelId,
      threadId: null, claimed: false, applicants: [], completed: false,
      createdAt: new Date().toISOString(),
    };

    const embed = goldEmbed(offer, "None");
    const member = await fetchMember(interaction.guild_id, user.id, token);
    const displayName = member?.nick || user.global_name || user.username;
    const avatarURL = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : "https://i.imgur.com/0Cnzr9Z.gif";

    const msg = await sendWebhookMessage(webhook.id, webhook.token, {
      embeds: [embed], components: goldButtons(uniqueKey, offer),
      username: `${displayName} ${operation === "WTS" ? "🙋 WTS" : "💸 WTB"}`,
      avatar_url: avatarURL,
    });

    offer.messageId = msg.id;
    await db.prepare(
      "INSERT OR REPLACE INTO gold_offers (uniqueKey, userId, operation, goldAmount, remainingAmount, price, paymentMethod, characterName, messageId, channelId, threadId, claimed, applicants, completed, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(uniqueKey, offer.userId, offer.operation, offer.goldAmount, offer.remainingAmount, offer.price, offer.paymentMethod, offer.characterName, offer.messageId, offer.channelId, offer.threadId, 0, "[]", 0, offer.createdAt);

    return ephemeral(`تم إرسال عرض الذهب بنجاح إلى <#${goldChannelId}>! 🎉`);
  }

  if (customId.startsWith("apply_gold_")) {
    const uniqueKey = customId.replace("apply_gold_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").get(uniqueKey);
    if (!row) return ephemeral("هذا العرض غير موجود بعد الآن!");
    if (row.completed || parseFloat(parseQuantity(row.remainingAmount || "0")) <= 0) return ephemeral("هذا العرض مغلق!");
    if (row.userId === user.id) return ephemeral("لا يمكنك التقديم على عرضك الخاص!");
    return modal({
      custom_id: `apply_gold_modal_${uniqueKey}`,
      title: `التقدم لعرض ${row.operation}`,
      components: [{
        type: 1,
        components: [{ type: 4, custom_id: "apply_amount", label: `الكمية المراد ${row.operation === "WTS" ? "الشراء" : "البيع"}`, style: 1, required: true, placeholder: "أدخل الكمية" }],
      }],
    });
  }

  if (customId.startsWith("apply_gold_modal_")) {
    const uniqueKey = customId.replace("apply_gold_modal_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").get(uniqueKey);
    if (!row) return ephemeral("هذا العرض غير موجود!");
    if (row.completed) return ephemeral("هذا العرض مغلق!");

    const applyAmountInput = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    if (!applyAmountInput) return ephemeral("الكمية مطلوبة!");
    const applyAmountNum = parseQuantity(applyAmountInput);
    if (applyAmountNum <= 0) return ephemeral("كمية غير صالحة!");

    const remainingNum = parseFloat(parseQuantity(row.remainingAmount)) || 0;
    if (applyAmountNum > remainingNum) return ephemeral(`لا يمكنك التقديم بكمية أكبر من المتبقية (${formatQuantity(row.remainingAmount)})!`);

    const goldChannelId = row.channelId;
    const webhook = await getOrCreateWebhook(goldChannelId, token, db);

    const thread = await createThread(goldChannelId, token, {
      name: `Gold Offer - ${row.operation} ${formatQuantity(row.goldAmount)}`,
      auto_archive_duration: 1440,
      type: 12,
      invitable: false,
    });

    await addThreadMember(thread.id, row.userId, token);
    await addThreadMember(thread.id, user.id, token);

    const ownerPaymentChar = row.characterName || "N/A";
    await sendMessage(thread.id, token, {
      content:
        `⚠️ **تنبيه مهم:** السيرفر غير مسؤول في حالة التعامل مع شخص لا يحمل 🔒Role Trusted.\n` +
        `<@${row.userId}> and <@${user.id}>, this is a private thread to discuss the gold offer ${row.operation} for ${formatQuantity(applyAmountNum)}. 🎉\n` +
        `**Payment Character (Owner):** ${ownerPaymentChar}\n` +
        `**Payment Character (Applicant):** N/A`,
    });

    let applicants = row.applicants ? JSON.parse(row.applicants) : [];
    const applicantOperation = row.operation === "WTS" ? "WTB" : "WTS";
    applicants.push({ userId: user.id, amount: applyAmountNum.toString(), operation: applicantOperation });

    const newRemaining = (remainingNum - applyAmountNum).toString();
    const isFullyClaimed = parseFloat(newRemaining) <= 0;

    await db.prepare("UPDATE gold_offers SET remainingAmount = ?, applicants = ?, claimed = ?, completed = ? WHERE uniqueKey = ?")
      .run(formatQuantity(newRemaining), JSON.stringify(applicants), isFullyClaimed ? 1 : 0, isFullyClaimed ? 1 : 0, uniqueKey);

    await db.prepare("INSERT OR REPLACE INTO ticket_threads (threadId, channelId, messageId, creatorId, offerUniqueKey, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(thread.id, goldChannelId, row.messageId, user.id, uniqueKey, new Date().toISOString());

    const updatedOffer = { ...row, remainingAmount: newRemaining, applicants, completed: isFullyClaimed, claimed: isFullyClaimed };
    const member = await fetchMember(interaction.guild_id, row.userId, token);
    const displayName = member?.nick || "User";
    const avatarURL = `https://cdn.discordapp.com/avatars/${row.userId}/${member?.avatar || "0"}.png?size=256`;

    await editWebhookMessage(webhook.id, webhook.token, row.messageId, {
      embeds: [goldEmbed(updatedOffer, formatApplicants(applicants))],
      components: goldButtons(uniqueKey, updatedOffer),
      username: `${displayName} ${row.operation === "WTS" ? "🙋 WTS" : "💸 WTB"}`,
      avatar_url: avatarURL,
    });

    try { await sendDM(row.userId, token, `تم التقديم على عرضك ${row.operation} من قبل <@${user.id}> بـ ${formatQuantity(applyAmountNum)}! 🎉`); } catch {}

    return ephemeral(`تم التقديم لعرض الذهب بنجاح بـ ${formatQuantity(applyAmountNum)}! 🎉 ثريد خاص اتعمل: <#${thread.id}>.`);
  }

  if (customId.startsWith("edit_gold_")) {
    const uniqueKey = customId.replace("edit_gold_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").get(uniqueKey);
    if (!row) return ephemeral("هذا العرض غير موجود!");
    if (row.userId !== user.id) return ephemeral("يمكنك فقط تعديل عرضك الخاص!");
    const currentPriceNum = row.price?.split(" ")[0] || "";
    return modal({
      custom_id: `edit_offer_modal_${uniqueKey}`,
      title: "تعديل عرض الذهب",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "new_amount", label: "الكمية الجديدة", style: 1, required: true, value: formatQuantity(row.goldAmount) }] },
        { type: 1, components: [{ type: 4, custom_id: "new_price", label: "السعر الجديد لكل مليون", style: 1, required: true, value: currentPriceNum }] },
      ],
    });
  }

  if (customId.startsWith("edit_offer_modal_")) {
    const uniqueKey = customId.replace("edit_offer_modal_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").get(uniqueKey);
    if (!row) return ephemeral("هذا العرض غير موجود!");
    if (row.userId !== user.id) return ephemeral("يمكنك فقط تعديل عرضك!");

    const newAmountInput = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    const newPriceInput = interaction.data.components?.[1]?.components?.[0]?.value?.trim();
    if (!newAmountInput || !newPriceInput) return ephemeral("الكمية والسعر مطلوبان!");

    const newAmountNum = parseQuantity(newAmountInput);
    if (newAmountNum <= 0) return ephemeral("كمية غير صالحة!");
    const newPriceNum = parseFloat(newPriceInput);
    if (isNaN(newPriceNum) || newPriceNum <= 0) return ephemeral("سعر غير صالح!");

    const unit = row.paymentMethod === "Vodafone Cash" ? "EGP" : "USDT";
    const price = `${newPriceNum} ${unit} per 1M`;
    let applicants = row.applicants ? JSON.parse(row.applicants) : [];

    await db.prepare("UPDATE gold_offers SET goldAmount = ?, remainingAmount = ?, price = ? WHERE uniqueKey = ?")
      .run(newAmountNum.toString(), newAmountNum.toString(), price, uniqueKey);

    const updatedOffer = { ...row, goldAmount: newAmountNum.toString(), remainingAmount: newAmountNum.toString(), price, applicants };
    const webhook = await getOrCreateWebhook(row.channelId, token, db);
    const member = await fetchMember(interaction.guild_id, row.userId, token);
    const displayName = member?.nick || "User";
    const avatarURL = `https://cdn.discordapp.com/avatars/${row.userId}/${member?.avatar || "0"}.png?size=256`;

    await editWebhookMessage(webhook.id, webhook.token, row.messageId, {
      embeds: [goldEmbed(updatedOffer, formatApplicants(applicants))],
      components: goldButtons(uniqueKey, updatedOffer),
      username: `${displayName} ${row.operation === "WTS" ? "🙋 WTS" : "💸 WTB"}`,
      avatar_url: avatarURL,
    });

    return ephemeral(`تم تحديث عرض الذهب بنجاح! 🎉`);
  }

  if (customId.startsWith("delete_gold_")) {
    const uniqueKey = customId.replace("delete_gold_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").get(uniqueKey);
    if (!row) return ephemeral("هذا العرض غير موجود!");
    if (row.userId !== user.id) return ephemeral("يمكنك فقط حذف عرضك!");

    try {
      if (row.messageId) {
        const webhook = await getOrCreateWebhook(row.channelId, token, db);
        await deleteWebhookMessage(webhook.id, webhook.token, row.messageId);
      }
      await db.prepare("DELETE FROM gold_offers WHERE uniqueKey = ?").run(uniqueKey);
    } catch {}

    return ephemeral("تم حذف عرض الذهب بنجاح! 🎉");
  }

  return ephemeral("Unknown gold interaction");
}
