const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, ButtonStyle, TextInputStyle } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');

async function getUserDisplayName(client, userId, guildId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    const displayName = member.displayName || (await client.users.fetch(userId)).username;
    return displayName.charAt(0).toUpperCase() + displayName.slice(1);
  } catch (error) {
    console.error(`Error fetching user ${userId}:`, error.message);
    return 'Unknown User';
  }
}

function saveLevelingOffer(offer, uniqueKey) {
  try {
    console.log(`Saving leveling offer with uniqueKey: ${uniqueKey}`);
    db.prepare(`
      INSERT OR REPLACE INTO leveling_offers (
        uniqueKey, userId, levelRange, price, faction, messageId, channelId, threadId, claimed, claimedBy, completed, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uniqueKey,
      offer.userId,
      offer.levelRange,
      offer.price,
      offer.faction,
      offer.messageId,
      offer.channelId,
      offer.threadId || null,
      offer.claimed ? 1 : 0,
      offer.claimedBy,
      offer.completed ? 1 : 0,
      new Date().toISOString()
    );
    console.log(`Saved leveling offer ${uniqueKey} for user ${offer.userId}`);
  } catch (error) {
    console.error(`Error saving leveling offer ${uniqueKey}:`, error.message);
    throw error;
  }
}

function loadLevelingOffers() {
  const offers = db.prepare('SELECT * FROM leveling_offers WHERE completed = 0').all();
  console.log(`Loaded ${offers.length} active leveling offers`);
  return offers.map(offer => ({
    uniqueKey: offer.uniqueKey,
    userId: offer.userId,
    levelRange: offer.levelRange,
    price: offer.price,
    faction: offer.faction,
    messageId: offer.messageId,
    channelId: offer.channelId,
    threadId: offer.threadId,
    claimed: offer.claimed === 1,
    claimedBy: offer.claimedBy,
    completed: offer.completed === 1,
  }));
}

async function initializeLevelingTicket(client, config) {
  // Handled by index.js
}

async function reloadLevelingOffers(client, webhook, config) {
  const offers = loadLevelingOffers();
  if (offers.length === 0) {
    console.log('No active leveling offers to restore');
    return;
  }
  for (const offer of offers) {
    try {
      const channel = await client.channels.fetch(offer.channelId);
      if (!webhook) {
        console.error(`Webhook not available for leveling offer ${offer.uniqueKey}`);
        continue;
      }

      const factionEmoji = offer.faction === 'Horde' ? '🐺' : '🦁';
      const goldEmoji = '🪙';
      const displayName = await getUserDisplayName(client, offer.userId, channel.guildId);
      const avatarURL = client.users.cache.get(offer.userId)?.displayAvatarURL({ dynamic: true, size: 256 }) || 'https://i.imgur.com/0Cnzr9Z.gif';

      let tradeEmbed = new EmbedBuilder()
        .setColor('#800080')
        .setTitle(`${factionEmoji} ${offer.faction || 'N/A'} Leveling Service ${offer.claimed ? 'Claimed' : 'Available'}`)
        .setThumbnail(avatarURL)
        .addFields(
          { name: 'Level Range', value: offer.levelRange || 'N/A', inline: true },
          { name: 'Offered Cuts', value: `${goldEmoji} ${offer.price || 'N/A'}`, inline: true },
          { name: 'Faction', value: `${factionEmoji} ${offer.faction || 'N/A'}`, inline: true },
          { name: 'Status', value: offer.claimed ? `Claimed by <@${offer.claimedBy}>` : 'Looking for a player', inline: false }
        );

      const applyButton = new ButtonBuilder()
        .setCustomId(`apply_leveling_${offer.uniqueKey}`)
        .setLabel('Apply')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🤝')
        .setDisabled(offer.claimed);

      const completeButton = new ButtonBuilder()
        .setCustomId(`complete_leveling_${offer.uniqueKey}`)
        .setLabel('Completed')
        .setStyle(offer.claimed ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setEmoji('✅')
        .setDisabled(!offer.claimed);

      const row = new ActionRowBuilder().addComponents(applyButton, completeButton);

      await webhook.editMessage(offer.messageId, {
        embeds: [tradeEmbed],
        components: [row],
        username: displayName,
        avatarURL: avatarURL,
      });
      console.log(`Restored leveling offer ${offer.uniqueKey}`);
    } catch (error) {
      console.error(`Error restoring leveling offer ${offer.uniqueKey}:`, error.message);
    }
  }
}

async function handleLevelingInteraction(interaction, client, webhook, config) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return false;

  console.log(`Raw customId: ${interaction.customId}`);

  if (interaction.customId === 'leveling_button') {
    const submissionKey = `${interaction.user.id}-${Date.now()}`;
    const factionSelect = new StringSelectMenuBuilder()
      .setCustomId(`faction_select_leveling_${submissionKey}`)
      .setPlaceholder('Select Faction')
      .addOptions(
        { label: 'Horde', value: 'Horde', emoji: '🐺' },
        { label: 'Alliance', value: 'Alliance', emoji: '🦁' },
      );

    const row = new ActionRowBuilder().addComponents(factionSelect);
    await interaction.reply({ content: 'اختار الفصيل لخدمة الليفلينج:', components: [row], ephemeral: true });
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('faction_select_leveling_')) {
    const submissionKey = interaction.customId.split('_')[3];
    const faction = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`leveling_modal_${submissionKey}_${faction}`)
      .setTitle(`${faction} Leveling Offer`);

    const levelRangeInput = new TextInputBuilder()
      .setCustomId('level_range')
      .setLabel('Level Range (e.g., 1-70)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const priceInput = new TextInputBuilder()
      .setCustomId('price')
      .setLabel('Price (e.g., 50 USDT or 20k Gold)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const levelRangeRow = new ActionRowBuilder().addComponents(levelRangeInput);
    const priceRow = new ActionRowBuilder().addComponents(priceInput);

    modal.addComponents(levelRangeRow, priceRow);
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('leveling_modal_')) {
    const parts = interaction.customId.split('_');
    const submissionKey = parts[2];
    const faction = parts[3];

    const levelRange = interaction.fields.getTextInputValue('level_range')?.trim();
    const price = interaction.fields.getTextInputValue('price')?.trim();

    if (!levelRange || !price) {
      await interaction.reply({ content: 'كل الحقول مطلوبة!', ephemeral: true });
      return true;
    }

    const factionEmoji = faction === 'Horde' ? '🐺' : '🦁';
    const goldEmoji = '🪙';
    const displayName = await getUserDisplayName(client, interaction.user.id, interaction.guildId);
    const avatarURL = interaction.user.displayAvatarURL({ dynamic: true, size: 256 }) || 'https://i.imgur.com/0Cnzr9Z.gif';

    let tradeEmbed = new EmbedBuilder()
      .setColor('#800080')
      .setTitle(`${factionEmoji} ${faction || 'N/A'} Leveling Service Available`)
      .setThumbnail(avatarURL)
      .addFields(
        { name: 'Level Range', value: levelRange || 'N/A', inline: true },
        { name: 'Offered Cuts', value: `${goldEmoji} ${price || 'N/A'}`, inline: true },
        { name: 'Faction', value: `${factionEmoji} ${faction || 'N/A'}`, inline: true },
        { name: 'tiler', value: 'Looking for a player', inline: false }
      );

    try {
      const tradeChannel = await client.channels.fetch(config.LEVELING_CHANNEL_ID);
      if (!tradeChannel) {
        await interaction.reply({ content: 'قناة الليفلينج مش موجودة!', ephemeral: true });
        return true;
      }

      if (!webhook) {
        await interaction.reply({ content: 'الويبهوك مش مظبوط!', ephemeral: true });
        return true;
      }

      const uniqueKey = uuidv4();
      console.log(`Generated uniqueKey for leveling offer: ${uniqueKey}`);
      const applyButton = new ButtonBuilder()
        .setCustomId(`apply_leveling_${uniqueKey}`)
        .setLabel('Apply')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🤝');

      const completeButton = new ButtonBuilder()
        .setCustomId(`complete_leveling_${uniqueKey}`)
        .setLabel('Completed')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✅')
        .setDisabled(true);

      const row = new ActionRowBuilder().addComponents(applyButton, completeButton);

      console.log(`Attempting to send leveling offer ${uniqueKey} to channel ${config.LEVELING_CHANNEL_ID}`);
      const tradeMessage = await webhook.send({
        embeds: [tradeEmbed],
        components: [row],
        username: displayName,
        avatarURL: avatarURL,
      });

      const offer = {
        userId: interaction.user.id,
        levelRange,
        price,
        faction,
        messageId: tradeMessage.id,
        channelId: config.LEVELING_CHANNEL_ID,
        threadId: null,
        claimed: false,
        claimedBy: null,
        completed: false,
      };
      saveLevelingOffer(offer, uniqueKey);

      await interaction.reply({
        content: `عرض الليفلينج لـ ${faction || 'N/A'} اتبعت بنجاح في <#${config.LEVELING_CHANNEL_ID}>! 🎉`,
        ephemeral: true,
      });
      console.log(`Leveling offer ${uniqueKey} submitted successfully`);
    } catch (error) {
      console.error(`Error submitting leveling offer for ${submissionKey}:`, error.message);
      await interaction.reply({ content: 'فشل إرسال عرض الليفلينج! حاول تاني.', ephemeral: true });
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('apply_leveling_')) {
    const uniqueKey = interaction.customId.replace('apply_leveling_', '');
    console.log(`Fetching leveling offer with uniqueKey: ${uniqueKey}`);
    const offer = db.prepare('SELECT * FROM leveling_offers WHERE uniqueKey = ?').get(uniqueKey);

    if (!offer) {
      console.log(`Leveling offer ${uniqueKey} not found in database`);
      await interaction.reply({ content: 'العرض ده مش موجود!', ephemeral: true });
      return true;
    }

    if (offer.claimed) {
      await interaction.reply({ content: 'العرض ده اتقفل بالفعل!', ephemeral: true });
      return true;
    }

    if (offer.userId === interaction.user.id) {
      await interaction.reply({ content: 'ما تقدرش تقفل عرضك بنفسك!', ephemeral: true });
      return true;
    }

    try {
      const tradeChannel = await client.channels.fetch(config.LEVELING_CHANNEL_ID);
      const threadName = `Leveling Offer - ${offer.levelRange} (${offer.faction})`;
      const thread = await tradeChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: 12,
        invitable: false,
      });

      await thread.members.add(offer.userId);
      await thread.members.add(interaction.user.id);

      await thread.send({
        content: `<@${offer.userId}> و <@${interaction.user.id}>، ده ثريد خاص لمناقشة عرض الليفلينج لـ ${offer.levelRange} (${offer.faction}). اتفضلوا نسقوا هنا. الثريد هيتمسح لما العرض يتقفل. 🎉`,
      });

      db.prepare('UPDATE leveling_offers SET claimed = 1, claimedBy = ?, threadId = ? WHERE uniqueKey = ?').run(
        interaction.user.id,
        thread.id,
        uniqueKey
      );

      db.prepare('INSERT OR REPLACE INTO ticket_threads (threadId, channelId, messageId, creatorId, offerUniqueKey, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        thread.id,
        config.LEVELING_CHANNEL_ID,
        offer.messageId,
        interaction.user.id,
        uniqueKey,
        new Date().toISOString()
      );

      const factionEmoji = offer.faction === 'Horde' ? '🐺' : '🦁';
      const goldEmoji = '🪙';
      const displayName = await getUserDisplayName(client, offer.userId, interaction.guildId);
      const avatarURL = client.users.cache.get(offer.userId)?.displayAvatarURL({ dynamic: true, size: 256 }) || 'https://i.imgur.com/0Cnzr9Z.gif';

      let tradeEmbed = new EmbedBuilder()
        .setColor('#800080')
        .setTitle(`${factionEmoji} ${offer.faction || 'N/A'} Leveling Service Claimed! 🎉`)
        .setThumbnail(avatarURL)
        .addFields(
          { name: 'Level Range', value: offer.levelRange || 'N/A', inline: true },
          { name: 'Offered Cuts', value: `${goldEmoji} ${offer.price || 'N/A'}`, inline: true },
          { name: 'Faction', value: `${factionEmoji} ${offer.faction || 'N/A'}`, inline: true },
          { name: 'Status', value: `Claimed by <@${interaction.user.id}>`, inline: false }
        );

      const applyButton = new ButtonBuilder()
        .setCustomId(`apply_leveling_${uniqueKey}`)
        .setLabel('Apply')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🤝')
        .setDisabled(true);

      const completeButton = new ButtonBuilder()
        .setCustomId(`complete_leveling_${uniqueKey}`)
        .setLabel('Completed')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
        .setDisabled(false);

      const row = new ActionRowBuilder().addComponents(applyButton, completeButton);

      await webhook.editMessage(offer.messageId, {
        embeds: [tradeEmbed],
        components: [row],
        username: displayName,
        avatarURL: avatarURL,
      });

      await interaction.reply({
        content: `قفلت عرض الليفلينج بنجاح! 🎉 ثريد خاص اتبعت: ${thread}. نسق مع <@${offer.userId}> هناك.`,
        ephemeral: true,
      });

      const offerUser = client.users.cache.get(offer.userId);
      if (offerUser) {
        await offerUser.send(`عرض الليفلينج ${offer.faction || 'N/A'} اتقفل بواسطة <@${interaction.user.id}>! ثريد خاص اتبعت: ${thread}. نسق هناك.`);
      }
    } catch (error) {
      console.error(`Error claiming leveling offer ${uniqueKey}:`, error.message);
      await interaction.reply({ content: 'فشل قفل العرض أو إنشاء الثريد!', ephemeral: true });
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('complete_leveling_')) {
    const uniqueKey = interaction.customId.replace('complete_leveling_', '');
    console.log(`Completing leveling offer with uniqueKey: ${uniqueKey}`);
    const offer = db.prepare('SELECT * FROM leveling_offers WHERE uniqueKey = ?').get(uniqueKey);

    if (!offer) {
      console.log(`Leveling offer ${uniqueKey} not found in database`);
      await interaction.reply({ content: 'العرض ده مش موجود!', ephemeral: true });
      return true;
    }

    if (offer.userId !== interaction.user.id) {
      await interaction.reply({ content: 'بس صاحب العرض يقدر يقفل العرض!', ephemeral: true });
      return true;
    }

    try {
      db.prepare('UPDATE leveling_offers SET completed = 1 WHERE uniqueKey = ?').run(uniqueKey);

      // Delete all threads
      const ticketThreads = db.prepare('SELECT * FROM ticket_threads').all();
      let deletedCount = 0;
      let failedCount = 0;

      for (const ticket of ticketThreads) {
        try {
          const thread = await client.channels.fetch(ticket.threadId);
          if (thread && thread.isThread()) {
            await thread.delete('All threads completed');
            console.log(`Deleted thread ${ticket.threadId}`);
            deletedCount++;
          }
        } catch (error) {
          console.error(`Error deleting thread ${ticket.threadId}: ${error.message}`);
          failedCount++;
        }
      }

      db.prepare('DELETE FROM ticket_threads').run();

      const factionEmoji = offer.faction === 'Horde' ? '🐺' : '🦁';
      const goldEmoji = '🪙';
      const displayName = await getUserDisplayName(client, offer.userId, interaction.guildId);
      const avatarURL = client.users.cache.get(offer.userId)?.displayAvatarURL({ dynamic: true, size: 256 }) || 'https://i.imgur.com/0Cnzr9Z.gif';

      let completedEmbed = new EmbedBuilder()
        .setColor('#800080')
        .setTitle(`${factionEmoji} ${offer.faction || 'N/A'} Leveling Service Completed! ✅`)
        .setThumbnail(avatarURL)
        .addFields(
          { name: 'Level Range', value: offer.levelRange || 'N/A', inline: true },
          { name: 'Offered Cuts', value: `${goldEmoji} ${offer.price || 'N/A'}`, inline: true },
          { name: 'Faction', value: `${factionEmoji} ${offer.faction || 'N/A'}`, inline: true },
          { name: 'Status', value: offer.claimedBy ? `Completed by <@${offer.claimedBy}>` : 'Completed', inline: false }
        );

      await webhook.editMessage(offer.messageId, {
        embeds: [completedEmbed],
        components: [],
        username: displayName,
        avatarURL: avatarURL,
      });

      await interaction.reply({
        content: `عرض الليفلينج اتقفل بنجاح، وتم مسح ${deletedCount} ثريد (${failedCount} فشلوا)! ✅`,
        ephemeral: true,
      });

      const acceptedUser = client.users.cache.get(offer.claimedBy);
      if (acceptedUser) {
        await acceptedUser.send(`عرض الليفلينج من <@${offer.userId}> اتقفل، وكل الثريدز اتمسحت.`);
      }
    } catch (error) {
      console.error(`Error marking leveling offer ${uniqueKey} as completed:`, error.message);
      await interaction.reply({ content: 'فشل قفل العرض أو مسح الثريدز!', ephemeral: true });
    }
    return true;
  }

  return false;
}

module.exports = { initializeLevelingTicket, reloadLevelingOffers, handleLevelingInteraction };