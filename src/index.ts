import { createHmac, timingSafeEqual } from "node:crypto";

type SubmissionStatus =
  | "pending"
  | "publishing"
  | "published"
  | "rejected"
  | "auto_rejected";

type AdminSessionAction = "edit_submission" | "manual_reject_reason";
type UserSessionAction = "awaiting_submission";
type SubmissionContentType = "text" | "photo" | "video" | "document";

interface AppConfig {
  reviewChatId: number;
  targetChannelId: number | string;
  miniAppUrl: string | null;
  superadminIds: number[];
}

interface TelegramSecrets {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

interface AdminRow {
  user_id: number;
  role: string;
}

interface RejectionReasonRow {
  id: number;
  reason: string;
}

interface BlacklistKeywordRow {
  id: number;
  keyword: string;
}

interface UserSessionRow {
  user_id: number;
  action: UserSessionAction;
  display_sender: number;
}

interface AdminSessionRow {
  admin_id: number;
  chat_id: number;
  action: AdminSessionAction;
  submission_id: number;
  prompt_message_id: number | null;
}

interface SubmissionRow {
  id: number;
  user_id: number;
  user_chat_id: number;
  source_message_id: number;
  username: string | null;
  full_name: string;
  display_sender: number;
  content_type: SubmissionContentType;
  content_text: string | null;
  media_file_id: string | null;
  media_unique_id: string | null;
  status: SubmissionStatus;
  rejection_reason: string | null;
  reviewed_by: number | null;
  review_chat_id: number | null;
  review_message_id: number | null;
  published_message_id: number | null;
  edited_text: string | null;
  created_at: string;
  updated_at: string;
}

interface SubmissionPayload {
  contentType: SubmissionContentType;
  contentText: string | null;
  mediaFileId: string | null;
  mediaUniqueId: string | null;
}

interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  web_app?: {
    url: string;
  };
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
}

interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
  reply_to_message?: TelegramMessage;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

interface MiniAppUser extends TelegramUser {
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

interface MiniAppAuth {
  user: MiniAppUser;
  isAdmin: boolean;
  isSuperadmin: boolean;
}

interface MiniAppSubmitInput {
  text?: unknown;
  displaySender?: unknown;
}

interface MiniAppModerationInput {
  editedText?: unknown;
  reason?: unknown;
}

class UserVisibleError extends Error {}
class ApiError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const WEBHOOK_PATH = "/telegram/webhook";
const ROOT_PATH = "/";
const APP_PATH = "/app";
const HEALTH_PATH = "/health";
const USER_CALLBACK_MODE = "u:sm";
const MINI_APP_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === ROOT_PATH || url.pathname === APP_PATH)) {
      return htmlResponse(renderMiniAppHtml());
    }

    if (request.method === "GET" && url.pathname === HEALTH_PATH) {
      return Response.json({
        ok: true,
        service: "tg-review-bot",
        date: "2026-05-07"
      });
    }

    if (request.method === "POST" && url.pathname === WEBHOOK_PATH) {
      const secrets = getTelegramSecrets(env);
      if (!isValidWebhookRequest(request, secrets.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("Forbidden", { status: 403 });
      }

      const update = (await request.json()) as TelegramUpdate;

      try {
        await ensureSuperadmins(env);
        const config = getConfig(env);
        await handleUpdate(update, env, config);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "telegram update failed",
            error: error instanceof Error ? error.message : String(error),
            update
          })
        );
      }

      return new Response("OK");
    }

    if (url.pathname.startsWith("/api/")) {
      return handleMiniAppApi(request, env, url);
    }

    return new Response("Not Found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;

async function handleMiniAppApi(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    await ensureSuperadmins(env);
    const config = getConfig(env);
    const auth = await authenticateMiniAppRequest(request, env, config);
    const path = url.pathname;

    if (request.method === "GET" && path === "/api/bootstrap") {
      return jsonResponse({
        user: serializeMiniAppUser(auth.user),
        role: {
          isAdmin: auth.isAdmin,
          isSuperadmin: auth.isSuperadmin
        },
        config: {
          targetChannelId: config.targetChannelId,
          reviewChatId: config.reviewChatId
        },
        submissions: auth.isAdmin ? await listSubmissions(env, "pending") : [],
        reasons: auth.isAdmin ? await listRejectionReasons(env) : [],
        blacklist: auth.isAdmin ? await listBlacklistKeywords(env) : []
      });
    }

    if (request.method === "POST" && path === "/api/submissions") {
      const input = (await readJsonBody(request)) as MiniAppSubmitInput;
      const result = await submitFromMiniApp(env, auth.user, input, config);
      return jsonResponse(result, 201);
    }

    requireMiniAppAdmin(auth);

    if (request.method === "GET" && path === "/api/submissions") {
      const status = normalizeSubmissionStatus(url.searchParams.get("status"));
      return jsonResponse({
        submissions: await listSubmissions(env, status)
      });
    }

    const moderationMatch = path.match(/^\/api\/submissions\/(\d+)\/(publish|reject)$/);
    if (request.method === "POST" && moderationMatch) {
      const submissionId = Number.parseInt(moderationMatch[1] ?? "", 10);
      const action = moderationMatch[2];
      const submission = await getSubmission(env, submissionId);

      if (!submission) {
        throw new ApiError("找不到这条投稿。", 404);
      }

      const input = (await readJsonBody(request)) as MiniAppModerationInput;

      if (action === "publish") {
        const editedText = normalizeOptionalText(input.editedText);
        await publishSubmission(env, submission, auth.user.id, editedText, config);
      } else {
        const reason = normalizeOptionalText(input.reason);
        await rejectSubmission(env, submission, auth.user.id, reason);
      }

      return jsonResponse({
        submission: serializeSubmission(await mustGetSubmission(env, submissionId))
      });
    }

    if (request.method === "POST" && path === "/api/reasons") {
      const input = (await readJsonBody(request)) as { reason?: unknown };
      const reason = normalizeRequiredText(input.reason, "请填写驳回理由。");
      await env.DB.prepare(
        "INSERT OR IGNORE INTO rejection_reasons (reason, created_by) VALUES (?, ?)"
      )
        .bind(reason, auth.user.id)
        .run();
      return jsonResponse({ reasons: await listRejectionReasons(env) }, 201);
    }

    const reasonDeleteMatch = path.match(/^\/api\/reasons\/(\d+)$/);
    if (request.method === "DELETE" && reasonDeleteMatch) {
      await env.DB.prepare("DELETE FROM rejection_reasons WHERE id = ?")
        .bind(Number.parseInt(reasonDeleteMatch[1] ?? "", 10))
        .run();
      return jsonResponse({ reasons: await listRejectionReasons(env) });
    }

    if (request.method === "POST" && path === "/api/blacklist") {
      const input = (await readJsonBody(request)) as { keyword?: unknown };
      const keyword = normalizeForMatch(normalizeRequiredText(input.keyword, "请填写黑名单关键词。"));
      await env.DB.prepare(
        "INSERT OR IGNORE INTO blacklist_keywords (keyword, created_by) VALUES (?, ?)"
      )
        .bind(keyword, auth.user.id)
        .run();
      return jsonResponse({ blacklist: await listBlacklistKeywords(env) }, 201);
    }

    const blacklistDeleteMatch = path.match(/^\/api\/blacklist\/(\d+)$/);
    if (request.method === "DELETE" && blacklistDeleteMatch) {
      await env.DB.prepare("DELETE FROM blacklist_keywords WHERE id = ?")
        .bind(Number.parseInt(blacklistDeleteMatch[1] ?? "", 10))
        .run();
      return jsonResponse({ blacklist: await listBlacklistKeywords(env) });
    }

    return jsonResponse({ ok: false, error: "Not Found" }, 404);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    if (error instanceof UserVisibleError) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }

    console.error(
      JSON.stringify({
        level: "error",
        message: "mini app api failed",
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return jsonResponse({ ok: false, error: "请求失败，请稍后重试。" }, 500);
  }
}

async function handleUpdate(update: TelegramUpdate, env: Env, config: AppConfig): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env, config);
    return;
  }

  if (update.message) {
    await handleMessage(update.message, env, config);
  }
}

async function handleMessage(message: TelegramMessage, env: Env, config: AppConfig): Promise<void> {
  const command = parseCommand(message.text);
  if (command) {
    await handleCommand(message, command.name, command.args, env, config);
    return;
  }

  const actor = message.from;
  if (!actor) {
    return;
  }

  const adminSession = await getAdminSession(env, actor.id);
  if (adminSession) {
    await handleAdminSessionMessage(message, adminSession, env, config);
    return;
  }

  const userSession = await getUserSession(env, actor.id);
  if (userSession) {
    await handleUserSubmissionMessage(message, userSession, env, config);
    return;
  }

  if (message.chat.type === "private") {
    await sendMessage(env, message.chat.id, "发送 /submit 开始投稿，发送 /help 查看可用指令。");
  }
}

async function handleCommand(
  message: TelegramMessage,
  command: string,
  args: string,
  env: Env,
  config: AppConfig
): Promise<void> {
  const actor = message.from;
  if (!actor) {
    return;
  }

  switch (command) {
    case "start":
    case "help": {
      await sendMessage(
        env,
        message.chat.id,
        await buildHelpText(env, actor.id, config),
        message.chat.type === "private" ? buildMiniAppLaunchKeyboard(config) : undefined
      );
      return;
    }
    case "cancel": {
      const cleared = await clearActorSessions(env, actor.id);
      await sendMessage(env, message.chat.id, cleared ? "当前流程已取消。" : "当前没有进行中的流程。");
      return;
    }
    case "whoami": {
      await sendMessage(
        env,
        message.chat.id,
        `你的用户 ID: ${actor.id}\n当前聊天 ID: ${message.chat.id}\n聊天类型: ${message.chat.type}`
      );
      return;
    }
    case "submit": {
      if (message.chat.type !== "private") {
        await sendMessage(env, message.chat.id, "投稿只能在私聊里发给机器人。");
        return;
      }

      await sendMessage(
        env,
        message.chat.id,
        "请选择这次投稿是否显示投稿人：",
        buildUserSubmissionModeKeyboard(config)
      );
      return;
    }
    case "submit_show":
    case "submit_hide": {
      if (message.chat.type !== "private") {
        await sendMessage(env, message.chat.id, "投稿只能在私聊里发给机器人。");
        return;
      }

      const displaySender = command === "submit_show" ? 1 : 0;
      await upsertUserSession(env, actor.id, "awaiting_submission", displaySender);
      await sendMessage(env, message.chat.id, "请发送投稿内容。发送 /cancel 可取消本次投稿。");
      return;
    }
  }

  const isAdmin = await actorIsAdmin(env, actor.id, config);
  const isSuperadmin = config.superadminIds.includes(actor.id);

  if (!isAdmin) {
    await sendMessage(env, message.chat.id, "你没有这个管理权限。");
    return;
  }

  switch (command) {
    case "add_reason": {
      requireArgument(args, "请在命令后面带上驳回理由，例如：/add_reason 来源不明");
      await env.DB.prepare(
        "INSERT OR IGNORE INTO rejection_reasons (reason, created_by) VALUES (?, ?)"
      )
        .bind(args, actor.id)
        .run();
      await sendMessage(env, message.chat.id, `已加入驳回理由：${args}`);
      return;
    }
    case "list_reasons": {
      const reasons = await listRejectionReasons(env);
      const text =
        reasons.length === 0
          ? "当前还没有固定驳回理由。"
          : ["固定驳回理由：", ...reasons.map((reason) => `${reason.id}. ${reason.reason}`)].join("\n");
      await sendMessage(env, message.chat.id, text);
      return;
    }
    case "del_reason": {
      requireArgument(args, "请提供要删除的理由 ID，例如：/del_reason 2");
      const reasonId = Number.parseInt(args, 10);
      if (Number.isNaN(reasonId)) {
        throw new UserVisibleError("理由 ID 必须是数字。");
      }
      await env.DB.prepare("DELETE FROM rejection_reasons WHERE id = ?").bind(reasonId).run();
      await sendMessage(env, message.chat.id, `已删除驳回理由 #${reasonId}`);
      return;
    }
    case "add_blacklist": {
      requireArgument(args, "请在命令后面带上关键词，例如：/add_blacklist 赌博");
      const keyword = normalizeForMatch(args);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO blacklist_keywords (keyword, created_by) VALUES (?, ?)"
      )
        .bind(keyword, actor.id)
        .run();
      await sendMessage(env, message.chat.id, `已加入黑名单关键词：${keyword}`);
      return;
    }
    case "list_blacklist": {
      const keywords = await listBlacklistKeywords(env);
      const text =
        keywords.length === 0
          ? "当前黑名单关键词为空。"
          : ["黑名单关键词：", ...keywords.map((item) => `${item.id}. ${item.keyword}`)].join("\n");
      await sendMessage(env, message.chat.id, text);
      return;
    }
    case "del_blacklist": {
      requireArgument(args, "请提供要删除的关键词 ID，例如：/del_blacklist 3");
      const keywordId = Number.parseInt(args, 10);
      if (Number.isNaN(keywordId)) {
        throw new UserVisibleError("关键词 ID 必须是数字。");
      }
      await env.DB.prepare("DELETE FROM blacklist_keywords WHERE id = ?").bind(keywordId).run();
      await sendMessage(env, message.chat.id, `已删除黑名单关键词 #${keywordId}`);
      return;
    }
    case "add_admin": {
      if (!isSuperadmin) {
        throw new UserVisibleError("只有超级管理员可以添加管理员。");
      }
      requireArgument(args, "请提供管理员用户 ID，例如：/add_admin 123456789");
      const userId = Number.parseInt(args, 10);
      if (Number.isNaN(userId)) {
        throw new UserVisibleError("管理员用户 ID 必须是数字。");
      }
      await env.DB.prepare("INSERT OR REPLACE INTO admins (user_id, role) VALUES (?, 'admin')")
        .bind(userId)
        .run();
      await sendMessage(env, message.chat.id, `已添加管理员：${userId}`);
      return;
    }
    case "del_admin": {
      if (!isSuperadmin) {
        throw new UserVisibleError("只有超级管理员可以删除管理员。");
      }
      requireArgument(args, "请提供管理员用户 ID，例如：/del_admin 123456789");
      const userId = Number.parseInt(args, 10);
      if (Number.isNaN(userId)) {
        throw new UserVisibleError("管理员用户 ID 必须是数字。");
      }
      await env.DB.prepare("DELETE FROM admins WHERE user_id = ? AND role <> 'superadmin'")
        .bind(userId)
        .run();
      await sendMessage(env, message.chat.id, `已删除管理员：${userId}`);
      return;
    }
    default: {
      await sendMessage(env, message.chat.id, "未知指令。发送 /help 查看可用指令。");
    }
  }
}

async function handleCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  env: Env,
  config: AppConfig
): Promise<void> {
  const data = callbackQuery.data;
  const message = callbackQuery.message;

  if (!data || !message) {
    await answerCallbackQuery(env, callbackQuery.id);
    return;
  }

  try {
    if (data.startsWith(USER_CALLBACK_MODE)) {
      await handleUserModeCallback(callbackQuery, env);
      return;
    }

    if (!data.startsWith("a:")) {
      await answerCallbackQuery(env, callbackQuery.id, "未知操作。");
      return;
    }

    const actorId = callbackQuery.from.id;
    if (!(await actorIsAdmin(env, actorId, config))) {
      await answerCallbackQuery(env, callbackQuery.id, "你没有审核权限。", true);
      return;
    }

    const parts = data.split(":");
    const submissionId = Number.parseInt(parts[1] ?? "", 10);
    const action = parts[2] ?? "";
    const extra = parts[3] ?? "";

    if (Number.isNaN(submissionId)) {
      throw new UserVisibleError("投稿编号无效。");
    }

    const submission = await getSubmission(env, submissionId);
    if (!submission) {
      throw new UserVisibleError("找不到这条投稿。");
    }

    if (
      submission.status !== "pending" &&
      action !== "back"
    ) {
      await answerCallbackQuery(env, callbackQuery.id, "这条投稿已经处理完成。", true);
      return;
    }

    switch (action) {
      case "approve": {
        await editReplyMarkup(
          env,
          message.chat.id,
          message.message_id,
          buildApprovalMenuKeyboard(submissionId)
        );
        await answerCallbackQuery(env, callbackQuery.id, "请选择发送方式。");
        return;
      }
      case "reject": {
        const reasons = await listRejectionReasons(env);
        await editReplyMarkup(
          env,
          message.chat.id,
          message.message_id,
          buildRejectMenuKeyboard(submissionId, reasons)
        );
        await answerCallbackQuery(env, callbackQuery.id, "请选择驳回理由。");
        return;
      }
      case "back": {
        await editReplyMarkup(env, message.chat.id, message.message_id, buildInitialReviewKeyboard(submissionId));
        await answerCallbackQuery(env, callbackQuery.id, "已返回。");
        return;
      }
      case "publish": {
        await answerCallbackQuery(env, callbackQuery.id, "正在发送到频道…");
        await publishSubmission(env, submission, callbackQuery.from.id, null, config);
        return;
      }
      case "edit": {
        const prompt = await sendMessage(
          env,
          message.chat.id,
          `请回复这条消息发送修改后的内容。\n如果原稿带有媒体，这里只会替换频道里的文案，不会替换媒体文件。\n投稿编号：#${submissionId}`
        );
        await upsertAdminSession(
          env,
          callbackQuery.from.id,
          message.chat.id,
          "edit_submission",
          submissionId,
          prompt.message_id
        );
        await answerCallbackQuery(env, callbackQuery.id, "请回复刚才的提示消息。");
        return;
      }
      case "manual_reject": {
        const prompt = await sendMessage(
          env,
          message.chat.id,
          `请回复这条消息填写驳回理由。\n如果不想附带理由，请点“无理由驳回”。\n投稿编号：#${submissionId}`
        );
        await upsertAdminSession(
          env,
          callbackQuery.from.id,
          message.chat.id,
          "manual_reject_reason",
          submissionId,
          prompt.message_id
        );
        await answerCallbackQuery(env, callbackQuery.id, "请回复刚才的提示消息。");
        return;
      }
      case "reject_empty": {
        await answerCallbackQuery(env, callbackQuery.id, "正在驳回投稿…");
        await rejectSubmission(env, submission, callbackQuery.from.id, null);
        return;
      }
      case "reason": {
        const reasonId = Number.parseInt(extra, 10);
        if (Number.isNaN(reasonId)) {
          throw new UserVisibleError("驳回理由编号无效。");
        }
        const reason = await env.DB.prepare(
          "SELECT id, reason FROM rejection_reasons WHERE id = ? LIMIT 1"
        )
          .bind(reasonId)
          .first<RejectionReasonRow>();

        if (!reason) {
          throw new UserVisibleError("驳回理由不存在。");
        }

        await answerCallbackQuery(env, callbackQuery.id, "正在驳回投稿…");
        await rejectSubmission(env, submission, callbackQuery.from.id, reason.reason);
        return;
      }
      default: {
        await answerCallbackQuery(env, callbackQuery.id, "未知操作。");
      }
    }
  } catch (error) {
    const messageText = error instanceof UserVisibleError ? error.message : "操作失败，请稍后重试。";
    await answerCallbackQuery(env, callbackQuery.id, messageText, true);
  }
}

async function handleUserModeCallback(callbackQuery: TelegramCallbackQuery, env: Env): Promise<void> {
  const selection = callbackQuery.data?.split(":")[2];
  if (!callbackQuery.message) {
    await answerCallbackQuery(env, callbackQuery.id);
    return;
  }

  if (callbackQuery.message.chat.type !== "private") {
    await answerCallbackQuery(env, callbackQuery.id, "请在私聊里投稿。", true);
    return;
  }

  const displaySender = selection === "1" ? 1 : 0;
  await upsertUserSession(env, callbackQuery.from.id, "awaiting_submission", displaySender);
  await answerCallbackQuery(env, callbackQuery.id, "设置成功。");
  await sendMessage(
    env,
    callbackQuery.message.chat.id,
    displaySender
      ? "本次投稿会显示投稿人，请发送要投稿的内容。"
      : "本次投稿将匿名发送，请发送要投稿的内容。"
  );
}

async function handleUserSubmissionMessage(
  message: TelegramMessage,
  userSession: UserSessionRow,
  env: Env,
  config: AppConfig
): Promise<void> {
  const actor = message.from;
  if (!actor) {
    return;
  }

  if (message.chat.type !== "private") {
    await sendMessage(env, message.chat.id, "投稿只能在私聊里完成。");
    return;
  }

  const submissionPayload = extractSubmissionPayload(message);
  if (!submissionPayload) {
    await sendMessage(
      env,
      message.chat.id,
      "暂时只支持文字、图片、视频、文件投稿。请重新发送内容，或者发送 /cancel 取消。"
    );
    return;
  }

  const blacklistMatch = await findBlacklistMatch(env, submissionPayload.contentText);
  if (blacklistMatch) {
    await createSubmission(env, actor, message, userSession.display_sender, submissionPayload, "auto_rejected", blacklistMatch);
    await deleteUserSession(env, actor.id);
    await sendMessage(env, message.chat.id, "你的投稿命中了黑名单关键词，已被系统自动驳回。");
    return;
  }

  const submissionId = await createSubmission(
    env,
    actor,
    message,
    userSession.display_sender,
    submissionPayload,
    "pending",
    null
  );
  const submission = await getSubmission(env, submissionId);
  if (!submission) {
    throw new Error("Submission was created but could not be reloaded.");
  }

  const reviewMessage = await sendSubmissionToReviewChat(env, submission, config.reviewChatId);
  await env.DB.prepare(
    "UPDATE submissions SET review_chat_id = ?, review_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  )
    .bind(config.reviewChatId, reviewMessage.message_id, submission.id)
    .run();

  await deleteUserSession(env, actor.id);
  await sendMessage(env, message.chat.id, `投稿已提交，编号 #${submission.id}，请等待管理员审核。`);
}

async function handleAdminSessionMessage(
  message: TelegramMessage,
  adminSession: AdminSessionRow,
  env: Env,
  config: AppConfig
): Promise<void> {
  const actor = message.from;
  if (!actor) {
    return;
  }

  if (message.chat.id !== adminSession.chat_id) {
    return;
  }

  if (
    adminSession.prompt_message_id &&
    message.reply_to_message?.message_id !== adminSession.prompt_message_id
  ) {
    return;
  }

  const submission = await getSubmission(env, adminSession.submission_id);
  if (!submission) {
    await deleteAdminSession(env, actor.id);
    throw new UserVisibleError("找不到对应投稿。");
  }

  const rawText = (message.text ?? message.caption ?? "").trim();
  if (!rawText) {
    await sendMessage(env, message.chat.id, "请回复纯文字内容，或者发送 /cancel 取消当前操作。");
    return;
  }

  switch (adminSession.action) {
    case "manual_reject_reason": {
      await deleteAdminSession(env, actor.id);
      await rejectSubmission(env, submission, actor.id, rawText);
      return;
    }
    case "edit_submission": {
      await deleteAdminSession(env, actor.id);
      await publishSubmission(env, submission, actor.id, rawText, config);
      return;
    }
  }
}

async function submitFromMiniApp(
  env: Env,
  user: MiniAppUser,
  input: MiniAppSubmitInput,
  config: AppConfig
): Promise<{ submission: ReturnType<typeof serializeSubmission>; autoRejected: boolean; reason: string | null }> {
  const contentText = normalizeRequiredText(input.text, "请填写投稿正文。");
  const displaySender = input.displaySender === true ? 1 : 0;
  const payload: SubmissionPayload = {
    contentType: "text",
    contentText,
    mediaFileId: null,
    mediaUniqueId: null
  };
  const message = buildSyntheticSubmissionMessage(user, contentText);
  const blacklistMatch = await findBlacklistMatch(env, contentText);

  if (blacklistMatch) {
    const submissionId = await createSubmission(
      env,
      user,
      message,
      displaySender,
      payload,
      "auto_rejected",
      blacklistMatch
    );
    const submission = await mustGetSubmission(env, submissionId);
    await safelyRun("notify mini app auto rejection", () =>
      sendMessage(env, user.id, "你的投稿命中了黑名单关键词，已被系统自动驳回。").then(() => undefined)
    );

    return {
      submission: serializeSubmission(submission),
      autoRejected: true,
      reason: blacklistMatch
    };
  }

  const submissionId = await createSubmission(env, user, message, displaySender, payload, "pending", null);
  const submission = await mustGetSubmission(env, submissionId);
  const reviewMessage = await sendSubmissionToReviewChat(env, submission, config.reviewChatId);

  await env.DB.prepare(
    "UPDATE submissions SET review_chat_id = ?, review_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  )
    .bind(config.reviewChatId, reviewMessage.message_id, submission.id)
    .run();

  await safelyRun("notify mini app submission accepted", () =>
    sendMessage(env, user.id, `投稿已提交，编号 #${submission.id}，请等待管理员审核。`).then(() => undefined)
  );

  return {
    submission: serializeSubmission(await mustGetSubmission(env, submissionId)),
    autoRejected: false,
    reason: null
  };
}

function buildSyntheticSubmissionMessage(user: MiniAppUser, text: string): TelegramMessage {
  return {
    message_id: 0,
    from: user,
    chat: {
      id: user.id,
      type: "private"
    },
    text
  };
}

async function publishSubmission(
  env: Env,
  submission: SubmissionRow,
  reviewerId: number,
  editedText: string | null,
  config: AppConfig
): Promise<void> {
  const claim = await env.DB.prepare(
    "UPDATE submissions SET status = 'publishing', reviewed_by = ?, edited_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
  )
    .bind(reviewerId, editedText, submission.id)
    .run();

  if ((claim.meta.changes ?? 0) !== 1) {
    throw new UserVisibleError("这条投稿已经被其他管理员处理了。");
  }

  try {
    const publishedMessage = await publishToChannel(env, submission, editedText, config.targetChannelId);

    await env.DB.prepare(
      "UPDATE submissions SET status = 'published', published_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(publishedMessage.message_id, submission.id)
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE submissions SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(submission.id)
      .run();
    throw error;
  }

  await safelyRun("notify approval", () => notifyUserApproval(env, submission));
  await safelyRun("refresh review message after publish", () =>
    refreshReviewMessage(env, submission.id, "已发送到频道")
  );
}

async function rejectSubmission(
  env: Env,
  submission: SubmissionRow,
  reviewerId: number,
  reason: string | null
): Promise<void> {
  const result = await env.DB.prepare(
    "UPDATE submissions SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
  )
    .bind(reason, reviewerId, submission.id)
    .run();

  if ((result.meta.changes ?? 0) !== 1) {
    throw new UserVisibleError("这条投稿已经被其他管理员处理了。");
  }

  await safelyRun("notify rejection", () => notifyUserRejection(env, submission, reason));
  await safelyRun("refresh review message after rejection", () =>
    refreshReviewMessage(env, submission.id, reason ? `已驳回\n理由：${reason}` : "已驳回")
  );
}

async function publishToChannel(
  env: Env,
  submission: SubmissionRow,
  editedText: string | null,
  targetChannelId: number | string
): Promise<TelegramMessage> {
  const text = buildPublishedContent(submission, editedText);

  switch (submission.content_type) {
    case "text":
      return sendMessage(env, targetChannelId, text);
    case "photo":
      return telegramApi<TelegramMessage>(env, "sendPhoto", {
        chat_id: targetChannelId,
        photo: submission.media_file_id,
        caption: text || undefined
      });
    case "video":
      return telegramApi<TelegramMessage>(env, "sendVideo", {
        chat_id: targetChannelId,
        video: submission.media_file_id,
        caption: text || undefined
      });
    case "document":
      return telegramApi<TelegramMessage>(env, "sendDocument", {
        chat_id: targetChannelId,
        document: submission.media_file_id,
        caption: text || undefined
      });
  }
}

async function refreshReviewMessage(
  env: Env,
  submissionId: number,
  statusLine: string
): Promise<void> {
  const submission = await getSubmission(env, submissionId);
  if (!submission || submission.review_chat_id === null || submission.review_message_id === null) {
    return;
  }

  const text = formatReviewMessage(submission, statusLine);

  if (submission.content_type === "text") {
    await telegramApi(env, "editMessageText", {
      chat_id: submission.review_chat_id,
      message_id: submission.review_message_id,
      text
    });
    return;
  }

  await telegramApi(env, "editMessageCaption", {
    chat_id: submission.review_chat_id,
    message_id: submission.review_message_id,
    caption: text
  });
}

function buildPublishedContent(submission: SubmissionRow, editedText: string | null): string {
  const baseText = (editedText ?? submission.content_text ?? "").trim();
  const viaLine = submission.display_sender ? buildViaLine(submission) : "";
  const combined = viaLine ? [baseText, viaLine].filter(Boolean).join("\n\n") : baseText;
  const limit = submission.content_type === "text" ? 4096 : 1024;
  return truncateForTelegram(combined, limit);
}

function buildViaLine(submission: SubmissionRow): string {
  const name = submission.username ? `@${submission.username}` : submission.full_name;
  return `via.${name}`;
}

function formatReviewMessage(submission: SubmissionRow, statusLine = "待审核"): string {
  const header = [
    `【投稿审核 #${submission.id}】`,
    `状态：${statusLine}`,
    `投稿人：${submission.full_name}${submission.username ? ` (@${submission.username})` : ""}`,
    `署名：${submission.display_sender ? "显示" : "匿名"}`,
    `类型：${submission.content_type}`,
    "",
    "内容："
  ].join("\n");

  const contentFallback =
    submission.content_text?.trim() ||
    (submission.content_type === "text" ? "（空内容）" : "（用户没有附带文字说明）");
  const limit = submission.content_type === "text" ? 4096 : 1024;

  return truncateForTelegram(`${header}\n${contentFallback}`, limit);
}

async function sendSubmissionToReviewChat(
  env: Env,
  submission: SubmissionRow,
  reviewChatId: number
): Promise<TelegramMessage> {
  const reviewText = formatReviewMessage(submission);
  const replyMarkup = buildInitialReviewKeyboard(submission.id);

  switch (submission.content_type) {
    case "text":
      return sendMessage(env, reviewChatId, reviewText, replyMarkup);
    case "photo":
      return telegramApi<TelegramMessage>(env, "sendPhoto", {
        chat_id: reviewChatId,
        photo: submission.media_file_id,
        caption: reviewText,
        reply_markup: replyMarkup
      });
    case "video":
      return telegramApi<TelegramMessage>(env, "sendVideo", {
        chat_id: reviewChatId,
        video: submission.media_file_id,
        caption: reviewText,
        reply_markup: replyMarkup
      });
    case "document":
      return telegramApi<TelegramMessage>(env, "sendDocument", {
        chat_id: reviewChatId,
        document: submission.media_file_id,
        caption: reviewText,
        reply_markup: replyMarkup
      });
  }
}

async function notifyUserApproval(env: Env, submission: SubmissionRow): Promise<void> {
  await sendMessage(env, submission.user_chat_id, `你的投稿 #${submission.id} 已通过审核并发送到频道。`);
}

async function notifyUserRejection(
  env: Env,
  submission: SubmissionRow,
  reason: string | null
): Promise<void> {
  const text = reason
    ? `你的投稿 #${submission.id} 未通过审核。\n理由：${reason}`
    : `你的投稿 #${submission.id} 未通过审核。`;
  await sendMessage(env, submission.user_chat_id, text);
}

function extractSubmissionPayload(message: TelegramMessage): SubmissionPayload | null {
  if (message.text) {
    return {
      contentType: "text",
      contentText: message.text,
      mediaFileId: null,
      mediaUniqueId: null
    };
  }

  const caption = message.caption ?? null;

  if (message.photo && message.photo.length > 0) {
    const lastPhoto = message.photo[message.photo.length - 1];
    return {
      contentType: "photo",
      contentText: caption,
      mediaFileId: lastPhoto.file_id,
      mediaUniqueId: lastPhoto.file_unique_id
    };
  }

  if (message.video) {
    return {
      contentType: "video",
      contentText: caption,
      mediaFileId: message.video.file_id,
      mediaUniqueId: message.video.file_unique_id
    };
  }

  if (message.document) {
    return {
      contentType: "document",
      contentText: caption,
      mediaFileId: message.document.file_id,
      mediaUniqueId: message.document.file_unique_id
    };
  }

  return null;
}

async function createSubmission(
  env: Env,
  user: TelegramUser,
  message: TelegramMessage,
  displaySender: number,
  payload: SubmissionPayload,
  status: SubmissionStatus,
  rejectionReason: string | null
): Promise<number> {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "未命名用户";
  const result = await env.DB.prepare(
    `INSERT INTO submissions (
      user_id,
      user_chat_id,
      source_message_id,
      username,
      full_name,
      display_sender,
      content_type,
      content_text,
      media_file_id,
      media_unique_id,
      status,
      rejection_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      user.id,
      message.chat.id,
      message.message_id,
      user.username ?? null,
      fullName,
      displaySender,
      payload.contentType,
      payload.contentText,
      payload.mediaFileId,
      payload.mediaUniqueId,
      status,
      rejectionReason
    )
    .run();

  return Number(result.meta.last_row_id);
}

async function getSubmission(env: Env, submissionId: number): Promise<SubmissionRow | null> {
  return env.DB.prepare("SELECT * FROM submissions WHERE id = ? LIMIT 1")
    .bind(submissionId)
    .first<SubmissionRow>();
}

async function mustGetSubmission(env: Env, submissionId: number): Promise<SubmissionRow> {
  const submission = await getSubmission(env, submissionId);
  if (!submission) {
    throw new ApiError("找不到这条投稿。", 404);
  }

  return submission;
}

async function listSubmissions(
  env: Env,
  status: SubmissionStatus | "all" = "pending",
  limit = 50
): Promise<ReturnType<typeof serializeSubmission>[]> {
  const normalizedLimit = Math.min(Math.max(limit, 1), 100);

  if (status === "all") {
    const result = await env.DB.prepare(
      "SELECT * FROM submissions ORDER BY id DESC LIMIT ?"
    )
      .bind(normalizedLimit)
      .run<SubmissionRow>();
    return (result.results ?? []).map(serializeSubmission);
  }

  const result = await env.DB.prepare(
    "SELECT * FROM submissions WHERE status = ? ORDER BY id DESC LIMIT ?"
  )
    .bind(status, normalizedLimit)
    .run<SubmissionRow>();
  return (result.results ?? []).map(serializeSubmission);
}

function serializeSubmission(submission: SubmissionRow): {
  id: number;
  status: SubmissionStatus;
  contentType: SubmissionContentType;
  contentText: string;
  author: string;
  username: string | null;
  displaySender: boolean;
  rejectionReason: string | null;
  editedText: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: submission.id,
    status: submission.status,
    contentType: submission.content_type,
    contentText: submission.content_text ?? "",
    author: submission.full_name,
    username: submission.username,
    displaySender: submission.display_sender === 1,
    rejectionReason: submission.rejection_reason,
    editedText: submission.edited_text,
    createdAt: submission.created_at,
    updatedAt: submission.updated_at
  };
}

async function actorIsAdmin(env: Env, userId: number, config: AppConfig): Promise<boolean> {
  if (config.superadminIds.includes(userId)) {
    return true;
  }

  const row = await env.DB.prepare("SELECT user_id, role FROM admins WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<AdminRow>();
  return Boolean(row);
}

async function ensureSuperadmins(env: Env): Promise<void> {
  const ids = parseIntegerList(env.SUPERADMIN_IDS);
  if (ids.length === 0) {
    return;
  }

  const statement = env.DB.prepare("INSERT OR IGNORE INTO admins (user_id, role) VALUES (?, 'superadmin')");
  await env.DB.batch(ids.map((id) => statement.bind(id)));
}

async function listRejectionReasons(env: Env): Promise<RejectionReasonRow[]> {
  const result = await env.DB.prepare("SELECT id, reason FROM rejection_reasons ORDER BY id ASC")
    .run<RejectionReasonRow>();
  return result.results ?? [];
}

async function listBlacklistKeywords(env: Env): Promise<BlacklistKeywordRow[]> {
  const result = await env.DB.prepare("SELECT id, keyword FROM blacklist_keywords ORDER BY id ASC")
    .run<BlacklistKeywordRow>();
  return result.results ?? [];
}

async function findBlacklistMatch(env: Env, text: string | null): Promise<string | null> {
  if (!text) {
    return null;
  }

  const normalizedText = normalizeForMatch(text);
  const keywords = await listBlacklistKeywords(env);

  for (const keyword of keywords) {
    if (normalizedText.includes(keyword.keyword)) {
      return keyword.keyword;
    }
  }

  return null;
}

async function getUserSession(env: Env, userId: number): Promise<UserSessionRow | null> {
  return env.DB.prepare("SELECT user_id, action, display_sender FROM user_sessions WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<UserSessionRow>();
}

async function upsertUserSession(
  env: Env,
  userId: number,
  action: UserSessionAction,
  displaySender: number
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_sessions (user_id, action, display_sender)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       action = excluded.action,
       display_sender = excluded.display_sender,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(userId, action, displaySender)
    .run();
}

async function deleteUserSession(env: Env, userId: number): Promise<void> {
  await env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId).run();
}

async function getAdminSession(env: Env, adminId: number): Promise<AdminSessionRow | null> {
  return env.DB.prepare(
    "SELECT admin_id, chat_id, action, submission_id, prompt_message_id FROM admin_sessions WHERE admin_id = ? LIMIT 1"
  )
    .bind(adminId)
    .first<AdminSessionRow>();
}

async function upsertAdminSession(
  env: Env,
  adminId: number,
  chatId: number,
  action: AdminSessionAction,
  submissionId: number,
  promptMessageId: number
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO admin_sessions (admin_id, chat_id, action, submission_id, prompt_message_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(admin_id) DO UPDATE SET
       chat_id = excluded.chat_id,
       action = excluded.action,
       submission_id = excluded.submission_id,
       prompt_message_id = excluded.prompt_message_id,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(adminId, chatId, action, submissionId, promptMessageId)
    .run();
}

async function deleteAdminSession(env: Env, adminId: number): Promise<void> {
  await env.DB.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").bind(adminId).run();
}

async function clearActorSessions(env: Env, actorId: number): Promise<boolean> {
  const [userResult, adminResult] = await env.DB.batch([
    env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(actorId),
    env.DB.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").bind(actorId)
  ]);

  return (userResult.meta.changes ?? 0) > 0 || (adminResult.meta.changes ?? 0) > 0;
}

async function buildHelpText(env: Env, actorId: number, config: AppConfig): Promise<string> {
  const lines = [
    "用户指令：",
    "/submit - 开始投稿并选择是否显示投稿人",
    "/submit_show - 直接以显示投稿人的方式投稿",
    "/submit_hide - 直接匿名投稿",
    "/cancel - 取消当前投稿或审核输入",
    "/whoami - 查看自己的用户 ID 和当前聊天 ID"
  ];

  if (await actorIsAdmin(env, actorId, config)) {
    lines.push(
      "",
      "管理员指令：",
      "/add_reason <理由> - 添加固定驳回理由",
      "/list_reasons - 查看固定驳回理由",
      "/del_reason <ID> - 删除固定驳回理由",
      "/add_blacklist <关键词> - 添加黑名单关键词",
      "/list_blacklist - 查看黑名单关键词",
      "/del_blacklist <ID> - 删除黑名单关键词"
    );
  }

  if (config.superadminIds.includes(actorId)) {
    lines.push(
      "/add_admin <用户ID> - 添加管理员",
      "/del_admin <用户ID> - 删除管理员"
    );
  }

  return lines.join("\n");
}

function buildMiniAppLaunchKeyboard(config: AppConfig): InlineKeyboardMarkup | undefined {
  if (!config.miniAppUrl) {
    return undefined;
  }

  return {
    inline_keyboard: [[{ text: "打开投稿审核小程序", web_app: { url: config.miniAppUrl } }]]
  };
}

function buildUserSubmissionModeKeyboard(config: AppConfig): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];

  if (config.miniAppUrl) {
    rows.push([{ text: "打开投稿小程序", web_app: { url: config.miniAppUrl } }]);
  }

  rows.push([
    { text: "显示投稿人", callback_data: `${USER_CALLBACK_MODE}:1` },
    { text: "匿名投稿", callback_data: `${USER_CALLBACK_MODE}:0` }
  ]);

  return {
    inline_keyboard: rows
  };
}

function buildInitialReviewKeyboard(submissionId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "发送", callback_data: `a:${submissionId}:approve` },
        { text: "驳回", callback_data: `a:${submissionId}:reject` }
      ]
    ]
  };
}

function buildApprovalMenuKeyboard(submissionId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "直接发送", callback_data: `a:${submissionId}:publish` },
        { text: "修改后发送", callback_data: `a:${submissionId}:edit` }
      ],
      [{ text: "返回", callback_data: `a:${submissionId}:back` }]
    ]
  };
}

function buildRejectMenuKeyboard(
  submissionId: number,
  reasons: RejectionReasonRow[]
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = reasons.map((reason) => [
    { text: reason.reason, callback_data: `a:${submissionId}:reason:${reason.id}` }
  ]);

  rows.push([
    { text: "手动填写", callback_data: `a:${submissionId}:manual_reject` },
    { text: "无理由驳回", callback_data: `a:${submissionId}:reject_empty` }
  ]);
  rows.push([{ text: "返回", callback_data: `a:${submissionId}:back` }]);

  return { inline_keyboard: rows };
}

async function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<TelegramMessage> {
  return telegramApi<TelegramMessage>(env, "sendMessage", {
    chat_id: chatId,
    text: truncateForTelegram(text, 4096),
    reply_markup: replyMarkup
  });
}

async function answerCallbackQuery(
  env: Env,
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  await telegramApi(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  });
}

async function editReplyMarkup(
  env: Env,
  chatId: number,
  messageId: number,
  replyMarkup: InlineKeyboardMarkup
): Promise<void> {
  await telegramApi(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup
  });
}

async function authenticateMiniAppRequest(
  request: Request,
  env: Env,
  config: AppConfig
): Promise<MiniAppAuth> {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, ...rest] = authHeader.split(" ");
  const initData = rest.join(" ");

  if (scheme.toLowerCase() !== "tma" || !initData) {
    throw new ApiError("请从 Telegram 小程序入口打开。", 401);
  }

  const user = await validateMiniAppInitData(initData, getTelegramSecrets(env).TELEGRAM_BOT_TOKEN);
  const isAdmin = await actorIsAdmin(env, user.id, config);

  return {
    user,
    isAdmin,
    isSuperadmin: config.superadminIds.includes(user.id)
  };
}

async function validateMiniAppInitData(initData: string, botToken: string): Promise<MiniAppUser> {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const userJson = params.get("user");
  const authDateValue = params.get("auth_date");

  if (!receivedHash || !userJson || !authDateValue) {
    throw new ApiError("小程序登录信息不完整。", 401);
  }

  const authDate = Number.parseInt(authDateValue, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Number.isNaN(authDate) || now - authDate > MINI_APP_AUTH_MAX_AGE_SECONDS) {
    throw new ApiError("小程序登录已过期，请重新打开。", 401);
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = await signHmac("WebAppData", botToken);
  const expectedHash = bytesToHex(await signHmac(secretKey, dataCheckString));

  if (!constantTimeStringEqual(receivedHash, expectedHash)) {
    throw new ApiError("小程序登录校验失败。", 401);
  }

  const parsedUser = JSON.parse(userJson) as Partial<MiniAppUser>;
  if (!parsedUser.id || !parsedUser.first_name) {
    throw new ApiError("小程序用户信息无效。", 401);
  }

  return {
    id: parsedUser.id,
    is_bot: parsedUser.is_bot ?? false,
    first_name: parsedUser.first_name,
    last_name: parsedUser.last_name,
    username: parsedUser.username,
    language_code: parsedUser.language_code,
    is_premium: parsedUser.is_premium,
    photo_url: parsedUser.photo_url
  };
}

async function signHmac(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const rawKey = typeof key === "string" ? key : new Uint8Array(key);
  const digest = createHmac("sha256", rawKey).update(data).digest();
  return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
}

async function telegramApi<T>(
  env: Env,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const secrets = getTelegramSecrets(env);
  const response = await fetch(`https://api.telegram.org/bot${secrets.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error while calling ${method}`;
    throw new UserVisibleError(description);
  }

  return data.result;
}

function getConfig(env: Env): AppConfig {
  if (!env.REVIEW_CHAT_ID) {
    throw new Error("Missing REVIEW_CHAT_ID");
  }

  if (!env.TARGET_CHANNEL_ID) {
    throw new Error("Missing TARGET_CHANNEL_ID");
  }

  if (!env.SUPERADMIN_IDS) {
    throw new Error("Missing SUPERADMIN_IDS");
  }

  const reviewChatId = Number.parseInt(env.REVIEW_CHAT_ID, 10);
  if (Number.isNaN(reviewChatId)) {
    throw new Error("REVIEW_CHAT_ID must be a number");
  }

  return {
    reviewChatId,
    targetChannelId: normalizeChatId(env.TARGET_CHANNEL_ID),
    miniAppUrl: normalizeMiniAppUrl(env.MINI_APP_URL),
    superadminIds: parseIntegerList(env.SUPERADMIN_IDS)
  };
}

function normalizeMiniAppUrl(value: string | undefined): string | null {
  if (!value || value.includes("your-worker.workers.dev")) {
    return null;
  }

  return value;
}

function getTelegramSecrets(env: Env): TelegramSecrets {
  const secretEnv = env as Env & Partial<TelegramSecrets>;

  if (!secretEnv.TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN secret");
  }

  if (!secretEnv.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error("Missing TELEGRAM_WEBHOOK_SECRET secret");
  }

  return {
    TELEGRAM_BOT_TOKEN: secretEnv.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: secretEnv.TELEGRAM_WEBHOOK_SECRET
  };
}

function normalizeChatId(chatId: string): number | string {
  if (chatId.startsWith("@")) {
    return chatId;
  }

  const numeric = Number.parseInt(chatId, 10);
  return Number.isNaN(numeric) ? chatId : numeric;
}

function parseIntegerList(value: string): number[] {
  return value
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => !Number.isNaN(item));
}

function parseCommand(text?: string): { name: string; args: string } | null {
  if (!text?.startsWith("/")) {
    return null;
  }

  const [rawCommand, ...rest] = text.trim().split(/\s+/);
  const commandName = rawCommand.slice(1).split("@")[0]?.trim().toLowerCase();
  if (!commandName) {
    return null;
  }

  return {
    name: commandName,
    args: rest.join(" ").trim()
  };
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

function normalizeRequiredText(value: unknown, errorMessage: string): string {
  if (typeof value !== "string") {
    throw new ApiError(errorMessage);
  }

  const text = value.trim();
  if (!text) {
    throw new ApiError(errorMessage);
  }

  return text;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function normalizeSubmissionStatus(value: string | null): SubmissionStatus | "all" {
  const allowedStatuses: Array<SubmissionStatus | "all"> = [
    "pending",
    "publishing",
    "published",
    "rejected",
    "auto_rejected",
    "all"
  ];

  return allowedStatuses.includes(value as SubmissionStatus | "all")
    ? (value as SubmissionStatus | "all")
    : "pending";
}

function truncateForTelegram(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(limit - 1, 0)).trimEnd()}…`;
}

function serializeMiniAppUser(user: MiniAppUser): {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
} {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    photoUrl: user.photo_url
  };
}

function requireMiniAppAdmin(auth: MiniAppAuth): void {
  if (!auth.isAdmin) {
    throw new ApiError("你没有审核权限。", 403);
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("请求内容不是有效的 JSON。");
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function bytesToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeStringEqual(leftValue: string, rightValue: string): boolean {
  const left = new TextEncoder().encode(leftValue);
  const right = new TextEncoder().encode(rightValue);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function requireArgument(args: string, message: string): asserts args is string {
  if (!args.trim()) {
    throw new UserVisibleError(message);
  }
}

async function safelyRun(label: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: label,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

function renderMiniAppHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>投稿审核台</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7f8;
      --surface: #ffffff;
      --surface-strong: #eef3f2;
      --ink: #17201d;
      --muted: #64726d;
      --line: #d9e2df;
      --primary: #0f766e;
      --primary-strong: #0b5f59;
      --danger: #b42318;
      --warning: #a15c07;
      --focus: rgba(15, 118, 110, 0.18);
      --shadow: 0 14px 35px rgba(20, 31, 28, 0.08);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background:
        linear-gradient(135deg, rgba(15, 118, 110, 0.08), transparent 32%),
        linear-gradient(180deg, #ffffff 0%, var(--bg) 38%);
      color: var(--ink);
      min-height: 100vh;
    }

    button,
    textarea,
    input,
    select {
      font: inherit;
    }

    .shell {
      width: min(1120px, 100%);
      margin: 0 auto;
      padding: 18px 16px 26px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 14px;
    }

    .brand {
      min-width: 0;
    }

    .brand h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.15;
      letter-spacing: 0;
    }

    .brand p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .badge {
      border: 1px solid var(--line);
      background: var(--surface);
      border-radius: 999px;
      padding: 7px 10px;
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }

    .tabs {
      display: flex;
      gap: 8px;
      margin: 12px 0 16px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .tab {
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--muted);
      border-radius: 8px;
      padding: 9px 12px;
      cursor: pointer;
      white-space: nowrap;
    }

    .tab.active {
      background: var(--ink);
      border-color: var(--ink);
      color: #fff;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 0.92fr) minmax(340px, 1.08fr);
      gap: 14px;
      align-items: start;
    }

    .panel {
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 13px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--surface-strong);
    }

    .panel-header h2 {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0;
    }

    .panel-body {
      padding: 14px;
    }

    .field {
      display: grid;
      gap: 7px;
      margin-bottom: 12px;
    }

    .field label {
      color: var(--muted);
      font-size: 13px;
    }

    textarea,
    input,
    select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      padding: 10px 11px;
      outline: none;
    }

    textarea {
      resize: vertical;
      min-height: 180px;
      line-height: 1.55;
    }

    textarea:focus,
    input:focus,
    select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 4px var(--focus);
    }

    .switch-row,
    .toolbar,
    .item-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .switch-row {
      justify-content: space-between;
      padding: 10px 0;
    }

    .switch-row input {
      width: auto;
      transform: scale(1.1);
      accent-color: var(--primary);
    }

    .btn {
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 10px 12px;
      min-height: 39px;
      cursor: pointer;
      color: var(--ink);
      background: #fff;
      white-space: nowrap;
    }

    .btn.primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }

    .btn.primary:hover {
      background: var(--primary-strong);
    }

    .btn.danger {
      color: #fff;
      background: var(--danger);
      border-color: var(--danger);
    }

    .btn.ghost {
      border-color: var(--line);
      background: #fff;
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    .list {
      display: grid;
      gap: 8px;
    }

    .submission {
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 8px;
      padding: 11px;
      cursor: pointer;
    }

    .submission.active {
      border-color: var(--primary);
      box-shadow: 0 0 0 4px var(--focus);
    }

    .submission-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 7px;
      font-size: 14px;
      font-weight: 700;
    }

    .submission p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .status {
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
      background: var(--surface-strong);
      color: var(--muted);
      white-space: nowrap;
    }

    .status.pending {
      color: var(--warning);
      background: #fff4dc;
    }

    .status.published {
      color: var(--primary);
      background: #e6f5f2;
    }

    .status.rejected,
    .status.auto_rejected {
      color: var(--danger);
      background: #fee4e2;
    }

    .empty,
    .locked {
      border: 1px dashed var(--line);
      border-radius: 8px;
      color: var(--muted);
      padding: 24px;
      text-align: center;
      background: rgba(255, 255, 255, 0.7);
    }

    .message {
      margin: 12px 0 0;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      display: none;
    }

    .message.show {
      display: block;
    }

    .message.ok {
      background: #e6f5f2;
      color: var(--primary-strong);
    }

    .message.err {
      background: #fee4e2;
      color: var(--danger);
    }

    .rule-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }

    .rule-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      background: #fff;
      min-width: 0;
    }

    .rule-item span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .mobile-only {
      display: none;
    }

    @media (max-width: 760px) {
      .shell {
        padding: 14px 12px 20px;
      }

      .grid {
        grid-template-columns: 1fr;
      }

      .topbar {
        align-items: flex-start;
      }

      .brand h1 {
        font-size: 20px;
      }

      .badge {
        max-width: 46vw;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .mobile-only {
        display: inline;
      }
    }
  </style>
</head>
<body>
  <main class="shell" id="app"></main>
  <script>
    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
    if (tg) {
      tg.ready();
      tg.expand();
    }

    const state = {
      loading: true,
      busy: false,
      tab: "submit",
      selectedId: null,
      user: null,
      role: { isAdmin: false, isSuperadmin: false },
      submissions: [],
      reasons: [],
      blacklist: [],
      flash: null
    };

    const root = document.getElementById("app");
    const initData = tg && tg.initData ? tg.initData : "";

    function escapeHtml(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function statusLabel(status) {
      return {
        pending: "待审核",
        publishing: "发送中",
        published: "已发送",
        rejected: "已驳回",
        auto_rejected: "自动驳回"
      }[status] || status;
    }

    async function api(path, options) {
      const response = await fetch(path, {
        ...options,
        headers: {
          "authorization": "tma " + initData,
          "content-type": "application/json",
          ...(options && options.headers ? options.headers : {})
        }
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "请求失败");
      }
      return payload;
    }

    async function bootstrap() {
      if (!initData) {
        state.loading = false;
        state.flash = { type: "err", text: "请从 Telegram 小程序入口打开。" };
        render();
        return;
      }

      try {
        const payload = await api("/api/bootstrap");
        state.user = payload.user;
        state.role = payload.role;
        state.submissions = payload.submissions || [];
        state.reasons = payload.reasons || [];
        state.blacklist = payload.blacklist || [];
      } catch (error) {
        state.flash = { type: "err", text: error.message };
      } finally {
        state.loading = false;
        render();
      }
    }

    function render() {
      if (state.loading) {
        root.innerHTML = '<div class="locked">正在打开...</div>';
        return;
      }

      const username = state.user
        ? escapeHtml(state.user.username ? "@" + state.user.username : state.user.firstName)
        : "未登录";
      const tabs = state.role.isAdmin
        ? '<button class="tab ' + (state.tab === "submit" ? "active" : "") + '" data-action="tab" data-tab="submit">投稿</button>' +
          '<button class="tab ' + (state.tab === "review" ? "active" : "") + '" data-action="tab" data-tab="review">审核</button>' +
          '<button class="tab ' + (state.tab === "rules" ? "active" : "") + '" data-action="tab" data-tab="rules">规则</button>'
        : '<button class="tab active" data-action="tab" data-tab="submit">投稿</button>';
      const roleText = state.role.isAdmin ? "管理员" : "投稿人";

      root.innerHTML =
        '<div class="topbar">' +
          '<div class="brand"><h1>投稿审核台</h1><p>' + username + '</p></div>' +
          '<div class="badge">' + roleText + '</div>' +
        '</div>' +
        '<nav class="tabs">' + tabs + '</nav>' +
        renderFlash() +
        renderCurrentTab();
    }

    function renderFlash() {
      if (!state.flash) {
        return "";
      }
      return '<div class="message show ' + state.flash.type + '">' + escapeHtml(state.flash.text) + '</div>';
    }

    function renderCurrentTab() {
      if (state.tab === "review" && state.role.isAdmin) {
        return renderReview();
      }
      if (state.tab === "rules" && state.role.isAdmin) {
        return renderRules();
      }
      return renderSubmit();
    }

    function renderSubmit() {
      return '<section class="panel">' +
        '<div class="panel-header"><h2>新投稿</h2></div>' +
        '<div class="panel-body">' +
          '<div class="field"><label for="submitText">正文</label><textarea id="submitText" maxlength="3800" placeholder="输入新闻投稿正文"></textarea></div>' +
          '<label class="switch-row"><span>显示投稿人</span><input id="displaySender" type="checkbox"></label>' +
          '<button class="btn primary" data-action="submit" ' + (state.busy ? "disabled" : "") + '>提交审核</button>' +
        '</div>' +
      '</section>';
    }

    function renderReview() {
      const selected = state.submissions.find(function (item) { return item.id === state.selectedId; }) || state.submissions[0] || null;
      if (selected && state.selectedId !== selected.id) {
        state.selectedId = selected.id;
      }

      const list = state.submissions.length
        ? state.submissions.map(renderSubmissionItem).join("")
        : '<div class="empty">暂无待审核投稿</div>';

      return '<section class="grid">' +
        '<div class="panel">' +
          '<div class="panel-header"><h2>待审核</h2><button class="btn ghost" data-action="refresh">刷新</button></div>' +
          '<div class="panel-body"><div class="list">' + list + '</div></div>' +
        '</div>' +
        '<div class="panel">' +
          '<div class="panel-header"><h2>处理</h2>' + (selected ? '<span class="status pending">#' + selected.id + '</span>' : '') + '</div>' +
          '<div class="panel-body">' + renderSelectedSubmission(selected) + '</div>' +
        '</div>' +
      '</section>';
    }

    function renderSubmissionItem(item) {
      const active = item.id === state.selectedId ? " active" : "";
      return '<button class="submission' + active + '" data-action="select" data-id="' + item.id + '">' +
        '<div class="submission-title"><span>#' + item.id + ' ' + escapeHtml(item.author) + '</span><span class="status ' + item.status + '">' + statusLabel(item.status) + '</span></div>' +
        '<p>' + escapeHtml(item.contentText || "无正文") + '</p>' +
      '</button>';
    }

    function renderSelectedSubmission(item) {
      if (!item) {
        return '<div class="empty">选择一条投稿</div>';
      }

      const reasonOptions = ['<option value="">无理由驳回</option>']
        .concat(state.reasons.map(function (reason) {
          return '<option value="' + escapeHtml(reason.reason) + '">' + escapeHtml(reason.reason) + '</option>';
        }))
        .join("");

      return '<div class="field"><label>原文</label><textarea readonly>' + escapeHtml(item.contentText || "") + '</textarea></div>' +
        '<div class="field"><label for="editText">修改后文案</label><textarea id="editText" maxlength="3800">' + escapeHtml(item.contentText || "") + '</textarea></div>' +
        '<div class="toolbar">' +
          '<button class="btn primary" data-action="publish-direct" ' + (state.busy ? "disabled" : "") + '>直接发送</button>' +
          '<button class="btn primary" data-action="publish-edited" ' + (state.busy ? "disabled" : "") + '>修改后发送</button>' +
        '</div>' +
        '<hr style="border:0;border-top:1px solid var(--line);margin:16px 0">' +
        '<div class="field"><label for="reasonSelect">驳回理由</label><select id="reasonSelect">' + reasonOptions + '</select></div>' +
        '<div class="field"><label for="manualReason">手动理由</label><input id="manualReason" maxlength="300" placeholder="留空则使用上方选择"></div>' +
        '<button class="btn danger" data-action="reject" ' + (state.busy ? "disabled" : "") + '>驳回</button>';
    }

    function renderRules() {
      return '<section class="grid">' +
        '<div class="panel">' +
          '<div class="panel-header"><h2>驳回理由</h2></div>' +
          '<div class="panel-body">' +
            '<div class="item-row"><input id="newReason" placeholder="新增驳回理由"><button class="btn primary" data-action="add-reason">添加</button></div>' +
            '<div class="rule-list">' + renderRuleList(state.reasons, "delete-reason") + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="panel">' +
          '<div class="panel-header"><h2>黑名单</h2></div>' +
          '<div class="panel-body">' +
            '<div class="item-row"><input id="newKeyword" placeholder="新增关键词"><button class="btn primary" data-action="add-keyword">添加</button></div>' +
            '<div class="rule-list">' + renderRuleList(state.blacklist, "delete-keyword") + '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
    }

    function renderRuleList(items, action) {
      if (!items.length) {
        return '<div class="empty">暂无记录</div>';
      }
      return items.map(function (item) {
        const text = item.reason || item.keyword;
        return '<div class="rule-item"><span>' + escapeHtml(text) + '</span><button class="btn ghost" data-action="' + action + '" data-id="' + item.id + '">删除</button></div>';
      }).join("");
    }

    async function withBusy(action) {
      state.busy = true;
      state.flash = null;
      render();
      try {
        await action();
      } catch (error) {
        state.flash = { type: "err", text: error.message };
      } finally {
        state.busy = false;
        render();
      }
    }

    async function refreshPending() {
      const payload = await api("/api/submissions?status=pending");
      state.submissions = payload.submissions || [];
      if (!state.submissions.some(function (item) { return item.id === state.selectedId; })) {
        state.selectedId = state.submissions[0] ? state.submissions[0].id : null;
      }
    }

    root.addEventListener("click", function (event) {
      const target = event.target.closest("[data-action]");
      if (!target) {
        return;
      }

      const action = target.dataset.action;

      if (action === "tab") {
        state.tab = target.dataset.tab || "submit";
        state.flash = null;
        render();
        return;
      }

      if (action === "select") {
        state.selectedId = Number(target.dataset.id);
        render();
        return;
      }

      if (action === "refresh") {
        withBusy(async function () {
          await refreshPending();
          state.flash = { type: "ok", text: "已刷新" };
        });
        return;
      }

      if (action === "submit") {
        const text = document.getElementById("submitText").value;
        const displaySender = document.getElementById("displaySender").checked;
        withBusy(async function () {
          const payload = await api("/api/submissions", {
            method: "POST",
            body: JSON.stringify({ text: text, displaySender: displaySender })
          });
          state.flash = payload.autoRejected
            ? { type: "err", text: "已自动驳回：" + payload.reason }
            : { type: "ok", text: "已提交审核，编号 #" + payload.submission.id };
        });
        return;
      }

      if (action === "publish-direct" || action === "publish-edited") {
        const submissionId = state.selectedId;
        const editedText = action === "publish-edited" ? document.getElementById("editText").value : null;
        withBusy(async function () {
          await api("/api/submissions/" + submissionId + "/publish", {
            method: "POST",
            body: JSON.stringify({ editedText: editedText })
          });
          await refreshPending();
          state.flash = { type: "ok", text: "已发送到频道" };
        });
        return;
      }

      if (action === "reject") {
        const submissionId = state.selectedId;
        const manualReason = document.getElementById("manualReason").value.trim();
        const selectedReason = document.getElementById("reasonSelect").value;
        withBusy(async function () {
          await api("/api/submissions/" + submissionId + "/reject", {
            method: "POST",
            body: JSON.stringify({ reason: manualReason || selectedReason || null })
          });
          await refreshPending();
          state.flash = { type: "ok", text: "已驳回" };
        });
        return;
      }

      if (action === "add-reason") {
        const reason = document.getElementById("newReason").value;
        withBusy(async function () {
          const payload = await api("/api/reasons", {
            method: "POST",
            body: JSON.stringify({ reason: reason })
          });
          state.reasons = payload.reasons || [];
          state.flash = { type: "ok", text: "已添加驳回理由" };
        });
        return;
      }

      if (action === "delete-reason") {
        withBusy(async function () {
          const payload = await api("/api/reasons/" + target.dataset.id, { method: "DELETE" });
          state.reasons = payload.reasons || [];
          state.flash = { type: "ok", text: "已删除驳回理由" };
        });
        return;
      }

      if (action === "add-keyword") {
        const keyword = document.getElementById("newKeyword").value;
        withBusy(async function () {
          const payload = await api("/api/blacklist", {
            method: "POST",
            body: JSON.stringify({ keyword: keyword })
          });
          state.blacklist = payload.blacklist || [];
          state.flash = { type: "ok", text: "已添加关键词" };
        });
        return;
      }

      if (action === "delete-keyword") {
        withBusy(async function () {
          const payload = await api("/api/blacklist/" + target.dataset.id, { method: "DELETE" });
          state.blacklist = payload.blacklist || [];
          state.flash = { type: "ok", text: "已删除关键词" };
        });
      }
    });

    bootstrap();
  </script>
</body>
</html>`;
}

function isValidWebhookRequest(request: Request, secret: string): boolean {
  const headerValue = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!headerValue || !secret) {
    return false;
  }

  const left = new TextEncoder().encode(headerValue);
  const right = new TextEncoder().encode(secret);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
