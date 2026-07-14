const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  ButtonStyle,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../database");
const { fetchGoldPrice } = require("./gold_price");

function initGoldDatabase() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS gold_offers (
      uniqueKey TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      operation TEXT NOT NULL,
      goldAmount TEXT NOT NULL,
      remainingAmount TEXT NOT NULL,
      price TEXT NOT NULL,
      paymentMethod TEXT NOT NULL,
      characterName TEXT NOT NULL,
      messageId TEXT NOT NULL,
      channelId TEXT NOT NULL,
      threadId TEXT,
      claimed INTEGER DEFAULT 0,
      applicants TEXT DEFAULT '[]',
      completed INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    )
  `,
  ).run();
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS ticket_threads (
      threadId TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      creatorId TEXT NOT NULL,
      offerUniqueKey TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `,
  ).run();
  console.log("Gold database tables initialized");
}

async function getUserDisplayName(client, userId, guildId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    const displayName =
      member.displayName || (await client.users.fetch(userId)).username;
    return displayName.charAt(0).toUpperCase() + displayName.slice(1);
  } catch (error) {
    console.error(`Error fetching user ${userId}:`, error.message);
    return "Unknown User";
  }
}

function parseQuantity(qty) {
  if (!qty || typeof qty !== "string") return 0;
  const cleanQty = qty
    .replace(/[^0-9.k]/gi, "")
    .trim()
    .toLowerCase();
  let num = parseFloat(cleanQty.replace("k", "")) || 0;
  if (cleanQty.includes("k")) num *= 1000;
  if (num < 100) return 0;
  return Math.round(num);
}

function formatQuantity(qty) {
  const numQty = parseQuantity(qty);
  return numQty.toString();
}

function cleanQuantity(qty) {
  return parseQuantity(qty).toString();
}

function calculateGoldAmount(inputQty) {
  return parseQuantity(inputQty);
}

function saveGoldOffer(offer, uniqueKey) {
  try {
    console.log(`Saving gold offer with uniqueKey: ${uniqueKey}`, offer);
    db.prepare(
      `
      INSERT OR REPLACE INTO gold_offers (
        uniqueKey, userId, operation, goldAmount, remainingAmount, price, paymentMethod, characterName, messageId, channelId, threadId, claimed, applicants, completed, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      uniqueKey,
      offer.userId,
      offer.operation || "N/A",
      offer.goldAmount || "N/A",
      offer.remainingAmount || offer.goldAmount || "N/A",
      offer.price || "N/A",
      offer.paymentMethod || "N/A",
      offer.characterName || "N/A",
      offer.messageId,
      offer.channelId,
      offer.threadId || null,
      offer.claimed ? 1 : 0,
      JSON.stringify(offer.applicants || []),
      offer.completed ? 1 : 0,
      offer.createdAt || new Date().toISOString(),
    );
    console.log(`Saved gold offer ${uniqueKey} for user ${offer.userId}`);
  } catch (error) {
    console.error(`Error saving gold offer ${uniqueKey}:`, error.message);
    throw error;
  }
}

function loadGoldOffers() {
  try {
    const offers = db
      .prepare("SELECT * FROM gold_offers WHERE completed = 0")
      .all();
    console.log(`Loaded ${offers.length || 0} active gold offers`);
    return offers.map((offer) => ({
      uniqueKey: offer.uniqueKey,
      userId: offer.userId,
      operation: offer.operation,
      goldAmount: offer.goldAmount,
      remainingAmount: offer.remainingAmount,
      price: offer.price,
      paymentMethod: offer.paymentMethod,
      characterName: offer.characterName,
      messageId: offer.messageId,
      channelId: offer.channelId,
      threadId: offer.threadId,
      claimed: offer.claimed === 1,
      applicants: offer.applicants ? JSON.parse(offer.applicants) : [],
      completed: offer.completed === 1,
      createdAt: offer.createdAt,
    }));
  } catch (error) {
    console.error("Error loading gold offers:", error.message);
    return [];
  }
}

async function reloadGoldOffers(client, webhook, config) {
  initGoldDatabase();
  const offers = loadGoldOffers();
  if (offers.length === 0) {
    console.log("No active gold offers to restore");
    return;
  }
  for (const offer of offers) {
    try {
      console.log(`Restoring gold offer ${offer.uniqueKey}`, offer);
      const channel = await client.channels
        .fetch(offer.channelId)
        .catch(() => null);
      if (!channel) {
        console.error(
          `Channel ${offer.channelId} not available for gold offer ${offer.uniqueKey}`,
        );
        db.prepare("DELETE FROM gold_offers WHERE uniqueKey = ?").run(
          offer.uniqueKey,
        );
        continue;
      }
      const displayName = await getUserDisplayName(
        client,
        offer.userId,
        channel.guildId,
      );
      const avatarURL =
        client.users.cache
          .get(offer.userId)
          ?.displayAvatarURL({ dynamic: true, size: 256 }) ||
        "https://i.imgur.com/0Cnzr9Z.gif";
      let applicantsText = "None";
      if (offer.applicants && typeof offer.applicants === "string") {
        offer.applicants = JSON.parse(offer.applicants);
      }
      if (Array.isArray(offer.applicants) && offer.applicants.length > 0) {
        applicantsText = offer.applicants
          .map(
            (app) =>
              `${app.operation === "WTB" ? "WTB 💸" : "WTS 🙋"} <@${app.userId}> ${formatQuantity(app.amount)}`,
          )
          .join("\n");
      }
      let tradeEmbed = new EmbedBuilder()
        .setColor("#800080")
        .setDescription(
          `**By:** <@${offer.userId}> ${offer.paymentMethod.toLowerCase().includes("vodafone") ? "💸 Vodafone Cash" : offer.paymentMethod || "N/A"} | ${offer.price || "N/A"} | 🪙 Quantity | ${formatQuantity(offer.goldAmount)}\n` +
            `**Applicants:** ${applicantsText}\n` +
            `**Remaining Quantity:** ${formatQuantity(offer.remainingAmount)}\n`,
        );
      const applyButton = new ButtonBuilder()
        .setCustomId(`apply_gold_${offer.uniqueKey}`)
        .setLabel("Apply for Offer")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅")
        .setDisabled(
          offer.completed ||
            parseFloat(parseQuantity(offer.remainingAmount || "0")) <= 0,
        );
      const editButton = new ButtonBuilder()
        .setCustomId(`edit_gold_${offer.uniqueKey}`)
        .setLabel("✏️ Edit")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false);
      const deleteButton = new ButtonBuilder()
        .setCustomId(`delete_gold_${offer.uniqueKey}`)
        .setLabel("🗑️ Delete")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(false);
      const row = new ActionRowBuilder().addComponents(
        applyButton,
        editButton,
        deleteButton,
      );
      if (offer.messageId) {
        try {
          await webhook.editMessage(offer.messageId, {
            embeds: [tradeEmbed],
            components: [row],
            username: `${displayName} ${offer.operation === "WTS" ? "🙋 WTS" : "💸 WTB"}`,
            avatarURL: avatarURL,
          });
          console.log(
            `Edited gold offer ${offer.uniqueKey} with messageId: ${offer.messageId}`,
          );
        } catch (error) {
          console.error(
            `Failed to edit gold offer ${offer.uniqueKey}:`,
            error.message,
          );
          db.prepare("DELETE FROM gold_offers WHERE uniqueKey = ?").run(
            offer.uniqueKey,
          );
        }
      } else {
        const newMessage = await webhook.send({
          embeds: [tradeEmbed],
          components: [row],
          username: `${displayName} ${offer.operation === "WTS" ? "🙋 WTS" : "💸 WTB"}`,
          avatarURL: avatarURL,
        });
        db.prepare(
          "UPDATE gold_offers SET messageId = ? WHERE uniqueKey = ?",
        ).run(newMessage.id, offer.uniqueKey);
        console.log(
          `Created new message for gold offer ${offer.uniqueKey} with messageId: ${newMessage.id}`,
        );
      }
    } catch (error) {
      console.error(
        `Error restoring gold offer ${offer.uniqueKey}:`,
        error.message,
      );
      db.prepare("DELETE FROM gold_offers WHERE uniqueKey = ?").run(
        offer.uniqueKey,
      );
    }
  }
}

async function handleGoldInteraction(interaction, client, webhook, config) {
  try {
    if (
      !interaction.isButton() &&
      !interaction.isModalSubmit() &&
      !interaction.isStringSelectMenu()
    ) {
      return false;
    }
    console.log(`Handling interaction with customId: ${interaction.customId}`);
    if (interaction.deferred || interaction.replied) {
      console.log(`Interaction ${interaction.customId} already handled`);
      return true;
    }
    if (interaction.isButton() && interaction.customId === "gold_button") {
      const submissionKey = uuidv4().slice(0, 8);
      const operationSelect = new StringSelectMenuBuilder()
        .setCustomId(`operation_select_gold_${submissionKey}`)
        .setPlaceholder("Select Operation")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("WTS (Want to Sell)")
            .setValue("WTS")
            .setEmoji("🙋"),
          new StringSelectMenuOptionBuilder()
            .setLabel("WTB (Want to Buy)")
            .setValue("WTB")
            .setEmoji("💸"),
        );
      const row = new ActionRowBuilder().addComponents(operationSelect);
      await interaction.reply({
        content: "يرجى اختيار نوع العرض:",
        components: [row],
        ephemeral: true,
      });
      console.log(
        `Sent operation select menu for gold offer, submissionKey: ${submissionKey}`,
      );
      return true;
    }
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("operation_select_gold_")
    ) {
      const submissionKey = interaction.customId.split("_")[3];
      const operation = interaction.values[0];
      const paymentMethodSelect = new StringSelectMenuBuilder()
        .setCustomId(`payment_select_gold_${submissionKey}_${operation}`)
        .setPlaceholder("Select Payment Method")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("Vodafone Cash")
            .setValue("Vodafone Cash")
            .setEmoji("💸"),
          new StringSelectMenuOptionBuilder()
            .setLabel("USDT")
            .setValue("USDT")
            .setEmoji("🟡"),
        );
      const row = new ActionRowBuilder().addComponents(paymentMethodSelect);
      await interaction.update({
        content: `يرجى اختيار طريقة الدفع لعرض ${operation}:`,
        components: [row],
        ephemeral: true,
      });
      console.log(
        `Updated payment method select menu for operation: ${operation}, submissionKey: ${submissionKey}`,
      );
      return true;
    }
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("payment_select_gold_")
    ) {
      const parts = interaction.customId.split("_");
      const submissionKey = parts[3];
      const operation = parts[4];
      const paymentMethod = interaction.values[0];

      const paymentChars = db
        .prepare("SELECT paymentCharacterName FROM characters WHERE userId = ? AND paymentCharacterName IS NOT NULL")
        .all(interaction.user.id);

      const charMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_payment_char_gold_${submissionKey}_${operation}_${paymentMethod}`)
        .setPlaceholder("اختر Payment Character (اختياري)")
        .addOptions(
          paymentChars.length > 0
            ? paymentChars.map((char) => ({
                label: char.paymentCharacterName,
                value: char.paymentCharacterName,
              }))
            : [{ label: "ما عنديش كراكتر مسجل", value: "none", emoji: "❌" }]
        )
        .addOptions({
          label: "Skip - هكتب الاسم يدويًا في الثريد",
          value: "skip",
          emoji: "⏭️",
        });

      await interaction.update({
        content: "اختر Payment Character الخاص بك (اختياري):",
        components: [new ActionRowBuilder().addComponents(charMenu)],
        ephemeral: true,
      });
      return true;
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("select_payment_char_gold_")
    ) {
      const parts = interaction.customId.split("_");
      const submissionKey = parts[4];
      const operation = parts[5];
      const paymentMethod = parts[6];
      const selectedValue = interaction.values[0];

      let characterName = "N/A";
      if (selectedValue !== "skip" && selectedValue !== "none") {
        characterName = selectedValue;
      }

      const modal = new ModalBuilder()
        .setCustomId(`gold_offer_modal_${submissionKey}_${operation}_${paymentMethod}_${encodeURIComponent(characterName)}`)
        .setTitle("عرض الذهب");

      const goldAmountInput = new TextInputBuilder()
        .setCustomId("gold_amount")
        .setLabel("الكمية")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("أدخل الكمية (مثلاً: 500, 1700, 2500)");

      const priceInput = new TextInputBuilder()
        .setCustomId("custom_price")
        .setLabel("السعر لكل مليون (رقم فقط)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(
          paymentMethod === "Vodafone Cash" ? "مثلاً: 1600 (EGP)" : "مثلاً: 30 (USDT)",
        );

      modal.addComponents(
        new ActionRowBuilder().addComponents(goldAmountInput),
        new ActionRowBuilder().addComponents(priceInput),
      );

      await interaction.showModal(modal);
      return true;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("gold_offer_modal_")
    ) {
      const parts = interaction.customId.split("_");
      const submissionKey = parts[3];
      const operation = parts[4];
      const paymentMethod = parts[5];
      const characterNameEncoded = parts[6];
      const characterName = characterNameEncoded ? decodeURIComponent(characterNameEncoded) : "N/A";

      if (!["Vodafone Cash", "USDT"].includes(paymentMethod)) {
        await interaction.reply({
          content: "طريقة دفع غير صالحة، ابدأ من جديد!",
          ephemeral: true,
        });
        return true;
      }
      const goldAmountInput = interaction.fields
        .getTextInputValue("gold_amount")
        ?.trim();
      const customPriceInput = interaction.fields
        .getTextInputValue("custom_price")
        ?.trim();
      if (!goldAmountInput || !customPriceInput) {
        await interaction.reply({
          content: "الكمية والسعر مطلوبان!",
          ephemeral: true,
        });
        return true;
      }
      const goldAmountNum = calculateGoldAmount(goldAmountInput);
      if (goldAmountNum <= 0) {
        await interaction.reply({
          content:
            "كمية غير صالحة! أدخل قيمة لا تقل عن 100 (مثلاً: 500, 1700, 2500).",
          ephemeral: true,
        });
        return true;
      }
      const customPriceNum = parseFloat(customPriceInput);
      if (isNaN(customPriceNum) || customPriceNum <= 0) {
        await interaction.reply({
          content:
            "سعر غير صالح! أدخل رقم إيجابي (مثلاً: 1600 لـ EGP أو 30 لـ USDT).",
          ephemeral: true,
        });
        return true;
      }
      const unit = paymentMethod === "Vodafone Cash" ? "EGP" : "USDT";
      const price = `${customPriceNum} ${unit} per 1M`;
      const displayName = await getUserDisplayName(
        client,
        interaction.user.id,
        interaction.guildId,
      );
      const avatarURL =
        interaction.user.displayAvatarURL({ dynamic: true, size: 256 }) ||
        "https://i.imgur.com/0Cnzr9Z.gif";
      let uniqueKey = uuidv4();
      const offer = {
        userId: interaction.user.id,
        operation: operation,
        goldAmount: goldAmountNum.toString(),
        remainingAmount: goldAmountNum.toString(),
        price: price,
        paymentMethod: paymentMethod,
        characterName: characterName,
        messageId: null,
        channelId: config.GOLD_CHANNEL_ID,
        threadId: null,
        claimed: false,
        applicants: [],
        completed: false,
        createdAt: new Date().toISOString(),
      };
      let tradeEmbed = new EmbedBuilder()
        .setColor("#800080")
        .setDescription(
          `**By:** <@${interaction.user.id}> ${paymentMethod.toLowerCase().includes("vodafone") ? "💸 Vodafone Cash" : paymentMethod || "N/A"} | ${price} | 🪙 Quantity | ${formatQuantity(offer.goldAmount)}\n` +
            `**Applicants:** None\n` +
            `**Remaining Quantity:** ${formatQuantity(offer.remainingAmount)}\n`,
        );
      const applyButton = new ButtonBuilder()
        .setCustomId(`apply_gold_${uniqueKey}`)
        .setLabel("Apply for Offer")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅")
        .setDisabled(
          offer.completed ||
            parseFloat(parseQuantity(offer.remainingAmount || "0")) <= 0,
        );
      const editButton = new ButtonBuilder()
        .setCustomId(`edit_gold_${uniqueKey}`)
        .setLabel("✏️ Edit")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false);
      const deleteButton = new ButtonBuilder()
        .setCustomId(`delete_gold_${uniqueKey}`)
        .setLabel("🗑️ Delete")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(false);
      const row = new ActionRowBuilder().addComponents(
        applyButton,
        editButton,
        deleteButton,
      );
      try {
        const tradeChannel = await client.channels.fetch(
          config.GOLD_CHANNEL_ID,
        );
        const tradeMessage = await webhook.send({
          embeds: [tradeEmbed],
          components: [row],
          username: `${displayName} ${operation === "WTS" ? "🙋 WTS" : "💸 WTB"}`,
          avatarURL: avatarURL,
        });
        offer.messageId = tradeMessage.id;
        saveGoldOffer(offer, uniqueKey);
        await interaction.reply({
          content: `تم إرسال عرض الذهب بنجاح إلى <#${config.GOLD_CHANNEL_ID}>! 🎉`,
          ephemeral: true,
        });
      } catch (error) {
        console.error(
          `Error submitting gold offer for ${submissionKey}:`,
          error.message,
        );
        await interaction.reply({
          content: `فشل في إرسال عرض الذهب! حاول مرة أخرى. الخطأ: ${error.message}`,
          ephemeral: true,
        });
      }
      return true;
    }
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("apply_gold_")
    ) {
      const uniqueKey = interaction.customId.replace("apply_gold_", "");
      const offer = db
        .prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?")
        .get(uniqueKey);
      if (!offer) {
        await interaction.reply({
          content: "هذا العرض غير موجود بعد الآن!",
          ephemeral: true,
        });
        return true;
      }
      if (
        offer.completed ||
        parseFloat(parseQuantity(offer.remainingAmount || "0")) <= 0
      ) {
        await interaction.reply({
          content: "هذا العرض مغلق أو تم تطبيقه بالكامل!",
          ephemeral: true,
        });
        return true;
      }
      if (offer.userId === interaction.user.id) {
        await interaction.reply({
          content: "لا يمكنك التقديم على عرضك الخاص!",
          ephemeral: true,
        });
        return true;
      }
      const modal = new ModalBuilder()
        .setCustomId(`apply_gold_modal_${uniqueKey}`)
        .setTitle(`التقدم لعرض ${offer.operation}`);
      const amountInput = new TextInputBuilder()
        .setCustomId("apply_amount")
        .setLabel(
          `الكمية المراد ${offer.operation === "WTS" ? "الشراء" : "البيع"}`,
        )
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("أدخل الكمية (مثلاً: 500, 1700, 2500)");
      const amountRow = new ActionRowBuilder().addComponents(amountInput);
      modal.addComponents(amountRow);
      try {
        await interaction.showModal(modal);
        console.log(`Showed apply modal for offer ${uniqueKey}`);
      } catch (error) {
        console.error(
          "Error showing apply modal:",
          error.message,
          "Stack:",
          error.stack,
        );
        await interaction.reply({
          content:
            "فشل في فتح نافذة التقديم. حاول مرة أخرى! الخطأ: " + error.message,
          ephemeral: true,
        });
      }
      return true;
    }
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("edit_gold_")
    ) {
      const uniqueKey = interaction.customId.replace("edit_gold_", "");
      const offer = db
        .prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?")
        .get(uniqueKey);
      if (!offer) {
        await interaction.reply({
          content: "هذا العرض غير موجود بعد الآن!",
          ephemeral: true,
        });
        return true;
      }
      if (offer.userId !== interaction.user.id) {
        await interaction.reply({
          content: "يمكنك فقط تعديل عرضك الخاص!",
          ephemeral: true,
        });
        return true;
      }
      const currentPriceNum = offer.price.split(" ")[0] || "";
      const modal = new ModalBuilder()
        .setCustomId(`edit_offer_modal_${uniqueKey}`)
        .setTitle("تعديل عرض الذهب");
      const newAmountInput = new TextInputBuilder()
        .setCustomId("new_amount")
        .setLabel("الكمية الجديدة")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(formatQuantity(offer.goldAmount))
        .setPlaceholder("أدخل الكمية الجديدة (مثلاً: 500, 1700, 2500)");
      const newPriceInput = new TextInputBuilder()
        .setCustomId("new_price")
        .setLabel("السعر الجديد لكل مليون (رقم فقط)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(currentPriceNum)
        .setPlaceholder("مثلاً: 1600");
      const newAmountRow = new ActionRowBuilder().addComponents(newAmountInput);
      const newPriceRow = new ActionRowBuilder().addComponents(newPriceInput);
      modal.addComponents(newAmountRow, newPriceRow);
      try {
        await interaction.showModal(modal);
        console.log(`Showed edit modal for offer ${uniqueKey}`);
      } catch (error) {
        console.error(
          "Error showing edit modal:",
          error.message,
          "Stack:",
          error.stack,
        );
        await interaction.reply({
          content:
            "فشل في فتح نافذة التعديل. حاول مرة أخرى! الخطأ: " + error.message,
          ephemeral: true,
        });
      }
      return true;
    }
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("edit_offer_modal_")
    ) {
      const uniqueKey = interaction.customId.replace("edit_offer_modal_", "");
      const offer = db
        .prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?")
        .get(uniqueKey);
      if (!offer) {
        await interaction.reply({
          content: "هذا العرض غير موجود بعد الآن!",
          ephemeral: true,
        });
        return true;
      }
      if (offer.userId !== interaction.user.id) {
        await interaction.reply({
          content: "يمكنك فقط تعديل عرضك الخاص!",
          ephemeral: true,
        });
        return true;
      }
      const newAmountInput = interaction.fields
        .getTextInputValue("new_amount")
        ?.trim();
      const newPriceInput = interaction.fields
        .getTextInputValue("new_price")
        ?.trim();
      console.log(
        `Received newAmountInput: ${newAmountInput}, newPriceInput: ${newPriceInput}`,
      );
      if (!newAmountInput || !newPriceInput) {
        await interaction.reply({
          content: "الكمية والسعر الجديدان مطلوبان!",
          ephemeral: true,
        });
        return true;
      }
      const newAmountNum = calculateGoldAmount(newAmountInput);
      console.log(`Calculated newAmountNum: ${newAmountNum}`);
      if (newAmountNum <= 0) {
        await interaction.reply({
          content:
            "كمية غير صالحة! أدخل قيمة لا تقل عن 100 (مثلاً: 500, 1700, 2500).",
          ephemeral: true,
        });
        return true;
      }
      const newPriceNum = parseFloat(newPriceInput);
      if (isNaN(newPriceNum) || newPriceNum <= 0) {
        await interaction.reply({
          content: "سعر غير صالح! أدخل رقم إيجابي.",
          ephemeral: true,
        });
        return true;
      }
      const unit = offer.paymentMethod === "Vodafone Cash" ? "EGP" : "USDT";
      const price = `${newPriceNum} ${unit} per 1M`;
      offer.goldAmount = newAmountNum.toString();
      offer.remainingAmount = newAmountNum.toString();
      offer.price = price;
      let applicants = offer.applicants;
      if (typeof applicants === "string") applicants = JSON.parse(applicants);
      let tradeEmbed = new EmbedBuilder()
        .setColor("#800080")
        .setDescription(
          `**By:** <@${offer.userId}> ${offer.paymentMethod.toLowerCase().includes("vodafone") ? "💸 Vodafone Cash" : offer.paymentMethod || "N/A"} | ${price} | 🪙 Quantity | ${formatQuantity(offer.goldAmount)}\n` +
            `**Applicants:** ${applicants.length > 0 ? applicants.map((app) => `<@${app.userId}> ${app.operation === "WTS" ? "🙋" : "💸"} ${formatQuantity(app.amount)}`).join("\n") : "None"}\n` +
            `**Remaining Quantity:** ${formatQuantity(offer.remainingAmount)}\n`,
        );
      const applyButton = new ButtonBuilder()
        .setCustomId(`apply_gold_${offer.uniqueKey}`)
        .setLabel("Apply for Offer")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅")
        .setDisabled(
          offer.completed ||
            parseFloat(parseQuantity(offer.remainingAmount || "0")) <= 0,
        );
      const editButton = new ButtonBuilder()
        .setCustomId(`edit_gold_${offer.uniqueKey}`)
        .setLabel("✏️ Edit")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false);
      const deleteButton = new ButtonBuilder()
        .setCustomId(`delete_gold_${offer.uniqueKey}`)
        .setLabel("🗑️ Delete")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(false);
      const row = new ActionRowBuilder().addComponents(
        applyButton,
        editButton,
        deleteButton,
      );
      try {
        const displayName = await getUserDisplayName(
          client,
          offer.userId,
          interaction.guildId,
        );
        const avatarURL =
          client.users.cache
            .get(offer.userId)
            ?.displayAvatarURL({ dynamic: true, size: 256 }) ||
          "https://i.imgur.com/0Cnzr9Z.gif";
        await webhook.editMessage(offer.messageId, {
          embeds: [tradeEmbed],
          components: [row],
          username: `${displayName} ${offer.operation === "WTS" ? "🙋 WTS" : "💸 WTB"}`,
          avatarURL: avatarURL,
        });
        saveGoldOffer(offer, uniqueKey);
        await interaction.reply({
          content: `تم تحديث عرض الذهب بنجاح بكمية جديدة ${formatQuantity(newAmountNum)} وسعر ${price}! 🎉`,
          ephemeral: true,
        });
      } catch (error) {
        console.error(`Error updating gold offer ${uniqueKey}:`, error.message);
        await interaction.reply({
          content: `فشل في تحديث عرض الذهب! حاول مرة أخرى. الخطأ: ${error.message}`,
          ephemeral: true,
        });
      }
      return true;
    }
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("delete_gold_")
    ) {
      const uniqueKey = interaction.customId.replace("delete_gold_", "");
      const offer = db
        .prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?")
        .get(uniqueKey);
      if (!offer) {
        await interaction.reply({
          content: "هذا العرض غير موجود بعد الآن!",
          ephemeral: true,
        });
        return true;
      }
      if (offer.userId !== interaction.user.id) {
        await interaction.reply({
          content: "يمكنك فقط حذف عرضك الخاص!",
          ephemeral: true,
        });
        return true;
      }
      try {
        if (offer.messageId) {
          await webhook.deleteMessage(offer.messageId);
        }
        db.prepare("DELETE FROM gold_offers WHERE uniqueKey = ?").run(
          uniqueKey,
        );
        await interaction.reply({
          content: "تم حذف عرض الذهب بنجاح! 🎉",
          ephemeral: true,
        });
      } catch (error) {
        console.error(`Error deleting gold offer ${uniqueKey}:`, error.message);
        await interaction.reply({
          content: `فشل في حذف عرض الذهب! حاول مرة أخرى. الخطأ: ${error.message}`,
          ephemeral: true,
        });
      }
      return true;
    }
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("apply_gold_modal_")
    ) {
      const parts = interaction.customId.split("_");
      const uniqueKey = parts[3];
      console.log(`Processing apply modal submit for uniqueKey: ${uniqueKey}`);
      const offer = db
        .prepare("SELECT * FROM gold_offers WHERE uniqueKey = ?")
        .get(uniqueKey);
      if (!offer) {
        await interaction.reply({
          content: "هذا العرض غير موجود بعد الآن!",
          ephemeral: true,
        });
        return true;
      }
      if (offer.completed) {
        await interaction.reply({
          content: "هذا العرض مغلق!",
          ephemeral: true,
        });
        return true;
      }
      const applyAmountInput = interaction.fields
        .getTextInputValue("apply_amount")
        ?.trim();
      console.log(`Received applyAmountInput: ${applyAmountInput}`);
      if (!applyAmountInput || typeof applyAmountInput !== "string") {
        await interaction.reply({
          content: "الكمية مطلوبة ويجب أن تكون إدخالاً صالحاً!",
          ephemeral: true,
        });
        return true;
      }
      const applyAmountNum = calculateGoldAmount(applyAmountInput);
      console.log(`Calculated applyAmountNum: ${applyAmountNum}`);
      if (applyAmountNum <= 0) {
        await interaction.reply({
          content:
            "كمية غير صالحة! أدخل قيمة لا تقل عن 100 (مثلاً: 500, 1700, 2500).",
          ephemeral: true,
        });
        return true;
      }
      const remainingAmountNum =
        parseFloat(parseQuantity(offer.remainingAmount)) || 0;
      if (applyAmountNum > remainingAmountNum) {
        await interaction.reply({
          content: `لا يمكنك التقديم بكمية أكبر من الكمية المتبقية (${formatQuantity(offer.remainingAmount)})!`,
          ephemeral: true,
        });
        return true;
      }
      try {
        const tradeChannel = await client.channels.fetch(
          config.GOLD_CHANNEL_ID,
        );
        const threadName = `Gold Offer - ${offer.operation} ${formatQuantity(offer.goldAmount)}`;
        const thread = await tradeChannel.threads.create({
          name: threadName,
          autoArchiveDuration: 1440,
          type: 12, // PrivateThread
          invitable: false,
        });
        await thread.members.add(offer.userId);
        await thread.members.add(interaction.user.id);
        const warningMessage =
          "⚠️ **تنبيه مهم:** السيرفر غير مسؤول في حالة التعامل مع شخص لا يحمل 🔒Role Trusted. يُفضل طلب وسيط من الإدمنز لضمان الأمان.";

        // جلب Payment Character من العرض نفسه (اللي اختاره أو N/A)
        const ownerPaymentChar = offer.characterName || "N/A";

        // جلب Payment Character للـ Applicant من الداتابيز
        const applicantRow = db
          .prepare("SELECT paymentCharacterName FROM characters WHERE userId = ?")
          .get(interaction.user.id);
        const applicantPaymentChar = applicantRow?.paymentCharacterName || "N/A";

        await thread.send({
          content: 
            `${warningMessage}\n` +
            `<@${offer.userId}> and <@${interaction.user.id}>, this is a private thread to discuss the gold offer ${offer.operation} for ${formatQuantity(applyAmountNum)}. Coordinate here. 🎉\n` +
            `**Payment Character (Owner):** ${ownerPaymentChar}\n` +
            `**Payment Character (Applicant):** ${applicantPaymentChar}`,
        });

        let applicants = offer.applicants;
        if (typeof applicants === "string") applicants = JSON.parse(applicants);
        else if (!Array.isArray(applicants)) applicants = [];
        const applicantOperation = offer.operation === "WTS" ? "WTB" : "WTS";
        applicants.push({
          userId: interaction.user.id,
          amount: applyAmountNum.toString(),
          operation: applicantOperation,
        });
        const newRemainingAmount = (
          remainingAmountNum - applyAmountNum
        ).toString();
        const isFullyClaimed = parseFloat(newRemainingAmount) <= 0;
        db.prepare(
          "UPDATE gold_offers SET remainingAmount = ?, applicants = ?, claimed = ?, completed = ? WHERE uniqueKey = ?",
        ).run(
          cleanQuantity(newRemainingAmount),
          JSON.stringify(applicants),
          isFullyClaimed ? 1 : 0,
          isFullyClaimed ? 1 : 0,
          uniqueKey,
        );
        db.prepare(
          "INSERT OR REPLACE INTO ticket_threads (threadId, channelId, messageId, creatorId, offerUniqueKey, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          thread.id,
          config.GOLD_CHANNEL_ID,
          offer.messageId,
          interaction.user.id,
          uniqueKey,
          new Date().toISOString(),
        );
        const displayName = await getUserDisplayName(
          client,
          offer.userId,
          interaction.guildId,
        );
        const avatarURL =
          client.users.cache
            .get(offer.userId)
            ?.displayAvatarURL({ dynamic: true, size: 256 }) ||
          "https://i.imgur.com/0Cnzr9Z.gif";
        let applicantsText = "None";
        if (applicants.length > 0) {
          applicantsText = applicants
            .map(
              (app) =>
                `${app.operation === "WTB" ? "WTB 💸" : "WTS 🙋"} <@${app.userId}> ${formatQuantity(app.amount)}`,
            )
            .join("\n");
        }
        let tradeEmbed = new EmbedBuilder()
          .setColor("#800080")
          .setDescription(
            `**By:** <@${offer.userId}> ${offer.paymentMethod.toLowerCase().includes("vodafone") ? "💸 Vodafone Cash" : offer.paymentMethod || "N/A"} | ${offer.price} | 🪙 Quantity | ${formatQuantity(offer.goldAmount)}\n` +
              `**Applicants:** ${applicantsText}\n` +
              `**Remaining Quantity:** ${formatQuantity(newRemainingAmount)}\n`,
          );
        const applyButton = new ButtonBuilder()
          .setCustomId(`apply_gold_${offer.uniqueKey}`)
          .setLabel("Apply for Offer")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅")
          .setDisabled(
            isFullyClaimed ||
              parseFloat(parseQuantity(newRemainingAmount)) <= 0,
          );
        const editButton = new ButtonBuilder()
          .setCustomId(`edit_gold_${offer.uniqueKey}`)
          .setLabel("✏️ Edit")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(isFullyClaimed);
        const deleteButton = new ButtonBuilder()
          .setCustomId(`delete_gold_${offer.uniqueKey}`)
          .setLabel("🗑️ Delete")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(isFullyClaimed);
        const row = new ActionRowBuilder().addComponents(
          applyButton,
          editButton,
          deleteButton,
        );
        await webhook.editMessage(offer.messageId, {
          embeds: [tradeEmbed],
          components: [row],
          username: `${displayName} ${offer.operation === "WTS" ? "🙋 WTS" : "💸 WTB"}`,
          avatarURL: avatarURL,
        });
        await interaction.reply({
          content: `تم التقديم لعرض الذهب بنجاح بـ ${formatQuantity(applyAmountNum)}! 🎉 تم إنشاء برايفت ثريد: ${thread}. قوم بالتنسيق مع <@${offer.userId}> هناك.`,
          ephemeral: true,
        });
        const offerUser = await client.users
          .fetch(offer.userId)
          .catch(() => null);
        if (offerUser) {
          await offerUser.send({
            content: `تم التقديم على عرضك ${offer.operation} من قبل <@${interaction.user.id}> بـ ${formatQuantity(applyAmountNum)}! 🎉 تم إنشاء برايفت ثريد: ${thread}. قوم بالتنسيق هناك.`,
          });
        }
      } catch (error) {
        console.error(
          `Error applying to gold offer ${uniqueKey}:`,
          error.message,
          "Stack:",
          error.stack,
        );
        await interaction.reply({
          content: `فشل في التقديم على العرض أو إنشاء الثريد! الخطأ: ${error.message}`,
          ephemeral: true,
        });
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error(
      `Error handling gold interaction ${interaction.customId || "unknown"}:`,
      error.message,
      "Stack:",
      error.stack,
    );
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: "حدث خطأ أثناء معالجة طلبك. حاول مرة أخرى.",
          ephemeral: true,
        })
        .catch((err) =>
          console.error("Failed to send error reply:", err.message),
        );
    }
    return true;
  }
}

module.exports = {
  reloadGoldOffers,
  handleGoldInteraction,
};