import { table, integer, text, boolean } from 'sdk/db';

// Rebuilt schema for Serverless. Existing PostgreSQL data is intentionally not copied.
export const settings = table('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const users = table('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: text('telegram_id').notNull().unique(),
  username: text('username').notNull().default(''),
  displayName: text('display_name').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const administrators = table('administrators', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  loginUsername: text('login_username').notNull().default(''),
  canManageBots: boolean('can_manage_bots').notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const publishers = table('publishers', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  token: text('token').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const publisherPermissions = table('publisher_permissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  publisherId: text('publisher_id').notNull(),
  userId: integer('user_id').notNull(),
  role: text('role').notNull().default('operator'),
  createdAt: integer('created_at').notNull(),
});

export const targets = table('targets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  botId: text('bot_id').notNull(),
  chatId: text('chat_id').notNull(),
  title: text('title').notNull(),
  chatType: text('chat_type').notNull(),
  username: text('username'),
  canPublish: boolean('can_publish').notNull().default(false),
  lastError: text('last_error'),
});

export const media = table('media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sha256: text('sha256').notNull().unique(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  filePath: text('file_path').notNull(),
  telegramFileId: text('telegram_file_id'),
  createdAt: integer('created_at').notNull(),
});

export const tasks = table('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  deltaJson: text('delta_json').notNull(),
  buttonsJson: text('buttons_json').notNull(),
  targetIdsJson: text('target_ids_json').notNull(),
  scheduleJson: text('schedule_json').notNull(),
  mediaId: integer('media_id'),
  botId: text('bot_id').notNull(),
  status: text('status').notNull(),
  nextAt: integer('next_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const runs = table('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull(),
  runKey: text('run_key').notNull().unique(),
  source: text('source').notNull(),
  slotAt: integer('slot_at').notNull(),
  status: text('status').notNull(),
  botId: text('bot_id').notNull(),
  deltaJson: text('delta_json').notNull(),
  buttonsJson: text('buttons_json').notNull().default('[]'),
  mediaId: integer('media_id'),
  createdAt: integer('created_at').notNull(),
});

export const deliveries = table('deliveries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull(),
  targetId: integer('target_id').notNull(),
  chatId: text('chat_id').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  telegramMessageId: text('telegram_message_id'),
  errorText: text('error_text'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  claimToken: text('claim_token'),
  claimedAt: integer('claimed_at'),
});

export const botPlayers = table('bot_players', {
  botId: text('bot_id').notNull(),
  telegramId: text('telegram_id').notNull(),
  displayName: text('display_name').notNull().default(''),
  username: text('username').notNull().default(''),
  platformId: text('platform_id').notNull().default(''),
  active: boolean('active').notNull().default(true),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
  source: text('source').notNull().default('ffa'),
});

export const broadcasts = table('broadcasts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  deltaJson: text('delta_json').notNull(),
  buttonsJson: text('buttons_json').notNull(),
  mediaId: integer('media_id'),
  botId: text('bot_id').notNull(),
  status: text('status').notNull(),
  totalCount: integer('total_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
});

export const broadcastDeliveries = table('broadcast_deliveries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  broadcastId: integer('broadcast_id').notNull(),
  telegramId: text('telegram_id').notNull(),
  displayName: text('display_name').notNull().default(''),
  status: text('status').notNull(),
  telegramMessageId: text('telegram_message_id'),
  errorText: text('error_text'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  claimToken: text('claim_token'),
  claimedAt: integer('claimed_at'),
});

export const conversations = table('conversations', {
  botId: text('bot_id').notNull(),
  chatId: text('chat_id').notNull(),
  chatType: text('chat_type').notNull(),
  title: text('title').notNull().default(''),
  username: text('username').notNull().default(''),
  avatarFileId: text('avatar_file_id'),
  lastMessageId: text('last_message_id'),
  lastMessageText: text('last_message_text').notNull().default(''),
  lastMessageAt: integer('last_message_at').notNull().default(0),
  unreadCount: integer('unread_count').notNull().default(0),
  lastReadMessageId: text('last_read_message_id'),
  updatedAt: integer('updated_at').notNull(),
});

export const chatMessages = table('chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  botId: text('bot_id').notNull(),
  chatId: text('chat_id').notNull(),
  telegramMessageId: text('telegram_message_id').notNull(),
  direction: text('direction').notNull(),
  fromId: text('from_id'),
  text: text('text').notNull().default(''),
  entitiesJson: text('entities_json').notNull().default('[]'),
  mediaKind: text('media_kind'),
  fileId: text('file_id'),
  mediaId: integer('media_id'),
  replyToMessageId: text('reply_to_message_id'),
  sentAt: integer('sent_at').notNull(),
  editedAt: integer('edited_at'),
  status: text('status').notNull().default('SUCCESS'),
  buttonsJson: text('buttons_json').notNull().default('[]'),
});

export const chatEvents = table('chat_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  botId: text('bot_id').notNull(),
  chatId: text('chat_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const publisherInbox = table('publisher_inbox', {
  botId: text('bot_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  webhookStatus: text('webhook_status').notNull().default('NOT_CHECKED'),
  secret: text('secret'),
  lastError: text('last_error'),
  checkedAt: integer('checked_at'),
});

export const sentActions = table('sent_actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  botId: text('bot_id').notNull(),
  kind: text('kind').notNull(),
  remoteId: text('remote_id').notNull(),
  action: text('action').notNull(),
  payloadJson: text('payload_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
});

export const stickerPacks = table('sticker_packs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  botId: text('bot_id').notNull(),
  name: text('name').notNull(),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const stickerPackItems = table('sticker_pack_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  packId: integer('pack_id').notNull(),
  emojiId: text('emoji_id').notNull(),
  alt: text('alt').notNull(),
  thumbnailId: text('thumbnail_id'),
  position: integer('position').notNull(),
});

export const browserLinks = table('browser_links', {
  tokenHash: text('token_hash').primaryKey(),
  adminId: text('admin_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const browserSessions = table('browser_sessions', {
  sessionHash: text('session_hash').primaryKey(),
  adminId: text('admin_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  lastSeen: integer('last_seen').notNull(),
  loginUsername: text('login_username').notNull().default(''),
});

export const sentChanges = table('sent_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  deliveryId: integer('delivery_id').notNull(),
  deleted: boolean('deleted').notNull().default(false),
  deltaJson: text('delta_json'),
  buttonsJson: text('buttons_json'),
  mediaId: integer('media_id'),
  state: text('state').notNull(),
  error: text('error'),
  updatedAt: integer('updated_at').notNull(),
});
