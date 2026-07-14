import { ephemeral, respond, sendMessage, fetchMember, EPHEMERAL } from "../discord.js";
import { getPrices } from "../prices.js";

export async function handleGoldPriceInteraction(interaction, env) {
  const db = env.DB;
  const prices = await getPrices(db);

  const avatarURL = "https://i.imgur.com/3MM7jPp.png";

  if (!prices || !prices.g2g_usd_per_million) {
    return {
      type: 4,
      data: {
        embeds: [{
          title: "WoW Gold Prices",
          description: "Prices not available yet. Updating every 5 minutes...",
          color: 0x800080,
          thumbnail: { url: avatarURL },
        }],
        flags: EPHEMERAL,
      },
    };
  }

  const g2gUsd = prices.g2g_usd_per_million;
  const binanceEgp = prices.binance_egp_per_usdt;
  const egpPerMillion = prices.egp_per_million;
  const lastUpdated = prices.last_updated
    ? `<t:${Math.floor(new Date(prices.last_updated).getTime() / 1000)}:R>`
    : "N/A";

  const fields = [
    { name: "Gold / 1M", value: `\`$${g2gUsd.toFixed(2)}\``, inline: true },
    { name: "USD / EGP", value: `\`${binanceEgp ? binanceEgp.toFixed(2) : "N/A"}\``, inline: true },
  ];

  if (egpPerMillion) {
    fields.push(
      { name: "Gold / 1M (EGP)", value: `\`${Math.round(egpPerMillion).toLocaleString()} EGP\``, inline: true },
    );
  }

  fields.push({ name: "Updated", value: lastUpdated, inline: false });

  return {
    type: 4,
    data: {
      embeds: [{
        title: "WoW Gold Prices — Live",
        color: 0x800080,
        thumbnail: { url: avatarURL },
        fields,
        footer: { text: "Updated every 5 min" },
      }],
      flags: EPHEMERAL,
    },
  };
}

export async function handleGameOn(interaction, env) {
  const token = env.BOT_TOKEN;
  const targetChannelId = "1425206436404789318";

  const embed = {
    color: 0x800080,
    title: "Game On ✅",
    description: "WoW servers are live now",
    fields: [{ name: "Online Since", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }],
    footer: { text: "ChillZone • World of Warcraft" },
    timestamp: new Date().toISOString(),
  };

  const msg = await sendMessage(targetChannelId, token, { content: "@everyone", embeds: [embed] });
  if (msg && msg.id) {
    await fetch(`https://discord.com/api/v10/channels/${targetChannelId}/messages/${msg.id}/reactions/✅/@me`, {
      method: "PUT",
      headers: { Authorization: `Bot ${token}` },
    });
  }

  return ephemeral("تم الإعلان عن أونلاين السيرفرات بمنشن للجميع!");
}

export async function handleWelcomeVerify(interaction, env) {
  const token = env.BOT_TOKEN;
  const VERIFY_ROLE_ID = "1387156059432423646";

  const member = await fetchMember(interaction.guild_id, interaction.user.id, token);
  if (!member) return ephemeral("حدث خطأ!");

  if (member.roles?.includes(VERIFY_ROLE_ID)) {
    return ephemeral("عندك الرول بالفعل!");
  }

  await fetch(`https://discord.com/api/v10/guilds/${interaction.guild_id}/members/${interaction.user.id}/roles/${VERIFY_ROLE_ID}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}` },
  });

  return ephemeral("**تم تأكيد عضويتك بنجاح!** 🔥");
}
