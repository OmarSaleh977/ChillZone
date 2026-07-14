const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { db } = require('../database');

async function handleAccountInteraction(interaction, client, webhook, config) {
  if (interaction.customId === 'account_button') {
    const submissionKey = `${interaction.user.id}-${Date.now()}`;
    const operationSelect = new StringSelectMenuBuilder()
      .setCustomId(`operation_select_account_${submissionKey}`)
      .setPlaceholder('Select Operation')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('WTS (Sell)')
          .setValue('WTS')
          .setEmoji('🙋‍♂️'),
        new StringSelectMenuOptionBuilder()
          .setLabel('WTB (Buy)')
          .setValue('WTB')
          .setEmoji('💸')
      );

    const row = new ActionRowBuilder().addComponents(operationSelect);
    await interaction.reply({
      content: 'Select Operation:',
      components: [row],
      ephemeral: true,
    });

    return true;
  }

  if (interaction.customId.startsWith('operation_select_account_')) {
    const parts = interaction.customId.split('_');
    const submissionKey = parts[3];
    const operation = interaction.values[0];
    const paymentMethodSelect = new StringSelectMenuBuilder()
      .setCustomId(`payment_select_account_${submissionKey}_${operation}`)
      .setPlaceholder('Select Payment Method')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Vodafone Cash')
          .setValue('Vodafone')
          .setEmoji('💸'),
        new StringSelectMenuOptionBuilder()
          .setLabel('USDT')
          .setValue('USDT')
          .setEmoji('🟡')
      );

    const row = new ActionRowBuilder().addComponents(paymentMethodSelect);
    await interaction.update({
      content: 'Select Payment Method:',
      components: [row],
      ephemeral: true,
    });

    return true;
  }

  if (interaction.customId.startsWith('payment_select_account_')) {
    const parts = interaction.customId.split('_');
    const submissionKey = parts[3];
    const operation = parts[4];
    const paymentMethod = interaction.values[0];
    const modal = new ModalBuilder()
      .setCustomId(`trade_modal_account_${submissionKey}_${operation}_${paymentMethod}`)
      .setTitle('Account Trade Offer');

    const priceInput = new TextInputBuilder()
      .setCustomId('price')
      .setLabel('Price')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const accountInfoInput = new TextInputBuilder()
      .setCustomId('accountInfo')
      .setLabel('Account Info')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(priceInput);
    const secondActionRow = new ActionRowBuilder().addComponents(accountInfoInput);

    modal.addComponents(firstActionRow, secondActionRow);

    await interaction.showModal(modal);
    return true;
  }

  if (interaction.customId.startsWith('trade_modal_account_')) {
    const parts = interaction.customId.split('_');
    const submissionKey = parts[3];
    const operation = parts[4];
    const paymentMethod = parts[5];
    const price = interaction.fields.getTextInputValue('price')?.trim();
    const accountInfo = interaction.fields.getTextInputValue('accountInfo')?.trim();

    if (!price || isNaN(price)) {
      await interaction.reply({
        content: 'Invalid price! Please enter a valid number.',
        ephemeral: true,
      });
      return true;
    }

    if (!accountInfo) {
      await interaction.reply({
        content: 'Account Info is required!',
        ephemeral: true,
      });
      return true;
    }

    const uniqueKey = `${interaction.user.id}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const paymentEmoji = paymentMethod === 'Vodafone' ? '💸' : '🟡';
    const operationEmoji = operation === 'WTS' ? '🙋‍♂️' : '💸';

    const tradeEmbed = new EmbedBuilder()
      .setColor('#800080')
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setTitle(`Account Offer: ${operation} ${operationEmoji}`)
      .addFields(
        { name: 'Publisher', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Payment Method', value: `${paymentEmoji} ${paymentMethod === 'Vodafone' ? 'Vodafone Cash' : 'USDT'}`, inline: true },
        { name: 'Price', value: price || 'N/A', inline: true },
        { name: 'Account Info', value: accountInfo || 'N/A', inline: false },
        { name: 'Status', value: 'Available', inline: false },
      );

    const claimButton = new ButtonBuilder()
      .setCustomId(`claim_${uniqueKey}`)
      .setLabel('Claim Offer')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');

    const row = new ActionRowBuilder().addComponents(claimButton);

    const tradeChannel = await client.channels.fetch(config.ACCOUNT_CHANNEL_ID);
    const displayName = await getUserDisplayName(client, interaction.member); // استخدام interaction.member بدل interaction.user

    const tradeMessage = await webhook.send({
      embeds: [tradeEmbed],
      components: [row],
      username: capitalizeFirstLetter(displayName),
      avatarURL: interaction.user.displayAvatarURL({ dynamic: true, size: 256 }),
    });

    // تحويل الـ Embed لـ JSON لحفظه في الداتابيز
    const embedJson = JSON.stringify(tradeEmbed.toJSON());

    db.prepare(`
      INSERT INTO account_offers (uniqueKey, type, userId, userTag, operation, quantity, price, paymentMethod, messageId, channelId, claimed, claimedBy, completed, createdAt, embed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uniqueKey,
      'account',
      interaction.user.id,
      displayName,
      operation,
      null,
      price,
      paymentMethod === 'Vodafone' ? 'Vodafone Cash' : 'USDT',
      tradeMessage.id,
      config.ACCOUNT_CHANNEL_ID,
      0,
      null,
      0,
      new Date().toISOString(),
      embedJson
    );

    await interaction.reply({
      content: `${operation} account offer submitted successfully in <#${config.ACCOUNT_CHANNEL_ID}>! 🎉`,
      ephemeral: true,
    });

    return true;
  }

  // معالجة زرار "Claim"
  if (interaction.customId.startsWith('claim_')) {
    const uniqueKey = interaction.customId.replace('claim_', '');
    const offer = db.prepare('SELECT * FROM account_offers WHERE uniqueKey = ?').get(uniqueKey);

    if (!offer) {
      await interaction.reply({
        content: 'Offer not found!',
        ephemeral: true,
      });
      return true;
    }

    if (offer.claimed) {
      await interaction.reply({
        content: 'This offer is already claimed!',
        ephemeral: true,
      });
      return true;
    }

    // تحديث حالة العرض في الداتابيز
    db.prepare('UPDATE account_offers SET claimed = 1, claimedBy = ? WHERE uniqueKey = ?')
      .run(interaction.user.id, uniqueKey);

    // استرجاع الـ Embed الأصلي وحل المشكلة بتاعة تعديل الرسالة
    const embedData = JSON.parse(offer.embed);
    const updatedEmbed = new EmbedBuilder(embedData)
      .setFields(
        { name: 'Publisher', value: `<@${offer.userId}>`, inline: true },
        { name: 'Payment Method', value: `${offer.paymentMethod === 'Vodafone Cash' ? '💸' : '🟡'} ${offer.paymentMethod}`, inline: true },
        { name: 'Price', value: offer.price || 'N/A', inline: true },
        { name: 'Account Info', value: offer.accountInfo || 'N/A', inline: false },
        { name: 'Status', value: `Claimed by <@${interaction.user.id}>`, inline: false },
      );

    await webhook.editMessage(offer.messageId, {
      embeds: [updatedEmbed],
      components: [],
    }).catch(err => console.error('Error editing message:', err));

    await interaction.reply({
      content: 'You have claimed this offer! Contact the publisher to proceed.',
      ephemeral: true,
    });

    return true;
  }

  return false;
}

async function getUserDisplayName(client, member) {
  if (!member) return 'Unknown User';
  const guildMember = await member.fetch(); // جلب بيانات العضو من السيرفر
  return guildMember.displayName || member.user.tag; // استخدام displayName إذا موجود، لو لا يستخدم user.tag
}

function capitalizeFirstLetter(string) {
  if (!string) return '';
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

module.exports = { handleAccountInteraction };