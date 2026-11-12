import { PlayerRole } from "@sofra/shared";

export type BotPersonality = "FITNECI" | "SAKIN" | "AGRESIF";

export type ChatIntent =
  | "WHERE_WERE_YOU"
  | "WHO_IS_TRAITOR"
  | "VOTE_TARGET"
  | "ARE_YOU_INNOCENT"
  | "PUZZLE_CLUE"
  | "ALLIANCE_OFFER"
  | "ACCUSE_ME"
  | "GENERIC";

export interface BotMemory {
  personality: BotPersonality;
  realLastRoom: string;
  fakeAlibiRoom: string;
  lastSeenSeat: number;
  lastSeenNick: string;
  lastSeenRoom: string;
}

export interface BondHighlight {
  seatA: number;
  nickA: string;
  seatB: number;
  nickB: string;
  score: number;
}

const FAKE_ALIBI_ROOMS = [
  "Toplantı & Konsey Salonu",
  "Etkinlik & Bulmaca Salonu",
  "Saat Kulesi",
  "Kargalı Avlu"
];

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
    lastSeenRoom: ""
  };
}

export function classifyTurkishIntent(rawText: string): ChatIntent {
  const t = rawText.toLocaleLowerCase("tr-TR");
  if (/(neredeydin|nerdesin|neredeydi|hangi oda|ne yapıyordun|nereye gittin|görünmedin)/.test(t)) {
    return "WHERE_WERE_YOU";
  }
  if (/(kim hain|hain kim|şüpheli|kimden şüphe|sence kim|katil)/.test(t)) {
    return "WHO_IS_TRAITOR";
  }
  if (/(kime oy|kimi yakalım|kime basalım|şömineye kimi|oyun kime|kimi atalım)/.test(t)) {
    return "VOTE_TARGET";
  }
  if (/(masum musun|hain misin|rolün ne|nesin sen|güvenebilir miyim)/.test(t)) {
    return "ARE_YOU_INNOCENT";
  }
  if (/(ipucu|bulmaca|pusula|kolye|etkinlik)/.test(t)) {
    return "PUZZLE_CLUE";
  }
  if (/(ittifak|beraber|dost|koru beni|güven bana|sırdaş|ortak)/.test(t)) {
    return "ALLIANCE_OFFER";
  }
  if (/(sensin|sen hainsin|yalan|gördüm seni|iftira)/.test(t)) {
    return "ACCUSE_ME";
  }
  return "GENERIC";
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
  const { botRole, mem, askerNick, rawQuestion, scapegoat, topBond } = params;
  const intent = classifyTurkishIntent(rawQuestion);
  const isTraitor = botRole === "HAIN";
  const targetStr = scapegoat ? `#${scapegoat.seat} ${scapegoat.nick}` : "sessiz kalanlar";

  switch (intent) {
    case "WHERE_WERE_YOU": {
      if (isTraitor) {
        // HAİN YALAN ATAR VE HEDEF ŞAŞIRTIR!
        if (mem.personality === "FITNECI" && scapegoat) {
          return `Yemin ederim az önce ${mem.fakeAlibiRoom} içindeydim ${askerNick}! Ama gelirken ${targetStr} karanlık koridorda kapıları kurcalıyordu!`;
        }
        return `Ben ${mem.fakeAlibiRoom} tarafındaydım, tek başıma ipucu aradım. Benden şüphelenmenize gerek yok.`;
      }
      // MİSAFİR GERÇEĞİ SÖYLER
      if (mem.lastSeenNick) {
        return `Az önce ${mem.realLastRoom} içindeydim; hatta orada #${mem.lastSeenSeat} ${mem.lastSeenNick} ile karşılaştık, sorabilirsin!`;
      }
      return `Ben ${mem.realLastRoom} tarafındaydım ${askerNick}, saklayacak hiçbir şeyim yok.`;
    }

    case "WHO_IS_TRAITOR":
    case "VOTE_TARGET": {
      if (isTraitor) {
        // HAİN FİTNE ÇIKARIR VEYA SAHTE BULMACA BLÖFÜ YAPAR!
        if (mem.personality === "FITNECI" && scapegoat) {
          return `Etkinlik Salonu'nda bulmaca çözdüm; Kâhya'nın pusulası ${targetStr} tarafını işaret etti! Bence bu akşam ${targetStr} zarfını yakalım!`;
        }
        if (topBond && topBond.score >= 45) {
          return `İncele kartına baktınız mı? #${topBond.seatA} ${topBond.nickA} ile #${topBond.seatB} ${topBond.nickB} %${Math.round(
            topBond.score
          )} yakınlık yapmış! Kesin gizli iş çeviriyorlar, oyum ${targetStr}!`;
        }
        return `Bence en tekinsiz kişi ${targetStr}. Sofrada oyları bölmeyelim, ona basalım!`;
      }

      // MİSAFİR ANALİZ YAPAR
      if (topBond && topBond.score >= 50) {
        return `Dikkat ettiniz mi, #${topBond.seatA} ${topBond.nickA} ile #${topBond.seatB} ${topBond.nickB} sürekli fısıldaşıyor (%${Math.round(
          topBond.score
        )} Yakınlık)! İkisinden biri kesin Hain olabilir.`;
      }
      return `Gözüm ${targetStr} üzerinde ${askerNick}. Hareketleri hiç doğal gelmedi, sofrada sorgulayalım.`;
    }

    case "ARE_YOU_INNOCENT": {
      if (isTraitor) {
        return `Elbette masum Misafirim ${askerNick}! İncele kartıma bakabilirsin, asıl bizi birbirimize düşüren ${targetStr}!`;
      }
      return `Sonuna kadar masum Misafirim! Zarfımı şömineye atarsanız beyaz alev çıktığında Hainlerin ekmeğine yağ sürersiniz!`;
    }

    case "PUZZLE_CLUE": {
      if (isTraitor) {
        return `Bulmaca Salonu'ndaki şifreyi denedim; bence Hain kesinlikle ${targetStr} tarafında saklanıyor!`;
      }
      return `Etkinlik & Bulmaca Salonu'ndaki kürsüleri çözen Altın Kolye ve gerçek ipucu kazanıyor, fırsat bulunca mutlaka bak!`;
    }

    case "ALLIANCE_OFFER": {
      if (isTraitor) {
        return `Tamamdır ${askerNick}, aramızda söz olsun! Ama çok yan yana durmayalım ki İncele ekranında Yakınlık Barımız parlamasın, anlaştık mı?`;
      }
      return `Olur ${askerNick}, sana güvenmek istiyorum ama İncele barında şüpheli biriyle sırdaş çıkarsan oyumu değiştiririm!`;
    }

    case "ACCUSE_ME": {
      if (isTraitor) {
        return `Asıl iftirayı sen atıyorsun ${askerNick}! Dikkatleri kendi üzerinden çekmeye mi çalışıyorsun yoksa?!`;
      }
      return `Bana boşuna yükleniyorsun ${askerNick}! Ben masumum, yanlış kişiyi yakarsak gece hepimizi avlarlar!`;
    }

    default: {
      if (isTraitor && mem.personality === "FITNECI") {
        return `Şşşt ${askerNick}, bu şatoda kimseye körü körüne güvenme... Özellikle ${targetStr} çok tuhaf davranıyor.`;
      }
      const genericPool = [
        `Gözünü dört aç ${askerNick}, kimin kiminle fısıldaştığını İncele'den takip et.`,
        `Kendi özel yatak odanın anahtarı sende ama koridorlarda yalnız gezmek tehlikeli.`,
        `Bakalım bu akşam şömineden kırmızı alev mi çıkacak yoksa beyaz mı...`
      ];
      return genericPool[Math.floor(Math.random() * genericPool.length)];
    }
  }
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
  const target = scapegoat ? `#${scapegoat.seat} ${scapegoat.nick}` : "karşımdaki koltuk";

  if (wave === 1) {
    if (sabotageCount > 0) {
      return isTraitor
        ? `Az önceki 1 dakikalık Bulmaca Sınavında biri hazineyi sabote etti! Bence bunu kesinlikle ${target} yaptı!`
        : `Arkadaşlar Bulmaca Sınavında ${sabotageCount} kişi düzeneği sabote etti! Hain kesinlikle aramızda, herkes neredeydi anlatsın!`;
    }
    if (isTraitor) {
      return `Arkadaşlar ben gündüz ${mem.fakeAlibiRoom} tarafındaydım; ama ${target} gözüme çok şüpheli göründü!`;
    }
    if (mem.lastSeenNick) {
      return `Gündüz ${mem.realLastRoom} içinde #${mem.lastSeenSeat} ${mem.lastSeenNick} vardı; peki geri kalanlar neredeydi?`;
    }
    return `Herkes hangi odada olduğunu açıkça söylesin! Ben ${mem.realLastRoom} içindeydim.`;
  }

  if (wave === 2 && topBond && topBond.score >= 30) {
    return `İncele tablosuna bakın! #${topBond.seatA} ${topBond.nickA} ile #${topBond.seatB} ${topBond.nickB} %${Math.round(
      topBond.score
    )} Yakınlık Barı yapmış! Ne fısıldaştınız bu kadar?!`;
  }

  if (wave === 3) {
    if (isTraitor) {
      return `${target} hain çünkü gündüz koridorda sürekli kapıları dinledi ve kimseyle açık konuşmadı!`;
    }
    return `Savunması zayıf kalan ${target} dikkatimi çekiyor. Neden görev yaparken seni hiç görmedik?`;
  }

  if (wave === 4) {
    if (isTraitor) {
      return `Bana boşuna bakmayın, ben görevlerimi yaptım! Asıl bizi yanlış yönlendiren ${target}!`;
    }
    return `Yanlış kişiyi şömineye atarsak gece Hainler Meclisi birimizi daha infaz eder! Kanıtlara göre karar verelim.`;
  }

  if (personality === "AGRESIF" || isTraitor) {
    return `Lafı uzatmayalım, benim mührüm bu akşam ${target} için! Masum olanlar oyları bölmesin!`;
  }
  return `Emin olmak zor ama bu tur ${target} bana hiç güven vermedi, oyumu ona kullanacağım.`;
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

const RIDDLE_POOL: Array<{ q: string; opts: string[]; ans: number }> = [
  {
    q: "Şömineye atılan zarf KAN KIRMIZISI alevle yanarsa elenen oyuncunun gerçek rolü nedir?",
    opts: ["🗡️ Hain", "🕯️ Masum Misafir", "👑 Şato Kâhyası"],
    ans: 0
  },
  {
    q: "Üç davetli konuşuyor: Sinan 'Lale Haindir' diyor, Lale 'Kemal Haindir' diyor, Kemal 'İkisi de yalan söylüyor!' diyor. Yalnızca 1 Hain varsa ve sadece Hain yalan söylüyorsa Hain kimdir?",
    opts: ["Sinan", "Lale", "Kemal"],
    ans: 1
  },
  {
    q: "Gündüz şatoda gizli Altın Kolye'yi kazanan oyuncuya gece ne olur?",
    opts: ["Oyu iki sayılır", "Gece Hain saldırısından korunur", "Kâhya koltuğuna oturur"],
    ans: 1
  },
  {
    q: "Yuvarlak Sofra'da kimsenin seçemediği ve daima boş duran Kâhya'nın makamı kaç numaralı sandalyedir?",
    opts: ["Sandalye #1", "Sandalye #11", "Sandalye #12"],
    ans: 1
  }
];

const RUNE_COMBOS: Array<{ seq: string; opts: string[]; ans: number }> = [
  {
    seq: "Kadim Rün Dizilimi:  🐦‍⬛ Kuzgun  ➔  🕯️ Şamdan  ➔  🗝️ Anahtar  ➔  ❓ (Mühür döngüsünü tamamla: Ateşten sonra ne gelir?)",
    opts: ["🩸 Kızıl Kadeh", "🕯️ Şamdan", "🐦‍⬛ Kuzgun"],
    ans: 0
  },
  {
    seq: "Simya Terazisi: 2 Beyaz Zarf + 1 Kırmızı Zarf = 11 Gram, 1 Beyaz + 1 Kırmızı = 8 Gram ise Kırmızı Zarf kaç gramdır?",
    opts: ["3 Gram", "5 Gram", "6 Gram"],
    ans: 1
  }
];

const CLOCK_PUZZLES: Array<{ q: string; opts: string[]; ans: number }> = [
  {
    q: "Şato Saati Şifresi: [Kâhya'nın Koltuğu] - [Son Final Kişi Sayısı] - [10 Kişideki Hain Sayısı] dizilimi hangisidir?",
    opts: ["11 - 4 - 2", "12 - 3 - 2", "11 - 2 - 4"],
    ans: 0
  },
  {
    q: "Gece yarısı çanı 12 kez vurduğunda akrep XII üzerinde, yelkovan tam karşısındaysa saat kaçı gösterir?",
    opts: ["06:00", "12:30", "12:00"],
    ans: 1
  }
];

export function createPuzzleChallenge(kind: "RUNE" | "RIDDLE" | "CLOCK"): ActivePuzzleSession {
  const puzzleId = `pz_${Math.random().toString(36).slice(2, 9)}`;
  if (kind === "RUNE") {
    const item = RUNE_COMBOS[Math.floor(Math.random() * RUNE_COMBOS.length)];
    return {
      puzzleId,
      kind,
      title: "🔮 Kadim Rün & Simya Kürsüsü",
      prompt: item.seq,
      options: item.opts,
      correctIndex: item.ans,
      expiresAt: Date.now() + 25000
    };
  }
  if (kind === "CLOCK") {
    const item = CLOCK_PUZZLES[Math.floor(Math.random() * CLOCK_PUZZLES.length)];
    return {
      puzzleId,
      kind,
      title: "🕰️ Şato Saati Şifre Mekanizması",
      prompt: item.q,
      options: item.opts,
      correctIndex: item.ans,
      expiresAt: Date.now() + 25000
    };
  }
  const item = RIDDLE_POOL[Math.floor(Math.random() * RIDDLE_POOL.length)];
  return {
    puzzleId,
    kind: "RIDDLE",
    title: "📜 Kâhya'nın Mantık Bilmecesi",
    prompt: item.q,
    options: item.opts,
    correctIndex: item.ans,
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
  // %20 ihtimalle Paslı Kâhya Anahtarı + Kanat İpucu!
  if (roll < 0.2 && traitors.length > 0) {
    const t = traitors[Math.floor(Math.random() * traitors.length)];
    const wing = t.seat <= 6 ? "Batı Kanadında (#1 - #6)" : "Doğu Kanadında (#7 - #12)";
    return {
      clueText: `🗝️ PASLI KÂHYA ANAHTARI KAZANDIN! (#11 Mühürlü Odaya girebilirsin!) + Pusula: Özel odası ${wing} olanlardan en az biri HAİN!`,
      grantedKahyaKey: true
    };
  }

  // %45 ihtimalle İkili Takım Kıyaslaması (Sosyal çıkarım için en heyecanlı kanıt!)
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

  // Kalan durum: Tek / Çift Koltuk İpucu
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
    title: "🔍 Yakınlık İncele & Kürsü Çöz",
    description: "🔍 İncele ile bir oyuncunun Arkadaşlık Barına bak veya Etkinlik Salonu'nda bir bulmaca kürsüsü çöz!",
    progress: 0,
    goal: 1,
    rewardGold: 20,
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
