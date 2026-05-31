import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.2";

type TelegramUpdate = {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string; first_name?: string };
  };
};

const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const miniAppUrl = Deno.env.get("TELEGRAM_MINI_APP_URL") ?? "https://Satyra-8qc.pages.dev/";
const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "tyranetworkbot";

const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    : null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function telegramCall(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || `${method} failed`);
  }

  return data.result;
}

function parseCommand(text: string) {
  const [rawCommand, ...rest] = text.trim().split(/\s+/);
  const command = rawCommand.replace(/^\/+/, "").split("@")[0].toLowerCase();
  const payload = rest.join(" ").trim();
  return { command, payload };
}

function buildAppUrl(tab?: string) {
  if (!tab) return miniAppUrl;
  const url = new URL(miniAppUrl);
  url.searchParams.set("tab", tab);
  return url.toString();
}

function buildDeepLink(startapp: string) {
  return `https://t.me/${botUsername}?startapp=${encodeURIComponent(startapp)}`;
}

async function getInviterByCode(code: string) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("username, telegram_first_name")
    .eq("invite_code", code)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return data.telegram_first_name?.trim() || data.username;
}

async function getProfileByTelegramId(telegramUserId: number) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("invite_code, telegram_first_name, username")
    .eq("telegram_user_id", String(telegramUserId))
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
) {
  return telegramCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}

function webAppKeyboard(text: string, url: string) {
  return {
    inline_keyboard: [[{ text, web_app: { url } }]],
  };
}

function linkKeyboard(text: string, url: string) {
  return {
    inline_keyboard: [[{ text, url }]],
  };
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return json({ ok: true, bot: botUsername, mini_app_url: miniAppUrl });
  }

  if (!botToken) {
    return json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" }, 500);
  }

  try {
    const update = (await request.json()) as TelegramUpdate;
    const message = update.message;
    if (!message?.text) {
      return json({ ok: true, ignored: true });
    }

    const { command, payload } = parseCommand(message.text);
    const chatId = message.chat.id;
    const sender = message.from;

    if (command === "start") {
      const referralPayload = payload || "";
      if (/^ref[-_:]/i.test(referralPayload)) {
        const referralCode = referralPayload.replace(/^ref[-_:]?/i, "").trim().toUpperCase();
        const inviterName = await getInviterByCode(referralCode);
        const inviteLine = inviterName
          ? `<b>${inviterName}</b> invited you to join Satyra.`
          : "You were invited to join Satyra.";

        await sendMessage(
          chatId,
          `${inviteLine}\n\nTap below to open the Mini App and the referral will be attached automatically.`,
          linkKeyboard("Open Satyra", buildDeepLink(`ref-${referralCode}`))
        );

        return json({ ok: true, handled: "start_referral" });
      }

      await sendMessage(
        chatId,
        "Welcome to Satyra.\n\nMine daily, grow your team, and track your rank inside the Mini App.",
        webAppKeyboard("Open Satyra", buildAppUrl("news"))
      );

      return json({ ok: true, handled: "start" });
    }

    if (command === "app") {
      await sendMessage(
        chatId,
        "Open the Satyra Mini App.",
        webAppKeyboard("Open Satyra", buildAppUrl("news"))
      );
      return json({ ok: true, handled: "app" });
    }

    if (command === "invite") {
      const profile = sender ? await getProfileByTelegramId(sender.id) : null;
      const inviteText = profile?.invite_code
        ? `Your TYRA invite code is <b>${profile.invite_code}</b>.\n\nUse the button below to open the Referral Team page, or share your referral link:\n${buildDeepLink(`ref-${profile.invite_code}`)}`
        : "Open the Referral Team page to get your invite code and referral link.";

      await sendMessage(
        chatId,
        inviteText,
        webAppKeyboard("Open Referral Team", buildAppUrl("referrals"))
      );
      return json({ ok: true, handled: "invite" });
    }

    if (command === "protocol") {
      await sendMessage(
        chatId,
        "Open the live Satyra protocol state and supply tracking.",
        webAppKeyboard("Open Protocol", buildAppUrl("protocol"))
      );
      return json({ ok: true, handled: "protocol" });
    }

    await sendMessage(
      chatId,
      "Use /app to open Satyra, /invite for your referral page, or /protocol for network state.",
      webAppKeyboard("Open Satyra", buildAppUrl("news"))
    );

    return json({ ok: true, handled: "fallback" });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
