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
}

/**
 * Kargalı Şato Haritası (~60m x 60m, baştan başa koşu ~25 sn)
 * Merkez (0, 0): Yemek Salonu ve 11 Sandalyeli Yuvarlak Sofra
 */
export const ROOM_ZONES: RoomZone[] = [
  { id: "yemek_salonu", name: "Yemek Salonu (Yuvarlak Sofra)", minX: -12, maxX: 12, minZ: -10, maxZ: 10 },
  { id: "antre", name: "Antre / Giriş Holü", minX: -10, maxX: 10, minZ: 10, maxZ: 22 },
  { id: "avlu", name: "Kargalı Avlu", minX: -14, maxX: 14, minZ: 22, maxZ: 34 },
  { id: "kuzey_koridoru", name: "Kuzey Koridoru", minX: -12, maxX: 12, minZ: -20, maxZ: -10 },
  { id: "saat_kulesi", name: "Saat Kulesi", minX: -7, maxX: 7, minZ: -32, maxZ: -20 },
  { id: "kutuphane", name: "Kütüphane", minX: -26, maxX: -12, minZ: -22, maxZ: -10 },
  { id: "mutfak", name: "Mutfak & Mahzen Girişi", minX: 12, maxX: 26, minZ: -22, maxZ: -10 },
  { id: "yatak_1", name: "Yatak Odası 1 (Kuzeybatı)", minX: -24, maxX: -12, minZ: -9, maxZ: 0, isPrivateBedroom: true },
  { id: "yatak_3", name: "Yatak Odası 3 (Güneybatı)", minX: -24, maxX: -12, minZ: 1, maxZ: 10, isPrivateBedroom: true },
  { id: "yatak_2", name: "Yatak Odası 2 (Kuzeydoğu)", minX: 12, maxX: 24, minZ: -9, maxZ: 0, isPrivateBedroom: true },
  { id: "yatak_4", name: "Yatak Odası 4 (Güneydoğu)", minX: 12, maxX: 24, minZ: 1, maxZ: 10, isPrivateBedroom: true }
];

export const DOORS: DoorDef[] = [
  {
    id: "door_yatak_1",
    label: "Yatak Odası 1 Kapısı",
    roomId: "yatak_1",
    x: -12,
    z: -4.5,
    width: 0.5,
    depth: 2.4,
    hingeX: -12,
    hingeZ: -5.7,
    orientation: "vertical"
  },
  {
    id: "door_yatak_3",
    label: "Yatak Odası 3 Kapısı",
    roomId: "yatak_3",
    x: -12,
    z: 5.5,
    width: 0.5,
    depth: 2.4,
    hingeX: -12,
    hingeZ: 4.3,
    orientation: "vertical"
  },
  {
    id: "door_yatak_2",
    label: "Yatak Odası 2 Kapısı",
    roomId: "yatak_2",
    x: 12,
    z: -4.5,
    width: 0.5,
    depth: 2.4,
    hingeX: 12,
    hingeZ: -5.7,
    orientation: "vertical"
  },
  {
    id: "door_yatak_4",
    label: "Yatak Odası 4 Kapısı",
    roomId: "yatak_4",
    x: 12,
    z: 5.5,
    width: 0.5,
    depth: 2.4,
    hingeX: 12,
    hingeZ: 4.3,
    orientation: "vertical"
  }
];

/**
 * Şato dış sınırları, oda bölmeleri ve ortadaki yuvarlak masa çarpışma kutuları
 */
export const CASTLE_WALLS: WallBox[] = [
  // Dış sınır duvarları
  { id: "outer_north", minX: -26, maxX: 26, minZ: -32.5, maxZ: -31.5, height: 6 },
  { id: "outer_south", minX: -26, maxX: 26, minZ: 33.5, maxZ: 34.5, height: 6 },
  { id: "outer_west", minX: -26.5, maxX: -25.5, minZ: -32, maxZ: 34, height: 6 },
  { id: "outer_east", minX: 25.5, maxX: 26.5, minZ: -32, maxZ: 34, height: 6 },

  // Batı yatak odaları ile Yemek Salonu arasındaki duvar (kapı boşlukları: z=[-5.7..-3.3] ve z=[4.3..6.7])
  { id: "west_hall_1", minX: -12.3, maxX: -11.7, minZ: -10, maxZ: -5.7, height: 4.5 },
  { id: "west_hall_2", minX: -12.3, maxX: -11.7, minZ: -3.3, maxZ: 4.3, height: 4.5 },
  { id: "west_hall_3", minX: -12.3, maxX: -11.7, minZ: 6.7, maxZ: 10, height: 4.5 },
  // Yatak 1 ile Yatak 3 ara duvarı
  { id: "west_bed_div", minX: -25.5, maxX: -12, minZ: -0.3, maxZ: 0.3, height: 4.5 },
  // Yatak 3 güney duvarı
  { id: "west_bed_south", minX: -25.5, maxX: -12, minZ: 9.7, maxZ: 10.3, height: 4.5 },

  // Doğu yatak odaları ile Yemek Salonu arasındaki duvar (kapı boşlukları: z=[-5.7..-3.3] ve z=[4.3..6.7])
  { id: "east_hall_1", minX: 11.7, maxX: 12.3, minZ: -10, maxZ: -5.7, height: 4.5 },
  { id: "east_hall_2", minX: 11.7, maxX: 12.3, minZ: -3.3, maxZ: 4.3, height: 4.5 },
  { id: "east_hall_3", minX: 11.7, maxX: 12.3, minZ: 6.7, maxZ: 10, height: 4.5 },
  // Yatak 2 ile Yatak 4 ara duvarı
  { id: "east_bed_div", minX: 12, maxX: 25.5, minZ: -0.3, maxZ: 0.3, height: 4.5 },
  // Yatak 4 güney duvarı
  { id: "east_bed_south", minX: 12, maxX: 25.5, minZ: 9.7, maxZ: 10.3, height: 4.5 },

  // Yemek Salonu Kuzey Duvarı (ortada Kuzey Koridoru geçidi x=[-3.2..3.2])
  { id: "north_hall_L", minX: -12, maxX: -3.2, minZ: -10.3, maxZ: -9.7, height: 4.8 },
  { id: "north_hall_R", minX: 3.2, maxX: 12, minZ: -10.3, maxZ: -9.7, height: 4.8 },

  // Yemek Salonu Güney Duvarı (ortada Antre geçidi x=[-3.5..3.5])
  { id: "south_hall_L", minX: -12, maxX: -3.5, minZ: 9.7, maxZ: 10.3, height: 4.8 },
  { id: "south_hall_R", minX: 3.5, maxX: 12, minZ: 9.7, maxZ: 10.3, height: 4.8 }
];

export const TABLE_RADIUS = 3.2;
export const CHAIR_RING_RADIUS = 4.35;

/**
 * 1..12 koltukların Yuvarlak Sofra etrafındaki koordinatlarını ve bakış açılarını hesaplar.
 * 11 numaralı sandalye kuzeyde (Şömine önünde, Kâhya'nın boş makamı) yer alır.
 */
export function getSeatTransform(seat: number): { x: number; z: number; rotY: number } {
  const orderedSeats = [11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
  const idx = Math.max(0, orderedSeats.indexOf(seat));
  const angle = -Math.PI / 2 + (idx / orderedSeats.length) * Math.PI * 2;
  const x = Math.cos(angle) * CHAIR_RING_RADIUS;
  const z = Math.sin(angle) * CHAIR_RING_RADIUS;
  const rotY = Math.atan2(-x, -z);
  return { x, z, rotY };
}

/**
 * Antre doğuş noktaları
 */
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
  return ROOM_ZONES[0];
}

/**
 * Oyuncu kapsülünün (radius=0.42) duvarlar, kapalı kapılar ve yuvarlak masa ile çarpışmasını çözer.
 */
export function resolveCastleCollision(
  nextX: number,
  nextZ: number,
  openDoors: Record<string, boolean>,
  playerRadius = 0.42
): { x: number; z: number; hit: boolean } {
  let x = Math.max(-25.0, Math.min(25.0, nextX));
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

  // 2. Sabit duvar kutuları
  const allBoxes: WallBox[] = [...CASTLE_WALLS];

  // 3. Kapalı kapıları çarpışma kutusu olarak ekle
  for (const d of DOORS) {
    const isOpen = Boolean(openDoors[d.id]);
    if (!isOpen) {
      allBoxes.push({
        id: d.id,
        minX: d.x - d.width / 2,
        maxX: d.x + d.width / 2,
        minZ: d.z - d.depth / 2,
        maxZ: d.z + d.depth / 2
      });
    }
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
        // Tam merkezdeyse en yakın kenara it
        const leftPen = Math.abs(x - b.minX);
        const rightPen = Math.abs(b.maxX - x);
        if (leftPen < rightPen) {
          x = b.minX - playerRadius;
        } else {
          x = b.maxX + playerRadius;
        }
      }
    }
  }

  return { x, z, hit };
}

export const BOT_WAYPOINTS: Array<{ x: number; z: number; room: string }> = [
  { x: 0, z: 16, room: "antre" },
  { x: -6, z: 5, room: "yemek_salonu" },
  { x: 6, z: -5, room: "yemek_salonu" },
  { x: -18, z: -5, room: "yatak_1" },
  { x: -18, z: 5.5, room: "yatak_3" },
  { x: 18, z: -5, room: "yatak_2" },
  { x: 18, z: 5.5, room: "yatak_4" },
  { x: -18, z: -15, room: "kutuphane" },
  { x: 18, z: -15, room: "mutfak" },
  { x: 0, z: -25, room: "saat_kulesi" },
  { x: 0, z: 27, room: "avlu" }
];
