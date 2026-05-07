CREATE TABLE IF NOT EXISTS admins (
  user_id INTEGER PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rejection_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blacklist_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  user_id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  display_sender INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  admin_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  submission_id INTEGER NOT NULL,
  prompt_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_chat_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,
  username TEXT,
  full_name TEXT NOT NULL,
  display_sender INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL,
  content_text TEXT,
  media_file_id TEXT,
  media_unique_id TEXT,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  reviewed_by INTEGER,
  review_chat_id INTEGER,
  review_message_id INTEGER,
  published_message_id INTEGER,
  edited_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_review_message ON submissions(review_chat_id, review_message_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_keyword ON blacklist_keywords(keyword);
