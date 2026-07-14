export async function initDatabase(db) {
  await db.prepare("PRAGMA journal_mode = WAL;").run();
  await db.prepare("PRAGMA cache_size = -20000;").run();
  await db.prepare("PRAGMA temp_store = MEMORY;").run();

  const tables = [
    `CREATE TABLE IF NOT EXISTS gold_offers (uniqueKey TEXT PRIMARY KEY, userId TEXT NOT NULL, operation TEXT NOT NULL, goldAmount TEXT NOT NULL, remainingAmount TEXT NOT NULL, price TEXT NOT NULL, paymentMethod TEXT NOT NULL, characterName TEXT NOT NULL, messageId TEXT NOT NULL, channelId TEXT NOT NULL, threadId TEXT, claimed INTEGER DEFAULT 0, applicants TEXT DEFAULT '[]', completed INTEGER DEFAULT 0, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS leveling_offers (uniqueKey TEXT PRIMARY KEY, type TEXT, userId TEXT, userTag TEXT, levelRange TEXT, price TEXT, faction TEXT, messageId TEXT, channelId TEXT, threadId TEXT, claimed INTEGER, claimedBy TEXT, completed INTEGER, createdAt TEXT, pendingApplicants TEXT)`,
    `CREATE TABLE IF NOT EXISTS dungeon_offers (uniqueKey TEXT PRIMARY KEY, type TEXT, userId TEXT, userTag TEXT, dungeon TEXT, keystoneLevel TEXT, runType TEXT, stack TEXT, numberOfRuns TEXT, cut TEXT, claimed INTEGER, messageId TEXT, groupData TEXT, pendingApplicants TEXT, threadId TEXT)`,
    `CREATE TABLE IF NOT EXISTS account_offers (uniqueKey TEXT PRIMARY KEY, type TEXT, userId TEXT, userTag TEXT, operation TEXT, quantity TEXT, price TEXT, paymentMethod TEXT, messageId TEXT, channelId TEXT, claimed INTEGER DEFAULT 0, claimedBy TEXT, completed INTEGER DEFAULT 0, createdAt TEXT, pendingApplicants TEXT DEFAULT '[]', embed TEXT)`,
    `CREATE TABLE IF NOT EXISTS ticket_messages (channelId TEXT PRIMARY KEY, messageId TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ticket_threads (threadId TEXT PRIMARY KEY, channelId TEXT NOT NULL, messageId TEXT NOT NULL, creatorId TEXT NOT NULL, offerUniqueKey TEXT NOT NULL, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS user_ranks (userId TEXT PRIMARY KEY, dungeonRuns INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS invites (userId TEXT PRIMARY KEY, inviteCount INTEGER DEFAULT 0, lastInviteDate TEXT)`,
    `CREATE TABLE IF NOT EXISTS webhooks (channelId TEXT PRIMARY KEY, webhookId TEXT NOT NULL, webhookToken TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS interaction_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, expiresAt INTEGER NOT NULL)`,
  ];
  for (const sql of tables) await db.prepare(sql).run();
}

export async function getState(db, key) {
  const row = await db.prepare("SELECT data, expiresAt FROM interaction_state WHERE key = ?").get(key);
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    await db.prepare("DELETE FROM interaction_state WHERE key = ?").run(key);
    return null;
  }
  return JSON.parse(row.data);
}

export async function setState(db, key, data, ttlMs = 300000) {
  await db.prepare("INSERT OR REPLACE INTO interaction_state (key, data, expiresAt) VALUES (?, ?, ?)").run(key, JSON.stringify(data), Date.now() + ttlMs);
}

export async function deleteState(db, key) {
  await db.prepare("DELETE FROM interaction_state WHERE key = ?").run(key);
}

export async function cleanExpiredState(db) {
  await db.prepare("DELETE FROM interaction_state WHERE expiresAt < ?").run(Date.now());
}
