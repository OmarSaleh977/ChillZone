import { ephemeral, getOrCreateWebhook, sendWebhookMessage, editWebhookMessage, fetchMember, modal, EPHEMERAL } from "../discord.js";

export async function handleAccountInteraction(interaction, env) {
  const { customId } = interaction;
  const user = interaction.user || interaction.member?.user;
  const db = env.DB;
  const token = env.BOT_TOKEN;

  if (customId === "account_button") {
    const sk = `${user.id}-${Date.now()}`;
    return {
      type: 4, data: {
        content: "Select Operation:",
        components: [{
          type: 1, components: [{
            type: 3, custom_id: `operation_select_account_${sk}`, placeholder: "Select Operation",
            options: [
              { label: "WTS (Sell)", value: "WTS", emoji: { name: "🙋‍♂️" } },
              { label: "WTB (Buy)", value: "WTB", emoji: { name: "💸" } },
            ],
          }],
        }],
        flags: EPHEMERAL,
      },
    };
  }

  if (customId.startsWith("operation_select_account_")) {
    const sk = customId.split("_")[3];
    const operation = interaction.data.values[0];
    return {
      type: 7, data: {
        content: "Select Payment Method:",
        components: [{
          type: 1, components: [{
            type: 3, custom_id: `payment_select_account_${sk}_${operation}`, placeholder: "Select Payment Method",
            options: [
              { label: "Vodafone Cash", value: "Vodafone", emoji: { name: "💸" } },
              { label: "USDT", value: "USDT", emoji: { name: "🟡" } },
            ],
          }],
        }],
      },
    };
  }

  if (customId.startsWith("payment_select_account_")) {
    const sk = customId.split("_")[3];
    const operation = customId.split("_")[4];
    const paymentMethod = interaction.data.values[0];
    return modal({
      custom_id: `trade_modal_account_${sk}_${operation}_${paymentMethod}`,
      title: "Account Trade Offer",
      components: [
        { type: 1, components: [{ type: 4, custom_id: "price", label: "Price", style: 1, required: true }] },
        { type: 1, components: [{ type: 4, custom_id: "accountInfo", label: "Account Info", style: 2, required: true }] },
      ],
    });
  }

  if (customId.startsWith("trade_modal_account_")) {
    const parts = customId.split("_");
    const operation = parts[4];
    const paymentMethod = parts[5];
    const price = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    const accountInfo = interaction.data.components?.[1]?.components?.[0]?.value?.trim();

    if (!price || isNaN(price)) return ephemeral("Invalid price! Please enter a valid number.");
    if (!accountInfo) return ephemeral("Account Info is required!");

    const uniqueKey = `${user.id}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const paymentEmoji = paymentMethod === "Vodafone" ? "💸" : "🟡";
    const operationEmoji = operation === "WTS" ? "🙋‍♂️" : "💸";

    const member = await fetchMember(interaction.guild_id, user.id, token);
    const displayName = member?.nick || user.global_name || user.username;
    const avatarURL = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : "https://i.imgur.com/0Cnzr9Z.gif";

    const embed = {
      color: 0x800080,
      thumbnail: { url: avatarURL },
      title: `Account Offer: ${operation} ${operationEmoji}`,
      fields: [
        { name: "Publisher", value: `<@${user.id}>`, inline: true },
        { name: "Payment Method", value: `${paymentEmoji} ${paymentMethod === "Vodafone" ? "Vodafone Cash" : "USDT"}`, inline: true },
        { name: "Price", value: price || "N/A", inline: true },
        { name: "Account Info", value: accountInfo || "N/A", inline: false },
        { name: "Status", value: "Available", inline: false },
      ],
    };

    const accChannelId = env.ACCOUNT_CHANNEL_ID;
    const webhook = await getOrCreateWebhook(accChannelId, token, db);
    const msg = await sendWebhookMessage(webhook.id, webhook.token, {
      embeds: [embed],
      components: [{ type: 1, components: [{ type: 2, custom_id: `claim_${uniqueKey}`, label: "Claim Offer", style: 3, emoji: { name: "✅" } }] }],
      username: displayName.charAt(0).toUpperCase() + displayName.slice(1),
      avatar_url: avatarURL,
    });

    await db.prepare(
      "INSERT INTO account_offers (uniqueKey, type, userId, userTag, operation, quantity, price, paymentMethod, messageId, channelId, claimed, claimedBy, completed, createdAt, embed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(uniqueKey, "account", user.id, displayName, operation, null, price, paymentMethod === "Vodafone" ? "Vodafone Cash" : "USDT", msg.id, accChannelId, 0, null, 0, new Date().toISOString(), JSON.stringify(embed)).run();

    return ephemeral(`${operation} account offer submitted in <#${accChannelId}>! 🎉`);
  }

  if (customId.startsWith("claim_")) {
    const uniqueKey = customId.replace("claim_", "");
    const row = await db.prepare("SELECT * FROM account_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("Offer not found!");
    if (row.claimed) return ephemeral("This offer is already claimed!");

    await db.prepare("UPDATE account_offers SET claimed = 1, claimedBy = ? WHERE uniqueKey = ?").bind(user.id, uniqueKey).run();

    const embedData = JSON.parse(row.embed);
    embedData.fields = [
      { name: "Publisher", value: `<@${row.userId}>`, inline: true },
      { name: "Payment Method", value: `${row.paymentMethod === "Vodafone Cash" ? "💸" : "🟡"} ${row.paymentMethod}`, inline: true },
      { name: "Price", value: row.price || "N/A", inline: true },
      { name: "Account Info", value: "N/A", inline: false },
      { name: "Status", value: `Claimed by <@${user.id}>`, inline: false },
    ];

    const webhook = await getOrCreateWebhook(row.channelId, token, db);
    await editWebhookMessage(webhook.id, webhook.token, row.messageId, { embeds: [embedData], components: [] }).catch(() => {});

    return ephemeral("You have claimed this offer! Contact the publisher to proceed.");
  }

  return false;
}
