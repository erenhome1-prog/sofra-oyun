import { SOFRA_CONFIG } from "./config.js";

/**
 * 4 haneli SOFRA oda kodu üretir (ör. SOFRA-4821).
 */
export function generateRoomCode(rng: () => number = Math.random): string {
  const digits = Math.floor(1000 + rng() * 9000);
  return `${SOFRA_CONFIG.ROOM_CODE_PREFIX}${digits}`;
}

/**
 * Kullanıcının girdiği oda kodunu standart 'SOFRA-XXXX' biçimine dönüştürür.
 * Yalnızca '4821' veya 'sofra-4821' yazıldığında da 'SOFRA-4821' döner.
 */
export function normalizeRoomCode(rawInput: string): string {
  const trimmed = (rawInput || "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^\d{4}$/.test(trimmed)) {
    return `${SOFRA_CONFIG.ROOM_CODE_PREFIX}${trimmed}`;
  }
  if (/^SOFRA\d{4}$/.test(trimmed)) {
    return `${SOFRA_CONFIG.ROOM_CODE_PREFIX}${trimmed.slice(5)}`;
  }
  return trimmed;
}

/**
 * Türkçe karakterleri (ş, ğ, ı, İ, ç, ö, ü) koruyarak takma adı temizler ve doğrular.
 */
export function sanitizeNickname(rawNick: string): string {
  const cleaned = (rawNick || "")
    .replace(/[^\p{L}\p{N}_\-\s.]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
  return cleaned || "Misafir";
}
