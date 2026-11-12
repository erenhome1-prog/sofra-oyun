import { Room, Client, Delayed, ServerError } from "@colyseus/core";
import {
  BOT_WAYPOINTS,
  CHARACTERS,
  COUNCIL_BOARD_POS,
  DOORS,
  GamePhase,
  PUZZLE_ALTARS,
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
  private activePuzzles = new Map<string, ActivePuzzleSession>();
  private solvedPuzzleRound = new Map<string, number>();
  private necklaceClaimedByPuzzleThisRound = false;
  private playerQuests = new Map<string, PersonalQuest[]>();
  private trialStageByPlayer = new Map<string, number>();
  private trialActiveChallenge = new Map<string, ActivePuzzleSession>();
  private trialSabotagedPlayers = new Set<string>();
  private trialSabotageCount = 0;
  private readyPhasePlayers = new Set<string>();
  private sealedNightTraitors = new Set<string>();
  private nightWatchedPlayers = new Set<string>();
  private chronicleLog: string[] = [];

  // BOT YAPAY ZEKÂ HAFIZASI
  private aiControlledIds = new Set<string>();
  private botBrains = new Map<string, BotBrain>();
  private botMemories = new Map<string, BotMemory>();

  private votes = new Map<string, string>();
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

    const cleanTitle = String(options?.roomTitle || "").trim().slice(0, 28);
    const cleanPass = String(options?.roomPassword || "").trim().slice(0, 24);

    this.roomPassword = cleanPass;
    this.state.code = code;
    this.state.roomTitle = cleanTitle || `Sofra ${code}`;
    this.state.hasPassword = cleanPass.length > 0;
    this.state.phase = "LOBBY";

    if (this.state.hasPassword) {
      this.setPrivate(true);
    }

    activeRoomsByCode.set(code, this.roomId);
    liveRooms.set(this.roomId, this);
    this.setMetadata({ code, roomTitle: this.state.roomTitle, hasPassword: this.state.hasPassword });

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
    if (this.clients.length === 0) {
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
    const waitSec = this.state.hasPassword ? 28 : 18;
    this.state.phaseEndsAt = Date.now() + waitSec * 1000;
    this.state.announcement = `🕯️ Kâhya sofrayı hazırlıyor... ${waitSec} sn içinde eksik koltuklar akıllı botlarla tamamlanıp otomatik başlayacak!`;

    this.autoLobbyTimer = this.clock.setTimeout(() => {
      if (this.state.phase !== "LOBBY" || !this.state.autoStart || this.clients.length === 0) return;
      while (this.state.players.size < 10) {
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
    const candidates: Array<{ id: string; seat: number; nick: string }> = [];
    this.state.players.forEach((p) => {
      if (!p.alive || p.ghost || p.id === botId) return;
      if (botRole === "HAIN" && this.secretRoles.get(p.id) === "HAIN") return;
      candidates.push({ id: p.id, seat: p.seat, nick: p.nick });
    });
    if (candidates.length === 0) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private buildRoomPlayerBriefs(botId: string): RoomPlayerBrief[] {
    const list: RoomPlayerBrief[] = [];
    this.state.players.forEach((p) => {
      list.push({
        id: p.id,
        seat: p.seat,
        nick: p.nick,
        charName: p.charName,
        alive: p.alive,
        roomName: detectRoomZone(p.x, p.z).name,
        role: this.secretRoles.get(p.id) || "MISAFIR",
        bondWithBot: Math.round(this.affinities.get(pairKey(botId, p.id)) || 0)
      });
    });
    return list;
  }

  private registerMessageHandlers() {
    // 1. Oyuncu hareketi (Kişisel Oda Anahtarı destekli çarpışma!)
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
        const resolved = resolveCastleCollision(targetX, targetZ, this.getOpenDoorsRecord(), 0.42, {
          seat: p.seat,
          currentRoomId: p.roomId,
          lockedDoors: this.getLockedDoorsRecord(),
          hasKahyaKey: p.hasKahyaKey
        });
        p.x = resolved.x;
        p.z = resolved.z;
      }

      p.rotY = typeof data.rotY === "number" ? data.rotY : p.rotY;
      p.anim = data.anim || (dist > 0.02 ? "walk" : "idle");
      p.roomId = detectRoomZone(p.x, p.z).id;
    });

    // 2. Kapı Açma / Kilitleme (Kendi özel odanın anahtarı sende! Davet etmek için kapını açabilirsin)
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
      if (Math.hypot(p.x - targetDoor.x, p.z - targetDoor.z) > SOFRA_CONFIG.DOOR_INTERACT_DIST + 0.9) return;

      const ds = this.state.doors.get(targetDoor.id);
      if (!ds) return;

      // #11 Kâhya'nın Mühürlü Odası
      if (targetDoor.sealedByKahya && !p.hasKahyaKey) {
        client.send("chat_msg", {
          senderId: p.id,
          senderNick: "KÂHYA MÜHRÜ",
          seat: 11,
          text: "🔒 Oda #11 Kâhya tarafından mühürlenmiş! Açmak için Bulmaca Salonu'ndan 'Paslı Kâhya Anahtarı' bulmalısın.",
          channel: "SİSTEM"
        });
        return;
      }

      const isOwner = p.seat === targetDoor.ownerSeat || (targetDoor.sealedByKahya && p.hasKahyaKey);
      const isInsideThisRoom = p.roomId === targetDoor.roomId;

      // Başkasının kilitli özel odasını dışarıdan açamazsın!
      if (ds.locked && !isOwner && !isInsideThisRoom) {
        client.send("chat_msg", {
          senderId: p.id,
          senderNick: "ANAHTAR",
          seat: targetDoor.ownerSeat,
          text: `🔒 ${targetDoor.label} kilitli! Bu odanın anahtarı yalnızca Koltuk #${targetDoor.ownerSeat} sahibinde (senin özel odan: Oda #${p.seat}).`,
          channel: "SİSTEM"
        });
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

      if (target.id !== client.sessionId && this.state.phase === "DAY") {
        this.completeQuestByKind(client.sessionId, "DETECTIVE");
      }
    });

    // 4. BULMACA & ETKİNLİK SALONU (`request_puzzle` & `submit_puzzle`)
    this.onMessage("request_puzzle", (client, data?: { altarId?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.state.phase !== "DAY") return;

      if (this.solvedPuzzleRound.get(p.id) === this.state.round) {
        client.send("puzzle_feedback", {
          ok: false,
          text: "✅ Bu gündüz turunda zaten bir şato bulmacası çözdün! Yeni turda tekrar gel."
        });
        return;
      }

      const altar = PUZZLE_ALTARS.find((a) => a.id === data?.altarId) || PUZZLE_ALTARS[0];
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
      if (!p || !ch || ch.puzzleId !== data?.puzzleId) return;
      this.activePuzzles.delete(client.sessionId);

      if (Number(data.optionIndex) !== ch.correctIndex) {
        client.send("puzzle_feedback", {
          ok: false,
          text: "❌ Yanlış mühür! Kürsünün taşları soğudu, başka bir kürsüyü dene."
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
      if (!this.necklaceClaimedByPuzzleThisRound) {
        this.necklaceClaimedByPuzzleThisRound = true;
        this.state.necklaceHolder = p.id;
        wonNecklace = true;
        this.broadcast("chat_msg", {
          senderId: p.id,
          senderNick: "ETKİNLİK SALONU",
          seat: p.seat,
          text: `📿 Koltuk #${p.seat} (${p.nick}) kadim bulmacayı çözdü ve Gece Korumalı ALTIN KOLYE'yi ele geçirdi!`,
          channel: "ETKİNLİK"
        });
      }

      client.send("puzzle_feedback", {
        ok: true,
        bonusGold: 20,
        wonNecklace,
        text: `${wonNecklace ? "📿 ALTIN KOLYE SENİN OLDU! +20🪙 | " : "+20🪙 Kasa Ödülü! | "}${clue.clueText}`
      });
      this.completeQuestByKind(client.sessionId, "DETECTIVE");
    });

    // 5. TOPLANTI & KONSEY SALONU TAHTASI (`chalk_suspect`)
    this.onMessage("chalk_suspect", (client, data: { suspectSeat: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.state.phase !== "DAY") return;
      const target = Array.from(this.state.players.values()).find((x) => x.seat === Number(data?.suspectSeat));
      if (!target) return;

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

    // 5B. 1 DAKİKALIK ORTAK ŞATO BULMACA SINAVI (`submit_trial_answer` & `sabotage_trial`)
    this.onMessage("submit_trial_answer", (client, data: { puzzleId: string; optionIndex: number }) => {
      const p = this.state.players.get(client.sessionId);
      const ch = this.trialActiveChallenge.get(client.sessionId);
      if (!p || !p.alive || p.ghost || this.state.phase !== "TRIAL" || !ch || ch.puzzleId !== data?.puzzleId) {
        return;
      }

      if (Number(data.optionIndex) !== ch.correctIndex) {
        // Yanlış cevapta aynı aşama için yeni bir soru gönder
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

      // 3/3 Tamamlandı!
      this.trialStageByPlayer.set(p.id, 4);
      this.trialActiveChallenge.delete(p.id);

      const aliveList: Array<{ id: string; seat: number; nick: string }> = [];
      this.state.players.forEach((pl) => {
        if (pl.alive && !pl.ghost) aliveList.push({ id: pl.id, seat: pl.seat, nick: pl.nick });
      });
      const clue = generateTrueDetectiveClue(p.id, aliveList, this.secretRoles);
      if (clue.grantedKahyaKey) p.hasKahyaKey = true;

      let wonNecklace = false;
      if (!this.necklaceClaimedByPuzzleThisRound && !this.state.necklaceHolder) {
        this.necklaceClaimedByPuzzleThisRound = true;
        this.state.necklaceHolder = p.id;
        wonNecklace = true;
        this.broadcast("chat_msg", {
          senderId: p.id,
          senderNick: "ŞATO SINAVI",
          seat: p.seat,
          text: `🏆 Koltuk #${p.seat} (${p.nick}) 3 aşamalı Şato Bulmacasını ilk tamamlayıp 📿 ALTIN KOLYE kazandı!`,
          channel: "ETKİNLİK"
        });
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
      this.state.pot = Math.max(0, this.state.pot - 25);
      client.send("match_reward", { bonusGold: 25, won: true });
      client.send("puzzle_feedback", {
        ok: true,
        bonusGold: 25,
        text: "🗡️ Şato düzeneğini gizlice SABOTE ettin! Hazineden +25🪙 cebine indi; Yuvarlak Sofrada şüpheyi başkasına yık!"
      });
    });

    // 5C. YUVARLAK SOFRA GEREKÇELİ SUÇLAMA ("Bu hain, çünkü bu yüzden!")
    this.onMessage("accuse_player", (client, data: { targetId: string; reason: string }) => {
      const sender = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!sender || !sender.alive || sender.ghost || !target || !target.alive || sender.id === target.id) return;
      if (this.state.phase !== "TABLE" && this.state.phase !== "VOTE") return;

      const cleanReason = String(data?.reason || "Hareketleri ve fısıltıları çok şüpheli!").trim().slice(0, 90);
      this.addAffinity(sender.id, target.id, -10);

      this.broadcast("chat_msg", {
        senderId: sender.id,
        senderNick: `👉 SUÇLAMA (#${sender.seat} ${sender.nick})`,
        seat: sender.seat,
        text: `"Koltuk #${target.seat} ${target.nick} HAİN! Çünkü: ${cleanReason}"`,
        channel: "SOFRA"
      });

      if (this.aiControlledIds.has(target.id)) {
        this.clock.setTimeout(() => {
          if (!target.alive || (this.state.phase !== "TABLE" && this.state.phase !== "VOTE")) return;
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

    // 5D. ERKEN HAZIR OYU (Uzun konuşma/tartışma evrelerinde tüm canlı insanlar hazırsa beklemeden geç!)
    this.onMessage("ready_next_phase", (client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || p.ghost) return;
      if (this.state.phase !== "DAY" && this.state.phase !== "TRIAL" && this.state.phase !== "TABLE") return;

      this.readyPhasePlayers.add(p.id);
      const aliveHumans = this.getAliveConnectedHumanIds();
      const readyCount = aliveHumans.filter((id) => this.readyPhasePlayers.has(id)).length;

      this.broadcast("ready_count_update", {
        readyCount,
        totalHumans: aliveHumans.length,
        phase: this.state.phase
      });

      if (aliveHumans.length > 0 && readyCount >= aliveHumans.length) {
        if (this.state.phase === "DAY") this.enterTrialPhase();
        else if (this.state.phase === "TRIAL") this.enterTablePhase();
        else if (this.state.phase === "TABLE") this.enterVotePhase([]);
      }
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

    this.onMessage("add_bots", (client, data?: { count?: number }) => {
      if (this.state.phase !== "LOBBY" || this.state.hostId !== client.sessionId) return;
      const want = Math.min(9, Math.max(1, Number(data?.count || 1)));
      for (let i = 0; i < want; i++) {
        if (this.state.players.size >= SOFRA_CONFIG.MAX_CLIENTS) break;
        this.spawnBot();
      }
    });

    this.onMessage("toggle_fast_mode", (client) => {
      if (this.state.hostId !== client.sessionId || this.state.phase !== "LOBBY") return;
      this.state.fastMode = !this.state.fastMode;
    });

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
      while (this.state.players.size < SOFRA_CONFIG.MIN_CLIENTS) {
        this.spawnBot();
      }
      this.startGameLoop();
    });

    // 7. Oylama (Karşı oy Yakınlık Barını düşürür!)
    this.onMessage("vote", (client, data: { targetId: string }) => {
      if (this.state.phase !== "VOTE") return;
      const voter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!voter || !voter.alive || voter.ghost) return;
      if (!target || !target.alive || target.ghost) return;
      if (voter.id === target.id) return;
      if (this.tieCandidates.length > 0 && !this.tieCandidates.includes(target.id)) return;

      this.votes.set(voter.id, target.id);
      voter.votedForId = target.id;
      this.addAffinity(voter.id, target.id, -15);
      this.checkIfAllVoted();
    });

    // 8. GECE HAİNLER MECLİSİ İNFAZ SEÇİMİ, MÜHÜRLEME VE GECE NÖBETİ
    this.onMessage("night_pick", (client, data: { targetId: string }) => {
      if (this.state.phase !== "NIGHT") return;
      if (this.secretRoles.get(client.sessionId) !== "HAIN") return;
      const voter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);
      if (!voter || !voter.alive || !target || !target.alive) return;
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
    });

    this.onMessage("seal_night_execution", (client) => {
      if (this.state.phase !== "NIGHT") return;
      if (this.secretRoles.get(client.sessionId) !== "HAIN") return;
      const voter = this.state.players.get(client.sessionId);
      if (!voter || !voter.alive) return;
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

      this.sealedNightTraitors.add(voter.id);
      const aliveHumanTraitors = this.getAliveConnectedHumanIds().filter(
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

      if (aliveHumanTraitors.length > 0 && sealedCount >= aliveHumanTraitors.length) {
        if (this.phaseTimer) this.phaseTimer.clear();
        this.state.announcement = "🩸 Hainler Meclisi toplantısını tamamladı ve İnfaz Mührünü bastı! Sabah çanı çalıyor...";
        this.state.phaseEndsAt = Date.now() + 3500;
        this.phaseTimer = this.clock.setTimeout(() => this.enterMorningPhase(), 3500);
      }
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

      client.send("night_watch_result", {
        text: `🕯️ Kapı deliğinden karanlık koridoru dinledin (+10🪙 Cesaret Ödülü): Gece yarısı ${wingText} tarafından kuleye çıkan gizli ayak sesleri duyuldu!`
      });
    });

    // 9. Final Kararı
    this.onMessage("final_decision", (client, data: { decision: "TRUST" | "DOUBT" }) => {
      if (this.state.phase !== "FINAL") return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      this.finalDecisions.set(p.id, data?.decision === "DOUBT" ? "DOUBT" : "TRUST");
    });

    // 10. GENEL / YAKIN / GECE HAİN MECLİSİ SOHBETİ + ZEKİ BOT CEVABI!
    this.onMessage("chat", (client, data: { text: string; channel?: string }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const rawText = String(data?.text || "").trim().slice(0, 140);
      if (!rawText) return;

      const senderRole = this.secretRoles.get(sender.id) || "MISAFIR";
      // Gece evresinde Hain konuşursa otomatik olarak yalnız Hainler Meclisi duyar!
      const isNightConclave = this.state.phase === "NIGHT" && !sender.ghost;
      if (isNightConclave && senderRole !== "HAIN") {
        client.send("chat_msg", {
          senderId: sender.id,
          senderNick: "GECE KİLİDİ",
          seat: sender.seat,
          text: "🕯️ Şu an 2 dakikalık Gece Molası: Hainler gizli toplantı yapıyor, odandan ses çıkaramazsın!",
          channel: "SİSTEM"
        });
        return;
      }

      const isTraitorWhisper =
        (data?.channel === "HAIN" || isNightConclave) && senderRole === "HAIN" && !sender.ghost;

      this.clients.forEach((c) => {
        const receiver = this.state.players.get(c.sessionId);
        if (!receiver) return;
        if (sender.ghost && !receiver.ghost) return;

        if (isTraitorWhisper) {
          if (this.secretRoles.get(receiver.id) !== "HAIN") return;
          c.send("chat_msg", {
            senderId: sender.id,
            senderNick: sender.nick,
            seat: sender.seat,
            text: rawText,
            channel: "HAİN MECLİSİ"
          });
          return;
        }

        if (this.state.phase === "DAY") {
          const sRoom = sender.roomId;
          const rRoom = receiver.roomId;
          const sDoor = DOORS.find((d) => d.roomId === sRoom);
          const rDoor = DOORS.find((d) => d.roomId === rRoom);
          const sClosed = sDoor ? !this.state.doors.get(sDoor.id)?.open : false;
          const rClosed = rDoor ? !this.state.doors.get(rDoor.id)?.open : false;

          if ((sClosed || rClosed) && sRoom !== rRoom) return;
          const dist = Math.hypot(sender.x - receiver.x, sender.z - receiver.z);
          if (dist > 15 && sRoom !== rRoom) return;
        }

        c.send("chat_msg", {
          senderId: sender.id,
          senderNick: sender.nick,
          seat: sender.seat,
          text: rawText,
          channel: sender.ghost ? "HAYALET" : this.state.phase === "DAY" ? "YAKIN" : "SOFRA"
        });
      });

      // Gece Hainler Meclisinde Hain Bot ortağın varsa sana cevap verip infaz hedefi önerir!
      if (isTraitorWhisper && this.state.phase === "NIGHT") {
        const botTraitor = Array.from(this.state.players.values()).find(
          (bp) => this.aiControlledIds.has(bp.id) && bp.alive && this.secretRoles.get(bp.id) === "HAIN"
        );
        if (botTraitor) {
          this.clock.setTimeout(() => {
            if (this.state.phase !== "NIGHT" || !botTraitor.alive) return;
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
        return;
      }

      // Yakındaki (veya Sofradaki) bir Akıllı Bot bu mesaja doğal Türkçe "Mini-AI" cevabı versin!
      if (
        !sender.ghost &&
        (this.state.phase === "DAY" ||
          this.state.phase === "TABLE" ||
          this.state.phase === "VOTE" ||
          this.state.phase === "TRIAL" ||
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

          this.clock.setTimeout(async () => {
            if (!addressed.alive) return;
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
              askerRole: senderRole,
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

            if (res.followAsker && this.state.phase === "DAY") {
              mem.followTargetId = sender.id;
              mem.followUntil = Date.now() + 28000;
            }
            if (res.persuadedVoteTargetId) {
              mem.promisedVoteTargetId = res.persuadedVoteTargetId;
              if (this.state.phase === "VOTE") {
                this.votes.set(addressed.id, res.persuadedVoteTargetId);
                addressed.votedForId = res.persuadedVoteTargetId;
              }
            }

            this.broadcast("chat_msg", {
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

      const rawText = String(data?.text || "").trim().slice(0, 140);
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
        this.clock.setTimeout(async () => {
          if (!target.alive) return;
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
            askerRole: sRole,
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

          if (res.followAsker && this.state.phase === "DAY") {
            mem.followTargetId = sender.id;
            mem.followUntil = Date.now() + 28000;
          }
          if (res.persuadedVoteTargetId) {
            mem.promisedVoteTargetId = res.persuadedVoteTargetId;
            if (this.state.phase === "VOTE") {
              this.votes.set(target.id, res.persuadedVoteTargetId);
              target.votedForId = res.persuadedVoteTargetId;
            }
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

    // 13. Lobiye Dön
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

  private getLockedDoorsRecord(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    this.state.doors.forEach((ds, id) => {
      out[id] = ds.locked;
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
        this.state.players.set(client.sessionId, cloned);

        // Yakınlık tablosundaki eski sessionId anahtarlarını yeni sessionId'ye taşı!
        const updatedAff = new Map<string, number>();
        this.affinities.forEach((val, key) => {
          const [a, b] = key.split("|");
          const na = a === oldSid ? client.sessionId : a;
          const nb = b === oldSid ? client.sessionId : b;
          updatedAff.set(pairKey(na, nb), val);
        });
        this.affinities = updatedAff;

        const oldRole = this.secretRoles.get(oldSid);
        if (oldRole) {
          this.secretRoles.delete(oldSid);
          this.secretRoles.set(client.sessionId, oldRole);
        }
        if (this.state.hostId === oldSid) this.state.hostId = client.sessionId;
        if (this.state.necklaceHolder === oldSid) this.state.necklaceHolder = client.sessionId;

        this.sessionToToken.delete(oldSid);
        this.sessionToToken.set(client.sessionId, pToken);
        this.tokenToSession.set(pToken, client.sessionId);

        const oldQuests = this.playerQuests.get(oldSid);
        if (oldQuests) {
          this.playerQuests.delete(oldSid);
          this.playerQuests.set(client.sessionId, oldQuests);
        }

        if (this.state.phase !== "LOBBY") {
          this.sendPrivateRoleToClient(client);
          this.sendQuestsToClient(client);
          if (this.state.phase === "TRIAL") {
            const stg = this.trialStageByPlayer.get(oldSid) || 1;
            this.trialStageByPlayer.set(client.sessionId, stg);
            if (stg <= 3) this.sendTrialStageToClient(client, stg);
          }
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

    const player = new Player();
    player.id = client.sessionId;
    player.nick = sanitizeNickname(options?.nick || "Misafir");
    player.connected = true;
    player.isBot = false;
    player.registered = pToken.startsWith("acc_");

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

    if (pToken) {
      this.sessionToToken.set(client.sessionId, pToken);
      this.tokenToSession.set(pToken, client.sessionId);
    }

    if (!this.state.hostId) {
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
      this.checkIfAllVoted();

      try {
        const reconnectedClient = await this.allowReconnection(client, SOFRA_CONFIG.RECONNECT_TIMEOUT_SEC);
        const current = this.state.players.get(reconnectedClient.sessionId);
        if (current) {
          current.connected = true;
          this.sendPrivateRoleToClient(reconnectedClient);
          this.sendQuestsToClient(reconnectedClient);
          if (this.state.phase === "TRIAL") {
            const stg = this.trialStageByPlayer.get(reconnectedClient.sessionId) || 1;
            if (stg <= 3) this.sendTrialStageToClient(reconnectedClient, stg);
          }
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

  private handlePermanentDeparture(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const pToken = this.sessionToToken.get(sessionId);

    if (this.state.phase === "LOBBY" || this.state.phase === "RESULT") {
      this.state.players.delete(sessionId);
      this.secretRoles.delete(sessionId);
      if (pToken) {
        this.sessionToToken.delete(sessionId);
        if (this.tokenToSession.get(pToken) === sessionId) {
          this.tokenToSession.delete(pToken);
        }
      }
      this.reassignHostIfNeeded(sessionId);
      return;
    }

    if (player.alive && !player.ghost) {
      const role = this.secretRoles.get(sessionId) || "MISAFIR";
      const aliveIds = this.getAlivePlayerIds();
      const aliveTraitors = aliveIds.filter((id) => this.secretRoles.get(id) === "HAIN");

      if (role === "HAIN" && aliveTraitors.length <= 1 && aliveIds.length >= 4) {
        this.aiControlledIds.add(sessionId);
        this.botMemories.set(sessionId, createInitialBotMemory(player.seat));
        player.connected = true;
        const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
        this.botBrains.set(sessionId, { targetX: wp.x, targetZ: wp.z, waitUntil: Date.now() + 800 });

        this.broadcast("chat_msg", {
          senderId: sessionId,
          senderNick: "KÂHYA",
          seat: player.seat,
          text: `🌑 Koltuk #${player.seat} (${player.nick}) sessizliğe gömüldü ama sandalyesinden ayrılmadı...`,
          channel: "SİSTEM"
        });
        this.reassignHostIfNeeded(sessionId);
        this.checkIfAllVoted();
        return;
      }

      this.votes.delete(sessionId);
      this.state.players.forEach((p, vid) => {
        if (p.votedForId === sessionId) {
          p.votedForId = "";
          this.votes.delete(vid);
        }
      });
      this.tieCandidates = this.tieCandidates.filter((id) => id !== sessionId);
      if (this.state.necklaceHolder === sessionId) {
        this.state.necklaceHolder = "";
      }

      const wasTraitor = role === "HAIN";
      const notes = wasTraitor ? FAREWELL_NOTES_HAIN : FAREWELL_NOTES_MISAFIR;
      const farewellNote = notes[Math.floor(Math.random() * notes.length)];
      const flame = wasTraitor ? "RED" : "WHITE";

      player.alive = false;
      player.ghost = true;
      player.anim = "ghost";
      this.state.lastBurnedId = sessionId;
      this.state.lastBurnedName = player.nick;
      this.state.lastBurnedFlame = flame;
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
        this.enterResultPhase("MISAFIR");
      } else if (outcome === "HAIN_WINS") {
        this.enterResultPhase("HAIN");
      } else {
        this.checkIfAllVoted();
      }
    }

    if (pToken) {
      this.sessionToToken.delete(sessionId);
      if (this.tokenToSession.get(pToken) === sessionId) {
        this.tokenToSession.delete(pToken);
      }
    }
    this.reassignHostIfNeeded(sessionId);
  }

  private reassignHostIfNeeded(leftSessionId: string) {
    if (this.state.hostId === leftSessionId) {
      const nextHuman = Array.from(this.state.players.values()).find((p) => !p.isBot && p.connected);
      this.state.hostId = nextHuman?.id || "";
    }
  }

  // ============================================================================
  // OYUN DÖNGÜSÜ (KENDİ KENDİNE AKAN EVRE MAKİNESİ)
  // ============================================================================
  private getDurationMs(baseSeconds: number): number {
    const sec = this.state.fastMode ? Math.max(5, Math.round(baseSeconds / SOFRA_CONFIG.FAST_DIVISOR)) : baseSeconds;
    return sec * 1000;
  }

  private setPhase(phase: GamePhase, durationSec: number, announcement: string, onComplete: () => void) {
    if (this.phaseTimer) this.phaseTimer.clear();
    const durMs = this.getDurationMs(durationSec);
    this.state.phase = phase;
    this.state.phaseEndsAt = Date.now() + durMs;
    this.state.announcement = announcement;
    this.phaseTimer = this.clock.setTimeout(onComplete, durMs);
  }

  private startGameLoop() {
    if (this.autoLobbyTimer) this.autoLobbyTimer.clear();
    this.state.round = 1;
    this.state.pot = 0;
    this.state.winnerTeam = "";
    this.state.lastBurnedId = "";
    this.state.lastBurnedName = "";
    this.state.lastBurnedFlame = "";
    this.state.lastTakenId = "";
    this.state.lastTakenName = "";
    this.state.necklaceHolder = "";
    this.state.councilBoardNote = "Henüz Konsey Tahtasına şüpheli yazılmadı.";
    this.affinities.clear();
    this.solvedPuzzleRound.clear();
    this.playerQuests.clear();
    this.chronicleLog = [];

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

    this.clients.forEach((c) => this.sendPrivateRoleToClient(c));

    this.setPhase(
      "ARRIVAL",
      SOFRA_CONFIG.DURATIONS.ARRIVAL,
      "Kâhya: 'Kargalı Şato'ya hoş geldiniz. Herkesin kendi özel yatak odasının anahtarı cebinde!'",
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
    client.send("role_envelope", { role: myRole, traitorMates });
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

  private enterDayPhase() {
    this.state.lastBurnedId = "";
    this.state.lastBurnedFlame = "";
    this.necklaceClaimedByPuzzleThisRound = false;
    this.readyPhasePlayers.clear();
    this.assignRoundQuestsForAll();

    this.setPhase(
      "DAY",
      SOFRA_CONFIG.DURATIONS.DAY,
      `Gündüz #${this.state.round} (5 Dk Keşif & Görev) · Gizli görevlerini yap, özel odanı (#Koltuk) gez, fısıldaş ve 🔍 İncele ile Yakınlık Barlarına bak!`,
      () => this.enterTrialPhase()
    );
  }

  private enterTrialPhase() {
    this.readyPhasePlayers.clear();
    this.trialStageByPlayer.clear();
    this.trialActiveChallenge.clear();
    this.trialSabotagedPlayers.clear();
    this.trialSabotageCount = 0;

    // Hain bir bot varsa %45 ihtimalle sınavı gizlice sabote etsin!
    this.state.players.forEach((bot) => {
      if (this.aiControlledIds.has(bot.id) && bot.alive && this.secretRoles.get(bot.id) === "HAIN") {
        if (Math.random() < 0.45) {
          this.trialSabotageCount += 1;
        }
      } else if (this.aiControlledIds.has(bot.id) && bot.alive) {
        this.state.pot += 15;
      }
    });

    this.clients.forEach((c) => {
      const p = this.state.players.get(c.sessionId);
      if (p && p.alive && !p.ghost) {
        this.trialStageByPlayer.set(p.id, 1);
        this.sendTrialStageToClient(c, 1);
      }
    });

    this.setPhase(
      "TRIAL",
      SOFRA_CONFIG.DURATIONS.TRIAL,
      "🧩 ŞATO BULMACA SINAVI (1 Dakika) · 3 aşamalı kadim şifreyi çöz, hazineyi büyüt ve Altın Kolye / Dedektif İpucu kazan! (Hainler gizlice sabote edebilir!)",
      () => this.enterTablePhase()
    );
  }

  private enterTablePhase() {
    this.readyPhasePlayers.clear();
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

    if (this.trialSabotageCount > 0) {
      this.broadcast("chat_msg", {
        senderId: "",
        senderNick: "⚠️ KÂHYA RAPORU",
        seat: 11,
        text: `Az önceki Bulmaca Sınavında ${this.trialSabotageCount} kişi düzeneği GİZLİCE SABOTE ETTİ!`,
        channel: "SİSTEM"
      });
    }

    // YUVALAK SOFRADA ZEKİ BOT TARTIŞMA DALGALARI (5 Dalga: Suçlama, Savunma, Yakınlık Barı!)
    const aliveBots = Array.from(this.state.players.values()).filter(
      (p) => this.aiControlledIds.has(p.id) && p.alive
    );
    const scheduleWave = (delayMs: number, wave: 1 | 2 | 3 | 4 | 5) => {
      this.clock.setTimeout(() => {
        if (this.state.phase !== "TABLE" || aliveBots.length === 0) return;
        const speaker = aliveBots[Math.floor(Math.random() * aliveBots.length)];
        if (!speaker.alive) return;
        const role = this.secretRoles.get(speaker.id) || "MISAFIR";
        const mem = this.botMemories.get(speaker.id) || createInitialBotMemory(speaker.seat);
        const line = generateTableDebateLine({
          speakerSeat: speaker.seat,
          speakerNick: speaker.nick,
          speakerRole: role,
          personality: mem.personality,
          mem,
          scapegoat: this.pickScapegoatForBot(speaker.id, role),
          topBond: this.getTopBondHighlight(),
          sabotageCount: this.trialSabotageCount,
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

    const factor = this.state.fastMode ? 0.35 : 1.0;
    scheduleWave(4000 * factor, 1);
    scheduleWave(18000 * factor, 2);
    scheduleWave(36000 * factor, 3);
    scheduleWave(56000 * factor, 4);
    scheduleWave(78000 * factor, 5);

    const sabMsg =
      this.trialSabotageCount > 0
        ? `⚠️ Sınavda ${this.trialSabotageCount} sabotaj tespit edildi! `
        : "";

    this.setPhase(
      "TABLE",
      SOFRA_CONFIG.DURATIONS.TABLE,
      `${sabMsg}Yuvarlak Sofra Tartışması · '👉 Suçla' ile gerekçeni söyle, '🔍 İncele' ile kimin kiminle fısıldaştığını ortaya dök!`,
      () => this.enterVotePhase([])
    );
  }

  private enterVotePhase(tieCandidates: string[]) {
    this.votes.clear();
    this.tieCandidates = tieCandidates;
    this.state.players.forEach((p) => {
      p.votedForId = "";
    });

    // Akıllı Botlar kademeli ve rol-tutarlı oy verir (Hain ortağını korur!)
    const aliveIds = this.getAlivePlayerIds();
    const pool = tieCandidates.length > 0 ? tieCandidates : aliveIds;

    this.state.players.forEach((bot) => {
      if (!this.aiControlledIds.has(bot.id) || !bot.alive) return;
      const delay = 1800 + Math.random() * (this.state.fastMode ? 3000 : 6500);
      this.clock.setTimeout(() => {
        if (this.state.phase !== "VOTE" || !bot.alive) return;
        const bRole = this.secretRoles.get(bot.id) || "MISAFIR";
        let choices = pool.filter((id) => id !== bot.id && this.state.players.get(id)?.alive);
        if (bRole === "HAIN") {
          const nonTraitors = choices.filter((id) => this.secretRoles.get(id) !== "HAIN");
          if (nonTraitors.length > 0) choices = nonTraitors;
        }
        if (choices.length > 0) {
          const mem = this.botMemories.get(bot.id);
          const promised =
            mem?.promisedVoteTargetId && choices.includes(mem.promisedVoteTargetId)
              ? mem.promisedVoteTargetId
              : undefined;
          const pick = promised || choices[Math.floor(Math.random() * choices.length)];
          if (mem) mem.promisedVoteTargetId = undefined;
          this.votes.set(bot.id, pick);
          bot.votedForId = pick;
          this.checkIfAllVoted();
        }
      }, delay);
    });

    const dur = tieCandidates.length > 0 ? SOFRA_CONFIG.DURATIONS.TIE_VOTE : SOFRA_CONFIG.DURATIONS.VOTE;
    const msg =
      tieCandidates.length > 0
        ? "Kâhya: 'Oylar eşit çıktı! Eşit kalanlar arasında son 15 saniyelik ikinci oylama!'"
        : "Kâhya: 'Şimdi mühürlerinizi basın. Kimin zarfı şömineye atılacak?'";

    this.setPhase("VOTE", dur, msg, () => this.resolveVotePhase());
  }

  private checkIfAllVoted() {
    if (this.state.phase !== "VOTE") return;
    const activeVoters: string[] = [];
    this.state.players.forEach((p) => {
      if (p.alive && !p.ghost && (this.aiControlledIds.has(p.id) || p.connected)) {
        activeVoters.push(p.id);
      }
    });
    if (activeVoters.length > 0 && activeVoters.every((id) => this.votes.has(id))) {
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

    const aliveHumanTraitors = this.getAliveConnectedHumanIds().filter(
      (id) => this.secretRoles.get(id) === "HAIN"
    );

    this.clock.setTimeout(() => {
      if (this.state.phase !== "NIGHT") return;
      const aliveGuests = this.getAlivePlayerIds().filter(
        (id) => this.secretRoles.get(id) === "MISAFIR" && id !== this.state.necklaceHolder
      );
      const fallbackGuests = this.getAlivePlayerIds().filter((id) => this.secretRoles.get(id) === "MISAFIR");
      const targetPool = aliveGuests.length > 0 ? aliveGuests : fallbackGuests;

      this.state.players.forEach((bot) => {
        if (!this.aiControlledIds.has(bot.id) || !bot.alive) return;
        if (this.secretRoles.get(bot.id) === "HAIN" && targetPool.length > 0) {
          const pick = targetPool[Math.floor(Math.random() * targetPool.length)];
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

      // Eğer canlı Hainlerin tamamı botsa, oyuncuları 2 dakika bekletmemek için 14 sn gerilimli mola sonrası infazı gerçekleştir!
      if (aliveHumanTraitors.length === 0) {
        if (this.phaseTimer) this.phaseTimer.clear();
        const botNightMs = this.state.fastMode ? 7000 : 14000;
        this.state.phaseEndsAt = Date.now() + botNightMs;
        this.phaseTimer = this.clock.setTimeout(() => this.enterMorningPhase(), botNightMs);
      }
    }, 2600);

    this.setPhase(
      "NIGHT",
      SOFRA_CONFIG.DURATIONS.NIGHT,
      "🌑 2 DAKİKA GECE MOLASI · Kapılar kilitlendi! Hainler kulede gizli toplantı yapıyor ve bu gecenin İNFAZ kararını veriyor...",
      () => this.enterMorningPhase()
    );
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

  private enterFinalPhase() {
    this.finalDecisions.clear();
    this.clock.setTimeout(() => {
      if (this.state.phase !== "FINAL") return;
      this.state.players.forEach((bot) => {
        if (!this.aiControlledIds.has(bot.id) || !bot.alive) return;
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
    this.state.phaseEndsAt = Date.now() + 18000;
    this.state.announcement =
      winner === "HAIN"
        ? "🔥 HAİNLER KAZANDI! 18 sn içinde yeni sofra otomatik kurulacak..."
        : "✨ MİSAFİRLER KAZANDI! 18 sn içinde yeni sofra otomatik kurulacak...";

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

      const token = this.sessionToToken.get(p.id);
      if (token && token.startsWith("acc_")) {
        const won = pRole === winner;
        accountStore.recordMatchResult(token, won);
        const c = this.clients.find((cl) => cl.sessionId === p.id);
        c?.send("match_reward", { bonusGold: won ? 30 : 10, won });
      }
    });

    this.broadcast("game_over_roles", {
      winner,
      roles: revealedRoles,
      chronicle: this.chronicleLog
    });

    // 18 sn sonra otomatik yeni tura lobiye dön!
    this.phaseTimer = this.clock.setTimeout(() => {
      if (this.clients.length === 0) {
        this.disconnect();
        return;
      }
      this.resetToLobby();
    }, 18000);
  }

  private resetToLobby() {
    if (this.phaseTimer) this.phaseTimer.clear();
    this.state.phase = "LOBBY";
    this.state.winnerTeam = "";
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
    });
    if (this.state.autoStart) {
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
      const resolved = resolveCastleCollision(nx, nz, openDoors, 0.42, {
        seat: bot.seat,
        currentRoomId: bot.roomId,
        lockedDoors
      });

      if (resolved.hit) {
        const wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
        brain.targetX = wp.x;
        brain.targetZ = wp.z;
      } else {
        bot.x = resolved.x;
        bot.z = resolved.z;
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

    // Değilse genel yakın sohbete atmosferik bir cümle bırak!
    this.broadcast("chat_msg", {
      senderId: bot.id,
      senderNick: bot.nick,
      seat: bot.seat,
      text: `#${sc.seat} ${sc.nick} sabahtan beri hangi odada saklanıyor acaba?`,
      channel: "YAKIN"
    });
  }

  onDispose() {
    if (this.phaseTimer) this.phaseTimer.clear();
    if (this.autoLobbyTimer) this.autoLobbyTimer.clear();
    liveRooms.delete(this.roomId);
    if (this.state?.code) {
      activeRoomsByCode.delete(this.state.code);
    }
  }
}
