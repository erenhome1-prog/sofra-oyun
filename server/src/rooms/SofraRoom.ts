import { Room, Client } from "@colyseus/core";
import { SOFRA_CONFIG, generateRoomCode, normalizeRoomCode, sanitizeNickname } from "@sofra/shared";
import { SofraState, Player } from "../state/SofraState.js";

/** Oda kodu -> Colyseus roomId eşleşmesi */
export const activeRoomsByCode = new Map<string, string>();

export interface JoinOptions {
  nick?: string;
  code?: string;
}

export class SofraRoom extends Room<SofraState> {
  maxClients = SOFRA_CONFIG.MAX_CLIENTS;

  onCreate(options: JoinOptions) {
    this.setState(new SofraState());

    let code = options?.code ? normalizeRoomCode(options.code) : generateRoomCode();
    while (activeRoomsByCode.has(code)) {
      code = generateRoomCode();
    }

    this.state.code = code;
    this.state.phase = "LOBBY";
    activeRoomsByCode.set(code, this.roomId);

    this.setMetadata({ code });
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new Player();
    player.id = client.sessionId;
    player.nick = sanitizeNickname(options?.nick || "Misafir");
    player.connected = true;

    // Boş koltuk numarası ata (1..10 veya 12; 11 numaralı sandalye Kâhya'nın yeridir, hep boştur)
    const takenSeats = new Set<number>();
    this.state.players.forEach((p) => takenSeats.add(p.seat));
    const allowedSeats = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
    player.seat = allowedSeats.find((s) => !takenSeats.has(s)) ?? 1;

    this.state.players.set(client.sessionId, player);

    if (!this.state.hostId) {
      this.state.hostId = client.sessionId;
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);

    if (this.state.hostId === client.sessionId) {
      const remainingIds = Array.from(this.state.players.keys());
      this.state.hostId = remainingIds[0] || "";
    }
  }

  onDispose() {
    if (this.state?.code) {
      activeRoomsByCode.delete(this.state.code);
    }
  }
}
