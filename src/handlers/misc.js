import { ephemeral, respond, sendMessage, fetchMember, EPHEMERAL } from "../discord.js";

export async function handleGoldPriceInteraction(interaction, env) {
  const goldPriceData = { usd: 44, egp: 2290 };
  const avatarURL = "https://i.imgur.com/3MM7jPp.png";

  return {
    type: 4,
    data: {
      embeds: [{
        title: "WoW Gold Prices",
        description: `:flag_eg: ${goldPriceData.egp} EGP\n:flag_us: ${goldPriceData.usd} USD`,
        color: 0x800080,
        thumbnail: { url: avatarURL },
      }],
      flags: EPHEMERAL,
    },
  };
}

export async function handleGameOn(interaction, env) {
  const token = env.BOT_TOKEN;
  const targetChannelId = "1425206436404789318";

  const embed = {
    color: 0x7B1FA2,
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
