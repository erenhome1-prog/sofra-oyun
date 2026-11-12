import { SOFRA_CONFIG, PlayerRole } from "./config.js";

/**
 * 4 haneli SOFRA oda kodu üretir (ör. SOFRA-4821).
 */
export function generateRoomCode(rng: () => number = Math.random): string {
  const digits = Math.floor(1000 + rng() * 9000);
  return `${SOFRA_CONFIG.ROOM_CODE_PREFIX}${digits}`;
}

/**
 * Kullanıcının girdiği oda kodunu standart 'SOFRA-XXXX' biçimine dönüştürür.
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

/**
 * Oyuncu sayısına göre hain sayısını belirler (01_OYUN_TASARIMI §2):
 * 6–8 oyuncu -> 1 Hain, 9–12 oyuncu -> 2 Hain (daha az oyuncuda test için 1 Hain).
 */
export function getTraitorCount(playerCount: number): number {
  if (playerCount >= 9) return 2;
  return 1;
}

/**
 * Oyuncu ID listesine göre rolleri dağıtır (yalnızca sunucuda çalışır!).
 */
export function assignRoles(
  playerIds: string[],
  rng: () => number = Math.random
): Record<string, PlayerRole> {
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const traitorCount = Math.min(shuffled.length - 1, getTraitorCount(shuffled.length));
  const roles: Record<string, PlayerRole> = {};
  shuffled.forEach((id, idx) => {
    roles[id] = idx < Math.max(1, traitorCount) ? "HAIN" : "MISAFIR";
  });
  return roles;
}

export interface VoteTallyResult {
  countsByTarget: Record<string, number>;
  topTargets: string[];
  burnedTargetId: string | null;
  isTie: boolean;
}

/**
 * Oyları sayar. Kendine oy vermeyi reddeder.
 */
export function tallyVotes(
  votesByVoter: Record<string, string | null | undefined>,
  eligibleTargetIds: string[]
): VoteTallyResult {
  const validSet = new Set(eligibleTargetIds);
  const countsByTarget: Record<string, number> = {};

  for (const [voterId, targetId] of Object.entries(votesByVoter)) {
    if (!targetId) continue;
    if (voterId === targetId) continue; // Kural: Kendine oy veremez!
    if (!validSet.has(targetId)) continue;
    countsByTarget[targetId] = (countsByTarget[targetId] || 0) + 1;
  }

  let maxVotes = 0;
  for (const c of Object.values(countsByTarget)) {
    if (c > maxVotes) maxVotes = c;
  }

  if (maxVotes === 0) {
    return { countsByTarget, topTargets: [], burnedTargetId: null, isTie: false };
  }

  const topTargets = Object.entries(countsByTarget)
    .filter(([, count]) => count === maxVotes)
    .map(([targetId]) => targetId);

  if (topTargets.length === 1) {
    return {
      countsByTarget,
      topTargets,
      burnedTargetId: topTargets[0],
      isTie: false
    };
  }

  return {
    countsByTarget,
    topTargets,
    burnedTargetId: null,
    isTie: true
  };
}

/**
 * Gece hain seçimini çözümler. Altın Kolye (necklaceHolderId) seçildiyse korur!
 */
export function resolveNightVictim(
  traitorPicks: string[],
  aliveGuestIds: string[],
  necklaceHolderId: string,
  rng: () => number = Math.random
): { victimId: string | null; protectedByNecklace: boolean } {
  const validTargets = traitorPicks.filter((id) => aliveGuestIds.includes(id));
  let chosen: string | null = null;

  if (validTargets.length > 0) {
    // İki hain aynı kişiyi seçtiyse o, farklı seçtiyse aralarından rastgele biri
    const idx = Math.floor(rng() * validTargets.length);
    chosen = validTargets[idx];
  } else if (aliveGuestIds.length > 0) {
    const idx = Math.floor(rng() * aliveGuestIds.length);
    chosen = aliveGuestIds[idx];
  }

  if (!chosen) {
    return { victimId: null, protectedByNecklace: false };
  }

  if (chosen === necklaceHolderId) {
    return { victimId: null, protectedByNecklace: true };
  }

  return { victimId: chosen, protectedByNecklace: false };
}

export type WinOutcome = "CONTINUE" | "MISAFIR_WINS" | "HAIN_WINS";

/**
 * Kazanma koşulunu kontrol eder:
 * - Canlı hain kalmadıysa -> MISAFIR_WINS
 * - Canlı hain sayısı >= canlı misafir sayısı -> HAIN_WINS
 */
export function evaluateWinCondition(
  alivePlayerIds: string[],
  roles: Record<string, PlayerRole>
): WinOutcome {
  let traitors = 0;
  let guests = 0;
  for (const id of alivePlayerIds) {
    if (roles[id] === "HAIN") traitors++;
    else guests++;
  }
  if (traitors === 0) return "MISAFIR_WINS";
  if (traitors >= guests) return "HAIN_WINS";
  return "CONTINUE";
}

/**
 * 4 kişi kaldığında Final Sofrası ("Hepimiz misafiriz" = TRUST vs "Aramızda hâlâ hain var" = DOUBT)
 */
export function resolveFinalDecision(
  decisions: Record<string, "TRUST" | "DOUBT">,
  alivePlayerIds: string[],
  roles: Record<string, PlayerRole>
): "VOTE_AGAIN" | "MISAFIR_WINS" | "HAIN_WINS" {
  const someoneDoubts = alivePlayerIds.some((id) => decisions[id] === "DOUBT");
  if (someoneDoubts) {
    return "VOTE_AGAIN";
  }
  const anyTraitorLeft = alivePlayerIds.some((id) => roles[id] === "HAIN");
  return anyTraitorLeft ? "HAIN_WINS" : "MISAFIR_WINS";
}
