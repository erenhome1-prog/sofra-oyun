import { Schema, MapSchema, type } from "@colyseus/schema";

export class DoorState extends Schema {
  @type("string") id: string = "";
  @type("boolean") open: boolean = false;
  @type("boolean") locked: boolean = false;
}

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") nick: string = "Misafir";
  @type("number") seat: number = 1;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 15;
  @type("number") rotY: number = Math.PI;
  @type("string") anim: string = "idle";
  @type("boolean") alive: boolean = true;
  @type("boolean") ghost: boolean = false;
  @type("boolean") isBot: boolean = false;
  @type("string") roomId: string = "antre";
  @type("boolean") carryingGold: boolean = false;
  @type("boolean") talking: boolean = false;
  @type("boolean") connected: boolean = true;
  // Karakter özelleştirme alanları (Dizi karakteri veya oyuncunun kendi tasarımı)
  @type("string") charName: string = "Sinan";
  @type("string") coatColor: string = "#1e2430";
  @type("string") accentColor: string = "#9b1c24";
  @type("string") hat: string = "none";
  @type("string") mask: string = "none";
  @type("string") votedForId: string = "";
}

/**
 * GÜVENLİK KURALI (02_TEKNIK_MIMARI §3.1):
 * Paylaşılan durumda (Schema) KESİNLİKLE rol (hain/misafir) alanı yer almaz.
 * Roller yalnızca sunucu belleğinde gizli Map içinde tutulur.
 */
export class SofraState extends Schema {
  @type("string") phase: string = "LOBBY";
  @type("number") phaseEndsAt: number = 0;
  @type("number") round: number = 1;
  @type("string") code: string = "";
  @type("string") hostId: string = "";
  @type("boolean") fastMode: boolean = false;
  @type("string") announcement: string = "Şato lobisinde davetliler bekleniyor...";
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: DoorState }) doors = new MapSchema<DoorState>();
  @type("number") pot: number = 0;
  @type("string") necklaceHolder: string = "";
  @type("string") lastBurnedId: string = "";
  @type("string") lastBurnedName: string = "";
  @type("string") lastBurnedFlame: string = ""; // "RED" (Hain) | "WHITE" (Misafir) | ""
  @type("string") lastTakenId: string = "";
  @type("string") lastTakenName: string = "";
  @type("string") winnerTeam: string = ""; // "MISAFIR" | "HAIN" | ""
}
