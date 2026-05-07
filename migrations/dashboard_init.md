# D1 Dashboard 初始化步骤

Cloudflare D1 Dashboard 的 SQL Console 可能只执行“当前光标所在的一条语句”。如果页面显示 `Executed 1/1`，说明它只执行了一条 SQL。

因此不要一次粘贴多条后直接点运行。按下面顺序，一次只复制并执行一个代码块。

## 0. 先检查当前状态

```sql
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
```

如果没有看到 `blacklist_keywords`、`submissions`、`app_settings` 等表，继续执行下面的建表语句。

## 1. 创建 admins

```sql
CREATE TABLE IF NOT EXISTS admins (
  user_id INTEGER PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 2. 创建 app_settings

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 3. 创建 rejection_reasons

```sql
CREATE TABLE IF NOT EXISTS rejection_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 4. 创建 blacklist_keywords

```sql
CREATE TABLE IF NOT EXISTS blacklist_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 5. 创建 user_sessions

```sql
CREATE TABLE IF NOT EXISTS user_sessions (
  user_id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  display_sender INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 6. 创建 pending_user_submissions

```sql
CREATE TABLE IF NOT EXISTS pending_user_submissions (
  user_id INTEGER PRIMARY KEY,
  user_chat_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  content_text TEXT,
  media_file_id TEXT,
  media_unique_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 7. 创建 admin_sessions

```sql
CREATE TABLE IF NOT EXISTS admin_sessions (
  admin_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  submission_id INTEGER NOT NULL,
  prompt_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 8. 创建 submissions

```sql
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

## 9. 再检查表是否创建成功

```sql
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
```

应该看到：

- `admin_sessions`
- `admins`
- `app_settings`
- `blacklist_keywords`
- `pending_user_submissions`
- `rejection_reasons`
- `submissions`
- `user_sessions`

## 10. 创建索引

表确认存在后，再一条一条执行索引。

```sql
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
```

```sql
CREATE INDEX IF NOT EXISTS idx_submissions_review_message ON submissions(review_chat_id, review_message_id);
```

```sql
CREATE INDEX IF NOT EXISTS idx_blacklist_keyword ON blacklist_keywords(keyword);
```

## 11. 检查索引

```sql
SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name;
```
