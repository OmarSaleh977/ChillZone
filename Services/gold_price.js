const { EmbedBuilder } = require("discord.js");

async function fetchGoldPrice() {
  try {
    return {
      usd: 44, // سعر الجنيه المصري لكل 1000 ذهب
      egp: 2290, // سعر الدولار لكل 1000 ذهب
    };
  } catch (error) {
    console.error("Error fetching gold price:", error);
    return { egp: "N/A", usd: "N/A" };
  }
}

async function handleGoldPriceInteraction(interaction, client) {
  if (interaction.customId === "gold_price_button") {
    const goldPriceData = await fetchGoldPrice();
    let avatarURL;
    try {
      avatarURL = client.user.displayAvatarURL({ format: "png", size: 128 });
    } catch (error) {
      console.error("Error fetching bot avatar:", error.message);
      avatarURL = "https://i.imgur.com/3MM7jPp.png";
    }

    const embed = new EmbedBuilder()
      .setTitle("WoW Gold Prices")
      .setDescription(
        `:flag_eg: ${goldPriceData.egp || "N/A"} EGP\n` +
          `:flag_us: ${goldPriceData.usd || "N/A"} USD`,
      )
      .setColor("#800080")
      .setThumbnail(avatarURL);

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
    return true;
  }
  return false;
}

module.exports = { handleGoldPriceInteraction, fetchGoldPrice };