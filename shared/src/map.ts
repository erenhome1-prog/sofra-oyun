export interface WallBox {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height?: number;
}

export interface DoorDef {
  id: string;
  label: string;
  roomId: string;
  ownerSeat: number;
  sealedByKahya?: boolean;
  x: number;
  z: number;
  width: number;
  depth: number;
  hingeX: number;
  hingeZ: number;
  orientation: "vertical" | "horizontal";
}

export interface RoomZone {
  id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  isPrivateBedroom?: boolean;
  ownerSeat?: number;
}

export interface CollisionActorContext {
  seat?: number;
  currentRoomId?: string;
  lockedDoors?: Record<string, boolean>;
  hasKahyaKey?: boolean;
}

export interface MedievalStationOption {
  id: string;
  label: string;
  desc: string;
  badge: string;
}

export interface MedievalStationDef {
  id: string;
  roomId: string;
  icon: string;
  shortLabel: string;
  title: string;
  description: string;
  x: number;
  z: number;
  options: MedievalStationOption[];
}

export const PUZZLE_ALTARS: Array<{ id: string; label: string; x: number; z: number; kind: "RUNE" | "RIDDLE" | "CLOCK" }> = [
  { id: "altar_rune", label: "🔮 Kadim Rün Kürsüsü", x: 16.2, z: -20.5, kind: "RUNE" },
  { id: "altar_riddle", label: "📜 Kâhya'nın Bilmece Kürsüsü", x: 22.0, z: -20.5, kind: "RIDDLE" },
  { id: "altar_clock", label: "🕰️ Şato Saati Şifresi", x: 22.0, z: -13.5, kind: "CLOCK" }
];

export const COUNCIL_BOARD_POS = { x: -22.0, z: -17.0, label: "📋 Şüphe & Konsey Tahtası" };

export const MEDIEVAL_STATIONS: MedievalStationDef[] = [
  {
    id: "station_alchemy",
    roomId: "simya_odasi",
    icon: "⚗️",
    shortLabel: "SİMYA",
    title: "⚗️ Simya Kazanı & İksir Mahzeni",
    description: "Fokurdayan zümrüt kazandan iksir çekebilir veya kurşunu altına dönüştürebilirsin:",
    x: -20.5,
    z: 27.5,
    options: [
      {
        id: "truth_vapor",
        label: "🧪 Doğruluk Buharı Kokla",
        desc: "Simya dumanında hayatta kalan rastgele bir koltuğun masumiyet/şüphe izini gör.",
        badge: "İpucu"
      },
      {
        id: "transmute_gold",
        label: "✨ Kurşunu Altına Dönüştür",
        desc: "Simya taşıyla hem kişisel kasana +15🪙 hem Ortak Hazineye +15🪙 ekle.",
        badge: "+15🪙"
      },
      {
        id: "shadow_draught",
        label: "🌑 Gece Görüşü & Fısıltı İksiri",
        desc: "En yakın müttefikinle bağını +12 güçlendirir (Hain isen şatoya gizemli dedikodu yayar).",
        badge: "Sosyal"
      }
    ]
  },
  {
    id: "station_armory",
    roomId: "cephanelik",
    icon: "⚔️",
    shortLabel: "CEPHANE",
    title: "⚔️ Şövalye Cephaneliği & Zırh Salonu",
    description: "Orta Çağ zırhlarını kuşanabilir veya silah raflarındaki eksik hançerleri inceleyebilirsin:",
    x: 20.5,
    z: 27.5,
    options: [
      {
        id: "inspect_blades",
        label: "🗡️ Eksik Hançer Raflarını Yokla",
        desc: "Gece hançerlerinin hangi yatak koridoruna (Batı #1-#6 / Doğu #7-#12) taşındığını saptar.",
        badge: "Dedektif"
      },
      {
        id: "equip_helm",
        label: "🪖 Şövalye Miğferi & Zırhı Kuşan",
        desc: "Karakterine bu maç boyunca parlak Orta Çağ Şövalye Miğferi ve gümüş arma kuşandırır.",
        badge: "Zırh"
      },
      {
        id: "polish_shields",
        label: "🛡️ Kraliyet Kalkanlarını Bakıma Al",
        desc: "Muhafız sandığından Ortak Şato Hazinesine +20🪙 ve kişisel kasana +10🪙 kazandırır.",
        badge: "+20🪙 Hazine"
      }
    ]
  },
  {
    id: "station_library",
    roomId: "kutuphane",
    icon: "📚",
    shortLabel: "ARŞİV",
    title: "📚 Şato Kütüphanesi & Vakayiname Arşivi",
    description: "Deri ciltli Orta Çağ el yazmalarından şatonun gizli ittifaklarını ve kayıtlarını oku:",
    x: -19.5,
    z: -28.0,
    options: [
      {
        id: "read_lineage",
        label: "📜 Fısıltı & İttifak Şeceresini Oku",
        desc: "Şatoda şu ana kadar en gizli ve güçlü bağ kuran iki koltuğu ortaya çıkarır.",
        badge: "Analiz"
      },
      {
        id: "kahya_ledger",
        label: "🕯️ Kâhya'nın Mühürlü Kayıt Defteri",
        desc: "Şatodaki sabotaj sayısını ve Altın Kolye durumunu öğren (+10🪙 Arşiv Ödülü).",
        badge: "+10🪙 & Kayıt"
      },
      {
        id: "equip_wizard",
        label: "🧙 Başbüyücü / Alim Başlığı Tak",
        desc: "Karakterine Orta Çağ Alim & Simyacı Başlığı ve altın işlemeli pelerin verir.",
        badge: "Başlık"
      }
    ]
  },
  {
    id: "station_dungeon",
    roomId: "zindan",
    icon: "⛓️",
    shortLabel: "ZİNDAN",
    title: "⛓️ Zindan & Sorgu Mahzeni",
    description: "Demir parmaklıkların ardındaki taş çentikleri incele veya şatoya korku sal:",
    x: 19.5,
    z: -28.0,
    options: [
      {
        id: "chain_omen",
        label: "⛓️ Zindan Duvarındaki Çentikleri Say",
        desc: "Sofrada şu an hayatta kaç Hain kaldığını kesin olarak öğrenirsin!",
        badge: "Kritik Bilgi"
      },
      {
        id: "rattle_chains",
        label: "🔔 Sorgu Zincirlerini Çınlat",
        desc: "Tüm şato koridorlarında yankılanan ürpertici bir zindan çanı ve zincir sesi duyurur.",
        badge: "Psikolojik"
      },
      {
        id: "equip_ironmask",
        label: "🎭 Orta Çağ Demir Maskesi Tak",
        desc: "Karakterine gizemli çelik şövalye sorgu maskesi takar.",
        badge: "Maske"
      }
    ]
  },
  {
    id: "station_well",
    roomId: "avlu",
    icon: "⛲",
    shortLabel: "KUYU",
    title: "⛲ Kargalı Avlu Dilek Kuyusu & Kuzgun Tüneği",
    description: "Taş kuyuya dilek parası atarak hazineyi büyüt veya nöbetçi kuzgunları dinle:",
    x: 0.0,
    z: 27.6,
    options: [
      {
        id: "wish_coin",
        label: "🪙 Dilek Kuyusuna Bereket Mührü At",
        desc: "Ortak Şato Hazinesine +25🪙 ekler (50🪙 Kâhya Zili'ni çalmayı hızlandırır!).",
        badge: "+25🪙 Hazine"
      },
      {
        id: "feed_raven",
        label: "🐦‍⬛ Nöbetçi Kuzgunu Besle",
        desc: "Kuledeki kuzgun şu an şatonun hangi odasında kimlerin toplandığını kulağına fısıldar.",
        badge: "Gözcü"
      }
    ]
  }
];

const SEAT_OWNER_NAMES: Record<number, string> = {
  1: "Sinan",
  2: "Lale",
  3: "Kemal",
  4: "Ufuk",
  5: "Rıza",
  6: "Davetli",
  7: "Defne",
  8: "Hüsnü",
  9: "Peri",
  10: "Zeynep",
  11: "Kâhya (Mühürlü)",
  12: "Yabancı"
};

function buildBedroomZonesAndDoors(): { zones: RoomZone[]; doors: DoorDef[]; walls: WallBox[] } {
  const zones: RoomZone[] = [];
  const doors: DoorDef[] = [];
  const walls: WallBox[] = [];

  // 6 satır: Z = -10 .. +20 (her oda 5m derinliğinde, kapı boşluğu 2.2m)
  for (let i = 0; i < 6; i++) {
    const zMin = -10 + i * 5;
    const zMax = zMin + 5;
    const zCenter = zMin + 2.5;

    const westSeat = i + 1; // #1..#6
    const eastSeat = i + 7; // #7..#12

    zones.push({
      id: `yatak_${westSeat}`,
      name: `Oda #${westSeat} (${SEAT_OWNER_NAMES[westSeat]})`,
      minX: -26,
      maxX: -16.5,
      minZ: zMin,
      maxZ: zMax,
      isPrivateBedroom: true,
      ownerSeat: westSeat
    });

    zones.push({
      id: `yatak_${eastSeat}`,
      name: eastSeat === 11 ? "Oda #11 (Kâhya'nın Mühürlü Odası)" : `Oda #${eastSeat} (${SEAT_OWNER_NAMES[eastSeat]})`,
      minX: 16.5,
      maxX: 26,
      minZ: zMin,
      maxZ: zMax,
      isPrivateBedroom: true,
      ownerSeat: eastSeat
    });

    doors.push({
      id: `door_yatak_${westSeat}`,
      label: `Oda #${westSeat} Kapısı`,
      roomId: `yatak_${westSeat}`,
      ownerSeat: westSeat,
      x: -16.5,
      z: zCenter,
      width: 0.45,
      depth: 2.1,
      hingeX: -16.5,
      hingeZ: zCenter - 1.05,
      orientation: "vertical"
    });

    doors.push({
      id: `door_yatak_${eastSeat}`,
      label: eastSeat === 11 ? "Kâhya'nın Mühürlü Kapısı (#11)" : `Oda #${eastSeat} Kapısı`,
      roomId: `yatak_${eastSeat}`,
      ownerSeat: eastSeat,
      sealedByKahya: eastSeat === 11,
      x: 16.5,
      z: zCenter,
      width: 0.45,
      depth: 2.1,
      hingeX: 16.5,
      hingeZ: zCenter - 1.05,
      orientation: "vertical"
    });

    // Yatak odaları arası yatay bölme duvarları
    walls.push({
      id: `west_bed_div_${i}`,
      minX: -26,
      maxX: -16.5,
      minZ: zMax - 0.22,
      maxZ: zMax + 0.22,
      height: 4.5
    });
    walls.push({
      id: `east_bed_div_${i}`,
      minX: 16.5,
      maxX: 26,
      minZ: zMax - 0.22,
      maxZ: zMax + 0.22,
      height: 4.5
    });

    // Koridor cephesinde kapı üstü/yanı kısa duvar parçaları (kapı boşluğu zCenter ± 1.1m)
    walls.push({
      id: `west_corr_seg_a_${i}`,
      minX: -16.75,
      maxX: -16.25,
      minZ: zMin,
      maxZ: zCenter - 1.1,
      height: 4.5
    });
    walls.push({
      id: `west_corr_seg_b_${i}`,
      minX: -16.75,
      maxX: -16.25,
      minZ: zCenter + 1.1,
      maxZ: zMax,
      height: 4.5
    });

    walls.push({
      id: `east_corr_seg_a_${i}`,
      minX: 16.25,
      maxX: 16.75,
      minZ: zMin,
      maxZ: zCenter - 1.1,
      height: 4.5
    });
    walls.push({
      id: `east_corr_seg_b_${i}`,
      minX: 16.25,
      maxX: 16.75,
      minZ: zCenter + 1.1,
      maxZ: zMax,
      height: 4.5
    });
  }

  return { zones, doors, walls };
}

const BEDROOM_DATA = buildBedroomZonesAndDoors();

export const ROOM_ZONES: RoomZone[] = [
  ...BEDROOM_DATA.zones,
  { id: "kutuphane", name: "📚 Şato Kütüphanesi & Arşiv", minX: -26, maxX: -8.5, minZ: -32, maxZ: -24 },
  { id: "zindan", name: "⛓️ Zindan & Sorgu Mahzeni", minX: 8.5, maxX: 26, minZ: -32, maxZ: -24 },
  { id: "saat_kulesi", name: "🕰️ Saat Kulesi", minX: -8.5, maxX: 8.5, minZ: -32, maxZ: -22 },
  { id: "toplanti_salonu", name: "📋 Konsey & Harita Salonu", minX: -26, maxX: -12, minZ: -24, maxZ: -10 },
  { id: "etkinlik_salonu", name: "🔮 Rün & Bulmaca Salonu", minX: 12, maxX: 26, minZ: -24, maxZ: -10 },
  { id: "kuzey_koridoru", name: "🕯️ Kuzey Kemerli Galeri", minX: -12, maxX: 12, minZ: -24, maxZ: -10 },
  { id: "bati_koridor", name: "🛡️ Batı Yatak Koridoru (#1-#6)", minX: -16.5, maxX: -12, minZ: -10, maxZ: 20 },
  { id: "dogu_koridor", name: "🛡️ Doğu Yatak Koridoru (#7-#12)", minX: 12, maxX: 16.5, minZ: -10, maxZ: 20 },
  { id: "yemek_salonu", name: "🍷 Büyük Şölen Salonu (Yuvarlak Sofra)", minX: -12, maxX: 12, minZ: -10, maxZ: 10 },
  { id: "antre", name: "🏰 Şato Antresi & Muhafız Holü", minX: -12, maxX: 12, minZ: 10, maxZ: 22 },
  { id: "simya_odasi", name: "⚗️ Simya & İksir Mahzeni", minX: -26, maxX: -12, minZ: 20, maxZ: 34 },
  { id: "cephanelik", name: "⚔️ Şövalye Cephaneliği", minX: 12, maxX: 26, minZ: 20, maxZ: 34 },
  { id: "avlu", name: "⛲ Kargalı Avlu & Dilek Kuyusu", minX: -12, maxX: 12, minZ: 22, maxZ: 34 }
];

export const DOORS: DoorDef[] = BEDROOM_DATA.doors;

export const CASTLE_WALLS: WallBox[] = [
  // Şato dış sınır sur duvarları
  { id: "outer_north", minX: -26.5, maxX: 26.5, minZ: -32.5, maxZ: -31.5, height: 6.2 },
  { id: "outer_south", minX: -26.5, maxX: 26.5, minZ: 33.5, maxZ: 34.5, height: 6.2 },
  { id: "outer_west", minX: -26.5, maxX: -25.5, minZ: -32, maxZ: 34, height: 6.2 },
  { id: "outer_east", minX: 25.5, maxX: 26.5, minZ: -32, maxZ: 34, height: 6.2 },

  // Büyük Şölen Salonu Batı & Doğu Kemerli Duvarları (Z = [-6.5..-2.8] ve [2.8..6.5] geniş kemer geçişleri)
  { id: "hall_west_1", minX: -12.25, maxX: -11.75, minZ: -10, maxZ: -6.5, height: 5.0 },
  { id: "hall_west_2", minX: -12.25, maxX: -11.75, minZ: -2.8, maxZ: 2.8, height: 5.0 },
  { id: "hall_west_3", minX: -12.25, maxX: -11.75, minZ: 6.5, maxZ: 10, height: 5.0 },

  { id: "hall_east_1", minX: 11.75, maxX: 12.25, minZ: -10, maxZ: -6.5, height: 5.0 },
  { id: "hall_east_2", minX: 11.75, maxX: 12.25, minZ: -2.8, maxZ: 2.8, height: 5.0 },
  { id: "hall_east_3", minX: 11.75, maxX: 12.25, minZ: 6.5, maxZ: 10, height: 5.0 },

  // Büyük Şölen Salonu Kuzey & Güney Duvarları
  { id: "north_hall_L", minX: -12, maxX: -3.4, minZ: -10.25, maxZ: -9.75, height: 5.0 },
  { id: "north_hall_R", minX: 3.4, maxX: 12, minZ: -10.25, maxZ: -9.75, height: 5.0 },
  { id: "south_hall_L", minX: -12, maxX: -3.6, minZ: 9.75, maxZ: 10.25, height: 5.0 },
  { id: "south_hall_R", minX: 3.6, maxX: 12, minZ: 9.75, maxZ: 10.25, height: 5.0 },

  // Kuzeybatı Konsey Salonu & Şato Kütüphanesi Kemerli Taş Duvarları
  { id: "council_north_L", minX: -26, maxX: -21.2, minZ: -24.25, maxZ: -23.75, height: 5.0 },
  { id: "council_north_R", minX: -16.8, maxX: -12, minZ: -24.25, maxZ: -23.75, height: 5.0 },
  { id: "council_south_west", minX: -26, maxX: -16.2, minZ: -10.25, maxZ: -9.75, height: 5.0 },
  { id: "council_east_1", minX: -12.25, maxX: -11.75, minZ: -24, maxZ: -19, height: 5.0 },
  { id: "council_east_2", minX: -12.25, maxX: -11.75, minZ: -14.8, maxZ: -10, height: 5.0 },
  { id: "library_east_1", minX: -8.75, maxX: -8.25, minZ: -32, maxZ: -29.2, height: 5.0 },
  { id: "library_east_2", minX: -8.75, maxX: -8.25, minZ: -25.0, maxZ: -23.8, height: 5.0 },

  // Kuzeydoğu Rün Salonu & Zindan Kemerli Taş Duvarları
  { id: "puzzle_north_L", minX: 12, maxX: 16.8, minZ: -24.25, maxZ: -23.75, height: 5.0 },
  { id: "puzzle_north_R", minX: 21.2, maxX: 26, minZ: -24.25, maxZ: -23.75, height: 5.0 },
  { id: "puzzle_south_east", minX: 16.2, maxX: 26, minZ: -10.25, maxZ: -9.75, height: 5.0 },
  { id: "puzzle_west_1", minX: 11.75, maxX: 12.25, minZ: -24, maxZ: -19, height: 5.0 },
  { id: "puzzle_west_2", minX: 11.75, maxX: 12.25, minZ: -14.8, maxZ: -10, height: 5.0 },
  { id: "dungeon_west_1", minX: 8.25, maxX: 8.75, minZ: -32, maxZ: -29.2, height: 5.0 },
  { id: "dungeon_west_2", minX: 8.25, maxX: 8.75, minZ: -25.0, maxZ: -23.8, height: 5.0 },

  // Güneybatı Simya Mahzeni & Güneydoğu Şövalye Cephaneliği Avlu Kemer Duvarları
  { id: "alchemy_east_1", minX: -12.25, maxX: -11.75, minZ: 20, maxZ: 24.8, height: 5.0 },
  { id: "alchemy_east_2", minX: -12.25, maxX: -11.75, minZ: 29.2, maxZ: 34, height: 5.0 },
  { id: "armory_west_1", minX: 11.75, maxX: 12.25, minZ: 20, maxZ: 24.8, height: 5.0 },
  { id: "armory_west_2", minX: 11.75, maxX: 12.25, minZ: 29.2, maxZ: 34, height: 5.0 },

  // 12 Yatak Odası bölme ve koridor duvarları
  ...BEDROOM_DATA.walls
];

export const TABLE_RADIUS = 3.2;
export const CHAIR_RING_RADIUS = 4.45;

export function getSeatTransform(seat: number): { x: number; z: number; rotY: number } {
  const orderedSeats = [11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
  const idx = Math.max(0, orderedSeats.indexOf(seat));
  const angle = -Math.PI / 2 + (idx / orderedSeats.length) * Math.PI * 2;
  const x = Math.cos(angle) * CHAIR_RING_RADIUS;
  const z = Math.sin(angle) * CHAIR_RING_RADIUS;
  const rotY = Math.atan2(-x, -z);
  return { x, z, rotY };
}

export function getAntreSpawn(seat: number): { x: number; z: number; rotY: number } {
  const row = seat <= 6 ? 0 : 1;
  const col = (seat - 1) % 6;
  const x = -5.0 + col * 2.0;
  const z = 14.5 + row * 2.4;
  return { x, z, rotY: Math.PI };
}

export function detectRoomZone(x: number, z: number): RoomZone {
  for (const r of ROOM_ZONES) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      return r;
    }
  }
  return ROOM_ZONES.find((r) => r.id === "yemek_salonu") || ROOM_ZONES[0];
}

/**
 * Oyuncu kapsülünün duvarlar, yuvarlak masa ve KİŞİSEL ANAHTARLI YATAK ODASI KAPILARI ile çarpışmasını çözer.
 * - Kendi koltuğunun yatak odası (`actor.seat === d.ownerSeat`) kilitli olsa bile kendi anahtarınla doğrudan girip çıkabilirsin!
 * - İçerideki bir davetli kapı kilitlense bile dışarı çıkabilir (anti-hapis koruması).
 */
export function resolveCastleCollision(
  nextX: number,
  nextZ: number,
  openDoors: Record<string, boolean>,
  playerRadius = 0.42,
  actor?: CollisionActorContext
): { x: number; z: number; hit: boolean } {
  let x = Math.max(-25.2, Math.min(25.2, nextX));
  let z = Math.max(-31.0, Math.min(33.0, nextZ));
  let hit = false;

  // 1. Yuvarlak masa çarpışması (merkez 0,0)
  const distSq = x * x + z * z;
  const minTableDist = TABLE_RADIUS + playerRadius;
  if (distSq < minTableDist * minTableDist) {
    const dist = Math.sqrt(distSq) || 0.001;
    x = (x / dist) * minTableDist;
    z = (z / dist) * minTableDist;
    hit = true;
  }

  const allBoxes: WallBox[] = [...CASTLE_WALLS];

  // 2. Kişisel Oda Anahtarı & Kapı Kilit Matrisi
  for (const d of DOORS) {
    const isOpen = Boolean(openDoors[d.id]);
    if (isOpen) continue;

    const isLocked = Boolean(actor?.lockedDoors?.[d.id]);
    const isOwner = actor?.seat !== undefined && actor.seat === d.ownerSeat && !d.sealedByKahya;
    const isKahyaUnlocked = Boolean(d.sealedByKahya && actor?.hasKahyaKey);
    const isExitingFromInside = actor?.currentRoomId === d.roomId;

    // Oda sahibi kendi özel odasına kapı kapalı/kilitli olsa bile anahtarıyla süzülüp geçebilir!
    if (isOwner || isKahyaUnlocked || (isLocked && isExitingFromInside)) {
      continue;
    }

    allBoxes.push({
      id: d.id,
      minX: d.x - d.width / 2,
      maxX: d.x + d.width / 2,
      minZ: d.z - d.depth / 2,
      maxZ: d.z + d.depth / 2
    });
  }

  for (const b of allBoxes) {
    const closestX = Math.max(b.minX, Math.min(x, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - closestX;
    const dz = z - closestZ;
    const d2 = dx * dx + dz * dz;
    if (d2 < playerRadius * playerRadius) {
      hit = true;
      const d = Math.sqrt(d2);
      if (d > 0.0001) {
        const overlap = playerRadius - d;
        x += (dx / d) * overlap;
        z += (dz / d) * overlap;
      } else {
        const leftPen = Math.abs(x - b.minX);
        const rightPen = Math.abs(b.maxX - x);
        x = leftPen < rightPen ? b.minX - playerRadius : b.maxX + playerRadius;
      }
    }
  }

  return { x, z, hit };
}

export const BOT_WAYPOINTS: Array<{ x: number; z: number; room: string }> = [
  { x: 0, z: 16, room: "antre" },
  { x: -6.5, z: 5, room: "yemek_salonu" },
  { x: 6.5, z: -5, room: "yemek_salonu" },
  { x: -14.2, z: -5, room: "bati_koridor" },
  { x: -14.2, z: 10, room: "bati_koridor" },
  { x: 14.2, z: -5, room: "dogu_koridor" },
  { x: 14.2, z: 10, room: "dogu_koridor" },
  { x: -19, z: -17, room: "toplanti_salonu" },
  { x: 18.5, z: -17, room: "etkinlik_salonu" },
  { x: 0, z: -26, room: "saat_kulesi" },
  { x: 0, z: 25.5, room: "avlu" },
  { x: -18.5, z: 26.5, room: "simya_odasi" },
  { x: 18.5, z: 26.5, room: "cephanelik" },
  { x: -18.0, z: -27.5, room: "kutuphane" },
  { x: 18.0, z: -27.5, room: "zindan" }
];
