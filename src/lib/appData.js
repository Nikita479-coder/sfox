import { supabase, hasSupabaseConfig } from "./supabase";
import { isEarlyAdopterDate } from "./earlyAdopter";

export const fallbackAnnouncement = null;
export const fallbackLeaderboardEntries = [];
export const fallbackReferralMembers = [];

function formatPublishedLabel(value) {
  if (!value) return "";
  const published = new Date(value);
  if (Number.isNaN(published.getTime())) return "";

  return published.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildProfilePayload(defaultState, identity) {
  const username = identity?.username || defaultState.username;
  const inviteCode = identity?.inviteCode || defaultState.inviteCode;
  const joinedEarly = isEarlyAdopterDate();

  return {
    username,
    invite_code: inviteCode,
    telegram_user_id: identity?.telegramUserId || null,
    telegram_username: identity?.username || username,
    telegram_first_name: identity?.firstName || null,
    telegram_last_name: identity?.lastName || null,
    telegram_photo_url: identity?.photoUrl || null,
    telegram_language_code: identity?.languageCode || null,
    telegram_is_premium: identity?.isPremium || false,
    joined_early: joinedEarly,
    selected_rank: defaultState.selectedRank,
    current_rank: "miner",
    epoch: defaultState.epoch,
    active_referrals: defaultState.activeReferrals,
    total_referrals: defaultState.totalReferrals,
    total_mined: defaultState.totalMined,
    current_rate: 1,
    mining_started_at: defaultState.miningStartedAt,
    session_claimed: defaultState.sessionClaimed,
    last_claimed_at: defaultState.lastClaimedAt,
  };
}

async function ensureProfile(defaultState, identity) {
  const matcher = identity?.telegramUserId
    ? supabase.from("profiles").select("*").eq("telegram_user_id", identity.telegramUserId)
    : supabase.from("profiles").select("*").eq("username", identity?.username || defaultState.username);

  const { data: existing, error: fetchError } = await matcher.maybeSingle();

  if (fetchError) throw fetchError;
  const insertPayload = buildProfilePayload(defaultState, identity);

  if (existing) {
    const profilePatch = {
      username: insertPayload.username,
      invite_code: insertPayload.invite_code,
      telegram_user_id: insertPayload.telegram_user_id,
      telegram_username: insertPayload.telegram_username,
      telegram_first_name: insertPayload.telegram_first_name,
      telegram_last_name: insertPayload.telegram_last_name,
      telegram_photo_url: insertPayload.telegram_photo_url,
      telegram_language_code: insertPayload.telegram_language_code,
      telegram_is_premium: insertPayload.telegram_is_premium,
    };

    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError) throw updateError;
    return updated;
  }

  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) throw insertError;
  return created;
}

function mapReferralRow(row) {
  return {
    id: row.id,
    username: row.referred_username,
    rank: row.referred_rank,
    is_active: row.is_active,
    last_reminded_at: row.last_reminded_at,
  };
}

function mapAnnouncementRow(row) {
  return {
    eyebrow: row.eyebrow,
    title: row.title,
    body: row.body,
    primaryCtaLabel: row.primary_cta_label,
    secondaryCtaLabel: row.secondary_cta_label,
    primaryCtaTarget: row.primary_cta_target,
    secondaryCtaTarget: row.secondary_cta_target,
    publishedLabel: formatPublishedLabel(row.published_at),
  };
}

function mapLeaderboardRow(row) {
  return {
    username: row.username,
    rank: row.current_rank,
    mined: Number(row.total_mined),
    active: row.active_referrals,
    total: row.total_referrals,
    rate: Number(row.current_rate),
  };
}

function mapProfileState(profile, referralSummary, defaultState) {
  const joinedEarly = isEarlyAdopterDate(profile.created_at);

  return {
    epoch: profile.epoch,
    selectedRank: profile.selected_rank,
    activeReferrals: referralSummary.activeReferrals,
    totalReferrals: referralSummary.totalReferrals,
    joinedEarly,
    totalMined: Number(profile.total_mined),
    miningStartedAt: profile.mining_started_at ? new Date(profile.mining_started_at).getTime() : null,
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
    roleCount: defaultState.roleCount,
  };
}

async function fetchAppSnapshot(profile, defaultState) {
  const [
    { data: announcementRows, error: announcementError },
    { data: referralRows, error: referralsError },
    { data: leaderboardRows, error: leaderboardError },
  ] = await Promise.all([
    supabase
      .from("announcements")
      .select("*")
      .eq("is_active", true)
      .order("published_at", { ascending: false })
      .limit(1),
    supabase
      .from("referrals")
      .select("id, referred_username, referred_rank, is_active, last_reminded_at")
      .eq("referrer_profile_id", profile.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("leaderboard")
      .select("username, current_rank, total_mined, active_referrals, total_referrals, current_rate")
      .limit(25),
  ]);

  if (announcementError) throw announcementError;
  if (referralsError) throw referralsError;
  if (leaderboardError) throw leaderboardError;

  const mappedReferrals = (referralRows || []).map(mapReferralRow);
  const referralSummary = buildReferralSummary(mappedReferrals);

  return {
    profileId: profile.id,
    state: mapProfileState(profile, referralSummary, defaultState),
    announcement: announcementRows?.[0] ? mapAnnouncementRow(announcementRows[0]) : null,
    referrals: mappedReferrals,
    leaderboard: (leaderboardRows || []).map(mapLeaderboardRow),
  };
}

export function buildReferralSummary(referrals) {
  const totalReferrals = referrals.length;
  const activeReferrals = referrals.filter((member) => member.is_active).length;

  return {
    totalReferrals,
    activeReferrals,
  };
}

export async function loadAppBootstrap(defaultState, identity = null) {
  if (!hasSupabaseConfig || !supabase) {
    return {
      usingSupabase: false,
      state: null,
      announcement: null,
      referrals: [],
      leaderboard: [],
    };
  }

  const profile = await ensureProfile(defaultState, identity);
  const snapshot = await fetchAppSnapshot(profile, defaultState);

  return {
    usingSupabase: true,
    profileId: snapshot.profileId,
    state: snapshot.state,
    announcement: snapshot.announcement,
    referrals: snapshot.referrals,
    leaderboard: snapshot.leaderboard,
  };
}

export async function persistProfileState({ state, currentRank, currentRate, profileId, identity = null }) {
  if (!hasSupabaseConfig || !supabase) return;

  const joinedEarly = isEarlyAdopterDate(state.profileCreatedAt);

  const payload = {
    username: state.username,
    invite_code: state.inviteCode,
    telegram_user_id: identity?.telegramUserId || null,
    telegram_username: identity?.username || state.username,
    telegram_first_name: identity?.firstName || null,
    telegram_last_name: identity?.lastName || null,
    telegram_photo_url: identity?.photoUrl || null,
    telegram_language_code: identity?.languageCode || null,
    telegram_is_premium: identity?.isPremium || false,
    joined_early: joinedEarly,
    selected_rank: state.selectedRank,
    current_rank: currentRank,
    epoch: state.epoch,
    active_referrals: state.activeReferrals,
    total_referrals: state.totalReferrals,
    total_mined: state.totalMined,
    current_rate: currentRate,
    mining_started_at: state.miningStartedAt ? new Date(state.miningStartedAt).toISOString() : null,
    session_claimed: state.sessionClaimed,
    last_claimed_at: state.lastClaimedAt ? new Date(state.lastClaimedAt).toISOString() : null,
  };

  const query = profileId
    ? supabase.from("profiles").update(payload).eq("id", profileId)
    : supabase.from("profiles").upsert(payload, { onConflict: identity?.telegramUserId ? "telegram_user_id" : "username" });

  const { error } = await query;

  if (error) {
    throw error;
  }
}

export async function createReferralMember({ profileId, username, rank }) {
  if (!hasSupabaseConfig || !supabase) return null;

  const payload = {
    referrer_profile_id: profileId,
    referred_username: username,
    referred_rank: rank,
    is_active: false,
  };

  const { data, error } = await supabase
    .from("referrals")
    .insert(payload)
    .select("id, referred_username, referred_rank, is_active, last_reminded_at")
    .single();

  if (error) throw error;
  return mapReferralRow(data);
}

export async function updateReferralMember({ referralId, patch }) {
  if (!hasSupabaseConfig || !supabase) return null;

  const updatePayload = {};
  if (typeof patch.is_active === "boolean") updatePayload.is_active = patch.is_active;
  if (patch.referred_rank) updatePayload.referred_rank = patch.referred_rank;

  const { data, error } = await supabase
    .from("referrals")
    .update(updatePayload)
    .eq("id", referralId)
    .select("id, referred_username, referred_rank, is_active, last_reminded_at")
    .single();

  if (error) throw error;
  return mapReferralRow(data);
}

export async function remindReferralMember(referralId) {
  if (!hasSupabaseConfig || !supabase) return null;

  const { data, error } = await supabase
    .from("referrals")
    .update({ last_reminded_at: new Date().toISOString() })
    .eq("id", referralId)
    .select("id, referred_username, referred_rank, is_active, last_reminded_at")
    .single();

  if (error) throw error;
  return mapReferralRow(data);
}

export async function remindInactiveReferralMembers(profileId) {
  if (!hasSupabaseConfig || !supabase) return [];

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("referrals")
    .update({ last_reminded_at: now })
    .eq("referrer_profile_id", profileId)
    .eq("is_active", false)
    .select("id, referred_username, referred_rank, is_active, last_reminded_at");

  if (error) throw error;
  return (data || []).map(mapReferralRow);
}

export function subscribeToAppData({ profileId, defaultState, onData, onError }) {
  if (!hasSupabaseConfig || !supabase || !profileId) {
    return () => {};
  }

  let cancelled = false;

  const refresh = async () => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .single();

      if (error) throw error;

      const snapshot = await fetchAppSnapshot(profile, defaultState);
      if (!cancelled) onData(snapshot);
    } catch (error) {
      if (!cancelled && onError) onError(error);
    }
  };

  const channel = supabase
    .channel(`app-live:${profileId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles", filter: `id=eq.${profileId}` },
      refresh
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "referrals", filter: `referrer_profile_id=eq.${profileId}` },
      refresh
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "announcements" },
      refresh
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles" },
      refresh
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}
