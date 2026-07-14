export async function fetchEGPRate() {
  const res = await fetch("https://cdn.moneyconvert.net/api/latest.json");
  if (!res.ok) throw new Error(`Rate API error: ${res.status}`);
  const json = await res.json();
  const egp = json.rates?.EGP;
  const usd = json.rates?.USD;
  if (!egp || !usd) throw new Error("Invalid rate data");
  return egp / usd;
}

export async function fetchG2GPrice() {
  const res = await fetch("https://api.oot.kr/wow/eu");
  if (!res.ok) throw new Error(`WoW Token API error: ${res.status}`);
  const json = await res.json();
  const priceStr = json.current_price?.replace(/,/g, "");
  const tokenGold = parseInt(priceStr, 10);
  if (!tokenGold || tokenGold <= 0) throw new Error("Invalid WoW Token price");
  const tokenUsd = 20;
  return (tokenUsd / tokenGold) * 1000000;
}

export async function updatePrices(db) {
  let g2gUsd = null;
  let egpRate = null;
  let error = null;

  try {
    g2gUsd = await fetchG2GPrice();
  } catch (e) {
    console.error("Gold price fetch error:", e.message);
    error = `Gold: ${e.message}`;
  }

  try {
    egpRate = await fetchEGPRate();
  } catch (e) {
    console.error("EGP rate fetch error:", e.message);
    error = error ? `${error} | EGP: ${e.message}` : `EGP: ${e.message}`;
  }

  if (g2gUsd === null && egpRate === null) {
    console.error("Both price fetches failed:", error);
    return { success: false, error };
  }

  let egpPerMillion = null;

  if (g2gUsd !== null && egpRate !== null) {
    egpPerMillion = g2gUsd * egpRate;
  } else if (g2gUsd !== null) {
    const row = await db.prepare("SELECT binance_egp_per_usdt FROM gold_prices WHERE id = 1").first();
    if (row?.binance_egp_per_usdt) {
      egpRate = row.binance_egp_per_usdt;
      egpPerMillion = g2gUsd * egpRate;
    }
  } else if (egpRate !== null) {
    const row = await db.prepare("SELECT g2g_usd_per_million FROM gold_prices WHERE id = 1").first();
    if (row?.g2g_usd_per_million) {
      g2gUsd = row.g2g_usd_per_million;
      egpPerMillion = g2gUsd * egpRate;
    }
  }

  const now = new Date().toISOString();
  await db.prepare(
    "INSERT OR REPLACE INTO gold_prices (id, g2g_usd_per_million, binance_egp_per_usdt, egp_per_million, last_updated) VALUES (1, ?, ?, ?, ?)"
  ).bind(g2gUsd, egpRate, egpPerMillion, now).run();

  return {
    success: true,
    g2g_usd: g2gUsd,
    binance_egp: egpRate,
    egp_per_million: egpPerMillion,
    error,
  };
}

export async function getPrices(db) {
  return db.prepare("SELECT * FROM gold_prices WHERE id = 1").first();
}
