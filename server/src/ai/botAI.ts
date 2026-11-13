import { PlayerRole } from "@sofra/shared";
import { MASTER_RIDDLE_BANK, RawRiddleEntry } from "./riddleBank.js";

export type BotPersonality = "FITNECI" | "SAKIN" | "AGRESIF";

export type ChatIntent =
  | "GREETING"
  | "COME_HERE"
  | "MENTIONED_PLAYER"
  | "WHO_IS_TRAITOR"
  | "VOTE_TARGET"
  | "WHERE_WERE_YOU"
  | "ARE_YOU_INNOCENT"
  | "PUZZLE_CLUE"
  | "ALLIANCE_OFFER"
  | "ACCUSE_ME"
  | "WHY_QUESTION"
  | "AGREEMENT"
  | "DISAGREEMENT"
  | "THANKS"
  | "LAUGH_BANTER"
  | "GENERIC";

export interface BotSighting {
  seat: number;
  nick: string;
  roomName: string;
  round: number;
  ts: number;
}

export interface CaughtLieRecord {
  seat: number;
  nick: string;
  claimedRoom: string;
  actualSeenRoom: string;
  round: number;
}

export interface BotMemory {
  personality: BotPersonality;
  realLastRoom: string;
  fakeAlibiRoom: string;
  lastSeenSeat: number;
  lastSeenNick: string;
  lastSeenRoom: string;
  recentReplies: string[];
  playerDialogueCount: Record<string, number>;
  sightings: Record<number, BotSighting>;
  claimedRooms: Record<number, { seat: number; nick: string; claimedRoom: string; round: number; ts: number }>;
  caughtLies: CaughtLieRecord[];
  suspicionBySeat: Record<number, number>;
  lastRoundFlameInsight?: string;
  lastAccusedSeat?: number;
  lastAccusedNick?: string;
  followTargetId?: string;
  followUntil?: number;
  promisedVoteTargetId?: string;
}

export interface BondHighlight {
  seatA: number;
  nickA: string;
  seatB: number;
  nickB: string;
  score: number;
}

export interface RoomPlayerBrief {
  id: string;
  seat: number;
  nick: string;
  charName: string;
  alive: boolean;
  roomName?: string;
  role?: PlayerRole;
  bondWithBot?: number;
}

const FAKE_ALIBI_ROOMS = [
  "Konsey & Harita Salonu",
  "Rün & Bulmaca Salonu",
  "Saat Kulesi",
  "Kargalı Avlu & Dilek Kuyusu",
  "Şato Kütüphanesi & Arşiv",
  "Simya & İksir Mahzeni",
  "Şövalye Cephaneliği"
];

const NATURAL_GAMER_NICKS = [
  "Emre",
  "Zeynep",
  "Mert",
  "Elif",
  "Kaan",
  "Selin",
  "Burak",
  "Ece",
  "Arda",
  "Deniz",
  "Kerem",
  "Melis",
  "Caner",
  "Defne",
  "Tolga",
  "İrem",
  "Oğuz",
  "Buse",
  "Eren",
  "Yağmur",
  "Tuna",
  "Aslı",
  "Alp",
  "Damla",
  "Onur",
  "Ege",
  "Nisan",
  "Cem",
  "Duru",
  "Barış",
  "Berk",
  "Sude"
];

const NATURAL_COAT_COLORS = [
  "#1e2430",
  "#4a1525",
  "#1b3b2b",
  "#2a2145",
  "#3d2b1f",
  "#18324a",
  "#4f2d18",
  "#2f3640"
];

const NATURAL_HATS = ["none", "none", "knight", "hood", "noble", "fedora", "wizard", "bun"];
const NATURAL_MASKS = ["none", "none", "none", "glasses", "beard", "ironmask"];

export function pickNaturalBotIdentity(
  usedNicks: Set<string>,
  seat: number
): { nick: string; coatColor: string; hat: string; mask: string } {
  const lowerUsed = new Set(Array.from(usedNicks).map((u) => u.toLocaleLowerCase("tr-TR")));
  const available = NATURAL_GAMER_NICKS.filter((n) => !lowerUsed.has(n.toLocaleLowerCase("tr-TR")));
  const pool = available.length > 0 ? available : NATURAL_GAMER_NICKS;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return {
    nick: chosen,
    coatColor: NATURAL_COAT_COLORS[(seat + Math.floor(Math.random() * NATURAL_COAT_COLORS.length)) % NATURAL_COAT_COLORS.length],
    hat: NATURAL_HATS[Math.floor(Math.random() * NATURAL_HATS.length)],
    mask: NATURAL_MASKS[Math.floor(Math.random() * NATURAL_MASKS.length)]
  };
}

export function pickLobbyGreetingLine(newcomerNick: string): string {
  const lines = [
    `hg ${newcomerNick}, birkaç kişi daha gelsin başlıyoruz`,
    `selam ${newcomerNick} hoş geldin :)`,
    `oo ${newcomerNick} geldi, az kaldı doluyor masa`,
    `merhaba ${newcomerNick}, koltuğunu seç birazdan başlar`,
    `hg ${newcomerNick}! sonunda doluyor oda`
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

export function pickLobbyArrivalLine(): string {
  const lines = [
    "selam millet",
    "sa herkese",
    "merhabalar, hazırım ben",
    "selamlar, hızlı el mi bu?",
    "hg herkese bakalım kim hain çıkacak"
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

export function getPersonalityForSeat(seat: number): BotPersonality {
  if ([1, 7, 9, 12].includes(seat)) return "FITNECI";
  if ([3, 6, 10].includes(seat)) return "AGRESIF";
  return "SAKIN";
}

export function createInitialBotMemory(seat: number): BotMemory {
  return {
    personality: getPersonalityForSeat(seat),
    realLastRoom: "Antre / Giriş Holü",
    fakeAlibiRoom: FAKE_ALIBI_ROOMS[seat % FAKE_ALIBI_ROOMS.length],
    lastSeenSeat: 0,
    lastSeenNick: "",
    lastSeenRoom: "",
    recentReplies: [],
    playerDialogueCount: {},
    sightings: {},
    claimedRooms: {},
    caughtLies: [],
    suspicionBySeat: {}
  };
}

export function adjustBotSuspicion(mem: BotMemory, seat: number, delta: number): void {
  if (!seat || seat === 11) return;
  const cur = mem.suspicionBySeat[seat] || 0;
  mem.suspicionBySeat[seat] = Math.max(-45, Math.min(100, cur + delta));
}

export function recordBotSighting(
  mem: BotMemory,
  otherSeat: number,
  otherNick: string,
  roomName: string,
  round: number
): void {
  if (!otherSeat || !roomName) return;
  mem.lastSeenSeat = otherSeat;
  mem.lastSeenNick = otherNick;
  mem.lastSeenRoom = roomName;
  mem.sightings[otherSeat] = {
    seat: otherSeat,
    nick: otherNick,
    roomName,
    round,
    ts: Date.now()
  };
}

const ROOM_KEYWORDS_TR: Array<{ rx: RegExp; canonical: string }> = [
  { rx: /\b(kutuphane|arsiv)/, canonical: "Şato Kütüphanesi & Arşiv" },
  { rx: /\b(simya|iksir|mahzen)/, canonical: "Simya & İksir Mahzeni" },
  { rx: /\b(cephanelik|zinh|zirh|silah)/, canonical: "Şövalye Cephaneliği" },
  { rx: /\b(zindan|hucre|zincir)/, canonical: "Kuzeydoğu Zindanı" },
  { rx: /\b(avlu|kuyu|kargali avlu)/, canonical: "Kargalı Avlu & Dilek Kuyusu" },
  { rx: /\b(konsey|toplanti|tahta|harita salon)/, canonical: "Konsey & Harita Salonu" },
  { rx: /\b(run|bulmaca|etkinlik salon|kursu)/, canonical: "Rün & Bulmaca Salonu" },
  { rx: /\b(saat kule)/, canonical: "Saat Kulesi" },
  { rx: /\b(mutfak|kiler)/, canonical: "Şato Mutfağı" },
  { rx: /\b(antre|giris hol)/, canonical: "Antre / Giriş Holü" }
];

export function extractClaimedRoomTR(rawText: string): string | null {
  const n = normalizeTurkish(rawText);
  // Yalnızca birinci tekil şahıs / yer bildirimi içeriyorsa alibi say ("kütüphanedeydim", "ben mutfaktayım" vb.)
  if (!/(ben\b|dim\b|dum\b|daydim|deydim|taydim|teydim|dayim|deyim|tayim|teyim|tarafinday|icindey|oraday)/.test(n)) {
    return null;
  }
  for (const item of ROOM_KEYWORDS_TR) {
    if (item.rx.test(n)) return item.canonical;
  }
  return null;
}

export function recordPlayerRoomClaimAndDetectLie(
  mem: BotMemory,
  speakerSeat: number,
  speakerNick: string,
  rawText: string,
  round: number,
  botSeat: number
): { caughtLie: boolean; actualRoom?: string; claimedRoom?: string } {
  if (!speakerSeat || speakerSeat === botSeat) return { caughtLie: false };
  const claimed = extractClaimedRoomTR(rawText);
  if (!claimed) return { caughtLie: false };

  const now = Date.now();
  mem.claimedRooms[speakerSeat] = {
    seat: speakerSeat,
    nick: speakerNick,
    claimedRoom: claimed,
    round,
    ts: now
  };

  const seen = mem.sightings[speakerSeat];
  if (
    seen &&
    seen.round === round &&
    now - seen.ts <= 65000 &&
    normalizeTurkish(seen.roomName).slice(0, 7) !== normalizeTurkish(claimed).slice(0, 7)
  ) {
    const already = mem.caughtLies.some((l) => l.seat === speakerSeat && l.round === round);
    if (!already) {
      mem.caughtLies.push({
        seat: speakerSeat,
        nick: speakerNick,
        claimedRoom: claimed,
        actualSeenRoom: seen.roomName,
        round
      });
    }
    adjustBotSuspicion(mem, speakerSeat, 45);
    return { caughtLie: true, actualRoom: seen.roomName, claimedRoom: claimed };
  }

  return { caughtLie: false, claimedRoom: claimed };
}

/**
 * Türkçe büyük/küçük harf, şapkalı/noktalı harf ve bitişik yazım hatalarını ("SANAHAINI" -> "sanahaini")
 * kusursuz yakalamak için normalize eder.
 */
export function normalizeTurkish(raw: string): string {
  return raw
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

function pickUniqueLine(mem: BotMemory, candidates: string[]): string {
  if (candidates.length === 0) return "...";
  const unused = candidates.filter((c) => !mem.recentReplies.includes(c));
  const pool = unused.length > 0 ? unused : candidates;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  mem.recentReplies.push(chosen);
  if (mem.recentReplies.length > 10) {
    mem.recentReplies.shift();
  }
  return chosen;
}

function findMentionedOtherPlayer(
  normText: string,
  botId: string,
  askerId: string,
  players?: RoomPlayerBrief[]
): RoomPlayerBrief | undefined {
  if (!players || players.length === 0) return undefined;

  // Önce #koltuk veya "3 numara" gibi açık koltuk referansı ara
  const seatMatch = normText.match(/#(\d{1,2})\b|(\d{1,2})\s*(numara|koltuk|sandalye)/);
  if (seatMatch) {
    const num = Number(seatMatch[1] || seatMatch[2]);
    const bySeat = players.find((p) => p.seat === num && p.id !== botId);
    if (bySeat) return bySeat;
  }

  for (const p of players) {
    if (p.id === botId || p.id === askerId) continue;
    const cleanNick = normalizeTurkish(p.nick.split("(")[0]).trim();
    const cleanChar = normalizeTurkish(p.charName.split("(")[0]).trim();
    if (cleanNick.length >= 3 && normText.includes(cleanNick)) return p;
    if (cleanChar.length >= 3 && normText.includes(cleanChar)) return p;
  }
  return undefined;
}

export function classifyTurkishIntent(rawText: string, hasMentionedPlayer = false): ChatIntent {
  const n = normalizeTurkish(rawText);

  // 1. Yanıma gel / takip et / odaya gel komutu
  if (
    /(yanima gel|buraya gel|odama gel|benimle gel|takip et|pesimden gel|\bgel\b.*(oda|kapi|salon|yanim|bura))/.test(
      n
    ) ||
    n === "gel" ||
    n === "gel buraya"
  ) {
    return "COME_HERE";
  }

  // 2. Doğrudan bota suçlama
  if (
    /(sen hainsin|hainsin sen|kesin sensin|katil sensin|yalan soyluyorsun|yalan atma|iftira atma|senden suphe|seni yakacagim|sana oy ver)/.test(
      n
    )
  ) {
    return "ACCUSE_ME";
  }

  // 3. Oy hedefi / şömine konuşması
  if (/(kime oy|kimi yak|kime bas|somineye|kimi atalim|oyun kime|oy verelim|zarfini yak|kimi eleyelim)/.test(n)) {
    return "VOTE_TARGET";
  }

  // 4. "Hain kim?", "Sana haini soracaktım", "Şüpheli var mı?" (Bitişik yazımları da yakalar!)
  if (
    /(hain|katil|supheli|suclu|fitne|sabotaj)/.test(n) &&
    /(kim|sor|sence|var mi|biliyor|tahmin|buldun|dusunuyor|hangisi|soyle)/.test(n)
  ) {
    return "WHO_IS_TRAITOR";
  }
  if (/(kim hain|hain kim|sence kim|kimden suphe|suphelendigin|sanahaini|haini sor)/.test(n)) {
    return "WHO_IS_TRAITOR";
  }

  // 5. Belirli bir oyuncunun adı geçtiyse ("Lale nasıl?", "Kemal temiz mi?")
  if (hasMentionedPlayer) {
    return "MENTIONED_PLAYER";
  }

  // 6. Neredeydin / Hangi oda / Ne yapıyorsun?
  if (/(neredeydin|nerdesin|neredeydi|nerede|hangi oda|ne yapiyor|napion|napiyon|nereye gittin|gorunmedin)/.test(n)) {
    return "WHERE_WERE_YOU";
  }

  // 7. Masum musun / Rolün ne?
  if (/(masum musun|hain misin|rolun ne|nesin sen|guvenebilir miyim|dogruyu soyle|yemin et|temiz misin)/.test(n)) {
    return "ARE_YOU_INNOCENT";
  }

  // 8. Bulmaca / İpucu / Altın Kolye / Anahtar
  if (/(ipucu|bulmaca|pusula|kolye|etkinlik|kursu|anahtar|sinav)/.test(n)) {
    return "PUZZLE_CLUE";
  }

  // 9. İttifak / Dostluk / Güven teklifi
  if (/(ittifak|beraber|dost|arkadas|koru beni|guven bana|sirdas|ortak olalim|birlikte)/.test(n)) {
    return "ALLIANCE_OFFER";
  }

  // 10. Neden / Niye / Kanıtın ne?
  if (/(\bneden\b|\bniye\b|ne alaka|kanit|emin misin|nereden biliyor|nasil yani)/.test(n)) {
    return "WHY_QUESTION";
  }

  // 11. Selamlaşma / Hal hatır ("MERHABA", "selam", "naber", "nasılsın", "sa")
  if (
    /^(\bmerhaba\b|\bselam\b|\bslm\b|\bsa\b|\bhey\b|\bhi\b|\balo\b|\bnaber\b|\bnasilsin\b|\biyi misin\b|merhabalar|selamun aleykum)/.test(
      n
    ) ||
    /(\bnaber\b|\bnasilsin\b|keyifler nasil)/.test(n)
  ) {
    return "GREETING";
  }

  // 12. Onaylama ("tamam", "olur", "haklısın", "aynen")
  if (/^(tamam|tmm|ok|olur|evet|aynen|haklisin|mantikli|anlastik|super|harika|dogru)\b/.test(n)) {
    return "AGREEMENT";
  }

  // 13. İtiraz ("yok", "hayır", "sanmam", "bence değil")
  if (/^(hayir|yok\b|bence degil|sanmam|yanlis|sacmalama|imkansiz)/.test(n)) {
    return "DISAGREEMENT";
  }

  // 14. Teşekkür / Veda
  if (/(tesekkur|sagol|sag ol|eyvallah|eyv|gorusuruz)/.test(n)) {
    return "THANKS";
  }

  // 15. Gülme / Samimi hitap
  if (/(haha|ahaha|sjsj|kanka|knk|reis|kral|usta|bro)/.test(n)) {
    return "LAUGH_BANTER";
  }

  return "GENERIC";
}

export interface BotReplyResult {
  text: string;
  followAsker?: boolean;
  persuadedVoteTargetId?: string;
}

export function generateBotReplyDetailed(params: {
  botId?: string;
  botSeat: number;
  botNick: string;
  botRole: PlayerRole;
  mem: BotMemory;
  askerId?: string;
  askerNick: string;
  askerRole?: PlayerRole;
  rawQuestion: string;
  phase?: string;
  isPrivatePM?: boolean;
  bondWithAsker?: number;
  necklaceHolderNick?: string;
  sabotageCount?: number;
  scapegoat?: { id?: string; seat: number; nick: string };
  topBond?: BondHighlight | null;
  players?: RoomPlayerBrief[];
}): BotReplyResult {
  const {
    botId = "",
    botSeat,
    botRole,
    mem,
    askerId = "",
    askerNick,
    askerRole,
    rawQuestion,
    phase = "DAY",
    isPrivatePM = false,
    bondWithAsker = 0,
    necklaceHolderNick,
    sabotageCount = 0,
    scapegoat,
    topBond,
    players
  } = params;

  const norm = normalizeTurkish(rawQuestion);
  const turnKey = askerId || askerNick;
  mem.playerDialogueCount[turnKey] = (mem.playerDialogueCount[turnKey] || 0) + 1;
  const msgCount = mem.playerDialogueCount[turnKey];

  const mentioned = findMentionedOtherPlayer(norm, botId, askerId, players);
  const intent = classifyTurkishIntent(rawQuestion, Boolean(mentioned));

  const isTraitor = botRole === "HAIN";
  const bothTraitorsInSecret = isTraitor && askerRole === "HAIN" && isPrivatePM;
  const targetStr = scapegoat ? `#${scapegoat.seat} ${scapegoat.nick}` : "sessiz kalanlar";

  if (scapegoat) {
    mem.lastAccusedSeat = scapegoat.seat;
    mem.lastAccusedNick = scapegoat.nick;
  }

  // ÖZEL DURUM: İki Hain 1'e 1 Özel PM'den konuşuyorsa suç ortağı gibi gizli strateji kurar!
  if (bothTraitorsInSecret) {
    if (intent === "GREETING") {
      return {
        text: pickUniqueLine(mem, [
          `Şşşt ortak ${askerNick}! Çok dikkat çekmeyelim. Gündüz ayrı odalarda görünürüz, sofrada suçu ${targetStr} üstüne yıkarız!`,
          `Selam suç ortağım! İncele barımız çok yükselmesin diye uzaktan yazışmamız süper oldu. Hedefimiz ${targetStr} olsun mu?`
        ])
      };
    }
    if (intent === "COME_HERE") {
      return {
        text: `Geliyorum ortak ama çok yan yana durmayalım ki Yakınlık Barımız bizi ele vermesin!`,
        followAsker: phase === "DAY"
      };
    }
    if (intent === "WHO_IS_TRAITOR" || intent === "VOTE_TARGET" || intent === "MENTIONED_PLAYER") {
      const victim = mentioned && mentioned.role !== "HAIN" ? `#${mentioned.seat} ${mentioned.nick}` : targetStr;
      return {
        text: pickUniqueLine(mem, [
          `İkimiz zaten Hainiz ortak 😄 Sofrada masum ${victim} ismini hedef gösterelim, oyları ona toplayalım!`,
          `Bence bu akşam ${victim} zarfını şömineye attıralım! Gece toplantısında da en tehlikeli dedektifi infaz ederiz.`
        ]),
        persuadedVoteTargetId: mentioned && mentioned.role !== "HAIN" ? mentioned.id : scapegoat?.id
      };
    }
  }

  switch (intent) {
    case "GREETING": {
      if (phase === "VOTE" || phase === "TABLE") {
        return {
          text: pickUniqueLine(mem, [
            `Selam ${askerNick}! Sofrada ortam bayağı gerildi... Sence bu tur kimin zarfını şömineye atalım, var mı şüphelendiğin biri?`,
            `Merhaba ${askerNick}, tam zamanında yazdın! Gözüm ${targetStr} üzerinde, sen kimi şüpheli görüyorsun?`,
            `Selam ${askerNick}! Kâhya bizi izliyor, fısıltıyla sorayım: sence aramızdaki Hain kim?`
          ])
        };
      }
      if (isTraitor) {
        return {
          text: pickUniqueLine(mem, [
            `Selam ${askerNick}! Şato bugün çok tekinsiz, özellikle ${targetStr} koridorda tuhaf geziyor. Sen bir ipucu buldun mu?`,
            `Merhaba ${askerNick}! Ben de az önce ${mem.fakeAlibiRoom} tarafına baktım. Kiminle yakınlaştığına dikkat et!`
          ])
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `Merhaba ${askerNick}! Şu an ${mem.realLastRoom} tarafındayım, görevleri yapmaya çalışıyorum. Sen şüpheli bir şey gördün mü?`,
          `Selam ${askerNick}! İyi ki yazdın, tek başıma gezmekten çekiniyordum. Sence kim tekinsiz davranıyor?`,
          `Hey ${askerNick}, hoş geldin! İncele barlarına baktın mı, gizlice fısıldaşan bir ikili var mı?`
        ])
      };
    }

    case "COME_HERE": {
      if (phase !== "DAY") {
        return {
          text: `Şu an koltuklarımızdayız ${askerNick}, gündüz keşfi başlayınca hemen yanına gelirim!`
        };
      }
      if (isTraitor && mem.personality === "AGRESIF") {
        return {
          text: `Tamam ${askerNick}, yanına geliyorum ama kapıyı üstümüze kilitleme sakın!`,
          followAsker: true
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `Tamamdır ${askerNick}, olduğun yere doğru geliyorum, bekle beni!`,
          `Hemen geliyorum ${askerNick}! Beraber dolaşırsak Hainler bize kolay kolay bulaşamaz.`
        ]),
        followAsker: true
      };
    }

    case "MENTIONED_PLAYER": {
      const mp = mentioned!;
      const mpLabel = `#${mp.seat} ${mp.nick}`;
      const caughtOnMp = mem.caughtLies.find((l) => l.seat === mp.seat);
      const seenMp = mem.sightings[mp.seat];

      if (isTraitor) {
        // GÜVENLİK: Hain bot yabancıya konuşurken suç ortağını deterministik savunarak rol sızdırmaz!
        const canTargetForVote = mp.role !== "HAIN";
        if (caughtOnMp && canTargetForVote) {
          return {
            text: `Bak iyi yakaladın ${askerNick}; ${mpLabel} az önce ${caughtOnMp.claimedRoom} dedi ama ben onu ${caughtOnMp.actualSeenRoom} tarafında gördüm!`,
            persuadedVoteTargetId: mp.id
          };
        }
        return {
          text: pickUniqueLine(mem, [
            `Hmm, ${mpLabel} konusunda emin değilim ${askerNick}; koridorda biraz temkinli geziyordu ama asıl ${targetStr} tarafına da bakmak lazım.`,
            `${mpLabel} ismini masada sorgulayalım ${askerNick}, savunmasında açık verirse tepkisinden anlarız!`,
            `Açıkçası ${mpLabel} fısıltı barlarında dikkat çekebilir ${askerNick}, ama acele etmeyip sofrada sıkıştıralım.`
          ]),
          persuadedVoteTargetId: canTargetForVote && bondWithAsker >= 25 ? mp.id : undefined
        };
      }

      // Masum Misafir: Önce yalan yakaladıysa anında söyler!
      if (caughtOnMp) {
        return {
          text: `Bence kesin şüpheli ${askerNick}! ${mpLabel} az önce "${caughtOnMp.claimedRoom}" dedi ama ben onu kendi gözümle ${caughtOnMp.actualSeenRoom} içinde gördüm!`,
          persuadedVoteTargetId: mp.id
        };
      }

      // Masum Misafir yorumu
      if ((mp.bondWithBot || 0) >= 40 && (mem.suspicionBySeat[mp.seat] || 0) < 20) {
        return {
          text: `${mpLabel} ile gündüz bayağı konuştuk (%${Math.round(
            mp.bondWithBot || 40
          )} yakınlığımız var), bana samimi göründü ama yine de temkinliyim ${askerNick}.`
        };
      }
      if (seenMp) {
        return {
          text: `${mpLabel} az önce ${seenMp.roomName} içindeydi ${askerNick}. Çok açık bir hatasını görmedim ama sofrada sorgulayalım.`
        };
      }
      if (mem.lastSeenSeat === mp.seat) {
        return {
          text: `${mpLabel} az önce ${mem.lastSeenRoom} içindeydi ${askerNick}. Çok açık bir hatasını görmedim ama sofrada sorgulayalım.`
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `${mpLabel} hakkında kesin kanıtım yok ${askerNick}, ama sofrada savunmasını sıkıştıralım; açık verirse oylarız!`,
          `Hmm, ${mpLabel} biraz sessiz kaldı gibi... İstersen kime oy vereceğini yoklayalım, tepkisinden anlaşılır.`
        ]),
        persuadedVoteTargetId: bondWithAsker >= 25 ? mp.id : undefined
      };
    }

    case "WHO_IS_TRAITOR": {
      const latestLie = mem.caughtLies[mem.caughtLies.length - 1];
      if (!isTraitor && latestLie) {
        return {
          text: `Net söylüyorum ${askerNick}: #${latestLie.seat} ${latestLie.nick} yalan söyledi! "${latestLie.claimedRoom}" dedi ama ben onu ${latestLie.actualSeenRoom} içinde gördüm!`
        };
      }
      if (!isTraitor && mem.lastRoundFlameInsight) {
        return {
          text: `${mem.lastRoundFlameInsight} Bu yüzden gözüm ${targetStr} üzerinde ${askerNick}!`
        };
      }
      if (isTraitor) {
        if (mem.personality === "FITNECI" && scapegoat) {
          return {
            text: pickUniqueLine(mem, [
              `Aramızda kalsın ${askerNick}; Etkinlik Salonu'nda ipucu yakaladım, ibre doğrudan ${targetStr} tarafını gösteriyor!`,
              `Bana sorarsan Hain kesinlikle ${targetStr}! Hem görev yapmıyor hem de fısıltıyla kulis çeviriyor.`,
              `Sana açık konuşayım ${askerNick}: ${targetStr} az önce kilitli odaların önünde bekliyordu, hiç tekin değil!`
            ])
          };
        }
        if (topBond && topBond.score >= 40) {
          return {
            text: `İncele ekranına baktın mı ${askerNick}? #${topBond.seatA} ${topBond.nickA} ile #${topBond.seatB} ${topBond.nickB} %${Math.round(
              topBond.score
            )} yakınlaşmış! Kesin aralarında Hain var!`
          };
        }
        return {
          text: pickUniqueLine(mem, [
            `Bence en şüpheli isim şu an ${targetStr} ${askerNick}. Sofrada ağzını arayalım, kesin renk verecek!`,
            `İçime hiç sinmeyen kişi ${targetStr}. Hareketleri çok hesaplı, sen ne dersin?`
          ])
        };
      }

      // Misafir gerçek gözlemlerini paylaşır
      if (sabotageCount > 0) {
        return {
          text: `Bulmaca Sınavında ${sabotageCount} sabotaj çıktı ${askerNick}! Gözüm şu an ${targetStr} üzerinde, sofrada neredeydi soralım.`
        };
      }
      if (topBond && topBond.score >= 45) {
        return {
          text: `Bence İncele barı en büyük kanıt ${askerNick}: #${topBond.seatA} ${topBond.nickA} ile #${topBond.seatB} ${topBond.nickB} %${Math.round(
            topBond.score
          )} fısıldaşmış! İkisinden biri Hain çıkabilir.`
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `Henüz %100 kanıtım yok ${askerNick}, ama ${targetStr} bana en şüpheli kişi gibi geldi. Senin aklında kim var?`,
          `Ben #${botSeat} olarak gündüz ${mem.realLastRoom} gezdim; en sinsi duran ${targetStr} gibi, biraz daha sıkıştıralım.`
        ])
      };
    }

    case "VOTE_TARGET": {
      if (mentioned && (!isTraitor || mentioned.role !== "HAIN")) {
        return {
          text: `Tamam ${askerNick}, madem #${mentioned.seat} ${mentioned.nick} diyorsun, ben de bu tur oyumu ondan yana değerlendireceğim!`,
          persuadedVoteTargetId: mentioned.id
        };
      }
      if (isTraitor) {
        return {
          text: pickUniqueLine(mem, [
            `Ben mührümü ${targetStr} için basacağım ${askerNick}. Oyları bölmeyelim, birlikte hareket edelim!`,
            `Bence hiç riske girmeyip ${targetStr} zarfını şömineye atalım, ne dersin?`
          ])
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `Şu an oyum ${targetStr} tarafına yakın ${askerNick}, ama daha güçlü bir kanıtın varsa ismini söyle beraber basalım!`,
          `Beyaz alev yakmamak için dikkatli olmalıyız; şu an en mantıklı aday ${targetStr} görünüyor.`
        ])
      };
    }

    case "WHERE_WERE_YOU": {
      if (isTraitor) {
        return {
          text: pickUniqueLine(mem, [
            `Az önce ${mem.fakeAlibiRoom} içindeydim ${askerNick}, kürsüdeki şifreye bakıyordum! Asıl ${targetStr} ortalıkta yoktu.`,
            `Ben ${mem.fakeAlibiRoom} koridorundaydım ${askerNick}. İstersen beraber gezelim, gizlim saklım yok!`
          ])
        };
      }
      if (mem.lastSeenNick) {
        return {
          text: `Az önce ${mem.realLastRoom} içindeydim ${askerNick}; hatta orada #${mem.lastSeenSeat} ${mem.lastSeenNick} da vardı, şahidimdir!`
        };
      }
      return {
        text: `Ben ${mem.realLastRoom} tarafında görev peşindeydim ${askerNick}, kendi odama da uğradım.`
      };
    }

    case "ARE_YOU_INNOCENT": {
      if (isTraitor) {
        return {
          text: pickUniqueLine(mem, [
            `Yemin ederim masum Misafirim ${askerNick}! Beni yakarsanız şömineden bembeyaz alev çıkar, Hainlere bayram ettirirsiniz!`,
            `Tabii ki Misafirim ${askerNick}! İncele barıma bak, gizli saklı hiçbir ittifakım yok; asıl ${targetStr} hedef şaşırtıyor.`
          ])
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `yüzde yüz masum Misafirim ${askerNick}! Beraber bulmaca çözüp Hainleri tek tek yakalayabiliriz.`,
          `Sonuna kadar Misafirim ${askerNick}, bana güvenebilirsin; tek derdim gece infaz edilmeden Hainleri bulmak!`
        ])
      };
    }

    case "PUZZLE_CLUE": {
      const neckInfo = necklaceHolderNick
        ? ` Şu an Altın Kolye ${necklaceHolderNick} boynunda parlıyor!`
        : "";
      if (isTraitor) {
        return {
          text: `Etkinlik Salonu'ndaki şifreye baktım ${askerNick}; bence ipuçları ${targetStr} tarafını işaret ediyor!${neckInfo}`
        };
      }
      return {
        text: `Etkinlik Salonu'ndaki kürsüler ve Şato Bulmaca Sınavı gerçek dedektif ipucu veriyor ${askerNick}!${neckInfo}`
      };
    }

    case "ALLIANCE_OFFER": {
      if (isTraitor) {
        return {
          text: pickUniqueLine(mem, [
            `Anlaştık ${askerNick}, sırt sırta verelim! Ama sürekli dip dibe gezmeyelim ki İncele'de Yakınlık Barımız tavan yapmasın.`,
            `Söz ${askerNick}, sofrada seni savunurum! Sen de bu tur ${targetStr} için bana destek ol, tamam mı?`
          ])
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `Tamamdır ${askerNick}, aramızdaki Yakınlık Barı zaten %${Math.round(
            bondWithAsker
          )} oldu! Birbirimizi kollayalım ama yalanını yakalarsam affetmem.`,
          `Olur ${askerNick}, bu şatoda güvenecek bir dosta ihtiyacım vardı! Şüpheli birini görürsen hemen DM at.`
        ])
      };
    }

    case "ACCUSE_ME": {
      if (isTraitor) {
        return {
          text: pickUniqueLine(mem, [
            `Ne Hainliği ${askerNick}?! Kanıtın olmadan üstüme geliyorsun, yoksa kendi rolünü gizlemek için mi bana saldırıyorsun?!`,
            `Çok büyük hata yapıyorsun ${askerNick}! Ben masumum, asıl ortalığı karıştıran ${targetStr}!`
          ])
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `Yapma ${askerNick}, ben gerçekten masumum! Beni şömineye atarsanız beyaz alev çıktığında çok pişman olursunuz!`,
          `Yanlış iz sürüyorsun ${askerNick}... Gel sakin düşünelim, Hainler şu an bizim kavga etmemize seviniyor!`
        ])
      };
    }

    case "WHY_QUESTION": {
      const latestLie = mem.caughtLies[mem.caughtLies.length - 1];
      if (!isTraitor && latestLie) {
        return {
          text: `Kanıtım net ${askerNick}: #${latestLie.seat} ${latestLie.nick} "${latestLie.claimedRoom}" dedi ama ben onu ${latestLie.actualSeenRoom} içinde bizzat gördüm!`
        };
      }
      if (!isTraitor && mem.lastRoundFlameInsight) {
        return {
          text: `Çünkü ${mem.lastRoundFlameInsight}`
        };
      }
      const who = mem.lastAccusedNick ? `#${mem.lastAccusedSeat} ${mem.lastAccusedNick}` : targetStr;
      if (isTraitor) {
        return {
          text: `Çünkü ${who} hem odalara gizlice girip çıkıyor hem de sofrada soruları geçiştiriyor ${askerNick}! Bence çok net.`
        };
      }
      return {
        text: `Çünkü ${who} gündüz boyunca görev yerlerinde görünmedi ${askerNick}, üstelik fısıltı trafiği çok tuhaf geldi.`
      };
    }

    case "AGREEMENT": {
      return {
        text: pickUniqueLine(mem, [
          `Süper, aynı fikirde olmamıza sevindim ${askerNick}! Sofrada sözleştiğimiz gibi hareket edelim.`,
          `Harika ${askerNick}, planımız aramızda kalsın; çan çaldığında hamlemizi yaparız!`
        ])
      };
    }

    case "DISAGREEMENT": {
      return {
        text: pickUniqueLine(mem, [
          `Hmm, öyle mi diyorsun ${askerNick}? Peki sence asıl şüpheli kim, kimi öneriyorsun?`,
          `Olabilir ${askerNick}, ben de yanılıyor olabilirim... O zaman senin şüphelendiğin ismi söyle, onu izleyelim!`
        ])
      };
    }

    case "THANKS": {
      return {
        text: pickUniqueLine(mem, [
          `Rica ederim ${askerNick}, dikkatli ol koridorlarda! Yeni bir ipucu bulursan yaz.`,
          `Ne demek ${askerNick}, her zaman! Gözün kolyede ve fısıltılarda olsun.`
        ])
      };
    }

    case "LAUGH_BANTER": {
      return {
        text: pickUniqueLine(mem, [
          `Vallahi şato iyice kurtlar sofrasına döndü ${askerNick} 😄 Bakalım bu gece kim sağ çıkacak!`,
          `Gülüyoruz ama birazdan şömine yanacak ${askerNick} 😅 Sence ilk kimi yakıyoruz?`
        ])
      };
    }

    default: {
      // Doğal, bağlama duyarlı (tur, konuşma sayısı, evre) akıllı sohbet cevabı — ASLA aynı cümleyi tekrarlamaz!
      if (msgCount === 1) {
        return {
          text: pickUniqueLine(mem, [
            `Dinliyorum ${askerNick}; ben az önce ${isTraitor ? mem.fakeAlibiRoom : mem.realLastRoom} tarafındaydım. Aklında belirli bir şüpheli var mı?`,
            `Haklı olabilirsin ${askerNick}... Şu an en çok ${targetStr} gözüme batıyor, istersen ismini yaz onun hakkında ne bildiğimi söyleyeyim!`
          ])
        };
      }
      return {
        text: pickUniqueLine(mem, [
          `Anladım ${askerNick}. İstersen bana şüphelendiğin kişinin adını veya koltuk numarasını yaz (#3 gibi), sana fikrimi net söyleyeyim!`,
          `Şu an ${phase === "DAY" ? "koridorları kolluyorum" : "sofradaki tepkileri ölçüyorum"} ${askerNick}; özellikle ${targetStr} ne yapacak merak ediyorum.`,
          `Bence İncele'deki Yakınlık Barları birazdan her şeyi çözecek ${askerNick}. Çok fısıldaşan ikiliye dikkat et!`,
          `Doğru diyorsun ${askerNick}, acele karar vermeyelim ama ${targetStr} savunma yaparken dikkatle dinleyelim.`
        ])
      };
    }
  }
}

export function generateBotReply(params: {
  botSeat: number;
  botNick: string;
  botRole: PlayerRole;
  mem: BotMemory;
  askerNick: string;
  rawQuestion: string;
  scapegoat?: { seat: number; nick: string };
  topBond?: BondHighlight | null;
}): string {
  return generateBotReplyDetailed(params).text;
}

// ============================================================================
// ÇİFT BEYİNLİ (DUAL-BRAIN) 0 TL MİKRO-TOKEN YAPAY ZEKA + YEREL YEDEK MOTORU
// ============================================================================
const providerCooldownUntil: Record<string, number> = {};

function isProviderReady(name: string): boolean {
  return (providerCooldownUntil[name] || 0) < Date.now();
}

function markProviderCooldown(name: string, ms = 45000): void {
  providerCooldownUntil[name] = Date.now() + ms;
}

function hasAnyLLMProviderConfigured(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OLLAMA_URL
  );
}

function sanitizeBotLLMOutput(
  rawText: string,
  botRole: PlayerRole,
  isSecretTraitorConclave: boolean,
  fallbackText: string
): string {
  const cleaned = rawText
    .replace(/^["'«»]+|["'«»]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 2) return fallbackText;
  const n = normalizeTurkish(cleaned);
  if (/(yapay zeka|dil modeli|llm|openai|gemini|botum ben)/.test(n)) {
    return fallbackText;
  }
  if (botRole === "HAIN" && !isSecretTraitorConclave) {
    if (/(ben hainim|hainim ben|evet hainim|suc ortagim|ikimiz hain)/.test(n)) {
      return fallbackText;
    }
  }
  return cleaned.slice(0, 185);
}

async function callFreeTierLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 80,
  timeoutMs = 1650
): Promise<string | null> {
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  const groqKey = (process.env.GROQ_API_KEY || "").trim();
  const openrouterKey = (process.env.OPENROUTER_API_KEY || "").trim();
  const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
  const ollamaUrl = (process.env.OLLAMA_URL || "").trim();

  const tryOpenAICompatible = async (
    providerName: string,
    endpoint: string,
    apiKey: string,
    model: string
  ): Promise<string | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.82
        }),
        signal: controller.signal
      });
      if (resp.status === 429 || resp.status >= 500) {
        markProviderCooldown(providerName, 45000);
        return null;
      }
      if (!resp.ok) return null;
      const json: any = await resp.json();
      return json?.choices?.[0]?.message?.content?.trim() || null;
    } catch {
      markProviderCooldown(providerName, 20000);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // 1) Google Gemini Ücretsiz Katman (gemini-2.5-flash-lite — ultra hızlı & 0 TL free tier)
  if (geminiKey && isProviderReady("gemini")) {
    const geminiModel = (process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.82 }
          }),
          signal: controller.signal
        }
      );
      if (resp.status === 429 || resp.status >= 500) {
        markProviderCooldown("gemini", 45000);
      } else if (resp.ok) {
        const json: any = await resp.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch {
      markProviderCooldown("gemini", 20000);
    } finally {
      clearTimeout(timer);
    }
  }

  // 2) Groq Ücretsiz Katman (llama-3.3-70b-versatile — ~200ms yanıt, 0 TL free tier)
  if (groqKey && isProviderReady("groq")) {
    const groqModel = (process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();
    const out = await tryOpenAICompatible(
      "groq",
      "https://api.groq.com/openai/v1/chat/completions",
      groqKey,
      groqModel
    );
    if (out) return out;
  }

  // 3) OpenRouter `:free` modelleri (0 TL)
  if (openrouterKey && isProviderReady("openrouter")) {
    const orModel = (process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free").trim();
    const out = await tryOpenAICompatible(
      "openrouter",
      "https://openrouter.ai/api/v1/chat/completions",
      openrouterKey,
      orModel
    );
    if (out) return out;
  }

  // 4) OpenAI (isteğe bağlı yedek)
  if (openaiKey && isProviderReady("openai")) {
    const out = await tryOpenAICompatible(
      "openai",
      "https://api.openai.com/v1/chat/completions",
      openaiKey,
      "gpt-4o-mini"
    );
    if (out) return out;
  }

  // 5) Yerel Ollama (100% çevrimdışı, sınırsız 0 TL)
  if (ollamaUrl && isProviderReady("ollama")) {
    const ollamaModel = (process.env.OLLAMA_MODEL || "gemma3:4b").trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          stream: false,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          options: { num_predict: maxTokens, temperature: 0.8 }
        }),
        signal: controller.signal
      });
      if (resp.ok) {
        const json: any = await resp.json();
        const text = json?.message?.content?.trim();
        if (text) return text;
      } else {
        markProviderCooldown("ollama", 30000);
      }
    } catch {
      markProviderCooldown("ollama", 30000);
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

/**
 * Çift Beyinli (Dual-Brain) Yanıt Üretici:
 * 1) Basit komutlarda ("gel", "tmm", "sağol") SIFIR token harcar, doğrudan yerel motoru döner.
 * 2) Ücretsiz LLM (Gemini Flash-Lite / Groq / OpenRouter Free / Ollama) varsa ~70 token ile insan gibi konuşur.
 * 3) Anahtar yoksa, kota dolarsa veya 1.65sn aşılırsa 0ms gecikmeyle Beyin-2 (Dedektif Hafıza Motoru) devreye girer!
 */
export async function generateSmartBotReplyAsync(
  params: Parameters<typeof generateBotReplyDetailed>[0]
): Promise<BotReplyResult> {
  const fallback = generateBotReplyDetailed(params);
  if (!hasAnyLLMProviderConfigured()) {
    return fallback;
  }

  const norm = normalizeTurkish(params.rawQuestion);
  const mentioned = findMentionedOtherPlayer(norm, params.botId || "", params.askerId || "", params.players);
  const intent = classifyTurkishIntent(params.rawQuestion, Boolean(mentioned));

  if (intent === "COME_HERE" || intent === "AGREEMENT" || intent === "THANKS") {
    return fallback;
  }

  const isSecretTraitorConclave = params.botRole === "HAIN" && params.askerRole === "HAIN" && Boolean(params.isPrivatePM);
  const latestLie = params.mem.caughtLies[params.mem.caughtLies.length - 1];
  const memoryFact =
    !isSecretTraitorConclave && params.botRole !== "HAIN" && latestLie
      ? `Yakaladığın yalan: #${latestLie.seat} ${latestLie.nick} "${latestLie.claimedRoom}" dedi ama onu ${latestLie.actualSeenRoom} içinde gördün.`
      : params.mem.lastRoundFlameInsight || "";

  const systemPrompt = `SOFRA 3D sosyal çıkarım oyununda gerçek bir Türk oyuncusun: #${params.botSeat} ${params.botNick}.
Rol: ${
    isSecretTraitorConclave
      ? "HAİN (Hain ortağınla gizli DM'desin)"
      : params.botRole === "HAIN"
      ? "HAİN (Asla itiraf etme, masum oyuncu gibi blöf yap)"
      : "MİSAFİR (Hainleri bulmaya çalış)"
  }. Oda: ${params.botRole === "HAIN" ? params.mem.fakeAlibiRoom : params.mem.realLastRoom}. Şüphelin: ${
    params.scapegoat ? `#${params.scapegoat.seat} ${params.scapegoat.nick}` : "yok"
  }. ${memoryFact}
${params.askerNick} sana yazdı (${params.phase || "DAY"}). Tek kısa, doğal Türkçe oyuncu cümlesi yaz (max 18 kelime). Yapay zeka/bot olduğunu asla söyleme.`;

  const llmText = await callFreeTierLLM(systemPrompt, params.rawQuestion, 75, 1650);
  if (llmText) {
    return {
      ...fallback,
      text: sanitizeBotLLMOutput(llmText, params.botRole, isSecretTraitorConclave, fallback.text)
    };
  }
  return fallback;
}

export function generateTableDebateLine(params: {
  speakerSeat: number;
  speakerNick: string;
  speakerRole: PlayerRole;
  personality: BotPersonality;
  mem: BotMemory;
  scapegoat?: { seat: number; nick: string };
  topBond?: BondHighlight | null;
  sabotageCount?: number;
  wave: 1 | 2 | 3 | 4 | 5;
}): string {
  const { speakerRole, personality, mem, scapegoat, topBond, sabotageCount = 0, wave } = params;
  const isTraitor = speakerRole === "HAIN";
  const target = scapegoat ? `#${scapegoat.seat} ${scapegoat.nick}` : "sessiz kalanlar";
  const latestLie = mem.caughtLies[mem.caughtLies.length - 1];

  if (!isTraitor && latestLie && (wave === 1 || wave === 3)) {
    return `Bir dakika! #${latestLie.seat} ${latestLie.nick} az önce "${latestLie.claimedRoom}" dedi ama ben onu kendi gözümle ${latestLie.actualSeenRoom} içinde gördüm!`;
  }

  if (!isTraitor && mem.lastRoundFlameInsight && wave === 2) {
    return `${mem.lastRoundFlameInsight} Bu yüzden bence sıradaki şüpheli ${target}!`;
  }

  if (wave === 1) {
    if (sabotageCount > 0) {
      return isTraitor
        ? `Az önceki Bulmaca Sınavında biri hazineyi sabote etti, bence bunu ${target} yaptı!`
        : `Arkadaşlar Bulmaca Sınavında ${sabotageCount} sabotaj çıktı! Herkes gündüz hangi odadaydı açıkça yazsın.`;
    }
    if (isTraitor) {
      return `Ben gündüz ${mem.fakeAlibiRoom} tarafındaydım ama ${target} koridorda çok tuhaf geziyordu.`;
    }
    if (mem.lastSeenNick) {
      return `Gündüz ${mem.realLastRoom} içinde #${mem.lastSeenSeat} ${mem.lastSeenNick} vardı; peki diğerleri neredeydi?`;
    }
    return `Herkes hangi odada olduğunu söylesin, ben ${mem.realLastRoom} içindeydim.`;
  }

  if (wave === 2 && topBond && topBond.score >= 30) {
    return `İncele tablosuna bakın, #${topBond.seatA} ${topBond.nickA} ile #${topBond.seatB} ${topBond.nickB} %${Math.round(
      topBond.score
    )} fısıldaşmış! Ne konuştunuz bu kadar?`;
  }

  if (wave === 3) {
    if (isTraitor) {
      return `Bence ${target} çok net renk veriyor, gündüz hiç görev yerinde görmedim onu.`;
    }
    return `Savunması zayıf kalan ${target} dikkatimi çekiyor, neden görev yaparken görünmedin?`;
  }

  if (wave === 4) {
    if (isTraitor) {
      return `Bana boşuna yüklenmeyin ben görevdeydim, asıl hedef şaşırtan ${target}!`;
    }
    return `Beyaz alev yakarsak gece Hainler birimizi daha indirir, kanıta göre oy verelim.`;
  }

  if (personality === "AGRESIF" || isTraitor) {
    return `Lafı uzatmayalım, benim oyum bu tur ${target} için! Oyları bölmeyelim.`;
  }
  return `Emin olmak zor ama bu tur ${target} hiç güven vermedi, oyumu ona atacağım.`;
}

export interface TableDebateSpeakerInput {
  id: string;
  seat: number;
  nick: string;
  role: PlayerRole;
  personality: BotPersonality;
  mem: BotMemory;
  scapegoat?: { seat: number; nick: string };
  wave: 1 | 2 | 3 | 4 | 5;
}

/**
 * Yuvarlak Sofra (VOTE) tartışmasında 4 konuşmacının repliğini TEK BİR mikro-JSON çağrısıyla üretir (~180 token).
 * Anahtar yoksa veya zaman aşımı olursa her konuşmacı için anında Beyin-2 (Dedektif Hafıza Motoru) devreye girer!
 */
export async function generateSmartTableDebateBatchAsync(
  speakers: TableDebateSpeakerInput[],
  context: { round: number; topBond?: BondHighlight | null; sabotageCount?: number }
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const sp of speakers) {
    result.set(
      sp.id,
      generateTableDebateLine({
        speakerSeat: sp.seat,
        speakerNick: sp.nick,
        speakerRole: sp.role,
        personality: sp.personality,
        mem: sp.mem,
        scapegoat: sp.scapegoat,
        topBond: context.topBond,
        sabotageCount: context.sabotageCount,
        wave: sp.wave
      })
    );
  }

  if (speakers.length === 0 || !hasAnyLLMProviderConfigured()) {
    return result;
  }

  const speakerLines = speakers
    .map((sp) => {
      const lie = sp.mem.caughtLies[sp.mem.caughtLies.length - 1];
      const obs =
        sp.role === "HAIN"
          ? `BLÖFÇÜ(masum gibi davran, sahte oda:${sp.mem.fakeAlibiRoom})`
          : lie
          ? `MİSAFİR(Yalan yakaladı: #${lie.seat} ${lie.nick} ${lie.claimedRoom} dedi ama ${lie.actualSeenRoom} görüldü)`
          : `MİSAFİR(oda:${sp.mem.realLastRoom})`;
      const target = sp.scapegoat ? `#${sp.scapegoat.seat} ${sp.scapegoat.nick}` : "belirsiz";
      return `seat=${sp.seat} nick=${sp.nick} tip=${obs} hedef=${target}`;
    })
    .join("\n");

  const sys = `SOFRA sosyal çıkarım oyununda Tur ${context.round} masa tartışması için her oyuncuya 1 kısa doğal Türkçe cümle (max 15 kelime) yaz. BLÖFÇÜ olanlar asla hain olduğunu söylemesin, hedefini suçlasın. Sadece saf JSON döndür: {"KOLTUK_NO":"cümle"}`;
  const raw = await callFreeTierLLM(sys, speakerLines, 210, 1750);
  if (!raw) return result;

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return result;
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;
    for (const sp of speakers) {
      const candidate = parsed[String(sp.seat)] || parsed[`#${sp.seat}`];
      if (typeof candidate === "string" && candidate.trim().length > 3) {
        const fallbackLine = result.get(sp.id)!;
        result.set(sp.id, sanitizeBotLLMOutput(candidate, sp.role, false, fallbackLine));
      }
    }
  } catch {
    // JSON ayrıştırma başarısız olursa Beyin-2 cümleleri zaten hazır
  }

  return result;
}

// ============================================================================
// BULMACA & ETKİNLİK SALONU ÜRETİCİSİ + GERÇEK DEDEKTİFLİK İPUCU MOTORU
// ============================================================================
export interface ActivePuzzleSession {
  puzzleId: string;
  kind: "RUNE" | "RIDDLE" | "CLOCK";
  title: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  expiresAt: number;
}

const shuffledDecks = new Map<string, number[]>();
const recentByPlayer = new Map<string, number[]>();

function refillShuffledDeck(deckKey: string, matchingIndices: number[]): number[] {
  const arr = [...matchingIndices];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  shuffledDecks.set(deckKey, arr);
  return arr;
}

function drawUniqueRiddle(
  kind: "RUNE" | "RIDDLE" | "CLOCK" | "ANY",
  historyKey = "global"
): { entry: RawRiddleEntry; bankIndex: number } {
  const matchingIndices: number[] = [];
  for (let i = 0; i < MASTER_RIDDLE_BANK.length; i++) {
    if (kind === "ANY" || MASTER_RIDDLE_BANK[i].kind === kind) {
      matchingIndices.push(i);
    }
  }

  let deck = shuffledDecks.get(kind);
  if (!deck || deck.length === 0) {
    deck = refillShuffledDeck(kind, matchingIndices);
  }

  const playerHist = recentByPlayer.get(historyKey) || [];
  let pickPos = -1;
  for (let i = deck.length - 1; i >= 0; i--) {
    if (!playerHist.includes(deck[i])) {
      pickPos = i;
      break;
    }
  }
  if (pickPos === -1) {
    pickPos = deck.length - 1;
  }

  const [bankIndex] = deck.splice(pickPos, 1);
  playerHist.push(bankIndex);
  while (playerHist.length > 160) {
    playerHist.shift();
  }
  recentByPlayer.set(historyKey, playerHist);
  if (recentByPlayer.size > 400) {
    const oldestKey = recentByPlayer.keys().next().value;
    if (oldestKey) recentByPlayer.delete(oldestKey);
  }

  return { entry: MASTER_RIDDLE_BANK[bankIndex], bankIndex };
}

export function getRiddleBankSize(): number {
  return MASTER_RIDDLE_BANK.length;
}

export function createPuzzleChallenge(
  kind: "RUNE" | "RIDDLE" | "CLOCK" | "ANY" = "ANY",
  historyKey = "global"
): ActivePuzzleSession {
  const { entry, bankIndex } = drawUniqueRiddle(kind, historyKey);
  const puzzleId = `pz_${bankIndex}_${Math.random().toString(36).slice(2, 8)}`;

  // Şıkların sırasını her seferinde rastgele karıştır (ezberi tamamen önler)
  const tagged = entry.opts.map((text, idx) => ({
    text,
    isCorrect: idx === entry.ans
  }));
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  const shuffledOptions = tagged.map((t) => t.text);
  const correctIndex = Math.max(
    0,
    tagged.findIndex((t) => t.isCorrect)
  );

  const titleByKind: Record<"RUNE" | "RIDDLE" | "CLOCK", string> = {
    RUNE: "🔮 Kadim Rün & Simya Kürsüsü",
    CLOCK: "🕰️ Şato Saati & Kasa Şifresi",
    RIDDLE: "📜 Kâhya'nın Büyük Bilmece Hazinesi"
  };

  return {
    puzzleId,
    kind: entry.kind,
    title: titleByKind[entry.kind],
    prompt: entry.q,
    options: shuffledOptions,
    correctIndex,
    expiresAt: Date.now() + 25000
  };
}

export function generateTrueDetectiveClue(
  solverId: string,
  alivePlayers: Array<{ id: string; seat: number; nick: string }>,
  roles: Map<string, PlayerRole>
): { clueText: string; grantedKahyaKey: boolean } {
  const others = alivePlayers.filter((p) => p.id !== solverId);
  const traitors = alivePlayers.filter((p) => roles.get(p.id) === "HAIN");

  const roll = Math.random();
  if (roll < 0.2 && traitors.length > 0) {
    const t = traitors[Math.floor(Math.random() * traitors.length)];
    const wing = t.seat <= 6 ? "Batı Kanadında (#1 - #6)" : "Doğu Kanadında (#7 - #12)";
    return {
      clueText: `🗝️ PASLI KÂHYA ANAHTARI KAZANDIN! (#11 Mühürlü Odaya girebilirsin!) + Pusula: Özel odası ${wing} olanlardan en az biri HAİN!`,
      grantedKahyaKey: true
    };
  }

  if (roll < 0.65 && others.length >= 2) {
    const shuffled = [...others].sort(() => Math.random() - 0.5);
    const a = shuffled[0];
    const b = shuffled[1];
    const sameTeam = roles.get(a.id) === roles.get(b.id);
    return {
      clueText: sameTeam
        ? `🕵️ Kâhya'nın Pusulası: Koltuk #${a.seat} (${a.nick}) ile Koltuk #${b.seat} (${b.nick}) AYNI TAKIMDA!`
        : `🕵️ Kâhya'nın Pusulası: Koltuk #${a.seat} (${a.nick}) ile Koltuk #${b.seat} (${b.nick}) FARKLI TAKIMDA! (Biri Hain, biri Misafir!)`,
      grantedKahyaKey: false
    };
  }

  if (traitors.length > 0) {
    const t = traitors[Math.floor(Math.random() * traitors.length)];
    const parity = t.seat % 2 === 1 ? "TEK numaralı (#1,#3,#5,#7,#9)" : "ÇİFT numaralı (#2,#4,#6,#8,#10,#12)";
    return {
      clueText: `🕵️ Kâhya'nın Pusulası: Şu an ${parity} sandalyelerde oturan en az 1 canlı HAİN var!`,
      grantedKahyaKey: false
    };
  }

  return {
    clueText: "🕵️ Kâhya'nın Pusulası: Sofradaki en sessiz gölgelere dikkat et!",
    grantedKahyaKey: false
  };
}

// ============================================================================
// KİŞİSEL GİZLİ GÖREV SİSTEMİ ("Bunla Yakınlaş, Bunla Konuş" + Şato Görevleri)
// ============================================================================
export interface PersonalQuest {
  id: string;
  kind: "SOCIAL_BOND" | "ROOM_OR_BOARD" | "DETECTIVE";
  title: string;
  description: string;
  targetId?: string;
  targetSeat?: number;
  targetNick?: string;
  progress: number;
  goal: number;
  rewardGold: number;
  done: boolean;
}

export function generateRoundQuests(params: {
  playerId: string;
  playerSeat: number;
  playerRole: PlayerRole;
  aliveOthers: Array<{ id: string; seat: number; nick: string }>;
}): PersonalQuest[] {
  const { playerSeat, playerRole, aliveOthers } = params;
  const socialTarget =
    aliveOthers.length > 0
      ? aliveOthers[Math.floor(Math.random() * aliveOthers.length)]
      : undefined;

  const q1: PersonalQuest = socialTarget
    ? {
        id: "q_social",
        kind: "SOCIAL_BOND",
        title: `🤝 #${socialTarget.seat} ${socialTarget.nick} İle Yakınlaş & Konuş`,
        description: `#${socialTarget.seat} ${socialTarget.nick} ile yan yana dur veya 1'e 1 Özel DM fısıldaşarak Yakınlık Barını %22 üstüne çıkar!`,
        targetId: socialTarget.id,
        targetSeat: socialTarget.seat,
        targetNick: socialTarget.nick,
        progress: 0,
        goal: 22,
        rewardGold: 25,
        done: false
      }
    : {
        id: "q_social",
        kind: "SOCIAL_BOND",
        title: "🤝 Koridorda Sohbet Başlat",
        description: "Gündüz sohbetten veya DM'den bir davetliye mesaj gönder.",
        progress: 0,
        goal: 1,
        rewardGold: 20,
        done: false
      };

  const q2: PersonalQuest =
    playerRole === "HAIN"
      ? {
          id: "q_room_board",
          kind: "ROOM_OR_BOARD",
          title: "🗡️ Hain Görevi: Konsey Tahtasında Hedef Şaşırt",
          description: `Toplantı Salonu'ndaki Konsey Tahtasına (📋) masum birini şüpheli yaz veya kendi özel odana (Oda #${playerSeat}) gir!`,
          progress: 0,
          goal: 1,
          rewardGold: 25,
          done: false
        }
      : {
          id: "q_room_board",
          kind: "ROOM_OR_BOARD",
          title: `🗝️ Özel Oda #${playerSeat} veya Konsey Tahtası`,
          description: `Cebindeki anahtarla kendi özel yatak odana (Oda #${playerSeat}) gir veya Konsey Tahtasına (📋) şüpheli yaz!`,
          progress: 0,
          goal: 1,
          rewardGold: 20,
          done: false
        };

  const q3: PersonalQuest = {
    id: "q_detective",
    kind: "DETECTIVE",
    title: "🏰 Orta Çağ Odalarını Keşfet & İncele",
    description: "Simya, Cephanelik, Kütüphane, Zindan veya Rün Kürsüsü etkileşimini kullan ya da 🔍 İncele yap!",
    progress: 0,
    goal: 1,
    rewardGold: 25,
    done: false
  };

  return [q1, q2, q3];
}

export function generateNightTraitorChatLine(params: {
  botNick: string;
  targetSeat: number;
  targetNick: string;
  necklaceSeat?: number;
}): string {
  const { targetSeat, targetNick, necklaceSeat } = params;
  const warn = necklaceSeat
    ? ` (Dikkat: #${necklaceSeat} üzerinde Altın Kolye var, ona dokunmayalım!)`
    : "";
  const lines = [
    `Ortak, kulede baş başayız! Bence bu gece #${targetSeat} ${targetNick} için infaz mührünü basalım!${warn}`,
    `Gündüz #${targetSeat} ${targetNick} çok fazla iz sürdü... İnfaz kararını ona veriyorum, sen de onayla!${warn}`,
    `Sessizce anlaşalım: #${targetSeat} ${targetNick} sabaha çıkmasın! Mühürleyelim mi?${warn}`
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
