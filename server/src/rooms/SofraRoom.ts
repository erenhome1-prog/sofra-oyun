import { Room, Client, Delayed } from "@colyseus/core";
import {
  BOT_WAYPOINTS,
  CHARACTERS,
  DOORS,
  GamePhase,
  PlayerRole,
  SOFRA_CONFIG,
  assignRoles,
  detectRoomZone,
  evaluateWinCondition,
  generateRoomCode,
  getAntreSpawn,
  getSeatTransform,
  normalizeRoomCode,
  resolveCastleCollision,
  resolveFinalDecision,
  resolveNightVictim,
  sanitizeNickname,
  tallyVotes
} from "@sofra/shared";
import { SofraState, Player, DoorState } from "../state/SofraState.js";

/** Oda kodu -> Colyseus roomId eşleşmesi */
export const activeRoomsByCode = new Map<string, string>();

export interface JoinOptions {
  nick?: string;
  code?: string;
  seat?: number;
  coatColor?: string;
  accentColor?: string;
  hat?: string;
  mask?: string;
}

interface BotBrain {
  targetX: number;
  targetZ: number;
  waitUntil: number;
}

export class SofraRoom extends Room<SofraState> {
  maxClients = SOFRA_CONFIG.MAX_CLIENTS;

  /**
   * GÜVENLİK KURALI (02_TEKNIK_MIMARI §3.1):
   * Roller ASLA Colyseus Schema içinde tutulmaz; yalnızca bu gizli Map'te saklanır!
   */
  private secretRoles = new Map<string, PlayerRole>();
  private votes = new Map<string, string>();
  private nightPicks = new Map<string, string>();
  private finalDecisions = new Map<string, "TRUST" | "DOUBT">();
  private botBrains = new Map<string, BotBrain>();
  private phaseTimer?: Delayed;
  private lastMoveTimestamp = new Map<string, number>();
  private tieCandidates: string[] = [];

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

    // 4 yatak odası kapısını başlat
    for (const d of DOORS) {
      const ds = new DoorState();
      ds.id = d.id;
      ds.open = false;
      ds.locked = false;
      this.state.doors.set(d.id, ds);
    }

    this.registerMessageHandlers();

    // 15 Hz sunucu simülasyonu (Bot hareketleri + süre kontrolü)
    this.setSimulationInterval((dtMs) => this.updateSimulation(dtMs / 1000), 1000 / SOFRA_CONFIG.TICK_RATE_HZ);
  }

  private registerMessageHandlers() {
    // 1. Oyuncu hareketi (Hız ve duvar hilesi korumalı)
    this.onMessage("move", (client, data: { x: number; z: number; rotY: number; anim?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || (this.state.phase !== "DAY" && this.state.phase !== "ARRIVAL" && this.state.phase !== "LOBBY")) {
        return;
      }
      if (typeof data?.x !== "number" || typeof data?.z !== "number") return;

      const now = Date.now();
      const prevTs = this.lastMoveTimestamp.get(client.sessionId) || now - 66;
      const dt = Math.max(0.02, Math.min(0.5, (now - prevTs) / 1000));
      this.lastMoveTimestamp.set(client.sessionId, now);

      const dx = data.x - p.x;
      const dz = data.z - p.z;
      const dist = Math.hypot(dx, dz);
      const maxAllowed = SOFRA_CONFIG.RUN_SPEED * dt * SOFRA_CONFIG.MAX_STEP_TOLERANCE + 0.35;

      let targetX = data.x;
      let targetZ = data.z;
      if (dist > maxAllowed && dist > 0.001) {
        // Hız hilesini sönümle
        targetX = p.x + (dx / dist) * maxAllowed;
        targetZ = p.z + (dz / dist) * maxAllowed;
      }

      if (p.ghost) {
        p.x = Math.max(-25, Math.min(25, targetX));
        p.z = Math.max(-31, Math.min(33, targetZ));
      } else {
        const openMap = this.getOpenDoorsRecord();
        const resolved = resolveCastleCollision(targetX, targetZ, openMap);
        p.x = resolved.x;
        p.z = resolved.z;
      }

      p.rotY = typeof data.rotY === "number" ? data.rotY : p.rotY;
      p.anim = data.anim || (dist > 0.02 ? "walk" : "idle");
      p.roomId = detectRoomZone(p.x, p.z).id;
    });

    // 2. Kapı açma/kapatma (E veya mobil ETKİLEŞ)
    this.onMessage("interact_door", (client, data?: { doorId?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost) return;

      let targetDoor = DOORS.find((d) => d.id === data?.doorId);
      if (!targetDoor) {
        let bestDist = Infinity;
        for (const d of DOORS) {
          const dist = Math.hypot(p.x - d.x, p.z - d.z);
          if (dist < bestDist && dist <= SOFRA_CONFIG.DOOR_INTERACT_DIST) {
            bestDist = dist;
            targetDoor = d;
          }
        }
      }
      if (!targetDoor) return;
      if (Math.hypot(p.x - targetDoor.x, p.z - targetDoor.z) > SOFRA_CONFIG.DOOR_INTERACT_DIST + 0.6) return;

      const ds = this.state.doors.get(targetDoor.id);
      if (!ds || ds.locked) return;

      // Odaya 3 kişiden fazla girilmesini önle veya kapıyı değiştir
      ds.open = !ds.open;
      this.broadcast("door_sfx", { doorId: targetDoor.id, open: ds.open, label: targetDoor.label });
    });

    // 3. Lobi koltuk ve karakter özelleştirme
    this.onMessage(
      "customize",
      (
        client,
        data: {
          nick?: string;
          seat?: number;
          coatColor?: string;
          accentColor?: string;
          hat?: string;
          mask?: string;
        }
      ) => {
        const p = this.state.players.get(client.sessionId);
        if (!p || this.state.phase !== "LOBBY") return;

        if (data.nick) {
          p.nick = sanitizeNickname(data.nick);
        }
        if (typeof data.seat === "number" && data.seat !== 11 && data.seat >= 1 && data.seat <= 12) {
          const seatTaken = Array.from(this.state.players.values()).some(
            (other) => other.id !== p.id && other.seat === data.seat
          );
          if (!seatTaken) {
            p.seat = data.seat;
            const cDef = CHARACTERS.find((c) => c.seat === data.seat);
            if (cDef) {
              p.charName = cDef.name;
              p.coatColor = cDef.coatColor;
              p.accentColor = cDef.accentColor;
              p.hat = cDef.hat;
              p.mask = cDef.mask;
            }
          }
        }
        if (data.coatColor) p.coatColor = String(data.coatColor).slice(0, 12);
        if (data.accentColor) p.accentColor = String(data.accentColor).slice(0, 12);
        if (data.hat) p.hat = String(data.hat).slice(0, 16);
        if (data.mask) p.mask = String(data.mask).slice(0, 16);
      }
    );

    // 4. Lobide Bot Ekleme (Tek başına veya eksik oyuncuyla test için)
    this.onMessage("add_bots", (client, data?: { count?: number }) => {
      if (this.state.phase !== "LOBBY") return;
      if (this.state.hostId !== client.sessionId) return;
      const want = Math.min(9, Math.max(1, Number(data?.count || 1)));
      for (let i = 0; i < want; i++) {
        if (this.state.players.size >= SOFRA_CONFIG.MAX_CLIENTS) break;
        this.spawnBot();
      }
    });

    // 5. Hızlı Test Modu aç/kapa
    this.onMessage("toggle_fast_mode", (client) => {
      if (this.state.hostId !== client.sessionId || this.state.phase !== "LOBBY") return;
      this.state.fastMode = !this.state.fastMode;
    });

    // 6. Oyunu Başlat
    this.onMessage("start_game", (client) => {
      if (this.state.hostId !== client.sessionId || this.state.phase !== "LOBBY") return;
      // Eğer oyuncu sayısı 6'dan azsa otomatik botlarla 6'ya tamamla
      while (this.state.players.size < SOFRA_CONFIG.MIN_CLIENTS) {
        this.spawnBot();
      }
      this.startGameLoop();
    });

    // 7. Oylama (Kendine oy veremez)
    this.onMessage("vote", (client, data: { targetId: string }) => {
      if (this.state.phase !== "VOTE") return;
      const voter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!voter || !voter.alive || voter.ghost) return;
      if (!target || !target.alive || target.ghost) return;
      if (voter.id === target.id) return; // Kendine oy yasak!
      if (this.tieCandidates.length > 0 && !this.tieCandidates.includes(target.id)) return;

      this.votes.set(voter.id, target.id);
      voter.votedForId = target.id;
      this.checkIfAllVoted();
    });

    // 8. Gece Hain Seçimi
    this.onMessage("night_pick", (client, data: { targetId: string }) => {
      if (this.state.phase !== "NIGHT") return;
      if (this.secretRoles.get(client.sessionId) !== "HAIN") return;
      const voter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!voter || !voter.alive || !target || !target.alive) return;
      if (this.secretRoles.get(target.id) === "HAIN") return;

      this.nightPicks.set(voter.id, target.id);
      // Diğer haine seçimi fısılda
      this.sendToTraitors("traitor_pick_update", {
        traitorId: voter.id,
        traitorNick: voter.nick,
        targetId: target.id,
        targetNick: target.nick
      });
    });

    // 9. Final Sofrası Kararı (4 kişi kaldığında: TRUST vs DOUBT)
    this.onMessage("final_decision", (client, data: { decision: "TRUST" | "DOUBT" }) => {
      if (this.state.phase !== "FINAL") return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      const dec = data?.decision === "DOUBT" ? "DOUBT" : "TRUST";
      this.finalDecisions.set(p.id, dec);
    });

    // 10. Yazılı Sohbet (Yakınlık / Özel Oda / Sofra / Hain / Hayalet kanalı kurallı!)
    this.onMessage("chat", (client, data: { text: string; channel?: string }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const rawText = String(data?.text || "").trim().slice(0, 140);
      if (!rawText) return;

      const senderRole = this.secretRoles.get(sender.id) || "MISAFIR";
      const isTraitorWhisper = data?.channel === "HAIN" && senderRole === "HAIN";

      this.clients.forEach((c) => {
        const receiver = this.state.players.get(c.sessionId);
        if (!receiver) return;

        // Hayalet kanalı: canlılar hayaleti duyamaz
        if (sender.ghost && !receiver.ghost) return;

        // Hain fısıltısı: yalnız hainler duyar
        if (isTraitorWhisper) {
          if (this.secretRoles.get(receiver.id) !== "HAIN") return;
          c.send("chat_msg", {
            senderId: sender.id,
            senderNick: sender.nick,
            text: rawText,
            channel: "HAIN"
          });
          return;
        }

        // Gündüz evresinde kapalı yatak odası yalıtımı + yakınlık kontrolü
        if (this.state.phase === "DAY") {
          const sRoom = sender.roomId;
          const rRoom = receiver.roomId;
          const sDoor = DOORS.find((d) => d.roomId === sRoom);
          const rDoor = DOORS.find((d) => d.roomId === rRoom);
          const sClosed = sDoor ? !this.state.doors.get(sDoor.id)?.open : false;
          const rClosed = rDoor ? !this.state.doors.get(rDoor.id)?.open : false;

          if ((sClosed || rClosed) && sRoom !== rRoom) {
            // Kapısı kapalı yatak odasının sesi dışarıya SIFIR sızar!
            return;
          }
          const dist = Math.hypot(sender.x - receiver.x, sender.z - receiver.z);
          if (dist > 14 && sRoom !== rRoom) return;
        }

        c.send("chat_msg", {
          senderId: sender.id,
          senderNick: sender.nick,
          text: rawText,
          channel: sender.ghost ? "GHOST" : "PUBLIC"
        });
      });
    });

    // 11. Yeniden oyna (Sonuç ekranından Lobiye dönüş)
    this.onMessage("back_to_lobby", (client) => {
      if (this.state.hostId !== client.sessionId) return;
      this.resetToLobby();
    });
  }

  private getOpenDoorsRecord(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    this.state.doors.forEach((ds, id) => {
      out[id] = ds.open;
    });
    return out;
  }

  private spawnBot() {
    const takenSeats = new Set<number>();
    this.state.players.forEach((p) => takenSeats.add(p.seat));
    const allowedSeats = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
    const seat = allowedSeats.find((s) => !takenSeats.has(s));
    if (!seat) return;

    const cDef = CHARACTERS.find((c) => c.seat === seat) || CHARACTERS[0];
    const botId = `bot_${seat}_${Math.floor(100 + Math.random() * 900)}`;
    const bot = new Player();
    bot.id = botId;
    bot.nick = `${cDef.name} (${cDef.title})`;
    bot.seat = seat;
    bot.isBot = true;
    bot.charName = cDef.name;
    bot.coatColor = cDef.coatColor;
    bot.accentColor = cDef.accentColor;
    bot.hat = cDef.hat;
    bot.mask = cDef.mask;

    const spawn = getAntreSpawn(seat);
    bot.x = spawn.x;
    bot.z = spawn.z;
    bot.rotY = spawn.rotY;
    bot.roomId = "antre";

    this.state.players.set(botId, bot);
    const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
    this.botBrains.set(botId, { targetX: wp.x, targetZ: wp.z, waitUntil: Date.now() + 1000 });
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new Player();
    player.id = client.sessionId;
    player.nick = sanitizeNickname(options?.nick || "Misafir");
    player.connected = true;
    player.isBot = false;

    const takenSeats = new Set<number>();
    this.state.players.forEach((p) => takenSeats.add(p.seat));
    const allowedSeats = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
    const requestedSeat =
      options?.seat && allowedSeats.includes(options.seat) && !takenSeats.has(options.seat)
        ? options.seat
        : allowedSeats.find((s) => !takenSeats.has(s)) ?? 1;

    player.seat = requestedSeat;
    const cDef = CHARACTERS.find((c) => c.seat === requestedSeat) || CHARACTERS[0];
    player.charName = cDef.name;
    player.coatColor = options?.coatColor || cDef.coatColor;
    player.accentColor = options?.accentColor || cDef.accentColor;
    player.hat = options?.hat || cDef.hat;
    player.mask = options?.mask || cDef.mask;

    const spawn = getAntreSpawn(requestedSeat);
    player.x = spawn.x;
    player.z = spawn.z;
    player.rotY = spawn.rotY;
    player.roomId = "antre";

    this.state.players.set(client.sessionId, player);

    if (!this.state.hostId) {
      this.state.hostId = client.sessionId;
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;

    try {
      if (!consented && this.state.phase !== "LOBBY") {
        await this.allowReconnection(client, SOFRA_CONFIG.RECONNECT_TIMEOUT_SEC);
        player.connected = true;
        // Yeniden bağlanan oyuncuya gizli rol zarfını tekrar gönder
        this.sendPrivateRoleToClient(client);
        return;
      }
    } catch {
      // 60 sn içinde dönmedi
    }

    this.state.players.delete(client.sessionId);
    this.secretRoles.delete(client.sessionId);

    if (this.state.hostId === client.sessionId) {
      const nextHuman = Array.from(this.state.players.values()).find((p) => !p.isBot && p.connected);
      this.state.hostId = nextHuman?.id || "";
    }
  }

  // ============================================================================
  // OYUN DÖNGÜSÜ (EVRE MAKİNESİ)
  // ============================================================================
  private getDurationMs(baseSeconds: number): number {
    const sec = this.state.fastMode ? Math.max(4, Math.round(baseSeconds / SOFRA_CONFIG.FAST_DIVISOR)) : baseSeconds;
    return sec * 1000;
  }

  private setPhase(phase: GamePhase, durationSec: number, announcement: string, onComplete: () => void) {
    if (this.phaseTimer) {
      this.phaseTimer.clear();
    }
    const durMs = this.getDurationMs(durationSec);
    this.state.phase = phase;
    this.state.phaseEndsAt = Date.now() + durMs;
    this.state.announcement = announcement;
    this.phaseTimer = this.clock.setTimeout(onComplete, durMs);
  }

  private startGameLoop() {
    this.state.round = 1;
    this.state.pot = 0;
    this.state.winnerTeam = "";
    this.state.lastBurnedId = "";
    this.state.lastBurnedName = "";
    this.state.lastBurnedFlame = "";
    this.state.lastTakenId = "";
    this.state.lastTakenName = "";

    // Tüm kapıları aç ve oyuncuları Antre'de doğur
    this.state.doors.forEach((d) => {
      d.open = true;
      d.locked = false;
    });

    const allIds: string[] = [];
    this.state.players.forEach((p) => {
      p.alive = true;
      p.ghost = false;
      p.votedForId = "";
      const sp = getAntreSpawn(p.seat);
      p.x = sp.x;
      p.z = sp.z;
      p.rotY = sp.rotY;
      p.roomId = "antre";
      allIds.push(p.id);
    });

    // Gizli rolleri dağıt (Schema'ya ASLA yazılmaz!)
    const assigned = assignRoles(allIds);
    this.secretRoles.clear();
    for (const [id, r] of Object.entries(assigned)) {
      this.secretRoles.set(id, r);
    }

    // Her istemciye YALNIZCA kendi rol zarfını gönder
    this.clients.forEach((c) => this.sendPrivateRoleToClient(c));

    this.setPhase(
      "ARRIVAL",
      SOFRA_CONFIG.DURATIONS.ARRIVAL,
      "Kâhya: 'Kargalı Şato'ya hoş geldiniz. Mühürlü zarflarınız açılıyor...'",
      () => this.enterDayPhase()
    );
  }

  private sendPrivateRoleToClient(client: Client) {
    const myRole = this.secretRoles.get(client.sessionId) || "MISAFIR";
    const traitorMates: Array<{ id: string; nick: string; seat: number }> = [];
    if (myRole === "HAIN") {
      this.state.players.forEach((p) => {
        if (this.secretRoles.get(p.id) === "HAIN" && p.id !== client.sessionId) {
          traitorMates.push({ id: p.id, nick: p.nick, seat: p.seat });
        }
      });
    }
    client.send("role_envelope", {
      role: myRole,
      traitorMates
    });
  }

  private sendToTraitors(type: string, payload: unknown) {
    this.clients.forEach((c) => {
      if (this.secretRoles.get(c.sessionId) === "HAIN") {
        c.send(type, payload);
      }
    });
  }

  private enterDayPhase() {
    this.state.lastBurnedId = "";
    this.state.lastBurnedFlame = "";

    // Altın Kolye'yi canlı oyunculardan rastgele birine ver (Aşama 2 kuralı)
    const aliveList = Array.from(this.state.players.values()).filter((p) => p.alive);
    if (aliveList.length > 0) {
      const lucky = aliveList[Math.floor(Math.random() * aliveList.length)];
      this.state.necklaceHolder = lucky.id;
    }

    this.setPhase(
      "DAY",
      SOFRA_CONFIG.DURATIONS.DAY,
      `Gündüz #${this.state.round} · Şatoda serbestçe gezin, yatak odalarında gizli konuşun.`,
      () => this.enterTablePhase()
    );
  }

  private enterTablePhase() {
    // Çan çalar -> herkes yuvarlak sofradaki kendi sandalyesine ışınlanır
    this.broadcast("bell_tolls", { round: this.state.round });
    this.state.players.forEach((p) => {
      const st = getSeatTransform(p.seat);
      p.x = st.x;
      p.z = st.z;
      p.rotY = st.rotY;
      p.anim = "sit";
      p.roomId = "yemek_salonu";
      p.votedForId = "";
    });

    const aliveIds = this.getAlivePlayerIds();
    if (aliveIds.length <= 4) {
      this.enterFinalPhase();
      return;
    }

    this.setPhase(
      "TABLE",
      SOFRA_CONFIG.DURATIONS.TABLE,
      "Kâhya: 'Sofraya buyurun. Konuşun, şüphelendiğiniz kişiyi sorgulayın.'",
      () => this.enterVotePhase([])
    );
  }

  private enterVotePhase(tieCandidates: string[]) {
    this.votes.clear();
    this.tieCandidates = tieCandidates;
    this.state.players.forEach((p) => {
      p.votedForId = "";
    });

    // Botlar rastgele bir canlı oyuncuya oy verir
    this.clock.setTimeout(() => {
      if (this.state.phase !== "VOTE") return;
      const aliveIds = this.getAlivePlayerIds();
      const pool = tieCandidates.length > 0 ? tieCandidates : aliveIds;
      this.state.players.forEach((bot) => {
        if (!bot.isBot || !bot.alive) return;
        const choices = pool.filter((id) => id !== bot.id);
        if (choices.length > 0) {
          const pick = choices[Math.floor(Math.random() * choices.length)];
          this.votes.set(bot.id, pick);
          bot.votedForId = pick;
        }
      });
      this.checkIfAllVoted();
    }, 2200);

    const dur = tieCandidates.length > 0 ? SOFRA_CONFIG.DURATIONS.TIE_VOTE : SOFRA_CONFIG.DURATIONS.VOTE;
    const msg =
      tieCandidates.length > 0
        ? "Kâhya: 'Oylar eşit çıktı! Eşit kalanlar arasında son 15 saniyelik ikinci oylama!'"
        : "Kâhya: 'Şimdi mühürlerinizi basın. Kimin zarfı şömineye atılacak?'";

    this.setPhase("VOTE", dur, msg, () => this.resolveVotePhase());
  }

  private checkIfAllVoted() {
    if (this.state.phase !== "VOTE") return;
    const aliveIds = this.getAlivePlayerIds();
    if (aliveIds.every((id) => this.votes.has(id))) {
      this.resolveVotePhase();
    }
  }

  private resolveVotePhase() {
    const aliveIds = this.getAlivePlayerIds();
    const eligible = this.tieCandidates.length > 0 ? this.tieCandidates : aliveIds;
    const voteObj: Record<string, string> = {};
    this.votes.forEach((targetId, voterId) => {
      voteObj[voterId] = targetId;
    });

    const tally = tallyVotes(voteObj, eligible);

    // Oyları dramatik tek tek açmak üzere istemcilere gönder
    const revealList: Array<{ voterNick: string; targetNick: string; targetSeat: number }> = [];
    this.votes.forEach((targetId, voterId) => {
      const vP = this.state.players.get(voterId);
      const tP = this.state.players.get(targetId);
      if (vP && tP) {
        revealList.push({ voterNick: vP.nick, targetNick: tP.nick, targetSeat: tP.seat });
      }
    });
    this.broadcast("vote_reveal", { votes: revealList, counts: tally.countsByTarget });

    if (tally.isTie && this.tieCandidates.length === 0 && tally.topTargets.length > 1) {
      // İlk eşitlik -> 15 sn ikinci tur oylama
      this.enterVotePhase(tally.topTargets);
      return;
    }

    this.enterFirePhase(tally.burnedTargetId);
  }

  private enterFirePhase(burnedId: string | null) {
    if (!burnedId) {
      this.state.lastBurnedId = "";
      this.state.lastBurnedName = "";
      this.state.lastBurnedFlame = "";
      this.setPhase(
        "FIRE",
        SOFRA_CONFIG.DURATIONS.FIRE,
        "Kâhya: 'Sofradan karar çıkmadı. Bu akşam şömineye zarf atılmayacak.'",
        () => this.checkWinOrContinue("NIGHT")
      );
      return;
    }

    const victim = this.state.players.get(burnedId);
    const wasTraitor = this.secretRoles.get(burnedId) === "HAIN";
    if (victim) {
      victim.alive = false;
      victim.ghost = true;
      victim.anim = "ghost";
    }

    this.state.lastBurnedId = burnedId;
    this.state.lastBurnedName = victim?.nick || "Bilinmeyen";
    this.state.lastBurnedFlame = wasTraitor ? "RED" : "WHITE";

    this.broadcast("fireplace_burn", {
      playerId: burnedId,
      playerNick: victim?.nick || "",
      seat: victim?.seat || 1,
      flame: this.state.lastBurnedFlame
    });

    const flameText = wasTraitor
      ? `🔥 Alevler KAN KIRMIZISI parladı! ${victim?.nick} bir HAİNDİ!`
      : `❄️ Alevler BEYAZ yandı... ${victim?.nick} masum bir MİSAFİRDİ!`;

    this.setPhase("FIRE", SOFRA_CONFIG.DURATIONS.FIRE, flameText, () => this.checkWinOrContinue("NIGHT"));
  }

  private enterNightPhase() {
    this.nightPicks.clear();

    // Hain botlar gece rastgele bir misafir seçer
    this.clock.setTimeout(() => {
      if (this.state.phase !== "NIGHT") return;
      const aliveGuests = this.getAlivePlayerIds().filter((id) => this.secretRoles.get(id) === "MISAFIR");
      this.state.players.forEach((bot) => {
        if (!bot.isBot || !bot.alive) return;
        if (this.secretRoles.get(bot.id) === "HAIN" && aliveGuests.length > 0) {
          const pick = aliveGuests[Math.floor(Math.random() * aliveGuests.length)];
          this.nightPicks.set(bot.id, pick);
        }
      });
    }, 2000);

    this.setPhase(
      "NIGHT",
      SOFRA_CONFIG.DURATIONS.NIGHT,
      "Gece Çöktü · Mumlar söndü. Sandalyenizden kalkmayın... Hainler avını seçiyor.",
      () => this.enterMorningPhase()
    );
  }

  private enterMorningPhase() {
    const aliveGuests = this.getAlivePlayerIds().filter((id) => this.secretRoles.get(id) === "MISAFIR");
    const picks = Array.from(this.nightPicks.values());
    const nightRes = resolveNightVictim(picks, aliveGuests, this.state.necklaceHolder);

    if (nightRes.protectedByNecklace) {
      this.state.lastTakenId = "";
      this.state.lastTakenName = "";
      this.setPhase(
        "MORNING",
        SOFRA_CONFIG.DURATIONS.MORNING,
        "Kâhya: 'Dün gece biri kapıyı çaldı... Ama Altın Kolye sahibini korudu!'",
        () => {
          this.state.round += 1;
          this.checkWinOrContinue("DAY");
        }
      );
      return;
    }

    const victim = nightRes.victimId ? this.state.players.get(nightRes.victimId) : undefined;
    if (victim) {
      victim.alive = false;
      victim.ghost = true;
      victim.anim = "ghost";
      this.state.lastTakenId = victim.id;
      this.state.lastTakenName = victim.nick;
    }

    const msg = victim
      ? `Kâhya: 'Dün gece bir sandalye boşaldı... Koltuk #${victim.seat} (${victim.nick}) aramızdan alındı.'`
      : "Kâhya: 'Sabah oldu. Sofrada eksilen yok.'";

    this.setPhase("MORNING", SOFRA_CONFIG.DURATIONS.MORNING, msg, () => {
      this.state.round += 1;
      this.checkWinOrContinue("DAY");
    });
  }

  private enterFinalPhase() {
    this.finalDecisions.clear();
    // Botlar %65 ihtimalle TRUST, %35 DOUBT verir
    this.clock.setTimeout(() => {
      if (this.state.phase !== "FINAL") return;
      this.state.players.forEach((bot) => {
        if (!bot.isBot || !bot.alive) return;
        this.finalDecisions.set(bot.id, Math.random() < 0.35 ? "DOUBT" : "TRUST");
      });
    }, 2000);

    this.setPhase(
      "FINAL",
      SOFRA_CONFIG.DURATIONS.FINAL,
      "SON SOFRA (4 Kişi Kaldı) · 'Hepimiz misafiriz' mi diyorsunuz, yoksa 'Aramızda hâlâ hain var' mı?",
      () => {
        const aliveIds = this.getAlivePlayerIds();
        const roleObj = this.getRolesRecord();
        const decObj: Record<string, "TRUST" | "DOUBT"> = {};
        aliveIds.forEach((id) => {
          decObj[id] = this.finalDecisions.get(id) || "TRUST";
        });
        const outcome = resolveFinalDecision(decObj, aliveIds, roleObj);
        if (outcome === "VOTE_AGAIN") {
          this.enterVotePhase([]);
        } else {
          this.enterResultPhase(outcome === "HAIN_WINS" ? "HAIN" : "MISAFIR");
        }
      }
    );
  }

  private checkWinOrContinue(nextPhase: "DAY" | "NIGHT") {
    const aliveIds = this.getAlivePlayerIds();
    const outcome = evaluateWinCondition(aliveIds, this.getRolesRecord());
    if (outcome === "MISAFIR_WINS") {
      this.enterResultPhase("MISAFIR");
      return;
    }
    if (outcome === "HAIN_WINS") {
      this.enterResultPhase("HAIN");
      return;
    }
    if (nextPhase === "NIGHT") {
      this.enterNightPhase();
    } else {
      this.enterDayPhase();
    }
  }

  private enterResultPhase(winner: "MISAFIR" | "HAIN") {
    if (this.phaseTimer) this.phaseTimer.clear();
    this.state.phase = "RESULT";
    this.state.winnerTeam = winner;
    this.state.announcement =
      winner === "HAIN"
        ? "🔥 HAİNLER KAZANDI! Kargalı Şato'nun sofrası hainlere kaldı!"
        : "✨ MİSAFİRLER KAZANDI! Bütün hainlerin maskesi düştü ve şöminede yandı!";

    // Sadece OYUN SONUNDA tüm rolleri herkese açıkla (02_TEKNIK_MIMARI §3.1)
    const revealedRoles: Array<{ id: string; nick: string; seat: number; role: PlayerRole; alive: boolean }> = [];
    this.state.players.forEach((p) => {
      revealedRoles.push({
        id: p.id,
        nick: p.nick,
        seat: p.seat,
        role: this.secretRoles.get(p.id) || "MISAFIR",
        alive: p.alive
      });
    });
    this.broadcast("game_over_roles", { winner, roles: revealedRoles });
  }

  private resetToLobby() {
    if (this.phaseTimer) this.phaseTimer.clear();
    this.state.phase = "LOBBY";
    this.state.winnerTeam = "";
    this.state.announcement = "Şato lobisinde yeni oyun için bekleniyor...";
    this.state.players.forEach((p) => {
      p.alive = true;
      p.ghost = false;
      p.votedForId = "";
      p.anim = "idle";
      const sp = getAntreSpawn(p.seat);
      p.x = sp.x;
      p.z = sp.z;
      p.rotY = sp.rotY;
    });
  }

  private getAlivePlayerIds(): string[] {
    const out: string[] = [];
    this.state.players.forEach((p) => {
      if (p.alive && !p.ghost) out.push(p.id);
    });
    return out;
  }

  private getRolesRecord(): Record<string, PlayerRole> {
    const out: Record<string, PlayerRole> = {};
    this.secretRoles.forEach((r, id) => {
      out[id] = r;
    });
    return out;
  }

  // ============================================================================
  // BOT YAPAY ZEKÂSI (GÜNDÜZ ODALAR ARASINDA YÜRÜME)
  // ============================================================================
  private updateSimulation(dt: number) {
    if (this.state.phase !== "DAY" && this.state.phase !== "ARRIVAL") return;
    const now = Date.now();
    const openDoors = this.getOpenDoorsRecord();

    this.state.players.forEach((bot) => {
      if (!bot.isBot || !bot.alive) return;
      let brain = this.botBrains.get(bot.id);
      if (!brain) {
        const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
        brain = { targetX: wp.x, targetZ: wp.z, waitUntil: now + 500 };
        this.botBrains.set(bot.id, brain);
      }

      if (now < brain.waitUntil) {
        bot.anim = "idle";
        return;
      }

      const dx = brain.targetX - bot.x;
      const dz = brain.targetZ - bot.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 1.0) {
        const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
        brain.targetX = wp.x + (Math.random() - 0.5) * 3.0;
        brain.targetZ = wp.z + (Math.random() - 0.5) * 3.0;
        brain.waitUntil = now + 1200 + Math.random() * 2000;
        bot.anim = "idle";
        return;
      }

      const step = SOFRA_CONFIG.WALK_SPEED * 0.82 * dt;
      const nx = bot.x + (dx / dist) * step;
      const nz = bot.z + (dz / dist) * step;
      const resolved = resolveCastleCollision(nx, nz, openDoors);

      if (resolved.hit) {
        // Duvara veya kapalı kapıya denk geldiyse yeni hedef seç
        const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
        brain.targetX = wp.x;
        brain.targetZ = wp.z;
      } else {
        bot.x = resolved.x;
        bot.z = resolved.z;
      }

      bot.rotY = Math.atan2(dx, dz);
      bot.anim = "walk";
      bot.roomId = detectRoomZone(bot.x, bot.z).id;
    });
  }

  onDispose() {
    if (this.phaseTimer) this.phaseTimer.clear();
    if (this.state?.code) {
      activeRoomsByCode.delete(this.state.code);
    }
  }
}
