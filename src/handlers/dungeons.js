import { ephemeral, getOrCreateWebhook, sendWebhookMessage, editWebhookMessage, sendMessage, createThread, addThreadMember, removeThreadMember, deleteChannel, sendDM, fetchMember, fetchUser, defer, update, modal, editInteractionResponse, EPHEMERAL } from "../discord.js";

const DUNGEONS = ["Eco-Dome Al'dani", "Ara-Kara, City of Echoes", "The Dawnbreaker", "Priory of the Sacred Flame", "Operation: Floodgate", "Halls of Atonement", "Tazavesh: Streets of Wonder", "Tazavesh: So'leah's Gambit"];
const ABBREV = { "Eco-Dome Al'dani": "ECO", "Ara-Kara, City of Echoes": "ARA", "The Dawnbreaker": "DB", "Priory of the Sacred Flame": "PSF", "Operation: Floodgate": "FG", "Halls of Atonement": "HOA", "Tazavesh: Streets of Wonder": "STRT", "Tazavesh: So'leah's Gambit": "GMBT" };
function abbr(d) { return ABBREV[d] || d; }
function roleEmoji(r) { return { Tank: "🛡️", Healer: "➕", DPS: "🗡️" }[r] || ""; }
function keystoneDisplay(k) { return k === "0" ? "0" : `+${k}`; }
function getRank(runs) { if (runs >= 200) return "Platinum"; if (runs >= 100) return "Gold"; if (runs >= 50) return "Silver"; return "Bronze"; }

function dungeonEmbed(offer, rank) {
  const k = keystoneDisplay(offer.keystoneLevel);
  const title = offer.claimed ? `[CLOSED] 🔒 ${abbr(offer.dungeon)} Mythic ${k} x${offer.numberOfRuns}` : `${abbr(offer.dungeon)} Mythic ${k} x${offer.numberOfRuns}`;
  const gd = offer.groupData || {};
  const pending = (offer.pendingApplicants || []).length > 0
    ? offer.pendingApplicants.map(app => `<@${app.userId}> ${roleEmoji(app.role)} ${app.characterName} (${app.class} ${app.mythicRating} ${app.hasKey === "Have Key" ? "✅" : "❌"})`).join("\n")
    : "None";
  const accepted = [
    gd.tank ? `🛡️ Tank: <@${gd.tank}>` : "🛡️ Tank: None",
    gd.healer ? `➕ Healer: <@${gd.healer}>` : "➕ Healer: None",
    ...(gd.dps?.length > 0 ? gd.dps.map(id => `🗡️ DPS: <@${id}>`) : ["🗡️ DPS: None"]),
  ].join("\n");
  const progress = `${gd.tank ? "1" : "0"}/1 Tank | ${gd.healer ? "1" : "0"}/1 Healer | ${(gd.dps || []).length}/2 DPS`;

  return {
    color: 0x800080, title,
    fields: [
      { name: "Run Type", value: offer.runType === "Timed" ? "⏰ Timed" : "🛌 Non-Timed", inline: true },
      { name: "Offered Cut", value: `🪙 ${offer.cut}`, inline: true },
      { name: "Stack Type", value: offer.stack, inline: true },
      { name: "Poster Rank", value: `🚀 ${rank}`, inline: true },
      { name: "Pending Applicants", value: offer.claimed ? "N/A" : pending, inline: false },
      { name: "Accepted Players", value: accepted, inline: false },
      { name: "Filling Progress", value: progress, inline: false },
    ],
  };
}

function dungeonButtons(uniqueKey, offer) {
  const components = [
    { type: 2, custom_id: `apply_dungeon_${uniqueKey}`, label: "Join Group", style: 3, emoji: { name: "✅" }, disabled: !!offer.claimed },
    { type: 2, custom_id: `start_dungeon_${uniqueKey}`, label: "Begin Run", style: 1, emoji: { name: "🚀" }, disabled: !!offer.claimed },
  ];
  if (offer.claimed) components.push({ type: 2, custom_id: `reopen_dungeon_${uniqueKey}`, label: "Reopen", style: 1, emoji: { name: "🔓" } });
  return [{ type: 1, components }];
}

async function refreshDungeonEmbed(offer, uniqueKey, env, threadId) {
  const token = env.BOT_TOKEN;
  const db = env.DB;
  const rankRow = await db.prepare("SELECT dungeonRuns FROM user_ranks WHERE userId = ?").bind(offer.userId).first();
  const rank = getRank(rankRow?.dungeonRuns || 0);
  const webhook = await getOrCreateWebhook(offer.channelId, token, db);
  await editWebhookMessage(webhook.id, webhook.token, offer.messageId, {
    embeds: [dungeonEmbed(offer, rank)],
    components: dungeonButtons(uniqueKey, offer),
  }).catch(() => {});
}

export async function handleDungeonInteraction(interaction, env) {
  const { customId, user } = interaction;
  const db = env.DB;
  const token = env.BOT_TOKEN;

  if (customId === "dungeon_button") {
    const sk = `${user.id}-${Date.now()}`;
    return {
      type: 4, data: {
        content: "Select a dungeon to create an offer:",
        components: [{ type: 1, components: [{ type: 3, custom_id: `dungeon_select_${sk}`, placeholder: "Select Dungeon", options: DUNGEONS.map(d => ({ label: d, value: d })) }] }],
        flags: EPHEMERAL,
      },
    };
  }

  if (customId.startsWith("dungeon_select_")) {
    const sk = customId.split("_")[2];
    const dungeon = interaction.data.values[0];
    return {
      type: 7, data: {
        content: `Select keystone level for ${dungeon}:`,
        components: [{ type: 1, components: [{ type: 3, custom_id: `keystone_select_${sk}_${encodeURIComponent(dungeon)}`, placeholder: "Keystone Level", options: Array.from({ length: 19 }, (_, i) => ({ label: `Keystone Level ${i === 0 ? "0" : `+${i}`}`, value: i === 0 ? "0" : `+${i}` })) }] }],
      },
    };
  }

  if (customId.startsWith("keystone_select_")) {
    const parts = customId.split("_");
    const sk = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const kLevel = interaction.data.values[0];
    return {
      type: 7, data: {
        content: `Select run type for ${dungeon} ${keystoneDisplay(kLevel)}:`,
        components: [{ type: 1, components: [{ type: 3, custom_id: `runtype_select_${sk}_${encodeURIComponent(dungeon)}_${kLevel}`, placeholder: "Run Type", options: [{ label: "Timed ⏰", value: "Timed" }, { label: "Non-Timed 🛌", value: "Non-Timed" }] }] }],
      },
    };
  }

  if (customId.startsWith("runtype_select_")) {
    const parts = customId.split("_");
    const sk = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const kLevel = parts[4];
    const runType = interaction.data.values[0];
    return {
      type: 7, data: {
        content: `Select stack type:`,
        components: [{ type: 1, components: [{ type: 3, custom_id: `stack_select_${sk}_${encodeURIComponent(dungeon)}_${kLevel}_${runType}`, placeholder: "Stack Type", options: [{ label: "Plate 🛡️", value: "Plate" }, { label: "Mail 📬", value: "Mail" }, { label: "Cloth 👘", value: "Cloth" }] }] }],
      },
    };
  }

  if (customId.startsWith("stack_select_")) {
    const parts = customId.split("_");
    const sk = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const kLevel = parts[4];
    const runType = parts[5];
    const stack = interaction.data.values[0];
    return {
      type: 7, data: {
        content: `Select number of runs:`,
        components: [{ type: 1, components: [{ type: 3, custom_id: `runs_select_${sk}_${encodeURIComponent(dungeon)}_${kLevel}_${runType}_${stack}`, placeholder: "Number of Runs", options: Array.from({ length: 8 }, (_, i) => ({ label: `${i + 1} Run${i + 1 > 1 ? "s" : ""}`, value: (i + 1).toString() })) }] }],
      },
    };
  }

  if (customId.startsWith("runs_select_")) {
    const parts = customId.split("_");
    const sk = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const kLevel = parts[4];
    const runType = parts[5];
    const stack = parts[6];
    const numRuns = interaction.data.values[0];
    return modal({
      custom_id: `cut_input_${sk}_${encodeURIComponent(dungeon)}_${kLevel}_${runType}_${stack}_${numRuns}`,
      title: "Enter Offered Cut",
      components: [{ type: 1, components: [{ type: 4, custom_id: "cut_amount", label: "Offered Cut (e.g., 100k)", style: 1, required: true }] }],
    });
  }

  if (customId.startsWith("cut_input_")) {
    const parts = customId.split("_");
    const dungeon = decodeURIComponent(parts[3]);
    const kLevel = parts[4];
    const runType = parts[5];
    const stack = parts[6];
    const numRuns = parts[7];
    const cut = interaction.data.components?.[0]?.components?.[0]?.value?.trim();
    if (!cut) return ephemeral("Cut is required!");

    const uniqueKey = crypto.randomUUID();
    const rankRow = await db.prepare("SELECT dungeonRuns FROM user_ranks WHERE userId = ?").bind(user.id).first();
    const rank = getRank(rankRow?.dungeonRuns || 0);
    const dChannelId = env.DUNGEON_OFFERS_CHANNEL_ID;
    const webhook = await getOrCreateWebhook(dChannelId, token, db);

    const offerData = {
      type: "dungeon", userId: user.id, userTag: user.username, dungeon, keystoneLevel: kLevel,
      runType, stack, numberOfRuns: numRuns, cut, claimed: false, messageId: null,
      groupData: { tank: null, healer: null, dps: [], tankRating: null, healerRating: null, dpsRatings: [], tankHasKey: null, healerHasKey: null, dpsHasKeys: [] },
      pendingApplicants: [], threadId: null, channelId: dChannelId,
    };

    const member = await fetchMember(interaction.guild_id, user.id, token);
    const avatarURL = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : "https://i.imgur.com/0Cnzr9Z.gif";

    const msg = await sendWebhookMessage(webhook.id, webhook.token, {
      embeds: [dungeonEmbed(offerData, rank)],
      components: dungeonButtons(uniqueKey, offerData),
      username: member?.nick || user.username,
      avatar_url: avatarURL,
    });

    offerData.messageId = msg.id;

    const thread = await createThread(dChannelId, token, {
      name: `${dungeon} ${keystoneDisplay(kLevel)} - ChillZone`,
      auto_archive_duration: 10080,
      type: 12,
      invitable: false,
    });
    await addThreadMember(thread.id, user.id, token);
    await sendMessage(thread.id, token, {
      content: `Thread created for ${dungeon} ${keystoneDisplay(kLevel)}. Use this to coordinate with your group!`,
      components: [{ type: 1, components: [{ type: 2, custom_id: `gg_key_done_${uniqueKey}`, label: "GG, Key Done", style: 3, emoji: { name: "✅" } }] }],
    });

    offerData.threadId = thread.id;

    await db.prepare(
      "INSERT OR REPLACE INTO dungeon_offers (uniqueKey, type, userId, userTag, dungeon, keystoneLevel, runType, stack, numberOfRuns, cut, claimed, messageId, groupData, pendingApplicants, threadId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(uniqueKey, "dungeon", user.id, user.username, dungeon, kLevel, runType, stack, numRuns, cut, 0, msg.id, JSON.stringify(offerData.groupData), "[]", thread.id).run();

    return ephemeral(`Dungeon offer created! Check <#${dChannelId}>.`);
  }

  if (customId.startsWith("apply_dungeon_")) {
    const uniqueKey = customId.split("_")[2];
    const row = await db.prepare("SELECT * FROM dungeon_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer is no longer available!");
    if (row.claimed) return ephemeral("This offer has been claimed!");
    if (row.userId === user.id) return ephemeral("You cannot apply to your own offer!");
    return ephemeral("Character system is required to apply. Register a character first!");
  }

  if (customId.startsWith("start_dungeon_")) {
    const uniqueKey = customId.split("_")[2];
    const row = await db.prepare("SELECT * FROM dungeon_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer is no longer available!");
    if (row.userId !== user.id) return ephemeral("Only the owner can start the run!");
    const groupData = row.groupData ? JSON.parse(row.groupData) : {};
    groupData.claimed = true;
    await db.prepare("UPDATE dungeon_offers SET claimed = 1 WHERE uniqueKey = ?").bind(uniqueKey).run();
    const updatedOffer = { ...row, claimed: true, groupData };
    await refreshDungeonEmbed(updatedOffer, uniqueKey, env);
    return ephemeral("Run started! Coordinate in the thread.");
  }

  if (customId.startsWith("reopen_dungeon_")) {
    const uniqueKey = customId.split("_")[2];
    const row = await db.prepare("SELECT * FROM dungeon_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer is no longer available!");
    if (row.userId !== user.id) return ephemeral("Only the owner can reopen!");
    const groupData = row.groupData ? JSON.parse(row.groupData) : {};
    groupData.tank = null; groupData.healer = null; groupData.dps = [];
    groupData.tankRating = null; groupData.healerRating = null; groupData.dpsRatings = [];
    groupData.tankHasKey = null; groupData.healerHasKey = null; groupData.dpsHasKeys = [];
    await db.prepare("UPDATE dungeon_offers SET claimed = 0, groupData = ?, pendingApplicants = '[]' WHERE uniqueKey = ?").bind(JSON.stringify(groupData), uniqueKey).run();
    const updatedOffer = { ...row, claimed: false, groupData, pendingApplicants: [] };
    await refreshDungeonEmbed(updatedOffer, uniqueKey, env);
    return ephemeral("Offer reopened!");
  }

  if (customId.startsWith("gg_key_done_")) {
    const uniqueKey = customId.split("_")[3];
    const row = await db.prepare("SELECT * FROM dungeon_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer is no longer available!");
    if (user.id !== env.BOT_OWNER_ID && user.id !== row.userId) return ephemeral("Only bot/offer owner can mark as done!");
    await db.prepare("UPDATE dungeon_offers SET claimed = 1 WHERE uniqueKey = ?").bind(uniqueKey).run();
    const groupData = row.groupData ? JSON.parse(row.groupData) : {};
    await refreshDungeonEmbed({ ...row, claimed: true, groupData }, uniqueKey, env);
    return ephemeral("Key marked as done!");
  }

  if (customId.startsWith("cancel_dungeon_")) {
    const parts = customId.split("_");
    const uniqueKey = parts[2];
    const targetUserId = parts[3];
    if (targetUserId !== user.id) return ephemeral("You can only cancel your own signup!");
    const row = await db.prepare("SELECT * FROM dungeon_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer is no longer available!");
    const groupData = row.groupData ? JSON.parse(row.groupData) : {};
    if (groupData.tank === user.id) { groupData.tank = null; groupData.tankHasKey = null; }
    if (groupData.healer === user.id) { groupData.healer = null; groupData.healerHasKey = null; }
    if (groupData.dps?.includes(user.id)) {
      const idx = groupData.dps.indexOf(user.id);
      groupData.dps.splice(idx, 1); groupData.dpsRatings?.splice(idx, 1); groupData.dpsHasKeys?.splice(idx, 1);
    }
    let pending = row.pendingApplicants ? JSON.parse(row.pendingApplicants) : [];
    pending = pending.filter(a => a.userId !== user.id);
    await db.prepare("UPDATE dungeon_offers SET groupData = ?, pendingApplicants = ?, claimed = 0 WHERE uniqueKey = ?").bind(JSON.stringify(groupData), JSON.stringify(pending), uniqueKey).run();
    if (row.threadId) await removeThreadMember(row.threadId, user.id, token).catch(() => {});
    const updatedOffer = { ...row, groupData, pendingApplicants: pending, claimed: false };
    await refreshDungeonEmbed(updatedOffer, uniqueKey, env);
    return ephemeral("Signup cancelled!");
  }

  if (customId.startsWith("kick_dungeon_")) {
    const parts = customId.split("_");
    const uniqueKey = parts[2];
    const memberId = parts[3];
    const role = parts[4];
    const row = await db.prepare("SELECT * FROM dungeon_offers WHERE uniqueKey = ?").bind(uniqueKey).first();
    if (!row) return ephemeral("This offer is no longer available!");
    if (row.userId !== user.id) return ephemeral("Only the owner can kick members!");
    const groupData = row.groupData ? JSON.parse(row.groupData) : {};
    if (role === "Tank") { groupData.tank = null; groupData.tankHasKey = null; }
    else if (role === "Healer") { groupData.healer = null; groupData.healerHasKey = null; }
    else if (role === "DPS") {
      const idx = groupData.dps?.indexOf(memberId);
      if (idx >= 0) { groupData.dps.splice(idx, 1); groupData.dpsRatings?.splice(idx, 1); groupData.dpsHasKeys?.splice(idx, 1); }
    }
    if (row.threadId) await removeThreadMember(row.threadId, memberId, token).catch(() => {});
    await db.prepare("UPDATE dungeon_offers SET groupData = ?, claimed = 0 WHERE uniqueKey = ?").bind(JSON.stringify(groupData), uniqueKey).run();
    const updatedOffer = { ...row, groupData, claimed: false };
    await refreshDungeonEmbed(updatedOffer, uniqueKey, env);
    try { await sendDM(memberId, token, `You have been kicked from the ${row.dungeon} ${keystoneDisplay(row.keystoneLevel)} group.`); } catch {}
    return ephemeral(`Kicked <@${memberId}>!`);
  }

  if (customId.startsWith("reject_")) {
    const parts = customId.split("_");
    const shortKey = parts[1];
    const applicantId = parts[2];
    const rowKeys = await db.prepare("SELECT uniqueKey FROM dungeon_offers").all();
    const match = rowKeys.find(r => r.uniqueKey.startsWith(shortKey));
    if (!match) return ephemeral("Offer not found!");
    const row = await db.prepare("SELECT * FROM dungeon_offers WHERE uniqueKey = ?").bind(match.uniqueKey).first();
    if (!row) return ephemeral("Offer not found!");
    if (row.userId !== user.id) return ephemeral("Only owner can reject!");
    let pending = row.pendingApplicants ? JSON.parse(row.pendingApplicants) : [];
    pending = pending.filter(a => a.userId !== applicantId);
    await db.prepare("UPDATE dungeon_offers SET pendingApplicants = ? WHERE uniqueKey = ?").bind(JSON.stringify(pending), match.uniqueKey).run();
    const updatedOffer = { ...row, pendingApplicants: pending };
    await refreshDungeonEmbed(updatedOffer, match.uniqueKey, env);
    try { await sendDM(applicantId, token, `Your application for ${row.dungeon} ${keystoneDisplay(row.keystoneLevel)} has been rejected.`); } catch {}
    return ephemeral(`Rejected <@${applicantId}>!`);
  }

  return ephemeral("Unknown dungeon interaction");
}
