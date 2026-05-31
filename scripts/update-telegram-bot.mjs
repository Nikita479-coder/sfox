import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const content = fs.readFileSync(filePath, "utf8");
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  return entries;
}

const workspaceRoot = process.cwd();
const env = {
  ...loadEnvFile(path.join(workspaceRoot, ".env")),
  ...process.env,
};

const botToken = env.TELEGRAM_BOT_TOKEN || env.Telegram_BOT_TOKEN;

if (!botToken) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN in .env or process environment.");
}

async function callTelegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${data.description || "Unknown Telegram error"}`);
  }

  return data.result;
}

const bot = await callTelegram("getMe");
const currentMenuButton = await callTelegram("getChatMenuButton");

const miniAppUrl =
  env.TELEGRAM_MINI_APP_URL ||
  env.VITE_TELEGRAM_MINI_APP_URL ||
  currentMenuButton?.web_app?.url;
const derivedWebhookUrl = env.VITE_SUPABASE_URL
  ? `${String(env.VITE_SUPABASE_URL).replace(/\/+$/, "")}/functions/v1/telegram-webhook`
  : "";
const webhookUrl = env.TELEGRAM_WEBHOOK_URL || derivedWebhookUrl;

if (!miniAppUrl) {
  throw new Error(
    "Missing TELEGRAM_MINI_APP_URL and no existing Telegram Web App URL was found on the bot."
  );
}

await callTelegram("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: "Satyra",
    web_app: {
      url: miniAppUrl,
    },
  },
});

await callTelegram("setMyCommands", {
  commands: [
    { command: "start", description: "Open Satyra and continue onboarding" },
    { command: "app", description: "Launch the Satyra Mini App" },
    { command: "invite", description: "Open your referral team and invite flow" },
    { command: "leaderboard", description: "Open the global leaderboard" },
    { command: "protocol", description: "Open protocol supply and epoch state" },
  ],
});

await callTelegram("setMyShortDescription", {
  short_description: "Mine TYRA, invite your team, and climb the leaderboard.",
});

await callTelegram("setMyDescription", {
  description:
    "Satyra is a Telegram Mini App for mining, referrals, rank growth, leaderboard tracking, and future mainnet migration.",
});

if (webhookUrl) {
  await callTelegram("setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      bot: {
        username: bot.username,
        first_name: bot.first_name,
      },
      menu_button: {
        text: "Satyra",
        url: miniAppUrl,
      },
      webhook_url: webhookUrl || null,
      commands: ["start", "app", "invite", "leaderboard", "protocol"],
    },
    null,
    2
  )
);
