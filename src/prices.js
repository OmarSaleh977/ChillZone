export async function fetchEGPRate() {
  const res = await fetch("https://egcurrency.com/ar/currency/egp/blackmarket", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!res.ok) throw new Error(`EGCurrency error: ${res.status}`);
  const html = await res.text();

  const tableMatch = html.match(/دولار أمريكي.*?(\d+\.?\d+).*?(\d+\.?\d+)/s);
  if (tableMatch) {
    const buy = parseFloat(tableMatch[1]);
    const sell = parseFloat(tableMatch[2]);
    if (buy > 40 && buy < 70) return (buy + sell) / 2;
  }

  const prices = [];
  const regex = /(?:50|51|52|53|49|48)\.\d+/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const p = parseFloat(m[0]);
    if (p > 40 && p < 70) prices.push(p);
  }
  if (prices.length >= 2) {
    prices.sort((a, b) => a - b);
    return (prices[0] + prices[1]) / 2;
  }
  if (prices.length === 1) return prices[0];

  const fallback = await fetch("https://cdn.moneyconvert.net/api/latest.json");
  if (!fallback.ok) throw new Error("All rate sources failed");
  const json = await fallback.json();
  return json.rates?.EGP / json.rates?.USD;
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

  return { success: true, g2g_usd: g2gUsd, egp_rate: egpRate, egp_per_million: egpPerMillion };
}

export async function getPrices(db) {
  return db.prepare("SELECT * FROM gold_prices WHERE id = 1").first();
}
