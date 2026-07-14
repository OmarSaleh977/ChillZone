import { ephemeral, respond, getOrCreateWebhook, sendWebhookMessage, editWebhookMessage, sendMessage, createThread, addThreadMember, sendDM, fetchMember, fetchUser, modal, EPHEMERAL } from "../discord.js";

function levelingEmbed(offer, factionEmoji) {
  const goldEmoji = "🪙";
  return {
    color: 0x800080,
    title: `${factionEmoji} ${offer.faction || "N/A"} Leveling Service ${offer.claimed ? "Claimed" : "Available"}`,
    fields: [
      { name: "Level Range", value: offer.levelRange || "N/A", inline: true },
      { name: "Offered Cuts", value: `${goldEmoji} ${offer.price || "N/A"}`, inline: true },
      { name: "Faction", value: `${factionEmoji} ${offer.faction || "N/A"}`, inline: true },
      { name: "Status", value: offer.claimed ? `Claimed by <@${offer.claimedBy}>` : "Looking for a player", inline: false },
    ],
  };
}

function levelingButtons(uniqueKey, offer) {
  return [{
    type: 1,
    components: [
      { type: 2, custom_id: `apply_leveling_${uniqueKey}`, label: "Apply", style: 3, emoji: { name: "🤝" }, disabled: !!offer.claimed },
      { type: 2, custom_id: `complete_leveling_${uniqueKey}`, label: "Completed", style: offer.claimed ? 3 : 2, emoji: { name: "✅" }, disabled: !offer.claimed },
    ],
  }];
}

export async function handleLevelingInteraction(interaction, env) {
  const { customId, user } = interaction;
  const db = env.DB;
  const token = env.BOT_TOKEN;

  if (customId === "leveling_button") {
    return {
      type: 4,
      data: {
        content: "اختار الفصيل لخدمة الليفلينج:",
        components: [{
          type: 1,
          components: [{
            type: 3, custom_id: `faction_select_leveling_${user.id}-${Date.now()}`, placeholder: "Select Faction",
            options: [
              { label: "Horde", value: "Horde", emoji: { name: "🐺" } },
              { label: "Alliance", value: "Alliance", emoji: { name: "🦁" } },
            ],
          }],
        }],
        flags: EPHEMERAL,
      },
    };
  }

  if (customId.startsWith("faction_select_leveling_")) {
    const submissionKey = customId.split("_")[3];
    const faction = interaction.data.values[0];
    return modal({
      custom_id: `leveling_modal_${submissionKey}_${faction}`,
      title: `${faction} Leveling Offer`,
      components: [
        { type: 1, components: [{ type: 4, custom_id: "level_range", label: "Level Range (e.g., 1-70)", style: 1, required: true }] },
        { type: 1, components: [{ type: 4, custom_id: "price", label: "Price (e.g., 50 USDT or 20k Gold)", style: 1, required: true }] },
      ],
    });
  }

  if (customId.startsWith("leveling_modal_")) {
    const parts = customId.split("_");
    const faction = parts[3];

    const levelRange = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    const price = interaction.data.components?.[1]?.components?.[0]?.value?.trim();
    if (!levelRange || !price) return ephemeral("كل الحقول مطلوبة!");

    const factionEmoji = faction === "Horde" ? "🐺" : "🦁";
    const uniqueKey = crypto.randomUUID();
    const levelingChannelId = env.LEVELING_CHANNEL_ID;

    const member = await fetchMember(interaction.guild_id, user.id, token);
    const displayName = member?.nick || user.global_name || user.username;
    const avatarURL = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : "https://i.imgur.com/0Cnzr9Z.gif";

    const webhook = await getOrCreateWebhook(levelingChannelId, token, db);
    const offer = {
      userId: user.id, levelRange, price, faction,
      messageId: null, channelId: levelingChannelId,
      threadId: null, claimed: false, claimedBy: null, completed: false,
    };

    const msg = await sendWebhookMessage(webhook.id, webhook.token, {
      embeds: [levelingEmbed(offer, factionEmoji)],
      components: levelingButtons(uniqueKey, offer),
      username: displayName,
      avatar_url: avatarURL,
    });

    offer.messageId = msg.id;
    await db.prepare(
      "INSERT OR REPLACE INTO leveling_offers (uniqueKey, userId, levelRange, price, faction, messageId, channelId, threadId, claimed, claimedBy, completed, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(uniqueKey, user.id, levelRange, price, faction, msg.id, levelingChannelId, null, 0, null, 0, new Date().toISOString());

    return ephemeral(`عرض الليفلينج لـ ${faction} اتبعت بنجاح في <#${levelingChannelId}>! 🎉`);
  }

  if (customId.startsWith("apply_leveling_")) {
    const uniqueKey = customId.replace("apply_leveling_", "");
    const row = await db.prepare("SELECT * FROM leveling_offers WHERE uniqueKey = ?").get(uniqueKey);
    if (!row) return ephemeral("العرض ده مش موجود!");
    if (row.claimed) return ephemeral("العرض ده اتقفل بالفعل!");
    if (row.userId === user.id) return ephemeral("ما تقدرش تقفل عرضك بنفسك!");

    const levelingChannelId = row.channelId;
    const thread = await createThread(levelingChannelId, token, {
      name: `Leveling Offer - ${row.levelRange} (${row.faction})`,
      auto_archive_duration: 1440,
      type: 12,
      invitable: false,
    });

    await addThreadMember(thread.id, row.userId, token);
    await addThreadMember(thread.id, user.id, token);

    await sendMessage(thread.id, token, {
      content: `<@${row.userId}> و <@${user.id}>، ده ثريد خاص لمناقشة عرض الليفلينج لـ ${row.levelRange} (${row.faction}). 🎉`,
    });

    await db.prepare("UPDATE leveling_offers SET claimed = 1, claimedBy = ?, threadId = ? WHERE uniqueKey = ?").run(user.id, thread.id, uniqueKey);
    await db.prepare("INSERT OR REPLACE INTO ticket_threads (threadId, channelId, messageId, creatorId, offerUniqueKey, createdAt) VALUES (?, ?, ?, ?, ?, ?)").run(thread.id, levelingChannelId, row.messageId, user.id, uniqueKey, new Date().toISOString());

    const factionEmoji = row.faction === "Horde" ? "🐺" : "🦁";
    const webhook = await getOrCreateWebhook(levelingChannelId, token, db);
    const member = await fetchMember(interaction.guild_id, row.userId, token);
    const displayName = member?.nick || "User";
    const avatarURL = `https://cdn.discordapp.com/avatars/${row.userId}/${member?.avatar || "0"}.png?size=256`;

    const updatedOffer = { ...row, claimed: true, claimedBy: user.id };
    await editWebhookMessage(webhook.id, webhook.token, row.messageId, {
      embeds: [{ ...levelingEmbed(updatedOffer, factionEmoji), title: `${factionEmoji} ${row.faction || "N/A"} Leveling Service Claimed! 🎉` }],
      components: levelingButtons(uniqueKey, updatedOffer),
      username: displayName,
      avatar_url: avatarURL,
    });

    try { await sendDM(row.userId, token, `عرض الليفلينج ${row.faction} اتقفل بواسطة <@${user.id}>! ثريد خاص اتعمل.`); } catch {}

    return ephemeral(`قفلت عرض الليفلينج بنجاح! 🎉 ثريد خاص: <#${thread.id}>.`);
  }

  if (customId.startsWith("complete_leveling_")) {
    const uniqueKey = customId.replace("complete_leveling_", "");
    const row = await db.prepare("SELECT * FROM leveling_offers WHERE uniqueKey = ?").get(uniqueKey);
    if (!row) return ephemeral("العرض ده مش موجود!");
    if (row.userId !== user.id) return ephemeral("بس صاحب العرض يقدر يقفل!");

    await db.prepare("UPDATE leveling_offers SET completed = 1 WHERE uniqueKey = ?").run(uniqueKey);

    const tickets = await db.prepare("SELECT * FROM ticket_threads").all();
    let deletedCount = 0;
    for (const ticket of tickets) {
      try { await deleteChannel(ticket.threadId, token); deletedCount++; } catch {}
    }
    await db.prepare("DELETE FROM ticket_threads").run();

    const factionEmoji = row.faction === "Horde" ? "🐺" : "🦁";
    const webhook = await getOrCreateWebhook(row.channelId, token, db);
    const member = await fetchMember(interaction.guild_id, row.userId, token);
    const displayName = member?.nick || "User";
    const avatarURL = `https://cdn.discordapp.com/avatars/${row.userId}/${member?.avatar || "0"}.png?size=256`;

    await editWebhookMessage(webhook.id, webhook.token, row.messageId, {
      embeds: [{ ...levelingEmbed(row, factionEmoji), title: `${factionEmoji} ${row.faction || "N/A"} Leveling Service Completed! ✅` }],
      components: [],
      username: displayName,
      avatar_url: avatarURL,
    });

    return ephemeral(`عرض الليفلينج اتقفل بنجاح، وتم مسح ${deletedCount} ثريد! ✅`);
  }

  return ephemeral("Unknown leveling interaction");
}
