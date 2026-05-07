# Telegram 投稿审核机器人

这是一个基于 `Cloudflare Workers + D1 + Telegram Bot API + Telegram Mini App` 的投稿审核系统。

明确说明：本项目部署为 **Cloudflare Worker**，不是 Cloudflare Pages。Cloudflare 后台入口虽然叫 `Workers & Pages`，但创建时要选择 Worker / Workers Builds。

## 功能

- 用户可在 Telegram 小程序里提交文字投稿，并选择是否显示投稿人。
- 用户也可以私聊机器人发送文字、图片、视频、文件投稿。
- 投稿进入管理员审核聊天，并保留 `发送 / 驳回` 消息按钮。
- 管理员可在小程序里查看待审核列表，直接发送、修改后发送、选择理由驳回或手动填写理由。
- 管理员可在小程序里维护固定驳回理由和黑名单关键词。
- 投稿命中黑名单关键词时，系统会自动驳回。
- 如果用户选择显示投稿人，最终频道消息末尾会追加 `via.用户名`。

## 访问地址

- `/app`: Telegram Mini App 页面。
- `/telegram/webhook`: Telegram webhook 地址。
- `/health`: 服务健康检查地址。

## 部署前准备

你需要准备：

- 一个 Telegram Bot Token。
- 一个 Cloudflare 账号。
- 一个 D1 数据库。
- 一个 GitHub 仓库。
- 目标频道，并把机器人设为频道管理员。
- 审核群，或一个只给管理员使用的审核聊天。

## 部署顺序

必须按这个顺序做。先创建 D1，再导入 GitHub 创建 Worker。

### 1. 创建 Telegram 机器人

1. 在 Telegram 打开 `@BotFather`。
2. 创建机器人，保存 Bot Token。
3. 暂时不用配置 Mini App 地址，因为 Worker 地址还没生成。

### 2. 创建 D1 数据库

1. 打开 Cloudflare Dashboard。
2. 进入 `Storage & Databases`。
3. 创建 D1 数据库，名称建议使用 `tg-review-bot`。
4. 复制数据库的 `Database ID`。
5. 打开 D1 数据库的查询页面。
6. 打开 [migrations/0001_init.sql](/Users/simon/Documents/tg 投稿审核机器人/migrations/0001_init.sql)，把里面的 SQL 放进查询页面执行。

注意：`Database ID` 不写进 GitHub。部署时通过 Cloudflare 构建变量 `D1_DATABASE_ID` 注入。

### 3. 导入 GitHub 创建 Worker

1. 打开 Cloudflare Dashboard。
2. 进入 `Workers & Pages`。
3. 选择创建应用。
4. 选择导入 GitHub 仓库。
5. 选择 `tg-review-bot` 仓库。
6. 类型选择 Worker / Workers Builds，不要创建 Pages 项目。
7. 项目名称填写 `tg-review-bot`。
8. Build command 留空。
9. Deploy command 填写 `npm run deploy`。
10. 先不要点最终部署，继续配置变量。

Cloudflare 官方说明：
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)

### 4. 配置 Worker 变量和密钥

在 Worker 的 `Settings > Variables and Secrets` 里添加。

普通变量：

- `D1_DATABASE_ID`: D1 数据库的真实 Database ID。
- `REVIEW_CHAT_ID`: 审核群 ID。第一次可以先填 `123456789`，后面用 `/whoami` 查到真实值再改。
- `TARGET_CHANNEL_ID`: 目标频道 ID，例如 `@your_channel`。
- `MINI_APP_URL`: 第一次可以先填 `https://your-worker.workers.dev/app`，部署后改成真实 Worker 地址加 `/app`。
- `SUPERADMIN_IDS`: 超级管理员 Telegram 用户 ID。第一次可以先填你的 Telegram 用户 ID；如果不知道，先填临时值，部署后用 `/whoami` 查。

密钥：

- `TELEGRAM_BOT_TOKEN`: BotFather 给你的 token。
- `TELEGRAM_WEBHOOK_SECRET`: 随机字符串，后面配置 webhook 时必须使用同一个值。

安全说明：

- `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_WEBHOOK_SECRET` 必须用 Secret。
- `D1_DATABASE_ID` 不是数据库密码，但公开仓库里不放真实值。
- GitHub 里的 [wrangler.jsonc](/Users/simon/Documents/tg 投稿审核机器人/wrangler.jsonc) 只保留占位符。

### 5. 第一次部署

保存变量和密钥后，启动部署。

如果部署成功，记录 Worker 地址，例如：

`https://tg-review-bot.xxx.workers.dev`

如果第一次用的是临时变量，部署成功后继续改：

- `MINI_APP_URL`: 改成真实 Worker 地址加 `/app`。
- `REVIEW_CHAT_ID`: 改成审核群真实 ID。
- `SUPERADMIN_IDS`: 改成真实管理员用户 ID。
- `TARGET_CHANNEL_ID`: 改成真实频道 ID。

改完变量后重新部署一次。

### 6. 获取 Telegram ID

部署并配置 webhook 后，可以用机器人获取 ID。

- 私聊机器人发送 `/whoami`，获取你的 Telegram 用户 ID。
- 在审核群发送 `/whoami`，获取审核群 ID。

如果 `/whoami` 没反应，先完成下一步 webhook 配置。

### 7. 设置 Telegram Webhook

调用 Telegram Bot API 的 `setWebhook`。

需要填写：

- `url`: Worker 地址加 `/telegram/webhook`。
- `secret_token`: 和 Cloudflare 里的 `TELEGRAM_WEBHOOK_SECRET` 完全一致。
- `allowed_updates`: `message`, `callback_query`。

示例：

`https://tg-review-bot.xxx.workers.dev/telegram/webhook`

Telegram 官方说明：
[Telegram Bot API setWebhook](https://core.telegram.org/bots/api#setwebhook)

### 8. 配置 Telegram Mini App

在 `@BotFather` 里打开机器人设置：

1. 进入 Bot Settings。
2. 配置 Mini App 或菜单按钮。
3. 地址填写 Worker 地址加 `/app`。

示例：

`https://tg-review-bot.xxx.workers.dev/app`

Telegram 官方说明：
[Telegram Mini Apps](https://core.telegram.org/bots/webapps)

## 验证

1. 打开 Worker 的 `/health`，应返回服务正常。
2. 私聊机器人发送 `/help`，应看到投稿入口。
3. 打开 `/app`，普通用户应看到投稿页。
4. 管理员打开 `/app`，应看到 `投稿 / 审核 / 规则` 三个页签。
5. 添加一个黑名单关键词，提交包含该关键词的投稿，应自动驳回。
6. 提交正常投稿，审核群应收到审核消息。
7. 点击发送，频道应收到最终消息。

## 常见错误

`binding DB of type d1 must have a valid database_id specified`

原因：Cloudflare 构建环境没有配置 `D1_DATABASE_ID`，或者 Deploy command 没有使用 `npm run deploy`。

处理：

- 确认 Worker 构建变量里存在 `D1_DATABASE_ID`。
- 确认 Deploy command 是 `npm run deploy`。
- 确认不是 Pages 项目，而是 Worker / Workers Builds。

`Missing TELEGRAM_BOT_TOKEN secret`

原因：没有在 Worker Secrets 里配置 `TELEGRAM_BOT_TOKEN`。

`Forbidden`

原因：Telegram webhook 请求的 `secret_token` 和 Worker Secret `TELEGRAM_WEBHOOK_SECRET` 不一致。

## 管理方式

小程序里可以完成日常管理：

- 审核待处理投稿。
- 修改文案后发送。
- 添加或删除固定驳回理由。
- 添加或删除黑名单关键词。

机器人命令仍然保留：

- `/add_reason <理由>`
- `/list_reasons`
- `/del_reason <ID>`
- `/add_blacklist <关键词>`
- `/list_blacklist`
- `/del_blacklist <ID>`
- `/add_admin <用户ID>`
- `/del_admin <用户ID>`
- `/whoami`
- `/cancel`

## 限制

- 小程序当前支持文字投稿。
- 图片、视频、文件投稿继续走私聊机器人发送。
- 媒体投稿在审核时可以修改最终频道文案，但不会替换媒体文件本身。
- 如果用户从未私聊过机器人，机器人可能无法主动发送审核结果通知；让用户先点一次 `/start`。
