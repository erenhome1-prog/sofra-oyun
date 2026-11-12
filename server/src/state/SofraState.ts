import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") nick: string = "Misafir";
  @type("number") seat: number = 0;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 0;
  @type("number") rotY: number = 0;
  @type("string") anim: string = "idle";
  @type("boolean") alive: boolean = true;
  @type("boolean") ghost: boolean = false;
  @type("string") roomId: string = "antre";
  @type("boolean") carryingGold: boolean = false;
  @type("boolean") talking: boolean = false;
  @type("boolean") connected: boolean = true;
}

/**
 * GÜVENLİK KURALI (02_TEKNIK_MIMARI §3.1):
 * Paylaşılan durumda (Schema) KESİNLİKLE rol (hain/misafir) alanı yer almaz.
 * Roller yalnızca sunucu belleğinde gizli Map içinde tutulur.
 */
export class SofraState extends Schema {
  @type("string") phase: string = "LOBBY";
  @type("number") phaseEndsAt: number = 0;
  @type("number") round: number = 0;
  @type("string") code: string = "";
  @type("string") hostId: string = "";
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("number") pot: number = 0;
  @type("string") necklaceHolder: string = "";
}
