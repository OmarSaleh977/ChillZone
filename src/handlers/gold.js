import { ephemeral, respond, getOrCreateWebhook, sendWebhookMessage, editWebhookMessage, deleteWebhookMessage, sendMessage, createThread, addThreadMember, sendDM, fetchMember, fetchUser, editInteractionResponse, followUp, defer, modal, EPHEMERAL } from "../discord.js";
import { getState, setState, deleteState } from "../db.js";

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

function formatQuantity(qty) {
  const num = parseQuantity(qty);
  if (num >= 1000) return `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}K`;
  return num.toString();
}

function goldColor(operation) {
  return operation === "WTS" ? 0x2ecc71 : 0x3498db;
}

function goldEmoji(operation) {
  return operation === "WTS" ? "🟩" : "🟦";
}

function goldEmbed(offer, applicantsText) {
  const isWTS = offer.operation === "WTS";
  const color = goldColor(offer.operation);
  const emoji = goldEmoji(offer.operation);
  const remaining = parseQuantity(offer.remainingAmount || "0");
  const total = parseQuantity(offer.goldAmount || "0");
  const fullyClaimed = remaining <= 0;

  const statusLine = fullyClaimed ? "🔴 Fully Claimed" : "🟢 Available";

  const fields = [
    { name: "Price", value: `\`${offer.price || "N/A"}\``, inline: true },
    { name: "Quantity", value: `\`${formatNumber(offer.goldAmount)}\``, inline: true },
    { name: "Payment", value: `\`${offer.paymentMethod || "N/A"}\``, inline: true },
    { name: "Remaining", value: `\`${formatNumber(offer.remainingAmount)}\``, inline: true },
    { name: "Status", value: statusLine, inline: true },
  ];

  if (offer.characterName && offer.characterName !== "N/A") {
    fields.push({ name: "Payment Character", value: `\`${offer.characterName}\``, inline: true });
  }

  if (applicantsText && applicantsText !== "None") {
    fields.push({ name: "\u200b", value: "**Applicants**", inline: false });
    fields.push({ name: "\u200b", value: applicantsText, inline: false });
  }

  return {
    color,
    title: `${emoji} ${offer.operation} Gold Offer`,
    description: `<@${offer.userId}>`,
    fields,
    footer: { text: "ChillZone Gold Trading" },
    timestamp: offer.createdAt || new Date().toISOString(),
  };
}

function goldButtons(uniqueKey, offer) {
  const disabled = offer.completed || parseQuantity(offer.remainingAmount || "0") <= 0;
  return [
    {
      type: 1,
      components: [
        { type: 2, custom_id: `apply_gold_${uniqueKey}`, label: "Apply", style: 3, emoji: { name: "✅" }, disabled },
        { type: 2, custom_id: `edit_gold_${uniqueKey}`, label: "Edit", style: 2, emoji: { name: "✏️" } },
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

export async function handleGoldInteraction(interaction, env) {
  const { customId, user } = interaction;
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
    const key = crypto.randomUUID().slice(0, 8);
    await setState(db, `gold_flow_${key}`, { userId: user.id, operation });
    return modal({
      custom_id: `gold_offer_modal_${key}_${operation}`,
      title: `${operation} Gold Offer`,
      components: [
        {
          type: 1, components: [
            { type: 4, custom_id: "gold_amount", label: "Quantity", style: 1, required: true, placeholder: "e.g. 500, 1700, 2500" },
          ],
        },
        {
          type: 1, components: [
            { type: 4, custom_id: "custom_price", label: `Price per 1M (${operation === "WTS" ? "min 100 EGP" : "EGP or USDT"})`, style: 1, required: true, placeholder: "e.g. 1600" },
          ],
        },
        {
          type: 1, components: [
            { type: 4, custom_id: "payment_method", label: "Payment Method", style: 1, required: true, placeholder: "Vodafone Cash / USDT" },
          ],
        },
        {
          type: 1, components: [
            { type: 4, custom_id: "payment_char", label: "Payment Character (optional)", style: 1, required: false, placeholder: "Character name or leave empty" },
          ],
        },
      ],
    });
  }

  if (customId.startsWith("gold_offer_modal_")) {
    const parts = customId.split("_");
    const submissionKey = parts[3];
    const operation = parts[4];

    const goldAmountInput = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    const customPriceInput = interaction.data.components?.[1]?.components?.[0]?.value?.trim();
    const paymentMethodInput = interaction.data.components?.[2]?.components?.[0]?.value?.trim();
    const paymentCharInput = interaction.data.components?.[3]?.components?.[0]?.value?.trim() || "N/A";

    if (!goldAmountInput || !customPriceInput || !paymentMethodInput) {
      return ephemeral("All fields are required (Payment Character is optional)!");
    }

    const goldAmountNum = parseQuantity(goldAmountInput);
    if (goldAmountNum <= 0) return ephemeral("Invalid quantity! Enter at least 100.");

    const customPriceNum = parseFloat(customPriceInput);
    if (isNaN(customPriceNum) || customPriceNum <= 0) return ephemeral("Invalid price!");

    const paymentLower = paymentMethodInput.toLowerCase();
    const isUSDT = paymentLower.includes("usdt");
    const isVodafone = paymentLower.includes("vodafone") || paymentLower.includes("cash");

    let unit = "EGP";
    if (isUSDT) unit = "USDT";
    else if (!isVodafone) {
      return ephemeral("Payment method must be either **Vodafone Cash** or **USDT**!");
    }

    if (unit === "EGP" && customPriceNum < 100) {
      return ephemeral("Minimum price is **100 EGP** per 1M!");
    }

    const paymentDisplay = isUSDT ? "USDT" : "Vodafone Cash";
    const price = `${customPriceNum} ${unit} / 1M`;
    const uniqueKey = crypto.randomUUID();
    const goldChannelId = env.GOLD_CHANNEL_ID;

    const webhook = await getOrCreateWebhook(goldChannelId, token, db);
    const offer = {
      userId: user.id, operation, goldAmount: goldAmountNum.toString(),
      remainingAmount: goldAmountNum.toString(), price, paymentMethod: paymentDisplay,
      characterName: paymentCharInput, messageId: null, channelId: goldChannelId,
      threadId: null, claimed: false, applicants: [], completed: false,
      createdAt: new Date().toISOString(),
    };

    const embed = goldEmbed(offer, "None");
    const member = await fetchMember(interaction.guild_id, user.id, token);
    const displayName = member?.nick || user.global_name || user.username;
    const avatarURL = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : "https://i.imgur.com/0Cnzr9Z.gif";

    const msg = await sendWebhookMessage(webhook.id, webhook.token, {
      embeds: [embed], components: goldButtons(uniqueKey, offer),
      username: `${displayName} ${operation === "WTS" ? "🟩 WTS" : "🟦 WTB"}`,
      avatar_url: avatarURL,
    });

    offer.messageId = msg.id;
    await db.prepare(
      "INSERT OR REPLACE INTO gold_offers (uniqueKey, userId, operation, goldAmount, remainingAmount, price, paymentMethod, characterName, messageId, channelId, threadId, claimed, applicants, completed, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(uniqueKey, offer.userId, offer.operation, offer.goldAmount, offer.remainingAmount, offer.price, offer.paymentMethod, offer.characterName, offer.messageId, offer.channelId, offer.threadId, 0, "[]", 0, offer.createdAt).run();

    return ephemeral(`${goldEmoji(operation)} **${operation} offer posted!** 🎉\n> Quantity: \`${formatNumber(goldAmountNum)}\` @ \`${price}\`\n> Payment: \`${paymentDisplay}\`\n\nCheck <#${goldChannelId}>`);
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

    const ownerPaymentChar = row.characterName || "N/A";
    await sendMessage(thread.id, token, {
      content:
        `⚠️ **Important:** The server is not responsible for dealing with someone who doesn't have the 🔒 **Trusted** role.\n\n` +
        `<@${row.userId}> & <@${user.id}> — Private thread for **${row.operation} ${formatNumber(applyAmountNum)}** gold.\n\n` +
        `**Payment Character (Seller):** ${ownerPaymentChar}\n` +
        `**Payment Character (Buyer):** N/A`,
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
        { type: 1, components: [{ type: 4, custom_id: "new_amount", label: "New Quantity", style: 1, required: true, value: row.goldAmount }] },
        { type: 1, components: [{ type: 4, custom_id: "new_price", label: `New Price per 1M (min 100 EGP)`, style: 1, required: true, value: currentPriceNum }] },
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
    const newPriceNum = parseFloat(newPriceInput);
    if (isNaN(newPriceNum) || newPriceNum <= 0) return ephemeral("Invalid price!");

    const unit = row.paymentMethod?.toLowerCase().includes("usdt") ? "USDT" : "EGP";
    if (unit === "EGP" && newPriceNum < 100) {
      return ephemeral("Minimum price is **100 EGP** per 1M!");
    }

    const price = `${newPriceNum} ${unit} / 1M`;
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
