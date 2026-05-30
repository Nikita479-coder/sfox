function sanitizeUsername(username) {
  return String(username || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 32);
}

function buildInviteCode(username, telegramUserId) {
  const baseName = sanitizeUsername(username).toUpperCase() || "MINER";
  const idTail = String(telegramUserId || "0000").slice(-4).toUpperCase();
  return `SFOX-${baseName.slice(0, 8)}-${idTail}`;
}

const TELEGRAM_IDENTITY_CACHE_KEY = "sfox-telegram-identity-cache";

export const TELEGRAM_BOT_USERNAME =
  sanitizeUsername(import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "sfoxnetworkbot") ||
  "sfoxnetworkbot";

export function buildTelegramReferralLink(inviteCode) {
  const code = String(inviteCode || "").trim();
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref-${encodeURIComponent(code)}`;
}

function readCachedTelegramIdentity() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(TELEGRAM_IDENTITY_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    return cached?.telegramUserId && cached?.initData ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedTelegramIdentity(identity) {
  if (typeof window === "undefined" || !identity?.telegramUserId || !identity?.initData) return;

  try {
    window.sessionStorage.setItem(TELEGRAM_IDENTITY_CACHE_KEY, JSON.stringify(identity));
  } catch {
    // Ignore cache write failures.
  }
}

export function getTelegramIdentity() {
  if (typeof window === "undefined") return null;

  const webApp = window.Telegram?.WebApp;
  if (!webApp) return readCachedTelegramIdentity();

  try {
    webApp.ready();
    webApp.expand();
  } catch {
    // Ignore runtime errors from unavailable host methods.
  }

  const user = webApp.initDataUnsafe?.user;
  if (!user) return readCachedTelegramIdentity();

  const username = sanitizeUsername(user.username) || `tg${user.id}`;
  const cached = readCachedTelegramIdentity();
  const liveInitData = webApp.initData || "";

  const identity = {
    isTelegram: true,
    initData:
      liveInitData ||
      (cached?.telegramUserId === String(user.id) ? cached.initData : ""),
    telegramUserId: String(user.id),
    username,
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    photoUrl: user.photo_url || "",
    languageCode: user.language_code || "",
    isPremium: Boolean(user.is_premium),
    inviteCode: buildInviteCode(username, user.id),
    startParam:
      webApp.initDataUnsafe?.start_param ||
      webApp.initDataUnsafe?.startapp ||
      "",
  };

  writeCachedTelegramIdentity(identity);
  return identity;
}
