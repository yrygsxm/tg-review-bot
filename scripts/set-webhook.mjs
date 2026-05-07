const token = process.env.TELEGRAM_BOT_TOKEN;
const workerUrl = process.env.WORKER_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

if (!workerUrl) {
  console.error("Missing WORKER_URL");
  process.exit(1);
}

if (!secret) {
  console.error("Missing TELEGRAM_WEBHOOK_SECRET");
  process.exit(1);
}

const baseUrl = workerUrl.replace(/\/+$/, "");
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify({
    url: `${baseUrl}/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true
  })
});

const payload = await response.json();

if (!response.ok || !payload.ok) {
  console.error("Failed to register webhook:");
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log("Webhook registered successfully.");
console.log(JSON.stringify(payload.result, null, 2));
