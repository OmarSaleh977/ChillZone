const G2G_REGION_ID = "dfced32f-2f0a-4df5-a218-1e068cfadffa";

export async function fetchBinanceEGP() {
  const body = {
    page: 1,
    rows: 10,
    payTypes: ["Vodafonecash"],
    publisherType: null,
    asset: "USDT",
    tradeType: "SELL",
    fiat: "EGP",
    merchantCheck: false,
  };

  const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
    method: "POST",
    headers: {
      "Accept": "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Content-Type": "application/json",
      "Host": "p2p.binance.com",
      "Origin": "https://p2p.binance.com",
      "Pragma": "no-cache",
      "Referer": "https://p2p.binance.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const json = await res.json();
  const ads = json?.data;
  if (!ads || ads.length === 0) throw new Error("No Binance P2P ads found");

  const prices = ads
    .map((ad) => parseFloat(ad?.adv?.price))
    .filter((p) => !isNaN(p) && p > 0);

  if (prices.length === 0) throw new Error("No valid Binance prices");

  return Math.max(...prices);
}

export async function fetchG2GPrice() {
  const params = new URLSearchParams({
    category: "wow-gold",
    region_id: G2G_REGION_ID,
    sort: "lowest_price",
    currency: "USD",
    country_id: "",
    game_server_id: "",
    page: "1",
  });

  const res = await fetch(`https://www.g2g.com/offer/search?${params}`, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      "Referer": "https://www.g2g.com/categories/wow-gold",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`G2G API error: ${res.status}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("G2G returned non-JSON");
  }

  const offers = json?.data?.list || json?.data?.offers || json?.data || [];

  if (!Array.isArray(offers) || offers.length === 0) {
    throw new Error("No G2G offers found");
  }

  const prices = offers
    .map((o) => parseFloat(o?.unit_price || o?.price || o?.min_price))
    .filter((p) => !isNaN(p) && p > 0)
    .sort((a, b) => a - b);

  if (prices.length < 2) {
    return prices[0] || 0;
  }

  return prices[1];
}

export async function updatePrices(db) {
  let g2gUsd = null;
  let binanceEgp = null;
  let error = null;

  try {
    g2gUsd = await fetchG2GPrice();
  } catch (e) {
    console.error("G2G fetch error:", e.message);
    error = `G2G: ${e.message}`;
  }

  try {
    binanceEgp = await fetchBinanceEGP();
  } catch (e) {
    console.error("Binance fetch error:", e.message);
    error = error ? `${error} | Binance: ${e.message}` : `Binance: ${e.message}`;
  }

  if (g2gUsd === null && binanceEgp === null) {
    console.error("Both price fetches failed:", error);
    return { success: false, error };
  }

  let egpPerMillion = null;

  if (g2gUsd !== null && binanceEgp !== null) {
    egpPerMillion = g2gUsd * binanceEgp;
  } else if (g2gUsd !== null) {
    const row = await db.prepare("SELECT binance_egp_per_usdt FROM gold_prices WHERE id = 1").first();
    if (row?.binance_egp_per_usdt) {
      binanceEgp = row.binance_egp_per_usdt;
      egpPerMillion = g2gUsd * binanceEgp;
    }
  } else if (binanceEgp !== null) {
    const row = await db.prepare("SELECT g2g_usd_per_million FROM gold_prices WHERE id = 1").first();
    if (row?.g2g_usd_per_million) {
      g2gUsd = row.g2g_usd_per_million;
      egpPerMillion = g2gUsd * binanceEgp;
    }
  }

  const now = new Date().toISOString();
  await db.prepare(
    "INSERT OR REPLACE INTO gold_prices (id, g2g_usd_per_million, binance_egp_per_usdt, egp_per_million, last_updated) VALUES (1, ?, ?, ?, ?)"
  ).run(g2gUsd, binanceEgp, egpPerMillion, now);

  return {
    success: true,
    g2g_usd: g2gUsd,
    binance_egp: binanceEgp,
    egp_per_million: egpPerMillion,
    error,
  };
}

export async function getPrices(db) {
  return db.prepare("SELECT * FROM gold_prices WHERE id = 1").first();
}
