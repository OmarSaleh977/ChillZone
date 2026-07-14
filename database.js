require("dotenv").config();
const SQLite = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "database.db");
const db = new SQLite(dbPath, { verbose: console.log });

function initializeDatabase() {
  try {
    // تحسينات الأداء الأساسية (مهمة جدًا للسرعة)
    db.prepare("PRAGMA synchronous = NORMAL;").run(); // أسرع في الكتابة
    db.prepare("PRAGMA journal_mode = WAL;").run(); // تقليل القفل
    db.prepare("PRAGMA cache_size = -20000;").run(); // كاش أكبر (20 ميجا)
    db.prepare("PRAGMA temp_store = MEMORY;").run(); // جداول مؤقتة في الرام

    // Gold offers table - migration
    const goldTableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gold_offers'")
      .get();
    if (goldTableExists) {
      console.log("Gold offers table exists, checking schema...");
      const goldInfo = db.prepare("PRAGMA table_info(gold_offers)").all();
      const hasPaymentMethod = goldInfo.some(col => col.name === "paymentMethod");
      const hasCharacterName = goldInfo.some(col => col.name === "characterName");
      if (!hasPaymentMethod || !hasCharacterName) {
        console.log("Migrating gold_offers table to full schema...");
        db.prepare("ALTER TABLE gold_offers RENAME TO gold_offers_old").run();
        db.prepare(`
          CREATE TABLE gold_offers (
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
        `).run();
        db.prepare(`
          INSERT INTO gold_offers (
            uniqueKey, userId, operation, goldAmount, remainingAmount, price,
            paymentMethod, characterName, messageId, channelId, threadId,
            claimed, applicants, completed, createdAt
          )
          SELECT
            uniqueKey, userId, operation, goldAmount, remainingAmount, price,
            COALESCE(paymentMethod, 'Vodafone Cash'), COALESCE(characterName, 'N/A'),
            messageId, channelId, threadId, claimed, applicants, completed, createdAt
          FROM gold_offers_old
        `).run();
        db.prepare("DROP TABLE gold_offers_old").run();
        console.log("gold_offers migrated successfully");
      } else {
        console.log("gold_offers table already up to date");
      }
    } else {
      db.prepare(`
        CREATE TABLE gold_offers (
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
      `).run();
      console.log("gold_offers table created");
    }

    // جدول الدعوات (لنظام الرانك)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS invites (
        userId TEXT PRIMARY KEY,
        inviteCount INTEGER DEFAULT 0,
        lastInviteDate TEXT
      )
    `).run();
    console.log("Invites table for rank system checked/created.");

    // باقي الجداول زي ما هي
    db.prepare(`
      CREATE TABLE IF NOT EXISTS dungeon_offers (
        uniqueKey TEXT PRIMARY KEY,
        type TEXT,
        userId TEXT,
        userTag TEXT,
        dungeon TEXT,
        keystoneLevel TEXT,
        runType TEXT,
        stack TEXT,
        numberOfRuns TEXT,
        cut TEXT,
        claimed INTEGER,
        messageId TEXT,
        groupData TEXT,
        pendingApplicants TEXT,
        threadId TEXT
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ticket_messages (
        channelId TEXT PRIMARY KEY,
        messageId TEXT NOT NULL
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ticket_threads (
        threadId TEXT PRIMARY KEY,
        channelId TEXT NOT NULL,
        messageId TEXT NOT NULL,
        creatorId TEXT NOT NULL,
        offerUniqueKey TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS leveling_offers (
        uniqueKey TEXT PRIMARY KEY,
        type TEXT,
        userId TEXT,
        userTag TEXT,
        levelRange TEXT,
        price TEXT,
        faction TEXT,
        messageId TEXT,
        channelId TEXT,
        threadId TEXT,
        claimed INTEGER,
        claimedBy TEXT,
        completed INTEGER,
        createdAt TEXT,
        pendingApplicants TEXT
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS account_offers (
        uniqueKey TEXT PRIMARY KEY,
        type TEXT,
        userId TEXT,
        userTag TEXT,
        operation TEXT,
        quantity TEXT,
        price TEXT,
        paymentMethod TEXT,
        messageId TEXT,
        channelId TEXT,
        claimed INTEGER DEFAULT 0,
        claimedBy TEXT,
        completed INTEGER DEFAULT 0,
        createdAt TEXT,
        pendingApplicants TEXT DEFAULT '[]',
        embed TEXT
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS user_ranks (
        userId TEXT PRIMARY KEY,
        dungeonRuns INTEGER DEFAULT 0
      )
    `).run();

    // Indexes for performance
    db.prepare("CREATE INDEX IF NOT EXISTS idx_gold_offers_uniqueKey ON gold_offers(uniqueKey)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_gold_offers_completed ON gold_offers(completed)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_gold_offers_userId ON gold_offers(userId)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_gold_offers_claimed ON gold_offers(claimed)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_account_offers_userId ON account_offers(userId)").run();
    db.prepare("CREATE INDEX IF NOT EXISTS idx_account_offers_claimed ON account_offers(claimed)").run();

    console.log("Database initialized successfully - All tables and indexes checked");
  } catch (error) {
    console.error("Database initialization error:", error.message);
    throw error;
  }
}

async function cleanInvalidOffers(client) {
  try {
    const tables = [
      { name: "gold_offers", channelId: process.env.GOLD_CHANNEL_ID },
      { name: "leveling_offers", channelId: process.env.LEVELING_CHANNEL_ID },
      { name: "dungeon_offers", channelId: process.env.DUNGEON_OFFERS_CHANNEL_ID },
      { name: "account_offers", channelId: process.env.ACCOUNT_CHANNEL_ID },
    ];
    for (const table of tables) {
      if (!table.channelId) {
        console.log(`Skipping cleanup for ${table.name} - channel ID not set`);
        continue;
      }
      let offers = [];
      try {
        const hasCompleted = db
          .prepare(`PRAGMA table_info(${table.name})`)
          .all()
          .some(col => col.name === "completed");
        offers = hasCompleted
          ? db.prepare(`SELECT uniqueKey, messageId FROM ${table.name} WHERE completed = 0`).all()
          : db.prepare(`SELECT uniqueKey, messageId FROM ${table.name}`).all();
      } catch (err) {
        console.error(`Error reading table ${table.name}:`, err.message);
        continue;
      }
      let deleted = 0;
      for (const offer of offers) {
        try {
          const channel = await client.channels.fetch(table.channelId).catch(() => null);
          if (!channel) {
            console.warn(`Channel ${table.channelId} for ${table.name} not found`);
            continue;
          }
          const msg = await channel.messages.fetch(offer.messageId).catch(() => null);
          if (!msg) {
            db.prepare(`DELETE FROM ${table.name} WHERE uniqueKey = ?`).run(offer.uniqueKey);
            deleted++;
          }
        } catch (err) {
          console.warn(`Failed to check message ${offer.messageId} in ${table.name}:`, err.message);
          db.prepare(`DELETE FROM ${table.name} WHERE uniqueKey = ?`).run(offer.uniqueKey);
          deleted++;
        }
      }
      if (deleted > 0) {
        console.log(`Cleaned ${deleted} invalid offers from ${table.name}`);
      } else {
        console.log(`No invalid offers found in ${table.name}`);
      }
    }
    console.log("Cleanup completed successfully");
  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
}

process.on("SIGINT", () => {
  db.close();
  console.log("Database connection closed");
  process.exit(0);
});

module.exports = { db, initializeDatabase, cleanInvalidOffers };