export const NETWORK_START_AT = "2026-06-01T00:00:00Z";
export const EARLY_ADOPTER_END_AT = "2026-07-01T00:00:00Z";
export const EARLY_ADOPTER_REQUIREMENT_LABEL = "Joined before July 1, 2026";

export function isEarlyAdopterDate(value) {
  const source = value ? new Date(value) : new Date();
  if (Number.isNaN(source.getTime())) return false;

  return source.getTime() < new Date(EARLY_ADOPTER_END_AT).getTime();
}
