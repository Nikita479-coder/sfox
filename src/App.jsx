import { useEffect, useMemo, useRef, useState } from "react";
import pioneerLogo from "../pioneer.png";
import lordLogo from "../lord.png";
import baronLogo from "../baron.png";
import presidentLogo from "../president.png";
import titanLogo from "../titan.png";
import {
  applyReferralCode,
  buildReferralSummary,
  createReferralMember,
  fallbackLeaderboardEntries,
  fallbackReferralMembers,
  listAdminAnnouncements,
  loadAppBootstrap,
  listAnnouncements,
  persistProfileState,
  recordMiningClaim,
  remindInactiveReferralMembers,
  remindReferralMember,
  saveAnnouncement,
  subscribeToAppData,
  toggleAnnouncementActive,
} from "./lib/appData";
import { hasSupabaseConfig } from "./lib/supabase";
import { EARLY_ADOPTER_REQUIREMENT_LABEL, NETWORK_START_AT, isEarlyAdopterDate } from "./lib/earlyAdopter";
import { buildTelegramReferralLink, getTelegramIdentity } from "./lib/telegram";

const STORAGE_KEY = "sfox-react-platform-state";
const SESSION_HOURS = 24;
const HALVING_DAYS = 14;
const rankOrder = { miner: 0, pioneer: 1, lord: 2, baron: 3, president: 4, titan: 5 };

const rankMap = {
  miner: {
    label: "Miner",
    multiplierLabel: "x1.0",
    boost: 1,
    referralRate: 0,
    minReferrals: 0,
    requiresEarly: false,
    note: "Base mining only. No rank bonus until Pioneer or Lord conditions are met.",
  },
  pioneer: {
    label: "Pioneer",
    multiplierLabel: "x1.5",
    boost: 1.5,
    referralRate: 0.1,
    minReferrals: 0,
    requiresEarly: true,
    note: "+10% per active referral",
  },
  lord: {
    label: "Lord",
    multiplierLabel: "x5.0",
    boost: 5,
    referralRate: 0.12,
    minReferrals: 10,
    requiresEarly: false,
    note: "+12% per active referral",
  },
  baron: {
    label: "Baron",
    multiplierLabel: "x15.0",
    boost: 15,
    referralRate: 0.15,
    minReferrals: 50,
    requiresEarly: false,
    note: "+15% per active referral",
  },
  president: {
    label: "President",
    multiplierLabel: "x30.0",
    boost: 30,
    referralRate: 0.2,
    minReferrals: 100,
    requiresEarly: false,
    note: "+20% per active referral",
  },
  titan: {
    label: "Titan",
    multiplierLabel: "x50.0",
    boost: 50,
    referralRate: 0.25,
    minReferrals: 500,
    requiresEarly: false,
    note: "+25% per active referral",
  },
};

const rankVisuals = {
  miner: { short: "M", theme: "miner", image: null },
  pioneer: { short: "P", theme: "pioneer", image: pioneerLogo },
  lord: { short: "L", theme: "lord", image: lordLogo },
  baron: { short: "B", theme: "baron", image: baronLogo },
  president: { short: "P", theme: "president", image: presidentLogo },
  titan: { short: "T", theme: "titan", image: titanLogo },
};

const defaultState = {
  epoch: 0,
  selectedRank: "auto",
  currentRank: "miner",
  canManageAdmin: false,
  activeReferrals: 0,
  totalReferrals: 0,
  joinedEarly: isEarlyAdopterDate(),
  totalMined: 0,
  sessionAccrued: 0,
  sessionAccrualUpdatedAt: null,
  miningStartedAt: null,
  sessionClaimed: true,
  lastClaimedAt: null,
  inviteCode: "SFOX-PENDING-0000",
  username: "guest",
  telegramUserId: null,
  telegramUsername: null,
  telegramFirstName: "",
  telegramLastName: "",
  telegramPhotoUrl: "",
  profileCreatedAt: null,
  profileUpdatedAt: null,
  referredByProfileId: null,
  referralCodeAppliedAt: null,
  inviterDisplayName: "",
  inviterUsername: "",
  roleCount: 1,
};

function getHigherRank(leftRank, rightRank) {
  return rankOrder[leftRank] >= rankOrder[rightRank] ? leftRank : rightRank;
}

function loadState() {
  if (hasSupabaseConfig) {
    return defaultState;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const saved = { ...defaultState, ...JSON.parse(raw) };
    const activeReferrals = Math.max(0, Number(saved.activeReferrals ?? defaultState.activeReferrals));
    const totalReferrals = Math.max(
      activeReferrals,
      Number(saved.totalReferrals ?? activeReferrals)
    );

    return {
      ...saved,
      activeReferrals,
      totalReferrals,
    };
  } catch {
    return defaultState;
  }
}

function saveState(nextState) {
  if (hasSupabaseConfig) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

function formatRate(value) {
  return `${value.toFixed(3)} SFOX/h`;
}

function formatTotal(value) {
  return `${value.toFixed(5)} SFOX`;
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatSessionEarned(value) {
  return value.toFixed(6);
}

function formatTokenMetric(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 5,
  })} SFOX`;
}

function formatPhoneHeaderDate(value) {
  const source = value ? new Date(value) : new Date();
  if (Number.isNaN(source.getTime())) {
    return "Recently joined";
  }

  const month = source.toLocaleString("en-US", { month: "short" });
  const day = source.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const time = source.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();

  return `${month} ${day}${suffix} · ${time}`;
}

function formatFullDateTime(value) {
  if (!value) return "Not available";
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return "Not available";

  return source.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RankBadge({ rankKey, label }) {
  const visual = rankVisuals[rankKey] || rankVisuals.miner;

  if (visual.image) {
    return (
      <div className={`rank-emblem rank-emblem-image rank-emblem-${visual.theme}`}>
        <img className="rank-emblem-image-tag" src={visual.image} alt={`${label} rank`} />
      </div>
    );
  }

  return (
    <div className={`rank-emblem rank-emblem-${visual.theme}`}>
      <span className="rank-emblem-mark">{visual.short}</span>
      <small>{label}</small>
    </div>
  );
}

function RankHeroBadge({ rankKey, label }) {
  const visual = rankVisuals[rankKey] || rankVisuals.miner;

  if (visual.image) {
    return (
      <div className="rank-hero-badge">
        <img className="rank-hero-image" src={visual.image} alt={`${label} rank`} />
      </div>
    );
  }

  if (rankKey === "miner") {
    return null;
  }

  return (
    <div className="rank-hero-badge rank-hero-fallback">
      <span>{visual.short}</span>
    </div>
  );
}

function FilterDropdown({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const activeOption = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div className={`filter-dropdown ${open ? "open" : ""}`} ref={rootRef}>
      <button
        className="filter-dropdown-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{activeOption.label}</span>
        <span className="filter-dropdown-caret">▾</span>
      </button>

      {open && (
        <div className="filter-dropdown-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`filter-dropdown-option ${option.value === value ? "active" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getEligibleRank(activeReferrals, joinedEarly) {
  if (activeReferrals >= rankMap.titan.minReferrals) return "titan";
  if (activeReferrals >= rankMap.president.minReferrals) return "president";
  if (activeReferrals >= rankMap.baron.minReferrals) return "baron";
  if (activeReferrals >= rankMap.lord.minReferrals) return "lord";
  if (joinedEarly) return "pioneer";
  return "miner";
}

function getBaseRate(epoch) {
  return 1 / 2 ** Math.max(0, epoch);
}

function getGlobalEpoch(now = Date.now()) {
  const start = new Date(NETWORK_START_AT).getTime();
  const halvingMs = HALVING_DAYS * 24 * 60 * 60 * 1000;
  if (now <= start) return 0;
  return Math.max(0, Math.floor((now - start) / halvingMs));
}

function getSessionReward(totalRate) {
  return totalRate * SESSION_HOURS;
}

function getSessionEnd(miningStartedAt) {
  if (!miningStartedAt) return null;
  return miningStartedAt + SESSION_HOURS * 60 * 60 * 1000;
}

function getSessionAccrual(state, ratePerHour, now) {
  if (!state.miningStartedAt) return 0;

  const sessionEnd = getSessionEnd(state.miningStartedAt);
  if (!sessionEnd) return Number(state.sessionAccrued || 0);

  const anchor = state.sessionAccrualUpdatedAt || state.miningStartedAt;
  const cutoff = Math.min(now, sessionEnd);
  const elapsedHours = Math.max(0, cutoff - anchor) / 3600000;
  return Number(state.sessionAccrued || 0) + ratePerHour * elapsedHours;
}

function getNextHalvingAt(epoch) {
  const start = new Date(NETWORK_START_AT).getTime();
  const halvingMs = HALVING_DAYS * 24 * 60 * 60 * 1000;
  return start + (Math.max(0, epoch) + 1) * halvingMs;
}

function formatCountdownLong(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

function getInitialTab() {
  if (typeof window === "undefined") return "news";
  const tab = new URLSearchParams(window.location.search).get("tab");
  const allowedTabs = new Set([
    "news",
    "mining",
    "protocol",
    "rate_breakdown",
    "epoch",
    "referrals",
    "ranks",
    "leaderboard",
    "profile",
    "admin",
  ]);

  return allowedTabs.has(tab) ? tab : "news";
}

function isTelegramWebAppAvailable() {
  if (typeof window === "undefined") return false;
  return Boolean(window.Telegram?.WebApp);
}

function App() {
  const [telegramIdentity, setTelegramIdentity] = useState(null);
  const [telegramReady, setTelegramReady] = useState(false);

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 40;
    const hasTelegramWebApp = isTelegramWebAppAvailable();

    const tryResolveIdentity = () => {
      const identity = getTelegramIdentity();
      if (identity?.telegramUserId && identity?.username) {
        setTelegramIdentity(identity);
        if (identity.initData || attempts >= 2) {
          setTelegramReady(true);
          return;
        }
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(tryResolveIdentity, 250);
      } else {
        if (identity) {
          setTelegramIdentity(identity);
        }
        if (hasTelegramWebApp) {
          console.error("Telegram Mini App identity is missing signed initData.");
        }
        setTelegramReady(true);
      }
    };

    tryResolveIdentity();
  }, []);

  const initialState = useMemo(
    () => ({
      ...loadState(),
      ...(telegramIdentity
        ? {
            username: telegramIdentity.username,
            inviteCode: telegramIdentity.inviteCode,
          }
        : {}),
    }),
    [telegramIdentity]
  );
  const [state, setState] = useState(initialState);
  const [now, setNow] = useState(Date.now());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedReferralLink, setCopiedReferralLink] = useState(false);
  const [activeTab, setActiveTab] = useState(() => getInitialTab());
  const [activityFilter, setActivityFilter] = useState("all");
  const [rankSort, setRankSort] = useState("desc");
  const [announcement, setAnnouncement] = useState(null);
  const [databaseReferrals, setDatabaseReferrals] = useState([]);
  const [databaseLeaderboard, setDatabaseLeaderboard] = useState([]);
  const [protocolSnapshot, setProtocolSnapshot] = useState(null);
  const [usingSupabase, setUsingSupabase] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [profileId, setProfileId] = useState(null);
  const [newReferralName, setNewReferralName] = useState("");
  const [newReferralRank, setNewReferralRank] = useState("pioneer");
  const [teamMessage, setTeamMessage] = useState("");
  const [teamBusy, setTeamBusy] = useState(false);
  const [manualReferralCode, setManualReferralCode] = useState("");
  const [adminAnnouncements, setAdminAnnouncements] = useState([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [announcementForm, setAnnouncementForm] = useState({
    slug: "",
    eyebrow: "@SFOXCoreTeam",
    title: "",
    body: "",
    primaryCtaLabel: "Announcement",
    secondaryCtaLabel: "Open forum",
    primaryCtaTarget: "",
    secondaryCtaTarget: "",
    isActive: true,
  });
  const lastAppliedRateRef = useRef(null);

  const openExternalTarget = (target) => {
    if (!target) return false;

    try {
      const webApp = window.Telegram?.WebApp;
      if (target.startsWith("https://t.me/") || target.startsWith("tg://")) {
        webApp?.openTelegramLink?.(target);
      } else {
        webApp?.openLink?.(target, { try_instant_view: true });
      }
    } catch {
      // Fall through to browser open.
    }

    window.open(target, "_blank", "noopener,noreferrer");
    return true;
  };

  const openTelegramReferralLink = () => {
    const deepLink = buildTelegramReferralLink(state.inviteCode);
    const webApp = window.Telegram?.WebApp;

    try {
      webApp?.openTelegramLink?.(deepLink);
    } catch {
      // Ignore and fall back to browser open below.
    }

    window.open(deepLink, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!state.canManageAdmin || !usingSupabase) return;

    listAdminAnnouncements(telegramIdentity)
      .then((items) => setAdminAnnouncements(items))
      .catch((error) => {
        console.error("Failed to load admin announcements", error);
      });
  }, [state.canManageAdmin, usingSupabase, announcement, telegramIdentity]);

  useEffect(() => {
    if (!telegramIdentity) return;

    setState((current) => ({
      ...current,
      username: telegramIdentity.username,
      inviteCode: telegramIdentity.inviteCode,
      telegramUserId: telegramIdentity.telegramUserId,
      telegramUsername: telegramIdentity.username,
      telegramFirstName: telegramIdentity.firstName,
      telegramLastName: telegramIdentity.lastName,
      telegramPhotoUrl: telegramIdentity.photoUrl,
    }));
  }, [telegramIdentity]);

  useEffect(() => {
    let cancelled = false;
    const hasTelegramWebApp = isTelegramWebAppAvailable();

    if (!telegramReady) {
      return undefined;
    }

    if (hasSupabaseConfig && hasTelegramWebApp && !telegramIdentity?.telegramUserId) {
      console.error("SFOX could not read Telegram identity. Live data bootstrap was skipped.");
      setBootstrapReady(true);
      return undefined;
    }

    const bootstrap = async () => {
      try {
        const bootstrapState = {
          ...defaultState,
          ...(telegramIdentity
            ? {
                username: telegramIdentity.username,
                inviteCode: telegramIdentity.inviteCode,
              }
            : {}),
        };

        const result = await loadAppBootstrap(bootstrapState, telegramIdentity);

        if (cancelled) return;

        if (result.state) {
          setState((current) => ({
            ...current,
            ...result.state,
            canManageAdmin: Boolean(result.isAdmin),
          }));
        }

        setAnnouncement(result.announcement || null);
        setDatabaseReferrals(result.referrals || []);
        setDatabaseLeaderboard(result.leaderboard || []);
        setProtocolSnapshot(result.protocol || null);
        setUsingSupabase(result.usingSupabase);
        setProfileId(result.profileId || null);
      } catch (error) {
        console.error("Failed to load app bootstrap", error);
      } finally {
        if (!cancelled) {
          setBootstrapReady(true);
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [telegramIdentity, telegramReady]);

  useEffect(() => {
    if (!usingSupabase || !profileId) return undefined;

    return subscribeToAppData({
      profileId,
      defaultState,
      identity: telegramIdentity,
      onData: (result) => {
        setAnnouncement(result.announcement || null);
        setDatabaseReferrals(result.referrals || []);
        setDatabaseLeaderboard(result.leaderboard || []);
        setProtocolSnapshot(result.protocol || null);
        if (result.state) {
          setState((current) => ({
            ...current,
            ...result.state,
            canManageAdmin: current.canManageAdmin,
          }));
        }
      },
      onError: (error) => {
        console.error("Realtime refresh failed", error);
      },
    });
  }, [profileId, telegramIdentity, usingSupabase]);

  useEffect(() => {
    let frameId;

    const tick = () => {
      setNow(Date.now());
      frameId = window.setTimeout(() => {
        window.requestAnimationFrame(tick);
      }, 80);
    };

    tick();

    return () => {
      window.clearTimeout(frameId);
    };
  }, []);

  const globalEpoch = getGlobalEpoch(now);
  const unlockedRankKey = getEligibleRank(state.activeReferrals, state.joinedEarly);
  const permanentRankKey = getHigherRank(state.currentRank || "miner", unlockedRankKey);
  const effectiveRankKey = permanentRankKey;
  const rank = rankMap[effectiveRankKey];
  const eligibleRank = rankMap[permanentRankKey];
  const nextRank = useMemo(() => {
    if (permanentRankKey === "miner") {
      return state.joinedEarly
        ? { label: "Pioneer", requirement: "Early-adopter bonus is active" }
        : { label: "Lord", requirement: "Reach 10 active referrals" };
    }
    if (permanentRankKey === "pioneer") {
      return { label: "Lord", requirement: "Reach 10 active referrals" };
    }
    if (permanentRankKey === "lord") {
      return { label: "Baron", requirement: "Reach 50 active referrals" };
    }
    if (permanentRankKey === "baron") {
      return { label: "President", requirement: "Reach 100 active referrals" };
    }
    if (permanentRankKey === "president") {
      return { label: "Titan", requirement: "Reach 500 active referrals" };
    }
    return { label: "Titan", requirement: "Highest whitepaper rank reached" };
  }, [permanentRankKey, state.joinedEarly]);
  const rankEntries = useMemo(
    () => Object.entries(rankMap).filter(([key]) => key !== "miner"),
    []
  );

  const mining = useMemo(() => {
    const baseRate = getBaseRate(globalEpoch);
    const pioneerLifetimeBonus =
      state.joinedEarly && effectiveRankKey !== "miner" && effectiveRankKey !== "pioneer"
        ? rankMap.pioneer.boost
        : 0;
    const fixedMultiplier = rank.boost + pioneerLifetimeBonus;
    const referralBonus = rank.referralRate * state.activeReferrals;
    const referralFactor = 1 + referralBonus;
    const totalRate = baseRate * fixedMultiplier * referralFactor;
    const sessionReward = getSessionReward(totalRate);
    const sessionEnd = getSessionEnd(state.miningStartedAt);
    const isRunning = Boolean(state.miningStartedAt && sessionEnd && now < sessionEnd);
    const claimReady = Boolean(
      state.miningStartedAt && sessionEnd && now >= sessionEnd && !state.sessionClaimed
    );
    const remainingMs = isRunning ? sessionEnd - now : 0;
    const sessionEarned = getSessionAccrual(state, totalRate, now);

    return {
      baseRate,
      pioneerLifetimeBonus,
      fixedMultiplier,
      referralBonus,
      referralFactor,
      totalRate,
      sessionReward,
      sessionEarned,
      sessionEnd,
      isRunning,
      claimReady,
      remainingMs,
    };
  }, [
    effectiveRankKey,
    globalEpoch,
    now,
    rank,
    state.activeReferrals,
    state.joinedEarly,
    state.miningStartedAt,
    state.sessionAccrued,
    state.sessionAccrualUpdatedAt,
    state.sessionClaimed,
  ]);

  useEffect(() => {
    if (state.currentRank === permanentRankKey) return;
    setState((current) => ({ ...current, currentRank: permanentRankKey }));
  }, [permanentRankKey, state.currentRank]);

  const handleStatePatch = (patch) => {
    setState((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    if (!state.miningStartedAt || state.sessionClaimed) {
      lastAppliedRateRef.current = mining.totalRate;
      return;
    }

    const previousRate = lastAppliedRateRef.current;
    if (previousRate == null) {
      lastAppliedRateRef.current = mining.totalRate;
      return;
    }

    if (Math.abs(previousRate - mining.totalRate) < 1e-12) {
      return;
    }

    const anchor = state.sessionAccrualUpdatedAt || state.miningStartedAt;
    const sessionEnd = getSessionEnd(state.miningStartedAt);
    const cutoff = Math.min(now, sessionEnd || now);
    if (cutoff <= anchor) {
      lastAppliedRateRef.current = mining.totalRate;
      return;
    }

    const accruedAddition = previousRate * ((cutoff - anchor) / 3600000);
    setState((current) => ({
      ...current,
      sessionAccrued: Number(current.sessionAccrued || 0) + accruedAddition,
      sessionAccrualUpdatedAt: cutoff,
    }));
    lastAppliedRateRef.current = mining.totalRate;
  }, [
    mining.totalRate,
    now,
    state.miningStartedAt,
    state.sessionAccrualUpdatedAt,
    state.sessionClaimed,
  ]);

  const applyReferralMembers = (nextMembers) => {
    const summary = buildReferralSummary(
      nextMembers.map((member) => ({
        is_active: member.active ?? member.is_active,
      }))
    );

    setDatabaseReferrals(nextMembers.map((member) => ({
      id: member.id,
      username: member.name ?? member.username,
      rank: member.rank,
      is_active: member.active ?? member.is_active,
      last_reminded_at: member.last_reminded_at ?? null,
    })));

    setState((current) => ({
      ...current,
      activeReferrals: summary.activeReferrals,
      totalReferrals: summary.totalReferrals,
    }));
  };

  const handleStartMining = async () => {
    if (mining.isRunning || mining.claimReady) return;
    const startedAt = Date.now();
    const nextState = {
      ...state,
      sessionAccrued: 0,
      sessionAccrualUpdatedAt: startedAt,
      miningStartedAt: startedAt,
      sessionClaimed: false,
    };

    handleStatePatch({
      sessionAccrued: 0,
      sessionAccrualUpdatedAt: startedAt,
      miningStartedAt: startedAt,
      sessionClaimed: false,
    });
    lastAppliedRateRef.current = mining.totalRate;

    if (!bootstrapReady) return;

    try {
      await persistProfileState({
        state: nextState,
        currentRank: permanentRankKey,
        currentRate: mining.totalRate,
        currentEpoch: globalEpoch,
        profileId,
        identity: telegramIdentity,
      });
    } catch (error) {
      console.error("Failed to start mining session", error);
      handleStatePatch({
        sessionAccrued: 0,
        sessionAccrualUpdatedAt: null,
        miningStartedAt: state.miningStartedAt,
        sessionClaimed: state.sessionClaimed,
      });
    }
  };

  const handleClaimMining = async () => {
    if (!mining.claimReady) return;
    const claimedAt = Date.now();

    try {
      if (usingSupabase && profileId && state.miningStartedAt && mining.sessionEnd) {
        const claimResult = await recordMiningClaim({
          profileId,
          epoch: globalEpoch,
          sessionStartedAt: state.miningStartedAt,
          sessionEndedAt: mining.sessionEnd,
          claimedAt,
          amount: mining.sessionReward,
          identity: telegramIdentity,
        });

        handleStatePatch({
          totalMined: Number(claimResult?.totalMined ?? state.totalMined + mining.sessionEarned),
          sessionAccrued: 0,
          sessionAccrualUpdatedAt: null,
          miningStartedAt: null,
          sessionClaimed: true,
          lastClaimedAt: claimedAt,
          currentRank: permanentRankKey,
        });
        lastAppliedRateRef.current = 0;
        return;
      }

      handleStatePatch({
        totalMined: state.totalMined + mining.sessionEarned,
        sessionAccrued: 0,
        sessionAccrualUpdatedAt: null,
        miningStartedAt: null,
        sessionClaimed: true,
        lastClaimedAt: claimedAt,
        currentRank: permanentRankKey,
      });
    } catch (error) {
      console.error("Failed to record mining claim", error);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(state.inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const handleCopyReferralLink = async () => {
    try {
      await navigator.clipboard.writeText(buildTelegramReferralLink(state.inviteCode));
      setCopiedReferralLink(true);
      window.setTimeout(() => setCopiedReferralLink(false), 1200);
    } catch {
      setCopiedReferralLink(false);
    }
  };

  const handleAdminFieldChange = (field, value) => {
    setAnnouncementForm((current) => ({ ...current, [field]: value }));
  };

  const handleLoadAnnouncementIntoEditor = (item) => {
    setAnnouncementForm({
      slug: item.slug || "",
      eyebrow: item.eyebrow || "@SFOXCoreTeam",
      title: item.title || "",
      body: item.body || "",
      primaryCtaLabel: item.primaryCtaLabel || "Announcement",
      secondaryCtaLabel: item.secondaryCtaLabel || "Open forum",
      primaryCtaTarget: item.primaryCtaTarget || "",
      secondaryCtaTarget: item.secondaryCtaTarget || "",
      isActive: item.isActive ?? true,
    });
    setAdminMessage(`Loaded ${item.slug || item.title} into the editor.`);
  };

  const handleToggleAdminAnnouncement = async (item) => {
    setAdminBusy(true);
    setAdminMessage("");

    try {
      const updated = await toggleAnnouncementActive({
        slug: item.slug,
        isActive: !item.isActive,
        identity: telegramIdentity,
      });
      setAdminAnnouncements((current) =>
        current.map((entry) => (entry.slug === updated.slug ? updated : entry))
      );
      if (announcement?.slug === updated.slug) {
        setAnnouncement(updated.isActive ? updated : null);
      }
      setAdminMessage(
        `${updated.slug} is now ${updated.isActive ? "active" : "inactive"}.`
      );
    } catch (error) {
      console.error("Failed to toggle announcement", error);
      setAdminMessage(error?.message || "Could not update announcement status.");
    } finally {
      setAdminBusy(false);
    }
  };

  const handleSaveAnnouncement = async () => {
    if (!announcementForm.title.trim() || !announcementForm.body.trim()) {
      setAdminMessage("Title and body are required.");
      return;
    }

    setAdminBusy(true);
    setAdminMessage("");

    try {
      const saved = await saveAnnouncement(announcementForm, telegramIdentity);
      setAdminMessage("Announcement published.");
      setAnnouncement(saved);
      setAdminAnnouncements((current) => {
        const next = current.filter((item) => item.title !== saved.title);
        return [saved, ...next];
      });
      setAnnouncementForm((current) => ({
        ...current,
        slug: current.slug || "",
      }));
    } catch (error) {
      console.error("Failed to save announcement", error);
      setAdminMessage(error?.message || "Could not save announcement.");
    } finally {
      setAdminBusy(false);
    }
  };

  const handleAddReferralMember = async () => {
    const trimmedName = newReferralName.trim();
    if (!trimmedName) {
      setTeamMessage("Enter a referral username first.");
      return;
    }

    if (referrals.some((member) => member.name.toLowerCase() === trimmedName.toLowerCase())) {
      setTeamMessage("That referral username already exists in your team.");
      return;
    }

    setTeamBusy(true);
    setTeamMessage("");

    try {
      if (usingSupabase && profileId) {
        const created = await createReferralMember({
          profileId,
          username: trimmedName,
          rank: newReferralRank,
          identity: telegramIdentity,
        });

        const nextMembers = [
          ...referrals,
          {
            id: created.id,
            name: created.username,
            rank: created.rank,
            active: created.is_active,
            last_reminded_at: created.last_reminded_at,
          },
        ];
        applyReferralMembers(nextMembers);
      } else {
        const nextMembers = [
          ...referrals,
          {
            id: `${trimmedName}-${Date.now()}`,
            name: trimmedName,
            rank: newReferralRank,
            active: false,
            last_reminded_at: null,
          },
        ];
        applyReferralMembers(nextMembers);
      }

      setNewReferralName("");
      setNewReferralRank("pioneer");
      setTeamMessage("Referral member added.");
    } catch (error) {
      console.error("Failed to add referral member", error);
      setTeamMessage("Could not add that referral member.");
    } finally {
      setTeamBusy(false);
    }
  };

  const handleRemindMember = async (member) => {
    setTeamBusy(true);
    setTeamMessage("");

    try {
      if (usingSupabase && member.id) {
        const result = await remindReferralMember(member.id, telegramIdentity);
        const nextMembers = referrals.map((entry) =>
          entry.id === member.id
            ? {
                ...entry,
                last_reminded_at: result.referral.last_reminded_at,
              }
            : entry
        );
        applyReferralMembers(nextMembers);

        if (result.delivery === "share_link" && result.shareLink) {
          await navigator.clipboard.writeText(result.shareLink);
          setTeamMessage(`Referral link copied for ${member.name}. Send it so they can join and activate mining.`);
          return;
        }
      }

      setTeamMessage(`Reminder sent to ${member.name}.`);
    } catch (error) {
      console.error("Failed to remind referral member", error);
      setTeamMessage("Could not send reminder.");
    } finally {
      setTeamBusy(false);
    }
  };

  const handleRemindInactiveMembers = async () => {
    const inactiveMembers = referrals.filter((member) => !member.active);
    if (!inactiveMembers.length) {
      setTeamMessage("Everyone is already active.");
      return;
    }

    setTeamBusy(true);
    setTeamMessage("");

    try {
      if (usingSupabase && profileId) {
        const updatedMembers = await remindInactiveReferralMembers(profileId, telegramIdentity);
        const updatedMap = new Map(updatedMembers.map((entry) => [entry.id, entry]));
        const nextMembers = referrals.map((entry) => {
          const updated = updatedMap.get(entry.id);
          return updated
            ? {
                ...entry,
                last_reminded_at: updated.last_reminded_at,
              }
            : entry;
        });
        applyReferralMembers(nextMembers);
      }

      setTeamMessage("Inactive members were reminded.");
    } catch (error) {
      console.error("Failed to remind inactive members", error);
      setTeamMessage("Could not remind inactive members.");
    } finally {
      setTeamBusy(false);
    }
  };

  const handleApplyReferralCode = async () => {
    const trimmedCode = manualReferralCode.trim().toUpperCase();
    if (!trimmedCode) {
      setTeamMessage("Enter a referral code first.");
      return;
    }
    if (!profileId) {
      setTeamMessage("Your profile is still loading.");
      return;
    }
    if (state.referredByProfileId) {
      setTeamMessage("A referral has already been linked to this account.");
      return;
    }

    setTeamBusy(true);
    setTeamMessage("");

    try {
      const updatedProfile = await applyReferralCode({
        profileId,
        code: trimmedCode,
        identity: telegramIdentity,
      });

      setState((current) => ({
        ...current,
        referredByProfileId: updatedProfile.state?.referredByProfileId || current.referredByProfileId,
        referralCodeAppliedAt: updatedProfile.state?.referralCodeAppliedAt || current.referralCodeAppliedAt,
        inviterDisplayName: updatedProfile.state?.inviterDisplayName || current.inviterDisplayName,
        inviterUsername: updatedProfile.state?.inviterUsername || current.inviterUsername,
      }));
      setManualReferralCode("");
      setTeamMessage("Referral code applied.");
    } catch (error) {
      console.error("Failed to apply referral code", error);
      setTeamMessage(error?.message || "Could not apply referral code.");
    } finally {
      setTeamBusy(false);
    }
  };

  const statusText = mining.isRunning
    ? "Mining now"
    : mining.claimReady
      ? "Claim ready"
      : "Ready to mine";
  const rankBoosterFactor = mining.fixedMultiplier;
  const referralBoosterFactor = mining.referralFactor;
  const possibleRateText = formatRate(mining.totalRate);

  const countdownText = mining.isRunning
    ? formatCountdown(mining.remainingMs)
    : mining.claimReady
      ? "24:00:00"
      : "00:00:00";
  const earlyAdopterStartLabel = formatFullDateTime(NETWORK_START_AT);
  const nextHalvingAt = getNextHalvingAt(globalEpoch);
  const nextHalvingCountdown = formatCountdownLong(nextHalvingAt - now);
  const phoneHeaderDate = formatPhoneHeaderDate(state.profileCreatedAt);
  const profileDisplayName = telegramIdentity?.firstName || state.telegramFirstName || state.username;
  const isAdmin = Boolean(state.canManageAdmin);
  const connectedFallbackTime = usingSupabase ? new Date().toISOString() : null;
  const joinedValue = state.profileCreatedAt || state.profileUpdatedAt || connectedFallbackTime;
  const lastSyncValue = state.profileUpdatedAt || state.profileCreatedAt || connectedFallbackTime;

  const leftActions = [
    { icon: "N", key: "news", label: "News", value: "Feed" },
    {
      icon: "M",
      key: "mining",
      label: "Mining",
      value: activeTab === "news" ? "" : formatRate(mining.totalRate),
    },
    {
      icon: "R",
      key: "referrals",
      label: "Referral team",
      value: `${state.activeReferrals}/${state.totalReferrals}`,
    },
    { icon: "K", key: "ranks", label: "Ranks", value: eligibleRank.label },
    { icon: "P", key: "profile", label: "Profile", value: state.username },
  ];

  const rightStats = [
    {
      label: "Active miners",
      value: `${state.activeReferrals}/${state.totalReferrals}`,
    },
    {
      label: "Possible rate",
      value: possibleRateText,
      type: "button",
      active: activeTab === "rate_breakdown",
      onClick: () => setActiveTab("rate_breakdown"),
    },
    {
      label: "Mining",
      value: mining.isRunning ? "On" : "Off",
      type: "button",
      tone: mining.isRunning ? "live" : "idle",
      onClick: () => setActiveTab("mining"),
    },
    {
      label: "Epoch",
      value: `${globalEpoch}`,
      type: "button",
      active: activeTab === "epoch",
      onClick: () => setActiveTab("epoch"),
    },
  ];
  const appTabs = [
    { key: "news", label: "News" },
    { key: "mining", label: "Mining" },
    { key: "protocol", label: "Protocol" },
    { key: "rate_breakdown", label: "Possible Rate" },
    { key: "epoch", label: "Epoch" },
    { key: "referrals", label: "Referrals" },
    { key: "ranks", label: "Ranks" },
    { key: "leaderboard", label: "Global Leaderboard" },
    { key: "migration", label: "Migration to Mainnet" },
    { key: "withdraw", label: "Withdraw" },
    { key: "profile", label: "Profile" },
    ...(isAdmin ? [{ key: "admin", label: "Admin" }] : []),
  ];
  const referralBonusPercent = mining.referralBonus * 100;
  const referrals = useMemo(() => {
    const source = usingSupabase ? databaseReferrals : fallbackReferralMembers;

    return source.slice(0, state.totalReferrals).map((member, index) => ({
      id: member.id ?? `${member.username}-${index}`,
      name: member.name ?? member.username,
      rank: member.rank,
      active: member.active ?? member.is_active ?? index < state.activeReferrals,
      last_reminded_at: member.last_reminded_at ?? null,
    }));
  }, [databaseReferrals, state.activeReferrals, state.totalReferrals, usingSupabase]);
  const filteredReferrals = useMemo(() => {
    const filtered =
      activityFilter === "all"
        ? referrals
        : referrals.filter((member) => (activityFilter === "active" ? member.active : !member.active));

    return [...filtered].sort((a, b) => {
      const diff = rankOrder[a.rank] - rankOrder[b.rank];
      return rankSort === "asc" ? diff : -diff;
    });
  }, [activityFilter, rankSort, referrals]);
  const activeReferralPercent =
    state.totalReferrals > 0
      ? Math.min(100, Math.round((state.activeReferrals / state.totalReferrals) * 100))
      : 0;
  const nextRankTarget =
    permanentRankKey === "titan"
      ? state.activeReferrals
      : rankMap[nextRank.label.toLowerCase()]?.minReferrals || eligibleRank.minReferrals;
  const nextRankRequirement = nextRankTarget || state.activeReferrals;
  const nextRankProgress =
    nextRankTarget > 0 ? Math.min(100, Math.round((state.activeReferrals / nextRankTarget) * 100)) : 100;
  const leaderboardEntries = useMemo(() => {
    const source = usingSupabase ? databaseLeaderboard : fallbackLeaderboardEntries;
    const currentUserEntry = {
      username: state.username,
      displayName: profileDisplayName,
      rank: permanentRankKey,
      mined: state.totalMined,
      active: state.activeReferrals,
      total: state.totalReferrals,
      rate: mining.totalRate,
      isCurrentUser: true,
    };

    const mergedEntries = source
      .filter((entry) => entry.username !== state.username)
      .map((entry) => ({
        ...entry,
        isCurrentUser: false,
      }));

    return [...mergedEntries, currentUserEntry]
      .sort((a, b) => b.mined - a.mined)
      .map((entry, index) => ({ ...entry, position: index + 1 }));
  }, [
    databaseLeaderboard,
    permanentRankKey,
    mining.totalRate,
    state.activeReferrals,
    state.totalMined,
    state.totalReferrals,
    state.username,
    usingSupabase,
  ]);
  const leaderboardTop = leaderboardEntries.slice(0, 3);

  return (
    <div className="page">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark" />
            <div>
              <strong>SFOX</strong>
              <small>Mobile mining app</small>
            </div>
          </div>
          <button
            className="sidebar-close"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            x
          </button>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">Pages</p>
          <div className="sidebar-page-nav">
            {appTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`sidebar-page-button ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab.key);
                  setSidebarOpen(false);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">Network</p>
          <div className="sidebar-card">
            <span>Invite code</span>
            <strong>{state.inviteCode}</strong>
            <button className="ghost-button" type="button" onClick={handleCopyCode}>
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">Rank summary</p>
          <div className="sidebar-card accent">
            <RankBadge rankKey={permanentRankKey} label={eligibleRank.label} />
            <span>Actual rank now</span>
            <strong>{eligibleRank.label}</strong>
            <small>{eligibleRank.note}</small>
          </div>
        </div>
      </aside>

      <div className="app">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            ≡
          </button>

          <div className="balance-strip">
            <strong>{formatTotal(state.totalMined)}</strong>
            <span>balance</span>
          </div>
        </header>

        <main className="app-layout">
          {(activeTab === "news" || activeTab === "mining") && (
            <>
              <section className="phone-stage">
                <div className="phone-header">
                  <div>
                    <strong>{profileDisplayName}</strong>
                    <small>{phoneHeaderDate}</small>
                    {state.inviterDisplayName && (
                      <small className="phone-header-subline">
                        Invited by {state.inviterDisplayName}
                      </small>
                    )}
                  </div>
                  <div className="phone-header-pill">{statusText}</div>
                </div>

                <div className="phone-screen">
                  <div className="left-rail">
                    {leftActions.map((item) => (
                      <button
                        key={item.label}
                        className={`rail-button ${activeTab === item.key ? "active" : ""}`}
                        type="button"
                        onClick={() => setActiveTab(item.key)}
                      >
                        <span className="rail-icon">{item.icon}</span>
                        <span className="rail-meta">
                          <small>{item.label}</small>
                          <strong>{item.value}</strong>
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className={`center-stage ${activeTab === "news" ? "center-stage-news" : ""}`}>
                    {activeTab === "news" ? (
                      <div className="news-center">
                        <h1>SFOX Feed</h1>
                        <p className="welcome-line">COMMUNITY UPDATES, ANNOUNCEMENTS, AND PRODUCT NEWS</p>

                        {announcement ? (
                          <>
                            <div className="news-cta-row">
                              <button
                                className="news-cta"
                                type="button"
                                onClick={() => {
                                  if (!openExternalTarget(announcement.primaryCtaTarget)) {
                                    document.querySelector(".news-post")?.scrollIntoView({
                                      behavior: "smooth",
                                      block: "start",
                                    });
                                  }
                                }}
                              >
                                {announcement.primaryCtaLabel}
                              </button>
                              <button
                                className="news-cta alt"
                                type="button"
                                onClick={() => {
                                  if (!openExternalTarget(announcement.secondaryCtaTarget)) {
                                    setActiveTab("referrals");
                                  }
                                }}
                              >
                                {announcement.secondaryCtaLabel}
                              </button>
                            </div>

                            <article className="news-post inline">
                              <div className="news-post-top">
                                <span className="news-meta">{announcement.eyebrow}</span>
                                <small>{announcement.publishedLabel}</small>
                              </div>
                              <strong>{announcement.title}</strong>
                              <p>{announcement.body}</p>
                            </article>

                            <div className="news-bottom-actions">
                              <button className="news-bottom-button" type="button" onClick={handleCopyCode}>
                                Invite
                              </button>
                              <button
                                className="news-bottom-button"
                                type="button"
                                onClick={() => setActiveTab("mining")}
                              >
                                Open mining
                              </button>
                            </div>
                          </>
                        ) : (
                          <article className="news-post inline empty-state-card">
                            <div className="news-post-top">
                              <span className="news-meta">@SFOXCoreTeam</span>
                            </div>
                            <strong>No announcements yet</strong>
                            <p>Publish real news records in Supabase and they will appear here automatically.</p>
                          </article>
                        )}
                      </div>
                    ) : (
                      <>
                        <RankHeroBadge rankKey={permanentRankKey} label={eligibleRank.label} />
                        <div className="mining-ring">
                          <div className="mining-ring-inner">
                            <div className="ring-readout">
                              <span className="ring-label">This session</span>
                              <strong>{formatSessionEarned(mining.sessionEarned)}</strong>
                              <small>SFOX mined</small>
                            </div>
                          </div>
                        </div>

                        <h1>SFOX Mining</h1>
                        <p className="welcome-line">ACTIVATE YOUR DAILY NETWORK SESSION</p>
                        <p className="countdown-line">{countdownText}</p>

                        <div className="cta-group">
                          <button
                            className="primary-button"
                            type="button"
                            onClick={handleStartMining}
                            disabled={mining.isRunning || mining.claimReady}
                          >
                            {mining.isRunning ? "Mining live" : "Start mining"}
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={handleClaimMining}
                            disabled={!mining.claimReady}
                          >
                            Claim session
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {activeTab === "mining" && (
                    <div className="right-rail">
                      {rightStats.map((item) => (
                        item.type === "button" ? (
                          <button
                            key={item.label}
                            type="button"
                            className={`side-stat side-stat-button ${item.active ? "active" : ""} ${
                              item.tone ? `tone-${item.tone}` : ""
                            }`}
                            onClick={item.onClick}
                          >
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </button>
                        ) : (
                          <article key={item.label} className="side-stat">
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </article>
                        )
                      ))}
                    </div>
                  )}
                </div>
              </section>

            </>
          )}

          {activeTab === "referrals" && (
            <section className="app-page referral-team-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Team command</span>
                <h2>Referral Team</h2>
                <p>
                  Invite miners, see who is active, and know exactly what to do next.
                </p>
              </div>

              <section className="team-dashboard page-panels">
                <article className="team-hero-card">
                  <div className="team-hero-copy">
                    <span className="reading-kicker">Team control center</span>
                    <h3>Build an active mining team, not just a large list.</h3>
                    <p>
                      Your referral power comes from miners who stay active. Bring people in, keep
                      them mining, and let every active referral add to your live rate.
                    </p>
                    <div className="team-hero-pills">
                      <span>{state.activeReferrals} active miners</span>
                      <span>+{(eligibleRank.referralRate * 100).toFixed(0)}% per active referral</span>
                      <span>{eligibleRank.label} rank live</span>
                    </div>
                  </div>
                  <div className="team-hero-side">
                    <div className="team-invite-card">
                      <span>Invite code</span>
                      <strong>{state.inviteCode}</strong>
                      {state.inviterDisplayName && (
                        <small className="team-invite-note">
                          Invited by {state.inviterDisplayName}
                        </small>
                      )}
                    </div>
                    <button className="primary-button team-copy-button" type="button" onClick={handleCopyCode}>
                      {copied ? "Copied" : "Copy invite"}
                    </button>
                    <button
                      className="ghost-button team-copy-button"
                      type="button"
                      onClick={handleCopyReferralLink}
                    >
                      {copiedReferralLink ? "Link copied" : "Copy referral link"}
                    </button>
                    <button className="ghost-button team-copy-button" type="button" onClick={openTelegramReferralLink}>
                      Open Telegram invite
                    </button>
                  </div>
                </article>

                <div className="team-stat-grid">
                  <article className="team-stat-card accent-blue">
                    <span>Active team</span>
                    <strong>
                      {state.activeReferrals}/{state.totalReferrals}
                    </strong>
                    <p>{activeReferralPercent}% mining today</p>
                  </article>
                  <article className="team-stat-card accent-green">
                    <span>Current rank</span>
                    <strong>{eligibleRank.label}</strong>
                    <p>{eligibleRank.multiplierLabel} team boost</p>
                  </article>
                  <article className="team-stat-card accent-indigo">
                    <span>Possible rate</span>
                    <strong>{possibleRateText}</strong>
                    <p>With current active team</p>
                  </article>
                  <article className="team-stat-card accent-amber">
                    <span>Referral bonus</span>
                    <strong>+{referralBonusPercent.toFixed(0)}%</strong>
                    <p>From {state.activeReferrals} active miners</p>
                  </article>
                </div>

                <section className="team-insight-grid">
                  <article className="team-progress-card">
                    <div className="team-progress-head">
                      <div>
                        <span className="reading-kicker">Next push</span>
                        <h3>{nextRank.label}</h3>
                        <p>{nextRank.requirement}</p>
                      </div>
                      <div className="team-progress-badge">{nextRankProgress}%</div>
                    </div>
                    <div className="team-progress-shell">
                      <div className="team-progress-bar" style={{ width: `${nextRankProgress}%` }} />
                    </div>
                    <div className="team-progress-meta">
                      <span>{state.activeReferrals} active now</span>
                      <span>{Math.max(0, nextRankRequirement - state.activeReferrals)} to go</span>
                    </div>
                  </article>

                  <article className="team-rules-card">
                    <span className="reading-kicker">How rewards work</span>
                    <h3>Only active miners increase your referral power.</h3>
                    <div className="team-rule-list">
                      <div className="team-rule-item">
                        <strong>Every active referral counts</strong>
                        <p>There is no overflow threshold in the updated whitepaper model.</p>
                      </div>
                      <div className="team-rule-item">
                        <strong>Per-referral boost</strong>
                        <p>Each active miner adds +{(eligibleRank.referralRate * 100).toFixed(0)}% at your current rank.</p>
                      </div>
                      <div className="team-rule-item">
                        <strong>Inactive members</strong>
                        <p>Anyone not mining today adds zero to the percentage reward.</p>
                      </div>
                    </div>
                  </article>
                </section>

                <section className="team-action-grid">
                  <article className="team-add-card">
                    <span className="reading-kicker">Add member</span>
                    <h3>Add a new referral to your team</h3>
                    <p>Create a referral member entry and start tracking their activity.</p>
                    <div className="team-add-form">
                      <input
                        type="text"
                        placeholder="Referral username"
                        value={newReferralName}
                        onChange={(event) => setNewReferralName(event.target.value)}
                      />
                      <select value={newReferralRank} onChange={(event) => setNewReferralRank(event.target.value)}>
                        {Object.entries(rankMap)
                          .filter(([key]) => key !== "miner")
                          .map(([key, value]) => (
                            <option key={key} value={key}>
                              {value.label}
                            </option>
                          ))}
                      </select>
                      <button
                        className="primary-button team-add-button"
                        type="button"
                        onClick={handleAddReferralMember}
                        disabled={teamBusy}
                      >
                        Add referral
                      </button>
                    </div>
                  </article>

                  <article className="team-action-card">
                    <span className="reading-kicker">Team actions</span>
                    <h3>Bring inactive members back online</h3>
                    <p>
                      Send reminders to inactive members so they can start mining again and count
                      toward your active referral reward.
                    </p>
                    <button
                      className="ghost-button team-bulk-button"
                      type="button"
                      onClick={handleRemindInactiveMembers}
                      disabled={teamBusy}
                    >
                      Remind inactive members
                    </button>
                    {teamMessage && <p className="team-feedback">{teamMessage}</p>}
                  </article>
                </section>

                {!state.referredByProfileId && (
                  <section className="team-action-grid">
                    <article className="team-add-card">
                      <span className="reading-kicker">Join with a code</span>
                      <h3>Use a referral code if you joined without one</h3>
                      <p>Paste a valid SFOX invite code to attach this account to a referrer.</p>
                      <div className="team-add-form">
                        <input
                          type="text"
                          placeholder="SFOX-XXXX-0000"
                          value={manualReferralCode}
                          onChange={(event) => setManualReferralCode(event.target.value)}
                        />
                        <button
                          className="primary-button team-add-button"
                          type="button"
                          onClick={handleApplyReferralCode}
                          disabled={teamBusy}
                        >
                          Apply code
                        </button>
                      </div>
                    </article>
                  </section>
                )}

                <article className="home-referrals team-directory">
                  <div className="team-directory-head">
                    <div>
                      <span className="reading-kicker">Team list</span>
                      <h2>Members</h2>
                      <p>Focus on who is active, who needs a reminder, and who is contributing live to your mining boost.</p>
                    </div>
                    <div className="team-directory-actions">
                      <div className="referral-filters">
                        <FilterDropdown
                          value={activityFilter}
                          onChange={setActivityFilter}
                          options={[
                            { value: "all", label: "All" },
                            { value: "active", label: "Active" },
                            { value: "inactive", label: "Needs push" },
                          ]}
                        />
                        <FilterDropdown
                          value={rankSort}
                          onChange={setRankSort}
                          options={[
                            { value: "desc", label: "Top rank" },
                            { value: "asc", label: "Lowest rank" },
                          ]}
                        />
                      </div>
                      <button className="ghost-button team-remind-all" type="button">
                        Remind inactive
                      </button>
                    </div>
                  </div>

                  <div className="referral-list">
                    {filteredReferrals.map((member) => (
                      <div className="referral-row team-member-row" key={member.id}>
                        <div className="referral-member">
                          <RankBadge rankKey={member.rank} label={rankMap[member.rank].label} />
                          <div className="referral-copy">
                            <strong>{member.name}</strong>
                            <span>{rankMap[member.rank].label} member</span>
                          </div>
                        </div>
                        <div className="referral-status-side">
                          <span className={`member-status-dot ${member.active ? "active" : "inactive"}`} />
                          <span className={`team-status-label ${member.active ? "active" : "inactive"}`}>
                            {member.active ? "Mining now" : "Needs reminder"}
                          </span>
                          {!member.active && (
                            <button
                              className="member-remind-button"
                              type="button"
                              onClick={() => handleRemindMember(member)}
                              disabled={teamBusy}
                            >
                              Remind
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              </section>
            </section>
          )}

          {activeTab === "ranks" && (
            <section className="app-page ranks-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Rank system</span>
                <h2>Understand your rank at a glance</h2>
                <p>
                  See what rank you hold now, what unlocks next, and how every step changes your mining
                  power.
                </p>
              </div>

              <section className="ranks-dashboard page-panels">
                <article className="ranks-hero-card">
                  <div className="ranks-hero-copy">
                    <span className="reading-kicker">Live status</span>
                    <h3>Your rank is permanent. Your referral activity powers it up.</h3>
                    <p>
                      Rank gives you the fixed multiplier. Then every active referral adds its
                      rank-based percentage on top.
                    </p>
                    <div className="ranks-hero-pills">
                      <span>x{rankBoosterFactor.toFixed(1)} fixed multiplier</span>
                      <span>{state.activeReferrals} active referrals</span>
                      <span>+{referralBonusPercent.toFixed(0)}% referral bonus</span>
                    </div>
                  </div>

                  <div className="ranks-hero-side">
                    <div className="ranks-current-card">
                      <RankBadge rankKey={permanentRankKey} label={eligibleRank.label} />
                      <div className="ranks-current-copy">
                        <span>Current rank</span>
                        <strong>{eligibleRank.label}</strong>
                        <small>{eligibleRank.note}</small>
                      </div>
                    </div>
                  </div>
                </article>

                <div className="ranks-stat-grid">
                  <article className="ranks-stat-card accent-blue">
                    <span>Current rank</span>
                    <strong>{eligibleRank.label}</strong>
                    <p>Based on your current active team.</p>
                  </article>
                  <article className="ranks-stat-card accent-green">
                    <span>Fixed rank boost</span>
                    <strong>x{rankBoosterFactor.toFixed(1)}</strong>
                    <p>Rank multiplier plus Pioneer lifetime bonus when earned.</p>
                  </article>
                  <article className="ranks-stat-card accent-indigo">
                    <span>Next unlock</span>
                    <strong>{nextRank.label}</strong>
                    <p>{Math.max(0, nextRankRequirement - state.activeReferrals)} more active referrals.</p>
                  </article>
                  <article className="ranks-stat-card accent-amber">
                    <span>Referral reward</span>
                    <strong>+{referralBonusPercent.toFixed(0)}%</strong>
                    <p>From all active referrals at your current rank.</p>
                  </article>
                </div>

                <section className="ranks-insight-grid">
                  <article className="ranks-progress-card">
                    <div className="ranks-progress-head">
                      <div>
                        <span className="reading-kicker">Next rank progress</span>
                        <h3>{nextRank.label}</h3>
                        <p>{nextRank.requirement}</p>
                      </div>
                      <div className="team-progress-badge">{nextRankProgress}%</div>
                    </div>

                    <div className="team-progress-shell">
                      <div className="team-progress-bar" style={{ width: `${nextRankProgress}%` }} />
                    </div>

                    <div className="team-progress-meta">
                      <span>{state.activeReferrals} active now</span>
                      <span>{Math.max(0, nextRankRequirement - state.activeReferrals)} to go</span>
                    </div>

                    <div className="ranks-progress-breakdown">
                      <div>
                        <strong>x{rank.boost.toFixed(1)}</strong>
                        <span>Rank multiplier</span>
                      </div>
                      <div>
                        <strong>+{(eligibleRank.referralRate * 100).toFixed(0)}%</strong>
                        <span>Per active referral</span>
                      </div>
                      <div>
                        <strong>{possibleRateText}</strong>
                        <span>Possible rate now</span>
                      </div>
                    </div>
                  </article>

                <article className="ranks-logic-card">
                    <span className="reading-kicker">How it works</span>
                    <h3>The rank system is simple once you split it into 3 parts.</h3>
                    <div className="ranks-logic-list">
                      <div className="ranks-logic-item">
                        <strong>1. Unlock the rank</strong>
                        <p>
                          Reach the required active referrals, or qualify for Pioneer by joining before July 1, 2026.
                          The network start date is {earlyAdopterStartLabel}, and pre-launch accounts count too.
                        </p>
                      </div>
                      <div className="ranks-logic-item">
                        <strong>2. Keep the fixed boost</strong>
                        <p>Once earned, the rank multiplier stays with your account permanently.</p>
                      </div>
                      <div className="ranks-logic-item">
                        <strong>3. Add active referral power</strong>
                        <p>Every active referral adds its full percentage reward. Inactive referrals add 0%.</p>
                      </div>
                    </div>
                  </article>
                </section>

                <article className="ranks-ladder-card">
                  <div className="ranks-ladder-head">
                    <div>
                      <span className="reading-kicker">Rank ladder</span>
                      <h3>Every rank, requirement, and reward</h3>
                    </div>
                    <div className="ranks-ladder-legend">
                      <span className="legend-chip current">Current</span>
                      <span className="legend-chip next">Next</span>
                    </div>
                  </div>

                  <div className="ranks-ladder-list">
                    {rankEntries.map(([key, value]) => {
                      const isCurrent = key === permanentRankKey;
                      const isNext = value.label === nextRank.label && permanentRankKey !== "titan";

                      return (
                        <article
                          key={key}
                          className={`ranks-ladder-row ${isCurrent ? "current" : ""} ${isNext ? "next" : ""}`}
                        >
                          <div className="ranks-ladder-rank">
                            <RankBadge rankKey={key} label={value.label} />
                            <div className="ranks-ladder-rank-copy">
                              <strong>{value.label}</strong>
                              <span>
                                {value.requiresEarly
                                  ? EARLY_ADOPTER_REQUIREMENT_LABEL
                                  : `${value.minReferrals}+ active referrals`}
                              </span>
                            </div>
                          </div>

                          <div className="ranks-ladder-metric">
                            <span>Fixed boost</span>
                            <strong>{value.multiplierLabel}</strong>
                          </div>

                          <div className="ranks-ladder-metric">
                            <span>Per active referral</span>
                            <strong>+{(value.referralRate * 100).toFixed(0)}%</strong>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </article>
              </section>
            </section>
          )}

          {activeTab === "leaderboard" && (
            <section className="app-page leaderboard-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Network standings</span>
                <h2>Global Leaderboard</h2>
                <p>
                  See the strongest miners across the network, compare mined balance, and track who is
                  leading in active team growth.
                </p>
              </div>

              <section className="leaderboard-layout page-panels">
                {leaderboardTop.length > 0 && (
                  <div className="leaderboard-podium">
                    {leaderboardTop.map((entry) => (
                      <article
                        key={entry.username}
                        className={`leaderboard-podium-card rank-${entry.position} ${
                          entry.isCurrentUser ? "current-user" : ""
                        }`}
                      >
                        <span className="leaderboard-place">#{entry.position}</span>
                        <RankBadge rankKey={entry.rank} label={rankMap[entry.rank].label} />
                        <strong>{entry.displayName || entry.username}</strong>
                        <small>{rankMap[entry.rank].label}</small>
                        <div className="leaderboard-podium-metric">
                          <span>Mined</span>
                          <strong>{formatTotal(entry.mined)}</strong>
                        </div>
                        <div className="leaderboard-podium-meta">
                          <span>{entry.active} active miners</span>
                          <span>{formatRate(entry.rate)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <article className="leaderboard-table-card">
                  <div className="leaderboard-table-head">
                    <div>
                      <span className="reading-kicker">Full network table</span>
                      <h3>Live ranking snapshot</h3>
                    </div>
                    <div className="leaderboard-summary-pill">
                      <strong>{leaderboardEntries.length}</strong>
                      <span>tracked miners</span>
                    </div>
                  </div>

                  <div className="leaderboard-list">
                    {leaderboardEntries.length > 0 ? (
                      leaderboardEntries.map((entry) => (
                        <article
                          key={`${entry.username}-${entry.position}`}
                          className={`leaderboard-row ${entry.isCurrentUser ? "current-user" : ""}`}
                        >
                          <div className="leaderboard-row-left">
                            <span className="leaderboard-rank">#{entry.position}</span>
                            <RankBadge rankKey={entry.rank} label={rankMap[entry.rank].label} />
                          <div className="leaderboard-user">
                            <strong>{entry.displayName || entry.username}</strong>
                            <span>{rankMap[entry.rank].label} miner</span>
                          </div>
                          </div>
                          <div className="leaderboard-row-metrics">
                            <div>
                              <span>Mined</span>
                              <strong>{formatTotal(entry.mined)}</strong>
                            </div>
                            <div>
                              <span>Active team</span>
                              <strong>{entry.active}</strong>
                            </div>
                            <div>
                              <span>Rate</span>
                              <strong>{formatRate(entry.rate)}</strong>
                            </div>
                          </div>
                        </article>
                      ))
                    ) : (
                      <article className="leaderboard-row empty-state-card">
                        <div className="leaderboard-user">
                          <strong>No leaderboard data yet</strong>
                          <span>Profiles will appear here as real miners join the network.</span>
                        </div>
                      </article>
                    )}
                  </div>
                </article>
              </section>
            </section>
          )}

          {activeTab === "protocol" && (
            <section className="app-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Protocol state</span>
                <h2>Network Accounting</h2>
                <p>Live community issuance, supply remaining, developer allocation tracking, and global halving state.</p>
              </div>

              <section className="dashboard-panels page-panels">
                <article className="dashboard-card wide primary">
                  <span>Community mining issued</span>
                  <strong>{formatTokenMetric(protocolSnapshot?.communityMiningIssued)}</strong>
                  <p>
                    {formatTokenMetric(protocolSnapshot?.communityMiningRemaining)} remain out of the
                    {` ${formatTokenMetric(protocolSnapshot?.communityMiningCap)} `}community mining cap.
                  </p>
                </article>

                <article className="dashboard-card">
                  <span>Developer allocation issued</span>
                  <strong>{formatTokenMetric(protocolSnapshot?.developerAllocationIssued)}</strong>
                  <p>{formatTokenMetric(protocolSnapshot?.developerAllocationRemaining)} still available.</p>
                </article>

                <article className="dashboard-card">
                  <span>Current global epoch</span>
                  <strong>{protocolSnapshot?.globalEpoch ?? globalEpoch}</strong>
                  <p>The network-wide halving epoch now applies equally to every miner.</p>
                </article>

                <article className="dashboard-card">
                  <span>Next halving</span>
                  <strong>{formatCountdownLong((protocolSnapshot?.nextHalvingAt || nextHalvingAt) - now)}</strong>
                  <p>Scheduled for {formatFullDateTime(protocolSnapshot?.nextHalvingAt || nextHalvingAt)}.</p>
                </article>

                <article className="dashboard-card wide">
                  <span>Supply model</span>
                  <strong>500,000,000 total supply</strong>
                  <p>
                    400,000,000 SFOX are reserved for community mining and 100,000,000 SFOX for
                    developer allocation. Mining claims now feed the protocol ledger through
                    on-chain style accounting records instead of only updating the visible profile balance.
                  </p>
                </article>
              </section>
            </section>
          )}

          {activeTab === "rate_breakdown" && (
            <section className="app-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Mining rate</span>
                <h2>Possible Rate Breakdown</h2>
                <p>See exactly how your current SFOX mining rate is built.</p>
              </div>

              <section className="dashboard-panels page-panels">
                <article className="dashboard-card wide primary">
                  <span>Final possible rate</span>
                  <strong>{possibleRateText}</strong>
                  <p>Your live rate follows the updated whitepaper formula: base rate x fixed multiplier x active referral bonus.</p>
                </article>

                <article className="dashboard-card">
                  <span>Base rate</span>
                  <strong>{formatRate(mining.baseRate)}</strong>
                  <p>Current epoch emission before any rank or referral rewards are applied.</p>
                </article>

                <article className="dashboard-card">
                  <span>Rank booster</span>
                  <strong>x{rankBoosterFactor.toFixed(1)}</strong>
                  <p>
                    {eligibleRank.label} gives x{rank.boost.toFixed(1)}
                    {mining.pioneerLifetimeBonus > 0 ? `, plus Pioneer +${mining.pioneerLifetimeBonus.toFixed(1)}x` : ""}.
                  </p>
                </article>

                <article className="dashboard-card">
                  <span>Referral booster</span>
                  <strong>x{referralBoosterFactor.toFixed(2)}</strong>
                  <p>{state.activeReferrals} active referrals are adding +{referralBonusPercent.toFixed(0)}% total bonus.</p>
                </article>

                <article className="dashboard-card wide">
                  <span>Formula</span>
                  <strong>R = B x (Rank + Pioneer) x (1 + Active referral bonus)</strong>
                  <p>
                    Base rate ({formatRate(mining.baseRate)}) x fixed multiplier ({mining.fixedMultiplier.toFixed(2)}) x
                    referral factor ({referralBoosterFactor.toFixed(2)}).
                  </p>
                </article>
              </section>
            </section>
          )}

          {activeTab === "epoch" && (
            <section className="app-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Halving system</span>
                <h2>Epoch {globalEpoch}</h2>
                <p>Track the current halving stage and see when the next emission cut arrives.</p>
              </div>

              <section className="dashboard-panels page-panels">
                <article className="dashboard-card wide primary">
                  <span>Next halving countdown</span>
                  <strong>{nextHalvingCountdown}</strong>
                  <p>The next halving is scheduled for {formatFullDateTime(nextHalvingAt)}.</p>
                </article>

                <article className="dashboard-card">
                  <span>Current epoch</span>
                  <strong>{globalEpoch}</strong>
                  <p>You are mining in the current live emission stage.</p>
                </article>

                <article className="dashboard-card">
                  <span>Current base rate</span>
                  <strong>{formatRate(mining.baseRate)}</strong>
                  <p>Every epoch halves the base mining rate before boosters are applied.</p>
                </article>

                <article className="dashboard-card">
                  <span>Epoch length</span>
                  <strong>{HALVING_DAYS} days</strong>
                  <p>Each epoch lasts 14 days before the next halving event begins.</p>
                </article>

                <article className="dashboard-card wide">
                  <span>How halving works</span>
                  <strong>Each new epoch reduces base issuance by 50%</strong>
                  <p>
                    Epoch 0 starts on {earlyAdopterStartLabel}. After every 14-day cycle, the base rate is halved:
                    1.0, 0.5, 0.25, 0.125 and so on. Your rank and referral rewards are then applied on top of that reduced base rate.
                  </p>
                </article>
              </section>
            </section>
          )}

          {activeTab === "profile" && (
            <section className="app-page profile-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Profile page</span>
                <h2>Miner Profile</h2>
                <p>
                  Your account details, network identity, and account timing in one place.
                </p>
              </div>

              <section className="dashboard-panels page-panels">
                <article className="dashboard-card wide">
                  <span>Profile</span>
                  <strong>{profileDisplayName}</strong>
                  <p>
                    This profile tracks your mined balance, rank mode, halving epoch, referral totals,
                    and claim activity across the network.
                  </p>
                </article>

                <article className="dashboard-card">
                  <span>Username</span>
                  <strong>@{state.telegramUsername || state.username}</strong>
                  <p>{state.telegramUserId ? `Telegram ID ${state.telegramUserId}` : "Telegram account"}</p>
                </article>

                <article className="dashboard-card">
                  <span>Joined</span>
                  <strong>{formatFullDateTime(joinedValue)}</strong>
                  <p>Account creation time for your network profile.</p>
                </article>

                <article className="dashboard-card">
                  <span>Last sync</span>
                  <strong>{formatFullDateTime(lastSyncValue)}</strong>
                  <p>Latest profile update stored for this account.</p>
                </article>

                <article className="dashboard-card">
                  <span>Invite code</span>
                  <strong>{state.inviteCode}</strong>
                  <p>Used for referral growth and team onboarding.</p>
                </article>

                {state.inviterDisplayName && (
                  <article className="dashboard-card">
                    <span>Invited by</span>
                    <strong>{state.inviterDisplayName}</strong>
                    <p>{state.inviterUsername ? `@${state.inviterUsername}` : "Referral link connected"}</p>
                  </article>
                )}
              </section>
            </section>
          )}

          {activeTab === "admin" && isAdmin && (
            <section className="app-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Admin tools</span>
                <h2>Announcement Control</h2>
                <p>Publish and update the news feed without editing Supabase rows by hand.</p>
              </div>

              <section className="dashboard-panels page-panels">
                <article className="dashboard-card wide primary">
                  <span>Publish announcement</span>
                  <strong>News feed editor</strong>
                  <p>Create or update an active announcement for the Mini App news page.</p>
                  <div className="team-add-form">
                    <input
                      type="text"
                      placeholder="Slug"
                      value={announcementForm.slug}
                      onChange={(event) => handleAdminFieldChange("slug", event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Eyebrow"
                      value={announcementForm.eyebrow}
                      onChange={(event) => handleAdminFieldChange("eyebrow", event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Title"
                      value={announcementForm.title}
                      onChange={(event) => handleAdminFieldChange("title", event.target.value)}
                    />
                    <textarea
                      className="admin-textarea"
                      placeholder="Body"
                      value={announcementForm.body}
                      onChange={(event) => handleAdminFieldChange("body", event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Primary CTA label"
                      value={announcementForm.primaryCtaLabel}
                      onChange={(event) => handleAdminFieldChange("primaryCtaLabel", event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Secondary CTA label"
                      value={announcementForm.secondaryCtaLabel}
                      onChange={(event) => handleAdminFieldChange("secondaryCtaLabel", event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Primary CTA target"
                      value={announcementForm.primaryCtaTarget}
                      onChange={(event) => handleAdminFieldChange("primaryCtaTarget", event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Secondary CTA target"
                      value={announcementForm.secondaryCtaTarget}
                      onChange={(event) => handleAdminFieldChange("secondaryCtaTarget", event.target.value)}
                    />
                    <button
                      className="primary-button team-add-button"
                      type="button"
                      onClick={handleSaveAnnouncement}
                      disabled={adminBusy}
                    >
                      {adminBusy ? "Publishing..." : "Publish announcement"}
                    </button>
                    {adminMessage && <p className="team-feedback">{adminMessage}</p>}
                  </div>
                </article>

                <article className="dashboard-card wide">
                  <span>Recent announcements</span>
                  <strong>{adminAnnouncements.length}</strong>
                  <p>Latest items currently stored in Supabase.</p>
                  <div className="admin-announcement-list">
                    {adminAnnouncements.map((item, index) => (
                      <div className="admin-announcement-row" key={`${item.title}-${index}`}>
                        <strong>{item.title}</strong>
                        <span>{item.eyebrow}</span>
                        <p>{item.body}</p>
                        <div className="admin-announcement-actions">
                          <button
                            className="ghost-button admin-announcement-button"
                            type="button"
                            onClick={() => handleLoadAnnouncementIntoEditor(item)}
                          >
                            Edit
                          </button>
                          <button
                            className="ghost-button admin-announcement-button"
                            type="button"
                            onClick={() => handleToggleAdminAnnouncement(item)}
                            disabled={adminBusy}
                          >
                            {item.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              </section>
            </section>
          )}

          {activeTab === "migration" && (
            <section className="app-page coming-soon-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Mainnet page</span>
                <h2>Migration to Mainnet</h2>
                <p>Prepare your account for mainnet migration when the network opens that phase.</p>
              </div>

              <section className="page-panels">
                <article className="coming-soon-card">
                  <span className="coming-soon-kicker">Coming soon</span>
                  <strong>Mainnet migration is not live yet.</strong>
                  <p>
                    This page will later guide identity checks, wallet confirmation, migration
                    queues, and migration progress status.
                  </p>
                </article>
              </section>
            </section>
          )}

          {activeTab === "withdraw" && (
            <section className="app-page coming-soon-page">
              <div className="app-page-header">
                <span className="app-page-eyebrow">Withdraw page</span>
                <h2>Withdraw</h2>
                <p>Withdrawals will appear here when balance movement is enabled for the network.</p>
              </div>

              <section className="page-panels">
                <article className="coming-soon-card">
                  <span className="coming-soon-kicker">Coming soon</span>
                  <strong>Withdrawals are not available yet.</strong>
                  <p>
                    This page will later include wallet destination setup, available balance,
                    withdrawal history, and transfer confirmations.
                  </p>
                </article>
              </section>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
