import { Room, Client, Delayed, ServerError } from "@colyseus/core";
import {
  BOT_WAYPOINTS,
  CHARACTERS,
  COUNCIL_BOARD_POS,
  DOORS,
  GamePhase,
  MEDIEVAL_STATIONS,
  PUZZLE_ALTARS,
  PlayerRole,
  SOFRA_CONFIG,
  assignRoles,
  detectRoomZone,
  evaluateWinCondition,
  filterProfanityTR,
  formatDurationLabelTR,
  generateRoomCode,
  getAntreSpawn,
  getSeatTransform,
  normalizeRoomCode,
  resolveCastleCollision,
  resolveCastleStep,
  resolveDurationPreset,
  resolveFinalDecision,
  resolveNightVictim,
  sanitizeNickname,
  tallyVotes
} from "@sofra/shared";
import { SofraState, Player, DoorState } from "../state/SofraState.js";
import { accountStore } from "../accounts.js";
import {
  ActivePuzzleSession,
  BondHighlight,
  BotMemory,
  PersonalQuest,
  RoomPlayerBrief,
  createInitialBotMemory,
  createPuzzleChallenge,
  generateBotReply,
  generateNightTraitorChatLine,
  generateRoundQuests,
  generateSmartBotReplyAsync,
  generateTableDebateLine,
  generateTrueDetectiveClue
} from "../ai/botAI.js";

export interface RoomSummary {
  roomId: string;
  code: string;
  roomTitle: string;
  hasPassword: boolean;
  playerCount: number;
  humanCount: number;
  maxClients: number;
  targetPlayerCount: number;
  paceMode: string;
  phase: string;
  fastMode: boolean;
  hostNick: string;
}

export const activeRoomsByCode = new Map<string, string>();
export const liveRooms = new Map<string, SofraRoom>();

export function listPublicRooms(): RoomSummary[] {
  const list: RoomSummary[] = [];
  liveRooms.forEach((room) => list.push(room.getSummary()));
  return list;
}

export function findActiveSessionForToken(
  playerToken: string
): { roomId: string; code: string; roomTitle: string; phase: string } | null {
  if (!playerToken) return null;
  for (const room of liveRooms.values()) {
    if (room.hasPlayerToken(playerToken)) {
      return {
        roomId: room.roomId,
        code: room.state.code,
        roomTitle: room.state.roomTitle,
        phase: room.state.phase
      };
    }
  }
  return null;
}

export interface JoinOptions {
  nick?: string;
  code?: string;
  roomTitle?: string;
  roomPassword?: string;
  playerToken?: string;
  createNew?: boolean;
  paceMode?: string;
  targetPlayerCount?: number;
  atmosphereTheme?: string;
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

const FAREWELL_NOTES_MISAFIR = [
  "Bu sofradaki şüphe dolu bakışlara daha fazla dayanamıyorum… Ben masumdum ama kimse gözlerime inanmadı! Zarfımı ateşe kendim bırakıyorum!",
  "Her kapı ardında fısıltı, her bakışta suçlama… Masumdum, kimse inanmadı! Beyaz alev yükseldiğinde kimin dost olduğunu anlayacaksınız!",
  "Karanlık koridorlar üstüme geliyor… Ben hain değildim ama bu sofrada bir dakika daha kalamam. Elveda!"
];

const FAREWELL_NOTES_HAIN = [
  "Bu vicdan azabına daha fazla dayanamıyorum… Evet, aranızdaki hain bendim! Zarfımı şömineye bırakıp karanlığa karışıyorum!",
  "Şatonun çanları susmuyor, ellerim titriyor… Maskemi masaya bırakıyorum: Gölge bendim, ama sofrada hâlâ güvende değilsiniz!"
];

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class SofraRoom extends Room<SofraState> {
  maxClients = SOFRA_CONFIG.MAX_CLIENTS;

  private secretRoles = new Map<string, PlayerRole>();
  private roomPassword: string = "";
  private sessionToToken = new Map<string, string>();
  private tokenToSession = new Map<string, string>();

  // ARKADAŞLIK / YAKINLIK & FISILTI İZİ TABLOSU (0..100)
  private affinities = new Map<string, number>();
  private affinityAccumSec = 0;
  private botChatterAccumSec = 0;

  // BULMACA, GÖREVLER & ETKİNLİK SALONU DURUMLARI
  private phaseSeq = 0;
  private roleSentSessions = new Set<string>();
  private departedSessions = new Set<string>();
  private activePuzzles = new Map<string, ActivePuzzleSession>();
  private puzzleCooldownUntil = new Map<string, number>();
  private solvedPuzzleRound = new Map<string, number>();
  private necklaceClaimedByPuzzleThisRound = false;
  private playerQuests = new Map<string, PersonalQuest[]>();
  private trialStageByPlayer = new Map<string, number>();
  private trialActiveChallenge = new Map<string, ActivePuzzleSession>();
  private trialCompletedClue = new Map<string, string>();
  private lastTrialSubmitAt = new Map<string, number>();
  private trialSabotagedPlayers = new Set<string>();
  private trialSabotageCount = 0;
  private pendingBotTrialPot = 0;
  private pendingSabotagePotDrain = 0;
  private readyPhasePlayers = new Set<string>();
  private sealedNightTraitors = new Set<string>();
  private nightWatchedPlayers = new Set<string>();
  private nightWatchTexts = new Map<string, string>();
  private chronicleLog: string[] = [];
  private kahyaBellUsedRound = 0;
  private chalkUsedRound = new Map<string, number>();
  private lastLightSabotageAt = 0;
  private noteSabotageUsedRound = new Map<string, number>();
  private medievalStationUses = new Map<string, string[]>();
  private ghostHauntCooldown = new Map<string, number>();
  private finalAskedForRound = 0;
  private voteLockdownPending = false;
  private finalLockdownPending = false;
  private penalizedVotePairsThisRound = new Set<string>();
  private accusedByHumansThisRound = new Set<string>();
  private accusedScoreThisRound = new Map<string, number>();
  private tempEquippedCosmetics = new Map<
    string,
    { coatColor: string; accentColor: string; hat: string; mask: string }
  >();

  // BOT YAPAY ZEKÂ HAFIZASI
  private aiControlledIds = new Set<string>();
  private botBrains = new Map<string, BotBrain>();
  private botMemories = new Map<string, BotMemory>();

  private votes = new Map<string, string>();
  private abstainedVoters = new Set<string>();
  private nightPicks = new Map<string, string>();
  private finalDecisions = new Map<string, "TRUST" | "DOUBT">();
  private phaseTimer?: Delayed;
  private autoLobbyTimer?: Delayed;
  private lastMoveTimestamp = new Map<string, number>();
  private tieCandidates: string[] = [];

  public getSummary(): RoomSummary {
    let humanCount = 0;
    let hostNick = "Kâhya";
    this.state.players.forEach((p) => {
      if (!p.isBot) humanCount += 1;
      if (p.id === this.state.hostId) hostNick = p.nick;
    });
    return {
      roomId: this.roomId,
      code: this.state.code,
      roomTitle: this.state.roomTitle,
      hasPassword: this.state.hasPassword,
      playerCount: this.state.players.size,
      humanCount,
      maxClients: this.maxClients,
      targetPlayerCount: this.state.targetPlayerCount || SOFRA_CONFIG.DEFAULT_MATCH_CLIENTS,
      paceMode: this.state.paceMode || "20m",
      phase: this.state.phase,
      fastMode: this.state.fastMode,
      hostNick
    };
  }

  public hasPlayerToken(token: string): boolean {
    const sid = this.tokenToSession.get(token);
    if (!sid) return false;
    return this.state.players.has(sid);
  }

  onCreate(options: JoinOptions) {
    this.setState(new SofraState());

    let code = options?.code ? normalizeRoomCode(options.code) : generateRoomCode();
    while (activeRoomsByCode.has(code)) {
      code = generateRoomCode();
    }

    const cleanTitle = filterProfanityTR(String(options?.roomTitle || "").trim()).slice(0, 28);
    const cleanPass = String(options?.roomPassword || "").trim().slice(0, 24);
    const preset = resolveDurationPreset(options?.paceMode);

    this.roomPassword = cleanPass;
    this.state.code = code;
    this.state.roomTitle = cleanTitle || `Sofra ${code}`;
    this.state.hasPassword = cleanPass.length > 0;
    this.state.phase = "LOBBY";
    this.state.paceMode = preset.id;
    this.state.fastMode = preset.id === "10m";
    this.state.targetPlayerCount =
      options?.targetPlayerCount && [8, 10, 12].includes(Number(options.targetPlayerCount))
        ? Number(options.targetPlayerCount)
        : preset.defaultPlayers;
    if (options?.atmosphereTheme && ["torch", "crimson", "mist"].includes(options.atmosphereTheme)) {
      this.state.atmosphereTheme = options.atmosphereTheme;
    }

    if (this.state.hasPassword) {
      this.setPrivate(true);
    }

    activeRoomsByCode.set(code, this.roomId);
    liveRooms.set(this.roomId, this);
    this.setMetadata({
      code,
      roomTitle: this.state.roomTitle,
      hasPassword: this.state.hasPassword,
      paceMode: this.state.paceMode
    });

    // 12 Kişisel Özel Yatak Odası Kapısını Başlat (Herkesin kendi odası yalnız kendi anahtarına açık!)
    for (const d of DOORS) {
      const ds = new DoorState();
      ds.id = d.id;
      ds.ownerSeat = d.ownerSeat;
      ds.open = false;
      ds.locked = true;
      this.state.doors.set(d.id, ds);
    }

    this.registerMessageHandlers();
    this.setSimulationInterval((dtMs) => this.updateSimulation(dtMs / 1000), 1000 / SOFRA_CONFIG.TICK_RATE_HZ);
  }

  onAuth(_client: Client, options: JoinOptions): boolean {
    const pToken = String(options?.playerToken || "");
    if (pToken && this.hasPlayerToken(pToken)) {
      return true;
    }
    if (this.state.players.size === 0) {
      return true;
    }
    if (this.roomPassword) {
      const given = String(options?.roomPassword || "").trim();
      if (given !== this.roomPassword) {
        throw new ServerError(4001, "Oda şifresi hatalı!");
      }
    }
    if (this.state.phase !== "LOBBY") {
      throw new ServerError(4002, "Bu odada oyun şu an devam ediyor.");
    }
    return true;
  }

  private scheduleAutoLobbyCountdown() {
    if (this.state.phase !== "LOBBY" || !this.state.autoStart) return;
    if (this.clients.length === 0) return;

    if (this.autoLobbyTimer) {
      this.autoLobbyTimer.clear();
    }
    const waitSec = this.state.hasPassword ? 60 : 45;
    const targetCount = Math.max(6, Math.min(12, this.state.targetPlayerCount || SOFRA_CONFIG.DEFAULT_MATCH_CLIENTS));
    this.state.phaseEndsAt = Date.now() + waitSec * 1000;
    this.state.announcement = `🕯️ Kâhya sofrayı hazırlıyor... ${waitSec} sn içinde eksik koltuklar ${targetCount} kişiye tamamlanıp başlayacak (İstediğin an 'Oto' kapatabilirsin)!`;

    this.autoLobbyTimer = this.clock.setTimeout(() => {
      if (this.state.phase !== "LOBBY" || !this.state.autoStart || this.clients.length === 0) return;
      while (this.state.players.size < targetCount) {
        this.spawnBot();
      }
      this.startGameLoop();
    }, waitSec * 1000);
  }

  private addAffinity(idA: string, idB: string, delta: number) {
    if (!idA || !idB || idA === idB) return;
    const key = pairKey(idA, idB);
    const cur = this.affinities.get(key) || 0;
    this.affinities.set(key, Math.max(0, Math.min(100, cur + delta)));
  }

  private getTopBondHighlight(): BondHighlight | null {
    let bestKey = "";
    let bestVal = 0;
    this.affinities.forEach((val, key) => {
      if (val > bestVal) {
        const [a, b] = key.split("|");
        const pA = this.state.players.get(a);
        const pB = this.state.players.get(b);
        if (pA?.alive && pB?.alive) {
          bestVal = val;
          bestKey = key;
        }
      }
    });
    if (!bestKey || bestVal < 20) return null;
    const [a, b] = bestKey.split("|");
    const pA = this.state.players.get(a)!;
    const pB = this.state.players.get(b)!;
    return {
      seatA: pA.seat,
      nickA: pA.nick,
      seatB: pB.seat,
      nickB: pB.nick,
      score: bestVal
    };
  }

  private pickScapegoatForBot(botId: string, botRole: PlayerRole): { id: string; seat: number; nick: string } | undefined {
    let candidates: Array<{ id: string; seat: number; nick: string }> = [];
    this.state.players.forEach((p) => {
      if (!p.alive || p.ghost || p.id === botId) return;
      if (botRole === "HAIN" && this.secretRoles.get(p.id) === "HAIN") return;
      candidates.push({ id: p.id, seat: p.seat, nick: p.nick });
    });
    if (candidates.length === 0) return undefined;

    // 1. Tur Koruması: Hiçbir insan tarafından suçlanmamış gerçek oyuncuyu 1. turda botlar rastgele günah keçisi seçmez!
    if (this.state.round === 1) {
      const fairFirstRound = candidates.filter(
        (c) => this.aiControlledIds.has(c.id) || this.accusedByHumansThisRound.has(c.id)
      );
      if (fairFirstRound.length > 0) candidates = fairFirstRound;
    }

    // Güçlü arkadaşlık bağı (affinity >= 48) kurduğu kişiyi başka aday varken hedef göstermez!
    const nonFriends = candidates.filter(
      (c) => (this.affinities.get(pairKey(botId, c.id)) || 0) < 48
    );
    if (nonFriends.length > 0) candidates = nonFriends;

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private selectSmartBotVoteTarget(botId: string, choices: string[], isTieBreaker: boolean): string {
    let filtered = [...choices];

    // 1. Tur Koruması: İlk oylamada henüz hiçbir insanın suçlamadığı pasif/sohbetteki insan oyuncuyu botlar rastgele şömineye atmaz!
    if (this.state.round === 1 && !isTieBreaker) {
      const fairPool = filtered.filter(
        (id) => this.aiControlledIds.has(id) || this.accusedByHumansThisRound.has(id)
      );
      if (fairPool.length > 0) filtered = fairPool;
    }

    // Yakın dostluk barı (affinity >= 48) olan müttefiklerine mecbur kalmadıkça oy vermez!
    const nonAllies = filtered.filter(
      (id) => (this.affinities.get(pairKey(botId, id)) || 0) < 48
    );
    if (nonAllies.length > 0) filtered = nonAllies;

    // Konsey tahtasında veya Yuvarlak Sofrada suçlanan adaylara ağırlıklı oy verir!
    const weightedPool: string[] = [];
    for (const cid of filtered) {
      const weight = 1 + Math.min(6, (this.accusedScoreThisRound.get(cid) || 0) * 2);
      for (let w = 0; w < weight; w++) {
        weightedPool.push(cid);
      }
    }
    return weightedPool[Math.floor(Math.random() * weightedPool.length)] || filtered[0];
  }

  private buildRoomPlayerBriefs(botId: string): RoomPlayerBrief[] {
    const botIsTraitor = this.secretRoles.get(botId) === "HAIN";
    const list: RoomPlayerBrief[] = [];
    this.state.players.forEach((p) => {
      const pRole = this.secretRoles.get(p.id) || "MISAFIR";
      list.push({
        id: p.id,
        seat: p.seat,
        nick: p.nick,
        charName: p.charName,
        alive: p.alive,
        roomName: detectRoomZone(p.x, p.z).name,
        role: botIsTraitor && pRole === "HAIN" ? "HAIN" : "MISAFIR",
        bondWithBot: Math.round(this.affinities.get(pairKey(botId, p.id)) || 0)
      });
    });
    return list;
  }

  private registerMessageHandlers() {
    // 1. Oyuncu hareketi (Kişisel Oda Anahtarı + Alt-Adım Anti-Tünelleme çarpışma sistemi!)
    this.onMessage("move", (client, data: { x: number; z: number; rotY: number; anim?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || (this.state.phase !== "DAY" && this.state.phase !== "ARRIVAL" && this.state.phase !== "LOBBY")) {
        return;
      }
      if (typeof data?.x !== "number" || typeof data?.z !== "number" || !Number.isFinite(data.x) || !Number.isFinite(data.z)) {
        return;
      }

      const now = Date.now();
      const prevTs = this.lastMoveTimestamp.get(client.sessionId) || now - 66;
      const dt = Math.max(0.02, Math.min(0.5, (now - prevTs) / 1000));
      this.lastMoveTimestamp.set(client.sessionId, now);

      const dx = data.x - p.x;
      const dz = data.z - p.z;
      const dist = Math.hypot(dx, dz);
      const maxAllowed = SOFRA_CONFIG.RUN_SPEED * dt * SOFRA_CONFIG.MAX_STEP_TOLERANCE + 0.45;

      let targetX = data.x;
      let targetZ = data.z;
      if (dist > maxAllowed && dist > 0.001) {
        targetX = p.x + (dx / dist) * maxAllowed;
        targetZ = p.z + (dz / dist) * maxAllowed;
      }

      if (p.ghost) {
        p.x = Math.max(-25.2, Math.min(25.2, targetX));
        p.z = Math.max(-31, Math.min(33, targetZ));
      } else {
        const resolved = resolveCastleStep(p.x, p.z, targetX, targetZ, this.getOpenDoorsRecord(), 0.42, {
          seat: p.seat,
          currentRoomId: p.roomId,
          lockedDoors: this.getLockedDoorsRecord(),
          hasKahyaKey: p.hasKahyaKey
        });
        p.x = resolved.x;
        p.z = resolved.z;
      }

      p.rotY = typeof data.rotY === "number" && Number.isFinite(data.rotY) ? data.rotY : p.rotY;
      p.anim = data.anim || (dist > 0.02 ? "walk" : "idle");
      p.roomId = detectRoomZone(p.x, p.z).id;
    });

    // 2. Kapı Açma / Kilitleme (Kendi özel odanın anahtarı sende! Davet etmek için kapını açabilirsin)
    this.onMessage("interact_door", (client, data?: { doorId?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost) return;
      if (this.state.phase !== "DAY" && this.state.phase !== "ARRIVAL" && this.state.phase !== "LOBBY") return;

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
      if (Math.hypot(p.x - targetDoor.x, p.z - targetDoor.z) > SOFRA_CONFIG.DOOR_INTERACT_DIST + 0.9) return;

      const ds = this.state.doors.get(targetDoor.id);
      if (!ds) return;

      // #11 Kâhya'nın Mühürlü Odası
      if (targetDoor.sealedByKahya && !p.hasKahyaKey) {
        client.send("chat_msg", {
          senderId: p.id,
          senderNick: "KÂHYA MÜHRÜ",
          seat: 11,
          text: "🔒 Oda #11 Kâhya tarafından mühürlenmiş! Açmak için Bulmaca Kürsüsü'nden 'Paslı Kâhya Anahtarı' bulmalısın.",
          channel: "SİSTEM"
        });
        return;
      }

      const isOwner =
        (p.seat === targetDoor.ownerSeat && !targetDoor.sealedByKahya) ||
        Boolean(targetDoor.sealedByKahya && p.hasKahyaKey);
      const isInsideThisRoom = p.roomId === targetDoor.roomId;

      // Başkasının kilitli özel odasının kilidini ne dışarıdan ne içeriden bozamazsın (içerideysen doğrudan yürüyerek çıkabilirsin!)
      if (ds.locked && !isOwner) {
        if (isInsideThisRoom) {
          client.send("chat_msg", {
            senderId: p.id,
            senderNick: "ANAHTAR",
            seat: targetDoor.ownerSeat,
            text: `🔓 ${targetDoor.label} sahibi tarafından kilitli; ancak içerde hapsolmaman için kapıdan koridora doğru yürüyerek tek yönlü çıkabilirsin!`,
            channel: "SİSTEM"
          });
        } else {
          client.send("chat_msg", {
            senderId: p.id,
            senderNick: "ANAHTAR",
            seat: targetDoor.ownerSeat,
            text: `🔒 ${targetDoor.label} kilitli! Bu odanın anahtarı yalnızca Koltuk #${targetDoor.ownerSeat} sahibinde (senin özel odan: Oda #${p.seat}).`,
            channel: "SİSTEM"
          });
        }
        return;
      }

      // Oda sahibi kapısını açarsa davetliler de girebilir; kapatırsa tekrar kilitlenir!
      ds.open = !ds.open;
      if (isOwner) {
        ds.locked = !ds.open;
      }
      this.broadcast("door_sfx", { doorId: targetDoor.id, open: ds.open, label: targetDoor.label });
    });

    // 3. KARAKTER İNCELE (`🔍 İncele` -> Kimin kiminle ne kadar yakın/fısıltılı olduğunu döndürür!)
    this.onMessage("request_inspect", (client, data: { targetId: string }) => {
      const target = this.state.players.get(data?.targetId);
      if (!target) return;

      const bonds: Array<{ peerId: string; seat: number; nick: string; score: number; tier: string; color: string }> = [];
      this.state.players.forEach((other) => {
        if (other.id === target.id) return;
        const sc = Math.round(this.affinities.get(pairKey(target.id, other.id)) || 0);
        if (sc <= 0) return;
        let tier = "🌑 Yabancı";
        let color = "#8d99ae";
        if (sc >= 75) {
          tier = "🩸 Sırdaş / Şüpheli İttifak!";
          color = "#ff4d5e";
        } else if (sc >= 45) {
          tier = "🤝 Yakın Dost";
          color = "#ffd166";
        } else if (sc >= 18) {
          tier = "🕯️ Tanışık";
          color = "#7ab8ff";
        }
        bonds.push({
          peerId: other.id,
          seat: other.seat,
          nick: other.nick,
          score: sc,
          tier,
          color
        });
      });

      bonds.sort((a, b) => b.score - a.score);
      const zone = detectRoomZone(target.x, target.z);

      client.send("inspect_result", {
        id: target.id,
        nick: target.nick,
        charName: target.charName,
        seat: target.seat,
        alive: target.alive,
        roomName: zone.name,
        coatColor: target.coatColor,
        accentColor: target.accentColor,
        hat: target.hat,
        mask: target.mask,
        hasNecklace: this.state.necklaceHolder === target.id,
        topBonds: bonds.slice(0, 4)
      });

      const me = this.state.players.get(client.sessionId);
      if (me && me.alive && !me.ghost && target.id !== client.sessionId && this.state.phase === "DAY") {
        const dist = Math.hypot(me.x - target.x, me.z - target.z);
        if (dist <= 10.0 || (me.roomId !== "antre" && me.roomId !== "yemek_salonu")) {
          this.completeQuestByKind(client.sessionId, "DETECTIVE");
        }
      }
    });

    // 4. BULMACA & ETKİNLİK SALONU (`request_puzzle` & `submit_puzzle` — Gündüz İlk Çözene 📿 Altın Kolye!)
    this.onMessage("request_puzzle", (client, data?: { altarId?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.state.phase !== "DAY") return;

      if (this.solvedPuzzleRound.get(p.id) === this.state.round) {
        client.send("puzzle_feedback", {
          ok: false,
          text: "✅ Bu gündüz turunda zaten bir Rün Kürsüsü şifresi çözdün! Yeni günde tekrar gel."
        });
        return;
      }

      const now = Date.now();
      const cooldownUntil = this.puzzleCooldownUntil.get(p.id) || 0;
      if (now < cooldownUntil) {
        const rem = Math.max(1, Math.ceil((cooldownUntil - now) / 1000));
        client.send("puzzle_feedback", {
          ok: false,
          text: `⏳ Kürsünün taşları henüz soğuk! ${rem} sn sonra tekrar deneyebilirsin.`
        });
        return;
      }

      let altar = PUZZLE_ALTARS.find((a) => a.id === data?.altarId);
      if (!altar) {
        let bestDist = Infinity;
        for (const a of PUZZLE_ALTARS) {
          const d = Math.hypot(p.x - a.x, p.z - a.z);
          if (d < bestDist) {
            bestDist = d;
            altar = a;
          }
        }
      }
      altar = altar || PUZZLE_ALTARS[0];

      const distToAltar = Math.hypot(p.x - altar.x, p.z - altar.z);
      if (distToAltar > 9.0 && p.roomId !== "etkinlik_salonu") {
        client.send("puzzle_feedback", {
          ok: false,
          text: "🔮 Rün Kürsüsünü incelemek için önce Etkinlik Salonu'ndaki kürsüye yaklaşmalısın!"
        });
        return;
      }

      const challenge = createPuzzleChallenge(altar.kind);
      this.activePuzzles.set(p.id, challenge);

      client.send("puzzle_challenge", {
        puzzleId: challenge.puzzleId,
        title: challenge.title,
        prompt: challenge.prompt,
        options: challenge.options
      });
    });

    this.onMessage("submit_puzzle", (client, data: { puzzleId: string; optionIndex: number }) => {
      const p = this.state.players.get(client.sessionId);
      const ch = this.activePuzzles.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.state.phase !== "DAY" || !ch || ch.puzzleId !== data?.puzzleId) return;
      this.activePuzzles.delete(client.sessionId);

      if (Number(data.optionIndex) !== ch.correctIndex) {
        this.puzzleCooldownUntil.set(p.id, Date.now() + 6000);
        client.send("puzzle_feedback", {
          ok: false,
          text: "❌ Yanlış mühür! Kürsünün taşları 6 saniye soğudu, ipucunu dikkatle oku."
        });
        return;
      }

      this.solvedPuzzleRound.set(p.id, this.state.round);
      this.state.pot += 25;

      const aliveList: Array<{ id: string; seat: number; nick: string }> = [];
      this.state.players.forEach((pl) => {
        if (pl.alive && !pl.ghost) aliveList.push({ id: pl.id, seat: pl.seat, nick: pl.nick });
      });

      const clue = generateTrueDetectiveClue(p.id, aliveList, this.secretRoles);
      if (clue.grantedKahyaKey) {
        p.hasKahyaKey = true;
      }

      let wonNecklace = false;
      if (!this.necklaceClaimedByPuzzleThisRound && !this.state.necklaceHolder) {
        this.necklaceClaimedByPuzzleThisRound = true;
        this.state.necklaceHolder = p.id;
        wonNecklace = true;
        this.chronicleLog.push(
          `📿 Gün #${this.state.round}: Koltuk #${p.seat} (${p.nick}) Rün Kürsüsünü ilk çözüp o gecenin Altın Kolye korumasını kazandı.`
        );
        this.broadcast("chat_msg", {
          senderId: p.id,
          senderNick: "RÜN KÜRSÜSÜ",
          seat: p.seat,
          text: `📿 Koltuk #${p.seat} (${p.nick}) gündüz Rün Kürsüsünü İLK çözdü ve bu gecenin 📿 ALTIN KOLYE korumasını boynuna taktı!`,
          channel: "ETKİNLİK"
        });
      }

      client.send("puzzle_feedback", {
        ok: true,
        bonusGold: 20,
        wonNecklace,
        text: `${wonNecklace ? "📿 ALTIN KOLYE SENİN OLDU! (+20🪙 Kasa & +25🪙 Hazine) | " : "+20🪙 Kasa & +25🪙 Ortak Hazine! | "}${clue.clueText}`
      });
      this.completeQuestByKind(client.sessionId, "DETECTIVE");
    });

    // 5. TOPLANTI & KONSEY SALONU TAHTASI (`chalk_suspect`)
    this.onMessage("chalk_suspect", (client, data: { suspectSeat: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.state.phase !== "DAY") return;

      const distToBoard = Math.hypot(p.x - COUNCIL_BOARD_POS.x, p.z - COUNCIL_BOARD_POS.z);
      if (distToBoard > 9.5 && p.roomId !== "toplanti_salonu") {
        client.send("puzzle_feedback", {
          ok: false,
          text: "📋 Konsey Tahtasına şüpheli yazmak için önce Konsey Salonu'na yaklaşmalısın!"
        });
        return;
      }

      if (this.chalkUsedRound.get(p.id) === this.state.round) {
        client.send("puzzle_feedback", {
          ok: false,
          text: "📋 Bu gündüz turunda zaten Konsey Tahtasına bir şüpheli yazdın!"
        });
        return;
      }

      const target = Array.from(this.state.players.values()).find((x) => x.seat === Number(data?.suspectSeat));
      if (!target || target.id === p.id || !target.alive || target.ghost) {
        client.send("puzzle_feedback", {
          ok: false,
          text: "⚠️ Konsey Tahtasına yalnızca hayatta olan başka bir davetlinin koltuğu yazılabilir!"
        });
        return;
      }

      this.chalkUsedRound.set(p.id, this.state.round);
      this.accusedScoreThisRound.set(target.id, (this.accusedScoreThisRound.get(target.id) || 0) + 1);
      if (!this.aiControlledIds.has(p.id)) {
        this.accusedByHumansThisRound.add(target.id);
      }

      this.state.councilBoardNote = `📋 Konsey Tahtası: #${p.seat} ${p.nick} tebeşirle #${target.seat} ${target.nick} ismini şüpheli yazdı!`;
      this.broadcast("chat_msg", {
        senderId: p.id,
        senderNick: "KONSEY SALONU",
        seat: p.seat,
        text: this.state.councilBoardNote,
        channel: "KONSEY"
      });
      this.completeQuestByKind(client.sessionId, "ROOM_OR_BOARD");
    });

    // 5B. GERİYE DÖNÜK UYUMLU `TRIAL` MESAJLARI (Sadeleştirilmiş akışta zorunlu değil, güvenli tutuldu)
    this.onMessage("submit_trial_answer", (client, data: { puzzleId: string; optionIndex: number }) => {
      const p = this.state.players.get(client.sessionId);
      const ch = this.trialActiveChallenge.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.state.phase !== "TRIAL" || !ch || ch.puzzleId !== data?.puzzleId) {
        return;
      }

      const now = Date.now();
      if (now - (this.lastTrialSubmitAt.get(p.id) || 0) < 800) return;
      this.lastTrialSubmitAt.set(p.id, now);

      if (Number(data.optionIndex) !== ch.correctIndex) {
        const curStage = this.trialStageByPlayer.get(p.id) || 1;
        this.sendTrialStageToClient(client, curStage, "❌ Yanlış mühür! Yeni şifreyi dikkatle çöz:");
        return;
      }

      const curStage = this.trialStageByPlayer.get(p.id) || 1;
      this.state.pot += 20;
      client.send("match_reward", { bonusGold: 15, won: true });

      if (curStage < 3) {
        const nextStage = curStage + 1;
        this.trialStageByPlayer.set(p.id, nextStage);
        this.sendTrialStageToClient(client, nextStage, `✅ Aşama ${curStage}/3 Çözüldü! (+15🪙 Kasa & +20 Hazinesi)`);
        return;
      }

      this.trialStageByPlayer.set(p.id, 4);
      this.trialActiveChallenge.delete(p.id);

      const aliveList: Array<{ id: string; seat: number; nick: string }> = [];
      this.state.players.forEach((pl) => {
        if (pl.alive && !pl.ghost) aliveList.push({ id: pl.id, seat: pl.seat, nick: pl.nick });
      });
      const clue = generateTrueDetectiveClue(p.id, aliveList, this.secretRoles);
      if (clue.grantedKahyaKey) p.hasKahyaKey = true;
      this.trialCompletedClue.set(p.id, clue.clueText);

      let wonNecklace = false;
      if (!this.necklaceClaimedByPuzzleThisRound && !this.state.necklaceHolder) {
        this.necklaceClaimedByPuzzleThisRound = true;
        this.state.necklaceHolder = p.id;
        wonNecklace = true;
      }

      client.send("trial_completed", {
        wonNecklace,
        clueText: clue.clueText
      });
    });

    this.onMessage("sabotage_trial", (client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.state.phase !== "TRIAL") return;
      if (this.secretRoles.get(p.id) !== "HAIN") return;
      if (this.trialSabotagedPlayers.has(p.id)) return;

      this.trialSabotagedPlayers.add(p.id);
      this.trialSabotageCount += 1;
      this.pendingSabotagePotDrain += 25;
      this.chronicleLog.push(
        `🗡️ Gün #${this.state.round}: Gizli bir el Şato düzeneğini sabote edip ortak hazineden altın sızdırdı.`
      );
      client.send("match_reward", { bonusGold: 25, won: true });
      client.send("puzzle_feedback", {
        ok: true,
        bonusGold: 25,
        text: "🗡️ Şato düzeneğini gizlice SABOTE ettin! +25🪙 cebine indi!"
      });
    });

    // 5C. YUVARLAK SOFRA GEREKÇELİ SUÇLAMA ("Bu hain, çünkü bu yüzden!" — Birleşik VOTE ve TABLE'da aktif!)
    this.onMessage("accuse_player", (client, data: { targetId: string; reason: string }) => {
      const sender = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!sender || !sender.alive || sender.ghost || !target || !target.alive || target.ghost || sender.id === target.id) {
        return;
      }
      if (this.state.phase !== "VOTE" && this.state.phase !== "TABLE") return;

      const cleanReason = filterProfanityTR(
        String(data?.reason || "Hareketleri ve fısıltıları çok şüpheli!").trim()
      ).slice(0, 90);
      this.addAffinity(sender.id, target.id, -10);
      this.accusedScoreThisRound.set(target.id, (this.accusedScoreThisRound.get(target.id) || 0) + 2);
      if (!this.aiControlledIds.has(sender.id)) {
        this.accusedByHumansThisRound.add(target.id);
      }
      this.chronicleLog.push(
        `👉 Gün #${this.state.round} Sofra: #${sender.seat} ${sender.nick}, masada #${target.seat} ${target.nick} için "${cleanReason}" diyerek suçlama yöneltti.`
      );

      this.broadcast("chat_msg", {
        senderId: sender.id,
        senderNick: `👉 SUÇLAMA (#${sender.seat} ${sender.nick})`,
        seat: sender.seat,
        text: `"Koltuk #${target.seat} ${target.nick} HAİN! Çünkü: ${cleanReason}"`,
        channel: "SOFRA"
      });

      if (this.aiControlledIds.has(target.id)) {
        const seq = this.phaseSeq;
        this.clock.setTimeout(() => {
          if (this.phaseSeq !== seq || !target.alive || (this.state.phase !== "VOTE" && this.state.phase !== "TABLE")) {
            return;
          }
          const bRole = this.secretRoles.get(target.id) || "MISAFIR";
          const mem = this.botMemories.get(target.id) || createInitialBotMemory(target.seat);
          const reply = generateBotReply({
            botSeat: target.seat,
            botNick: target.nick,
            botRole: bRole,
            mem,
            askerNick: sender.nick,
            rawQuestion: "sen hainsin iftira",
            scapegoat: this.pickScapegoatForBot(target.id, bRole),
            topBond: this.getTopBondHighlight()
          });
          this.broadcast("chat_msg", {
            senderId: target.id,
            senderNick: target.nick,
            seat: target.seat,
            text: reply,
            channel: "SOFRA"
          });
        }, 1200);
      }
    });

    // 5D. ERKEN HAZIR OYU (Gündüz keşfinde tüm canlı insanlar hazırsa beklemeden doğrudan Yuvarlak Sofra & Oylamaya geç!)
    this.onMessage("ready_next_phase", (client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (
        this.state.phase !== "ARRIVAL" &&
        this.state.phase !== "DAY" &&
        this.state.phase !== "TRIAL" &&
        this.state.phase !== "TABLE"
      ) {
        return;
      }

      const aliveHumans = this.getAliveConnectedHumanIds();
      // Canlı insan varsa yalnız canlı insanlar oy kullanır; tüm insanlar elenip Hayalet olduysa Hayaletler botları hızlandırabilir!
      if (aliveHumans.length > 0 && (!p.alive || p.ghost)) return;

      this.readyPhasePlayers.add(p.id);
      this.checkEarlyReadyPhase(true);
    });

    // 5E. İSTEMCİ ÖZEL ROL & AKTİF EVRE SENKRONİZASYONU (Sayfa yenileme / yeniden bağlanmada rol ve seçim ekranı asla kaybolmasın!)
    this.onMessage("request_my_state", (client) => {
      this.syncFullClientPrivateState(client);
    });

    // 6. Lobi özelleştirme, Botlar, Hızlı Mod, Oto-Başlat, Başlat
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

        if (data.nick) p.nick = sanitizeNickname(data.nick);
        if (typeof data.seat === "number" && data.seat !== 11 && data.seat >= 1 && data.seat <= 12) {
          const occupant = Array.from(this.state.players.values()).find(
            (other) => other.id !== p.id && other.seat === data.seat
          );
          if (occupant && occupant.isBot) {
            const usedSeats = new Set<number>();
            this.state.players.forEach((pl) => usedSeats.add(pl.seat));
            const freeSeat = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].find((s) => !usedSeats.has(s) || s === p.seat);
            if (freeSeat) {
              occupant.seat = freeSeat;
              const botDef = CHARACTERS.find((c) => c.seat === freeSeat);
              if (botDef) {
                occupant.charName = botDef.name;
                occupant.nick = `${botDef.name} (${botDef.title})`;
                occupant.coatColor = botDef.coatColor;
                occupant.accentColor = botDef.accentColor;
                occupant.hat = botDef.hat;
                occupant.mask = botDef.mask;
              }
              const bsp = getAntreSpawn(freeSeat);
              occupant.x = bsp.x;
              occupant.z = bsp.z;
              occupant.rotY = bsp.rotY;
            }
          }
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
            const sp = getAntreSpawn(p.seat);
            p.x = sp.x;
            p.z = sp.z;
            p.rotY = sp.rotY;
          }
        }
        if (data.coatColor) p.coatColor = String(data.coatColor).slice(0, 12);
        if (data.accentColor) p.accentColor = String(data.accentColor).slice(0, 12);
        if (data.hat) p.hat = String(data.hat).slice(0, 16);
        if (data.mask) p.mask = String(data.mask).slice(0, 16);
      }
    );

    this.onMessage("add_bots", (client, data?: { count?: number }) => {
      if (this.state.phase !== "LOBBY" || this.state.hostId !== client.sessionId) return;
      const cap = Math.max(6, Math.min(SOFRA_CONFIG.MAX_CLIENTS, this.state.targetPlayerCount || SOFRA_CONFIG.DEFAULT_MATCH_CLIENTS));
      const want = Math.min(11, Math.max(1, Number(data?.count || 1)));
      for (let i = 0; i < want; i++) {
        if (this.state.players.size >= cap) break;
        this.spawnBot();
      }
    });

    this.onMessage("remove_bots", (client, data?: { count?: number }) => {
      if (this.state.phase !== "LOBBY" || this.state.hostId !== client.sessionId) return;
      const botIds = Array.from(this.state.players.values())
        .filter((pl) => pl.isBot)
        .map((pl) => pl.id);
      const want = data?.count ? Math.max(1, Number(data.count)) : botIds.length;
      for (let i = 0; i < want && botIds.length > 0; i++) {
        const remId = botIds.pop()!;
        this.deleteBotById(remId);
      }
    });

    this.onMessage("toggle_fast_mode", (client) => {
      if (this.state.hostId !== client.sessionId || this.state.phase !== "LOBBY") return;
      this.state.fastMode = !this.state.fastMode;
      this.state.paceMode = this.state.fastMode ? "10m" : "20m";
      const preset = resolveDurationPreset(this.state.paceMode);
      this.state.targetPlayerCount = preset.defaultPlayers;
      this.trimLobbyBotsTo(this.state.targetPlayerCount);
    });

    this.onMessage(
      "set_lobby_options",
      (
        client,
        data: { targetPlayerCount?: number; paceMode?: string; atmosphereTheme?: string }
      ) => {
        if (this.state.hostId !== client.sessionId || this.state.phase !== "LOBBY") return;
        const explicitTarget =
          data?.targetPlayerCount && [8, 10, 12].includes(Number(data.targetPlayerCount))
            ? Number(data.targetPlayerCount)
            : undefined;
        if (data?.paceMode && ["10m", "20m", "35m", "60m", "normal", "long", "fast"].includes(data.paceMode)) {
          const preset = resolveDurationPreset(data.paceMode);
          this.state.paceMode = preset.id;
          this.state.fastMode = preset.id === "10m";
          if (!explicitTarget) {
            this.state.targetPlayerCount = preset.defaultPlayers;
            this.trimLobbyBotsTo(this.state.targetPlayerCount);
          }
          this.setMetadata({
            code: this.state.code,
            roomTitle: this.state.roomTitle,
            hasPassword: this.state.hasPassword,
            paceMode: this.state.paceMode
          });
        }
        if (explicitTarget) {
          this.state.targetPlayerCount = explicitTarget;
          this.trimLobbyBotsTo(explicitTarget);
        }
        if (data?.atmosphereTheme && ["torch", "crimson", "mist"].includes(data.atmosphereTheme)) {
          this.state.atmosphereTheme = data.atmosphereTheme;
        }
      }
    );

    this.onMessage("toggle_auto_start", (client) => {
      if (this.state.hostId !== client.sessionId || this.state.phase !== "LOBBY") return;
      this.state.autoStart = !this.state.autoStart;
      if (this.state.autoStart) {
        this.scheduleAutoLobbyCountdown();
      } else if (this.autoLobbyTimer) {
        this.autoLobbyTimer.clear();
        this.state.phaseEndsAt = 0;
        this.state.announcement = "Otomatik başlatma durduruldu. Kurucu başlattığında oyun başlayacak.";
      }
    });

    this.onMessage("start_game", (client) => {
      if (this.state.hostId !== client.sessionId || this.state.phase !== "LOBBY") return;
      if (this.autoLobbyTimer) this.autoLobbyTimer.clear();
      const targetCount = Math.max(6, Math.min(SOFRA_CONFIG.MAX_CLIENTS, this.state.targetPlayerCount || SOFRA_CONFIG.DEFAULT_MATCH_CLIENTS));
      while (this.state.players.size < targetCount) {
        this.spawnBot();
      }
      this.startGameLoop();
    });

    // 7. Gizli Zarf Oylaması (votedForId = "SEALED" ile hedef sızıntısı %100 kapalı; "ABSTAIN" ile çekimser kalınabilir!)
    this.onMessage("vote", (client, data: { targetId: string }) => {
      if (this.state.phase !== "VOTE") return;
      const voter = this.state.players.get(client.sessionId);
      if (!voter || !voter.alive || voter.ghost) return;

      if (data?.targetId === "ABSTAIN") {
        this.votes.delete(voter.id);
        this.abstainedVoters.add(voter.id);
        voter.votedForId = "SEALED";
        this.maybeAccelerateBotVotes();
        this.checkIfAllVoted();
        return;
      }

      const target = this.state.players.get(data?.targetId);
      if (!target || !target.alive || target.ghost) return;
      if (voter.id === target.id) return;
      if (this.tieCandidates.length > 0 && !this.tieCandidates.includes(target.id)) return;

      this.abstainedVoters.delete(voter.id);
      this.votes.set(voter.id, target.id);
      voter.votedForId = "SEALED";

      const penaltyKey = `${voter.id}|${target.id}`;
      if (!this.penalizedVotePairsThisRound.has(penaltyKey)) {
        this.penalizedVotePairsThisRound.add(penaltyKey);
        this.addAffinity(voter.id, target.id, -15);
        if (!this.aiControlledIds.has(voter.id)) {
          this.accusedScoreThisRound.set(target.id, (this.accusedScoreThisRound.get(target.id) || 0) + 3);
          this.accusedByHumansThisRound.add(target.id);
        }
      }
      this.maybeAccelerateBotVotes();
      this.checkIfAllVoted();
    });

    // 8. GECE HAİNLER MECLİSİ İNFAZ SEÇİMİ, MÜHÜRLEME VE GECE NÖBETİ
    this.onMessage("night_pick", (client, data: { targetId: string; instantSeal?: boolean }) => {
      if (this.state.phase !== "NIGHT") return;
      if (this.secretRoles.get(client.sessionId) !== "HAIN") return;
      const voter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!voter || !voter.alive || voter.ghost || !target || !target.alive || target.ghost) return;
      if (this.secretRoles.get(target.id) === "HAIN") return;

      this.nightPicks.set(voter.id, target.id);
      this.sendToTraitors("traitor_pick_update", {
        traitorId: voter.id,
        traitorSeat: voter.seat,
        traitorNick: voter.nick,
        targetId: target.id,
        targetSeat: target.seat,
        targetNick: target.nick
      });
      this.sendToTraitors("chat_msg", {
        senderId: voter.id,
        senderNick: `🩸 İNFAZ SEÇİMİ (#${voter.seat} ${voter.nick})`,
        seat: voter.seat,
        text: `Koltuk #${target.seat} (${target.nick}) için İNFAZ oyu verdi!`,
        channel: "HAİN MECLİSİ"
      });

      // Gerçek oyuncu Hain hedef seçtiğinde Bot Hain ortakları da onun kararına uyar (bot oyu oyuncunun infaz kararını bozmaz!)
      this.state.players.forEach((bot) => {
        if (this.aiControlledIds.has(bot.id) && bot.alive && this.secretRoles.get(bot.id) === "HAIN") {
          this.nightPicks.set(bot.id, target.id);
          this.sendToTraitors("traitor_pick_update", {
            traitorId: bot.id,
            traitorSeat: bot.seat,
            traitorNick: bot.nick,
            targetId: target.id,
            targetSeat: target.seat,
            targetNick: target.nick
          });
          this.sendToTraitors("chat_msg", {
            senderId: bot.id,
            senderNick: bot.nick,
            seat: bot.seat,
            text: `🗡️ Kararına katılıyorum ortağım! Ben de #${target.seat} ${target.nick} için infaz mührü basıyorum!`,
            channel: "HAİN MECLİSİ"
          });
        }
      });

      if (data?.instantSeal) {
        this.sealNightForTraitor(voter);
      }
    });

    this.onMessage("seal_night_execution", (client) => {
      if (this.state.phase !== "NIGHT") return;
      if (this.secretRoles.get(client.sessionId) !== "HAIN") return;
      const voter = this.state.players.get(client.sessionId);
      if (!voter || !voter.alive || voter.ghost) return;
      if (!this.nightPicks.has(voter.id)) {
        client.send("chat_msg", {
          senderId: voter.id,
          senderNick: "HAİN MECLİSİ",
          seat: 11,
          text: "⚠️ Önce yukarıdan infaz edilecek bir Misafir seçmelisin!",
          channel: "HAİN MECLİSİ"
        });
        return;
      }

      this.sealNightForTraitor(voter);
    });

    this.onMessage("night_watch", (client) => {
      if (this.state.phase !== "NIGHT") return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.secretRoles.get(p.id) === "HAIN") return;
      if (this.nightWatchedPlayers.has(p.id)) return;

      this.nightWatchedPlayers.add(p.id);
      client.send("match_reward", { bonusGold: 10, won: true });

      const aliveTraitors = this.getAlivePlayerIds()
        .filter((id) => this.secretRoles.get(id) === "HAIN")
        .map((id) => this.state.players.get(id)!)
        .filter(Boolean);
      const hintTraitor = aliveTraitors[Math.floor(Math.random() * aliveTraitors.length)];
      const wingText = hintTraitor
        ? hintTraitor.seat <= 6
          ? "Batı Koridoru (#1-#6)"
          : "Doğu Koridoru (#7-#12)"
        : "Kuzey Koridoru";

      const watchText = `🕯️ Kapı deliğinden karanlık koridoru dinledin (+10🪙 Cesaret Ödülü): Gece yarısı ${wingText} tarafından kuleye çıkan gizli ayak sesleri duyuldu!`;
      this.nightWatchTexts.set(p.id, watchText);
      client.send("night_watch_result", {
        text: watchText
      });
    });

    // 9. Final Kararı
    this.onMessage("final_decision", (client, data: { decision: "TRUST" | "DOUBT" }) => {
      if (this.state.phase !== "FINAL") return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost) return;
      this.finalDecisions.set(p.id, data?.decision === "DOUBT" ? "DOUBT" : "TRUST");
      this.checkFinalDecisionsComplete();
    });

    // 10. GENEL / YAKIN / GECE HAİN MECLİSİ SOHBETİ + ZEKİ BOT CEVABI!
    this.onMessage("chat", (client, data: { text: string; channel?: string }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const rawText = filterProfanityTR(String(data?.text || "").trim().slice(0, 140));
      if (!rawText) return;

      const senderRole = this.secretRoles.get(sender.id) || "MISAFIR";
      // Gece evresinde Hain konuşursa otomatik olarak yalnız Hainler Meclisi duyar!
      const isNightConclave = this.state.phase === "NIGHT" && !sender.ghost;
      if (isNightConclave && senderRole !== "HAIN") {
        const nightDurLabel = formatDurationLabelTR(this.getPhaseSeconds("NIGHT", SOFRA_CONFIG.DURATIONS.NIGHT));
        client.send("chat_msg", {
          senderId: sender.id,
          senderNick: "GECE KİLİDİ",
          seat: sender.seat,
          text: `🕯️ Şu an ${nightDurLabel} Gece Molası: Hainler gizli toplantı yapıyor, odandan ses çıkaramazsın!`,
          channel: "SİSTEM"
        });
        return;
      }

      const isTraitorWhisper =
        (data?.channel === "HAIN" || isNightConclave) && senderRole === "HAIN" && !sender.ghost;

      if (isTraitorWhisper) {
        this.clients.forEach((c) => {
          const receiver = this.state.players.get(c.sessionId);
          if (!receiver || this.secretRoles.get(receiver.id) !== "HAIN") return;
          c.send("chat_msg", {
            senderId: sender.id,
            senderNick: sender.nick,
            seat: sender.seat,
            text: rawText,
            channel: "HAİN MECLİSİ"
          });
        });

        // Gece Hainler Meclisinde Hain Bot ortağın varsa sana cevap verip infaz hedefi önerir; gündüz/sofrada da HAIN kanalı asla dışarı sızmaz!
        if (this.state.phase === "NIGHT") {
          const botTraitor = Array.from(this.state.players.values()).find(
            (bp) => this.aiControlledIds.has(bp.id) && bp.alive && this.secretRoles.get(bp.id) === "HAIN"
          );
          if (botTraitor) {
            const seq = this.phaseSeq;
            this.clock.setTimeout(() => {
              if (this.phaseSeq !== seq || this.state.phase !== "NIGHT" || !botTraitor.alive) return;
              const pickId = this.nightPicks.get(botTraitor.id);
              const pickPlayer = pickId ? this.state.players.get(pickId) : undefined;
              const sc = pickPlayer
                ? { seat: pickPlayer.seat, nick: pickPlayer.nick }
                : this.pickScapegoatForBot(botTraitor.id, "HAIN");
              if (!sc) return;
              const neckP = this.state.necklaceHolder ? this.state.players.get(this.state.necklaceHolder) : undefined;
              const line = generateNightTraitorChatLine({
                botNick: botTraitor.nick,
                targetSeat: sc.seat,
                targetNick: sc.nick,
                necklaceSeat: neckP?.seat
              });
              this.sendToTraitors("chat_msg", {
                senderId: botTraitor.id,
                senderNick: botTraitor.nick,
                seat: botTraitor.seat,
                text: line,
                channel: "HAİN MECLİSİ"
              });
            }, 1100);
          }
        }
        return;
      }

      this.sendProximityOrPhaseChat(sender, {
        senderId: sender.id,
        senderNick: sender.nick,
        seat: sender.seat,
        text: rawText,
        channel: sender.ghost ? "HAYALET" : this.state.phase === "DAY" ? "YAKIN" : "SOFRA"
      });

      // Yakındaki (veya Sofradaki) bir Akıllı Bot bu mesaja doğal Türkçe "Mini-AI" cevabı versin!
      if (
        !sender.ghost &&
        sender.alive &&
        (this.state.phase === "DAY" ||
          this.state.phase === "VOTE" ||
          this.state.phase === "TABLE" ||
          this.state.phase === "LOBBY")
      ) {
        const nearbyBots: Player[] = [];
        this.state.players.forEach((bp) => {
          if (!this.aiControlledIds.has(bp.id) || !bp.alive) return;
          const d = Math.hypot(bp.x - sender.x, bp.z - sender.z);
          if (this.state.phase !== "DAY" || d <= 14 || bp.roomId === sender.roomId) {
            nearbyBots.push(bp);
            if (this.state.phase === "DAY" && d <= 8) {
              this.addAffinity(sender.id, bp.id, 4);
            }
          }
        });

        if (nearbyBots.length > 0) {
          const lower = rawText.toLocaleLowerCase("tr-TR");
          const addressed =
            nearbyBots.find(
              (b) =>
                lower.includes(b.nick.split("(")[0].trim().toLocaleLowerCase("tr-TR")) ||
                lower.includes(b.charName.split("(")[0].trim().toLocaleLowerCase("tr-TR")) ||
                lower.includes(`#${b.seat}`)
            ) || nearbyBots[Math.floor(Math.random() * nearbyBots.length)];

          const seq = this.phaseSeq;
          this.clock.setTimeout(async () => {
            if (this.phaseSeq !== seq || !addressed.alive || !sender.alive || sender.ghost) return;
            const role = this.secretRoles.get(addressed.id) || "MISAFIR";
            let mem = this.botMemories.get(addressed.id);
            if (!mem) {
              mem = createInitialBotMemory(addressed.seat);
              this.botMemories.set(addressed.id, mem);
            }
            const neckHolder = this.state.necklaceHolder
              ? this.state.players.get(this.state.necklaceHolder)
              : undefined;

            const res = await generateSmartBotReplyAsync({
              botId: addressed.id,
              botSeat: addressed.seat,
              botNick: addressed.nick,
              botRole: role,
              mem,
              askerId: sender.id,
              askerNick: sender.nick,
              askerRole: role === "HAIN" && senderRole === "HAIN" ? "HAIN" : "MISAFIR",
              rawQuestion: rawText,
              phase: this.state.phase,
              isPrivatePM: false,
              bondWithAsker: Math.round(this.affinities.get(pairKey(sender.id, addressed.id)) || 0),
              necklaceHolderNick: neckHolder ? `#${neckHolder.seat} ${neckHolder.nick}` : undefined,
              sabotageCount: this.trialSabotageCount,
              scapegoat: this.pickScapegoatForBot(addressed.id, role),
              topBond: this.getTopBondHighlight(),
              players: this.buildRoomPlayerBriefs(addressed.id)
            });

            if (this.phaseSeq !== seq || !addressed.alive || !sender.alive || sender.ghost) return;

            if (res.followAsker && this.state.phase === "DAY") {
              mem.followTargetId = sender.id;
              mem.followUntil = Date.now() + 28000;
            }
            if (res.persuadedVoteTargetId) {
              this.tryApplyBotPersuadedVote(addressed, mem, res.persuadedVoteTargetId);
            }

            this.sendProximityOrPhaseChat(addressed, {
              senderId: addressed.id,
              senderNick: addressed.nick,
              seat: addressed.seat,
              text: res.text,
              channel: this.state.phase === "DAY" ? "YAKIN" : "SOFRA"
            });
          }, 950 + Math.random() * 750);
        }
      }
    });

    // 11. KNIGHT ONLINE 1'E 1 ÖZEL FISILTI (PM / DM) -> HER MESAFEDEN ÇALIŞIR + MİNİ-AI BOT CEVABI!
    this.onMessage("pm", (client, data: { targetId: string; text: string }) => {
      const sender = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!sender || !target || sender.id === target.id) return;

      const rawText = filterProfanityTR(String(data?.text || "").trim().slice(0, 140));
      if (!rawText) return;

      if ((sender.ghost || !sender.alive) && target.alive && !target.ghost) {
        client.send("pm_error", { text: "Hayaletler yaşayan davetlilere fısıldayamaz!" });
        return;
      }

      if (this.state.phase === "NIGHT") {
        if (this.secretRoles.get(sender.id) !== "HAIN" || this.secretRoles.get(target.id) !== "HAIN") {
          client.send("pm_error", { text: "Gece molasında yalnızca Hainler kendi aralarında konuşabilir!" });
          return;
        }
      }

      let affinityGain = 7;
      if (this.state.phase === "DAY" && !sender.ghost) {
        const sameRoom = sender.roomId === target.roomId;
        const dist = Math.hypot(sender.x - target.x, sender.z - target.z);
        const sDoor = DOORS.find((d) => d.roomId === sender.roomId);
        const sClosed = sDoor ? !this.state.doors.get(sDoor.id)?.open : false;

        if (dist <= 14 || sameRoom) {
          affinityGain = 13; // Yakın fısıltı Arkadaşlık Barını çok daha hızlı yükseltir!
          if (!sClosed) {
            this.clients.forEach((otherClient) => {
              if (otherClient.sessionId === sender.id || otherClient.sessionId === target.id) return;
              const observer = this.state.players.get(otherClient.sessionId);
              if (!observer) return;
              const obsDist = Math.hypot(observer.x - sender.x, observer.z - sender.z);
              if (obsDist <= 11 && observer.roomId === sender.roomId) {
                otherClient.send("chat_msg", {
                  senderId: sender.id,
                  senderNick: "GÖZLEM",
                  seat: sender.seat,
                  text: `👀 #${sender.seat} ${sender.nick}, #${target.seat} ${target.nick}'in kulağına gizlice fısıldadı...`,
                  channel: "ETKİ"
                });
              }
            });
          }
        }
      }

      // EN ÖNEMLİ KURAL: Özel Fısıltı (PM) İkilinin Yakınlık / Arkadaşlık Barını Artırır!
      this.addAffinity(sender.id, target.id, affinityGain);
      this.syncSocialQuestProgress(sender.id);
      this.syncSocialQuestProgress(target.id);

      const payload = {
        fromId: sender.id,
        fromNick: sender.nick,
        fromSeat: sender.seat,
        toId: target.id,
        toNick: target.nick,
        toSeat: target.seat,
        text: rawText,
        ts: Date.now()
      };

      client.send("pm_msg", payload);
      const targetClient = this.clients.find((c) => c.sessionId === target.id);
      if (targetClient) {
        targetClient.send("pm_msg", payload);
      } else if (this.aiControlledIds.has(target.id) && target.alive) {
        // Zeki Mini-AI Bot hafızası, kişiliği, rolü ve bahsedilen oyunculara göre doğal cevap verir!
        const seq = this.phaseSeq;
        this.clock.setTimeout(async () => {
          if (this.phaseSeq !== seq || !target.alive || !sender.alive || sender.ghost) return;
          const bRole = this.secretRoles.get(target.id) || "MISAFIR";
          const sRole = this.secretRoles.get(sender.id) || "MISAFIR";
          let mem = this.botMemories.get(target.id);
          if (!mem) {
            mem = createInitialBotMemory(target.seat);
            this.botMemories.set(target.id, mem);
          }
          const neckHolder = this.state.necklaceHolder
            ? this.state.players.get(this.state.necklaceHolder)
            : undefined;

          const res = await generateSmartBotReplyAsync({
            botId: target.id,
            botSeat: target.seat,
            botNick: target.nick,
            botRole: bRole,
            mem,
            askerId: sender.id,
            askerNick: sender.nick,
            askerRole: bRole === "HAIN" && sRole === "HAIN" ? "HAIN" : "MISAFIR",
            rawQuestion: rawText,
            phase: this.state.phase,
            isPrivatePM: true,
            bondWithAsker: Math.round(this.affinities.get(pairKey(sender.id, target.id)) || 0),
            necklaceHolderNick: neckHolder ? `#${neckHolder.seat} ${neckHolder.nick}` : undefined,
            sabotageCount: this.trialSabotageCount,
            scapegoat: this.pickScapegoatForBot(target.id, bRole),
            topBond: this.getTopBondHighlight(),
            players: this.buildRoomPlayerBriefs(target.id)
          });

          if (this.phaseSeq !== seq || !target.alive || !sender.alive || sender.ghost) return;

          if (res.followAsker && this.state.phase === "DAY") {
            mem.followTargetId = sender.id;
            mem.followUntil = Date.now() + 28000;
          }
          if (res.persuadedVoteTargetId) {
            this.tryApplyBotPersuadedVote(target, mem, res.persuadedVoteTargetId);
          }

          this.addAffinity(sender.id, target.id, 5);
          client.send("pm_msg", {
            fromId: target.id,
            fromNick: target.nick,
            fromSeat: target.seat,
            toId: sender.id,
            toNick: sender.nick,
            toSeat: sender.seat,
            text: res.text,
            ts: Date.now()
          });
        }, 900 + Math.random() * 650);
      }
    });

    // 12. Kendi İsteğiyle Ayrılma
    this.onMessage("forfeit_leave", (client) => {
      this.handlePermanentDeparture(client.sessionId);
      client.leave(1000);
    });

    // 13. Lobiye Dön (Yalnızca RESULT evresinde; kurucu bağlıysa yalnız kurucu tetikler!)
    this.onMessage("back_to_lobby", (client) => {
      if (this.state.phase !== "RESULT") return;
      const hostConnected = Boolean(this.state.hostId && this.state.players.get(this.state.hostId)?.connected);
      if (hostConnected && this.state.hostId !== client.sessionId) {
        client.send("puzzle_feedback", {
          ok: false,
          text: "👑 Yeni oyun için odayı lobiye yalnızca Oda Kurucusu döndürebilir!"
        });
        return;
      }
      if (!hostConnected) {
        this.state.hostId = client.sessionId;
      }
      this.resetToLobby();
    });

    // 14. KÂHYA ZİLİ EKONOMİSİ (50🪙 Ortak Hazineden Harcayarak 2 Koltuğun Aynı Takımda Olup Olmadığını Öğren — Gündüz & Birleşik Sofra/Oylamada Aktif!)
    this.onMessage("ask_kahya", (client, data: { seatA: number; seatB: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost) return;
      if (this.state.phase !== "DAY" && this.state.phase !== "VOTE" && this.state.phase !== "TABLE") return;

      if (this.kahyaBellUsedRound === this.state.round) {
        client.send("puzzle_feedback", {
          ok: false,
          text: "🔔 Kâhya Zili bu gün içinde zaten çalındı! Yeni gün başladığında tekrar sorabilirsin."
        });
        return;
      }
      if (this.state.pot < 50) {
        client.send("puzzle_feedback", {
          ok: false,
          text: `🔔 Ortak Şato Hazinesinde en az 50🪙 olmalı! (Şu an: ${this.state.pot}🪙 — Görev ve bulmaca çözerek hazineyi büyütün.)`
        });
        return;
      }

      const seatA = Number(data?.seatA);
      const seatB = Number(data?.seatB);
      if (!seatA || !seatB || seatA === seatB) return;

      const playersArr = Array.from(this.state.players.values());
      const pA = playersArr.find((x) => x.seat === seatA);
      const pB = playersArr.find((x) => x.seat === seatB);
      if (!pA || !pB) return;

      this.state.pot = Math.max(0, this.state.pot - 50);
      this.kahyaBellUsedRound = this.state.round;

      const roleA = this.secretRoles.get(pA.id) || "MISAFIR";
      const roleB = this.secretRoles.get(pB.id) || "MISAFIR";
      const sameTeam = roleA === roleB;

      this.broadcast("chat_msg", {
        senderId: "",
        senderNick: "KÂHYA ZİLİ",
        seat: 11,
        text: `🔔 Ortak Hazineden 50🪙 ödendi! Kâhya bir davetlinin kulağına iki koltuk hakkındaki gerçeği fısıldadı...`,
        channel: "ETKİ"
      });

      client.send("kahya_answer", {
        sameTeam,
        text: sameTeam
          ? `🔔 Kâhya'nın Gizli Yanıtı: Koltuk #${pA.seat} (${pA.nick}) ile Koltuk #${pB.seat} (${pB.nick}) AYNI TAKIMDA! (İkisi de Misafir VEYA ikisi de Hain!)`
          : `🔔 Kâhya'nın Gizli Yanıtı: Koltuk #${pA.seat} (${pA.nick}) ile Koltuk #${pB.seat} (${pB.nick}) FARKLI TAKIMDA! (İkisinden biri kesinlikle HAİN!)`
      });
    });

    // 15. GÜNDÜZ HAİN SABOTAJI A: MUMLARI SÖNDÜR (12 Saniye Şato Karartması, 75 sn Bekleme Süresi)
    this.onMessage("sabotage_lights", (client) => {
      if (this.state.phase !== "DAY") return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost) return;
      if (this.secretRoles.get(p.id) !== "HAIN") return;

      const now = Date.now();
      const remSec = Math.ceil((75000 - (now - this.lastLightSabotageAt)) / 1000);
      if (remSec > 0) {
        client.send("puzzle_feedback", {
          ok: false,
          text: `🕯️ Şato şamdanları yeni yakıldı! Tekrar karartmak için ${remSec} saniye beklemelisin.`
        });
        return;
      }

      this.lastLightSabotageAt = now;
      this.chronicleLog.push(
        `🕯️ Gün #${this.state.round}: Hainler avize ve şamdanları söndürerek şatoya 12 saniyelik zifiri karanlık çöktürdü.`
      );
      this.broadcast("blackout_event", { durationSec: 12 });
      this.broadcast("chat_msg", {
        senderId: "",
        senderNick: "KARARTMA",
        seat: 11,
        text: "🕯️ ŞATODA KARARTMA! Gizli bir el avize ve şamdanları söndürdü — 12 saniye zifiri karanlık!",
        channel: "SABOTAJ"
      });
    });

    // 16. GÜNDÜZ HAİN SABOTAJI B: SAHTE İSİMSİZ NOT BIRAK (Tur Başına 1 Kez)
    this.onMessage("sabotage_note", (client, data: { targetId: string; note: string }) => {
      if (this.state.phase !== "DAY") return;
      const p = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!p || !p.alive || p.ghost || !target || target.id === p.id) return;
      if (this.secretRoles.get(p.id) !== "HAIN") return;

      if (this.noteSabotageUsedRound.get(p.id) === this.state.round) {
        client.send("puzzle_feedback", {
          ok: false,
          text: "📜 Bu gündüz turunda zaten sahte bir isimsiz not bıraktın!"
        });
        return;
      }

      const cleanNote = filterProfanityTR(
        String(data?.note || "Yanındaki kişiye sakın güvenme, zarfı kan kokuyor!").trim().slice(0, 75)
      );
      if (!cleanNote) return;

      this.noteSabotageUsedRound.set(p.id, this.state.round);

      const targetClient = this.clients.find((c) => c.sessionId === target.id);
      if (targetClient) {
        targetClient.send("anonymous_note", {
          text: cleanNote
        });
      }

      client.send("puzzle_feedback", {
        ok: true,
        text: `📜 İsimsiz mühürsüz not gizlice #${target.seat} ${target.nick}'in cebine bırakıldı!`
      });
    });

    // 17. HAYALET ETKİLEŞİMİ: MUMLARI TİTRET (Elenen Oyuncular Oyundan Kopmasın!)
    this.onMessage("ghost_haunt", (client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || (p.alive && !p.ghost)) return;

      const now = Date.now();
      const last = this.ghostHauntCooldown.get(p.id) || 0;
      if (now - last < 12000) return;
      this.ghostHauntCooldown.set(p.id, now);

      this.broadcast("ghost_flicker", { seat: p.seat });
      this.broadcast("chat_msg", {
        senderId: "",
        senderNick: "RUHLAR",
        seat: p.seat,
        text: "👻 Şamdanların alevi buz gibi bir rüzgârla titredi... Elenen bir davetlinin ruhu işaret veriyor!",
        channel: "ETKİ"
      });
    });

    // 18. YENİ ORTA ÇAĞ ODALARI ETKİLEŞİMLERİ (Simya, Cephanelik, Kütüphane, Zindan, Avlu Kuyusu)
    this.onMessage("use_medieval_station", (client, data: { stationId: string; optionId: string }) => {
      if (this.state.phase !== "DAY") return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost) return;

      const station = MEDIEVAL_STATIONS.find((s) => s.id === data?.stationId);
      if (!station) return;
      const opt = station.options.find((o) => o.id === data?.optionId);
      if (!opt) return;

      const dist = Math.hypot(p.x - station.x, p.z - station.z);
      if (dist > 8.5 && p.roomId !== station.roomId) {
        client.send("puzzle_feedback", {
          ok: false,
          text: `⚠️ ${station.title} etkileşimi için önce o odaya yaklaşmalısın!`
        });
        return;
      }

      const useKey = `${this.state.round}:${p.id}`;
      const usedList = this.medievalStationUses.get(useKey) || [];
      if (usedList.includes(station.id)) {
        client.send("puzzle_feedback", {
          ok: false,
          text: `⏳ ${station.title} hakkını bu gündüz turunda zaten kullandın! Başka bir Orta Çağ odasını keşfet.`
        });
        return;
      }
      const maxStationUses = resolveDurationPreset(this.state.paceMode, this.state.fastMode).stationUsesPerDay;
      if (usedList.length >= maxStationUses) {
        client.send("puzzle_feedback", {
          ok: false,
          text: `⏳ Bu oyun süresinde bir gündüz turunda en fazla ${maxStationUses} Orta Çağ istasyonu kullanabilirsin! Yeni günde tekrar gel.`
        });
        return;
      }

      usedList.push(station.id);
      this.medievalStationUses.set(useKey, usedList);
      this.completeQuestByKind(p.id, "DETECTIVE");

      const aliveTraitors = this.getAlivePlayerIds()
        .filter((id) => this.secretRoles.get(id) === "HAIN")
        .map((id) => this.state.players.get(id)!)
        .filter(Boolean);
      const aliveOthers = this.getAlivePlayerIds()
        .filter((id) => id !== p.id)
        .map((id) => this.state.players.get(id)!)
        .filter(Boolean);

      let bonusGold = 0;
      let feedbackText = "";

      switch (opt.id) {
        case "truth_vapor": {
          const sample = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
          if (sample) {
            const isSampleHain = this.secretRoles.get(sample.id) === "HAIN";
            feedbackText = isSampleHain
              ? `⚗️ Zümrüt Simya Buharı Kızıla Döndü! Koltuk #${sample.seat} (${sample.nick}) çevresinde yoğun bir barut ve ihanet kokusu seziliyor!`
              : `⚗️ Zümrüt Simya Buharı Berraklaştı: Koltuk #${sample.seat} (${sample.nick}) üzerinde masum bir davetli aurası görünüyor.`;
          } else {
            feedbackText = "⚗️ Kazanın buharında şatonun gölgeleri dalgalandı.";
          }
          break;
        }
        case "transmute_gold": {
          bonusGold = 15;
          this.state.pot += 15;
          feedbackText = "✨ Simya Taşı parladı! Kurşunu altına dönüştürdün: Kişisel kasana +15🪙 ve Ortak Şato Hazinesine +15🪙 eklendi!";
          break;
        }
        case "shadow_draught": {
          const myRole = this.secretRoles.get(p.id) || "MISAFIR";
          if (myRole === "HAIN") {
            const decoy = aliveOthers.find((o) => this.secretRoles.get(o.id) !== "HAIN") || aliveOthers[0];
            if (decoy) {
              this.broadcast("chat_msg", {
                senderId: "",
                senderNick: "SİMYA MAHZENİ",
                seat: 11,
                text: `⚗️ Simya mahzeninden yükselen dumanlarda Koltuk #${decoy.seat} civarında şüpheli bir gölge görüldüğü fısıldanıyor...`,
                channel: "ETKİ"
              });
            }
            feedbackText = "🌑 Gölge İksiri etkisini gösterdi: Şatoya dikkat dağıtıcı bir şüphe fısıltısı yayıldı!";
          } else {
            let bestPeer: Player | undefined;
            let bestVal = -1;
            for (const o of aliveOthers) {
              const sc = this.affinities.get(pairKey(p.id, o.id)) || 0;
              if (sc > bestVal) {
                bestVal = sc;
                bestPeer = o;
              }
            }
            if (bestPeer) {
              this.addAffinity(p.id, bestPeer.id, 12);
              this.syncSocialQuestProgress(p.id);
              feedbackText = `🧪 Dostluk İksiri: #${bestPeer.seat} ${bestPeer.nick} ile arandaki güven ve yakınlık bağı +12 güçlendi!`;
            } else {
              bonusGold = 10;
              feedbackText = "🧪 İksir sana zihin açıklığı verdi (+10🪙)!";
            }
          }
          break;
        }
        case "inspect_blades": {
          const t = aliveTraitors[Math.floor(Math.random() * aliveTraitors.length)];
          if (t) {
            const corridor = t.seat <= 6 ? "Batı Yatak Koridoru (#1 - #6)" : "Doğu Yatak Koridoru (#7 - #12)";
            feedbackText = `⚔️ Cephanelik Kaydı: Silah rafından eksilen zehirli hançerin izi ${corridor} tarafına uzanıyor!`;
          } else {
            feedbackText = "⚔️ Silah rafları tam görünüyor; şatoda gizli hançer izi kalmamış.";
          }
          break;
        }
        case "equip_helm": {
          this.snapshotOriginalCosmetics(p);
          p.hat = "knight";
          p.accentColor = "#d8e2ef";
          feedbackText = "🪖 Orta Çağ Şövalye Miğferi ve gümüş omuz zırhı kuşandın! Herkes yeni zırhını görüyor.";
          break;
        }
        case "polish_shields": {
          bonusGold = 10;
          this.state.pot += 20;
          feedbackText = "🛡️ Hanedan kalkanlarını parlattın! Muhafız sandığından Ortak Hazineye +20🪙 ve kasana +10🪙 eklendi!";
          break;
        }
        case "read_lineage": {
          const top = this.getTopBondHighlight();
          if (top) {
            feedbackText = `📚 Vakayiname Şeceresi: Şu an şatodaki en güçlü gizli ittifak/fısıltı bağı #${top.seatA} ${top.nickA} ile #${top.seatB} ${top.nickB} arasında (%${Math.round(top.score)})!`;
          } else {
            feedbackText = "📚 Vakayiname Şeceresi: Henüz şatoda derin bir gizli ittifak kayda geçmemiş; koridorları izlemeye devam et!";
          }
          break;
        }
        case "kahya_ledger": {
          bonusGold = 10;
          this.state.pot += 10;
          const neckOwner = this.state.necklaceHolder ? this.state.players.get(this.state.necklaceHolder) : undefined;
          const bellStatus =
            this.kahyaBellUsedRound === this.state.round ? "Bugün çalındı" : "Bugün henüz çalınmadı";
          feedbackText = `🕯️ Kâhya Kayıt Defteri (+10🪙 Kasa & +10🪙 Hazine): Ortak Hazine ${this.state.pot}🪙 · Kâhya Zili: ${bellStatus} · Altın Kolye: ${
            neckOwner ? `#${neckOwner.seat} ${neckOwner.nick}` : "Henüz sahnedeki Rün Kürsüsünden alınmadı"
          }.`;
          break;
        }
        case "equip_wizard": {
          this.snapshotOriginalCosmetics(p);
          p.hat = "wizard";
          p.accentColor = "#ffd166";
          feedbackText = "🧙 Başbüyücü & Alim Başlığı taktın! Bilge görünümün tüm şatoda dikkat çekiyor.";
          break;
        }
        case "chain_omen": {
          feedbackText = `⛓️ Zindan Duvarındaki Kanlı Çentikler: Şu an Yuvarlak Sofrada hayatta olan tam ${aliveTraitors.length} HAİN bulunuyor!`;
          break;
        }
        case "rattle_chains": {
          this.broadcast("chat_msg", {
            senderId: "",
            senderNick: "ZİNDAN MAHZENİ",
            seat: 11,
            text: "⛓️ Kuzeydoğu Zindanından dondurucu zincir ve demir parmaklık sesleri tüm şatoda yankılandı!",
            channel: "ETKİ"
          });
          bonusGold = 10;
          feedbackText = "🔔 Zindan zincirlerini çınlatarak tüm şatoya ürperti saldın (+10🪙 Cesaret Ödülü)!";
          break;
        }
        case "equip_ironmask": {
          this.snapshotOriginalCosmetics(p);
          p.mask = "ironmask";
          feedbackText = "🎭 Orta Çağ Çelik Sorgu Maskesini yüzüne taktın!";
          break;
        }
        case "wish_coin": {
          this.state.pot += 25;
          this.broadcast("chat_msg", {
            senderId: p.id,
            senderNick: "DİLEK KUYUSU",
            seat: p.seat,
            text: `⛲ Bir davetli Kargalı Avlu Kuyusuna bereket mührü attı — Ortak Şato Hazinesi +25🪙 büyüdü! (Toplam: ${this.state.pot}🪙)`,
            channel: "ETKİ"
          });
          feedbackText = `⛲ Kuyunun suları altın ışıkla parladı! Ortak Şato Hazinesine +25🪙 eklendi (Toplam Hazine: ${this.state.pot}🪙).`;
          break;
        }
        case "feed_raven": {
          const roomCounts = new Map<string, string[]>();
          this.state.players.forEach((pl) => {
            if (!pl.alive || pl.ghost || pl.id === p.id) return;
            const rName = detectRoomZone(pl.x, pl.z).name;
            const arr = roomCounts.get(rName) || [];
            arr.push(`#${pl.seat} ${pl.nick}`);
            roomCounts.set(rName, arr);
          });
          let busiestRoom = "Büyük Şölen Salonu";
          let busiestList: string[] = [];
          roomCounts.forEach((arr, rName) => {
            if (arr.length > busiestList.length) {
              busiestRoom = rName;
              busiestList = arr;
            }
          });
          feedbackText =
            busiestList.length > 0
              ? `🐦‍⬛ Nöbetçi Kuzgun Fısıldadı: Şu an en kalabalık bölge "${busiestRoom}" (${busiestList.slice(0, 3).join(", ")})!`
              : "🐦‍⬛ Nöbetçi Kuzgun: Davetliler koridorlara dağılmış durumda.";
          break;
        }
      }

      client.send("puzzle_feedback", {
        ok: true,
        bonusGold: bonusGold > 0 ? bonusGold : undefined,
        text: feedbackText
      });
    });

    // Kayıtsız veya gelecek sürüm istemci mesajlarında Colyseus 4002 kopmasını önleyen güvenli joker dinleyici
    this.onMessage("*", () => {});
  }

  private getOpenDoorsRecord(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    this.state.doors.forEach((ds, id) => {
      out[id] = ds.open;
    });
    return out;
  }

  private getLockedDoorsRecord(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    this.state.doors.forEach((ds, id) => {
      out[id] = ds.locked;
    });
    return out;
  }

  private deleteBotById(botId: string) {
    this.state.players.delete(botId);
    this.aiControlledIds.delete(botId);
    this.botBrains.delete(botId);
    this.botMemories.delete(botId);
    this.secretRoles.delete(botId);
    this.tempEquippedCosmetics.delete(botId);
  }

  private trimLobbyBotsTo(targetCap: number) {
    if (this.state.players.size <= targetCap) return;
    const botIds = Array.from(this.state.players.values())
      .filter((pl) => pl.isBot)
      .map((pl) => pl.id);
    while (this.state.players.size > targetCap && botIds.length > 0) {
      const remId = botIds.pop()!;
      this.deleteBotById(remId);
    }
  }

  private snapshotOriginalCosmetics(p: Player) {
    if (this.tempEquippedCosmetics.has(p.id)) return;
    this.tempEquippedCosmetics.set(p.id, {
      coatColor: p.coatColor,
      accentColor: p.accentColor,
      hat: p.hat,
      mask: p.mask
    });
  }

  private sendProximityOrPhaseChat(
    origin: Player,
    payload: { senderId: string; senderNick: string; seat: number; text: string; channel: string }
  ) {
    this.clients.forEach((c) => {
      const receiver = this.state.players.get(c.sessionId);
      if (!receiver) return;
      if (origin.ghost && !receiver.ghost) return;

      if (this.state.phase === "DAY" && !origin.ghost) {
        const sRoom = origin.roomId;
        const rRoom = receiver.roomId;
        const sDoor = DOORS.find((d) => d.roomId === sRoom);
        const rDoor = DOORS.find((d) => d.roomId === rRoom);
        const sClosed = sDoor ? !this.state.doors.get(sDoor.id)?.open : false;
        const rClosed = rDoor ? !this.state.doors.get(rDoor.id)?.open : false;

        if ((sClosed || rClosed) && sRoom !== rRoom) return;
        const dist = Math.hypot(origin.x - receiver.x, origin.z - receiver.z);
        if (dist > 15 && sRoom !== rRoom) return;
      }

      c.send("chat_msg", payload);
    });
  }

  private tryApplyBotPersuadedVote(bot: Player, mem: BotMemory, candidateId: string) {
    const candidate = this.state.players.get(candidateId);
    if (!candidate || !candidate.alive || candidate.ghost || candidate.id === bot.id) return;
    if (this.secretRoles.get(bot.id) === "HAIN" && this.secretRoles.get(candidate.id) === "HAIN") return;

    mem.promisedVoteTargetId = candidate.id;
    if (this.state.phase === "VOTE") {
      if (this.tieCandidates.length > 0 && !this.tieCandidates.includes(candidate.id)) return;
      this.abstainedVoters.delete(bot.id);
      this.votes.set(bot.id, candidate.id);
      bot.votedForId = "SEALED";
      this.checkIfAllVoted();
    }
  }

  private checkEarlyReadyPhase(broadcastCount = true) {
    if (
      this.state.phase !== "ARRIVAL" &&
      this.state.phase !== "DAY" &&
      this.state.phase !== "TRIAL" &&
      this.state.phase !== "TABLE"
    ) {
      return;
    }

    const aliveHumans = this.getAliveConnectedHumanIds();
    const voterPool =
      aliveHumans.length > 0
        ? aliveHumans
        : this.clients.map((c) => c.sessionId).filter((sid) => this.state.players.has(sid));
    const readyCount = voterPool.filter((id) => this.readyPhasePlayers.has(id)).length;

    if (broadcastCount) {
      this.broadcast("ready_count_update", {
        readyCount,
        totalHumans: voterPool.length,
        phase: this.state.phase
      });
    }

    if (voterPool.length > 0 && readyCount >= voterPool.length) {
      if (this.state.phase === "ARRIVAL") {
        this.enterDayPhase();
      } else if (this.state.phase === "DAY" || this.state.phase === "TRIAL" || this.state.phase === "TABLE") {
        this.advanceAfterDay();
      }
    }
  }

  private migratePlayerSessionId(oldSid: string, newSid: string, pToken: string) {
    const updatedAff = new Map<string, number>();
    this.affinities.forEach((val, key) => {
      const [a, b] = key.split("|");
      const na = a === oldSid ? newSid : a;
      const nb = b === oldSid ? newSid : b;
      updatedAff.set(pairKey(na, nb), val);
    });
    this.affinities = updatedAff;

    const migrateMapKey = <V>(m: Map<string, V>) => {
      if (m.has(oldSid)) {
        const v = m.get(oldSid)!;
        m.delete(oldSid);
        m.set(newSid, v);
      }
    };
    const migrateSetItem = (s: Set<string>) => {
      if (s.has(oldSid)) {
        s.delete(oldSid);
        s.add(newSid);
      }
    };

    migrateMapKey(this.secretRoles);
    migrateSetItem(this.roleSentSessions);
    this.departedSessions.delete(oldSid);
    this.departedSessions.delete(newSid);

    if (this.state.hostId === oldSid) this.state.hostId = newSid;
    if (this.state.necklaceHolder === oldSid) this.state.necklaceHolder = newSid;
    if (this.state.lastBurnedId === oldSid) this.state.lastBurnedId = newSid;
    if (this.state.lastTakenId === oldSid) this.state.lastTakenId = newSid;

    this.sessionToToken.delete(oldSid);
    this.sessionToToken.set(newSid, pToken);
    this.tokenToSession.set(pToken, newSid);

    migrateMapKey(this.playerQuests);
    this.playerQuests.forEach((quests) => {
      quests.forEach((q) => {
        if (q.targetId === oldSid) q.targetId = newSid;
      });
    });

    const nextVotes = new Map<string, string>();
    this.votes.forEach((targetId, voterId) => {
      nextVotes.set(voterId === oldSid ? newSid : voterId, targetId === oldSid ? newSid : targetId);
    });
    this.votes = nextVotes;
    migrateSetItem(this.abstainedVoters);

    const nextPenalties = new Set<string>();
    this.penalizedVotePairsThisRound.forEach((pair) => {
      const [v, t] = pair.split("|");
      nextPenalties.add(`${v === oldSid ? newSid : v}|${t === oldSid ? newSid : t}`);
    });
    this.penalizedVotePairsThisRound = nextPenalties;

    if (this.tieCandidates.includes(oldSid)) {
      this.tieCandidates = this.tieCandidates.map((id) => (id === oldSid ? newSid : id));
      this.state.tieCandidateCsv = this.tieCandidates.join(",");
    }

    const nextNightPicks = new Map<string, string>();
    this.nightPicks.forEach((targetId, traitorId) => {
      nextNightPicks.set(traitorId === oldSid ? newSid : traitorId, targetId === oldSid ? newSid : targetId);
    });
    this.nightPicks = nextNightPicks;

    migrateSetItem(this.sealedNightTraitors);
    migrateSetItem(this.nightWatchedPlayers);
    migrateMapKey(this.nightWatchTexts);
    migrateMapKey(this.finalDecisions);
    migrateSetItem(this.readyPhasePlayers);
    migrateMapKey(this.activePuzzles);
    migrateMapKey(this.puzzleCooldownUntil);
    migrateMapKey(this.solvedPuzzleRound);
    migrateMapKey(this.trialStageByPlayer);
    migrateMapKey(this.trialActiveChallenge);
    migrateMapKey(this.trialCompletedClue);
    migrateMapKey(this.lastTrialSubmitAt);
    migrateSetItem(this.trialSabotagedPlayers);
    migrateMapKey(this.chalkUsedRound);
    migrateMapKey(this.noteSabotageUsedRound);
    migrateMapKey(this.ghostHauntCooldown);
    migrateMapKey(this.lastMoveTimestamp);
    migrateSetItem(this.accusedByHumansThisRound);
    migrateMapKey(this.accusedScoreThisRound);
    migrateMapKey(this.tempEquippedCosmetics);

    const oldStationKey = `${this.state.round}:${oldSid}`;
    if (this.medievalStationUses.has(oldStationKey)) {
      const used = this.medievalStationUses.get(oldStationKey)!;
      this.medievalStationUses.delete(oldStationKey);
      this.medievalStationUses.set(`${this.state.round}:${newSid}`, used);
    }
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
    this.aiControlledIds.add(botId);
    this.botMemories.set(botId, createInitialBotMemory(seat));
    const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
    this.botBrains.set(botId, { targetX: wp.x, targetZ: wp.z, waitUntil: Date.now() + 800 });
  }

  onJoin(client: Client, options: JoinOptions) {
    const pToken = String(options?.playerToken || "").trim();

    if (pToken && this.tokenToSession.has(pToken)) {
      const oldSid = this.tokenToSession.get(pToken)!;
      const existing = this.state.players.get(oldSid);
      if (existing && oldSid !== client.sessionId) {
        const cloned = existing.clone();
        cloned.id = client.sessionId;
        cloned.connected = true;
        cloned.isBot = false;
        if (options?.nick) cloned.nick = sanitizeNickname(options.nick);

        this.state.players.delete(oldSid);
        this.aiControlledIds.delete(oldSid);
        this.botBrains.delete(oldSid);
        this.state.players.set(client.sessionId, cloned);

        this.migratePlayerSessionId(oldSid, client.sessionId, pToken);

        if (this.state.phase !== "LOBBY") {
          this.syncFullClientPrivateState(client);
          this.broadcast("chat_msg", {
            senderId: client.sessionId,
            senderNick: "KÂHYA",
            seat: cloned.seat,
            text: `✨ Koltuk #${cloned.seat} (${cloned.nick}) fırtınadan sağ çıkıp sofraya geri döndü!`,
            channel: "SİSTEM"
          });
        }
        return;
      }
    }

    const allowedSeats = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
    if (this.state.phase === "LOBBY") {
      const targetCap = Math.max(
        6,
        Math.min(this.maxClients, this.state.targetPlayerCount || SOFRA_CONFIG.DEFAULT_MATCH_CLIENTS)
      );
      // Lobide botlar tüm koltukları doldurduysa gerçek oyuncuya yer açmak için 1 botu çıkar
      if (this.state.players.size >= targetCap || this.state.players.size >= 11) {
        const anyBot = Array.from(this.state.players.values()).find((pl) => pl.isBot);
        if (anyBot) this.deleteBotById(anyBot.id);
      }
      // İstenen koltukta bir bot oturuyorsa botu boş bir koltuğa kaydır
      if (options?.seat && allowedSeats.includes(options.seat)) {
        const seatBot = Array.from(this.state.players.values()).find(
          (pl) => pl.isBot && pl.seat === options.seat
        );
        if (seatBot) {
          const used = new Set<number>();
          this.state.players.forEach((pl) => used.add(pl.seat));
          const freeForBot = allowedSeats.find((s) => !used.has(s));
          if (freeForBot) {
            seatBot.seat = freeForBot;
            const bDef = CHARACTERS.find((c) => c.seat === freeForBot) || CHARACTERS[0];
            seatBot.charName = bDef.name;
            seatBot.nick = `${bDef.name} (${bDef.title})`;
            seatBot.coatColor = bDef.coatColor;
            seatBot.accentColor = bDef.accentColor;
            seatBot.hat = bDef.hat;
            seatBot.mask = bDef.mask;
            const bsp = getAntreSpawn(freeForBot);
            seatBot.x = bsp.x;
            seatBot.z = bsp.z;
            seatBot.rotY = bsp.rotY;
          } else {
            this.deleteBotById(seatBot.id);
          }
        }
      }
    }

    const player = new Player();
    player.id = client.sessionId;
    player.nick = sanitizeNickname(options?.nick || "Misafir");
    player.connected = true;
    player.isBot = false;
    player.registered = pToken.startsWith("acc_");

    const takenSeats = new Set<number>();
    this.state.players.forEach((p) => takenSeats.add(p.seat));
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

    if (pToken) {
      this.sessionToToken.set(client.sessionId, pToken);
      this.tokenToSession.set(pToken, client.sessionId);
    }

    if (!this.state.hostId || !this.state.players.has(this.state.hostId)) {
      this.state.hostId = client.sessionId;
    }

    if (this.state.phase === "LOBBY" && this.state.autoStart) {
      this.scheduleAutoLobbyCountdown();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;

    if (!consented && this.state.phase !== "LOBBY" && this.state.phase !== "RESULT") {
      this.broadcast("chat_msg", {
        senderId: client.sessionId,
        senderNick: "KÂHYA",
        seat: player.seat,
        text: `⚡ Koltuk #${player.seat} (${player.nick}) bağlantısı koptu — 60 sn geri dönmesi bekleniyor...`,
        channel: "SİSTEM"
      });

      try {
        const reconnectedClient = await this.allowReconnection(client, SOFRA_CONFIG.RECONNECT_TIMEOUT_SEC);
        const current = this.state.players.get(reconnectedClient.sessionId);
        if (current) {
          current.connected = true;
          this.syncFullClientPrivateState(reconnectedClient);
          this.broadcast("chat_msg", {
            senderId: reconnectedClient.sessionId,
            senderNick: "KÂHYA",
            seat: current.seat,
            text: `✨ Koltuk #${current.seat} (${current.nick}) yeniden bağlandı!`,
            channel: "SİSTEM"
          });
        }
        return;
      } catch {
        if (!this.state.players.has(client.sessionId)) return;
      }
    }

    this.handlePermanentDeparture(client.sessionId);

    if (this.clients.length === 0) {
      this.disconnect();
    }
  }

  private clearSessionTokenMapping(sessionId: string) {
    const pToken = this.sessionToToken.get(sessionId);
    if (pToken) {
      this.sessionToToken.delete(sessionId);
      if (this.tokenToSession.get(pToken) === sessionId) {
        this.tokenToSession.delete(pToken);
      }
    }
  }

  private handlePermanentDeparture(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    if (this.state.phase === "LOBBY" || this.state.phase === "RESULT") {
      this.state.players.delete(sessionId);
      this.secretRoles.delete(sessionId);
      this.roleSentSessions.delete(sessionId);
      this.tempEquippedCosmetics.delete(sessionId);
      this.clearSessionTokenMapping(sessionId);
      this.reassignHostIfNeeded(sessionId);
      if (this.state.phase === "LOBBY" && this.clients.length === 0 && this.autoLobbyTimer) {
        this.autoLobbyTimer.clear();
      }
      return;
    }

    if (this.departedSessions.has(sessionId)) return;
    this.departedSessions.add(sessionId);
    this.clearSessionTokenMapping(sessionId);
    this.readyPhasePlayers.delete(sessionId);

    if (player.alive && !player.ghost) {
      const role = this.secretRoles.get(sessionId) || "MISAFIR";
      const aliveIds = this.getAlivePlayerIds();
      const remainingAliveIds = aliveIds.filter((id) => id !== sessionId);
      const aliveTraitors = aliveIds.filter((id) => this.secretRoles.get(id) === "HAIN");
      const anyConnectedHumanLeft = Array.from(this.state.players.values()).some(
        (p) => p.id !== sessionId && !p.isBot && !this.aiControlledIds.has(p.id) && p.connected
      );
      const wouldEndImmediately =
        remainingAliveIds.length > 0 &&
        evaluateWinCondition(remainingAliveIds, this.getRolesRecord()) !== "CONTINUE";

      // Maçta başka canlı/bağlı insanlar oynarken tek bir kopma yüzünden oyunun "bir anda bitmesini" önle: koltuğu AI devralır!
      if (
        anyConnectedHumanLeft &&
        (wouldEndImmediately || (role === "HAIN" && aliveTraitors.length <= 1 && aliveIds.length >= 4))
      ) {
        this.aiControlledIds.add(sessionId);
        player.isBot = true;
        player.connected = true;
        this.botMemories.set(sessionId, createInitialBotMemory(player.seat));
        const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
        this.botBrains.set(sessionId, { targetX: wp.x, targetZ: wp.z, waitUntil: Date.now() + 800 });

        this.broadcast("chat_msg", {
          senderId: sessionId,
          senderNick: "KÂHYA",
          seat: player.seat,
          text: `🌑 Koltuk #${player.seat} (${player.nick}) sessizliğe gömüldü ama sofradaki sandalyesini terk etmedi...`,
          channel: "SİSTEM"
        });
        this.reassignHostIfNeeded(sessionId);
        this.checkEarlyReadyPhase(true);
        if (this.state.phase === "VOTE") {
          this.castSmartVoteForBotNow(player);
          this.checkIfAllVoted();
        } else if (this.state.phase === "NIGHT") {
          if (role === "HAIN" && !this.nightPicks.has(sessionId)) {
            const guests = this.getAlivePlayerIds().filter((id) => this.secretRoles.get(id) === "MISAFIR");
            if (guests.length > 0) {
              this.nightPicks.set(sessionId, guests[Math.floor(Math.random() * guests.length)]);
            }
          }
          this.checkNightSealed();
        } else if (this.state.phase === "FINAL") {
          if (!this.finalDecisions.has(sessionId)) {
            const trCount = this.getAlivePlayerIds().filter((id) => this.secretRoles.get(id) === "HAIN").length;
            this.finalDecisions.set(sessionId, role === "HAIN" ? "TRUST" : trCount > 0 ? "DOUBT" : "TRUST");
          }
          this.checkFinalDecisionsComplete();
        }
        return;
      }

      this.votes.delete(sessionId);
      this.abstainedVoters.delete(sessionId);
      let clearedAnyVoter = false;
      this.votes.forEach((targetId, voterId) => {
        if (targetId === sessionId) {
          this.votes.delete(voterId);
          const vp = this.state.players.get(voterId);
          if (vp) vp.votedForId = "";
          clearedAnyVoter = true;
          if (vp && this.aiControlledIds.has(voterId) && vp.alive && this.state.phase === "VOTE") {
            this.castSmartVoteForBotNow(vp);
          }
        }
      });
      if (clearedAnyVoter && this.voteLockdownPending && this.state.phase === "VOTE") {
        this.voteLockdownPending = false;
        if (this.phaseTimer) this.phaseTimer.clear();
        const extraMs = 15000;
        this.state.phaseEndsAt = Date.now() + extraMs;
        this.phaseTimer = this.clock.setTimeout(() => this.resolveVotePhase(), extraMs);
      }

      this.tieCandidates = this.tieCandidates.filter((id) => id !== sessionId);
      this.state.tieCandidateCsv = this.tieCandidates.join(",");
      if (this.state.necklaceHolder === sessionId) {
        this.state.necklaceHolder = "";
      }

      this.nightPicks.delete(sessionId);
      this.nightPicks.forEach((tId, trId) => {
        if (tId === sessionId) {
          const guests = remainingAliveIds.filter((id) => this.secretRoles.get(id) === "MISAFIR");
          if (guests.length > 0 && this.aiControlledIds.has(trId)) {
            this.nightPicks.set(trId, guests[Math.floor(Math.random() * guests.length)]);
          } else {
            this.nightPicks.delete(trId);
          }
        }
      });

      const wasTraitor = role === "HAIN";
      const notes = wasTraitor ? FAREWELL_NOTES_HAIN : FAREWELL_NOTES_MISAFIR;
      const farewellNote = notes[Math.floor(Math.random() * notes.length)];
      const flame = wasTraitor ? "RED" : "WHITE";

      player.alive = false;
      player.ghost = true;
      player.anim = "ghost";
      player.votedForId = "";
      this.state.announcement = `📜 Koltuk #${player.seat} (${player.nick}) Veda Mektubu Bıraktı: "${farewellNote}"`;

      this.broadcast("farewell_letter", {
        seat: player.seat,
        nick: player.nick,
        flame,
        roleLabel: wasTraitor ? "HAİN" : "MASUM MİSAFİR",
        note: farewellNote
      });

      this.broadcast("chat_msg", {
        senderId: sessionId,
        senderNick: `📜 VEDA (#${player.seat} ${player.nick})`,
        seat: player.seat,
        text: `"${farewellNote}" [${wasTraitor ? "🔥 KIRMIZI ALEV: HAİNDİ!" : "❄️ BEYAZ ALEV: MASUMDU!"}]`,
        channel: "VEDA"
      });

      const outcome = evaluateWinCondition(this.getAlivePlayerIds(), this.getRolesRecord());
      if (outcome === "MISAFIR_WINS") {
        this.enterResultPhase(
          "MISAFIR",
          `Son kalan Hain (#${player.seat} ${player.nick}) sofradan ayrıldığı için şatoda hiçbir Hain kalmadı!`
        );
        this.reassignHostIfNeeded(sessionId);
        return;
      }
      if (outcome === "HAIN_WINS") {
        this.enterResultPhase(
          "HAIN",
          `Koltuk #${player.seat} ${player.nick} ayrıldıktan sonra hayatta kalan Hain sayısı Misafir sayısına ulaştı!`
        );
        this.reassignHostIfNeeded(sessionId);
        return;
      }
    }

    this.reassignHostIfNeeded(sessionId);
    this.checkEarlyReadyPhase(true);
    if (this.state.phase === "VOTE") {
      if (this.tieCandidates.length === 1) {
        this.enterFirePhase(this.tieCandidates[0]);
        return;
      }
      this.maybeAccelerateBotVotes();
      this.checkIfAllVoted();
    } else if (this.state.phase === "NIGHT") {
      this.checkNightSealed();
    } else if (this.state.phase === "FINAL") {
      this.checkFinalDecisionsComplete();
    }
  }

  private reassignHostIfNeeded(leftSessionId: string) {
    if (this.state.hostId === leftSessionId || !this.state.players.get(this.state.hostId)?.connected) {
      const nextHuman = Array.from(this.state.players.values()).find(
        (p) => !p.isBot && !this.aiControlledIds.has(p.id) && p.connected
      );
      this.state.hostId = nextHuman?.id || "";
    }
  }

  // ============================================================================
  // OYUN DÖNGÜSÜ (SADELEŞTİRİLMİŞ 3 ANA EVRELİ AKICI DEVLET MAKİNESİ)
  // ============================================================================
  private getPhaseSeconds(phase: GamePhase, fallbackSec: number): number {
    const preset = resolveDurationPreset(this.state.paceMode, this.state.fastMode);
    if (phase === "VOTE" && this.tieCandidates.length > 0) {
      return preset.durations.TIE_VOTE;
    }
    const map: Partial<Record<GamePhase, number>> = {
      ARRIVAL: preset.durations.ARRIVAL,
      DAY: preset.durations.DAY,
      TRIAL: preset.durations.TRIAL,
      TABLE: preset.durations.TABLE,
      VOTE: preset.durations.VOTE,
      FIRE: preset.durations.FIRE,
      NIGHT: preset.durations.NIGHT,
      MORNING: preset.durations.MORNING,
      FINAL: preset.durations.FINAL
    };
    return map[phase] ?? fallbackSec;
  }

  private setPhase(phase: GamePhase, durationSec: number, announcement: string, onComplete: () => void) {
    this.phaseSeq += 1;
    if (this.phaseTimer) this.phaseTimer.clear();
    const durMs = this.getPhaseSeconds(phase, durationSec) * 1000;
    this.state.phase = phase;
    this.state.phaseEndsAt = Date.now() + durMs;
    this.state.announcement = announcement;
    this.phaseTimer = this.clock.setTimeout(onComplete, durMs);
  }

  private startGameLoop() {
    if (this.autoLobbyTimer) this.autoLobbyTimer.clear();
    // joinOrCreate'i engellerken playerToken ile joinById yeniden katılımını açık tutmak için lock() yerine setPrivate(true) kullan!
    this.setPrivate(true);

    this.state.round = 1;
    this.state.pot = 0;
    this.state.winnerTeam = "";
    this.state.winReason = "";
    this.state.lastBurnedId = "";
    this.state.lastBurnedName = "";
    this.state.lastBurnedFlame = "";
    this.state.lastTakenId = "";
    this.state.lastTakenName = "";
    this.state.necklaceHolder = "";
    this.state.councilBoardNote = "";
    this.state.tieCandidateCsv = "";

    this.roleSentSessions.clear();
    this.departedSessions.clear();
    this.affinities.clear();
    this.activePuzzles.clear();
    this.puzzleCooldownUntil.clear();
    this.solvedPuzzleRound.clear();
    this.necklaceClaimedByPuzzleThisRound = false;
    this.playerQuests.clear();
    this.trialStageByPlayer.clear();
    this.trialActiveChallenge.clear();
    this.trialCompletedClue.clear();
    this.lastTrialSubmitAt.clear();
    this.trialSabotagedPlayers.clear();
    this.trialSabotageCount = 0;
    this.pendingBotTrialPot = 0;
    this.pendingSabotagePotDrain = 0;
    this.readyPhasePlayers.clear();
    this.votes.clear();
    this.abstainedVoters.clear();
    this.penalizedVotePairsThisRound.clear();
    this.tieCandidates = [];
    this.nightPicks.clear();
    this.sealedNightTraitors.clear();
    this.nightWatchedPlayers.clear();
    this.nightWatchTexts.clear();
    this.finalDecisions.clear();
    this.chronicleLog = [];
    this.kahyaBellUsedRound = 0;
    this.chalkUsedRound.clear();
    this.lastLightSabotageAt = 0;
    this.noteSabotageUsedRound.clear();
    this.medievalStationUses.clear();
    this.ghostHauntCooldown.clear();
    this.finalAskedForRound = 0;
    this.voteLockdownPending = false;
    this.finalLockdownPending = false;
    this.accusedByHumansThisRound.clear();
    this.accusedScoreThisRound.clear();
    this.tempEquippedCosmetics.clear();

    // Herkesin özel yatak odası kilitli başlar (yalnız kendi anahtarına açık!)
    this.state.doors.forEach((d) => {
      d.open = false;
      d.locked = true;
    });

    const allIds: string[] = [];
    this.state.players.forEach((p) => {
      p.alive = true;
      p.ghost = false;
      p.hasKahyaKey = false;
      p.votedForId = "";
      p.anim = "idle";
      const sp = getAntreSpawn(p.seat);
      p.x = sp.x;
      p.z = sp.z;
      p.rotY = sp.rotY;
      p.roomId = "antre";
      allIds.push(p.id);
      if (this.aiControlledIds.has(p.id)) {
        this.botMemories.set(p.id, createInitialBotMemory(p.seat));
      }
    });

    const assigned = assignRoles(allIds);
    this.secretRoles.clear();
    for (const [id, r] of Object.entries(assigned)) {
      this.secretRoles.set(id, r);
    }

    // ÖNCE evreyi ARRIVAL olarak ayarla ki sendPrivateRoleToClient LOBBY kontrolüne takılmasın!
    this.setPhase(
      "ARRIVAL",
      SOFRA_CONFIG.DURATIONS.ARRIVAL,
      "Kâhya: 'Kargalı Şato'ya hoş geldiniz. Herkesin kendi özel yatak odasının anahtarı cebinde!'",
      () => this.enterDayPhase()
    );

    this.clients.forEach((c) => this.sendPrivateRoleToClient(c, true));
  }

  private sendPrivateRoleToClient(client: Client, force = false) {
    if (this.state.phase === "LOBBY") return;
    if (!force && this.roleSentSessions.has(client.sessionId)) return;
    this.roleSentSessions.add(client.sessionId);

    const sid = client.sessionId;
    const myRole = this.secretRoles.get(sid) || "MISAFIR";
    const traitorMates: Array<{ id: string; nick: string; seat: number }> = [];
    if (myRole === "HAIN") {
      this.state.players.forEach((p) => {
        if (this.secretRoles.get(p.id) === "HAIN" && p.id !== sid) {
          traitorMates.push({ id: p.id, nick: p.nick, seat: p.seat });
        }
      });
    }
    const myVotedTargetId = this.abstainedVoters.has(sid) ? "ABSTAIN" : this.votes.get(sid) || "";
    client.send("role_envelope", {
      role: myRole,
      traitorMates,
      myVotedTargetId,
      tieCandidates: this.tieCandidates,
      isNightSealed: this.sealedNightTraitors.has(sid),
      myFinalDecision: this.finalDecisions.get(sid) || ""
    });
  }

  private computeTopMatchBond(): { seatA: number; nickA: string; seatB: number; nickB: string; score: number } | null {
    let topMatchBond: { seatA: number; nickA: string; seatB: number; nickB: string; score: number } | null = null;
    let bestAff = 0;
    this.affinities.forEach((val, key) => {
      if (val > bestAff) {
        const [a, b] = key.split("|");
        const pA = this.state.players.get(a);
        const pB = this.state.players.get(b);
        if (pA && pB) {
          bestAff = val;
          topMatchBond = {
            seatA: pA.seat,
            nickA: pA.nick,
            seatB: pB.seat,
            nickB: pB.nick,
            score: Math.round(val)
          };
        }
      }
    });
    return topMatchBond;
  }

  private syncFullClientPrivateState(client: Client) {
    if (this.state.phase === "LOBBY") return;
    this.sendPrivateRoleToClient(client, true);
    this.sendQuestsToClient(client);

    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    if (this.state.phase === "TRIAL" && p && p.alive && !p.ghost) {
      const stg = this.trialStageByPlayer.get(sid) || 1;
      if (stg <= 3) {
        const existingCh = this.trialActiveChallenge.get(sid);
        if (existingCh) {
          client.send("trial_challenge", {
            stage: stg,
            totalStages: 3,
            puzzleId: existingCh.puzzleId,
            title: existingCh.title,
            prompt: existingCh.prompt,
            options: existingCh.options,
            feedback: "",
            canSabotage:
              this.secretRoles.get(sid) === "HAIN" &&
              !this.trialSabotagedPlayers.has(sid)
          });
        } else {
          this.trialStageByPlayer.set(sid, stg);
          this.sendTrialStageToClient(client, stg);
        }
      } else {
        client.send("trial_completed", {
          wonNecklace: this.state.necklaceHolder === sid,
          clueText: this.trialCompletedClue.get(sid) || "3/3 Bulmaca Aşaması tamamlandı!"
        });
      }
    }

    if (this.state.phase === "NIGHT") {
      if (this.secretRoles.get(sid) === "HAIN") {
        this.nightPicks.forEach((targetId, traitorId) => {
          const tr = this.state.players.get(traitorId);
          const tg = this.state.players.get(targetId);
          if (tr && tg) {
            client.send("traitor_pick_update", {
              traitorId: tr.id,
              traitorSeat: tr.seat,
              traitorNick: tr.nick,
              targetId: tg.id,
              targetSeat: tg.seat,
              targetNick: tg.nick
            });
          }
        });
      } else if (this.nightWatchedPlayers.has(sid)) {
        const savedWatch = this.nightWatchTexts.get(sid);
        if (savedWatch) {
          client.send("night_watch_result", { text: savedWatch });
        }
      }
    }

    if (this.state.phase === "RESULT") {
      const revealedRoles: Array<{ id: string; nick: string; seat: number; role: PlayerRole; alive: boolean }> = [];
      this.state.players.forEach((pl) => {
        revealedRoles.push({
          id: pl.id,
          nick: pl.nick,
          seat: pl.seat,
          role: this.secretRoles.get(pl.id) || "MISAFIR",
          alive: pl.alive
        });
      });
      client.send("game_over_roles", {
        winner: this.state.winnerTeam || "MISAFIR",
        roles: revealedRoles,
        chronicle: this.chronicleLog,
        topMatchBond: this.computeTopMatchBond()
      });
    }
  }

  private sealNightForTraitor(voter: Player) {
    this.sealedNightTraitors.add(voter.id);
    const aliveHumanTraitors = this.getAliveAllHumanIds().filter(
      (id) => this.secretRoles.get(id) === "HAIN"
    );
    const sealedCount = aliveHumanTraitors.filter((id) => this.sealedNightTraitors.has(id)).length;

    this.sendToTraitors("chat_msg", {
      senderId: voter.id,
      senderNick: "🩸 MÜHÜR",
      seat: voter.seat,
      text: `#${voter.seat} ${voter.nick} İnfaz Kararını Mühürledi! (${sealedCount}/${Math.max(1, aliveHumanTraitors.length)})`,
      channel: "HAİN MECLİSİ"
    });

    this.checkNightSealed();
  }

  private checkNightSealed() {
    if (this.state.phase !== "NIGHT") return;
    const aliveHumanTraitors = this.getAliveAllHumanIds().filter(
      (id) => this.secretRoles.get(id) === "HAIN"
    );
    const sealedCount = aliveHumanTraitors.filter((id) => this.sealedNightTraitors.has(id)).length;

    if (aliveHumanTraitors.length > 0 && sealedCount >= aliveHumanTraitors.length) {
      if (this.phaseTimer) this.phaseTimer.clear();
      this.state.announcement =
        "🩸 Hainler Meclisi toplantısını tamamladı ve İnfaz Mührünü bastı! Sabah çanı çalıyor...";
      this.state.phaseEndsAt = Date.now() + 3500;
      const seq = this.phaseSeq;
      this.phaseTimer = this.clock.setTimeout(() => {
        if (this.phaseSeq !== seq || this.state.phase !== "NIGHT") return;
        this.enterMorningPhase();
      }, 3500);
    }
  }

  private sendToTraitors(type: string, payload: unknown) {
    this.clients.forEach((c) => {
      if (this.secretRoles.get(c.sessionId) === "HAIN") {
        c.send(type, payload);
      }
    });
  }

  private sendQuestsToClient(client: Client) {
    const quests = this.playerQuests.get(client.sessionId) || [];
    client.send("quests_update", { round: this.state.round, quests });
  }

  private assignRoundQuestsForAll() {
    const aliveList: Array<{ id: string; seat: number; nick: string }> = [];
    this.state.players.forEach((p) => {
      if (p.alive && !p.ghost) aliveList.push({ id: p.id, seat: p.seat, nick: p.nick });
    });

    this.clients.forEach((c) => {
      const me = this.state.players.get(c.sessionId);
      if (!me || !me.alive || me.ghost) return;
      const myRole = this.secretRoles.get(me.id) || "MISAFIR";
      const others = aliveList.filter((o) => o.id !== me.id);
      const quests = generateRoundQuests({
        playerId: me.id,
        playerSeat: me.seat,
        playerRole: myRole,
        aliveOthers: others
      });
      this.playerQuests.set(me.id, quests);
      this.sendQuestsToClient(c);
    });
  }

  private completeQuestByKind(sessionId: string, kind: "SOCIAL_BOND" | "ROOM_OR_BOARD" | "DETECTIVE") {
    const quests = this.playerQuests.get(sessionId);
    if (!quests) return;
    const q = quests.find((item) => item.kind === kind && !item.done);
    if (!q) return;

    q.progress = q.goal;
    q.done = true;
    this.state.pot += 10;

    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) {
      client.send("match_reward", { bonusGold: q.rewardGold, won: true });
      client.send("quest_completed", {
        title: q.title,
        rewardGold: q.rewardGold
      });
      this.sendQuestsToClient(client);
    }
  }

  private syncSocialQuestProgress(sessionId: string) {
    const quests = this.playerQuests.get(sessionId);
    if (!quests) return;
    const q = quests.find((item) => item.kind === "SOCIAL_BOND" && !item.done);
    if (!q) return;

    if (q.targetId) {
      const score = Math.round(this.affinities.get(pairKey(sessionId, q.targetId)) || 0);
      if (score !== q.progress) {
        q.progress = Math.min(q.goal, score);
        if (score >= q.goal) {
          this.completeQuestByKind(sessionId, "SOCIAL_BOND");
          return;
        }
        const c = this.clients.find((cl) => cl.sessionId === sessionId);
        if (c) this.sendQuestsToClient(c);
      }
    } else {
      this.completeQuestByKind(sessionId, "SOCIAL_BOND");
    }
  }

  private sendTrialStageToClient(client: Client, stage: number, feedback?: string) {
    const kinds: Array<"RUNE" | "RIDDLE" | "CLOCK"> = ["RUNE", "RIDDLE", "CLOCK"];
    const kind = kinds[(stage - 1) % kinds.length];
    const ch = createPuzzleChallenge(kind);
    this.trialActiveChallenge.set(client.sessionId, ch);
    client.send("trial_challenge", {
      stage,
      totalStages: 3,
      puzzleId: ch.puzzleId,
      title: ch.title,
      prompt: ch.prompt,
      options: ch.options,
      feedback: feedback || "",
      canSabotage:
        this.secretRoles.get(client.sessionId) === "HAIN" &&
        !this.trialSabotagedPlayers.has(client.sessionId)
    });
  }

  private advanceAfterDay() {
    if (this.getAlivePlayerIds().length <= 4 && this.finalAskedForRound !== this.state.round) {
      this.enterFinalPhase();
    } else {
      this.enterVotePhase([]);
    }
  }

  private enterDayPhase() {
    this.state.lastBurnedId = "";
    this.state.lastBurnedFlame = "";
    this.state.necklaceHolder = "";
    this.state.tieCandidateCsv = "";
    this.tieCandidates = [];
    this.necklaceClaimedByPuzzleThisRound = false;
    this.readyPhasePlayers.clear();
    this.activePuzzles.clear();
    this.accusedByHumansThisRound.clear();
    this.accusedScoreThisRound.clear();
    this.assignRoundQuestsForAll();

    const daySec = this.getPhaseSeconds("DAY", SOFRA_CONFIG.DURATIONS.DAY);
    this.setPhase(
      "DAY",
      daySec,
      `Gündüz #${this.state.round} (${formatDurationLabelTR(daySec)} Keşif & Görev) · Odaları gez, Rün Kürsüsünü ilk çözüp 📿 Altın Kolye kazan ve 📖 Kitapçığa ipucu topla!`,
      () => this.advanceAfterDay()
    );

    // Gündüz keşfinde canlı Misafir botlar şato görevlerine katkı sağlayarak Ortak Hazineyi doğal biçimde destekler (Altın Kolye hakkını asla oyuncudan almaz!)
    const seq = this.phaseSeq;
    this.clock.setTimeout(() => {
      if (this.phaseSeq !== seq || this.state.phase !== "DAY") return;
      const guestBotCount = Array.from(this.state.players.values()).filter(
        (p) => this.aiControlledIds.has(p.id) && p.alive && this.secretRoles.get(p.id) !== "HAIN"
      ).length;
      if (guestBotCount > 0) {
        this.state.pot += Math.min(30, guestBotCount * 10);
      }
    }, 12000);
  }

  private castSmartVoteForBotNow(bot: Player) {
    if (!bot.alive || bot.ghost || this.votes.has(bot.id) || this.abstainedVoters.has(bot.id)) return;
    const aliveIds = this.getAlivePlayerIds();
    const pool = this.tieCandidates.length > 0 ? this.tieCandidates : aliveIds;
    const bRole = this.secretRoles.get(bot.id) || "MISAFIR";

    let choices = pool.filter((id) => id !== bot.id && this.state.players.get(id)?.alive);
    if (bRole === "HAIN") {
      const nonTraitors = choices.filter((id) => this.secretRoles.get(id) !== "HAIN");
      if (nonTraitors.length > 0) choices = nonTraitors;
    }
    if (choices.length === 0) return;

    const mem = this.botMemories.get(bot.id);
    const promised =
      mem?.promisedVoteTargetId && choices.includes(mem.promisedVoteTargetId)
        ? mem.promisedVoteTargetId
        : undefined;
    const pick = promised || this.selectSmartBotVoteTarget(bot.id, choices, this.tieCandidates.length > 0);
    if (mem) mem.promisedVoteTargetId = undefined;

    this.votes.set(bot.id, pick);
    bot.votedForId = "SEALED";
  }

  private maybeAccelerateBotVotes() {
    if (this.state.phase !== "VOTE" || this.voteLockdownPending) return;
    const aliveHumans = this.getAliveAllHumanIds();
    if (
      aliveHumans.length > 0 &&
      !aliveHumans.every((hid) => this.votes.has(hid) || this.abstainedVoters.has(hid))
    ) {
      return;
    }

    const unvotedBots = Array.from(this.state.players.values()).filter(
      (p) =>
        this.aiControlledIds.has(p.id) &&
        p.alive &&
        !p.ghost &&
        !this.votes.has(p.id) &&
        !this.abstainedVoters.has(p.id)
    );
    if (unvotedBots.length === 0) return;

    const seq = this.phaseSeq;
    unvotedBots.forEach((bot, idx) => {
      this.clock.setTimeout(() => {
        if (this.phaseSeq !== seq || this.state.phase !== "VOTE" || !bot.alive) return;
        this.castSmartVoteForBotNow(bot);
        this.checkIfAllVoted();
      }, 650 + idx * 280);
    });
  }

  private seatAllPlayersAtRoundTable() {
    this.state.players.forEach((p) => {
      const st = getSeatTransform(p.seat);
      p.x = st.x;
      p.z = st.z;
      p.rotY = st.rotY;
      p.anim = p.ghost || !p.alive ? "ghost" : "sit";
      p.roomId = "yemek_salonu";
      p.votedForId = "";
    });
  }

  // BİRLEŞİK "YUVARLAK SOFRA & ŞÖMİNE OYLAMASI" EVRESİ (phase = "VOTE")
  private enterVotePhase(tieCandidates: string[]) {
    this.readyPhasePlayers.clear();
    this.votes.clear();
    this.abstainedVoters.clear();
    this.penalizedVotePairsThisRound.clear();
    this.voteLockdownPending = false;
    this.tieCandidates = tieCandidates;
    this.state.tieCandidateCsv = tieCandidates.join(",");

    if (this.pendingBotTrialPot !== 0 || this.pendingSabotagePotDrain !== 0) {
      this.state.pot = Math.max(0, this.state.pot + this.pendingBotTrialPot - this.pendingSabotagePotDrain);
      this.pendingBotTrialPot = 0;
      this.pendingSabotagePotDrain = 0;
    }

    if (tieCandidates.length === 0) {
      this.broadcast("bell_tolls", { round: this.state.round });
      this.seatAllPlayersAtRoundTable();
    } else {
      this.state.players.forEach((p) => {
        p.votedForId = "";
      });
      this.clients.forEach((c) => this.sendPrivateRoleToClient(c, true));
    }

    const durFallback = tieCandidates.length > 0 ? SOFRA_CONFIG.DURATIONS.TIE_VOTE : SOFRA_CONFIG.DURATIONS.VOTE;
    const voteSec = this.getPhaseSeconds("VOTE", durFallback);
    const msg =
      tieCandidates.length > 0
        ? `⚖️ Eşitlik Bozuluyor (${formatDurationLabelTR(voteSec)}) · Yalnızca eşit kalan adaylar arasında ikinci oylama — şömineye kimi gönderiyorsun?`
        : `🔥 Yuvarlak Sofra & Şömine Oylaması (${formatDurationLabelTR(voteSec)}) · Masada tartış, '👉 Suçla' ile gerekçeni söyle ve şüpheliyi seçip oyunu mühürle!`;

    this.setPhase("VOTE", durFallback, msg, () => this.resolveVotePhase());
    const seq = this.phaseSeq;

    // 1. İlk 3-15 sn içinde AI botlar doğal Yuvarlak Sofra tartışma cümlelerini paylaşır
    if (tieCandidates.length === 0) {
      const scheduleDebateWave = (delayMs: number, wave: 1 | 2 | 3 | 4) => {
        this.clock.setTimeout(() => {
          if (this.phaseSeq !== seq || this.state.phase !== "VOTE") return;
          const aliveBots = Array.from(this.state.players.values()).filter(
            (p) => this.aiControlledIds.has(p.id) && p.alive && !p.ghost
          );
          if (aliveBots.length === 0) return;
          const speaker = aliveBots[Math.floor(Math.random() * aliveBots.length)];
          if (!speaker.alive) return;
          const role = this.secretRoles.get(speaker.id) || "MISAFIR";
          const mem = this.botMemories.get(speaker.id) || createInitialBotMemory(speaker.seat);
          const sc = this.pickScapegoatForBot(speaker.id, role);
          if (sc && (wave === 1 || wave === 3)) {
            this.accusedScoreThisRound.set(sc.id, (this.accusedScoreThisRound.get(sc.id) || 0) + 1);
          }
          const line = generateTableDebateLine({
            speakerSeat: speaker.seat,
            speakerNick: speaker.nick,
            speakerRole: role,
            personality: mem.personality,
            mem,
            scapegoat: sc,
            topBond: this.getTopBondHighlight(),
            sabotageCount: 0,
            wave
          });
          this.broadcast("chat_msg", {
            senderId: speaker.id,
            senderNick: speaker.nick,
            seat: speaker.seat,
            text: line,
            channel: "SOFRA"
          });
        }, delayMs);
      };

      scheduleDebateWave(3200, 1);
      scheduleDebateWave(7000, 2);
      scheduleDebateWave(11000, 3);
      scheduleDebateWave(15000, 4);
    }

    // 2. AI Botlar 14-28 sn içinde (veya tüm insanlar oy verdikten hemen sonra!) gizli zarf oylarını verir
    this.state.players.forEach((bot) => {
      if (!this.aiControlledIds.has(bot.id) || !bot.alive || bot.ghost) return;
      const delay =
        tieCandidates.length > 0
          ? 4500 + Math.random() * 6500
          : 14000 + Math.random() * 14000;
      this.clock.setTimeout(() => {
        if (this.phaseSeq !== seq || this.state.phase !== "VOTE" || !bot.alive) return;
        this.castSmartVoteForBotNow(bot);
        this.checkIfAllVoted();
      }, delay);
    });

    // Canlı insan kalmadıysa (yalnızca Hayalet izleyiciler + botlar varsa) bot oylarını bekletmeden hızlandır
    if (this.getAliveAllHumanIds().length === 0) {
      this.maybeAccelerateBotVotes();
    }
  }

  private checkIfAllVoted() {
    if (this.state.phase !== "VOTE" || this.voteLockdownPending) return;
    const activeVoters: string[] = [];
    this.state.players.forEach((p) => {
      if (p.alive && !p.ghost) {
        activeVoters.push(p.id);
      }
    });
    if (
      activeVoters.length > 0 &&
      activeVoters.every((id) => this.votes.has(id) || this.abstainedVoters.has(id))
    ) {
      this.voteLockdownPending = true;
      if (this.phaseTimer) this.phaseTimer.clear();
      this.state.announcement =
        "✉️ Tüm koltuklar mührünü bastı! Zarflar şömine ateşine atılıyor...";
      this.state.phaseEndsAt = Date.now() + 2000;
      const seq = this.phaseSeq;
      this.phaseTimer = this.clock.setTimeout(() => {
        if (this.phaseSeq !== seq || this.state.phase !== "VOTE") return;
        this.voteLockdownPending = false;
        this.resolveVotePhase();
      }, 2000);
    }
  }

  private resolveVotePhase() {
    if (this.state.phase !== "VOTE") return;
    this.voteLockdownPending = false;

    const aliveIds = this.getAlivePlayerIds();
    const eligible = this.tieCandidates.length > 0 ? this.tieCandidates : aliveIds;
    const voteObj: Record<string, string> = {};
    this.votes.forEach((targetId, voterId) => {
      voteObj[voterId] = targetId;
    });

    const tally = tallyVotes(voteObj, eligible);

    const revealList: Array<{ voterSeat: number; voterNick: string; targetNick: string; targetSeat: number }> = [];
    this.votes.forEach((targetId, voterId) => {
      const vP = this.state.players.get(voterId);
      const tP = this.state.players.get(targetId);
      if (vP && tP) {
        revealList.push({
          voterSeat: vP.seat,
          voterNick: vP.nick,
          targetNick: tP.nick,
          targetSeat: tP.seat
        });
      }
    });
    this.abstainedVoters.forEach((voterId) => {
      const vP = this.state.players.get(voterId);
      if (vP && !this.votes.has(voterId)) {
        revealList.push({
          voterSeat: vP.seat,
          voterNick: vP.nick,
          targetNick: "Çekimser (Boş Zarf)",
          targetSeat: 11
        });
      }
    });
    revealList.sort((a, b) => a.voterSeat - b.voterSeat);
    this.broadcast("vote_reveal", { votes: revealList, counts: tally.countsByTarget });

    if (tally.isTie && this.tieCandidates.length === 0 && tally.topTargets.length > 1) {
      this.enterVotePhase(tally.topTargets);
      return;
    }

    this.enterFirePhase(tally.burnedTargetId);
  }

  private enterFirePhase(burnedId: string | null) {
    this.tieCandidates = [];
    this.state.tieCandidateCsv = "";

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
      victim.votedForId = "";
    }
    if (this.state.necklaceHolder === burnedId) {
      this.state.necklaceHolder = "";
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

    this.chronicleLog.push(
      wasTraitor
        ? `🔥 Gün #${this.state.round} Şömine: Koltuk #${victim?.seat} ${victim?.nick} (HAİN yakalandı)`
        : `❄️ Gün #${this.state.round} Şömine: Koltuk #${victim?.seat} ${victim?.nick} (Masum Misafir elendi)`
    );

    const flameText = wasTraitor
      ? `🔥 Alevler KAN KIRMIZISI parladı! ${victim?.nick} bir HAİNDİ!`
      : `❄️ Alevler BEYAZ yandı... ${victim?.nick} masum bir MİSAFİRDİ!`;

    this.setPhase("FIRE", SOFRA_CONFIG.DURATIONS.FIRE, flameText, () => this.checkWinOrContinue("NIGHT"));
  }

  private enterNightPhase() {
    this.nightPicks.clear();
    this.sealedNightTraitors.clear();
    this.nightWatchedPlayers.clear();
    this.nightWatchTexts.clear();

    // Gece başladığında şatonun tüm özel yatak odası kapıları kapanır ve kilitlenir
    this.state.doors.forEach((d) => {
      d.open = false;
      d.locked = true;
    });

    const nightSec = this.getPhaseSeconds("NIGHT", SOFRA_CONFIG.DURATIONS.NIGHT);
    this.setPhase(
      "NIGHT",
      nightSec,
      `🌑 GECE MOLASI (${formatDurationLabelTR(nightSec)}) · Kapılar kilitlendi! Hainler kulede gizli toplantı yapıyor ve İNFAZ kararını veriyor...`,
      () => this.enterMorningPhase()
    );
    const seq = this.phaseSeq;

    this.clock.setTimeout(() => {
      if (this.phaseSeq !== seq || this.state.phase !== "NIGHT") return;
      const aliveHumanTraitors = this.getAliveAllHumanIds().filter(
        (id) => this.secretRoles.get(id) === "HAIN"
      );
      const aliveGuests = this.getAlivePlayerIds().filter(
        (id) => this.secretRoles.get(id) === "MISAFIR" && id !== this.state.necklaceHolder
      );
      const fallbackGuests = this.getAlivePlayerIds().filter((id) => this.secretRoles.get(id) === "MISAFIR");
      const basePool = aliveGuests.length > 0 ? aliveGuests : fallbackGuests;
      // 1. Gece koruması: İlk geceden insan oyuncuyu şanssızca oyundan düşürmemek için bot Misafir varsa önce onu hedef alırlar!
      const botOnlyFirstNight =
        this.state.round === 1 ? basePool.filter((id) => this.aiControlledIds.has(id)) : [];
      const targetPool = botOnlyFirstNight.length > 0 ? botOnlyFirstNight : basePool;

      const humanAlreadyPicked = aliveHumanTraitors
        .map((hid) => this.nightPicks.get(hid))
        .find(Boolean);

      this.state.players.forEach((bot) => {
        if (!this.aiControlledIds.has(bot.id) || !bot.alive) return;
        if (this.secretRoles.get(bot.id) === "HAIN" && targetPool.length > 0) {
          const pick = humanAlreadyPicked || targetPool[Math.floor(Math.random() * targetPool.length)];
          this.nightPicks.set(bot.id, pick);
          const pickP = this.state.players.get(pick);
          if (pickP) {
            const neckP = this.state.necklaceHolder ? this.state.players.get(this.state.necklaceHolder) : undefined;
            this.sendToTraitors("traitor_pick_update", {
              traitorId: bot.id,
              traitorSeat: bot.seat,
              traitorNick: bot.nick,
              targetId: pickP.id,
              targetSeat: pickP.seat,
              targetNick: pickP.nick
            });
            this.sendToTraitors("chat_msg", {
              senderId: bot.id,
              senderNick: bot.nick,
              seat: bot.seat,
              text: generateNightTraitorChatLine({
                botNick: bot.nick,
                targetSeat: pickP.seat,
                targetNick: pickP.nick,
                necklaceSeat: neckP?.seat
              }),
              channel: "HAİN MECLİSİ"
            });
          }
        }
      });

      // Meta-sızıntısız Bot Hain Meclisi: sayaçta 2.6 sn'de ani sıçrama yapmadan, doğal meclis süresi (10-16 sn) sonunda insan Hain mührüyle birebir aynı geçişi yapar!
      if (aliveHumanTraitors.length === 0) {
        const naturalConclaveDelay = (this.state.fastMode ? 7500 : 10500) + Math.floor(Math.random() * 4500);
        this.clock.setTimeout(() => {
          if (this.phaseSeq !== seq || this.state.phase !== "NIGHT") return;
          const stillHumanTraitors = this.getAliveAllHumanIds().filter(
            (id) => this.secretRoles.get(id) === "HAIN"
          );
          if (stillHumanTraitors.length > 0) return;
          if (this.phaseTimer) this.phaseTimer.clear();
          this.state.announcement =
            "🩸 Hainler Meclisi toplantısını tamamladı ve İnfaz Mührünü bastı! Sabah çanı çalıyor...";
          this.state.phaseEndsAt = Date.now() + 3500;
          this.phaseTimer = this.clock.setTimeout(() => {
            if (this.phaseSeq !== seq || this.state.phase !== "NIGHT") return;
            this.enterMorningPhase();
          }, 3500);
        }, naturalConclaveDelay);
      }
    }, 2600);
  }

  private enterMorningPhase() {
    const aliveGuests = this.getAlivePlayerIds().filter((id) => this.secretRoles.get(id) === "MISAFIR");
    const picks = Array.from(this.nightPicks.values());
    const nightRes = resolveNightVictim(picks, aliveGuests, this.state.necklaceHolder);

    if (nightRes.protectedByNecklace) {
      const savedP = this.state.necklaceHolder ? this.state.players.get(this.state.necklaceHolder) : undefined;
      this.state.lastTakenId = "";
      this.state.lastTakenName = "";
      this.chronicleLog.push(
        `📿 Gece #${this.state.round}: Hainlerin İnfaz girişimi Altın Kolye (${savedP?.nick || "Misafir"}) tarafından engellendi!`
      );
      this.broadcast("night_execution_event", {
        protectedByNecklace: true,
        victimId: "",
        victimSeat: savedP?.seat || 0,
        victimNick: savedP?.nick || ""
      });
      this.setPhase(
        "MORNING",
        SOFRA_CONFIG.DURATIONS.MORNING,
        "Kâhya: 'Gece Hainler Meclisi infaz emri verdi... Ama Altın Kolye parladı ve sahibini ölümden kurtardı!'",
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
      victim.votedForId = "";
      this.state.lastTakenId = victim.id;
      this.state.lastTakenName = victim.nick;
      this.chronicleLog.push(
        `🩸 Gece #${this.state.round} İnfazı: Koltuk #${victim.seat} ${victim.nick} Hainler Toplantısında İNFAZ EDİLDİ!`
      );
      this.broadcast("night_execution_event", {
        protectedByNecklace: false,
        victimId: victim.id,
        victimSeat: victim.seat,
        victimNick: victim.nick
      });
    }

    const msg = victim
      ? `🩸 GECE İNFAZI: Hainler Meclisi kararını verdi! Koltuk #${victim.seat} (${victim.nick}) infaz edildi, sofradaki tabağı ters çevrildi!`
      : "Kâhya: 'Sabah oldu. Sofrada eksilen yok.'";

    this.setPhase("MORNING", SOFRA_CONFIG.DURATIONS.MORNING, msg, () => {
      this.state.round += 1;
      this.checkWinOrContinue("DAY");
    });
  }

  private checkFinalDecisionsComplete() {
    if (this.state.phase !== "FINAL" || this.finalLockdownPending) return;
    const aliveIds = this.getAlivePlayerIds();
    if (aliveIds.length > 0 && aliveIds.every((id) => this.finalDecisions.has(id))) {
      this.finalLockdownPending = true;
      if (this.phaseTimer) this.phaseTimer.clear();
      this.state.announcement = "⚖️ Son Sofra kararları mühürlendi! Sonuç açıklanıyor...";
      this.state.phaseEndsAt = Date.now() + 2200;
      const seq = this.phaseSeq;
      this.phaseTimer = this.clock.setTimeout(() => {
        if (this.phaseSeq !== seq || this.state.phase !== "FINAL") return;
        this.finalLockdownPending = false;
        this.resolveFinalPhaseNow();
      }, 2200);
    }
  }

  private enterFinalPhase() {
    this.finalAskedForRound = this.state.round;
    this.finalDecisions.clear();
    this.finalLockdownPending = false;
    this.broadcast("bell_tolls", { round: this.state.round });
    this.seatAllPlayersAtRoundTable();

    this.setPhase(
      "FINAL",
      SOFRA_CONFIG.DURATIONS.FINAL,
      "⚖️ SON SOFRA KARARI · 'Hepimiz misafiriz' diyerek oyunu bitiriyor musunuz, yoksa 'Aramızda hâlâ hain var' diyerek şömine oylamasına mı gidiyorsunuz?",
      () => this.resolveFinalPhaseNow()
    );
    const seq = this.phaseSeq;

    this.clock.setTimeout(() => {
      if (this.phaseSeq !== seq || this.state.phase !== "FINAL") return;
      const aliveIdsNow = this.getAlivePlayerIds();
      const aliveTraitorsCount = aliveIdsNow.filter((id) => this.secretRoles.get(id) === "HAIN").length;

      this.state.players.forEach((bot) => {
        if (!this.aiControlledIds.has(bot.id) || !bot.alive) return;
        const bRole = this.secretRoles.get(bot.id) || "MISAFIR";
        if (bRole === "HAIN") {
          // Hain bot masumları kandırıp oyunu hemen kazanmak için "Hepimiz Misafiriz (TRUST)" der!
          this.finalDecisions.set(bot.id, "TRUST");
        } else {
          // Masum bot şöminede tüm hainler yanmadıysa ASLA körü körüne güvenmez, "Aramızda Hain Var (DOUBT)" der!
          this.finalDecisions.set(bot.id, aliveTraitorsCount > 0 ? "DOUBT" : "TRUST");
        }
      });
      this.checkFinalDecisionsComplete();
    }, 2000);
  }

  private resolveFinalPhaseNow() {
    if (this.state.phase !== "FINAL") return;
    this.finalLockdownPending = false;
    const aliveIds = this.getAlivePlayerIds();
    const roleObj = this.getRolesRecord();
    const decObj: Record<string, "TRUST" | "DOUBT"> = {};
    aliveIds.forEach((id) => {
      // Süre dolarsa ihtiyatlı davranıp oylamaya (DOUBT) gidilir; oyun yanlışlıkla erken bitmez!
      decObj[id] = this.finalDecisions.get(id) || "DOUBT";
    });
    const outcome = resolveFinalDecision(decObj, aliveIds, roleObj);
    if (outcome === "VOTE_AGAIN") {
      this.enterVotePhase([]);
    } else if (outcome === "HAIN_WINS") {
      this.enterResultPhase(
        "HAIN",
        "Son 4 Kişi Final Kararında herkes 'Hepimiz Misafiriz' dedi ama sofrada gizlenen bir Hain vardı!"
      );
    } else {
      this.enterResultPhase(
        "MISAFIR",
        "Son 4 Kişi Final Kararında masum Misafirler birbirine güvendi ve aralarında hiç Hain kalmamıştı!"
      );
    }
  }

  private checkWinOrContinue(nextPhase: "DAY" | "NIGHT") {
    const aliveIds = this.getAlivePlayerIds();
    const rolesRec = this.getRolesRecord();
    const outcome = evaluateWinCondition(aliveIds, rolesRec);
    const aliveTraitors = aliveIds.filter((id) => rolesRec[id] === "HAIN").length;
    const aliveGuests = aliveIds.length - aliveTraitors;

    if (outcome === "MISAFIR_WINS") {
      const burnedInfo = this.state.lastBurnedName
        ? `Şömine oylamasında son Hain (${this.state.lastBurnedName}) yakalandığı için şatoda hiçbir Hain kalmadı!`
        : "Şatodaki tüm Hainler ortaya çıkarılıp elendiği için Misafirler kurtuldu!";
      this.enterResultPhase("MISAFIR", burnedInfo);
      return;
    }
    if (outcome === "HAIN_WINS") {
      const hainInfo =
        nextPhase === "DAY"
          ? `Gece infazı sonrası canlı Hain sayısı (${aliveTraitors}) canlı Misafir sayısına (${aliveGuests}) eşitlendi ve Hainler şatoyu ele geçirdi!`
          : `Şöminede masum bir Misafir (${this.state.lastBurnedName || "Davetli"}) elenince canlı Hain sayısı (${aliveTraitors}) Misafir sayısına (${aliveGuests}) ulaştı!`;
      this.enterResultPhase("HAIN", hainInfo);
      return;
    }
    if (nextPhase === "NIGHT") {
      this.enterNightPhase();
    } else {
      this.enterDayPhase();
    }
  }

  private enterResultPhase(winner: "MISAFIR" | "HAIN", reason?: string) {
    this.phaseSeq += 1;
    if (this.phaseTimer) this.phaseTimer.clear();
    this.voteLockdownPending = false;
    this.finalLockdownPending = false;

    this.state.phase = "RESULT";
    this.state.winnerTeam = winner;
    this.state.winReason =
      reason ||
      (winner === "MISAFIR"
        ? "Şatodaki tüm Hainler elendiği için Misafirler kazandı!"
        : "Hainler sayıca üstünlüğü ele geçirip şatoya hâkim oldu!");
    this.state.phaseEndsAt = Date.now() + 120000;
    this.state.announcement =
      winner === "HAIN"
        ? "🗡️ HAİNLER KAZANDI! Maskeler düştü — sonuçları inceleyip hazır olduğunuzda 'Yeni Oyun (Lobi)'ye geçebilirsiniz."
        : "🕯️ MİSAFİRLER KAZANDI! Maskeler düştü — sonuçları inceleyip hazır olduğunuzda 'Yeni Oyun (Lobi)'ye geçebilirsiniz.";

    const mult = resolveDurationPreset(this.state.paceMode, this.state.fastMode).rewardMultiplier;
    const revealedRoles: Array<{ id: string; nick: string; seat: number; role: PlayerRole; alive: boolean }> = [];
    this.state.players.forEach((p) => {
      const pRole = this.secretRoles.get(p.id) || "MISAFIR";
      revealedRoles.push({
        id: p.id,
        nick: p.nick,
        seat: p.seat,
        role: pRole,
        alive: p.alive
      });

      const won = pRole === winner;
      const token = this.sessionToToken.get(p.id);
      if (token && token.startsWith("acc_")) {
        accountStore.recordMatchResult(token, won);
      }
      // Hem kayıtlı hem misafir olarak oynayan bağlı tüm insan oyunculara maç sonu altın ödülünü gönder!
      if (!p.isBot && !this.aiControlledIds.has(p.id)) {
        const c = this.clients.find((cl) => cl.sessionId === p.id);
        c?.send("match_reward", { bonusGold: Math.round((won ? 30 : 10) * mult), won });
      }
    });

    const topMatchBond = this.computeTopMatchBond();

    this.broadcast("game_over_roles", {
      winner,
      roles: revealedRoles,
      chronicle: this.chronicleLog,
      topMatchBond
    });

    // Sonuç ekranı aceleyle kapanmasın: oyuncu 'Yeni Oyun (Lobi)' butonuna basana veya 120 sn dolana kadar açık kalır!
    const seq = this.phaseSeq;
    this.phaseTimer = this.clock.setTimeout(() => {
      if (this.phaseSeq !== seq || this.state.phase !== "RESULT") return;
      if (this.clients.length === 0) {
        this.disconnect();
        return;
      }
      this.resetToLobby();
    }, 120000);
  }

  private resetToLobby() {
    this.phaseSeq += 1;
    if (this.phaseTimer) this.phaseTimer.clear();
    this.setPrivate(this.state.hasPassword);
    this.unlock();

    // Maç sırasında kopup hayalet kalan veya AI devralmış eski insan slotlarını temizle
    const toDelete: string[] = [];
    this.state.players.forEach((p, id) => {
      const hasLiveClient = this.clients.some((c) => c.sessionId === id);
      if (!hasLiveClient && (!id.startsWith("bot_") || !p.isBot)) {
        toDelete.push(id);
      }
    });
    toDelete.forEach((id) => {
      this.state.players.delete(id);
      this.aiControlledIds.delete(id);
      this.botBrains.delete(id);
      this.botMemories.delete(id);
      this.clearSessionTokenMapping(id);
    });

    const targetCap = Math.max(
      6,
      Math.min(this.maxClients, this.state.targetPlayerCount || SOFRA_CONFIG.DEFAULT_MATCH_CLIENTS)
    );
    this.trimLobbyBotsTo(targetCap);

    // Orijinal kostümleri geri yükle ve tüm oyuncuları Antre'ye sıfırla
    this.state.players.forEach((p) => {
      const savedCos = this.tempEquippedCosmetics.get(p.id);
      if (savedCos) {
        p.coatColor = savedCos.coatColor;
        p.accentColor = savedCos.accentColor;
        p.hat = savedCos.hat as any;
        p.mask = savedCos.mask as any;
      } else if (p.isBot) {
        const cDef = CHARACTERS.find((c) => c.seat === p.seat);
        if (cDef) {
          p.coatColor = cDef.coatColor;
          p.accentColor = cDef.accentColor;
          p.hat = cDef.hat;
          p.mask = cDef.mask;
        }
      }
      p.alive = true;
      p.ghost = false;
      p.hasKahyaKey = false;
      p.votedForId = "";
      p.anim = "idle";
      p.roomId = "antre";
      const sp = getAntreSpawn(p.seat);
      p.x = sp.x;
      p.z = sp.z;
      p.rotY = sp.rotY;
    });

    this.state.doors.forEach((d) => {
      d.open = false;
      d.locked = true;
    });

    this.state.phase = "LOBBY";
    this.state.round = 1;
    this.state.pot = 0;
    this.state.winnerTeam = "";
    this.state.winReason = "";
    this.state.lastBurnedId = "";
    this.state.lastBurnedName = "";
    this.state.lastBurnedFlame = "";
    this.state.lastTakenId = "";
    this.state.lastTakenName = "";
    this.state.necklaceHolder = "";
    this.state.councilBoardNote = "";
    this.state.tieCandidateCsv = "";
    this.state.phaseEndsAt = 0;
    this.state.announcement =
      "Şato lobisinde davetliler bekleniyor... Hazır olduğunda '🔥 SOFRAYI BAŞLAT'a bas!";

    this.secretRoles.clear();
    this.roleSentSessions.clear();
    this.departedSessions.clear();
    this.affinities.clear();
    this.affinityAccumSec = 0;
    this.botChatterAccumSec = 0;
    this.activePuzzles.clear();
    this.puzzleCooldownUntil.clear();
    this.solvedPuzzleRound.clear();
    this.necklaceClaimedByPuzzleThisRound = false;
    this.playerQuests.clear();
    this.trialStageByPlayer.clear();
    this.trialActiveChallenge.clear();
    this.trialCompletedClue.clear();
    this.lastTrialSubmitAt.clear();
    this.trialSabotagedPlayers.clear();
    this.trialSabotageCount = 0;
    this.pendingBotTrialPot = 0;
    this.pendingSabotagePotDrain = 0;
    this.readyPhasePlayers.clear();
    this.votes.clear();
    this.abstainedVoters.clear();
    this.penalizedVotePairsThisRound.clear();
    this.tieCandidates = [];
    this.nightPicks.clear();
    this.sealedNightTraitors.clear();
    this.nightWatchedPlayers.clear();
    this.nightWatchTexts.clear();
    this.finalDecisions.clear();
    this.chronicleLog = [];
    this.kahyaBellUsedRound = 0;
    this.chalkUsedRound.clear();
    this.lastLightSabotageAt = 0;
    this.noteSabotageUsedRound.clear();
    this.medievalStationUses.clear();
    this.ghostHauntCooldown.clear();
    this.finalAskedForRound = 0;
    this.voteLockdownPending = false;
    this.finalLockdownPending = false;
    this.accusedByHumansThisRound.clear();
    this.accusedScoreThisRound.clear();
    this.tempEquippedCosmetics.clear();

    this.reassignHostIfNeeded("");

    if (this.state.autoStart && this.clients.length > 0) {
      this.scheduleAutoLobbyCountdown();
    }
  }

  private getAliveConnectedHumanIds(): string[] {
    const out: string[] = [];
    this.state.players.forEach((p) => {
      if (p.alive && !p.ghost && !p.isBot && !this.aiControlledIds.has(p.id) && p.connected) {
        out.push(p.id);
      }
    });
    return out;
  }

  private getAliveAllHumanIds(): string[] {
    const out: string[] = [];
    this.state.players.forEach((p) => {
      if (p.alive && !p.ghost && !p.isBot && !this.aiControlledIds.has(p.id)) {
        out.push(p.id);
      }
    });
    return out;
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
  // CANLI SİMÜLASYON: ARKADAŞLIK BARI + ZEKİ BOT GEZİNTİSİ & PROAKTİF FISILTI
  // ============================================================================
  private updateSimulation(dt: number) {
    if (this.state.phase !== "DAY" && this.state.phase !== "ARRIVAL") return;
    const now = Date.now();
    const openDoors = this.getOpenDoorsRecord();
    const lockedDoors = this.getLockedDoorsRecord();

    // 1. Her 1.0 saniyede bir Canlı Oyuncular Arası YAKINLIK / ARKADAŞLIK BARINI hesapla!
    if (this.state.phase === "DAY") {
      this.affinityAccumSec += dt;
      if (this.affinityAccumSec >= 1.0) {
        this.affinityAccumSec = 0;
        const aliveArr = Array.from(this.state.players.values()).filter((p) => p.alive && !p.ghost);
        for (let i = 0; i < aliveArr.length; i++) {
          for (let j = i + 1; j < aliveArr.length; j++) {
            const a = aliveArr[i];
            const b = aliveArr[j];
            const d = Math.hypot(a.x - b.x, a.z - b.z);
            let gain = 0;
            if (d <= 4.6) gain += 1.6;
            if (a.roomId === b.roomId && a.roomId !== "yemek_salonu" && a.roomId !== "antre") {
              gain += 1.5;
              if (a.roomId.startsWith("yatak_")) {
                const door = DOORS.find((dr) => dr.roomId === a.roomId);
                if (door && !openDoors[door.id]) {
                  gain += 2.8; // Kapalı özel yatak odasında baş başa kalmak barı hızla yükseltir!
                }
              }
            }
            if (gain > 0) {
              this.addAffinity(a.id, b.id, gain);
              this.syncSocialQuestProgress(a.id);
              this.syncSocialQuestProgress(b.id);
            }
          }
        }
        // Kendi özel yatak odasına (Oda #seat) anahtarıyla giren oyuncunun Oda Görevini tamamla!
        aliveArr.forEach((pl) => {
          if (pl.roomId === `yatak_${pl.seat}`) {
            this.completeQuestByKind(pl.id, "ROOM_OR_BOARD");
          }
        });
      }

      // 2. Her 16 saniyede bir Zeki Botlardan biri koridorda laf atsın veya gerçek oyuncuya gizli PM fısıldasın!
      this.botChatterAccumSec += dt;
      if (this.botChatterAccumSec >= 16.0) {
        this.botChatterAccumSec = 0;
        this.triggerAutonomousBotSocial();
      }
    }

    // 3. Bot Hareket ve Hafıza Güncellemesi (Bot kendi özel yatak odasına, Konsey ve Bulmaca Salonuna da gider!)
    this.state.players.forEach((bot) => {
      if (!this.aiControlledIds.has(bot.id) || !bot.alive) return;
      let brain = this.botBrains.get(bot.id);
      if (!brain) {
        const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
        brain = { targetX: wp.x, targetZ: wp.z, waitUntil: now + 500 };
        this.botBrains.set(bot.id, brain);
      }

      const mem = this.botMemories.get(bot.id);
      // Eğer oyuncu bota "yanıma gel / takip et" dediyse bot oyuncunun yanına yürür!
      if (mem?.followTargetId && mem.followUntil && now < mem.followUntil) {
        const leader = this.state.players.get(mem.followTargetId);
        if (leader && leader.alive) {
          const distToLeader = Math.hypot(leader.x - bot.x, leader.z - bot.z);
          if (distToLeader > 2.3) {
            brain.targetX = leader.x + (bot.seat % 2 === 0 ? 1.2 : -1.2);
            brain.targetZ = leader.z + 1.1;
            brain.waitUntil = 0;
          } else {
            bot.anim = "idle";
            bot.rotY = Math.atan2(leader.x - bot.x, leader.z - bot.z);
            return;
          }
        }
      }

      if (now < brain.waitUntil) {
        bot.anim = "idle";
        return;
      }

      const dx = brain.targetX - bot.x;
      const dz = brain.targetZ - bot.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 1.1) {
        // %25 ihtimalle kendi özel yatak odasına uğrar, %75 genel salonlara gider!
        if (Math.random() < 0.25) {
          const ownDoor = DOORS.find((d) => d.ownerSeat === bot.seat);
          if (ownDoor) {
            brain.targetX = ownDoor.x < 0 ? -21.0 : 21.0;
            brain.targetZ = ownDoor.z;
          }
        } else {
          const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
          brain.targetX = wp.x + (Math.random() - 0.5) * 2.6;
          brain.targetZ = wp.z + (Math.random() - 0.5) * 2.6;
        }
        brain.waitUntil = now + 1400 + Math.random() * 2200;
        bot.anim = "idle";
        return;
      }

      const step = SOFRA_CONFIG.WALK_SPEED * 0.84 * dt;
      const nx = bot.x + (dx / dist) * step;
      const nz = bot.z + (dz / dist) * step;
      const resolved = resolveCastleStep(bot.x, bot.z, nx, nz, openDoors, 0.42, {
        seat: bot.seat,
        currentRoomId: bot.roomId,
        lockedDoors,
        hasKahyaKey: bot.hasKahyaKey
      });

      bot.x = resolved.x;
      bot.z = resolved.z;
      if (resolved.hit) {
        const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
        brain.targetX = wp.x;
        brain.targetZ = wp.z;
      }

      bot.rotY = Math.atan2(dx, dz);
      bot.anim = "walk";
      const zInfo = detectRoomZone(bot.x, bot.z);
      bot.roomId = zInfo.id;

      // Botun gerçek oda ve gördüğü oyuncu hafızasını güncelle
      if (mem) {
        mem.realLastRoom = zInfo.name;
        this.state.players.forEach((other) => {
          if (other.id !== bot.id && other.alive && Math.hypot(other.x - bot.x, other.z - bot.z) < 6.0) {
            mem.lastSeenSeat = other.seat;
            mem.lastSeenNick = other.nick;
            mem.lastSeenRoom = zInfo.name;
          }
        });
      }
    });
  }

  private triggerAutonomousBotSocial() {
    const aliveBots = Array.from(this.state.players.values()).filter(
      (p) => this.aiControlledIds.has(p.id) && p.alive
    );
    if (aliveBots.length === 0 || this.clients.length === 0) return;

    const bot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
    const role = this.secretRoles.get(bot.id) || "MISAFIR";
    const sc = this.pickScapegoatForBot(bot.id, role);
    if (!sc) return;

    // Yakında gerçek bir insan oyuncu varsa ona sürpriz 1'e 1 Fısıltı (PM) at!
    const humanClient = this.clients.find((c) => {
      const hp = this.state.players.get(c.sessionId);
      return hp && hp.alive && Math.hypot(hp.x - bot.x, hp.z - bot.z) <= 16;
    });

    if (humanClient && Math.random() < 0.55) {
      const hp = this.state.players.get(humanClient.sessionId)!;
      const line =
        role === "HAIN"
          ? `🤫 Şşşt ${hp.nick}, aramızda kalsın ama #${sc.seat} ${sc.nick} bana çok tekinsiz göründü... Sofrada ona oy basalım mı?`
          : `🤫 ${hp.nick}, gözünü dört aç! #${sc.seat} ${sc.nick} koridorlarda tek başına dolaşıyor, dikkatli ol.`;

      this.addAffinity(bot.id, hp.id, 8);
      humanClient.send("pm_msg", {
        fromId: bot.id,
        fromNick: bot.nick,
        fromSeat: bot.seat,
        toId: hp.id,
        toNick: hp.nick,
        toSeat: hp.seat,
        text: line,
        ts: Date.now()
      });
      return;
    }

    // Değilse yalnızca yakındaki oyuncuların duyacağı yakın sohbete atmosferik bir cümle bırak!
    this.sendProximityOrPhaseChat(bot, {
      senderId: bot.id,
      senderNick: bot.nick,
      seat: bot.seat,
      text: `#${sc.seat} ${sc.nick} sabahtan beri hangi odada saklanıyor acaba?`,
      channel: "YAKIN"
    });
  }

  onDispose() {
    this.phaseSeq += 1;
    if (this.phaseTimer) this.phaseTimer.clear();
    if (this.autoLobbyTimer) this.autoLobbyTimer.clear();
    liveRooms.delete(this.roomId);
    if (this.state?.code) {
      activeRoomsByCode.delete(this.state.code);
    }
  }
}
