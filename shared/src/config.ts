export const SOFRA_CONFIG = {
  ROOM_NAME: "sofra_room",
  ROOM_CODE_PREFIX: "SOFRA-",
  MAX_CLIENTS: 12,
  MIN_CLIENTS: 6,
  SERVER_PORT: 2567,
  CLIENT_PORT: 5173,
  COLORS: {
    SOFRA_RED: "#B2161E",
    GOLD: "#C9A24E",
    DARK_BG: "#09080A"
  }
} as const;

export type GamePhase =
  | "LOBBY"
  | "ARRIVAL"
  | "DAY"
  | "TABLE"
  | "VOTE"
  | "FIRE"
  | "NIGHT"
  | "MORNING"
  | "FINAL"
  | "RESULT";
