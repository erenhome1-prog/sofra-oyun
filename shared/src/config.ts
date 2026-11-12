export const SOFRA_CONFIG = {
  ROOM_NAME: "sofra_room",
  ROOM_CODE_PREFIX: "SOFRA-",
  MAX_CLIENTS: 12,
  MIN_CLIENTS: 6,
  DEFAULT_MATCH_CLIENTS: 10,
  SERVER_PORT: 2567,
  CLIENT_PORT: 5173,
  TICK_RATE_HZ: 15,
  WALK_SPEED: 5.2,
  RUN_SPEED: 8.4,
  MAX_STEP_TOLERANCE: 1.6,
  STAMINA_MAX_SEC: 4.0,
  STAMINA_RECOVER_SEC: 3.0,
  DOOR_INTERACT_DIST: 3.4,
  RECONNECT_TIMEOUT_SEC: 60,
  DURATIONS: {
    ARRIVAL: 16,
    DAY: 300,
    TRIAL: 75,
    TABLE: 120,
    VOTE: 90,
    TIE_VOTE: 40,
    FIRE: 16,
    NIGHT: 120,
    MORNING: 16,
    FINAL: 60
  },
  FAST_DIVISOR: 1.75,
  COLORS: {
    SOFRA_RED: "#B2161E",
    GOLD: "#C9A24E",
    DARK_BG: "#070608"
  }
} as const;

export type GamePhase =
  | "LOBBY"
  | "ARRIVAL"
  | "DAY"
  | "TRIAL"
  | "TABLE"
  | "VOTE"
  | "FIRE"
  | "NIGHT"
  | "MORNING"
  | "FINAL"
  | "RESULT";

export type PlayerRole = "MISAFIR" | "HAIN";

export type HatStyle = "none" | "fedora" | "hood" | "bun" | "crown" | "knight" | "wizard" | "noble";
export type MaskStyle = "none" | "glasses" | "domino" | "plague" | "beard" | "ironmask" | "royalvisor";

export type CastleAtmosphere = "torch" | "crimson" | "mist";
export type MatchDurationMode = "10m" | "20m" | "35m" | "60m";
export type MatchPace = MatchDurationMode | "normal" | "long" | "fast";

export interface MatchDurationPreset {
  id: MatchDurationMode;
  badge: string;
  shortTitle: string;
  title: string;
  summary: string;
  defaultPlayers: 8 | 10 | 12;
  stationUsesPerDay: number;
  rewardMultiplier: number;
  durations: {
    ARRIVAL: number;
    DAY: number;
    TRIAL: number;
    TABLE: number;
    VOTE: number;
    TIE_VOTE: number;
    FIRE: number;
    NIGHT: number;
    MORNING: number;
    FINAL: number;
  };
}

export const MATCH_DURATION_PRESETS: Record<MatchDurationMode, MatchDurationPreset> = {
  "10m": {
    id: "10m",
    badge: "⚡ 10 Dk",
    shortTitle: "⚡ 10 Dk Hızlı",
    title: "⚡ 10 Dakikalık Hızlı Oyun",
    summary: "Gündüz 1.5 dk · Sofra 50 sn · Oylama 40 sn (Mobil & Hızlı Mola)",
    defaultPlayers: 8,
    stationUsesPerDay: 2,
    rewardMultiplier: 1.0,
    durations: {
      ARRIVAL: 10,
      DAY: 95,
      TRIAL: 40,
      TABLE: 50,
      VOTE: 40,
      TIE_VOTE: 25,
      FIRE: 12,
      NIGHT: 50,
      MORNING: 12,
      FINAL: 40
    }
  },
  "20m": {
    id: "20m",
    badge: "⏳ 20 Dk",
    shortTitle: "⏳ 20 Dk Standart",
    title: "⏳ 20 Dakikalık Standart Oyun",
    summary: "Gündüz 3 dk · Sofra 1.5 dk · Oylama 65 sn (Dengeli Klasik)",
    defaultPlayers: 10,
    stationUsesPerDay: 2,
    rewardMultiplier: 1.2,
    durations: {
      ARRIVAL: 14,
      DAY: 180,
      TRIAL: 60,
      TABLE: 90,
      VOTE: 65,
      TIE_VOTE: 35,
      FIRE: 14,
      NIGHT: 80,
      MORNING: 14,
      FINAL: 50
    }
  },
  "35m": {
    id: "35m",
    badge: "🕵️ 35 Dk",
    shortTitle: "🕵️ 35 Dk Dedektif",
    title: "🕵️ 35 Dakikalık Derin Dedektiflik",
    summary: "Gündüz 5 dk · Sofra 2.5 dk · Oylama 90 sn (3 İstasyon Hakkı)",
    defaultPlayers: 10,
    stationUsesPerDay: 3,
    rewardMultiplier: 1.5,
    durations: {
      ARRIVAL: 16,
      DAY: 300,
      TRIAL: 75,
      TABLE: 150,
      VOTE: 90,
      TIE_VOTE: 40,
      FIRE: 16,
      NIGHT: 115,
      MORNING: 16,
      FINAL: 60
    }
  },
  "60m": {
    id: "60m",
    badge: "👑 1 Saat",
    shortTitle: "👑 1 Saat Destansı",
    title: "👑 1 Saatlik Destansı Şölen (RP)",
    summary: "Gündüz 8 dk · Sofra 3.5 dk · Oylama 110 sn (12 Kişi · 4 İstasyon · 2x Altın)",
    defaultPlayers: 12,
    stationUsesPerDay: 4,
    rewardMultiplier: 2.0,
    durations: {
      ARRIVAL: 18,
      DAY: 480,
      TRIAL: 95,
      TABLE: 210,
      VOTE: 110,
      TIE_VOTE: 50,
      FIRE: 18,
      NIGHT: 150,
      MORNING: 18,
      FINAL: 75
    }
  }
};

export function resolveDurationPreset(paceOrDuration?: string, fastMode?: boolean): MatchDurationPreset {
  if (paceOrDuration === "10m" || paceOrDuration === "fast") return MATCH_DURATION_PRESETS["10m"];
  if (paceOrDuration === "35m" || paceOrDuration === "long") return MATCH_DURATION_PRESETS["35m"];
  if (paceOrDuration === "60m") return MATCH_DURATION_PRESETS["60m"];
  if (paceOrDuration === "20m" || paceOrDuration === "normal") return MATCH_DURATION_PRESETS["20m"];
  if (fastMode) return MATCH_DURATION_PRESETS["10m"];
  return MATCH_DURATION_PRESETS["20m"];
}

export function formatDurationLabelTR(sec: number): string {
  if (sec < 60) return `${sec} sn`;
  const mins = sec / 60;
  return Number.isInteger(mins) ? `${mins} Dk` : `${mins.toFixed(1).replace(".0", "")} Dk`;
}

export interface CharacterDef {
  seat: number;
  name: string;
  title: string;
  lakap: string;
  coatColor: string;
  accentColor: string;
  hat: HatStyle;
  mask: MaskStyle;
  selectable: boolean;
}

/**
 * Dizideki (korku/sofra/karakter_kitabi.json) resmi SOFRA karakter kadrosu
 */
export const CHARACTERS: CharacterDef[] = [
  { seat: 1, name: "Sinan", title: "Avukat", lakap: "Geveze", coatColor: "#1e2430", accentColor: "#9b1c24", hat: "none", mask: "none", selectable: true },
  { seat: 2, name: "Lale", title: "Hemşire", lakap: "Sakin", coatColor: "#cfd8e3", accentColor: "#3b7a9e", hat: "bun", mask: "none", selectable: true },
  { seat: 3, name: "Kemal", title: "Eski Boksör", lakap: "Mert", coatColor: "#3a2318", accentColor: "#c9a24e", hat: "none", mask: "none", selectable: true },
  { seat: 4, name: "Ufuk", title: "Öğrenci", lakap: "Korkak", coatColor: "#263b30", accentColor: "#d9a441", hat: "hood", mask: "glasses", selectable: true },
  { seat: 5, name: "Rıza", title: "Meçhul Misafir", lakap: "Suskun", coatColor: "#151319", accentColor: "#7b6d5a", hat: "fedora", mask: "none", selectable: true },
  { seat: 6, name: "Davetli", title: "Özel Karakterin", lakap: "Oyuncu", coatColor: "#362b40", accentColor: "#c9a24e", hat: "hood", mask: "domino", selectable: true },
  { seat: 7, name: "Defne", title: "Kuyumcu", lakap: "Kırmızı", coatColor: "#8f141c", accentColor: "#ffd166", hat: "bun", mask: "none", selectable: true },
  { seat: 8, name: "Hüsnü", title: "Emekli Saatçi", lakap: "Dede", coatColor: "#4b3b2c", accentColor: "#e0cda9", hat: "fedora", mask: "beard", selectable: true },
  { seat: 9, name: "Peri", title: "Fenomen", lakap: "Fenomen", coatColor: "#6b2259", accentColor: "#f4a261", hat: "none", mask: "glasses", selectable: true },
  { seat: 10, name: "Zeynep", title: "İtfaiyeci", lakap: "Cesur", coatColor: "#5c2018", accentColor: "#e76f51", hat: "none", mask: "none", selectable: true },
  { seat: 11, name: "Kâhya", title: "Boş Sandalye (Seçilemez)", lakap: "Ev Sahibi", coatColor: "#09080a", accentColor: "#b2161e", hat: "crown", mask: "plague", selectable: false },
  { seat: 12, name: "Yabancı", title: "On İkinci Misafir", lakap: "Gölge", coatColor: "#22272e", accentColor: "#8d99ae", hat: "hood", mask: "domino", selectable: true }
];
