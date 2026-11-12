export const SOFRA_CONFIG = {
  ROOM_NAME: "sofra_room",
  ROOM_CODE_PREFIX: "SOFRA-",
  MAX_CLIENTS: 12,
  MIN_CLIENTS: 6,
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
    ARRIVAL: 12,
    DAY: 300,
    TRIAL: 60,
    TABLE: 105,
    VOTE: 40,
    TIE_VOTE: 20,
    FIRE: 10,
    NIGHT: 120,
    MORNING: 12,
    FINAL: 30
  },
  FAST_DIVISOR: 3.5,
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

export type HatStyle = "none" | "fedora" | "hood" | "bun" | "crown";
export type MaskStyle = "none" | "glasses" | "domino" | "plague" | "beard";

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
