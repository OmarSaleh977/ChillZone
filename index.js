require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

// الأنظمة المتبقية فقط
const { reloadGoldOffers, handleGoldInteraction } = require("./services/gold");
const {
  initializeLevelingTicket,
  reloadLevelingOffers,
  handleLevelingInteraction,
} = require("./services/leveling");
const {
  handleDungeonInteraction,
  loadDungeonOffers,
} = require("./services/dungeons");
const { handleAccountInteraction } = require("./services/accounts");
const { handleGoldPriceInteraction } = require("./services/gold_price");
const { db, initializeDatabase, cleanInvalidOffers } = require("./database");

const requiredEnvVars = [
  "BOT_TOKEN",
  "BOT_OWNER_ID",
  "TICKET_CHANNEL_ID",
  "DUNGEON_CHANNEL_ID",
  "LEVELING_CHANNEL_ID",
  "GOLD_CHANNEL_ID",
  "DUNGEON_OFFERS_CHANNEL_ID",
  "ACCOUNT_CHANNEL_ID",
];
for (const envVar of requiredEnvVars) {
  console.log(`${envVar}: ${process.env[envVar] ? "Loaded" : "Missing"}`);
  if (!process.env[envVar]) {
    console.error(`${envVar} is undefined or empty`);
    process.exit(1);
  }
}

// إعدادات الترحيب
const WELCOME_CHANNEL_ID = "1452171622537629847";
const VERIFY_ROLE_ID = "1387156059432423646";
const GOOD_DEED_ROLE_ID = "1461310397268230298";
const INVITES_NEEDED = 2;
const inviteCache = new Map();

async function updateInviteCache(guild) {
  try {
    const invites = await guild.invites.fetch({ cache: false });
    const guildMap = new Map();
    invites.forEach((invite) => {
      if (invite.code && invite.inviter) {
        guildMap.set(invite.code, {
          uses: invite.uses,
          inviterId: invite.inviter.id,
          usesBefore: invite.uses
        });
      }
    });
    inviteCache.set(guild.id, guildMap);
  } catch (err) {
    console.warn(`فشل تحديث كاش الدعوات:`, err.message);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildInvites,
  ],
});

let levelingWebhook = null;
let goldWebhook = null;
let dungeonWebhook = null;
let accountWebhook = null;

async function getOrCreateWebhook(channel, webhookName) {
  try {
    const existingWebhooks = await channel.fetchWebhooks();
    let webhook = existingWebhooks.find((wh) => wh.owner.id === client.user.id);
    if (!webhook) {
      const botMember = await channel.guild.members.fetch(client.user.id);
      if (!botMember.permissionsIn(channel).has(PermissionsBitField.Flags.ManageWebhooks)) {
        console.error(`Missing Manage Webhooks permission in channel ${channel.id}`);
        return null;
      }
      webhook = await channel.createWebhook({
        name: webhookName,
        avatar: client.user.displayAvatarURL(),
        reason: `Created by ${client.user.tag} for offers`,
      });
    }
    return webhook;
  } catch (error) {
    console.error(`Error creating webhook for channel ${channel.id}:`, error.message);
    return null;
  }
}

async function initializeWebhooks() {
  try {
    levelingWebhook = await getOrCreateWebhook(await client.channels.fetch(process.env.LEVELING_CHANNEL_ID), "LevelingWebhook");
    goldWebhook = await getOrCreateWebhook(await client.channels.fetch(process.env.GOLD_CHANNEL_ID), "GoldWebhook");
    dungeonWebhook = await getOrCreateWebhook(await client.channels.fetch(process.env.DUNGEON_OFFERS_CHANNEL_ID), "DungeonWebhook");
    accountWebhook = await getOrCreateWebhook(await client.channels.fetch(process.env.ACCOUNT_CHANNEL_ID), "AccountWebhook");
    console.log("Webhooks initialized successfully");
  } catch (error) {
    console.error("Error initializing webhooks:", error.message);
  }
}

async function setBotAvatar() {
  try {
    const imagePath = path.join(__dirname, "#manasi.jpg");
    await fs.promises.access(imagePath);
    const imageBuffer = await fs.promises.readFile(imagePath);
    await client.user.setAvatar(imageBuffer);
    console.log("Bot avatar updated successfully");
  } catch (error) {
    console.error("Error setting bot avatar:", error.message);
  }
}

async function initializeTicketMessage() {
  try {
    const ticketChannel = await client.channels.fetch(process.env.TICKET_CHANNEL_ID);
    let ticketMessageId = db
      .prepare("SELECT messageId FROM ticket_messages WHERE channelId = ?")
      .get(process.env.TICKET_CHANNEL_ID)?.messageId;
    const embed = new EmbedBuilder()
      .setColor("#800080")
      .setTitle("🌌 **ChillZone – Your Gateway to WoW** 🌌")
      .setDescription("أهلاً بيك في السيرفر رقم واحد في الوطن العربي 🎮\n\nاختر اللي عايزه:")
      .setThumbnail("https://i.ibb.co/4w4LWq9Z/Chill-Zone-Bot-Vibrant-Animated.gif");
    const goldPriceButton = new ButtonBuilder()
      .setCustomId("gold_price_button")
      .setLabel("💰｜𝗚𝗢𝗟𝗗 𝗣𝗥𝗜𝗖𝗘")
      .setStyle(ButtonStyle.Success);
    const levelingButton = new ButtonBuilder()
      .setCustomId("leveling_button")
      .setLabel("⏫｜𝗟𝗘𝗩𝗘𝗟𝗜𝗡𝗚")
      .setStyle(ButtonStyle.Primary);
    const dungeonButton = new ButtonBuilder()
      .setCustomId("dungeon_button")
      .setLabel("🗡️｜𝗗𝗨𝗡𝗚𝗘𝗢𝗡𝗦")
      .setStyle(ButtonStyle.Primary);
    const accountButton = new ButtonBuilder()
      .setCustomId("account_button")
      .setLabel("💼｜𝗦𝗘𝗟𝗟 𝗕𝗨𝗬 𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦")
      .setStyle(ButtonStyle.Danger);
    const goldButton = new ButtonBuilder()
      .setCustomId("gold_button")
      .setLabel("💵｜𝗦𝗘𝗟𝗟 𝗕𝗨𝗬 𝗚𝗢𝗟𝗗")
      .setStyle(ButtonStyle.Success);
    const row1 = new ActionRowBuilder().addComponents(goldPriceButton, levelingButton, dungeonButton);
    const row2 = new ActionRowBuilder().addComponents(accountButton, goldButton);
    if (ticketMessageId) {
      try {
        const message = await ticketChannel.messages.fetch(ticketMessageId);
        await message.edit({ embeds: [embed], components: [row1, row2] });
      } catch {
        ticketMessageId = null;
      }
    }
    if (!ticketMessageId) {
      const message = await ticketChannel.send({ embeds: [embed], components: [row1, row2] });
      db.prepare("INSERT OR REPLACE INTO ticket_messages (channelId, messageId) VALUES (?, ?)")
        .run(process.env.TICKET_CHANNEL_ID, message.id);
    }
  } catch (error) {
    console.error("Error in initializeTicketMessage:", error);
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await updateInviteCache(guild);
  }
  console.log("كاش الدعوات جاهز");
  try {
    await setBotAvatar();
    initializeDatabase();
    await cleanInvalidOffers(client);
    await initializeWebhooks();
    await initializeTicketMessage();
    if (levelingWebhook) await reloadLevelingOffers(client, levelingWebhook, { LEVELING_CHANNEL_ID: process.env.LEVELING_CHANNEL_ID });
    if (goldWebhook) await reloadGoldOffers(client, goldWebhook, { GOLD_CHANNEL_ID: process.env.GOLD_CHANNEL_ID });
    if (dungeonWebhook) {
      const count = await loadDungeonOffers(client, dungeonWebhook, { DUNGEON_OFFERS_CHANNEL_ID: process.env.DUNGEON_OFFERS_CHANNEL_ID });
      console.log(`Dungeon offers: ${count}`);
    }
    await initializeLevelingTicket(client, { LEVELING_CHANNEL_ID: process.env.LEVELING_CHANNEL_ID });

    // إرسال زرار Game On مرة واحدة فقط
    try {
      const gameChannelId = "1483495161584681174";
      const gameChannel = await client.channels.fetch(gameChannelId);
      if (gameChannel && gameChannel.isTextBased()) {
        
        const messages = await gameChannel.messages.fetch({ limit: 50 });
        const buttonExists = messages.some(msg => 
          msg.components.some(row => 
            row.components.some(comp => comp.customId === "game_on_button")
          )
        );

        if (!buttonExists) {
          const gameOnButton = new ButtonBuilder()
            .setCustomId("game_on_button")
            .setLabel("Game On")
            .setStyle(ButtonStyle.Success)
            .setEmoji("⚔️");

          const row = new ActionRowBuilder().addComponents(gameOnButton);

          await gameChannel.send({
            content: "اضغط لو اللعبة فتحت والسيرفرات أونلاين",
            components: [row],
          });
          console.log("تم إرسال زرار Game On في القناة 1483495161584681174");
        } else {
          console.log("زرار Game On موجود بالفعل، لم يتم إرسال رسالة جديدة");
        }
      }
    } catch (err) {
      console.error("فشل التحقق/إرسال زرار Game On:", err.message);
    }

    console.log("البوت جاهز 100%");
  } catch (err) {
    console.error("خطأ في الـ ready:", err);
  }
});

client.on("guildMemberAdd", async (member) => {
  // ... (كود الترحيب بدون تغيير)
  const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) return;
  let inviter = null;
  let currentInvites = 0;
  await updateInviteCache(member.guild);
  const guildInvites = inviteCache.get(member.guild.id);
  if (guildInvites) {
    for (const [code, data] of guildInvites) {
      const oldUses = data.usesBefore || 0;
      if (data.uses > oldUses) {
        if (data.inviterId) {
          inviter = await client.users.fetch(data.inviterId).catch(() => null);
          data.usesBefore = data.uses;
          break;
        }
      }
    }
  }
  if (inviter) {
    const inviterId = inviter.id;
    let row = db.prepare("SELECT inviteCount FROM invites WHERE userId = ?").get(inviterId);
    currentInvites = row ? row.inviteCount + 1 : 1;
    db.prepare(`
      INSERT INTO invites (userId, inviteCount, lastInviteDate)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(userId) DO UPDATE SET
        inviteCount = inviteCount + 1,
        lastInviteDate = datetime('now')
    `).run(inviterId, currentInvites);
  }
  const embed = new EmbedBuilder()
    .setColor("#800080")
    .setTitle(`أهلاً بيك يا ${member.displayName} في 🌌ChillZone`)
    .setDescription("سيرفر بوت رقم ١ في الوطن العربي ChillZone 🌌 #1\n\nدوس على الزرار تحت علشان تاخد الرول وتبدأ تشارك معانا")
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
    .setFooter({
      text: `عددنا دلوقتي: ${member.guild.memberCount} عضو`,
      iconURL: member.guild.iconURL({ dynamic: true })
    })
    .setTimestamp();
  if (inviter) {
    const remaining = Math.max(0, INVITES_NEEDED - currentInvites);
    const bar = "█".repeat(currentInvites) + "░".repeat(remaining);
    embed.addFields({
      name: "تمت الدعوة بواسطة",
      value: `👤 **<@${inviter.id}>**\n👥 دعواته: **${currentInvites}/${INVITES_NEEDED}**\n\`\`\`${bar}\`\`\``,
      inline: false
    });
  }
  const button = new ButtonBuilder()
    .setCustomId("welcome_verify")
    .setLabel("دوس هنا")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("✅");
  await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)]
  });
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.replied || interaction.deferred) return;
  try {
    console.log(`[INTERACTION] زرار ضغط: ${interaction.customId || 'غير معروف'} من ${interaction.user.tag}`);

    if (interaction.isButton() && interaction.customId === "game_on_button") {
      const targetChannel = await client.channels.fetch("1425206436404789318").catch(() => null);
      if (!targetChannel || !targetChannel.isTextBased()) {
        return interaction.reply({ content: "القناة المستهدفة مش موجودة!", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor("#7B1FA2")
        .setTitle("Game On ✅")
        .setDescription("WoW servers are live now")
        .addFields(
          { name: "Online Since", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false },
        )
        .setThumbnail(interaction.guild.iconURL({ size: 1024 }) || null)
        .setFooter({ text: "ChillZone • World of Warcraft" })
        .setTimestamp();

      // هنا المنشن @everyone
      const message = await targetChannel.send({
        content: "@everyone",   // ← منشن للكل
        embeds: [embed],
      });

      await message.react("✅");

      await interaction.reply({
        content: "تم الإعلان عن أونلاين السيرفرات بمنشن للجميع!",
        ephemeral: true,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === "welcome_verify") {
      const role = interaction.guild.roles.cache.get(VERIFY_ROLE_ID);
      if (!role) return interaction.reply({ content: "الرول مش موجود!", ephemeral: true });
      if (interaction.member.roles.cache.has(VERIFY_ROLE_ID)) {
        return interaction.reply({ content: "عندك الرول بالفعل!", ephemeral: true });
      }
      await interaction.member.roles.add(VERIFY_ROLE_ID);
      await interaction.reply({ content: "**تم تأكيد عضويتك بنجاح!** 🔥", ephemeral: true });
      return;
    }

    // باقي الأزرار
    if (await handleGoldPriceInteraction(interaction, client)) return;
    if (await handleGoldInteraction(interaction, client, goldWebhook, { GOLD_CHANNEL_ID: process.env.GOLD_CHANNEL_ID })) return;
    if (await handleLevelingInteraction(interaction, client, levelingWebhook, { LEVELING_CHANNEL_ID: process.env.LEVELING_CHANNEL_ID })) return;
    if (await handleDungeonInteraction(interaction, client, dungeonWebhook, { DUNGEON_OFFERS_CHANNEL_ID: process.env.DUNGEON_OFFERS_CHANNEL_ID })) return;
    if (await handleAccountInteraction(interaction, client, accountWebhook, { ACCOUNT_CHANNEL_ID: process.env.ACCOUNT_CHANNEL_ID })) return;

    await interaction.reply({ content: "الزرار ده مش مدعوم حاليًا!", ephemeral: true });
  } catch (error) {
    console.error("Interaction error:", error.message, error.stack);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "حصل خطأ، جرب تاني!", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error("Failed to login:", error.message, error.stack);
  process.exit(1);
});