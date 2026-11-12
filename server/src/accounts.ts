import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sanitizeNickname } from "@sofra/shared";

export interface StoredAccount {
  username: string;
  displayName: string;
  pinSalt: string;
  pinHash: string;
  playerToken: string;
  gold: number;
  selectedSeat: number;
  coatColor: string;
  accentColor: string;
  hat: string;
  mask: string;
  unlockedItems: string[];
  gamesPlayed: number;
  wins: number;
  createdAt: string;
}

export interface PublicAccountProfile {
  username: string;
  displayName: string;
  playerToken: string;
  gold: number;
  selectedSeat: number;
  coatColor: string;
  accentColor: string;
  hat: string;
  mask: string;
  unlockedItems: string[];
  gamesPlayed: number;
  wins: number;
  isNewRegistration?: boolean;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

const DEFAULT_UNLOCKED = ["none", "fedora", "hood", "bun", "glasses", "beard"];

class AccountStore {
  private byUsername = new Map<string, StoredAccount>();
  private byToken = new Map<string, StoredAccount>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (!fs.existsSync(ACCOUNTS_FILE)) {
        return;
      }
      const raw = fs.readFileSync(ACCOUNTS_FILE, "utf8");
      const list = JSON.parse(raw) as StoredAccount[];
      for (const acc of list) {
        this.byUsername.set(acc.username, acc);
        this.byToken.set(acc.playerToken, acc);
      }
    } catch (err) {
      console.error("[AccountStore] Hesap dosyası okunamadı:", err);
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const arr = Array.from(this.byUsername.values());
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(arr, null, 2), "utf8");
    } catch (err) {
      console.error("[AccountStore] Hesap dosyası yazılamadı:", err);
    }
  }

  private normalizeUsername(raw: string): string {
    return String(raw || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9_çğıöşü]/g, "")
      .slice(0, 18);
  }

  private hashPin(pin: string, salt: string): string {
    return crypto.scryptSync(pin, salt, 32).toString("hex");
  }

  private toPublic(acc: StoredAccount, isNewRegistration = false): PublicAccountProfile {
    return {
      username: acc.username,
      displayName: acc.displayName,
      playerToken: acc.playerToken,
      gold: acc.gold,
      selectedSeat: acc.selectedSeat,
      coatColor: acc.coatColor,
      accentColor: acc.accentColor,
      hat: acc.hat,
      mask: acc.mask,
      unlockedItems: acc.unlockedItems,
      gamesPlayed: acc.gamesPlayed,
      wins: acc.wins,
      isNewRegistration
    };
  }

  public register(rawUsername: string, rawPin: string, rawDisplayName?: string): { ok: true; profile: PublicAccountProfile } | { ok: false; error: string } {
    const username = this.normalizeUsername(rawUsername);
    if (username.length < 3) {
      return { ok: false, error: "Kullanıcı adı en az 3 karakter olmalıdır." };
    }
    const pin = String(rawPin || "").trim();
    if (pin.length < 4) {
      return { ok: false, error: "Şifre / PIN en az 4 karakter olmalıdır." };
    }
    if (this.byUsername.has(username)) {
      return { ok: false, error: "Bu kullanıcı adı zaten kayıtlı. 'Giriş Yap' sekmesini kullanın." };
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const pinHash = this.hashPin(pin, salt);
    const playerToken = `acc_${crypto.randomUUID()}`;
    const displayName = sanitizeNickname(rawDisplayName || rawUsername);

    const created: StoredAccount = {
      username,
      displayName,
      pinSalt: salt,
      pinHash,
      playerToken,
      gold: 150, // Kayıtlı Oyuncu Hoş Geldin Kasası (+150 Altın!)
      selectedSeat: 1,
      coatColor: "#5c1a24",
      accentColor: "#d4af37",
      hat: "fedora",
      mask: "none",
      unlockedItems: [...DEFAULT_UNLOCKED],
      gamesPlayed: 0,
      wins: 0,
      createdAt: new Date().toISOString()
    };

    this.byUsername.set(username, created);
    this.byToken.set(playerToken, created);
    this.save();

    return { ok: true, profile: this.toPublic(created, true) };
  }

  public login(rawUsername: string, rawPin: string): { ok: true; profile: PublicAccountProfile } | { ok: false; error: string } {
    const username = this.normalizeUsername(rawUsername);
    const acc = this.byUsername.get(username);
    if (!acc) {
      return { ok: false, error: "Böyle bir şato hesabı bulunamadı." };
    }
    const hash = this.hashPin(String(rawPin || "").trim(), acc.pinSalt);
    if (hash !== acc.pinHash) {
      return { ok: false, error: "Şifre / PIN hatalı." };
    }
    return { ok: true, profile: this.toPublic(acc, false) };
  }

  public getByToken(token: string): PublicAccountProfile | null {
    const acc = this.byToken.get(token);
    return acc ? this.toPublic(acc, false) : null;
  }

  public syncVault(
    token: string,
    patch: Partial<{
      displayName: string;
      gold: number;
      selectedSeat: number;
      coatColor: string;
      accentColor: string;
      hat: string;
      mask: string;
      unlockedItems: string[];
    }>
  ): PublicAccountProfile | null {
    const acc = this.byToken.get(token);
    if (!acc) return null;

    if (typeof patch.displayName === "string" && patch.displayName.trim()) {
      acc.displayName = sanitizeNickname(patch.displayName);
    }
    if (typeof patch.gold === "number" && Number.isFinite(patch.gold)) {
      acc.gold = Math.max(0, Math.min(99999, Math.floor(patch.gold)));
    }
    if (typeof patch.selectedSeat === "number") {
      acc.selectedSeat = patch.selectedSeat;
    }
    if (typeof patch.coatColor === "string") acc.coatColor = patch.coatColor.slice(0, 12);
    if (typeof patch.accentColor === "string") acc.accentColor = patch.accentColor.slice(0, 12);
    if (typeof patch.hat === "string") acc.hat = patch.hat.slice(0, 16);
    if (typeof patch.mask === "string") acc.mask = patch.mask.slice(0, 16);
    if (Array.isArray(patch.unlockedItems)) {
      acc.unlockedItems = Array.from(new Set([...DEFAULT_UNLOCKED, ...patch.unlockedItems.map(String)]));
    }

    this.save();
    return this.toPublic(acc, false);
  }

  public recordMatchResult(token: string, won: boolean): void {
    const acc = this.byToken.get(token);
    if (!acc) return;
    acc.gamesPlayed += 1;
    if (won) {
      acc.wins += 1;
      acc.gold += 30; // Galibiyet ödülü +30 Altın!
    } else {
      acc.gold += 10; // Katılım teselli ödülü +10 Altın!
    }
    this.save();
  }
}

export const accountStore = new AccountStore();
