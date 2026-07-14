import { verifyInteraction, ephemeral, respond, EPHEMERAL } from "./discord.js";
import { initDatabase } from "./db.js";
import { handleGoldInteraction } from "./handlers/gold.js";
import { handleLevelingInteraction } from "./handlers/leveling.js";
import { handleDungeonInteraction } from "./handlers/dungeons.js";
import { handleAccountInteraction } from "./handlers/accounts.js";
import { handleGoldPriceInteraction, handleGameOn, handleWelcomeVerify } from "./handlers/misc.js";
import { updatePrices } from "./prices.js";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(updatePrices(env.DB));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Signature-Ed25519, X-Signature-Timestamp",
        },
      });
    }

    if (url.pathname === "/") {
      return new Response("ChillZone Bot is running on Cloudflare Workers!");
    }

    if (url.pathname === "/debug-gold-page") {
      try {
        const r = await fetch("https://egcurrency.com/en/currency/USD-to-EGP/gold", { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
        const html = await r.text();
        const prices = [];
        const regex = /(\d{2,3}\.\d{2,4})/g;
        let m;
        while ((m = regex.exec(html)) !== null) {
          const p = parseFloat(m[1]);
          if (p > 40 && p < 120) prices.push({ pos: m.index, val: p, ctx: html.slice(Math.max(0, m.index - 80), m.index + 30) });
        }
        return Response.json({ ok: r.ok, length: html.length, priceMatches: prices.slice(0, 20) });
      } catch (e) {
        return Response.json({ error: e.message });
      }
    }

    if (url.pathname === "/setup" && request.method === "POST") {
      try {
        await initDatabase(env.DB);
        return Response.json({ success: true, message: "Database initialized" });
      } catch (e) {
        return Response.json({ success: false, error: e.message });
      }
    }

    if (request.method !== "POST" || url.pathname !== "/interactions") {
      return new Response("Not Found", { status: 404 });
    }

    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    const body = await request.text();

    if (!signature || !timestamp) {
      return new Response("Missing signature headers", { status: 401 });
    }

    const isValid = await verifyInteraction(env.PUBLIC_KEY, signature, timestamp, body);
    if (!isValid) {
      return new Response("Bad request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    if (interaction.type === 3 || interaction.type === 5) {
      const customId = interaction.data?.custom_id || "";
      try {
        const res = await routeInteraction(customId, interaction, env);
        return Response.json(res);
      } catch (err) {
        console.error(`Error handling ${customId}:`, err.message, err.stack);
        return Response.json({
          type: 4,
          data: {
            content: `⚠️ **Error:** ${err.message}`,
            flags: EPHEMERAL,
          },
        });
      }
    }

    return Response.json(ephemeral("Interaction not supported"));
  },
};

async function routeInteraction(customId, interaction, env) {
  interaction.customId = customId;
  if (customId === "gold_price_button") return handleGoldPriceInteraction(interaction, env);
  if (customId === "gold_button") return handleGoldInteraction(interaction, env);
  if (customId === "gold_wts" || customId === "gold_wtb") return handleGoldInteraction(interaction, env);
  if (customId === "leveling_button") return handleLevelingInteraction(interaction, env);
  if (customId === "dungeon_button") return handleDungeonInteraction(interaction, env);
  if (customId === "account_button") return handleAccountInteraction(interaction, env);
  if (customId === "game_on_button") return handleGameOn(interaction, env);
  if (customId === "welcome_verify") return handleWelcomeVerify(interaction, env);

  const handlers = [
    { pattern: /^operation_select_gold_/, handler: handleGoldInteraction },
    { pattern: /^payment_select_gold_/, handler: handleGoldInteraction },
    { pattern: /^select_payment_char_gold_/, handler: handleGoldInteraction },
    { pattern: /^gold_offer_modal_/, handler: handleGoldInteraction },
    { pattern: /^apply_gold_modal_/, handler: handleGoldInteraction },
    { pattern: /^apply_gold_/, handler: handleGoldInteraction },
    { pattern: /^close_gold_/, handler: handleGoldInteraction },
    { pattern: /^confirm_gold_post_/, handler: handleGoldInteraction },
    { pattern: /^cancel_gold_post_/, handler: handleGoldInteraction },
    { pattern: /^edit_gold_/, handler: handleGoldInteraction },
    { pattern: /^delete_gold_/, handler: handleGoldInteraction },
    { pattern: /^edit_offer_modal_/, handler: handleGoldInteraction },
    { pattern: /^apply_gold_modal_/, handler: handleGoldInteraction },
    { pattern: /^faction_select_leveling_/, handler: handleLevelingInteraction },
    { pattern: /^leveling_modal_/, handler: handleLevelingInteraction },
    { pattern: /^apply_leveling_/, handler: handleLevelingInteraction },
    { pattern: /^complete_leveling_/, handler: handleLevelingInteraction },
    { pattern: /^dungeon_select_/, handler: handleDungeonInteraction },
    { pattern: /^keystone_select_/, handler: handleDungeonInteraction },
    { pattern: /^runtype_select_/, handler: handleDungeonInteraction },
    { pattern: /^stack_select_/, handler: handleDungeonInteraction },
    { pattern: /^runs_select_/, handler: handleDungeonInteraction },
    { pattern: /^cut_input_/, handler: handleDungeonInteraction },
    { pattern: /^apply_dungeon_/, handler: handleDungeonInteraction },
    { pattern: /^select_character_apply_/, handler: handleDungeonInteraction },
    { pattern: /^select_key_apply_/, handler: handleDungeonInteraction },
    { pattern: /^select_dungeon_apply_/, handler: handleDungeonInteraction },
    { pattern: /^accept_/, handler: handleDungeonInteraction },
    { pattern: /^reject_/, handler: handleDungeonInteraction },
    { pattern: /^start_dungeon_/, handler: handleDungeonInteraction },
    { pattern: /^cancel_dungeon_/, handler: handleDungeonInteraction },
    { pattern: /^kick_dungeon_/, handler: handleDungeonInteraction },
    { pattern: /^reopen_dungeon_/, handler: handleDungeonInteraction },
    { pattern: /^gg_key_done_/, handler: handleDungeonInteraction },
    { pattern: /^operation_select_account_/, handler: handleAccountInteraction },
    { pattern: /^payment_select_account_/, handler: handleAccountInteraction },
    { pattern: /^trade_modal_account_/, handler: handleAccountInteraction },
    { pattern: /^claim_/, handler: handleAccountInteraction },
  ];

  for (const { pattern, handler } of handlers) {
    if (pattern.test(customId)) return handler(interaction, env);
  }

  return ephemeral("الزرار ده مش مدعوم حاليًا!");
}
