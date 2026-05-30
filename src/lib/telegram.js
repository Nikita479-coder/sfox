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

export const TELEGRAM_BOT_USERNAME =
  sanitizeUsername(import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "sfoxnetworkbot") ||
  "sfoxnetworkbot";

export function buildTelegramReferralLink(inviteCode) {
  const code = String(inviteCode || "").trim();
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref-${encodeURIComponent(code)}`;
}

export function getTelegramIdentity() {
  if (typeof window === "undefined") return null;

  const webApp = window.Telegram?.WebApp;
  if (!webApp) return null;

  try {
    webApp.ready();
    webApp.expand();
  } catch {
    // Ignore runtime errors from unavailable host methods.
  }

  const user = webApp.initDataUnsafe?.user;
  if (!user) return null;

  const username = sanitizeUsername(user.username) || `tg${user.id}`;

  return {
    isTelegram: true,
    initData: webApp.initData || "",
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
}
