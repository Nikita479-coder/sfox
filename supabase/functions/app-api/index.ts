import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.2";

const SESSION_HOURS = 24;
const HALVING_DAYS = 14;
const NETWORK_START_AT = "2026-06-01T00:00:00Z";
const EARLY_ADOPTER_END_AT = "2026-07-01T00:00:00Z";
const rankOrder: Record<string, number> = {
  miner: 0,
  pioneer: 1,
  lord: 2,
  baron: 3,
  president: 4,
  titan: 5,
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "Satyranetworkbot";
const adminAllowlist = String(Deno.env.get("Satyra_ADMIN_USERNAMES") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function telegramCall(method: string, payload: Record<string, unknown>) {
  if (!botToken) return null;

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

async function sendTelegramMessage(chatId: string | number, text: string) {
  if (!botToken || !chatId) return null;

  return telegramCall("sendMessage", {
    chat_id: chatId,
    text,
  });
}

function buildTelegramReferralLink(inviteCode: string) {
  return `https://t.me/${botUsername}?startapp=ref-${encodeURIComponent(String(inviteCode || "").trim())}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyTelegramInitData(initData: string) {
  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new Error("Missing Telegram hash");
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const calculated = hex(await hmacSha256(secret, dataCheckString));

  if (calculated !== hash) {
    throw new Error("Invalid Telegram initData signature");
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    throw new Error("Missing Telegram user");
  }

  const user = JSON.parse(userRaw);
  const startParam = params.get("start_param") || params.get("startapp") || "";

  return {
    telegramUserId: String(user.id),
    username: sanitizeUsername(user.username) || `tg${user.id}`,
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    photoUrl: user.photo_url || "",
    languageCode: user.language_code || "",
    isPremium: Boolean(user.is_premium),
    startParam,
  };
}

function sanitizeFallbackIdentity(identity: any) {
  const telegramUserId = String(identity?.telegramUserId || "").trim();
  const username = sanitizeUsername(identity?.username) || "";

  if (!telegramUserId || !username) {
    throw new Error("Missing Telegram identity");
  }

  return {
    telegramUserId,
    username,
    firstName: String(identity?.firstName || ""),
    lastName: String(identity?.lastName || ""),
    photoUrl: String(identity?.photoUrl || ""),
    languageCode: String(identity?.languageCode || ""),
    isPremium: Boolean(identity?.isPremium),
    startParam: String(identity?.startParam || ""),
  };
}

function sanitizeUsername(username: string) {
  return String(username || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 32);
}

function buildInviteCode(username: string, telegramUserId: string) {
  const baseName = sanitizeUsername(username).toUpperCase() || "MINER";
  const idTail = String(telegramUserId || "0000").slice(-4).toUpperCase();
  return `TYRA-${baseName.slice(0, 8)}-${idTail}`;
}

function isEarlyAdopterDate(value?: string | number | Date | null) {
  const source = value ? new Date(value).getTime() : Date.now();
  const start = new Date(NETWORK_START_AT).getTime();
  const end = new Date(EARLY_ADOPTER_END_AT).getTime();

  if (Number.isNaN(source)) return false;
  return source < end && source >= start || source < start;
}

function parseReferralStartParam(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^ref[-_:]?/i, "").trim().toUpperCase();
}

function getEligibleRank(activeReferrals: number, joinedEarly: boolean) {
  if (activeReferrals >= 500) return "titan";
  if (activeReferrals >= 100) return "president";
  if (activeReferrals >= 50) return "baron";
  if (activeReferrals >= 10) return "lord";
  if (joinedEarly) return "pioneer";
  return "miner";
}

function getHigherRank(leftRank: string, rightRank: string) {
  return (rankOrder[leftRank] ?? 0) >= (rankOrder[rightRank] ?? 0) ? leftRank : rightRank;
}

function getGlobalEpoch(now = Date.now()) {
  const start = new Date(NETWORK_START_AT).getTime();
  const halvingMs = HALVING_DAYS * 24 * 60 * 60 * 1000;
  if (now <= start) return 0;
  return Math.max(0, Math.floor((now - start) / halvingMs));
}

function getBaseRate(epoch: number) {
  return 1 / 2 ** Math.max(0, epoch);
}

function getRankConfig(rankKey: string) {
  const rankMap: Record<string, { boost: number; referralRate: number }> = {
    miner: { boost: 1, referralRate: 0 },
    pioneer: { boost: 1.5, referralRate: 0.1 },
    lord: { boost: 5, referralRate: 0.12 },
    baron: { boost: 15, referralRate: 0.15 },
    president: { boost: 30, referralRate: 0.2 },
    titan: { boost: 50, referralRate: 0.25 },
  };

  return rankMap[rankKey] || rankMap.miner;
}

function getLiveMiningRate(rankKey: string, joinedEarly: boolean, activeReferrals: number, epoch: number) {
  const rank = getRankConfig(rankKey);
  const pioneerLifetimeBonus =
    joinedEarly && rankKey !== "miner" && rankKey !== "pioneer"
      ? getRankConfig("pioneer").boost
      : 0;
  const fixedMultiplier = rank.boost + pioneerLifetimeBonus;
  const referralFactor = 1 + rank.referralRate * activeReferrals;
  return getBaseRate(epoch) * fixedMultiplier * referralFactor;
}

function getSessionEndMs(miningStartedAt?: string | null) {
  if (!miningStartedAt) return null;
  const startedAt = new Date(miningStartedAt).getTime();
  if (Number.isNaN(startedAt)) return null;
  return startedAt + SESSION_HOURS * 60 * 60 * 1000;
}

function calculateAccrualProgress(profile: any, nowMs: number) {
  const sessionEndMs = getSessionEndMs(profile.mining_started_at);
  if (!profile?.mining_started_at || profile.session_claimed || !sessionEndMs) {
    return {
      sessionAccrued: Number(profile?.session_accrued || 0),
      sessionAccrualUpdatedAt: profile?.session_accrual_updated_at || profile?.mining_started_at || null,
    };
  }

  const startedAtMs = new Date(profile.mining_started_at).getTime();
  const anchorMs = profile.session_accrual_updated_at
    ? new Date(profile.session_accrual_updated_at).getTime()
    : startedAtMs;
  const safeAnchorMs = Number.isNaN(anchorMs) ? startedAtMs : anchorMs;
  const cutoffMs = Math.min(nowMs, sessionEndMs);
  const elapsedHours = Math.max(0, cutoffMs - safeAnchorMs) / 3600000;
  const additionalAmount = Number(profile.current_rate || 0) * elapsedHours;

  return {
    sessionAccrued: Number(profile.session_accrued || 0) + additionalAmount,
    sessionAccrualUpdatedAt: new Date(cutoffMs).toISOString(),
  };
}

function isReferralProfileActivelyMining(profile: { mining_started_at?: string | null }) {
  if (!profile?.mining_started_at) return false;
  const startedAt = new Date(profile.mining_started_at).getTime();
  if (Number.isNaN(startedAt)) return false;
  return Date.now() < startedAt + SESSION_HOURS * 60 * 60 * 1000;
}

function mapReferralRow(row: any) {
  const effectiveActive = row.referred_profile
    ? isReferralProfileActivelyMining(row.referred_profile)
    : row.is_active;

  return {
    id: row.id,
    username: row.referred_username,
    rank: row.referred_rank,
    is_active: effectiveActive,
    last_reminded_at: row.last_reminded_at,
  };
}

function buildReferralSummary(referrals: Array<{ is_active: boolean }>) {
  return {
    totalReferrals: referrals.length,
    activeReferrals: referrals.filter((entry) => entry.is_active).length,
  };
}

function formatPublishedLabel(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function mapAnnouncementRow(row: any) {
  return {
    slug: row.slug,
    eyebrow: row.eyebrow,
    title: row.title,
    body: row.body,
    primaryCtaLabel: row.primary_cta_label,
    secondaryCtaLabel: row.secondary_cta_label,
    primaryCtaTarget: row.primary_cta_target,
    secondaryCtaTarget: row.secondary_cta_target,
    isActive: row.is_active,
    publishedAt: row.published_at,
    publishedLabel: formatPublishedLabel(row.published_at),
  };
}

function mapLeaderboardRow(row: any) {
  return {
    username: row.username,
    displayName: row.display_name || row.telegram_first_name || row.username,
    rank: row.current_rank,
    mined: Number(row.total_mined),
    active: row.active_referrals,
    total: row.total_referrals,
    rate: Number(row.current_rate),
  };
}

function getProfileDisplayName(row: any) {
  const firstName = String(row?.telegram_first_name || "").trim();
  return firstName || row?.username || "";
}

async function getClaimedTotal(profileId: string) {
  const { data, error } = await supabase
    .from("mining_claims")
    .select("amount")
    .eq("profile_id", profileId);

  if (error) throw error;
  return (data || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

async function getProtocolSnapshot() {
  const [
    { data: supplyRows, error: supplyError },
    { data: networkState, error: networkError },
  ] = await Promise.all([
    supabase.from("supply_summary").select("*").order("bucket", { ascending: true }),
    supabase.from("network_state").select("*").eq("key", "primary").maybeSingle(),
  ]);

  if (supplyError) throw supplyError;
  if (networkError) throw networkError;

  const byBucket = Object.fromEntries((supplyRows || []).map((row: any) => [row.bucket, row]));
  const community = byBucket.community_mining || null;
  const developer = byBucket.developer_allocation || null;
  const globalEpoch = getGlobalEpoch();
  const halvingMs = HALVING_DAYS * 24 * 60 * 60 * 1000;
  const launchAt = networkState?.launch_at || NETWORK_START_AT;
  const nextHalvingAt =
    new Date(launchAt).getTime() + (Math.max(0, globalEpoch) + 1) * halvingMs;

  return {
    networkState,
    globalEpoch,
    nextHalvingAt,
    communityMiningIssued: Number(community?.issued_amount || 0),
    communityMiningRemaining: Number(community?.remaining_amount || 0),
    communityMiningCap: Number(community?.cap_amount || 0),
    developerAllocationIssued: Number(developer?.issued_amount || 0),
    developerAllocationRemaining: Number(developer?.remaining_amount || 0),
    developerAllocationCap: Number(developer?.cap_amount || 0),
  };
}

function mapProfileState(profile: any, referralSummary: any, inviterProfile: any = null) {
  return {
    epoch: profile.epoch,
    selectedRank: profile.selected_rank,
    currentRank: profile.current_rank || "miner",
    activeReferrals: referralSummary.activeReferrals,
    totalReferrals: referralSummary.totalReferrals,
    joinedEarly: isEarlyAdopterDate(profile.created_at),
    totalMined: Number(profile.total_mined),
    miningStartedAt: profile.mining_started_at ? new Date(profile.mining_started_at).getTime() : null,
    sessionAccrued: Number(profile.session_accrued || 0),
    sessionAccrualUpdatedAt: profile.session_accrual_updated_at
      ? new Date(profile.session_accrual_updated_at).getTime()
      : null,
    sessionClaimed: profile.session_claimed,
    lastClaimedAt: profile.last_claimed_at ? new Date(profile.last_claimed_at).getTime() : null,
    inviteCode: profile.invite_code,
    username: profile.username,
    telegramUserId: profile.telegram_user_id || null,
    telegramUsername: profile.telegram_username || profile.username,
    telegramFirstName: profile.telegram_first_name || "",
    telegramLastName: profile.telegram_last_name || "",
    telegramPhotoUrl: profile.telegram_photo_url || "",
    profileCreatedAt: profile.created_at || null,
    profileUpdatedAt: profile.updated_at || null,
    referredByProfileId: profile.referred_by_profile_id || null,
    referralCodeAppliedAt: profile.referral_code_applied_at || null,
    inviterDisplayName: getProfileDisplayName(inviterProfile),
    inviterUsername: inviterProfile?.username || "",
    roleCount: 1,
  };
}

async function fetchProfileByIdentity(identity: any) {
  const { data: telegramMatch, error: telegramError } = await supabase
    .from("profiles")
    .select("*")
    .eq("telegram_user_id", identity.telegramUserId)
    .maybeSingle();
  if (telegramError) throw telegramError;
  if (telegramMatch) return telegramMatch;

  const { data: usernameMatch, error: usernameError } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", identity.username)
    .maybeSingle();
  if (usernameError) throw usernameError;

  return usernameMatch;
}

async function fetchSnapshot(profile: any) {
  const inviterPromise = profile.referred_by_profile_id
    ? supabase
        .from("profiles")
        .select("username, telegram_first_name")
        .eq("id", profile.referred_by_profile_id)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [
    { data: announcementRows, error: announcementError },
    { data: referralRows, error: referralsError },
    { data: leaderboardRows, error: leaderboardError },
    { data: inviterRow, error: inviterError },
  ] = await Promise.all([
    supabase
      .from("announcements")
      .select("*")
      .eq("is_active", true)
      .order("published_at", { ascending: false })
      .limit(1),
    supabase
      .from("referrals")
      .select(
        "id, referred_username, referred_rank, is_active, last_reminded_at, referred_profile:profiles!referrals_referred_profile_id_fkey(mining_started_at)"
      )
      .eq("referrer_profile_id", profile.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("leaderboard")
      .select("username, telegram_first_name, display_name, current_rank, total_mined, active_referrals, total_referrals, current_rate")
      .limit(25),
    inviterPromise,
  ]);

  if (announcementError) throw announcementError;
  if (referralsError) throw referralsError;
  if (leaderboardError) throw leaderboardError;
  if (inviterError) throw inviterError;

  const mappedReferrals = (referralRows || []).map(mapReferralRow);
  const referralSummary = buildReferralSummary(mappedReferrals);
  const unlockedRank = getEligibleRank(referralSummary.activeReferrals, isEarlyAdopterDate(profile.created_at));
  const permanentRank = getHigherRank(profile.current_rank || "miner", unlockedRank);
  const globalEpoch = getGlobalEpoch();
  const liveRate = getLiveMiningRate(
    permanentRank,
    isEarlyAdopterDate(profile.created_at),
    referralSummary.activeReferrals,
    globalEpoch
  );
  const claimedTotal = await getClaimedTotal(profile.id);
  const accrual = calculateAccrualProgress(profile, Date.now());
  const protocol = await getProtocolSnapshot();

  let snapshotProfile = profile;
  if (
    profile.current_rank !== permanentRank ||
    profile.epoch !== globalEpoch ||
    Number(profile.total_mined || 0) !== claimedTotal ||
    Number(profile.current_rate || 0) !== liveRate ||
    Number(profile.session_accrued || 0) !== Number(accrual.sessionAccrued.toFixed(6)) ||
    String(profile.session_accrual_updated_at || "") !== String(accrual.sessionAccrualUpdatedAt || "")
  ) {
    const { data: updatedProfile, error: profileError } = await supabase
      .from("profiles")
      .update({
        current_rank: permanentRank,
        epoch: globalEpoch,
        active_referrals: referralSummary.activeReferrals,
        total_referrals: referralSummary.totalReferrals,
        total_mined: claimedTotal,
        current_rate: Number(liveRate.toFixed(6)),
        session_accrued: Number(accrual.sessionAccrued.toFixed(6)),
        session_accrual_updated_at: accrual.sessionAccrualUpdatedAt,
      })
      .eq("id", profile.id)
      .select("*")
      .single();

    if (profileError) throw profileError;
    snapshotProfile = updatedProfile;
  }

  return {
    profileId: snapshotProfile.id,
    state: mapProfileState(snapshotProfile, referralSummary, inviterRow),
    announcement: announcementRows?.[0] ? mapAnnouncementRow(announcementRows[0]) : null,
    referrals: mappedReferrals,
    leaderboard: (leaderboardRows || []).map(mapLeaderboardRow),
    protocol,
    isAdmin: adminAllowlist.includes(String(snapshotProfile.username || "").toLowerCase()),
  };
}

async function ensureProfile(identity: any) {
  const existing = await fetchProfileByIdentity(identity);
  const basePatch = {
    username: identity.username,
    invite_code: buildInviteCode(identity.username, identity.telegramUserId),
    telegram_user_id: identity.telegramUserId,
    telegram_username: identity.username,
    telegram_first_name: identity.firstName || null,
    telegram_last_name: identity.lastName || null,
    telegram_photo_url: identity.photoUrl || null,
    telegram_language_code: identity.languageCode || null,
    telegram_is_premium: identity.isPremium || false,
  };

  if (existing) {
    const { data, error } = await supabase
      .from("profiles")
      .update(basePatch)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      ...basePatch,
      joined_early: isEarlyAdopterDate(),
      selected_rank: "auto",
      current_rank: isEarlyAdopterDate() ? "pioneer" : "miner",
      epoch: getGlobalEpoch(),
      active_referrals: 0,
      total_referrals: 0,
      total_mined: 0,
      current_rate: 1,
      session_accrued: 0,
      session_accrual_updated_at: null,
      session_claimed: true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function linkReferralToProfile(profile: any, referralCode: string) {
  const normalizedCode = parseReferralStartParam(referralCode);
  if (!normalizedCode || profile.referred_by_profile_id || profile.invite_code === normalizedCode) {
    return profile;
  }

  const { data: inviter, error: inviterError } = await supabase
    .from("profiles")
    .select("id, telegram_user_id, telegram_first_name, username")
    .eq("invite_code", normalizedCode)
    .maybeSingle();
  if (inviterError) throw inviterError;
  if (!inviter || inviter.id === profile.id) return profile;

  const { data: updatedProfile, error: updateError } = await supabase
    .from("profiles")
    .update({
      referred_by_profile_id: inviter.id,
      referral_code_applied_at: new Date().toISOString(),
    })
    .eq("id", profile.id)
    .select("*")
    .single();
  if (updateError) throw updateError;

  const { data: existingReferral, error: existingReferralError } = await supabase
    .from("referrals")
    .select("id")
    .eq("referrer_profile_id", inviter.id)
    .eq("referred_profile_id", profile.id)
    .maybeSingle();
  if (existingReferralError) throw existingReferralError;

  if (!existingReferral) {
    const { error: referralInsertError } = await supabase.from("referrals").insert({
      referrer_profile_id: inviter.id,
      referred_profile_id: profile.id,
      referred_username: updatedProfile.username,
      referred_rank: updatedProfile.current_rank || "miner",
      is_active: false,
    });
    if (referralInsertError) throw referralInsertError;
  }

  const inviteeName = getProfileDisplayName(updatedProfile);
  const inviterName = getProfileDisplayName(inviter);

  if (updatedProfile.telegram_user_id) {
    await sendTelegramMessage(
      updatedProfile.telegram_user_id,
      `${inviterName} invited you to Satyra. Your referral is now connected.`
    ).catch(console.error);
  }

  if (inviter.telegram_user_id) {
    await sendTelegramMessage(
      inviter.telegram_user_id,
      `${inviteeName} joined Satyra using your referral link.`
    ).catch(console.error);
  }

  return updatedProfile;
}

async function requireProfile(initData: string | undefined, fallbackIdentity: any) {
  let identity;

  if (initData) {
    try {
      identity = await verifyTelegramInitData(initData);
    } catch (error) {
      console.error("Telegram initData verification failed, falling back to Mini App identity", error);
    }
  }

  if (!identity) {
    identity = sanitizeFallbackIdentity(fallbackIdentity);
  }

  const profile = await ensureProfile(identity);
  return { identity, profile };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ ok: true, status: "app-api" });
  }

  try {
    const body = await request.json();
    const { action, initData, identity: fallbackIdentity } = body || {};
    if (!action) {
      return json({ ok: false, error: "Missing action" }, 400);
    }

    const { identity, profile } = await requireProfile(initData, fallbackIdentity);

    if (action === "bootstrap") {
      const linkedProfile = await linkReferralToProfile(profile, identity.startParam);
      const snapshot = await fetchSnapshot(linkedProfile);
      return json({ ok: true, ...snapshot });
    }

    if (action === "list_admin_announcements") {
      if (!adminAllowlist.includes(String(identity.username).toLowerCase())) {
        return json({ ok: false, error: "Not authorized" }, 403);
      }

      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("published_at", { ascending: false });

      if (error) throw error;
      return json({ ok: true, announcements: (data || []).map(mapAnnouncementRow) });
    }

    if (action === "persist_profile") {
      const referralSummary = await supabase
        .from("referrals")
        .select("id, is_active, referred_profile:profiles!referrals_referred_profile_id_fkey(mining_started_at)")
        .eq("referrer_profile_id", profile.id);

      if (referralSummary.error) throw referralSummary.error;
      const mappedReferrals = (referralSummary.data || []).map(mapReferralRow);
      const summary = buildReferralSummary(mappedReferrals);
      const unlockedRank = getEligibleRank(summary.activeReferrals, isEarlyAdopterDate(profile.created_at));
      const permanentRank = getHigherRank(profile.current_rank || "miner", unlockedRank);

      const { error } = await supabase
        .from("profiles")
        .update({
          selected_rank: body.state?.selectedRank || profile.selected_rank,
          current_rank: permanentRank,
          epoch: getGlobalEpoch(),
          active_referrals: summary.activeReferrals,
          total_referrals: summary.totalReferrals,
          current_rate: body.currentRate ?? profile.current_rate,
          session_accrued: Number(body.state?.sessionAccrued ?? profile.session_accrued ?? 0),
          session_accrual_updated_at: body.state?.sessionAccrualUpdatedAt
            ? new Date(body.state.sessionAccrualUpdatedAt).toISOString()
            : body.state?.miningStartedAt
              ? new Date(body.state.miningStartedAt).toISOString()
              : null,
          mining_started_at: body.state?.miningStartedAt
            ? new Date(body.state.miningStartedAt).toISOString()
            : null,
          session_claimed: body.state?.sessionClaimed ?? profile.session_claimed,
          last_claimed_at: body.state?.lastClaimedAt
            ? new Date(body.state.lastClaimedAt).toISOString()
            : null,
        })
        .eq("id", profile.id);

      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "apply_referral_code") {
      const linkedProfile = await linkReferralToProfile(profile, body.code || "");
      const snapshot = await fetchSnapshot(linkedProfile);
      return json({ ok: true, ...snapshot });
    }

    if (action === "create_referral_member") {
      const { data, error } = await supabase
        .from("referrals")
        .insert({
          referrer_profile_id: profile.id,
          referred_username: String(body.username || "").trim(),
          referred_rank: body.rank || "pioneer",
          is_active: false,
        })
        .select("id, referred_username, referred_rank, is_active, last_reminded_at")
        .single();
      if (error) throw error;
      return json({ ok: true, referral: mapReferralRow(data) });
    }

    if (action === "update_referral_member") {
      const { data, error } = await supabase
        .from("referrals")
        .update({
          ...(typeof body.patch?.is_active === "boolean" ? { is_active: body.patch.is_active } : {}),
          ...(body.patch?.referred_rank ? { referred_rank: body.patch.referred_rank } : {}),
        })
        .eq("id", body.referralId)
        .eq("referrer_profile_id", profile.id)
        .select("id, referred_username, referred_rank, is_active, last_reminded_at")
        .single();
      if (error) throw error;
      return json({ ok: true, referral: mapReferralRow(data) });
    }

    if (action === "remind_referral_member") {
      const { data, error } = await supabase
        .from("referrals")
        .update({ last_reminded_at: new Date().toISOString() })
        .eq("id", body.referralId)
        .eq("referrer_profile_id", profile.id)
        .select(
          "id, referred_username, referred_rank, is_active, last_reminded_at, referred_profile_id, referred_profile:profiles!referrals_referred_profile_id_fkey(telegram_user_id)"
        )
        .single();
      if (error) throw error;
      let delivery = "share_link";
      if (data?.referred_profile?.telegram_user_id) {
        await sendTelegramMessage(
          data.referred_profile.telegram_user_id,
          `${getProfileDisplayName(profile)} sent you a reminder to activate your Satyra mining session.`
        ).catch(console.error);
        delivery = "telegram";
      }
      return json({
        ok: true,
        referral: mapReferralRow(data),
        delivery,
        shareLink: delivery === "share_link" ? buildTelegramReferralLink(profile.invite_code) : null,
      });
    }

    if (action === "remind_inactive_referral_members") {
      const { data, error } = await supabase
        .from("referrals")
        .update({ last_reminded_at: new Date().toISOString() })
        .eq("referrer_profile_id", profile.id)
        .eq("is_active", false)
        .select(
          "id, referred_username, referred_rank, is_active, last_reminded_at, referred_profile:profiles!referrals_referred_profile_id_fkey(telegram_user_id)"
        );
      if (error) throw error;
      for (const entry of data || []) {
        if (entry?.referred_profile?.telegram_user_id) {
          await sendTelegramMessage(
            entry.referred_profile.telegram_user_id,
            `${getProfileDisplayName(profile)} sent you a reminder to activate your Satyra mining session.`
          ).catch(console.error);
        }
      }
      return json({ ok: true, referrals: (data || []).map(mapReferralRow) });
    }

    if (action === "record_mining_claim") {
      const sessionStartedAt = new Date(body.sessionStartedAt || profile.mining_started_at).toISOString();
      const sessionEndedAt = new Date(body.sessionEndedAt).toISOString();
      const claimedAt = new Date(body.claimedAt).toISOString();
      const finalAccrual = calculateAccrualProgress(
        profile,
        new Date(sessionEndedAt).getTime()
      );
      const amount = Number(Number(finalAccrual.sessionAccrued || 0).toFixed(5));

      const { data: claim, error: claimError } = await supabase
        .from("mining_claims")
        .insert({
          profile_id: profile.id,
          epoch: getGlobalEpoch(),
          session_started_at: sessionStartedAt,
          session_ended_at: sessionEndedAt,
          claimed_at: claimedAt,
          amount,
        })
        .select("id")
        .single();
      if (claimError) throw claimError;

      const { error: eventError } = await supabase.from("supply_events").insert({
        bucket: "community_mining",
        profile_id: profile.id,
        amount,
        reference_type: "mining_claim",
        reference_id: claim.id,
        notes: `Epoch ${getGlobalEpoch()} mining claim`,
      });
      if (eventError) throw eventError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          total_mined: Number(profile.total_mined) + amount,
          current_rate: 0,
          session_accrued: 0,
          session_accrual_updated_at: null,
          mining_started_at: null,
          session_claimed: true,
          last_claimed_at: claimedAt,
          epoch: getGlobalEpoch(),
        })
        .eq("id", profile.id);
      if (profileError) throw profileError;

      return json({
        ok: true,
        amount,
        totalMined: Number(profile.total_mined) + amount,
      });
    }

    if (action === "save_announcement") {
      if (!adminAllowlist.includes(String(identity.username).toLowerCase())) {
        return json({ ok: false, error: "Not authorized" }, 403);
      }

      const slugBase =
        body.announcement?.slug ||
        String(body.announcement?.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

      const payload = {
        slug: slugBase || `announcement-${Date.now()}`,
        eyebrow: body.announcement?.eyebrow || "@SatyraCoreTeam",
        title: body.announcement?.title || "",
        body: body.announcement?.body || "",
        primary_cta_label: body.announcement?.primaryCtaLabel || "Announcement",
        secondary_cta_label: body.announcement?.secondaryCtaLabel || "Open forum",
        primary_cta_target: body.announcement?.primaryCtaTarget || null,
        secondary_cta_target: body.announcement?.secondaryCtaTarget || null,
        is_active: body.announcement?.isActive ?? true,
        published_at: body.announcement?.publishedAt || new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("announcements")
        .upsert(payload, { onConflict: "slug" })
        .select("*")
        .single();
      if (error) throw error;
      return json({ ok: true, announcement: mapAnnouncementRow(data) });
    }

    if (action === "toggle_announcement_active") {
      if (!adminAllowlist.includes(String(identity.username).toLowerCase())) {
        return json({ ok: false, error: "Not authorized" }, 403);
      }

      const { data, error } = await supabase
        .from("announcements")
        .update({ is_active: Boolean(body.isActive) })
        .eq("slug", String(body.slug || ""))
        .select("*")
        .single();

      if (error) throw error;
      return json({ ok: true, announcement: mapAnnouncementRow(data) });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
