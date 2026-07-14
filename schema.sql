CREATE TABLE IF NOT EXISTS gold_offers (
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
);

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
);

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
);

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
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  channelId TEXT PRIMARY KEY,
  messageId TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_threads (
  threadId TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  messageId TEXT NOT NULL,
  creatorId TEXT NOT NULL,
  offerUniqueKey TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_ranks (
  userId TEXT PRIMARY KEY,
  dungeonRuns INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invites (
  userId TEXT PRIMARY KEY,
  inviteCount INTEGER DEFAULT 0,
  lastInviteDate TEXT
);

CREATE TABLE IF NOT EXISTS webhooks (
  channelId TEXT PRIMARY KEY,
  webhookId TEXT NOT NULL,
  webhookToken TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interaction_state (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expiresAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gold_offers_completed ON gold_offers(completed);
CREATE INDEX IF NOT EXISTS idx_gold_offers_userId ON gold_offers(userId);
CREATE INDEX IF NOT EXISTS idx_account_offers_userId ON account_offers(userId);
