import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

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

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const apiId = Number(env.TELEGRAM_API_ID || 0);
const apiHash = env.TELEGRAM_API_HASH || "";
const configuredTargets = String(env.TELEGRAM_IMPORT_TARGETS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const sessionFilePath = path.join(workspaceRoot, ".telegram-session");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

if (!apiId || !apiHash) {
  throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function loadSessionString() {
  if (env.TELEGRAM_SESSION) return env.TELEGRAM_SESSION;
  if (fs.existsSync(sessionFilePath)) {
    return fs.readFileSync(sessionFilePath, "utf8").trim();
  }
  return "";
}

async function createTelegramClient() {
  const rl = readline.createInterface({ input, output });
  const stringSession = new StringSession(loadSessionString());
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => rl.question("Telegram phone number: "),
    password: async () => rl.question("Two-step password (leave blank if none): "),
    phoneCode: async () => rl.question("Telegram login code: "),
    onError: (error) => {
      throw error;
    },
  });

  const savedSession = client.session.save();
  if (savedSession) {
    fs.writeFileSync(sessionFilePath, String(savedSession), "utf8");
  }

  rl.close();
  return client;
}

function toChatId(value) {
  const raw = String(value).trim();
  if (/^-?\d+$/.test(raw)) return raw;
  return raw;
}

async function importGroupMembers(client, target) {
  const entity = await client.getEntity(target);
  const participants = await client.getParticipants(entity, {});
  const chatId =
    "id" in entity && entity.id !== undefined ? String(entity.id) : String(toChatId(target));
  const title =
    "title" in entity && entity.title ? String(entity.title) : ("username" in entity ? entity.username : null);

  const rows = participants
    .filter((participant) => participant?.id)
    .map((participant) => ({
      chat_id: chatId,
      telegram_user_id: String(participant.id),
      username: participant.username || null,
      first_name: participant.firstName || participant.first_name || null,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

  const batchSize = 500;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase
      .from("telegram_group_members")
      .upsert(batch, { onConflict: "chat_id,telegram_user_id" });

    if (error) throw error;
  }

  return {
    target,
    chatId,
    title: title || null,
    imported: rows.length,
  };
}

async function resolveTargets() {
  if (configuredTargets.length) return configuredTargets;

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    "Enter group usernames or chat ids separated by commas (example: @groupone,-1001234567890): "
  );
  rl.close();

  return answer
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function main() {
  const targets = await resolveTargets();
  if (!targets.length) {
    throw new Error("No Telegram import targets provided.");
  }

  const client = await createTelegramClient();

  try {
    const results = [];
    for (const target of targets) {
      const result = await importGroupMembers(client, target);
      results.push(result);
      console.log(
        `[telegram-import] ${result.target} -> imported ${result.imported} members into chat ${result.chatId}`
      );
    }

    console.log(JSON.stringify({ ok: true, importedGroups: results }, null, 2));
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error("[telegram-import] failed", error);
  process.exitCode = 1;
});
