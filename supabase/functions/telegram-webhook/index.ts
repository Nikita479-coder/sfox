import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.2";

type TelegramUpdate = {
  message?: {
    chat: { id: number; type?: string };
    text?: string;
    from?: { id: number; username?: string; first_name?: string };
    new_chat_members?: Array<{ id: number; username?: string; first_name?: string }>;
  };
  chat_member?: {
    chat: { id: number; type?: string };
    from?: { id: number; username?: string; first_name?: string };
    new_chat_member?: {
      user?: { id: number; username?: string; first_name?: string };
      status?: string;
      tag?: string;
    };
  };
  my_chat_member?: {
    chat: { id: number; type?: string };
    new_chat_member?: {
      status?: string;
      can_manage_tags?: boolean;
    };
  };
};

const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const miniAppUrl = Deno.env.get("TELEGRAM_MINI_APP_URL") ?? "https://sfox-8qc.pages.dev/";
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
    .select("invite_code, telegram_first_name, username, current_rank")
    .eq("telegram_user_id", String(telegramUserId))
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function rememberGroupMember(
  chatId: number,
  user: { id: number; username?: string; first_name?: string } | null | undefined
) {
  if (!supabase || !user?.id) return;

  const payload = {
    chat_id: String(chatId),
    telegram_user_id: String(user.id),
    username: user.username || null,
    first_name: user.first_name || null,
    last_seen_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("telegram_group_members")
    .upsert(payload, { onConflict: "chat_id,telegram_user_id" });

  if (error) throw error;
}

function formatRankTag(rank: string | null | undefined) {
  const normalized = String(rank || "miner").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function getChatMember(chatId: number, userId: number) {
  return telegramCall("getChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
}

async function setChatMemberTag(chatId: number, userId: number, tag: string) {
  return telegramCall("setChatMemberTag", {
    chat_id: chatId,
    user_id: userId,
    tag,
  });
}

async function syncMemberRankTag(chatId: number, userId: number) {
  const profile = await getProfileByTelegramId(userId);
  if (!profile?.current_rank) {
    return { ok: true, reason: "missing_profile" as const };
  }

  const member = await getChatMember(chatId, userId);
  const existingTag = String(member?.tag || "").trim();
  if (existingTag) {
    return { ok: true, reason: "existing_tag" as const, tag: existingTag };
  }

  const rankTag = formatRankTag(profile.current_rank);
  if (!rankTag) {
    return { ok: true, reason: "missing_rank" as const };
  }

  await setChatMemberTag(chatId, userId, rankTag);

  if (supabase) {
    await supabase
      .from("telegram_group_members")
      .update({
        tagged_at: new Date().toISOString(),
      })
      .eq("chat_id", String(chatId))
      .eq("telegram_user_id", String(userId));
  }

  return { ok: true, reason: "tag_set" as const, tag: rankTag };
}

async function isChatAdmin(chatId: number, userId: number) {
  const member = await getChatMember(chatId, userId);
  const status = String(member?.status || "");
  return status === "administrator" || status === "creator";
}

async function syncKnownGroupMembers(chatId: number) {
  if (!supabase) {
    return { total: 0, tagged: 0, existing: 0, missing: 0 };
  }

  const { data, error } = await supabase
    .from("telegram_group_members")
    .select("telegram_user_id")
    .eq("chat_id", String(chatId))
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  let tagged = 0;
  let existing = 0;
  let missing = 0;

  for (const entry of data || []) {
    const userId = Number(entry.telegram_user_id);
    if (!userId) continue;

    try {
      const result = await syncMemberRankTag(chatId, userId);
      if (result.reason === "tag_set") tagged += 1;
      else if (result.reason === "existing_tag") existing += 1;
      else missing += 1;
    } catch (error) {
      console.error("Bulk tag sync failed for member", userId, error);
    }
  }

  return {
    total: (data || []).length,
    tagged,
    existing,
    missing,
  };
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
    const chatMemberUpdate = update.chat_member;
    if (chatMemberUpdate?.chat?.id && chatMemberUpdate.new_chat_member?.user?.id) {
      const memberStatus = String(chatMemberUpdate.new_chat_member.status || "");
      await rememberGroupMember(chatMemberUpdate.chat.id, chatMemberUpdate.new_chat_member.user);
      if (memberStatus !== "left" && memberStatus !== "kicked") {
        await syncMemberRankTag(
          chatMemberUpdate.chat.id,
          chatMemberUpdate.new_chat_member.user.id
        );
      }

      return json({ ok: true, handled: "chat_member_tag_sync" });
    }

    const selfUpdate = update.my_chat_member;
    if (selfUpdate?.chat?.id) {
      return json({
        ok: true,
        handled: "my_chat_member",
        can_manage_tags: Boolean(selfUpdate.new_chat_member?.can_manage_tags),
      });
    }

    const message = update.message;
    if (!message) {
      return json({ ok: true, ignored: true });
    }

    const chatId = message.chat.id;
    const chatType = message.chat.type || "private";
    const sender = message.from;

    if (chatType !== "private" && sender?.id) {
      try {
        await rememberGroupMember(chatId, sender);
      } catch (error) {
        console.error("Group member remember failed", error);
      }

      try {
        await syncMemberRankTag(chatId, sender.id);
      } catch (error) {
        console.error("Group member tag sync failed", error);
      }
    }

    if (message.new_chat_members?.length) {
      for (const member of message.new_chat_members) {
        try {
          await rememberGroupMember(chatId, member);
        } catch (error) {
          console.error("New member remember failed", error);
        }

        try {
          await syncMemberRankTag(chatId, member.id);
        } catch (error) {
          console.error("New member tag sync failed", error);
        }
      }
    }

    if (!message.text) {
      return json({ ok: true, ignored: true });
    }

    const { command, payload } = parseCommand(message.text);
    const isCommand = message.text.trim().startsWith("/");

    if (chatType !== "private" && !isCommand) {
      return json({ ok: true, ignored: "non_command_group_message" });
    }

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

    if (command === "synctag" || command === "synctags") {
      if (!sender?.id) {
        return json({ ok: true, handled: "missing_sender" });
      }

      if (chatType !== "private" && (await isChatAdmin(chatId, sender.id))) {
        const summary = await syncKnownGroupMembers(chatId);
        await sendMessage(
          chatId,
          `TYRA tag sync finished.\n\nSeen members: <b>${summary.total}</b>\nNew tags set: <b>${summary.tagged}</b>\nAlready tagged: <b>${summary.existing}</b>\nMissing TYRA profile: <b>${summary.missing}</b>`
        );
        return json({ ok: true, handled: "synctag_bulk", summary });
      }

      const result = await syncMemberRankTag(chatId, sender.id);
      const syncText =
        result.reason === "existing_tag"
          ? `You already have a member tag: <b>${result.tag}</b>.`
          : result.reason === "tag_set"
            ? `Your TYRA member tag is now <b>${result.tag}</b>.`
            : "No TYRA profile was found to sync a rank tag yet.";

      await sendMessage(chatId, syncText);
      return json({ ok: true, handled: "synctag", result });
    }

    await sendMessage(
      chatId,
      "Use /app to open Satyra, /invite for your referral page, /protocol for network state, or /synctag to sync your group tag.",
      webAppKeyboard("Open Satyra", buildAppUrl("news"))
    );

    return json({ ok: true, handled: "fallback" });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
