import { supabase, hasSupabaseConfig } from "./supabase";
import { isEarlyAdopterDate } from "./earlyAdopter";

export const fallbackAnnouncement = null;
export const fallbackLeaderboardEntries = [];
export const fallbackReferralMembers = [];
const SESSION_HOURS = 24;

async function invokeSecureAppApi(action, payload = {}) {
  if (!hasSupabaseConfig || !supabase) {
    throw new Error("Supabase is not configured");
  }

  const { data, error } = await supabase.functions.invoke("app-api", {
    body: {
      action,
      ...payload,
    },
  });

  if (error) throw error;
  if (!data?.ok) {
    throw new Error(data?.error || "Secure app request failed");
  }

  return data;
}

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
    current_rank: defaultState.currentRank || "miner",
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

function normalizeInviteCode(value) {
  return String(value || "").trim().toUpperCase();
}

function parseReferralStartParam(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const normalized = raw.replace(/^ref[-_:]?/i, "");
  return normalizeInviteCode(normalized);
}

async function linkReferralToProfile({ profile, referralCode }) {
  const normalizedCode = normalizeInviteCode(referralCode);
  if (!normalizedCode) return profile;
  if (profile.referred_by_profile_id) return profile;
  if (normalizeInviteCode(profile.invite_code) === normalizedCode) return profile;

  const { data: inviter, error: inviterError } = await supabase
    .from("profiles")
    .select("id, username, current_rank")
    .eq("invite_code", normalizedCode)
    .maybeSingle();

  if (inviterError) throw inviterError;
  if (!inviter) {
    throw new Error("Referral code not found");
  }
  if (inviter.id === profile.id) {
    throw new Error("You cannot use your own referral code");
  }

  const { data: updatedProfile, error: profileUpdateError } = await supabase
    .from("profiles")
    .update({
      referred_by_profile_id: inviter.id,
      referral_code_applied_at: new Date().toISOString(),
    })
    .eq("id", profile.id)
    .select("*")
    .single();

  if (profileUpdateError) throw profileUpdateError;

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

  return updatedProfile;
}

async function ensureProfile(defaultState, identity) {
  const matcher = identity?.telegramUserId
    ? supabase.from("profiles").select("*").eq("telegram_user_id", identity.telegramUserId)
    : supabase.from("profiles").select("*").eq("username", identity?.username || defaultState.username);

  const { data: existing, error: fetchError } = await matcher.maybeSingle();

  if (fetchError) throw fetchError;
  const insertPayload = buildProfilePayload(defaultState, identity);

  const referralCodeFromTelegram = parseReferralStartParam(identity?.startParam);

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
    return linkReferralToProfile({
      profile: updated,
      referralCode: referralCodeFromTelegram,
    });
  }

  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) throw insertError;
  return linkReferralToProfile({
    profile: created,
    referralCode: referralCodeFromTelegram,
  });
}

function isReferralProfileActivelyMining(profile) {
  if (!profile?.mining_started_at) return false;

  const startedAt = new Date(profile.mining_started_at).getTime();
  if (Number.isNaN(startedAt)) return false;

  const sessionEndsAt = startedAt + SESSION_HOURS * 60 * 60 * 1000;
  return Date.now() < sessionEndsAt;
}

function mapReferralRow(row) {
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

function mapAnnouncementRow(row) {
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

function mapLeaderboardRow(row) {
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

function getProfileDisplayName(row) {
  if (!row) return "";
  const firstName = String(row.telegram_first_name || "").trim();
  if (firstName) return firstName;
  return row.username || "";
}

function mapProfileState(profile, referralSummary, defaultState, inviterProfile = null) {
  const joinedEarly = isEarlyAdopterDate(profile.created_at);

  return {
    epoch: profile.epoch,
    selectedRank: profile.selected_rank,
    currentRank: profile.current_rank || "miner",
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
    referredByProfileId: profile.referred_by_profile_id || null,
    referralCodeAppliedAt: profile.referral_code_applied_at || null,
    inviterDisplayName: getProfileDisplayName(inviterProfile),
    inviterUsername: inviterProfile?.username || "",
    roleCount: defaultState.roleCount,
  };
}

async function fetchAppSnapshot(profile, defaultState) {
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

  return {
    profileId: profile.id,
    state: mapProfileState(profile, referralSummary, defaultState, inviterRow),
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

  if (identity?.initData) {
    const result = await invokeSecureAppApi("bootstrap", {
      initData: identity.initData,
    });

    return {
      usingSupabase: true,
      profileId: result.profileId,
      state: result.state,
      announcement: result.announcement,
      referrals: result.referrals,
      leaderboard: result.leaderboard,
      protocol: result.protocol || null,
      isAdmin: Boolean(result.isAdmin),
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
    protocol: null,
    isAdmin: false,
  };
}

export async function persistProfileState({
  state,
  currentRank,
  currentRate,
  currentEpoch,
  profileId,
  identity = null,
}) {
  if (!hasSupabaseConfig || !supabase) return;

  if (identity?.initData) {
    await invokeSecureAppApi("persist_profile", {
      initData: identity.initData,
      state,
      currentRank,
      currentRate,
      currentEpoch,
    });
    return;
  }

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
    referred_by_profile_id: state.referredByProfileId || null,
    referral_code_applied_at: state.referralCodeAppliedAt || null,
    selected_rank: state.selectedRank,
    current_rank: currentRank,
    epoch: currentEpoch,
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

export async function applyReferralCode({ profileId, code, identity = null }) {
  if (!hasSupabaseConfig || !supabase) return null;

  if (identity?.initData) {
    return invokeSecureAppApi("apply_referral_code", {
      initData: identity.initData,
      code,
    });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .single();

  if (error) throw error;

  return linkReferralToProfile({
    profile,
    referralCode: code,
  });
}

export async function createReferralMember({ profileId, username, rank, identity = null }) {
  if (!hasSupabaseConfig || !supabase) return null;

  if (identity?.initData) {
    const result = await invokeSecureAppApi("create_referral_member", {
      initData: identity.initData,
      username,
      rank,
    });
    return result.referral;
  }

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

export async function updateReferralMember({ referralId, patch, identity = null }) {
  if (!hasSupabaseConfig || !supabase) return null;

  if (identity?.initData) {
    const result = await invokeSecureAppApi("update_referral_member", {
      initData: identity.initData,
      referralId,
      patch,
    });
    return result.referral;
  }

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

export async function remindReferralMember(referralId, identity = null) {
  if (!hasSupabaseConfig || !supabase) return null;

  if (identity?.initData) {
    const result = await invokeSecureAppApi("remind_referral_member", {
      initData: identity.initData,
      referralId,
    });
    return result.referral;
  }

  const { data, error } = await supabase
    .from("referrals")
    .update({ last_reminded_at: new Date().toISOString() })
    .eq("id", referralId)
    .select("id, referred_username, referred_rank, is_active, last_reminded_at")
    .single();

  if (error) throw error;
  return mapReferralRow(data);
}

export async function remindInactiveReferralMembers(profileId, identity = null) {
  if (!hasSupabaseConfig || !supabase) return [];

  if (identity?.initData) {
    const result = await invokeSecureAppApi("remind_inactive_referral_members", {
      initData: identity.initData,
    });
    return result.referrals;
  }

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

export async function listAnnouncements() {
  if (!hasSupabaseConfig || !supabase) return [];

  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .order("published_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(mapAnnouncementRow);
}

export async function listAdminAnnouncements(identity = null) {
  if (!hasSupabaseConfig || !supabase) return [];

  if (identity?.initData) {
    const result = await invokeSecureAppApi("list_admin_announcements", {
      initData: identity.initData,
    });
    return result.announcements || [];
  }

  return listAnnouncements();
}

export async function saveAnnouncement(announcement, identity = null) {
  if (!hasSupabaseConfig || !supabase) return null;

  if (identity?.initData) {
    const result = await invokeSecureAppApi("save_announcement", {
      initData: identity.initData,
      announcement,
    });
    return result.announcement;
  }

  const slugBase =
    announcement.slug ||
    announcement.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const payload = {
    slug: slugBase || `announcement-${Date.now()}`,
    eyebrow: announcement.eyebrow || "@SFOXCoreTeam",
    title: announcement.title,
    body: announcement.body,
    primary_cta_label: announcement.primaryCtaLabel || "Announcement",
    secondary_cta_label: announcement.secondaryCtaLabel || "Open forum",
    primary_cta_target: announcement.primaryCtaTarget || null,
    secondary_cta_target: announcement.secondaryCtaTarget || null,
    is_active: announcement.isActive ?? true,
    published_at: announcement.publishedAt || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("announcements")
    .upsert(payload, { onConflict: "slug" })
    .select("*")
    .single();

  if (error) throw error;
  return mapAnnouncementRow(data);
}

export async function toggleAnnouncementActive({ slug, isActive, identity = null }) {
  if (!hasSupabaseConfig || !supabase) return null;

  if (identity?.initData) {
    const result = await invokeSecureAppApi("toggle_announcement_active", {
      initData: identity.initData,
      slug,
      isActive,
    });
    return result.announcement;
  }

  const { data, error } = await supabase
    .from("announcements")
    .update({ is_active: isActive })
    .eq("slug", slug)
    .select("*")
    .single();

  if (error) throw error;
  return mapAnnouncementRow(data);
}

export async function recordMiningClaim({
  profileId,
  epoch,
  sessionStartedAt,
  sessionEndedAt,
  claimedAt,
  amount,
  identity = null,
}) {
  if (!hasSupabaseConfig || !supabase || !profileId) return null;

  if (identity?.initData) {
    return invokeSecureAppApi("record_mining_claim", {
      initData: identity.initData,
      sessionStartedAt,
      sessionEndedAt,
      claimedAt,
      amount,
      epoch,
    });
  }

  const sessionStartIso = new Date(sessionStartedAt).toISOString();
  const sessionEndIso = new Date(sessionEndedAt).toISOString();
  const claimedAtIso = new Date(claimedAt).toISOString();
  const amountValue = Number(amount.toFixed(5));

  const { data: claim, error: claimError } = await supabase
    .from("mining_claims")
    .insert({
      profile_id: profileId,
      epoch,
      session_started_at: sessionStartIso,
      session_ended_at: sessionEndIso,
      claimed_at: claimedAtIso,
      amount: amountValue,
    })
    .select("id")
    .single();

  if (claimError) throw claimError;

  const { error: eventError } = await supabase.from("supply_events").insert({
    bucket: "community_mining",
    profile_id: profileId,
    amount: amountValue,
    reference_type: "mining_claim",
    reference_id: claim.id,
    notes: `Epoch ${epoch} mining claim`,
  });

  if (eventError) throw eventError;

  return claim;
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
