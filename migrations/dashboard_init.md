# D1 Dashboard 初始化步骤

在 Cloudflare D1 Dashboard 的 SQL 查询页里，按下面顺序分三次执行。

不要只执行光标所在的一行。如果 Dashboard 只显示 `Executed 1/1`，说明它只执行了一条语句。

## 1. 创建数据表

```sql
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
```

## 2. 创建索引

```sql
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_review_message ON submissions(review_chat_id, review_message_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_keyword ON blacklist_keywords(keyword);
```

## 3. 检查结果

```sql
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
```

应该看到：

- `admin_sessions`
- `admins`
- `blacklist_keywords`
- `rejection_reasons`
- `submissions`
- `user_sessions`
