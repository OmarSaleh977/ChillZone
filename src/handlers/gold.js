import { ephemeral, respond, getOrCreateWebhook, sendWebhookMessage, editWebhookMessage, deleteWebhookMessage, sendMessage, createThread, addThreadMember, sendDM, fetchMember, fetchUser, editInteractionResponse, followUp, defer, modal, EPHEMERAL } from "../discord.js";
import { getState, setState, deleteState } from "../db.js";
import { getPrices } from "../prices.js";

function parseQuantity(qty) {
  if (!qty || typeof qty !== "string") return 0;
  const clean = qty.replace(/[^0-9.k]/gi, "").trim().toLowerCase();
  let num = parseFloat(clean.replace("k", "")) || 0;
  if (clean.includes("k")) num *= 1000;
  if (num < 100) return 0;
  return Math.round(num);
}

function formatNumber(n) {
  const num = parseQuantity(n);
  if (isNaN(num) || num === 0) return String(n);
  return num.toLocaleString();
}

const PURPLE = 0x800080;

function goldEmoji(operation) {
  return operation === "WTS" ? "🟩" : "🟦";
}

function goldEmbed(offer, applicantsText) {
  const emoji = goldEmoji(offer.operation);
  const remaining = parseQuantity(offer.remainingAmount || "0");
  const fullyClaimed = remaining <= 0;
  const status = fullyClaimed ? "🔴 Claimed" : "🟢 Available";

  const fields = [
    { name: "Offer", value: `\`${formatNumber(offer.goldAmount)}\` gold @ \`${offer.price || "N/A"}\``, inline: true },
    { name: status, value: `Remaining: \`${formatNumber(offer.remainingAmount)}\``, inline: true },
  ];

  if (applicantsText && applicantsText !== "None") {
    fields.push({ name: "\u200b", value: "**Applicants**", inline: false });
    fields.push({ name: "\u200b", value: applicantsText, inline: false });
  }

  return {
    color: PURPLE,
    description: `<@${offer.userId}>`,
    fields,
  };
}

function goldButtons(uniqueKey, offer) {
  const isFullyClaimed = parseQuantity(offer.remainingAmount || "0") <= 0;
  return [
    {
      type: 1,
      components: [
        { type: 2, custom_id: `apply_gold_${uniqueKey}`, label: "Apply", style: 3, emoji: { name: "✅" }, disabled: isFullyClaimed || offer.completed },
        { type: 2, custom_id: `close_gold_${uniqueKey}`, label: "Close", style: 4, emoji: { name: "🔒" }, disabled: offer.completed },
        { type: 2, custom_id: `edit_gold_${uniqueKey}`, label: "Edit", style: 2, emoji: { name: "✏️" }, disabled: offer.completed },
        { type: 2, custom_id: `delete_gold_${uniqueKey}`, label: "Delete", style: 4, emoji: { name: "🗑️" } },
      ],
    },
  ];
}

function formatApplicants(applicants) {
  if (!applicants || applicants.length === 0) return "None";
  return applicants.map(app => {
    const emoji = app.operation === "WTB" ? "🟦" : "🟩";
    return `${emoji} <@${app.userId}> — \`${formatNumber(app.amount)}\``;
  }).join("\n");
}

function priceToEGP(priceNum, unit, egpRate) {
  if (unit === "USDT") return priceNum * (egpRate || 50);
  return priceNum;
}

async function postGoldOffer(pendingKey, interaction, env) {
  const db = env.DB;
  const token = env.BOT_TOKEN;
  const pending = await getState(db, `gold_pending_${pendingKey}`);
  if (!pending) return ephemeral("Offer expired, please try again.");

  const { operation, goldAmountNum, priceNum, unit, paymentDisplay, userId } = pending;
  const user = interaction.user || interaction.member?.user;

  const price = `${priceNum} ${unit} / 1M`;
  const uniqueKey = crypto.randomUUID();
  const goldChannelId = env.GOLD_CHANNEL_ID;

  const webhook = await getOrCreateWebhook(goldChannelId, token, db);
  const offer = {
    userId, operation, goldAmount: goldAmountNum.toString(),
    remainingAmount: goldAmountNum.toString(), price, paymentMethod: paymentDisplay,
    characterName: "N/A", messageId: null, channelId: goldChannelId,
    threadId: null, claimed: false, applicants: [], completed: false,
    createdAt: new Date().toISOString(),
  };

  const embed = goldEmbed(offer, "None");
  const member = await fetchMember(interaction.guild_id, userId, token);
  const displayName = member?.nick || user.global_name || user.username;
  const avatarURL = user.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=256` : "https://i.imgur.com/0Cnzr9Z.gif";

  const msg = await sendWebhookMessage(webhook.id, webhook.token, {
    embeds: [embed], components: goldButtons(uniqueKey, offer),
    username: `${displayName} ${operation === "WTS" ? "🟩 WTS" : "🟦 WTB"}`,
    avatar_url: avatarURL,
  });

  offer.messageId = msg.id;
  await db.prepare(
    "INSERT OR REPLACE INTO gold_offers (uniqueKey, userId, operation, goldAmount, remainingAmount, price, paymentMethod, characterName, messageId, channelId, threadId, claimed, applicants, completed, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(uniqueKey, offer.userId, offer.operation, offer.goldAmount, offer.remainingAmount, offer.price, offer.paymentMethod, offer.characterName, offer.messageId, offer.channelId, offer.threadId, 0, "[]", 0, offer.createdAt).run();

  await deleteState(db, `gold_pending_${pendingKey}`);
  return ephemeral(`${goldEmoji(operation)} **${operation} offer posted!** Check <#${goldChannelId}>`);
}

export async function handleGoldInteraction(interaction, env) {
  const { customId } = interaction;
  const user = interaction.user || interaction.member?.user;
  const db = env.DB;
  const token = env.BOT_TOKEN;

  if (customId === "gold_button") {
    return {
      type: 4,
      data: {
        content: "**Select offer type:**",
        components: [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "gold_wts", label: "WTS", style: 3, emoji: { name: "🟩" } },
              { type: 2, custom_id: "gold_wtb", label: "WTB", style: 1, emoji: { name: "🟦" } },
            ],
          },
        ],
        flags: EPHEMERAL,
      },
    };
  }

  if (customId === "gold_wts" || customId === "gold_wtb") {
    const operation = customId === "gold_wts" ? "WTS" : "WTB";
    return modal({
      custom_id: `gold_offer_modal_${operation}`,
      title: `${operation} Gold Offer`,
      components: [
        {
          type: 1, components: [
            { type: 4, custom_id: "gold_amount", label: "🪙 الكمية / Quantity", style: 1, required: true, placeholder: "e.g. 500, 1700, 2500" },
          ],
        },
        {
          type: 1, components: [
            { type: 4, custom_id: "custom_price", label: `💸 السعر / Price per 1M (EGP or USDT)`, style: 1, required: true, placeholder: "e.g. 2200 or 44 usdt" },
          ],
        },
      ],
    });
  }

  if (customId.startsWith("gold_offer_modal_")) {
    const parts = customId.split("_");
    const operation = parts[3];

    const goldAmountInput = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    const customPriceInput = interaction.data.components?.[1]?.components?.[0]?.value?.trim();

    if (!goldAmountInput || !customPriceInput) {
      return ephemeral("الكمية والسعر مطلوبين!");
    }

    const goldAmountNum = parseQuantity(goldAmountInput);
    if (goldAmountNum <= 0) return ephemeral("كمية غير صالحة! اكتب 100 على الأقل.");

    const customPriceInputLower = customPriceInput.toLowerCase();
    const isUSDT = customPriceInputLower.includes("usdt");
    const priceNum = parseFloat(customPriceInput.replace(/[^0-9.]/g, ""));
    if (isNaN(priceNum) || priceNum <= 0) return ephemeral("سعر غير صالح!");

    const unit = isUSDT ? "USDT" : "EGP";
    const paymentDisplay = isUSDT ? "USDT" : "Vodafone Cash";

    const prices = await getPrices(db);
    const egpRate = prices?.binance_egp_per_usdt || 50;
    const dbGoldPriceEGP = prices?.egp_per_million || 0;
    const userPriceEGP = priceToEGP(priceNum, unit, egpRate);

    if (operation === "WTB") {
      if (unit === "EGP" && priceNum < 100) {
        return ephemeral("⚠️ الحد الأدنى للسعر هو **100 EGP**!");
      }
      if (dbGoldPriceEGP > 0 && userPriceEGP < dbGoldPriceEGP) {
        return ephemeral(
          `⚠️ **سعرك أقل من سعر الجولد الحالي!**\n\n` +
          `سعر الجولد الآن: **${Math.round(dbGoldPriceEGP).toLocaleString()} EGP / 1M**\n` +
          `سعرك: **${Math.round(userPriceEGP).toLocaleString()} EGP / 1M**\n\n` +
          `الحد الأدنى للسعر هو **100 EGP**.`
        );
      }
    }

    if (operation === "WTS" && dbGoldPriceEGP > 0 && userPriceEGP < dbGoldPriceEGP) {
      const pendingKey = crypto.randomUUID().slice(0, 8);
      await setState(db, `gold_pending_${pendingKey}`, {
        userId: user.id, operation, goldAmountNum, priceNum, unit, paymentDisplay,
      });
      return {
        type: 4,
        data: {
          content:
            `⚠️ **تنبيه:** سعرك أقل من سعر الجولد الحالي!\n\n` +
            `سعر الجولد الآن: **${Math.round(dbGoldPriceEGP).toLocaleString()} EGP / 1M**\n` +
            `سعرك: **${Math.round(userPriceEGP).toLocaleString()} EGP / 1M**\n\n` +
            `متأكد إنك عايز تعرض بالسعر ده؟`,
          components: [
            {
              type: 1,
              components: [
                { type: 2, custom_id: `confirm_gold_post_${pendingKey}`, label: "تأكيد", style: 3, emoji: { name: "✅" } },
                { type: 2, custom_id: `cancel_gold_post_${pendingKey}`, label: "إلغاء", style: 4, emoji: { name: "❌" } },
              ],
            },
          ],
          flags: EPHEMERAL,
        },
      };
    }

    const pendingKey = crypto.randomUUID().slice(0, 8);
    await setState(db, `gold_pending_${pendingKey}`, {
      userId: user.id, operation, goldAmountNum, priceNum, unit, paymentDisplay,
    });
    return postGoldOffer(pendingKey, interaction, env);
  }

  if (customId.startsWith("confirm_gold_post_")) {
    const pendingKey = customId.replace("confirm_gold_post_", "");
    return postGoldOffer(pendingKey, interaction, env);
  }

  if (customId.startsWith("cancel_gold_post_")) {
    const pendingKey = customId.replace("cancel_gold_post_", "");
    await deleteState(db, `gold_pending_${pendingKey}`);
    return ephemeral("تم الإلغاء.");
  }

  if (customId.startsWith("apply_gold_modal_")) {
    const uniqueKey = customId.replace("apply_gold_modal_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer no longer exists!");
    if (row.completed) return ephemeral("This offer is closed!");

    const applyAmountInput = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    if (!applyAmountInput) return ephemeral("Quantity is required!");
    const applyAmountNum = parseQuantity(applyAmountInput);
    if (applyAmountNum <= 0) return ephemeral("Invalid quantity!");

    const remainingNum = parseQuantity(row.remainingAmount) || 0;
    if (applyAmountNum > remainingNum) return ephemeral(`Cannot exceed remaining quantity (${formatNumber(row.remainingAmount)})!`);

    const goldChannelId = row.channelId;
    const webhook = await getOrCreateWebhook(goldChannelId, token, db);

    const thread = await createThread(goldChannelId, token, {
      name: `${row.operation} ${formatNumber(row.goldAmount)} — ${user.username}`,
      auto_archive_duration: 1440,
      type: 12,
      invitable: false,
    });

    await addThreadMember(thread.id, row.userId, token);
    await addThreadMember(thread.id, user.id, token);

    await sendMessage(thread.id, token, {
      content:
        `⚠️ **Important:** The server is not responsible for dealing with someone who doesn't have the 🔒 **Trusted** role.\n\n` +
        `<@${row.userId}> & <@${user.id}> — Private thread for **${row.operation} ${formatNumber(applyAmountNum)}** gold.\n\n` +
        `**Price:** ${row.price}`,
    });

    let applicants = row.applicants ? JSON.parse(row.applicants) : [];
    const applicantOperation = row.operation === "WTS" ? "WTB" : "WTS";
    applicants.push({ userId: user.id, amount: applyAmountNum.toString(), operation: applicantOperation });

    const newRemaining = (remainingNum - applyAmountNum).toString();
    const isFullyClaimed = parseFloat(newRemaining) <= 0;

    await db.prepare("UPDATE gold_offers SET remainingAmount = ?, applicants = ?, claimed = ?, completed = ? WHERE uniqueKey = ?")
      .bind(newRemaining, JSON.stringify(applicants), isFullyClaimed ? 1 : 0, isFullyClaimed ? 1 : 0, uniqueKey).run();

    await db.prepare("INSERT OR REPLACE INTO ticket_threads (threadId, channelId, messageId, creatorId, offerUniqueKey, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(thread.id, goldChannelId, row.messageId, user.id, uniqueKey, new Date().toISOString()).run();

    const updatedOffer = { ...row, remainingAmount: newRemaining, applicants, completed: isFullyClaimed, claimed: isFullyClaimed };
    const member = await fetchMember(interaction.guild_id, row.userId, token);
    const displayName = member?.nick || "User";
    const avatarURL = `https://cdn.discordapp.com/avatars/${row.userId}/${member?.avatar || "0"}.png?size=256`;

    await editWebhookMessage(webhook.id, webhook.token, row.messageId, {
      embeds: [goldEmbed(updatedOffer, formatApplicants(applicants))],
      components: goldButtons(uniqueKey, updatedOffer),
      username: `${displayName} ${row.operation === "WTS" ? "🟩 WTS" : "🟦 WTB"}`,
      avatar_url: avatarURL,
    });

    try { await sendDM(row.userId, token, `Your ${row.operation} offer has a new applicant: <@${user.id}> for ${formatNumber(applyAmountNum)}! 🎉`); } catch {}

    return ephemeral(`Applied for ${formatNumber(applyAmountNum)} gold! 🎉 Thread created: <#${thread.id}>`);
  }

  if (customId.startsWith("apply_gold_")) {
    const uniqueKey = customId.replace("apply_gold_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer no longer exists!");
    if (row.completed || parseQuantity(row.remainingAmount || "0") <= 0) return ephemeral("This offer is closed!");
    if (row.userId === user.id) return ephemeral("You can't apply to your own offer!");

    return modal({
      custom_id: `apply_gold_modal_${uniqueKey}`,
      title: `Apply — ${row.operation}`,
      components: [{
        type: 1,
        components: [{ type: 4, custom_id: "apply_amount", label: `Amount to ${row.operation === "WTS" ? "buy" : "sell"}`, style: 1, required: true, placeholder: `Max: ${formatNumber(row.remainingAmount)}` }],
      }],
    });
  }

  if (customId.startsWith("edit_gold_")) {
    const uniqueKey = customId.replace("edit_gold_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer no longer exists!");
    if (row.userId !== user.id) return ephemeral("You can only edit your own offer!");
    const currentPriceNum = row.price?.split(" ")[0] || "";
    return modal({
      custom_id: `edit_offer_modal_${uniqueKey}`,
      title: "Edit Gold Offer",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "new_amount", label: "🪙 الكمية / Quantity", style: 1, required: true, value: row.goldAmount }] },
        { type: 1, components: [{ type: 4, custom_id: "new_price", label: "💸 السعر / Price per 1M (EGP or USDT)", style: 1, required: true, value: currentPriceNum }] },
      ],
    });
  }

  if (customId.startsWith("edit_offer_modal_")) {
    const uniqueKey = customId.replace("edit_offer_modal_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer no longer exists!");
    if (row.userId !== user.id) return ephemeral("You can only edit your own offer!");

    const newAmountInput = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    const newPriceInput = interaction.data.components?.[1]?.components?.[0]?.value?.trim();
    if (!newAmountInput || !newPriceInput) return ephemeral("Quantity and price are required!");

    const newAmountNum = parseQuantity(newAmountInput);
    if (newAmountNum <= 0) return ephemeral("Invalid quantity!");

    const newPriceInputLower = newPriceInput.toLowerCase();
    const newIsUSDT = newPriceInputLower.includes("usdt");
    const newPriceNum = parseFloat(newPriceInput.replace(/[^0-9.]/g, ""));
    if (isNaN(newPriceNum) || newPriceNum <= 0) return ephemeral("Invalid price!");

    const newUnit = newIsUSDT ? "USDT" : "EGP";
    const price = `${newPriceNum} ${newUnit} / 1M`;
    let applicants = row.applicants ? JSON.parse(row.applicants) : [];

    await db.prepare("UPDATE gold_offers SET goldAmount = ?, remainingAmount = ?, price = ? WHERE uniqueKey = ?")
      .bind(newAmountNum.toString(), newAmountNum.toString(), price, uniqueKey).run();

    const updatedOffer = { ...row, goldAmount: newAmountNum.toString(), remainingAmount: newAmountNum.toString(), price, applicants };
    const webhook = await getOrCreateWebhook(row.channelId, token, db);
    const member = await fetchMember(interaction.guild_id, row.userId, token);
    const displayName = member?.nick || "User";
    const avatarURL = `https://cdn.discordapp.com/avatars/${row.userId}/${member?.avatar || "0"}.png?size=256`;

    await editWebhookMessage(webhook.id, webhook.token, row.messageId, {
      embeds: [goldEmbed(updatedOffer, formatApplicants(applicants))],
      components: goldButtons(uniqueKey, updatedOffer),
      username: `${displayName} ${row.operation === "WTS" ? "🟩 WTS" : "🟦 WTB"}`,
      avatar_url: avatarURL,
    });

    return ephemeral("Offer updated! 🎉");
  }

  if (customId.startsWith("close_gold_")) {
    const uniqueKey = customId.replace("close_gold_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer no longer exists!");
    if (row.userId !== user.id) return ephemeral("You can only close your own offer!");
    if (row.completed) return ephemeral("Offer is already closed!");

    await db.prepare("UPDATE gold_offers SET completed = 1 WHERE uniqueKey = ?").bind(uniqueKey).run();

    const webhook = await getOrCreateWebhook(row.channelId, token, db);
    const member = await fetchMember(interaction.guild_id, row.userId, token);
    const displayName = member?.nick || "User";
    const avatarURL = `https://cdn.discordapp.com/avatars/${row.userId}/${member?.avatar || "0"}.png?size=256`;
    let applicants = row.applicants ? JSON.parse(row.applicants) : [];
    const updatedOffer = { ...row, completed: true };

    await editWebhookMessage(webhook.id, webhook.token, row.messageId, {
      embeds: [goldEmbed(updatedOffer, formatApplicants(applicants))],
      components: goldButtons(uniqueKey, updatedOffer),
      username: `${displayName} ${row.operation === "WTS" ? "🟩 WTS" : "🟦 WTB"}`,
      avatar_url: avatarURL,
    });

    return ephemeral("🔒 Offer closed!");
  }

  if (customId.startsWith("delete_gold_")) {
    const uniqueKey = customId.replace("delete_gold_", "");
    const row = await db.prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer no longer exists!");
    if (row.userId !== user.id) return ephemeral("You can only delete your own offer!");

    try {
      if (row.messageId) {
        const webhook = await getOrCreateWebhook(row.channelId, token, db);
        await deleteWebhookMessage(webhook.id, webhook.token, row.messageId);
      }
      await db.prepare("DELETE FROM gold_offers WHERE uniqueKey = ?").bind(uniqueKey).run();
    } catch {}

    return ephemeral("Offer deleted! 🎉");
  }

  return ephemeral("Unknown gold interaction");
}
