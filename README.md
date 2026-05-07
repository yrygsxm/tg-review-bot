# Telegram 投稿审核机器人

这是一个基于 `Cloudflare Workers + D1 + Telegram Bot API + Telegram Mini App` 的投稿审核系统。机器人负责接收消息、转发审核、发送频道和通知用户；小程序负责更舒服地投稿、审核、编辑、驳回、管理理由和黑名单。

## 功能

- 用户可在 Telegram 小程序里提交文字投稿，并选择是否显示投稿人。
- 用户也可以继续用私聊机器人发送文字、图片、视频、文件投稿。
- 投稿会进入管理员审核聊天，并保留 `发送 / 驳回` 消息按钮。
- 管理员可在小程序里查看待审核列表，直接发送、修改后发送、选择理由驳回或手动填写理由。
- 管理员可在小程序里维护固定驳回理由和黑名单关键词。
- 投稿命中黑名单关键词时，系统会自动驳回，不进入人工审核。
- 如果用户选择显示投稿人，最终频道消息末尾会追加 `via.用户名`。

## 页面

- `/app`: Telegram Mini App 页面。普通用户看到投稿页，管理员额外看到审核页和规则页。
- `/telegram/webhook`: Telegram webhook 地址。
- `/health`: 服务健康检查地址。

## Telegram 准备

1. 在 Telegram 打开 `@BotFather`。
2. 创建机器人并保存 Bot Token。
3. 给机器人设置菜单按钮，按钮地址填写 Worker 的 `/app` 地址。
4. 把机器人加入目标频道，并设为管理员。
5. 把机器人加入审核群，或者准备一个只给管理员使用的审核聊天。
6. 私聊机器人发送 `/whoami`，记录自己的用户 ID。
7. 在审核群发送 `/whoami`，记录审核聊天 ID。

## Cloudflare 可视化部署

推荐使用 Cloudflare Dashboard 的 Git 集成部署。Cloudflare 官方 Workers Builds 支持连接 GitHub/GitLab 仓库，并在代码更新后自动构建和部署 Worker。

第一次部署前必须先完成 D1 数据库配置。当前项目通过 [wrangler.jsonc](/Users/simon/Documents/tg 投稿审核机器人/wrangler.jsonc) 声明 D1 绑定，Cloudflare 构建时会读取这里的 `database_id`。如果 `database_id` 还是占位值，构建会报错：

`binding DB of type d1 must have a valid database_id specified`

1. 打开 Cloudflare Dashboard。
2. 先进入 `Storage & Databases` 创建 D1 数据库。
3. 记录 D1 数据库的 `Database ID`。
4. 在 GitHub 仓库里打开 `wrangler.jsonc`，把 `__REPLACE_WITH_D1_DATABASE_ID__` 替换成真实的 `Database ID`。
5. 提交这个修改。
6. 回到 Cloudflare Dashboard，进入 `Workers & Pages`。
7. 选择创建 Worker，并连接保存本项目的 GitHub 或 GitLab 仓库。
8. 项目名称使用 `tg-review-bot`，需要和 [wrangler.jsonc](/Users/simon/Documents/tg 投稿审核机器人/wrangler.jsonc) 里的 `name` 保持一致。
9. 确认根目录指向本项目所在目录。
10. 保存后让 Cloudflare 自动完成第一次部署。
11. 部署完成后，记录 Worker 访问地址，例如 `https://tg-review-bot.xxx.workers.dev`。

Cloudflare 官方说明：
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
[Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)

## D1 数据库

1. 在 Cloudflare Dashboard 进入 `Storage & Databases`。
2. 创建一个 D1 数据库，名称建议使用 `tg-review-bot`。
3. 复制数据库的 `Database ID`。
4. 在 GitHub 仓库编辑 `wrangler.jsonc`，把 `database_id` 的占位值替换成真实 ID。
5. 打开数据库的控制台或查询页面。
6. 打开 [migrations/0001_init.sql](/Users/simon/Documents/tg 投稿审核机器人/migrations/0001_init.sql)，把里面的表结构放到 D1 查询页面执行。

说明：这个项目不依赖手动在 Worker 设置页添加 D1 Binding。D1 Binding 已经写在 `wrangler.jsonc` 里，绑定名称是 `DB`。关键是 `database_id` 必须是真实值。

## 环境变量和密钥

在 Worker 的 `Settings` 页面找到 `Variables and Secrets`，添加下面几项。

普通变量：

- `REVIEW_CHAT_ID`: 审核群或管理员聊天 ID。
- `TARGET_CHANNEL_ID`: 目标频道 ID，支持 `@channelname` 或频道数值 ID。
- `MINI_APP_URL`: 小程序地址，填写 Worker 地址加 `/app`。
- `SUPERADMIN_IDS`: 超级管理员用户 ID，多个 ID 用英文逗号分隔。

密钥：

- `TELEGRAM_BOT_TOKEN`: BotFather 给你的机器人 token。
- `TELEGRAM_WEBHOOK_SECRET`: 自己设置的 webhook 校验密钥，建议使用随机字符串。

保存变量和密钥后，重新部署一次 Worker。

## Telegram Webhook

在 Telegram Bot API 的 `setWebhook` 页面或你熟悉的可视化 API 工具里配置 webhook。

需要填写：

- `url`: Worker 地址加 `/telegram/webhook`。
- `secret_token`: 和 Cloudflare 里 `TELEGRAM_WEBHOOK_SECRET` 完全一致。
- `allowed_updates`: 选择 `message` 和 `callback_query`。

配置成功后，私聊机器人发送 `/help`，应该能看到投稿入口；打开小程序后，普通用户会看到投稿页，管理员会看到投稿、审核、规则三个页签。

Telegram 官方说明：
[Telegram Mini Apps](https://core.telegram.org/bots/webapps)
[Telegram Bot API](https://core.telegram.org/bots/api)

## 管理方式

小程序里可以完成日常管理：

- 审核待处理投稿。
- 修改文案后发送。
- 添加或删除固定驳回理由。
- 添加或删除黑名单关键词。

机器人命令仍然保留，方便应急：

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

## 注意事项

- 小程序当前支持文字投稿；图片、视频、文件投稿继续走私聊机器人发送。
- 媒体投稿在审核时可以修改最终频道文案，但不会替换媒体文件本身。
- Telegram 小程序 API 会校验 `initData`，请只从 Telegram 内打开 `/app`。
- 如果用户从未私聊过机器人，机器人可能无法主动给该用户发送审核结果通知；让用户先点一次 `/start` 即可。
