export async function fetchEGPRate() {
  const res = await fetch("https://cdn.moneyconvert.net/api/latest.json");
  if (!res.ok) throw new Error(`Rate API error: ${res.status}`);
  const json = await res.json();
  const egp = json.rates?.EGP;
  const usd = json.rates?.USD;
  if (!egp || !usd) throw new Error("Invalid rate data");
  return egp / usd;
}

export async function updatePrices(db) {
  let egpRate = null;

  try {
    egpRate = await fetchEGPRate();
  } catch (e) {
    console.error("EGP rate fetch error:", e.message);
    return { success: false, error: e.message };
  }

  const row = await db.prepare("SELECT g2g_usd_per_million FROM gold_prices WHERE id = 1").first();
  const g2gUsd = row?.g2g_usd_per_million || null;

  let egpPerMillion = null;
  if (g2gUsd !== null && egpRate !== null) {
    egpPerMillion = g2gUsd * egpRate;
  }

  const now = new Date().toISOString();
  await db.prepare(
    "INSERT OR REPLACE INTO gold_prices (id, g2g_usd_per_million, binance_egp_per_usdt, egp_per_million, last_updated) VALUES (1, ?, ?, ?, ?)"
  ).bind(g2gUsd, egpRate, egpPerMillion, now).run();

  return {
    success: true,
    g2g_usd: g2gUsd,
    egp_rate: egpRate,
    egp_per_million: egpPerMillion,
  };
}

export async function setGoldPrice(db, g2gUsd, egpRate) {
  let egpPerMillion = null;
  if (g2gUsd !== null && egpRate !== null) {
    egpPerMillion = g2gUsd * egpRate;
  }

  const now = new Date().toISOString();
  await db.prepare(
    "INSERT OR REPLACE INTO gold_prices (id, g2g_usd_per_million, binance_egp_per_usdt, egp_per_million, last_updated) VALUES (1, ?, ?, ?, ?)"
  ).bind(g2gUsd, egpRate, egpPerMillion, now).run();

  return { success: true, g2g_usd: g2gUsd, egp_rate: egpRate, egp_per_million: egpPerMillion };
}

export async function getPrices(db) {
  return db.prepare("SELECT * FROM gold_prices WHERE id = 1").first();
}
