const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  ButtonStyle,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../database");

const tradeOffers = new Map();
const applyData = new Map();

// Bot configuration
const BOT_OWNER_ID = "711027724663128106"; // Replace with your Discord user ID

// Helper functions
async function getUserDisplayName(userId, guildId, client) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    return (
      member.displayName.charAt(0).toUpperCase() + member.displayName.slice(1)
    );
  } catch {
    try {
      const user = await client.users.fetch(userId);
      return user.username.charAt(0).toUpperCase() + user.username.slice(1);
    } catch {
      return "Unknown User";
    }
  }
}

function getDungeonAbbreviation(dungeon) {
  const abbreviations = {
    "Eco-Dome Al'dani": "ECO",
    "Ara-Kara, City of Echoes": "ARA",
    "The Dawnbreaker": "DB",
    "Priory of the Sacred Flame": "PSF",
    "Operation: Floodgate": "FG",
    "Halls of Atonement": "HOA",
    "Tazavesh: Streets of Wonder": "STRT",
    "Tazavesh: So'leah's Gambit": "GMBT",
  };
  return abbreviations[dungeon] || dungeon;
}

function getRoleEmoji(role) {
  return { Tank: "🛡️", Healer: "➕", DPS: "🗡️" }[role] || "";
}

function getRankFromBoosts(boosts) {
  if (boosts >= 200) return "Platinum";
  if (boosts >= 100) return "Gold";
  if (boosts >= 50) return "Silver";
  return "Bronze";
}

// Save or update dungeon offer in database
function saveDungeonOffer(offer, uniqueKey) {
  db.prepare(
    `
    INSERT OR REPLACE INTO dungeon_offers (
      uniqueKey, type, userId, userTag, dungeon, keystoneLevel, runType, stack, numberOfRuns, cut, claimed, messageId, groupData, pendingApplicants, threadId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    uniqueKey,
    offer.type,
    offer.user.id,
    offer.user.tag,
    offer.dungeon,
    offer.keystoneLevel,
    offer.runType,
    offer.stack,
    offer.numberOfRuns,
    offer.cut,
    offer.claimed ? 1 : 0,
    offer.messageId,
    JSON.stringify(offer.groupData),
    JSON.stringify(offer.pendingApplicants),
    offer.threadId || null,
  );
}

// Delete dungeon offer from database
function deleteDungeonOffer(uniqueKey) {
  db.prepare("DELETE FROM dungeon_offers WHERE uniqueKey = ?").run(uniqueKey);
}

// Load dungeon offers from database
async function loadDungeonOffers(client, webhook, config) {
  const offers = db.prepare("SELECT * FROM dungeon_offers").all();
  for (const offer of offers) {
    tradeOffers.set(offer.uniqueKey, {
      type: offer.type,
      user: { id: offer.userId, tag: offer.userTag },
      dungeon: offer.dungeon,
      keystoneLevel: offer.keystoneLevel,
      runType: offer.runType,
      stack: offer.stack,
      numberOfRuns: offer.numberOfRuns,
      cut: offer.cut,
      claimed: offer.claimed === 1,
      messageId: offer.messageId,
      groupData: JSON.parse(offer.groupData),
      pendingApplicants: JSON.parse(offer.pendingApplicants),
      threadId: offer.threadId || null,
    });
    await validateAndRefreshOffer(client, webhook, offer.uniqueKey, config);
  }
  return offers.length;
}

// Validate and refresh offer embed after bot restart
async function validateAndRefreshOffer(client, webhook, uniqueKey, config) {
  const offer = tradeOffers.get(uniqueKey);
  if (!offer) return;

  try {
    await webhook.fetchMessage(offer.messageId);
    await updateDungeonEmbed(client, offer, webhook, uniqueKey);
  } catch (error) {
    if (error.code === 10008) {
      // Unknown Message
      const channel = await client.channels.fetch(
        config.DUNGEON_OFFERS_CHANNEL_ID,
      );
      const keystoneLevelDisplay =
        offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
      const userRank =
        db
          .prepare("SELECT dungeonRuns FROM user_ranks WHERE userId = ?")
          .get(offer.user.id)?.dungeonRuns || 0;
      const rank = getRankFromBoosts(userRank);
      const tradeEmbed = new EmbedBuilder()
        .setColor("#800080")
        .setTitle(
          offer.claimed
            ? `[CLOSED] 🔒 ${getDungeonAbbreviation(offer.dungeon)} Mythic ${keystoneLevelDisplay} x${offer.numberOfRuns}`
            : `${getDungeonAbbreviation(offer.dungeon)} Mythic ${keystoneLevelDisplay} x${offer.numberOfRuns}`,
        )
        .setThumbnail(
          client.users.cache
            .get(offer.user.id)
            ?.displayAvatarURL({ dynamic: true, size: 256 }),
        )
        .addFields(
          {
            name: "Run Type",
            value: `${offer.runType === "Timed" ? "⏰ Timed" : "🛌 Non-Timed"}`,
            inline: true,
          },
          { name: "Offered Cut", value: `🪙 ${offer.cut}`, inline: true },
          { name: "Stack Type", value: offer.stack, inline: true },
          { name: "Poster Rank", value: `🚀 ${rank}`, inline: true },
          { name: "Pending Applicants", value: "None", inline: false },
          {
            name: "Accepted Players",
            value: `🛡️ Tank: None\n➕ Healer: None\n🗡️ DPS: None`,
            inline: false,
          },
          {
            name: "Filling Progress",
            value: "0/1 Tank | 0/1 Healer | 0/2 DPS",
            inline: false,
          },
        );

      const joinButton = new ButtonBuilder()
        .setCustomId(`apply_dungeon_${uniqueKey}`)
        .setLabel("Join Group")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅")
        .setDisabled(offer.claimed);

      const beginButton = new ButtonBuilder()
        .setCustomId(`start_dungeon_${uniqueKey}`)
        .setLabel("Begin Run")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🚀")
        .setDisabled(offer.claimed);

      const row = new ActionRowBuilder().addComponents(joinButton, beginButton);

      const message = await webhook.send({
        embeds: [tradeEmbed],
        components: [row],
        username: offer.user.tag.split("#")[0],
        avatarURL: client.users.cache
          .get(offer.user.id)
          ?.displayAvatarURL({ dynamic: true, size: 256 }),
      });

      offer.messageId = message.id;
      tradeOffers.set(uniqueKey, offer);
      saveDungeonOffer(offer, uniqueKey);
      await updateDungeonEmbed(client, offer, webhook, uniqueKey);
    } else {
      console.error(`Failed to validate offer ${uniqueKey}: ${error.message}`);
      tradeOffers.delete(uniqueKey);
      deleteDungeonOffer(uniqueKey);
    }
  }

  if (offer.threadId) {
    try {
      await client.channels.fetch(offer.threadId);
    } catch {
      offer.threadId = null;
      tradeOffers.set(uniqueKey, offer);
      saveDungeonOffer(offer, uniqueKey);
    }
  }
}

// Update dungeon embed with current group and applicant data
async function updateDungeonEmbed(
  client,
  offer,
  webhook,
  uniqueKey,
  notifyApplicant = false,
  applicantId = null,
) {
  try {
    let message;
    try {
      message = await webhook.fetchMessage(offer.messageId);
    } catch (error) {
      if (error.code === 10008) {
        const channel = await client.channels.fetch(
          process.env.DUNGEON_OFFERS_CHANNEL_ID,
        );
        const keystoneLevelDisplay =
          offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
        const userRank =
          db
            .prepare("SELECT dungeonRuns FROM user_ranks WHERE userId = ?")
            .get(offer.user.id)?.dungeonRuns || 0;
        const rank = getRankFromBoosts(userRank);
        const tradeEmbed = new EmbedBuilder()
          .setColor("#800080")
          .setTitle(
            offer.claimed
              ? `[CLOSED] 🔒 ${getDungeonAbbreviation(offer.dungeon)} Mythic ${keystoneLevelDisplay} x${offer.numberOfRuns}`
              : `${getDungeonAbbreviation(offer.dungeon)} Mythic ${keystoneLevelDisplay} x${offer.numberOfRuns}`,
          )
          .setThumbnail(
            client.users.cache
              .get(offer.user.id)
              ?.displayAvatarURL({ dynamic: true, size: 256 }),
          )
          .addFields(
            {
              name: "Run Type",
              value: `${offer.runType === "Timed" ? "⏰ Timed" : "🛌 Non-Timed"}`,
              inline: true,
            },
            { name: "Offered Cut", value: `🪙 ${offer.cut}`, inline: true },
            { name: "Stack Type", value: offer.stack, inline: true },
            { name: "Poster Rank", value: `🚀 ${rank}`, inline: true },
            { name: "Pending Applicants", value: "None", inline: false },
            {
              name: "Accepted Players",
              value: `🛡️ Tank: None\n➕ Healer: None\n🗡️ DPS: None`,
              inline: false,
            },
            {
              name: "Filling Progress",
              value: "0/1 Tank | 0/1 Healer | 0/2 DPS",
              inline: false,
            },
          );

        const joinButton = new ButtonBuilder()
          .setCustomId(`apply_dungeon_${uniqueKey}`)
          .setLabel("Join Group")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅")
          .setDisabled(offer.claimed);

        const beginButton = new ButtonBuilder()
          .setCustomId(`start_dungeon_${uniqueKey}`)
          .setLabel("Begin Run")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🚀")
          .setDisabled(offer.claimed);

        const row = new ActionRowBuilder().addComponents(
          joinButton,
          beginButton,
        );

        message = await webhook.send({
          embeds: [tradeEmbed],
          components: [row],
          username: offer.user.tag.split("#")[0],
          avatarURL: client.users.cache
            .get(offer.user.id)
            ?.displayAvatarURL({ dynamic: true, size: 256 }),
        });

        offer.messageId = message.id;
        tradeOffers.set(uniqueKey, offer);
        saveDungeonOffer(offer, uniqueKey);
      } else {
        throw error;
      }
    }

    const embed = message.embeds[0];
    const keystoneLevelDisplay =
      offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
    const userRank =
      db
        .prepare("SELECT dungeonRuns FROM user_ranks WHERE userId = ?")
        .get(offer.user.id)?.dungeonRuns || 0;
    const rank = getRankFromBoosts(userRank);

    const pendingApplicants =
      offer.pendingApplicants.length > 0
        ? offer.pendingApplicants
            .map((app) => {
              const hasKeyEmoji = app.hasKey === "Have Key" ? "✅" : "❌";
              const dungeonAbbr =
                app.hasKey === "Have Key" && app.selectedDungeon
                  ? getDungeonAbbreviation(app.selectedDungeon)
                  : "";
              return `<@${app.userId}> ${getRoleEmoji(app.role)} ${app.characterName} (${app.class} ${app.mythicRating} ${hasKeyEmoji}${dungeonAbbr ? ` ${dungeonAbbr}` : ""})`;
            })
            .join("\n")
        : "None";

    const acceptedPlayers = [];
    if (offer.groupData.tank) {
      const tankChar = db
        .prepare(
          "SELECT characterName, mythicRating, class FROM characters WHERE userId = ?",
        )
        .get(offer.groupData.tank);
      const hasKeyEmoji =
        offer.groupData.tankHasKey === "Have Key" ? "✅" : "❌";
      acceptedPlayers.push(
        `🛡️ Tank: <@${offer.groupData.tank}> (${tankChar ? `${tankChar.characterName} (${tankChar.class} ${tankChar.mythicRating} ${hasKeyEmoji})` : "Unknown"})`,
      );
    } else {
      acceptedPlayers.push("🛡️ Tank: None");
    }
    if (offer.groupData.healer) {
      const healerChar = db
        .prepare(
          "SELECT characterName, mythicRating, class FROM characters WHERE userId = ?",
        )
        .get(offer.groupData.healer);
      const hasKeyEmoji =
        offer.groupData.healerHasKey === "Have Key" ? "✅" : "❌";
      acceptedPlayers.push(
        `➕ Healer: <@${offer.groupData.healer}> (${healerChar ? `${healerChar.characterName} (${healerChar.class} ${healerChar.mythicRating} ${hasKeyEmoji})` : "Unknown"})`,
      );
    } else {
      acceptedPlayers.push("➕ Healer: None");
    }
    const dpsLines =
      offer.groupData.dps.length > 0
        ? offer.groupData.dps.map((id, index) => {
            const dpsChar = db
              .prepare(
                "SELECT characterName, mythicRating, class FROM characters WHERE userId = ?",
              )
              .get(id);
            const hasKeyEmoji =
              offer.groupData.dpsHasKeys[index] === "Have Key" ? "✅" : "❌";
            return `🗡️ DPS: <@${id}> (${dpsChar ? `${dpsChar.characterName} (${dpsChar.class} ${dpsChar.mythicRating} ${hasKeyEmoji})` : "Unknown"})`;
          })
        : ["🗡️ DPS: None"];
    acceptedPlayers.push(...dpsLines);

    const fillingProgress = `${offer.groupData.tank ? "1" : "0"}/1 Tank | ${offer.groupData.healer ? "1" : "0"}/1 Healer | ${offer.groupData.dps.length}/2 DPS`;

    const updatedEmbed = new EmbedBuilder(embed)
      .setTitle(
        offer.claimed
          ? `[CLOSED] 🔒 ${getDungeonAbbreviation(offer.dungeon)} Mythic ${keystoneLevelDisplay} x${offer.numberOfRuns}`
          : `${getDungeonAbbreviation(offer.dungeon)} Mythic ${keystoneLevelDisplay} x${offer.numberOfRuns}`,
      )
      .spliceFields(0, embed.fields.length)
      .addFields(
        {
          name: "Run Type",
          value: `${offer.runType === "Timed" ? "⏰ Timed" : "🛌 Non-Timed"}`,
          inline: true,
        },
        { name: "Offered Cut", value: `🪙 ${offer.cut}`, inline: true },
        { name: "Stack Type", value: offer.stack, inline: true },
        { name: "Poster Rank", value: `🚀 ${rank}`, inline: true },
        {
          name: "Pending Applicants",
          value: offer.claimed ? "N/A (Offer Closed)" : pendingApplicants,
          inline: false,
        },
        {
          name: "Accepted Players",
          value: acceptedPlayers.join("\n"),
          inline: false,
        },
        { name: "Filling Progress", value: fillingProgress, inline: false },
      );

    const components = [];
    const joinButton = new ButtonBuilder()
      .setCustomId(`apply_dungeon_${uniqueKey}`)
      .setLabel("Join Group")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅")
      .setDisabled(offer.claimed);

    const beginButton = new ButtonBuilder()
      .setCustomId(`start_dungeon_${uniqueKey}`)
      .setLabel("Begin Run")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🚀")
      .setDisabled(offer.claimed);

    const reopenButton = offer.claimed
      ? new ButtonBuilder()
          .setCustomId(`reopen_dungeon_${uniqueKey}`)
          .setLabel("Reopen")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🔓")
      : null;

    const allMembers = [
      ...(offer.groupData.tank
        ? [{ userId: offer.groupData.tank, role: "Tank" }]
        : []),
      ...(offer.groupData.healer
        ? [{ userId: offer.groupData.healer, role: "Healer" }]
        : []),
      ...offer.groupData.dps.map((id, index) => ({ userId: id, role: "DPS" })),
      ...offer.pendingApplicants.map((app) => ({
        userId: app.userId,
        role: app.role,
      })),
    ].filter((member) => member.userId !== offer.user.id);

    const cancelButtons = allMembers.map((member) =>
      new ButtonBuilder()
        .setCustomId(`cancel_dungeon_${uniqueKey}_${member.userId}`)
        .setLabel("Cancel Signup")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🏃‍♂️"),
    );

    const row1Components = [joinButton, beginButton];
    if (offer.claimed && reopenButton) {
      row1Components.push(reopenButton);
    } else if (cancelButtons.length > 0) {
      row1Components.push(...cancelButtons.slice(0, 3));
    }

    const row1 = new ActionRowBuilder().addComponents(row1Components);
    components.push(row1);

    if (!offer.claimed && cancelButtons.length > 3) {
      const row2 = new ActionRowBuilder().addComponents(
        cancelButtons.slice(3, 8),
      );
      components.push(row2);
    }

    await webhook.editMessage(offer.messageId, {
      embeds: [updatedEmbed],
      components,
    });

    if (notifyApplicant && applicantId && !offer.claimed) {
      const applicant = await client.users.fetch(applicantId).catch(() => null);
      if (applicant) {
        await applicant.send(
          `Your application for ${offer.dungeon} ${keystoneLevelDisplay} has been submitted and is pending approval.`,
        );
      }
    }

    if (offer.threadId) {
      let thread;
      try {
        thread = await client.channels.fetch(offer.threadId);
      } catch {
        const channel = await client.channels.fetch(
          config.DUNGEON_OFFERS_CHANNEL_ID,
        );
        thread = await channel.threads.create({
          name: `${offer.dungeon} ${keystoneLevelDisplay} - ${client.user.username}`,
          autoArchiveDuration: 10080,
          type: ChannelType.PrivateThread,
        });
        await thread.members.add(offer.user.id);
        await thread.send(
          `Thread recreated for ${offer.dungeon} ${keystoneLevelDisplay}. Use this to coordinate with your group!`,
        );
        offer.threadId = thread.id;
        tradeOffers.set(uniqueKey, offer);
        saveDungeonOffer(offer, uniqueKey);
      }

      const groupMembers = [];
      const characterDetails = [];
      const applicantDetails =
        offer.pendingApplicants.length > 0
          ? offer.pendingApplicants
              .map((app) => {
                const hasKeyEmoji = app.hasKey === "Have Key" ? "✅" : "❌";
                const dungeonAbbr =
                  app.hasKey === "Have Key" && app.selectedDungeon
                    ? getDungeonAbbreviation(app.selectedDungeon)
                    : "";
                return `${getRoleEmoji(app.role)} ${app.role}: <@${app.userId}> (${app.characterName} ${app.class} ${app.mythicRating} ${hasKeyEmoji}${dungeonAbbr ? ` ${dungeonAbbr}` : ""})`;
              })
              .join("\n")
          : "None";

      if (offer.groupData.tank) {
        const tankChar = db
          .prepare(
            "SELECT characterName, class, mythicRating FROM characters WHERE userId = ?",
          )
          .get(offer.groupData.tank);
        const hasKeyEmoji =
          offer.groupData.tankHasKey === "Have Key" ? "✅" : "❌";
        groupMembers.push(`🛡️ Tank: <@${offer.groupData.tank}>`);
        characterDetails.push(
          `🛡️ Tank: /inv ${tankChar ? tankChar.characterName : "Unknown"} (${tankChar ? `${tankChar.class} ${tankChar.mythicRating} ${hasKeyEmoji}` : "Unknown"})`,
        );
      }
      if (offer.groupData.healer) {
        const healerChar = db
          .prepare(
            "SELECT characterName, class, mythicRating FROM characters WHERE userId = ?",
          )
          .get(offer.groupData.healer);
        const hasKeyEmoji =
          offer.groupData.healerHasKey === "Have Key" ? "✅" : "❌";
        groupMembers.push(`➕ Healer: <@${offer.groupData.healer}>`);
        characterDetails.push(
          `➕ Healer: /inv ${healerChar ? healerChar.characterName : "Unknown"} (${healerChar ? `${healerChar.class} ${healerChar.mythicRating} ${hasKeyEmoji}` : "Unknown"})`,
        );
      }
      if (offer.groupData.dps.length > 0) {
        offer.groupData.dps.forEach((id, index) => {
          const dpsChar = db
            .prepare(
              "SELECT characterName, class, mythicRating FROM characters WHERE userId = ?",
            )
            .get(id);
          const hasKeyEmoji =
            offer.groupData.dpsHasKeys[index] === "Have Key" ? "✅" : "❌";
          groupMembers.push(`🗡️ DPS: <@${id}>`);
          characterDetails.push(
            `🗡️ DPS: /inv ${dpsChar ? dpsChar.characterName : "Unknown"} (${dpsChar ? `${dpsChar.class} ${dpsChar.mythicRating} ${hasKeyEmoji}` : "Unknown"})`,
          );
        });
      }

      const threadEmbed = new EmbedBuilder()
        .setTitle(`Dungeon Run - ${offer.dungeon} ${keystoneLevelDisplay}`)
        .setDescription(
          `**Poster:** <@${offer.user.id}> (🚀 ${userRank} Boosts (${rank}))\n\n` +
            `**Details:**\n` +
            `- Dungeon: ${offer.dungeon}\n` +
            `- Keystone Level: ${keystoneLevelDisplay}\n` +
            `- Number of Runs: ${offer.numberOfRuns}\n` +
            `- Run Type: ${offer.runType}\n` +
            `- Stack Type: ${offer.stack}\n` +
            `- Offered Cut: 🪙 ${offer.cut}\n\n` +
            `**Accepted Members:**\n${groupMembers.length > 0 ? groupMembers.join("\n") : "None"}\n\n` +
            `**Character Details:**\n${characterDetails.length > 0 ? characterDetails.join("\n") : "None"}\n\n` +
            `**Pending Applicants:**\n${applicantDetails}\n\n` +
            `Coordinate your run here!`,
        )
        .setColor("#800080");

      const components = [];
      const ggButton = new ButtonBuilder()
        .setCustomId(`gg_key_done_${uniqueKey}`)
        .setLabel("GG, Key Done")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅");

      const kickButtons = [];
      if (offer.groupData.tank && offer.groupData.tank !== offer.user.id) {
        const tankChar = db
          .prepare("SELECT characterName FROM characters WHERE userId = ?")
          .get(offer.groupData.tank);
        kickButtons.push(
          new ButtonBuilder()
            .setCustomId(
              `kick_dungeon_${uniqueKey}_${offer.groupData.tank}_Tank`,
            )
            .setLabel(
              tankChar ? `Remove ${tankChar.characterName}` : `Remove Tank`,
            )
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🚫"),
        );
      }
      if (offer.groupData.healer && offer.groupData.healer !== offer.user.id) {
        const healerChar = db
          .prepare("SELECT characterName FROM characters WHERE userId = ?")
          .get(offer.groupData.healer);
        kickButtons.push(
          new ButtonBuilder()
            .setCustomId(
              `kick_dungeon_${uniqueKey}_${offer.groupData.healer}_Healer`,
            )
            .setLabel(
              healerChar
                ? `Remove ${healerChar.characterName}`
                : `Remove Healer`,
            )
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🚫"),
        );
      }
      offer.groupData.dps.forEach((dpsId, index) => {
        if (dpsId !== offer.user.id) {
          const dpsChar = db
            .prepare("SELECT characterName FROM characters WHERE userId = ?")
            .get(dpsId);
          kickButtons.push(
            new ButtonBuilder()
              .setCustomId(`kick_dungeon_${uniqueKey}_${dpsId}_DPS_${index}`)
              .setLabel(
                dpsChar ? `Remove ${dpsChar.characterName}` : `Remove DPS`,
              )
              .setStyle(ButtonStyle.Danger)
              .setEmoji("🚫"),
          );
        }
      });

      const acceptButtons = offer.pendingApplicants.map((app) => {
        const hasKeyEmoji = app.hasKey === "Have Key" ? "✅" : "❌";
        return new ButtonBuilder()
          .setCustomId(
            `accept_${uniqueKey.split("-")[0]}_${app.userId}_${app.role}_${app.class}_${app.mythicRating}_${app.hasKey}`,
          )
          .setLabel(`Accept ${app.characterName}`)
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅");
      });

      components.push(new ActionRowBuilder().addComponents(ggButton));
      if (offer.claimed) {
        components.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`reopen_dungeon_${uniqueKey}`)
              .setLabel("Reopen")
              .setStyle(ButtonStyle.Primary)
              .setEmoji("🔓"),
          ),
        );
      }

      if (kickButtons.length > 0) {
        const kickRow = new ActionRowBuilder().addComponents(
          kickButtons.slice(0, 4),
        );
        components.push(kickRow);
      }
      if (acceptButtons.length > 0) {
        const acceptRows = [];
        for (let i = 0; i < acceptButtons.length; i += 5) {
          acceptRows.push(
            new ActionRowBuilder().addComponents(acceptButtons.slice(i, i + 5)),
          );
        }
        components.push(...acceptRows);
      }

      const messages = await thread.messages.fetch({ limit: 100 });
      const threadMessage = messages.find(
        (msg) =>
          !msg.system &&
          msg.author.id === client.user.id &&
          msg.embeds.length > 0,
      );
      if (threadMessage) {
        await threadMessage.edit({ embeds: [threadEmbed], components });
      } else {
        await thread.send({ embeds: [threadEmbed], components });
      }
    }
  } catch (error) {
    console.error(
      `Error updating dungeon embed for ${uniqueKey}: ${error.message}`,
    );
  }
}

// Initialize dungeon ticket system
async function initializeDungeonTicket(client, config) {
  try {
    const dungeonChannel = await client.channels.fetch(
      config.DUNGEON_OFFERS_CHANNEL_ID,
    );
    if (!dungeonChannel)
      throw new Error(
        `Dungeon channel ${config.DUNGEON_OFFERS_CHANNEL_ID} not found`,
      );

    const botMember = await dungeonChannel.guild.members.fetch(client.user.id);
    if (
      !botMember
        .permissionsIn(dungeonChannel)
        .has([
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
        ])
    ) {
      throw new Error("Bot lacks necessary permissions in dungeon channel");
    }

    let dungeonMessageId = db
      .prepare("SELECT messageId FROM ticket_messages WHERE channelId = ?")
      .get(config.DUNGEON_OFFERS_CHANNEL_ID)?.messageId;

    const embed = new EmbedBuilder()
      .setTitle("Create a Dungeon Offer")
      .setDescription("Click the button below to create a new dungeon offer.")
      .setColor("#800080");

    const dungeonButton = new ButtonBuilder()
      .setCustomId("dungeon_button")
      .setLabel("Create Dungeon Offer")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔑");

    const row = new ActionRowBuilder().addComponents(dungeonButton);

    if (dungeonMessageId) {
      try {
        const message = await dungeonChannel.messages.fetch(dungeonMessageId);
        await message.edit({ embeds: [embed], components: [row] });
      } catch {
        dungeonMessageId = null;
      }
    }

    if (!dungeonMessageId) {
      const message = await dungeonChannel.send({
        embeds: [embed],
        components: [row],
      });
      db.prepare(
        "INSERT OR REPLACE INTO ticket_messages (channelId, messageId) VALUES (?, ?)",
      ).run(config.DUNGEON_OFFERS_CHANNEL_ID, message.id);
    }
  } catch (error) {
    console.error(`Error initializing dungeon ticket: ${error.message}`);
  }
}

// Handle dungeon interactions
async function handleDungeonInteraction(interaction, client, webhook, config) {
  if (
    !interaction.isButton() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isModalSubmit()
  )
    return false;

  // Create Dungeon Offer
  if (interaction.isButton() && interaction.customId === "dungeon_button") {
    const submissionKey = `${interaction.user.id}-${Date.now()}`;
    const dungeonMenu = new StringSelectMenuBuilder()
      .setCustomId(`dungeon_select_${submissionKey}`)
      .setPlaceholder("Select Dungeon")
      .addOptions(
        [
          "Eco-Dome Al'dani",
          "Ara-Kara, City of Echoes",
          "The Dawnbreaker",
          "Priory of the Sacred Flame",
          "Operation: Floodgate",
          "Halls of Atonement",
          "Tazavesh: Streets of Wonder",
          "Tazavesh: So'leah's Gambit",
        ].map((dungeon) => ({ label: dungeon, value: dungeon })),
      );

    await interaction.reply({
      content: "Select a dungeon to create an offer:",
      components: [new ActionRowBuilder().addComponents(dungeonMenu)],
      ephemeral: true,
    });
    return true;
  }

  // Select Dungeon
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("dungeon_select_")
  ) {
    const submissionKey = interaction.customId.split("_")[2];
    const dungeon = interaction.values[0];

    const keystoneMenu = new StringSelectMenuBuilder()
      .setCustomId(
        `keystone_select_${submissionKey}_${encodeURIComponent(dungeon)}`,
      )
      .setPlaceholder("Select Keystone Level")
      .addOptions(
        Array.from({ length: 19 }, (_, i) => ({
          label: `Keystone Level ${i === 0 ? "0" : `+${i}`}`,
          value: i === 0 ? "0" : `+${i}`,
        })),
      );

    await interaction.update({
      content: `Select a keystone level for ${dungeon}:`,
      components: [new ActionRowBuilder().addComponents(keystoneMenu)],
      ephemeral: true,
    });
    return true;
  }

  // Select Keystone Level
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("keystone_select_")
  ) {
    const parts = interaction.customId.split("_");
    const submissionKey = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const keystoneLevel = interaction.values[0];

    const runTypeMenu = new StringSelectMenuBuilder()
      .setCustomId(
        `runtype_select_${submissionKey}_${encodeURIComponent(dungeon)}_${keystoneLevel}`,
      )
      .setPlaceholder("Select Run Type")
      .addOptions(
        { label: "Timed ⏰", value: "Timed" },
        { label: "Non-Timed 🛌", value: "Non-Timed" },
      );

    await interaction.update({
      content: `Select the run type for ${dungeon} ${keystoneLevel}:`,
      components: [new ActionRowBuilder().addComponents(runTypeMenu)],
      ephemeral: true,
    });
    return true;
  }

  // Select Run Type
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("runtype_select_")
  ) {
    const parts = interaction.customId.split("_");
    const submissionKey = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const keystoneLevel = parts[4];
    const runType = interaction.values[0];

    const stackMenu = new StringSelectMenuBuilder()
      .setCustomId(
        `stack_select_${submissionKey}_${encodeURIComponent(dungeon)}_${keystoneLevel}_${runType}`,
      )
      .setPlaceholder("Select Stack Type")
      .addOptions(
        { label: "Plate 🛡️", value: "Plate" },
        { label: "Mail 📬", value: "Mail" },
        { label: "Cloth 👘", value: "Cloth" },
      );

    await interaction.update({
      content: `Select the stack type for ${dungeon} ${keystoneLevel}:`,
      components: [new ActionRowBuilder().addComponents(stackMenu)],
      ephemeral: true,
    });
    return true;
  }

  // Select Stack Type
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("stack_select_")
  ) {
    const parts = interaction.customId.split("_");
    const submissionKey = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const keystoneLevel = parts[4];
    const runType = parts[5];
    const stack = interaction.values[0];

    const numberOfRunsMenu = new StringSelectMenuBuilder()
      .setCustomId(
        `runs_select_${submissionKey}_${encodeURIComponent(dungeon)}_${keystoneLevel}_${runType}_${stack}`,
      )
      .setPlaceholder("Select Number of Runs")
      .addOptions(
        Array.from({ length: 8 }, (_, i) => ({
          label: `${i + 1} Run${i + 1 > 1 ? "s" : ""}`,
          value: (i + 1).toString(),
        })),
      );

    await interaction.update({
      content: `Select the number of runs for ${dungeon} ${keystoneLevel}:`,
      components: [new ActionRowBuilder().addComponents(numberOfRunsMenu)],
      ephemeral: true,
    });
    return true;
  }

  // Select Number of Runs
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("runs_select_")
  ) {
    const parts = interaction.customId.split("_");
    const submissionKey = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const keystoneLevel = parts[4];
    const runType = parts[5];
    const stack = parts[6];
    const numberOfRuns = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(
        `cut_input_${submissionKey}_${encodeURIComponent(dungeon)}_${keystoneLevel}_${runType}_${stack}_${numberOfRuns}`,
      )
      .setTitle("Enter Offered Cut");

    const cutInput = new TextInputBuilder()
      .setCustomId("cut_amount")
      .setLabel("Offered Cut (e.g., 100k)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    await interaction.showModal(
      modal.addComponents(new ActionRowBuilder().addComponents(cutInput)),
    );
    return true;
  }

  // Submit Cut
  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith("cut_input_")
  ) {
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split("_");
    const submissionKey = parts[2];
    const dungeon = decodeURIComponent(parts[3]);
    const keystoneLevel = parts[4];
    const runType = parts[5];
    const stack = parts[6];
    const numberOfRuns = parts[7];
    const cut = interaction.fields.getTextInputValue("cut_amount");

    try {
      if (!webhook) throw new Error("Webhook not initialized");

      const keystoneLevelDisplay =
        keystoneLevel === "0" ? "0" : `+${keystoneLevel}`;
      const uniqueKey = uuidv4();
      const userRank =
        db
          .prepare("SELECT dungeonRuns FROM user_ranks WHERE userId = ?")
          .get(interaction.user.id)?.dungeonRuns || 0;
      const rank = getRankFromBoosts(userRank);
      const tradeEmbed = new EmbedBuilder()
        .setColor("#800080")
        .setTitle(
          `${getDungeonAbbreviation(dungeon)} Mythic ${keystoneLevelDisplay} x${numberOfRuns}`,
        )
        .setThumbnail(
          interaction.user.displayAvatarURL({ dynamic: true, size: 256 }),
        )
        .addFields(
          {
            name: "Run Type",
            value: `${runType === "Timed" ? "⏰ Timed" : "🛌 Non-Timed"}`,
            inline: true,
          },
          { name: "Offered Cut", value: `🪙 ${cut}`, inline: true },
          { name: "Stack Type", value: stack, inline: true },
          { name: "Poster Rank", value: `🚀 ${rank}`, inline: true },
          { name: "Pending Applicants", value: "None", inline: false },
          {
            name: "Accepted Players",
            value: `🛡️ Tank: None\n➕ Healer: None\n🗡️ DPS: None`,
            inline: false,
          },
          {
            name: "Filling Progress",
            value: "0/1 Tank | 0/1 Healer | 0/2 DPS",
            inline: false,
          },
        );

      const joinButton = new ButtonBuilder()
        .setCustomId(`apply_dungeon_${uniqueKey}`)
        .setLabel("Join Group")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅");

      const beginButton = new ButtonBuilder()
        .setCustomId(`start_dungeon_${uniqueKey}`)
        .setLabel("Begin Run")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🚀");

      const row = new ActionRowBuilder().addComponents(joinButton, beginButton);

      const message = await webhook.send({
        embeds: [tradeEmbed],
        components: [row],
        username: interaction.user.displayName || interaction.user.username,
        avatarURL: interaction.user.displayAvatarURL({
          dynamic: true,
          size: 256,
        }),
      });

      const channel = await client.channels.fetch(
        config.DUNGEON_OFFERS_CHANNEL_ID,
      );
      const thread = await channel.threads.create({
        name: `${dungeon} ${keystoneLevelDisplay} - ${client.user.username}`,
        autoArchiveDuration: 10080,
        type: ChannelType.PrivateThread,
      });
      await thread.members.add(interaction.user.id);
      await thread.send(
        `Thread created for ${dungeon} ${keystoneLevelDisplay}. Use this to coordinate with your group!`,
      );

      const threadEmbed = new EmbedBuilder()
        .setTitle(`Dungeon Run - ${dungeon} ${keystoneLevelDisplay}`)
        .setDescription(
          `**Poster:** <@${interaction.user.id}> (🚀 ${userRank} Boosts (${rank}))\n\n` +
            `**Details:**\n` +
            `- Dungeon: ${dungeon}\n` +
            `- Keystone Level: ${keystoneLevelDisplay}\n` +
            `- Number of Runs: ${numberOfRuns}\n` +
            `- Run Type: ${runType}\n` +
            `- Stack Type: ${stack}\n` +
            `- Offered Cut: 🪙 ${cut}\n\n` +
            `**Accepted Members:**\nNone\n\n` +
            `**Character Details:**\nNone\n\n` +
            `**Pending Applicants:**\nNone\n\n` +
            `Coordinate your run here!`,
        )
        .setColor("#800080");

      const ggButton = new ButtonBuilder()
        .setCustomId(`gg_key_done_${uniqueKey}`)
        .setLabel("GG, Key Done")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅");

      await thread.send({
        embeds: [threadEmbed],
        components: [new ActionRowBuilder().addComponents(ggButton)],
      });

      const offer = {
        type: "dungeon",
        user: interaction.user,
        dungeon,
        keystoneLevel,
        runType,
        stack,
        numberOfRuns,
        cut,
        claimed: false,
        messageId: message.id,
        groupData: {
          tank: null,
          healer: null,
          dps: [],
          tankRating: null,
          healerRating: null,
          dpsRatings: [],
          tankHasKey: null,
          healerHasKey: null,
          dpsHasKeys: [],
        },
        pendingApplicants: [],
        threadId: thread.id,
      };

      tradeOffers.set(uniqueKey, offer);
      saveDungeonOffer(offer, uniqueKey);

      await interaction.editReply({
        content: `Dungeon offer created successfully! Check the <#${config.DUNGEON_OFFERS_CHANNEL_ID}> channel.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(`Error creating dungeon offer: ${error.message}`);
      await interaction.editReply({
        content: "Failed to create dungeon offer. Please try again!",
        ephemeral: true,
      });
    }
    return true;
  }

  // Apply to Dungeon Offer
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("apply_dungeon_")
  ) {
    await interaction.deferReply({ ephemeral: true });
    const uniqueKey = interaction.customId.split("_")[2];
    const offer = tradeOffers.get(uniqueKey);

    if (!offer) {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    if (offer.claimed) {
      await interaction.editReply({
        content: "This offer has been claimed or is full!",
        ephemeral: true,
      });
      return true;
    }

    if (offer.user.id === interaction.user.id) {
      await interaction.editReply({
        content: "You cannot apply to your own offer!",
        ephemeral: true,
      });
      return true;
    }

    const characters = db
      .prepare(
        "SELECT characterName, class, mythicRating, role FROM characters WHERE userId = ?",
      )
      .all(interaction.user.id);
    if (!characters.length) {
      await interaction.editReply({
        content: "You must register a character before applying!",
        ephemeral: true,
      });
      return true;
    }

    const applyKey = `${interaction.user.id}-${uniqueKey}-${Date.now()}`;
    applyData.set(applyKey, { userId: interaction.user.id, uniqueKey });

    const characterMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_character_apply_${applyKey}`)
      .setPlaceholder("Select Character")
      .addOptions(
        characters.map((char) => ({
          label: `${getRoleEmoji(char.role)} ${char.characterName.split("-")[0]} ${char.class} ${char.mythicRating}`,
          value: `${char.characterName}_${char.class}_${char.mythicRating}_${char.role}`,
        })),
      );

    await interaction.editReply({
      content: "Select the character you want to apply with:",
      components: [new ActionRowBuilder().addComponents(characterMenu)],
      ephemeral: true,
    });
    return true;
  }

  // Select Character for Application
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("select_character_apply_")
  ) {
    await interaction.deferUpdate();
    const applyKey = interaction.customId.split("_")[3];
    const applyInfo = applyData.get(applyKey);

    if (!applyInfo) {
      await interaction.editReply({
        content: "Application expired. Please try again!",
        components: [],
        ephemeral: true,
      });
      return true;
    }

    const [characterName, selectedClass, mythicRating, role] =
      interaction.values[0].split("_");
    const parsedMythicRating = parseInt(mythicRating);
    if (isNaN(parsedMythicRating)) {
      await interaction.editReply({
        content: "Invalid Mythic+ Rating. Please edit your character.",
        components: [],
        ephemeral: true,
      });
      return true;
    }

    applyData.set(applyKey, {
      ...applyInfo,
      characterName,
      selectedClass,
      mythicRating: parsedMythicRating,
      role,
    });

    const keyMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_key_apply_${applyKey}`)
      .setPlaceholder("Do you have a key?")
      .addOptions(
        {
          label: `${getRoleEmoji(role)} ${characterName.split("-")[0]} ${selectedClass} ${parsedMythicRating} ✅`,
          value: "Have Key",
        },
        {
          label: `${getRoleEmoji(role)} ${characterName.split("-")[0]} ${selectedClass} ${parsedMythicRating} ❌`,
          value: "No Key",
        },
      );

    await interaction.editReply({
      content: `Selected character: ${characterName.split("-")[0]} (${selectedClass} ${parsedMythicRating}). Do you have a key?`,
      components: [new ActionRowBuilder().addComponents(keyMenu)],
      ephemeral: true,
    });
    return true;
  }

  // Select Key for Application
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("select_key_apply_")
  ) {
    await interaction.deferUpdate();
    const applyKey = interaction.customId.split("_")[3];
    const applyInfo = applyData.get(applyKey);

    if (!applyInfo) {
      await interaction.editReply({
        content: "Application expired. Please try again!",
        components: [],
        ephemeral: true,
      });
      return true;
    }

    const hasKey = interaction.values[0];
    applyData.set(applyKey, { ...applyInfo, hasKey });

    if (hasKey === "Have Key") {
      const dungeonMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_dungeon_apply_${applyKey}`)
        .setPlaceholder("Select Dungeon for Your Key")
        .addOptions(
          [
            "Eco-Dome Al'dani",
            "Ara-Kara, City of Echoes",
            "The Dawnbreaker",
            "Priory of the Sacred Flame",
            "Operation: Floodgate",
            "Halls of Atonement",
            "Tazavesh: Streets of Wonder",
            "Tazavesh: So'leah's Gambit",
          ].map((d) => ({ label: d, value: d })),
        );

      await interaction.editReply({
        content: `Selected: ${applyInfo.characterName.split("-")[0]} (${applyInfo.selectedClass} ${applyInfo.mythicRating} ✅). Select the dungeon for your key:`,
        components: [new ActionRowBuilder().addComponents(dungeonMenu)],
        ephemeral: true,
      });
      return true;
    }

    const {
      userId,
      uniqueKey,
      characterName,
      selectedClass,
      mythicRating,
      role,
    } = applyInfo;
    const offer = tradeOffers.get(uniqueKey);

    if (!offer || offer.type !== "dungeon") {
      await interaction.editReply({
        content: "This offer is no longer available!",
        components: [],
        ephemeral: true,
      });
      return true;
    }

    if (
      (role === "Tank" && offer.groupData.tank) ||
      (role === "Healer" && offer.groupData.healer) ||
      (role === "DPS" && offer.groupData.dps.length >= 2) ||
      offer.pendingApplicants.some((app) => app.userId === userId)
    ) {
      await interaction.editReply({
        content: "You have already applied or the role is full!",
        components: [],
        ephemeral: true,
      });
      return true;
    }

    offer.pendingApplicants.push({
      userId,
      characterName: characterName.substring(0, 50).trim() || "Unknown",
      class: selectedClass,
      mythicRating,
      role,
      hasKey,
      selectedDungeon: offer.dungeon,
    });

    await updateDungeonEmbed(client, offer, webhook, uniqueKey, true, userId);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    await interaction.editReply({
      content: `Applied with ${characterName} (${selectedClass} ${mythicRating} ❌)! Awaiting approval.`,
      components: [],
      ephemeral: true,
    });

    const offerUser = await client.users.fetch(offer.user.id).catch(() => null);
    const keystoneLevelDisplay =
      offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
    if (offerUser) {
      const content = `<@${userId}> applied to your ${offer.dungeon} ${keystoneLevelDisplay} offer as ${role} (${characterName} ${selectedClass} ${mythicRating} ❌).`;
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `accept_${uniqueKey.split("-")[0]}_${userId}_${role}_${selectedClass}_${mythicRating}_${hasKey}`,
          )
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId(
            `reject_${uniqueKey.split("-")[0]}_${userId}_${role}_${selectedClass}_${mythicRating}_${hasKey}`,
          )
          .setLabel("Reject")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("❌"),
      );

      try {
        await offerUser.send({
          content: content.substring(0, 1900),
          components: [buttons],
        });
      } catch {
        await webhook.send({
          content: `${content} (DM failed)`,
          components: [buttons],
        });
      }
    }
    applyData.delete(applyKey);
    return true;
  }

  // Select Dungeon for Application (with key)
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("select_dungeon_apply_")
  ) {
    await interaction.deferUpdate();
    const applyKey = interaction.customId.split("_")[3];
    const applyInfo = applyData.get(applyKey);

    if (!applyInfo) {
      await interaction.editReply({
        content: "Application expired. Please try again!",
        components: [],
        ephemeral: true,
      });
      return true;
    }

    const selectedDungeon = interaction.values[0];
    const {
      userId,
      uniqueKey,
      characterName,
      selectedClass,
      mythicRating,
      role,
      hasKey,
    } = applyInfo;
    const offer = tradeOffers.get(uniqueKey);

    if (!offer || offer.type !== "dungeon") {
      await interaction.editReply({
        content: "This offer is no longer available!",
        components: [],
        ephemeral: true,
      });
      return true;
    }

    if (
      (role === "Tank" && offer.groupData.tank) ||
      (role === "Healer" && offer.groupData.healer) ||
      (role === "DPS" && offer.groupData.dps.length >= 2) ||
      offer.pendingApplicants.some((app) => app.userId === userId)
    ) {
      await interaction.editReply({
        content: "You have already applied or the role is full!",
        components: [],
        ephemeral: true,
      });
      return true;
    }

    offer.pendingApplicants.push({
      userId,
      characterName: characterName.substring(0, 50).trim() || "Unknown",
      class: selectedClass,
      mythicRating,
      role,
      hasKey,
      selectedDungeon,
    });

    await updateDungeonEmbed(client, offer, webhook, uniqueKey, true, userId);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    await interaction.editReply({
      content: `Applied with ${characterName} (${selectedClass} ${mythicRating} ✅ ${getDungeonAbbreviation(selectedDungeon)})! Awaiting approval.`,
      components: [],
      ephemeral: true,
    });

    const offerUser = await client.users.fetch(offer.user.id).catch(() => null);
    const keystoneLevelDisplay =
      offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
    if (offerUser) {
      const content = `<@${userId}> applied to your ${offer.dungeon} ${keystoneLevelDisplay} offer as ${role} (${characterName} ${selectedClass} ${mythicRating} ✅ ${getDungeonAbbreviation(selectedDungeon)}).`;
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `accept_${uniqueKey.split("-")[0]}_${userId}_${role}_${selectedClass}_${mythicRating}_${hasKey}`,
          )
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId(
            `reject_${uniqueKey.split("-")[0]}_${userId}_${role}_${selectedClass}_${mythicRating}_${hasKey}`,
          )
          .setLabel("Reject")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("❌"),
      );

      try {
        await offerUser.send({
          content: content.substring(0, 1900),
          components: [buttons],
        });
      } catch {
        await webhook.send({
          content: `${content} (DM failed)`,
          components: [buttons],
        });
      }
    }
    applyData.delete(applyKey);
    return true;
  }

  // Accept Applicant
  if (interaction.isButton() && interaction.customId.startsWith("accept_")) {
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split("_");
    const shortUniqueKey = parts[1];
    const applicantId = parts[2];
    const role = parts[3];
    const selectedClass = parts[4];
    const mythicRating = parseInt(parts[5]);
    const hasKey = parts[6];

    const uniqueKey = [...tradeOffers.keys()].find((key) =>
      key.startsWith(shortUniqueKey),
    );
    if (!uniqueKey) {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    const offer = tradeOffers.get(uniqueKey);
    if (!offer || offer.type !== "dungeon") {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    if (offer.user.id !== interaction.user.id) {
      await interaction.editReply({
        content: "Only the offer owner can accept applicants!",
        ephemeral: true,
      });
      return true;
    }

    if (
      (role === "Tank" && offer.groupData.tank) ||
      (role === "Healer" && offer.groupData.healer) ||
      (role === "DPS" && offer.groupData.dps.length >= 2)
    ) {
      await interaction.editReply({
        content: `${role} slot is already filled!`,
        ephemeral: true,
      });
      return true;
    }

    const applicantData = offer.pendingApplicants.find(
      (app) => app.userId === applicantId,
    );
    if (!applicantData) {
      await interaction.editReply({
        content: "Applicant not found!",
        ephemeral: true,
      });
      return true;
    }

    if (role === "Tank") {
      offer.groupData.tank = applicantId;
      offer.groupData.tankRating = mythicRating;
      offer.groupData.tankHasKey = hasKey;
    } else if (role === "Healer") {
      offer.groupData.healer = applicantId;
      offer.groupData.healerRating = mythicRating;
      offer.groupData.healerHasKey = hasKey;
    } else if (role === "DPS") {
      offer.groupData.dps.push(applicantId);
      offer.groupData.dpsRatings.push(mythicRating);
      offer.groupData.dpsHasKeys.push(hasKey);
    }

    offer.pendingApplicants = offer.pendingApplicants.filter(
      (app) => app.userId !== applicantId,
    );

    if (offer.threadId) {
      const thread = await client.channels
        .fetch(offer.threadId)
        .catch(() => null);
      if (thread) await thread.members.add(applicantId);
    }

    await updateDungeonEmbed(client, offer, webhook, uniqueKey);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    await interaction.editReply({
      content: `Accepted <@${applicantId}> ${applicantData.characterName} (${selectedClass} ${mythicRating} ${hasKey === "Have Key" ? "✅" : "❌"}) as ${role}!`,
      ephemeral: true,
    });

    const applicant = await client.users.fetch(applicantId).catch(() => null);
    if (applicant) {
      const keystoneLevelDisplay =
        offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
      await applicant.send(
        `Your application for ${offer.dungeon} ${keystoneLevelDisplay} as ${role} (${applicantData.characterName} ${selectedClass} ${mythicRating} ${hasKey === "Have Key" ? "✅" : "❌"}) has been accepted! Contact <@${offer.user.id}>.`,
      );
    }
    return true;
  }

  // Reject Applicant
  if (interaction.isButton() && interaction.customId.startsWith("reject_")) {
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split("_");
    const shortUniqueKey = parts[1];
    const applicantId = parts[2];
    const role = parts[3];
    const selectedClass = parts[4];
    const mythicRating = parseInt(parts[5]);
    const hasKey = parts[6];

    const uniqueKey = [...tradeOffers.keys()].find((key) =>
      key.startsWith(shortUniqueKey),
    );
    if (!uniqueKey) {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    const offer = tradeOffers.get(uniqueKey);
    if (!offer || offer.type !== "dungeon") {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    if (offer.user.id !== interaction.user.id) {
      await interaction.editReply({
        content: "Only the offer owner can reject applicants!",
        ephemeral: true,
      });
      return true;
    }

    const applicantData = offer.pendingApplicants.find(
      (app) => app.userId === applicantId,
    );
    if (!applicantData) {
      await interaction.editReply({
        content: "Applicant not found!",
        ephemeral: true,
      });
      return true;
    }

    offer.pendingApplicants = offer.pendingApplicants.filter(
      (app) => app.userId !== applicantId,
    );

    await updateDungeonEmbed(client, offer, webhook, uniqueKey);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    await interaction.editReply({
      content: `Rejected <@${applicantId}> ${applicantData.characterName} (${selectedClass} ${mythicRating} ${hasKey === "Have Key" ? "✅" : "❌"}) for ${role}!`,
      ephemeral: true,
    });

    const applicant = await client.users.fetch(applicantId).catch(() => null);
    if (applicant) {
      const keystoneLevelDisplay =
        offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
      await applicant.send(
        `Your application for ${offer.dungeon} ${keystoneLevelDisplay} as ${role} (${applicantData.characterName} ${selectedClass} ${mythicRating} ${hasKey === "Have Key" ? "✅" : "❌"}) has been rejected.`,
      );
    }
    return true;
  }

  // Start Dungeon
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("start_dungeon_")
  ) {
    await interaction.deferReply({ ephemeral: true });
    const uniqueKey = interaction.customId.split("_")[2];
    const offer = tradeOffers.get(uniqueKey);

    if (!offer) {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    if (offer.user.id !== interaction.user.id) {
      await interaction.editReply({
        content: "Only the offer owner can start the run!",
        ephemeral: true,
      });
      return true;
    }

    const keystoneLevelDisplay =
      offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
    offer.claimed = true;
    await updateDungeonEmbed(client, offer, webhook, uniqueKey);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    const members = [
      offer.groupData.tank,
      offer.groupData.healer,
      ...offer.groupData.dps,
    ].filter((id) => id && id !== offer.user.id);

    for (const memberId of members) {
      const member = await client.users.fetch(memberId).catch(() => null);
      if (member) {
        await member.send(
          `The ${offer.dungeon} ${keystoneLevelDisplay} run has started! Coordinate with <@${offer.user.id}> in the thread: <#${offer.threadId}>.`,
        );
      }
    }

    await interaction.editReply({
      content:
        "Run started! All members have been notified. Coordinate in the thread.",
      ephemeral: true,
    });
    return true;
  }

  // Cancel Signup
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("cancel_dungeon_")
  ) {
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split("_");
    const uniqueKey = parts[2];
    const userId = parts[3];
    const offer = tradeOffers.get(uniqueKey);

    if (!offer) {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    if (userId !== interaction.user.id) {
      await interaction.editReply({
        content: "You can only cancel your own signup!",
        ephemeral: true,
      });
      return true;
    }

    const isApplicant =
      offer.pendingApplicants.some((app) => app.userId === userId) ||
      offer.groupData.tank === userId ||
      offer.groupData.healer === userId ||
      offer.groupData.dps.includes(userId);

    if (!isApplicant) {
      await interaction.editReply({
        content: "You are not part of this offer!",
        ephemeral: true,
      });
      return true;
    }

    let applicantData = offer.pendingApplicants.find(
      (app) => app.userId === userId,
    );
    if (!applicantData) {
      const charData = db
        .prepare(
          "SELECT characterName, class, mythicRating FROM characters WHERE userId = ?",
        )
        .get(userId);
      applicantData = {
        characterName: charData?.characterName || "Unknown",
        class: charData?.class || "Unknown",
        mythicRating: charData?.mythicRating || 0,
        role:
          offer.groupData.tank === userId
            ? "Tank"
            : offer.groupData.healer === userId
              ? "Healer"
              : "DPS",
        hasKey:
          offer.groupData.tank === userId
            ? offer.groupData.tankHasKey
            : offer.groupData.healer === userId
              ? offer.groupData.healerHasKey
              : offer.groupData.dps.includes(userId)
                ? offer.groupData.dpsHasKeys[
                    offer.groupData.dps.indexOf(userId)
                  ]
                : "No Key",
      };
    }

    if (offer.groupData.tank === userId) {
      offer.groupData.tank = null;
      offer.groupData.tankRating = null;
      offer.groupData.tankHasKey = null;
    }
    if (offer.groupData.healer === userId) {
      offer.groupData.healer = null;
      offer.groupData.healerRating = null;
      offer.groupData.healerHasKey = null;
    }
    if (offer.groupData.dps.includes(userId)) {
      const index = offer.groupData.dps.indexOf(userId);
      offer.groupData.dps.splice(index, 1);
      offer.groupData.dpsRatings.splice(index, 1);
      offer.groupData.dpsHasKeys.splice(index, 1);
    }

    offer.pendingApplicants = offer.pendingApplicants.filter(
      (app) => app.userId !== userId,
    );

    if (offer.threadId) {
      const thread = await client.channels
        .fetch(offer.threadId)
        .catch(() => null);
      if (thread) await thread.members.remove(userId).catch(() => null);
    }

    offer.claimed = false; // Ensure offer is reopened if someone cancels
    await updateDungeonEmbed(client, offer, webhook, uniqueKey);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    const keystoneLevelDisplay =
      offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
    await interaction.editReply({
      content: `You have cancelled your signup for ${offer.dungeon} ${keystoneLevelDisplay}!`,
      ephemeral: true,
    });

    const offerUser = await client.users.fetch(offer.user.id).catch(() => null);
    if (offerUser) {
      await offerUser.send(
        `<@${userId}> (${applicantData.characterName} ${applicantData.class} ${applicantData.mythicRating} ${applicantData.hasKey === "Have Key" ? "✅" : "❌"}) has cancelled their signup for your ${offer.dungeon} ${keystoneLevelDisplay} offer as ${applicantData.role}.`,
      );
    }
    return true;
  }

  // Kick Member
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("kick_dungeon_")
  ) {
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split("_");
    const uniqueKey = parts[2];
    const memberId = parts[3];
    const role = parts[4];
    const dpsIndex = parts[5] ? parseInt(parts[5]) : null;
    const offer = tradeOffers.get(uniqueKey);

    if (!offer) {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    if (offer.user.id !== interaction.user.id) {
      await interaction.editReply({
        content: "Only the offer owner can kick members!",
        ephemeral: true,
      });
      return true;
    }

    const charData = db
      .prepare(
        "SELECT characterName, class, mythicRating FROM characters WHERE userId = ?",
      )
      .get(memberId);
    const applicantData = {
      characterName: charData?.characterName || "Unknown",
      class: charData?.class || "Unknown",
      mythicRating: charData?.mythicRating || 0,
      role,
      hasKey:
        role === "Tank"
          ? offer.groupData.tankHasKey
          : role === "Healer"
            ? offer.groupData.healerHasKey
            : role === "DPS"
              ? offer.groupData.dpsHasKeys[dpsIndex]
              : "No Key",
    };

    if (role === "Tank") {
      offer.groupData.tank = null;
      offer.groupData.tankRating = null;
      offer.groupData.tankHasKey = null;
    } else if (role === "Healer") {
      offer.groupData.healer = null;
      offer.groupData.healerRating = null;
      offer.groupData.healerHasKey = null;
    } else if (role === "DPS" && dpsIndex !== null) {
      offer.groupData.dps.splice(dpsIndex, 1);
      offer.groupData.dpsRatings.splice(dpsIndex, 1);
      offer.groupData.dpsHasKeys.splice(dpsIndex, 1);
    }

    offer.claimed = false;

    if (offer.threadId) {
      const thread = await client.channels
        .fetch(offer.threadId)
        .catch(() => null);
      if (thread) await thread.members.remove(memberId).catch(() => null);
    }

    await updateDungeonEmbed(client, offer, webhook, uniqueKey);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    const keystoneLevelDisplay =
      offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
    await interaction.editReply({
      content: `Kicked <@${memberId}> (${applicantData.characterName} ${applicantData.class} ${applicantData.mythicRating} ${applicantData.hasKey === "Have Key" ? "✅" : "❌"}) from the group!`,
      ephemeral: true,
    });

    const kickedUser = await client.users.fetch(memberId).catch(() => null);
    if (kickedUser) {
      await kickedUser.send(
        `You have been kicked from the ${offer.dungeon} ${keystoneLevelDisplay} group by <@${offer.user.id}> as ${role} (${applicantData.characterName} ${applicantData.class} ${applicantData.mythicRating} ${applicantData.hasKey === "Have Key" ? "✅" : "❌"}).`,
      );
    }
    return true;
  }

  // Reopen Offer
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("reopen_dungeon_")
  ) {
    await interaction.deferReply({ ephemeral: true });
    const uniqueKey = interaction.customId.split("_")[2];
    const offer = tradeOffers.get(uniqueKey);

    if (!offer) {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    if (offer.user.id !== interaction.user.id) {
      await interaction.editReply({
        content: "Only the offer owner can reopen the group!",
        ephemeral: true,
      });
      return true;
    }

    offer.claimed = false;

    // Recreate thread if it was deleted
    if (!offer.threadId) {
      const channel = await client.channels.fetch(
        config.DUNGEON_OFFERS_CHANNEL_ID,
      );
      const keystoneLevelDisplay =
        offer.keystoneLevel === "0" ? "0" : `+${offer.keystoneLevel}`;
      const thread = await channel.threads.create({
        name: `${offer.dungeon} ${keystoneLevelDisplay} - ${client.user.username}`,
        autoArchiveDuration: 10080,
        type: ChannelType.PrivateThread,
      });
      await thread.members.add(offer.user.id);
      await thread.send(
        `Thread recreated for ${offer.dungeon} ${keystoneLevelDisplay}. Use this to coordinate with your group!`,
      );
      offer.threadId = thread.id;
    }

    await updateDungeonEmbed(client, offer, webhook, uniqueKey);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    await interaction.editReply({
      content: "Offer reopened! Players can now sign up again.",
      ephemeral: true,
    });
    return true;
  }

  // GG, Key Done
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("gg_key_done_")
  ) {
    await interaction.deferReply({ ephemeral: true });
    const uniqueKey = interaction.customId.split("_")[3];
    const offer = tradeOffers.get(uniqueKey);

    if (!offer || offer.type !== "dungeon") {
      await interaction.editReply({
        content: "This offer is no longer available!",
        ephemeral: true,
      });
      return true;
    }

    if (
      interaction.user.id !== BOT_OWNER_ID &&
      interaction.user.id !== offer.user.id
    ) {
      await interaction.editReply({
        content: "Only the bot owner or offer owner can mark the key as done!",
        ephemeral: true,
      });
      return true;
    }

    offer.claimed = true;
    await updateDungeonEmbed(client, offer, webhook, uniqueKey);
    tradeOffers.set(uniqueKey, offer);
    saveDungeonOffer(offer, uniqueKey);

    await interaction.editReply({
      content: "Key marked as done! You can reopen the offer if needed.",
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = {
  initializeDungeonTicket,
  handleDungeonInteraction,
  loadDungeonOffers,
};
