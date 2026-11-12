import { Client, Room } from "colyseus.js";
import {
  CHARACTERS,
  COUNCIL_BOARD_POS,
  DOORS,
  MATCH_DURATION_PRESETS,
  MEDIEVAL_STATIONS,
  MatchDurationMode,
  MedievalStationDef,
  PUZZLE_ALTARS,
  SOFRA_CONFIG,
  detectRoomZone,
  normalizeRoomCode,
  resolveCastleCollision,
  resolveCastleStep,
  resolveDurationPreset
} from "@sofra/shared";
import { CastleScene, CharacterVisualState, PickedCharacterInfo } from "./castleScene";
import { sfx } from "./sfx";

interface VaultData {
  playerToken: string;
  username: string;
  welcomed: boolean;
  gold: number;
  customName: string;
  selectedSeat: number;
  coatColor: string;
  accentColor: string;
  hat: string;
  mask: string;
  unlockedItems: string[];
}

interface SecretRolePayload {
  role: "MISAFIR" | "HAIN";
  traitorMates?: { id: string; nick: string; seat: number }[];
}

interface RoomSummary {
  roomId: string;
  code: string;
  roomTitle: string;
  hasPassword: boolean;
  playerCount: number;
  humanCount: number;
  maxClients: number;
  targetPlayerCount?: number;
  paceMode?: string;
  phase: string;
  fastMode: boolean;
  hostNick: string;
}

interface PMThread {
  peerId: string;
  peerNick: string;
  peerSeat: number;
  minimized: boolean;
  unread: boolean;
  messages: Array<{ fromMe: boolean; senderNick: string; text: string }>;
}

const DEFAULT_UNLOCKED = [
  "none",
  "knight",
  "wizard",
  "noble",
  "fedora",
  "hood",
  "bun",
  "ironmask",
  "glasses",
  "beard"
];

const COAT_PALETTE = [
  "#5c1a24", // Tapınak Bordosu
  "#2f3e4e", // Şövalye Çeliği
  "#1b4332", // Orman Okçusu Yeşili
  "#3b1d54", // Kraliyet Moru
  "#5c3a1e", // Simyacı Kehribarı
  "#18181b", // Kuzgun Zırhı
  "#7f1d1d", // Ejderha Kanı
  "#0f4c5c", // Gece Safiri
  "#1e293b", // Gece Laciverti
  "#6b4423"  // Bakır Deri Zırh
];

function createGuestToken(): string {
  return `gst_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

type SuspectStamp = "unknown" | "trust" | "suspect" | "traitor";
type ClueCategory = "clue" | "fire" | "note";

interface ClueEntry {
  id: string;
  round: number;
  category: ClueCategory;
  icon: string;
  source: string;
  text: string;
  time: string;
  personal?: boolean;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

class SofraGameApp {
  private scene: CastleScene;
  private client: Client;
  private apiBase: string;
  private room: Room | null = null;

  private vault: VaultData;
  private authTabMode: "guest" | "register" | "login" = "guest";
  private createPaceMode: MatchDurationMode = "20m";
  private createPlayerCount: 8 | 10 | 12 = 10;
  private myRole: SecretRolePayload | null = null;
  private lastPhase = "";
  private lastCenterRenderHash = "";
  private mobileLobbyTab: "seats" | "custom" = "seats";

  // Knight Online PM Threads & 1-Tık Susturma (Mute)
  private pmThreads = new Map<string, PMThread>();
  private mutedPlayerIds = new Set<string>();
  private lastVoteReveal: Array<{
    voterSeat: number;
    voterNick: string;
    targetSeat: number;
    targetNick: string;
  }> = [];
  private lastDayExtraKey = "";

  // Local player movement, camera turn & stamina
  private localX = 0;
  private localZ = 16;
  private localRotY = Math.PI;
  private stamina = 100;
  private staminaExhaustedUntil = 0;
  private keys = new Set<string>();
  private camTurnDir = 0; // -1 left, +1 right
  private mobileSprintHeld = false;
  private joyX = 0;
  private joyY = 0;
  private netSyncAccum = 0;

  // Selections & New Phase States (Görevler, 1 Dk Bulmaca Sınavı, Gece Hain Meclisi, 360° İncele)
  private selectedVoteTargetId = "";
  private selectedNightTargetId = "";
  private selectedFinalChoice: "TRUST" | "DOUBT" | null = null;
  private previewSelfOnMenu = false;
  private readyStatusText = "";
  private myQuests: Array<{
    id: string;
    kind: string;
    title: string;
    description: string;
    progress: number;
    goal: number;
    rewardGold: number;
    done: boolean;
  }> = [];
  private activeTrial: {
    stage: number;
    totalStages: number;
    puzzleId: string;
    title: string;
    prompt: string;
    options: string[];
    feedback: string;
    canSabotage: boolean;
    completedClue?: string;
  } | null = null;
  private myHasSecretNecklace = false;
  private activeTrialSecretResult: {
    wonNecklace: boolean;
    someoneWon: boolean;
    reason?: string;
    text: string;
  } | null = null;
  private traitorNightPicks = new Map<
    string,
    { traitorSeat: number; traitorNick: string; targetId: string; targetSeat: number; targetNick: string }
  >();
  private nightConclaveLogs: string[] = [];
  private nightWatchNote = "";
  private gameOverSummary: {
    winner: string;
    roles: Array<{ id: string; nick: string; seat: number; role: string; alive: boolean }>;
    chronicle: string[];
    topMatchBond?: { seatA: number; nickA: string; seatB: number; nickB: string; score: number } | null;
  } | null = null;

  // 📖 Orta Çağ Dedektif & Taktik El Kitapçığı (Otomatik İpucu Kaydı + Hibrit Seçim Kontrolü)
  private handbookOpen = false;
  private handbookViewMode: "book" | "clues" | "suspects" | "actions" = "book";
  private clueFilter: "all" | ClueCategory = "all";
  private clueJournal: ClueEntry[] = [];
  private recordedClueKeys = new Set<string>();
  private unreadClueCount = 0;
  private suspectTags: Record<number, SuspectStamp> = {};
  private confirmedSeatFlames: Record<number, "RED" | "WHITE" | "EXEC"> = {};
  private preTargetSeat = 0;
  private lastRecordedBoardNote = "";
  private lastHandbookRenderHash = "";

  // Menu idle rotation, camera zoom hold, auto-declutter timers & FPS
  private camZoomDir = 0;
  private menuOrbitAngle = 0;
  private lastAnnouncementText = "";
  private announcementChangedAt = 0;
  private dayPhaseEnteredAt = 0;
  private frameCount = 0;
  private fpsAccum = 0;
  private lastFrameTime = performance.now();

  // Faz 2 Yeni Özellikler: Son 10 sn Çan, Beraberlik İkinci Tur, Odalar & Bağlam Menüsü Durumları
  private activeReconnectRoomId = "";
  private isLocalReadyForPhase = false;
  private isNightSealed = false;
  private tieCandidateIds: string[] | null = null;
  private lastLocalServerVoted = false;
  private lastCountdownSec = -1;
  private usedStationIdsThisRound = new Set<string>();
  private lastRoundNumber = 0;
  private inspectedFromHandbook = false;
  private resetPointersFn: (() => void) | null = null;
  private toastHideTimer: number | null = null;
  private chatUserLogHeight: number | null = null;
  private chatUserBoxWidth: number | null = null;
  private chatSizePresetIdx = 0;
  private chatPanelOverridePhase = "";

  constructor() {
    const container = document.getElementById("canvas-container")!;
    this.scene = new CastleScene(container);
    window.addEventListener(
      "touchstart",
      () => document.body.classList.add("touch-detected"),
      { once: true, passive: true }
    );

    const isHttps = window.location.protocol === "https:";
    const host = window.location.hostname || "localhost";
    this.apiBase = `${isHttps ? "https:" : "http:"}//${host}:${SOFRA_CONFIG.SERVER_PORT}`;
    const wsUrl = `${isHttps ? "wss:" : "ws:"}//${host}:${SOFRA_CONFIG.SERVER_PORT}`;
    this.client = new Client(wsUrl);

    this.vault = this.loadVault();
    this.setupMobileOrientationGate();
    this.setupWelcomeEnvelopeCinema();
    this.setupMainMenu();
    this.setupHUDActions();
    this.setupInputAndLoLWheel();
    this.checkResumeOrDeepLink();

    requestAnimationFrame((t) => this.animate(t));
  }

  private isTextInputElement(el: Element | null): boolean {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
  }

  private setupMobileOrientationGate(): void {
    const updateKeyboardState = () => {
      const vv = window.visualViewport;
      const focusedInput = this.isTextInputElement(document.activeElement);
      const baseH = Math.max(window.screen?.availHeight || 0, window.innerHeight);
      const vvH = vv ? vv.height : window.innerHeight;
      const keyboardOpen = focusedInput && vvH < baseH * 0.74;
      const wasOpen = document.body.classList.contains("keyboard-open");
      document.body.classList.toggle("keyboard-open", keyboardOpen);
      if (wasOpen && !keyboardOpen) {
        // iOS Safari sanal klavye kapandığında kayan viewport ofsetini sıfırla
        window.scrollTo(0, 0);
        setTimeout(() => {
          window.scrollTo(0, 0);
          this.scene.forceResize();
          this.syncChatDimensions(false);
        }, 80);
      }
      this.syncChatDimensions(false);
    };

    const syncOrientationState = () => {
      updateKeyboardState();

      const ua = navigator.userAgent || "";
      const isCoarsePointer =
        window.matchMedia("(pointer: coarse)").matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
      const minScreenDim = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
      // Büyük tabletlerde (iPad vb. kısa kenar >= 620px) dikey kilide zorlama; telefonlarda yatay ekran iste
      const isPhoneTouch = isCoarsePointer && minScreenDim < 620;

      if (!isPhoneTouch) {
        document.body.classList.remove("force-rotate-gate");
        document.body.classList.add("is-landscape");
        return;
      }

      // Sanal klavye açıkken innerHeight küçülmesi yatay ekran sanılmasın!
      let isLandscape: boolean;
      const scrOrientType = screen.orientation?.type || "";
      const legacyAngle = typeof (window as any).orientation === "number" ? Math.abs((window as any).orientation) : null;
      if (scrOrientType) {
        isLandscape = scrOrientType.startsWith("landscape");
      } else if (legacyAngle !== null) {
        isLandscape = legacyAngle === 90;
      } else if (document.body.classList.contains("keyboard-open") && (window.screen?.height || 0) > (window.screen?.width || 0)) {
        isLandscape = document.body.classList.contains("is-landscape");
      } else {
        isLandscape = window.innerWidth >= window.innerHeight;
      }

      if (isLandscape) {
        // Telefon yataya çevrildiği anda hiçbir tuşa basmadan ekran otomatik açılır!
        const wasLocked = document.body.classList.contains("force-rotate-gate");
        document.body.classList.remove("force-rotate-gate");
        document.body.classList.add("is-landscape");
        if (wasLocked) {
          this.scene.forceResize();
          this.lastCenterRenderHash = "";
        }
      } else {
        // Telefon dikey tutulduğunda "TELEFONU YATAYA ÇEVİRİN" ekranı çıkar
        document.body.classList.add("force-rotate-gate");
        document.body.classList.remove("is-landscape");
        this.closeCharacterContextMenu();
        this.closeHudGearMenu();
      }
    };

    syncOrientationState();
    window.addEventListener("resize", syncOrientationState);
    window.addEventListener("focusin", () => setTimeout(updateKeyboardState, 90));
    window.addEventListener("focusout", () => setTimeout(syncOrientationState, 120));
    window.addEventListener("orientationchange", () => {
      this.resetPointersFn?.();
      syncOrientationState();
      for (const ms of [90, 220, 450]) {
        window.setTimeout(syncOrientationState, ms);
      }
    });
    screen.orientation?.addEventListener?.("change", () => {
      this.resetPointersFn?.();
      syncOrientationState();
      for (const ms of [90, 220, 450]) {
        window.setTimeout(syncOrientationState, ms);
      }
    });
    document.addEventListener("fullscreenchange", () => {
      this.resetPointersFn?.();
      syncOrientationState();
      setTimeout(() => this.scene.forceResize(), 100);
    });
    window.visualViewport?.addEventListener?.("resize", syncOrientationState);
  }

  private loadVault(): VaultData {
    const fallback: VaultData = {
      playerToken: createGuestToken(),
      username: "",
      welcomed: false,
      gold: 100,
      customName: "",
      selectedSeat: 1,
      coatColor: "#5c1a24",
      accentColor: "#d4af37",
      hat: "fedora",
      mask: "none",
      unlockedItems: [...DEFAULT_UNLOCKED]
    };
    try {
      const raw = localStorage.getItem("sofra_player_vault_v2");
      if (!raw) {
        localStorage.setItem("sofra_player_vault_v2", JSON.stringify(fallback));
        return fallback;
      }
      const parsed = { ...fallback, ...JSON.parse(raw) };
      if (!parsed.playerToken) parsed.playerToken = createGuestToken();
      const mergedUnlocked = new Set<string>([...DEFAULT_UNLOCKED, ...(parsed.unlockedItems || [])]);
      parsed.unlockedItems = Array.from(mergedUnlocked);
      return parsed;
    } catch {
      return fallback;
    }
  }

  private saveVault(syncRemote = true): void {
    try {
      localStorage.setItem("sofra_player_vault_v2", JSON.stringify(this.vault));
    } catch {
      // ignore
    }

    const goldEl = document.getElementById("gold-balance-label");
    if (goldEl) goldEl.textContent = `🪙 ${this.vault.gold}`;

    const badgeEl = document.getElementById("menu-account-badge");
    if (badgeEl) {
      badgeEl.textContent = this.vault.username
        ? `👑 @${this.vault.username} (🪙 ${this.vault.gold})`
        : `🕯️ Misafir (🪙 ${this.vault.gold})`;
    }

    if (syncRemote && this.vault.playerToken.startsWith("acc_")) {
      fetch(`${this.apiBase}/auth/sync-vault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerToken: this.vault.playerToken,
          displayName: this.vault.customName,
          gold: this.vault.gold,
          selectedSeat: this.vault.selectedSeat,
          coatColor: this.vault.coatColor,
          accentColor: this.vault.accentColor,
          hat: this.vault.hat,
          mask: this.vault.mask,
          unlockedItems: this.vault.unlockedItems
        })
      }).catch(() => {});
    }
  }

  // ==========================================================================
  // SİNEMATİK 3D MÜHÜRLÜ ZARF SAHNESİ
  // ==========================================================================
  private openCinematicEnvelope(bonusMessage?: string, risingLabel?: string): void {
    const modal = document.getElementById("welcome-modal")!;
    const closedView = document.getElementById("envelope-closed-view")!;
    const openView = document.getElementById("envelope-open-view")!;
    const box3d = document.getElementById("env-3d-box")!;
    const bonusEl = document.getElementById("welcome-bonus-text");
    const risingEl = document.getElementById("env-rising-letter-text");

    if (bonusEl && bonusMessage) {
      bonusEl.textContent = bonusMessage;
    }
    if (risingEl) {
      risingEl.innerHTML =
        risingLabel || "📜 Kâhya'nın Mektubu<br/>&amp; +100 🪙 Hoş Geldin Hediyesi";
    }

    box3d.classList.remove("opening");
    closedView.classList.remove("hidden");
    openView.classList.add("hidden");
    modal.classList.remove("hidden");
  }

  private setupWelcomeEnvelopeCinema(): void {
    const modal = document.getElementById("welcome-modal")!;
    const closedView = document.getElementById("envelope-closed-view")!;
    const openView = document.getElementById("envelope-open-view")!;
    const box3d = document.getElementById("env-3d-box")!;
    const btnBreakSeal = document.getElementById("btn-break-seal")!;
    const btnEnterCastle = document.getElementById("btn-enter-castle")!;
    const btnCloseX = document.getElementById("btn-close-envelope-x");
    const btnOpenRules = document.getElementById("btn-open-rules")!;

    this.saveVault(false);

    // İlk kez gelen oyuncuya 3D mühürlü zarf sahnesini göster
    if (!this.vault.welcomed) {
      this.openCinematicEnvelope("🎁 Hoş Geldin Kasası: +100 Altın Kasanıza Eklendi!");
    }

    btnBreakSeal.addEventListener("click", () => {
      sfx.playSealBreak();
      navigator.vibrate?.([30, 40, 20]);
      box3d.classList.add("opening");

      if (!this.vault.welcomed) {
        this.vault.welcomed = true;
        this.vault.gold += 100;
        this.saveVault();
        sfx.playGoldChime();
      }

      setTimeout(() => {
        closedView.classList.add("hidden");
        openView.classList.remove("hidden");
      }, 780);
    });

    const closeModal = () => {
      modal.classList.add("hidden");
      sfx.playDoorCreak(true);
    };
    btnEnterCastle.addEventListener("click", closeModal);
    btnCloseX?.addEventListener("click", closeModal);

    btnOpenRules.addEventListener("click", () => {
      closedView.classList.add("hidden");
      openView.classList.remove("hidden");
      modal.classList.remove("hidden");
    });
  }

  // ==========================================================================
  // BAŞLANGIÇ ANA MENÜ, KAYIT & CANLI ODA TARAYICISI
  // ==========================================================================
  private setupMainMenu(): void {
    const guestInput = document.getElementById("input-guest-nick") as HTMLInputElement;
    guestInput.value = this.vault.customName;
    guestInput.addEventListener("input", () => {
      this.vault.customName = guestInput.value.trim();
      this.saveVault(false);
    });

    const tabGuest = document.getElementById("tab-auth-guest")!;
    const tabReg = document.getElementById("tab-auth-register")!;
    const tabLogin = document.getElementById("tab-auth-login")!;
    const viewGuest = document.getElementById("auth-view-guest")!;
    const viewAcc = document.getElementById("auth-view-account")!;
    const accNickInput = document.getElementById("input-acc-nick") as HTMLInputElement;
    const accSubmitBtn = document.getElementById("btn-acc-submit")!;
    const feedbackEl = document.getElementById("auth-feedback")!;

    const setAuthTab = (mode: "guest" | "register" | "login") => {
      this.authTabMode = mode;
      tabGuest.classList.toggle("btn-crimson", mode === "guest");
      tabReg.classList.toggle("btn-crimson", mode === "register");
      tabLogin.classList.toggle("btn-crimson", mode === "login");

      viewGuest.classList.toggle("hidden", mode !== "guest");
      viewAcc.classList.toggle("hidden", mode === "guest");
      accNickInput.classList.toggle("hidden", mode === "login");
      accSubmitBtn.textContent =
        mode === "register"
          ? "👑 Kayıt Ol & Mühürlü Zarfı Aç (+150🪙)"
          : "🔑 Şato Hesabına Giriş Yap";
      feedbackEl.textContent = "";
    };

    tabGuest.addEventListener("click", () => setAuthTab("guest"));
    tabReg.addEventListener("click", () => setAuthTab("register"));
    tabLogin.addEventListener("click", () => setAuthTab("login"));

    accSubmitBtn.addEventListener("click", async () => {
      const username = (document.getElementById("input-acc-user") as HTMLInputElement).value.trim();
      const pin = (document.getElementById("input-acc-pin") as HTMLInputElement).value.trim();
      const displayName = accNickInput.value.trim() || username;

      const endpoint = this.authTabMode === "register" ? "/auth/register" : "/auth/login";
      try {
        const res = await fetch(`${this.apiBase}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, pin, displayName })
        });
        const data = await res.json();
        if (!res.ok) {
          feedbackEl.style.color = "#ff7585";
          feedbackEl.textContent = data.error || "İşlem başarısız.";
          return;
        }

        const p = data.profile;
        this.vault.playerToken = p.playerToken;
        this.vault.username = p.username;
        this.vault.customName = p.displayName;
        this.vault.gold = p.gold;
        this.vault.selectedSeat = p.selectedSeat;
        this.vault.coatColor = p.coatColor;
        this.vault.accentColor = p.accentColor;
        this.vault.hat = p.hat;
        this.vault.mask = p.mask;
        this.vault.unlockedItems = p.unlockedItems;
        this.vault.welcomed = true;
        guestInput.value = p.displayName;
        this.saveVault(false);
        sfx.playGoldChime();

        feedbackEl.style.color = "#6ef2b1";
        feedbackEl.textContent =
          this.authTabMode === "register"
            ? `Hoş geldin @${p.username}! +150 Altın Kasan hazır!`
            : `Tekrar hoş geldin @${p.username}! Kasan eşitlendi.`;

        if (this.authTabMode === "register") {
          this.openCinematicEnvelope(
            `👑 @${p.username} Kayıt Hediyesi: Kişisel Kasanıza +150 Altın Eklendi!`,
            `📜 @${escapeHtml(p.username)} Kayıt Beratı<br/>&amp; +150 🪙 Kayıt Hediyesi`
          );
        }
        this.checkActiveServerSession();
      } catch {
        feedbackEl.textContent = "Sunucuya ulaşılamadı.";
      }
    });

    // Klavye Enter tuşu kısayolları (Kayıt, Hızlı Giriş, Oda Kurma ve Kodla Katılma)
    const bindEnterToClick = (inputId: string, buttonId: string) => {
      document.getElementById(inputId)?.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key === "Enter") {
          ev.preventDefault();
          (document.getElementById(buttonId) as HTMLButtonElement | null)?.click();
        }
      });
    };
    bindEnterToClick("input-guest-nick", "btn-quick-play");
    bindEnterToClick("input-acc-user", "btn-acc-submit");
    bindEnterToClick("input-acc-pin", "btn-acc-submit");
    bindEnterToClick("input-acc-nick", "btn-acc-submit");
    bindEnterToClick("input-create-title", "btn-create-room");
    bindEnterToClick("input-create-pass", "btn-create-room");
    bindEnterToClick("input-join-code", "btn-join-by-code");

    // Oda İşlemleri: Hızlı Giriş, Şifreli/Şifresiz Oda Kurma, Kodla Girme
    document.getElementById("btn-quick-play")?.addEventListener("click", () => {
      this.syncGuestNameFromInput();
      this.joinRoomFlow("quick");
    });

    // Oda Kurma Kutusu: Oyun Süresi (10 Dk / 20 Dk / 35 Dk / 1 Saat) & Kadro (8 / 10 / 12) Seçimi
    const updateCreateSummary = () => {
      const preset = MATCH_DURATION_PRESETS[this.createPaceMode];
      document.querySelectorAll("[data-create-pace]").forEach((el) => {
        el.classList.toggle("btn-crimson", (el as HTMLElement).dataset.createPace === this.createPaceMode);
      });
      document.querySelectorAll("[data-create-count]").forEach((el) => {
        el.classList.toggle(
          "btn-crimson",
          Number((el as HTMLElement).dataset.createCount) === this.createPlayerCount
        );
      });
      const descEl = document.getElementById("create-duration-desc");
      if (descEl) {
        descEl.textContent = `${preset.title} (${this.createPlayerCount} Kişi) — ${preset.summary}`;
      }
    };

    document.querySelectorAll("[data-create-pace]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = ((btn as HTMLElement).dataset.createPace || "20m") as MatchDurationMode;
        if (MATCH_DURATION_PRESETS[mode]) {
          this.createPaceMode = mode;
          this.createPlayerCount = MATCH_DURATION_PRESETS[mode].defaultPlayers;
          updateCreateSummary();
        }
      });
    });

    document.querySelectorAll("[data-create-count]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cnt = Number((btn as HTMLElement).dataset.createCount) as 8 | 10 | 12;
        if (cnt === 8 || cnt === 10 || cnt === 12) {
          this.createPlayerCount = cnt;
          updateCreateSummary();
        }
      });
    });
    updateCreateSummary();

    document.getElementById("btn-create-room")?.addEventListener("click", () => {
      this.syncGuestNameFromInput();
      const title = (document.getElementById("input-create-title") as HTMLInputElement).value.trim();
      const pass = (document.getElementById("input-create-pass") as HTMLInputElement).value.trim();
      this.joinRoomFlow("create", {
        roomTitle: title,
        roomPassword: pass,
        paceMode: this.createPaceMode,
        targetPlayerCount: this.createPlayerCount
      });
    });

    document.getElementById("btn-join-by-code")?.addEventListener("click", async () => {
      this.syncGuestNameFromInput();
      const raw = (document.getElementById("input-join-code") as HTMLInputElement).value.trim();
      if (!raw) return;
      await this.joinByRoomCode(raw);
    });

    document.getElementById("btn-refresh-rooms")?.addEventListener("click", () => {
      this.refreshLiveRooms();
    });

    document.getElementById("btn-menu-brightness")?.addEventListener("click", (e) => {
      const label = this.scene.cycleBrightnessBoost();
      (e.currentTarget as HTMLElement).textContent = label;
    });

    document.getElementById("btn-menu-inspect-self")?.addEventListener("click", () => {
      this.syncGuestNameFromInput();
      this.openMenuSelfInspect360();
    });

    this.refreshLiveRooms();
    setInterval(() => {
      if (!this.room) this.refreshLiveRooms();
    }, 4500);
  }

  private syncGuestNameFromInput(): void {
    const guestInput = document.getElementById("input-guest-nick") as HTMLInputElement;
    if (guestInput && guestInput.value.trim()) {
      this.vault.customName = guestInput.value.trim();
      this.saveVault(false);
    }
  }

  private async checkResumeOrDeepLink(): Promise<void> {
    // 1. Önce sayfa yenilemesi sonrası anlık Colyseus reconnectionToken dene
    const savedToken = sessionStorage.getItem("sofra_reconnect_token");
    if (savedToken) {
      try {
        const room = await this.client.reconnect(savedToken);
        this.bindActiveRoom(room);
        return;
      } catch {
        sessionStorage.removeItem("sofra_reconnect_token");
      }
    }

    // 2. URL'de ?oda=SOFRA-XXXX varsa otomatik o odayı bul
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get("oda");
    if (urlCode) {
      (document.getElementById("input-join-code") as HTMLInputElement).value = urlCode;
    }

    // 3. Sunucuda bu playerToken'a ait devam eden maç var mı bak
    await this.checkActiveServerSession();
  }

  private async checkActiveServerSession(): Promise<void> {
    try {
      const res = await fetch(
        `${this.apiBase}/active-session?token=${encodeURIComponent(this.vault.playerToken)}`
      );
      const data = await res.json();
      const banner = document.getElementById("resume-session-banner")!;
      const textEl = document.getElementById("resume-session-text")!;
      const btn = document.getElementById("btn-resume-session")!;

      if (data?.session?.roomId) {
        this.activeReconnectRoomId = String(data.session.roomId);
        banner.classList.remove("hidden");
        textEl.textContent = `${data.session.roomTitle} (${data.session.code}) — Durum: ${data.session.phase}`;
        btn.onclick = () => {
          this.joinRoomFlow("byId", { roomId: data.session.roomId });
        };
      } else {
        this.activeReconnectRoomId = "";
        banner.classList.add("hidden");
      }
    } catch {
      // ignore
    }
  }

  private async refreshLiveRooms(): Promise<void> {
    const listEl = document.getElementById("live-rooms-list");
    if (!listEl) return;
    try {
      const res = await fetch(`${this.apiBase}/rooms`);
      const data = await res.json();
      const rooms: RoomSummary[] = data.rooms || [];

      if (rooms.length === 0) {
        listEl.innerHTML = `
          <div style="font-size:0.8rem; color:var(--text-muted); padding:6px;">
            Şu an açık oda yok. İlk sofrayı hemen yukarıdan sen kur!
          </div>
        `;
        return;
      }

      listEl.innerHTML = rooms
        .map((r) => {
          const preset = resolveDurationPreset(r.paceMode, r.fastMode);
          const cap = r.targetPlayerCount || r.maxClients;
          const isLobby = r.phase === "LOBBY";
          const isMyActiveRoom = !isLobby && this.activeReconnectRoomId === r.roomId;
          const canJoin = isLobby || isMyActiveRoom;
          const safeTitle = escapeHtml(String(r.roomTitle || "Sofra Odası"));
          const safeCode = escapeHtml(String(r.code || "---"));
          const safeHost = escapeHtml(String(r.hostNick || "Kurucu"));
          return `
        <div class="room-row">
          <div style="min-width:0;">
            <div style="font-weight:bold; font-size:0.85rem; color:var(--gold); display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <span>${r.hasPassword ? "🔒" : "🔓"} ${safeTitle}</span>
              <span style="font-size:0.69rem; padding:1px 6px; border-radius:99px; background:rgba(226,189,83,0.16); border:1px solid var(--gold-soft); color:#ffe6a1;">${preset.badge}</span>
              <span style="font-size:0.72rem; color:var(--text-muted);">(${safeCode})</span>
            </div>
            <div style="font-size:0.72rem; color:var(--text-muted);">
              Kurucu: ${safeHost} · Kadro: ${r.playerCount}/${cap} · ${
            isLobby ? "🟢 Lobide" : isMyActiveRoom ? "🔄 Senin Maçın" : "🔥 Maç Devam Ediyor"
          }
            </div>
          </div>
          ${
            canJoin
              ? `<button
                  class="btn ${isLobby ? "btn-crimson" : "btn-emerald"}"
                  data-join-id="${escapeHtml(r.roomId)}"
                  data-has-pass="${r.hasPassword ? "1" : "0"}"
                >
                  ${isLobby ? "Katıl" : "🔄 Oyuna Dön"}
                </button>`
              : `<button class="btn" disabled style="opacity:0.5; cursor:not-allowed;" title="Başlamış maça dışarıdan girilemez">
                  🔥 Oyunda
                </button>`
          }
        </div>
      `;
        })
        .join("");

      listEl.querySelectorAll("[data-join-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.syncGuestNameFromInput();
          const el = btn as HTMLElement;
          const roomId = el.dataset.joinId!;
          const hasPass = el.dataset.hasPass === "1";
          let pass = "";
          if (hasPass) {
            pass = window.prompt("🔒 Bu oda şifreli! Oda şifresini girin:") || "";
            if (!pass) return;
          }
          this.joinRoomFlow("byId", { roomId, roomPassword: pass });
        });
      });
    } catch {
      listEl.innerHTML = `<div style="font-size:0.8rem; color:#ff7585;">Sunucuya bağlanılıyor...</div>`;
    }
  }

  private async joinByRoomCode(rawCode: string): Promise<void> {
    try {
      const code = normalizeRoomCode(rawCode);
      const res = await fetch(`${this.apiBase}/find-room?code=${encodeURIComponent(code)}`);
      const info = await res.json();
      if (!res.ok) {
        alert(info.error || "Oda bulunamadı.");
        return;
      }
      let pass = "";
      if (info.hasPassword) {
        pass = window.prompt(`🔒 ${info.roomTitle} şifreli bir oda! Şifreyi girin:`) || "";
        if (!pass) return;
      }
      await this.joinRoomFlow("byId", { roomId: info.roomId, roomPassword: pass });
    } catch {
      alert("Oda sorgulanırken bağlantı hatası oluştu.");
    }
  }

  private async joinRoomFlow(
    mode: "quick" | "create" | "byId",
    extra?: {
      roomId?: string;
      roomTitle?: string;
      roomPassword?: string;
      paceMode?: string;
      targetPlayerCount?: number;
    }
  ): Promise<void> {
    try {
      const charDef =
        CHARACTERS.find((c) => c.seat === this.vault.selectedSeat) ?? CHARACTERS[0];
      const opts = {
        nick: this.vault.customName || charDef.name,
        playerToken: this.vault.playerToken,
        seat: this.vault.selectedSeat,
        coatColor: this.vault.coatColor,
        accentColor: this.vault.accentColor,
        hat: this.vault.hat,
        mask: this.vault.mask,
        roomTitle: extra?.roomTitle || "",
        roomPassword: extra?.roomPassword || "",
        paceMode: extra?.paceMode || "20m",
        targetPlayerCount: extra?.targetPlayerCount || 10
      };

      let room: Room;
      if (mode === "create") {
        room = await this.client.create(SOFRA_CONFIG.ROOM_NAME, opts);
      } else if (mode === "byId" && extra?.roomId) {
        room = await this.client.joinById(extra.roomId, opts);
      } else {
        room = await this.client.joinOrCreate(SOFRA_CONFIG.ROOM_NAME, opts);
      }

      this.bindActiveRoom(room);
    } catch (err: any) {
      alert(err?.message || "Odaya katılırken hata oluştu (Şifre yanlış veya oyun başlamış olabilir).");
    }
  }

  private bindActiveRoom(room: Room): void {
    this.room = room;
    this.previewSelfOnMenu = false;
    this.scene.inspectTargetId = null;
    this.inspectedFromHandbook = false;
    this.myQuests = [];
    this.activeTrial = null;
    this.traitorNightPicks.clear();
    this.nightConclaveLogs = [];
    this.nightWatchNote = "";
    this.gameOverSummary = null;
    this.myHasSecretNecklace = false;
    this.activeTrialSecretResult = null;
    this.lastVoteReveal = [];
    this.lastDayExtraKey = "";
    this.isLocalReadyForPhase = false;
    this.isNightSealed = false;
    this.tieCandidateIds = null;
    this.lastLocalServerVoted = false;
    this.lastCountdownSec = -1;
    this.usedStationIdsThisRound.clear();
    this.closeCharacterContextMenu();
    this.closeHudGearMenu();
    sessionStorage.setItem("sofra_reconnect_token", room.reconnectionToken);

    document.getElementById("main-menu-overlay")?.classList.add("hidden");
    document.getElementById("inspect-overlay")?.classList.add("hidden");
    document.getElementById("puzzle-modal")?.classList.add("hidden");
    this.closeHandbookModal();
    this.loadHandbookFromSession();
    document.getElementById("hud")?.classList.remove("hidden");
    document.getElementById("chat-log")!.innerHTML = "";
    this.pmThreads.clear();
    this.renderPMWindows();
    this.syncCameraZoomUI();
    this.lastCenterRenderHash = "";

    room.onMessage("role_envelope", (payload: SecretRolePayload & {
      myVotedTargetId?: string;
      tieCandidates?: string[];
      isNightSealed?: boolean;
      myFinalDecision?: "TRUST" | "DOUBT" | "";
      hasSecretNecklace?: boolean;
    }) => {
      const roleChanged = !this.myRole || this.myRole.role !== payload.role;
      this.myRole = payload;
      if (typeof payload.hasSecretNecklace === "boolean") {
        this.myHasSecretNecklace = payload.hasSecretNecklace;
      }
      if (typeof payload.myVotedTargetId === "string" && payload.myVotedTargetId) {
        this.selectedVoteTargetId = payload.myVotedTargetId;
      }
      if (Array.isArray(payload.tieCandidates)) {
        this.tieCandidateIds = payload.tieCandidates.length > 0 ? payload.tieCandidates : null;
      }
      if (typeof payload.isNightSealed === "boolean") {
        this.isNightSealed = payload.isNightSealed;
      }
      if (payload.myFinalDecision === "TRUST" || payload.myFinalDecision === "DOUBT") {
        this.selectedFinalChoice = payload.myFinalDecision;
      }
      if (roleChanged) {
        sfx.playSealBreak();
      }
      const pill = document.getElementById("my-role-pill")!;
      pill.classList.remove("hidden", "role-hain", "role-misafir");
      const neckSuffix = this.myHasSecretNecklace ? " · 📿 Gizli Kolye" : "";
      if (payload.role === "HAIN") {
        pill.classList.add("role-hain");
        pill.textContent = `🗡️ HAİN${neckSuffix}`;
      } else {
        pill.classList.add("role-misafir");
        pill.textContent = `🕯️ MİSAFİR${neckSuffix}`;
      }
      const matesText =
        payload.role === "HAIN" && payload.traitorMates?.length
          ? ` Gizli suç ortağın: ${payload.traitorMates.map((m) => `#${m.seat} ${m.nick}`).join(", ")}.`
          : "";
      this.addClueEntry({
        category: "note",
        icon: payload.role === "HAIN" ? "🗡️" : "🕯️",
        source: "Gizli Rol Zarfın",
        text: escapeHtml(
          payload.role === "HAIN"
            ? `Rolün: HAİN! Gündüz şüpheleri dağıt, gece mecliste infaz kararı ver.${matesText}`
            : "Rolün: MİSAFİR! Şatodaki ipuçlarını topla, fısıltı barlarını incele ve Hainleri şömineye gönder."
        ),
        dedupeKey: "role_envelope_match",
        silent: true
      });
      this.lastCenterRenderHash = "";
    });

    room.onMessage(
      "chat_msg",
      (msg: { senderId: string; senderNick: string; seat?: number; channel: string; text: string }) => {
        if (msg.senderId && this.mutedPlayerIds.has(msg.senderId)) return;
        if (msg.senderId !== room.sessionId) {
          sfx.playChatTick();
        }
        this.appendChatMessage(msg.senderId, msg.senderNick, msg.channel, msg.text);
        if (msg.channel === "HAİN MECLİSİ") {
          this.nightConclaveLogs.push(`${escapeHtml(String(msg.senderNick || ""))}: ${escapeHtml(String(msg.text || ""))}`);
          if (this.nightConclaveLogs.length > 14) this.nightConclaveLogs.shift();
          this.lastCenterRenderHash = "";
        } else {
          this.scene.setCharacterChatBubble(msg.senderId, msg.text);
        }
      }
    );

    // KNIGHT ONLINE ÖZEL PM / DM MESAJI GELDİ!
    room.onMessage(
      "pm_msg",
      (pm: {
        fromId: string;
        fromNick: string;
        fromSeat: number;
        toId: string;
        toNick: string;
        toSeat: number;
        text: string;
      }) => {
        const fromMe = pm.fromId === room.sessionId;
        if (!fromMe && this.mutedPlayerIds.has(pm.fromId)) return;
        const peerId = fromMe ? pm.toId : pm.fromId;
        const peerNick = fromMe ? pm.toNick : pm.fromNick;
        const peerSeat = fromMe ? pm.toSeat : pm.fromSeat;

        let thread = this.pmThreads.get(peerId);
        if (!thread) {
          const curPhase = (this.room?.state as any)?.phase || "";
          const inSelectionPhase =
            curPhase === "VOTE" || curPhase === "NIGHT" || curPhase === "FINAL" || curPhase === "TRIAL";
          const anyExpanded = Array.from(this.pmThreads.values()).some((t) => !t.minimized);
          const startMinimized = !fromMe && (anyExpanded || inSelectionPhase);
          thread = {
            peerId,
            peerNick,
            peerSeat,
            minimized: startMinimized,
            unread: startMinimized,
            messages: []
          };
          if (!startMinimized) {
            this.pmThreads.forEach((other) => {
              other.minimized = true;
            });
          }
          this.pmThreads.set(peerId, thread);
        }
        thread.messages.push({
          fromMe,
          senderNick: fromMe ? "Sen" : pm.fromNick,
          text: pm.text
        });
        if (!fromMe) {
          sfx.playWhisperPing();
          if (thread.minimized) thread.unread = true;
        }
        this.renderPMWindows();
      }
    );

    room.onMessage("pm_error", (err: { text: string }) => {
      sfx.playDoorLocked();
      this.appendChatMessage("", "UYARI", "FISILTI", err.text);
    });

    room.onMessage("bell_tolls", () => {
      sfx.playCastleBell();
    });

    room.onMessage("fireplace_burn", (d: { flame?: string }) => {
      const isRed = d?.flame === "RED";
      this.scene.triggerFireplaceFlame(isRed ? "red" : "white");
      sfx.playFireWhoosh(isRed);
    });

    room.onMessage(
      "farewell_letter",
      (data: { seat: number; nick: string; flame: string; roleLabel: string; note: string }) => {
        const isRed = data.flame === "RED";
        this.confirmedSeatFlames[data.seat] = isRed ? "RED" : "WHITE";
        this.scene.triggerFireplaceFlame(isRed ? "red" : "white");
        sfx.playFireWhoosh(isRed);
        this.showFarewellToast(data);
        this.addClueEntry({
          category: "fire",
          icon: isRed ? "🔥" : "❄️",
          source: "Veda Mektubu & Şömine",
          text: escapeHtml(
            `Koltuk #${data.seat} ${data.nick} ayrıldı (${isRed ? "KIRMIZI ALEV = HAİN!" : "BEYAZ ALEV = MASUM"}): "${data.note}"`
          ),
          dedupeKey: `farewell_${data.seat}`
        });
      }
    );

    room.onMessage("match_reward", (data: { bonusGold: number; won: boolean }) => {
      this.vault.gold += data.bonusGold;
      this.saveVault(false);
      sfx.playGoldChime();
    });

    room.onMessage("door_sfx", (data: { doorId: string; open: boolean; locked?: boolean }) => {
      if (data.locked) {
        sfx.playDoorLocked();
      } else {
        sfx.playDoorCreak(data.open);
      }
    });

    // 🔍 KARAKTER İNCELE & ARKADAŞLIK / FISILTI YAKINLIK BARI SONUCU
    room.onMessage("inspect_result", (data: any) => {
      this.renderInspectOverlay(data);
      const strongBonds = Array.isArray(data?.topBonds)
        ? data.topBonds.filter((b: any) => Number(b.score) >= 25).slice(0, 3)
        : [];
      if (strongBonds.length > 0) {
        const rnd = (this.room?.state as any)?.round || 1;
        const bondSummary = strongBonds
          .map((b: any) => `#${b.seat} ${b.nick} (%${b.score} ${b.tier})`)
          .join(", ");
        this.addClueEntry({
          category: "clue",
          icon: "🔍",
          source: `Yakınlık Raporu (#${data.seat} ${escapeHtml(String(data.nick || ""))})`,
          text: escapeHtml(`Güçlü fısıltı bağları: ${bondSummary} · Konum: ${data.roomName}`),
          dedupeKey: `insp_${rnd}_${data.seat}_${strongBonds.map((b: any) => b.seat).join("-")}`,
          silent: true
        });
      }
    });

    // 📜 KİŞİSEL GİZLİ GÖREVLER ("Bunla Yakınlaş, Bunla Konuş" + Şato Görevleri)
    room.onMessage("quests_update", (data: { round: number; quests: any[] }) => {
      this.myQuests = data.quests || [];
      this.renderDayQuests();
      if (this.handbookOpen) this.renderHandbookModal();
    });

    room.onMessage("quest_completed", (data: { title: string; rewardGold: number }) => {
      sfx.playGoldChime();
      this.appendChatMessage(
        "",
        "GÖREV TAMAMLANDI",
        "ÖDÜL",
        `✅ ${data.title} (+${data.rewardGold}🪙 Kasanıza Eklendi!)`
      );
    });

    // 🧩 GÜNDÜZ ETKİNLİK KÜRSÜSÜ BULMACASI
    room.onMessage(
      "puzzle_challenge",
      (ch: { puzzleId: string; title: string; prompt: string; options: string[] }) => {
        sfx.playRuneChime();
        this.renderDayPuzzleModal(ch);
      }
    );

    room.onMessage("puzzle_feedback", (fb: { ok: boolean; bonusGold?: number; text: string; isClue?: boolean }) => {
      if (fb.bonusGold) {
        this.vault.gold += fb.bonusGold;
        this.saveVault(false);
        sfx.playGoldChime();
      } else if (fb.ok) {
        sfx.playSuccessChord();
      } else {
        sfx.playDoorLocked();
      }

      const rawText = String(fb.text || "");
      const isCosmeticOrActionOnly =
        fb.isClue === false ||
        /^(🪖|🧙|🎭|🛡️|✨ Simya Taşı|🔔 Zindan zincirlerini|⛲ Kuyunun suları|🗡️ Şato düzeneğini gizlice SABOTE|📜 İsimsiz mühürsüz not gizlice|🌑 Gölge İksiri|🧪 Dostluk İksiri|🧪 İksir sana)/.test(
          rawText
        );

      if (fb.ok && rawText && !isCosmeticOrActionOnly) {
        const rnd = (this.room?.state as any)?.round || 1;
        this.addClueEntry({
          category: "clue",
          icon: "🔮",
          source: "Şato Keşif & Kürsü İpucu",
          text: escapeHtml(rawText),
          dedupeKey: `puz_${rnd}_${rawText}`
        });
      }

      const customTitle = !fb.ok
        ? "⚠️ İŞLEM TAMAMLANAMADI"
        : isCosmeticOrActionOnly
        ? "✨ ŞATO ETKİLEŞİMİ TAMAMLANDI!"
        : "🔮 YENİ DEDEKTİF KANITI AÇILDI!";
      this.showPuzzleFeedbackModal(rawText, fb.ok, customTitle);
    });

    // 🔔 "EVET, OYUN ZAMANI!" (1 DAKİKALIK DONDURMA & GİZLİ ALTIN KOLYE YARIŞI)
    room.onMessage("trial_challenge", (ch: any) => {
      this.activeTrial = ch;
      this.activeTrialSecretResult = null;
      this.lastCenterRenderHash = "";
    });

    room.onMessage(
      "trial_completed",
      (res: { wonNecklace: boolean; pendingSecretResult?: boolean; clueText: string }) => {
        sfx.playSuccessChord();
        if (this.activeTrial) {
          this.activeTrial.stage = 4;
          this.activeTrial.completedClue = res.clueText;
        }
        const rnd = (this.room?.state as any)?.round || 1;
        this.addClueEntry({
          category: "clue",
          icon: "🧩",
          source: "Oyun Zamanı Kanıtı",
          text: escapeHtml(res.clueText),
          dedupeKey: `trial_${rnd}_${res.clueText}`
        });
        this.lastCenterRenderHash = "";
      }
    );

    room.onMessage(
      "trial_secret_result",
      (res: { wonNecklace: boolean; someoneWon: boolean; reason?: string; text: string }) => {
        this.activeTrialSecretResult = res;
        this.myHasSecretNecklace = Boolean(res.wonNecklace);
        if (res.wonNecklace) {
          sfx.playSuccessChord();
          sfx.playGoldChime();
          const rnd = (this.room?.state as any)?.round || 1;
          this.addClueEntry({
            category: "note",
            icon: "📿",
            source: "Gizli Altın Kolye (Sadece Sen Biliyorsun)",
            text: "Bu tur Altın Kolyeyi kimsenin haberi olmadan SEN kazandın! Gece Hainler seni hedef seçerse infaz başarısız olacak.",
            dedupeKey: `secret_neck_${rnd}`
          });
        } else {
          sfx.playCastleBell();
        }
        const pill = document.getElementById("my-role-pill");
        if (pill && this.myRole) {
          const neckSuffix = this.myHasSecretNecklace ? " · 📿 Gizli Kolye" : "";
          pill.textContent = this.myRole.role === "HAIN" ? `🗡️ HAİN${neckSuffix}` : `🕯️ MİSAFİR${neckSuffix}`;
        }
        this.lastCenterRenderHash = "";
      }
    );

    // ⏩ ERKEN HAZIR SAYACI
    room.onMessage("ready_count_update", (d: { readyCount: number; totalHumans: number }) => {
      this.readyStatusText = `(${d.readyCount}/${d.totalHumans})`;
      const btn = document.getElementById("btn-ready-phase");
      if (btn) {
        btn.textContent = `${this.isLocalReadyForPhase ? "✅ Hazırım" : "⏩ Hazırım"} ${this.readyStatusText}`;
      }
      this.lastCenterRenderHash = "";
    });

    // 🗡️ GECE HAİNLER MECLİSİ CANLI İNFAZ SEÇİMLERİ & KAPI DİNLEME
    room.onMessage("traitor_pick_update", (d: any) => {
      this.traitorNightPicks.set(d.traitorId, d);
      if (d.traitorId === room.sessionId && d.targetId) {
        this.selectedNightTargetId = d.targetId;
      }
      this.lastCenterRenderHash = "";
    });

    room.onMessage("night_watch_result", (d: { text: string }) => {
      this.nightWatchNote = d.text;
      sfx.playClueChime();
      const rnd = (this.room?.state as any)?.round || 1;
      this.addClueEntry({
        category: "clue",
        icon: "🕯️",
        source: "Gece Kapı Deliği Gözlemi",
        text: escapeHtml(d.text),
        dedupeKey: `watch_${rnd}_${d.text}`
      });
      this.lastCenterRenderHash = "";
    });

    // 💀 SABAH GECE İNFAZI SAHNESİ
    room.onMessage(
      "night_execution_event",
      (ev: { protectedByNecklace: boolean; victimId: string; victimSeat: number; victimNick: string }) => {
        sfx.playCastleBell();
        const rnd = (this.room?.state as any)?.round || 1;
        if (ev.protectedByNecklace) {
          this.showExecutionToast(
            "📿 ALTIN KOLYE İNFAZI DURDURDU!",
            "Gece Hainler Meclisi infaz mührünü bastı ancak Altın Kolye parlayarak sahibini ölümden kurtardı!",
            false,
            "🌅 SABAH GECE İNFAZI RAPORU"
          );
          this.addClueEntry({
            category: "fire",
            icon: "📿",
            source: "Gece İnfazı Engellendi",
            text: "Gece Hainler Meclisi infaz mührü bastı fakat Altın Kolye hedef alınan kişiyi ölümden kurtardı!",
            dedupeKey: `night_save_${rnd}`
          });
        } else if (ev.victimId) {
          this.confirmedSeatFlames[ev.victimSeat] = "EXEC";
          if (this.preTargetSeat === ev.victimSeat) {
            this.preTargetSeat = 0;
          }
          const isMe = ev.victimId === this.room?.sessionId;
          this.showExecutionToast(
            isMe ? "💀 HAİNLER TOPLANTISINDA İNFAZ EDİLDİN!" : `🩸 GECE İNFAZI: KOLTUK #${ev.victimSeat}`,
            isMe
              ? "Gece Hainler Meclisi senin için infaz kararı verdi! Porselen tabağın ters çevrildi; artık Hayalet olarak şatoda süzülüp oyun sonunu izleyebilirsin."
              : `Hainler gece toplantısında Koltuk #${ev.victimSeat} (${ev.victimNick}) için İNFAZ mührü bastı!`,
            true,
            "🕯️ GECE HAİNLER MECLİSİ HÜKMÜ"
          );
          this.addClueEntry({
            category: "fire",
            icon: "🩸",
            source: "Gece Hainler Meclisi İnfazı",
            text: escapeHtml(
              `Koltuk #${ev.victimSeat} (${ev.victimNick}) gece Hainler toplantısında infaz edildi (Masum Misafirdi)!`
            ),
            dedupeKey: `night_exec_${ev.victimSeat}`
          });
        }
      }
    );

    room.onMessage("game_over_roles", (summary: any) => {
      this.gameOverSummary = summary;
      this.lastCenterRenderHash = "";
    });

    // 🗳️ ŞÖMİNE ÖNCESİ KİM KİME OY VERDİ AÇIKLAMASI & BERABERLİK TESPİTİ
    room.onMessage(
      "vote_reveal",
      (d: {
        votes: Array<{ voterSeat: number; voterNick: string; targetSeat: number; targetNick: string }>;
        counts?: Record<string, number>;
        tieCandidates?: string[];
        isTie?: boolean;
      }) => {
        this.lastVoteReveal = d.votes || [];
        if (Array.isArray(d.tieCandidates) && d.tieCandidates.length > 0) {
          this.tieCandidateIds = d.tieCandidates;
          this.selectedVoteTargetId = "";
          sfx.playTensionDrum();
        } else if (d.counts && !this.tieCandidateIds) {
          // counts içinden en yüksek oy sayısında birden fazla kişi eşit kaldıysa ikinci tur adaylarını hazırla
          const entries = Object.entries(d.counts).filter(([, c]) => Number(c) > 0);
          if (entries.length >= 2) {
            const maxC = Math.max(...entries.map(([, c]) => Number(c)));
            const tops = entries.filter(([, c]) => Number(c) === maxC).map(([id]) => id);
            if (tops.length > 1) {
              this.tieCandidateIds = tops;
              this.selectedVoteTargetId = "";
              sfx.playTensionDrum();
            }
          }
        }
        if (this.lastVoteReveal.length > 0) {
          const rnd = (this.room?.state as any)?.round || 1;
          const summary = this.lastVoteReveal
            .map((v) =>
              v.targetSeat > 0
                ? `#${v.voterSeat} ${v.voterNick} ➔ #${v.targetSeat} ${v.targetNick}`
                : `#${v.voterSeat} ${v.voterNick} ➔ 🏳️ Çekimser`
            )
            .join(" · ");
          this.addClueEntry({
            category: "fire",
            icon: "🗳️",
            source: "Yuvarlak Sofra Açık Oy Dökümü",
            text: escapeHtml(summary),
            dedupeKey: `votes_${rnd}_${summary}`
          });
        }
        this.lastCenterRenderHash = "";
      }
    );

    // 🕯️ GÜNDÜZ HAİN SABOTAJI: 12 SANİYE ŞATO KARARTMASI
    room.onMessage("blackout_event", (d: { durationSec: number }) => {
      this.scene.triggerBlackout(d?.durationSec || 12);
      sfx.playSabotageDark();
      this.showExecutionToast(
        "🕯️ ŞATODA KARARTMA SABOTAJI!",
        "Gizli bir Hain avizeleri ve şamdanları söndürdü! 12 saniye boyunca karanlıkta kimseye sırtını dönme!",
        true,
        "🕯️ KARANLIK SABOTAJ ALARMI"
      );
    });

    // 📜 GÜNDÜZ HAİN SABOTAJI: İSİMSİZ SAHTE NOT
    room.onMessage("anonymous_note", (d: { text: string }) => {
      sfx.playWhisperPing();
      const rnd = (this.room?.state as any)?.round || 1;
      this.addClueEntry({
        category: "clue",
        icon: "📜",
        source: "Cebe Bırakılan İsimsiz Not (⚠️ Sahte Olabilir)",
        text: escapeHtml(`"${d.text}"`),
        dedupeKey: `anon_${rnd}_${d.text}`
      });
      this.showExecutionToast(
        "📜 CEBİNE İSİMSİZ BİR NOT BIRAKILDI!",
        `"${d.text}"`,
        true,
        "📜 GİZLİ İHBAR NOTU"
      );
    });

    // 🔔 KÂHYA ZİLİ GİZLİ TAKIM YANITI
    room.onMessage("kahya_answer", (d: { sameTeam: boolean; text: string }) => {
      sfx.playGoldChime();
      const rnd = (this.room?.state as any)?.round || 1;
      this.addClueEntry({
        category: "clue",
        icon: "🔔",
        source: "Kâhya Zili Takım Sorgusu (50🪙)",
        text: escapeHtml(d.text),
        dedupeKey: `kahya_${rnd}_${d.text}`
      });
      this.showPuzzleFeedbackModal(d.text, true, "🔔 KÂHYA ZİLİ GİZLİ YANITI");
    });

    // 👻 HAYALET ŞAMDAN TİTRETMESİ
    room.onMessage("ghost_flicker", () => {
      this.scene.triggerGhostFlicker();
      sfx.playNightWind();
    });

    // Olası özel durum geri yükleme mesajı (yeniden bağlanma desteği)
    room.onMessage("my_private_Choices", (d: { voteTargetId?: string; finalChoice?: "TRUST" | "DOUBT"; tieCandidates?: string[] }) => {
      if (d?.voteTargetId) this.selectedVoteTargetId = d.voteTargetId;
      if (d?.finalChoice) this.selectedFinalChoice = d.finalChoice;
      if (Array.isArray(d?.tieCandidates)) this.tieCandidateIds = d.tieCandidates;
      this.lastCenterRenderHash = "";
    });

    room.onStateChange((state: any) => {
      sessionStorage.setItem("sofra_reconnect_token", room.reconnectionToken);
      const me = state.players?.get(room.sessionId);
      if (me) {
        if (state.phase === "LOBBY" && me.seat && me.seat !== this.vault.selectedSeat) {
          this.vault.selectedSeat = me.seat;
          this.saveVault(false);
        }
        if (state.phase !== "DAY") {
          this.localX = me.x;
          this.localZ = me.z;
          this.localRotY = me.rotY;
        }
        if (state.phase === "VOTE") {
          const serverVotedNow = Boolean(me.votedForId);
          // İkinci tur beraberlik (TIE_VOTE) başladığında sunucu votedForId'yi sıfırlar -> yerelde de kilidi aç!
          if (this.lastLocalServerVoted && !serverVotedNow) {
            this.selectedVoteTargetId = "";
            this.lastCenterRenderHash = "";
          } else if (!this.selectedVoteTargetId && serverVotedNow) {
            // Sayfa yenileyip geri dönen oyuncu için mühürlü oy bilgisini koru
            this.selectedVoteTargetId = me.votedForId === "ABSTAIN" ? "ABSTAIN" : me.votedForId;
          }
          this.lastLocalServerVoted = serverVotedNow;
        } else {
          this.lastLocalServerVoted = false;
        }
      }
      // Elenen koltuk Ön-Hedef ise temizle
      if (this.preTargetSeat > 0) {
        let preStillAlive = false;
        state.players?.forEach((p: any) => {
          if (p.seat === this.preTargetSeat && p.alive) preStillAlive = true;
        });
        if (!preStillAlive) {
          this.preTargetSeat = 0;
        }
      }
    });

    // Bağlanır bağlanmaz (veya yeniden bağlanmada) gizli rolümüzü ve aktif seçim ekranı verisini kesin olarak iste!
    room.send("request_my_state");
    setTimeout(() => {
      if (this.room === room) {
        room.send("request_my_state");
      }
    }, 450);

    room.onLeave((code) => {
      // Kendi isteği dışında koptuysa otomatik yeniden bağlanmayı dene!
      if (code !== 1000 && code !== 4000) {
        const tok = sessionStorage.getItem("sofra_reconnect_token");
        if (tok) {
          this.client
            .reconnect(tok)
            .then((reRoom) => this.bindActiveRoom(reRoom))
            .catch(() => this.returnToMainMenu());
          return;
        }
      }
      this.returnToMainMenu();
    });
  }

  private showFarewellToast(data: { seat: number; nick: string; flame: string; roleLabel: string; note: string }): void {
    const toast = document.getElementById("farewell-toast")!;
    const isRed = data.flame === "RED";
    if (this.toastHideTimer) clearTimeout(this.toastHideTimer);
    toast.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <span style="font-size:0.74rem; letter-spacing:1.3px; color:var(--gold);">
          📜 MASAYA BIRAKILAN VEDA MEKTUBU
        </span>
        <button class="btn" id="btn-close-toast-x" style="padding:1px 7px; font-size:0.7rem;">✕</button>
      </div>
      <h3 style="margin:4px 0; font-size:0.98rem; color:${isRed ? "#ff4d5e" : "#9ed4ff"};">
        Koltuk #${Number(data.seat)} ${escapeHtml(String(data.nick || ""))} (${escapeHtml(String(data.roleLabel || ""))})
      </h3>
      <p style="font-style:italic; font-size:0.86rem; color:var(--parchment); line-height:1.4;">
        "${escapeHtml(String(data.note || ""))}"
      </p>
    `;
    toast.classList.remove("hidden");
    document.getElementById("btn-close-toast-x")?.addEventListener("click", () => {
      toast.classList.add("hidden");
    });
    this.toastHideTimer = window.setTimeout(() => toast.classList.add("hidden"), 6000);
  }

  private showExecutionToast(
    title: string,
    body: string,
    isDanger: boolean,
    headerLabel = "🕯️ ŞATO DUYURUSU"
  ): void {
    const toast = document.getElementById("farewell-toast")!;
    if (this.toastHideTimer) clearTimeout(this.toastHideTimer);
    toast.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <span style="font-size:0.74rem; letter-spacing:1.3px; color:var(--gold);">
          ${escapeHtml(headerLabel)}
        </span>
        <button class="btn" id="btn-close-toast-x" style="padding:1px 7px; font-size:0.7rem;">✕</button>
      </div>
      <h3 style="margin:4px 0; font-size:0.98rem; color:${isDanger ? "#ff4d5e" : "#ffd166"};">
        ${escapeHtml(title)}
      </h3>
      <p style="font-size:0.86rem; color:var(--parchment); line-height:1.4;">
        ${escapeHtml(body)}
      </p>
    `;
    toast.classList.remove("hidden");
    document.getElementById("btn-close-toast-x")?.addEventListener("click", () => {
      toast.classList.add("hidden");
    });
    this.toastHideTimer = window.setTimeout(() => toast.classList.add("hidden"), 5800);
  }

  private returnToMainMenu(): void {
    this.room = null;
    this.myRole = null;
    this.lastPhase = "";
    this.previewSelfOnMenu = false;
    this.scene.inspectTargetId = null;
    this.inspectedFromHandbook = false;
    this.myQuests = [];
    this.activeTrial = null;
    this.traitorNightPicks.clear();
    this.nightConclaveLogs = [];
    this.nightWatchNote = "";
    this.gameOverSummary = null;
    this.tieCandidateIds = null;
    this.isLocalReadyForPhase = false;
    this.isNightSealed = false;
    this.resetPointersFn?.();
    this.closeCharacterContextMenu();
    this.closeHudGearMenu();
    document.body.classList.remove("in-day-mode", "in-fire-mode");
    document.getElementById("day-action-hud")?.classList.remove("day-active");
    document.getElementById("hud")?.classList.add("hidden");
    document.getElementById("my-role-pill")?.classList.add("hidden");
    document.getElementById("inspect-overlay")?.classList.add("hidden");
    document.getElementById("puzzle-modal")?.classList.add("hidden");
    document.getElementById("farewell-toast")?.classList.add("hidden");
    this.closeHandbookModal();
    document.getElementById("main-menu-overlay")?.classList.remove("hidden");
    this.scene.syncCharacters([], 0);
    this.syncCameraZoomUI();
    this.refreshLiveRooms();
    this.checkActiveServerSession();
  }

  // ==========================================================================
  // KNIGHT ONLINE PM / DM PENCERELERİ & ALT SOHBET
  // ==========================================================================
  public openPMThread(peerId: string, peerNick: string, peerSeat: number): void {
    if (!this.room || peerId === this.room.sessionId) return;
    // Ekran kalabalığını önlemek için aynı anda en fazla 1 PM penceresi açık kalsın (diğerleri ince başlığa küçülsün)
    this.pmThreads.forEach((other, oid) => {
      if (oid !== peerId) other.minimized = true;
    });
    let thread = this.pmThreads.get(peerId);
    if (!thread) {
      thread = {
        peerId,
        peerNick,
        peerSeat,
        minimized: false,
        unread: false,
        messages: []
      };
      this.pmThreads.set(peerId, thread);
    } else {
      thread.minimized = false;
      thread.unread = false;
    }
    this.renderPMWindows();
  }

  private renderPMWindows(): void {
    const container = document.getElementById("ko-pm-container")!;
    container.innerHTML = "";

    for (const [peerId, th] of this.pmThreads.entries()) {
      const isMuted = this.mutedPlayerIds.has(peerId);
      const safePeerNick = escapeHtml(String(th.peerNick || "Oyuncu"));
      const safePeerId = escapeHtml(peerId);
      const win = document.createElement("div");
      win.className = "ko-pm-window";
      win.innerHTML = `
        <div class="ko-pm-header ${th.unread ? "unread-pulse" : ""}">
          <span>🤫 [PM] #${Number(th.peerSeat)} ${safePeerNick}</span>
          <div style="display:flex; gap:5px;">
            <button class="btn ko-pm-act-btn" data-pm-mute="${safePeerId}" title="${isMuted ? "Sesi Aç" : "Sustur"}">${
        isMuted ? "🔇" : "🔊"
      }</button>
            <button class="btn ko-pm-act-btn" data-pm-min="${safePeerId}">${
        th.minimized ? "▢" : "—"
      }</button>
            <button class="btn btn-crimson ko-pm-act-btn" data-pm-close="${safePeerId}">✕</button>
          </div>
        </div>
        <div class="ko-pm-body ${th.minimized ? "hidden" : ""}">
          <div class="ko-pm-messages">
            ${
              th.messages.length === 0
                ? `<div style="color:var(--text-muted); font-style:italic;">Gizli 1'e 1 fısıltı başlat...</div>`
                : th.messages
                    .map(
                      (m) =>
                        `<div><strong style="color:${m.fromMe ? "#ffd700" : "#e3b3ff"};">${escapeHtml(
                          String(m.senderNick || "")
                        )}:</strong> ${escapeHtml(String(m.text || ""))}</div>`
                    )
                    .join("")
            }
          </div>
          <form class="ko-pm-form" data-pm-form="${safePeerId}">
            <input type="text" maxlength="120" placeholder="#${Number(th.peerSeat)} ${safePeerNick} kişisine fısılda..." />
            <button type="submit" class="btn" style="padding:5px 9px;">Gönder</button>
          </form>
        </div>
      `;

      container.appendChild(win);
      const msgBox = win.querySelector(".ko-pm-messages") as HTMLElement;
      if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
    }

    container.querySelectorAll("[data-pm-mute]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.pmMute!;
        if (this.mutedPlayerIds.has(id)) {
          this.mutedPlayerIds.delete(id);
        } else {
          this.mutedPlayerIds.add(id);
        }
        this.renderPMWindows();
      });
    });

    container.querySelectorAll("[data-pm-min]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.pmMin!;
        const t = this.pmThreads.get(id);
        if (t) {
          const nextMin = !t.minimized;
          if (!nextMin) {
            this.pmThreads.forEach((other, oid) => {
              if (oid !== id) other.minimized = true;
            });
            t.unread = false;
          }
          t.minimized = nextMin;
          this.renderPMWindows();
        }
      });
    });

    container.querySelectorAll(".ko-pm-header").forEach((hdr) => {
      hdr.addEventListener("click", () => {
        const minBtn = hdr.querySelector("[data-pm-min]") as HTMLElement | null;
        minBtn?.click();
      });
    });

    container.querySelectorAll("[data-pm-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.pmClose!;
        this.pmThreads.delete(id);
        this.renderPMWindows();
      });
    });

    container.querySelectorAll("[data-pm-form]").forEach((formEl) => {
      formEl.addEventListener("submit", (e) => {
        e.preventDefault();
        const id = (formEl as HTMLElement).dataset.pmForm!;
        const input = formEl.querySelector("input") as HTMLInputElement;
        const text = input.value.trim();
        if (!text || !this.room) return;
        this.room.send("pm", { targetId: id, text });
        input.value = "";
      });
    });
  }

  private openDMPickerModal(): void {
    const state: any = this.room?.state;
    if (!state || !this.room) return;
    const modal = document.getElementById("dm-picker-modal")!;
    const listEl = document.getElementById("dm-player-list")!;

    const others: Array<{ id: string; nick: string; seat: number; dist: number; alive: boolean }> = [];
    state.players?.forEach((p: any, sid: string) => {
      if (sid === this.room?.sessionId) return;
      const dist = Math.round(Math.hypot(this.localX - p.x, this.localZ - p.z));
      others.push({ id: sid, nick: p.nick, seat: p.seat, dist, alive: p.alive });
    });
    others.sort((a, b) => a.dist - b.dist);

    if (others.length === 0) {
      listEl.innerHTML = `<div style="font-size:0.82rem; color:var(--text-muted);">Odada henüz başka oyuncu yok (Bot ekleyebilirsin!).</div>`;
    } else {
      listEl.innerHTML = others
        .map(
          (o) => `
        <button class="btn" data-pick-dm="${escapeHtml(o.id)}" data-seat="${o.seat}" style="display:flex; justify-content:space-between; width:100%; padding:9px 12px;">
          <span>#${o.seat} ${escapeHtml(String(o.nick || ""))} ${!o.alive ? "👻" : ""}</span>
          <span style="color:#e3b3ff;">${state.phase === "DAY" ? `${o.dist}m mesafede` : "Fısılda"} ✉️</span>
        </button>
      `
        )
        .join("");
    }

    modal.classList.remove("hidden");

    listEl.querySelectorAll("[data-pick-dm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = btn as HTMLElement;
        const sid = b.dataset.pickDm!;
        const p = state.players?.get(sid);
        modal.classList.add("hidden");
        this.openPMThread(sid, p?.nick || "Oyuncu", Number(b.dataset.seat));
      });
    });
  }

  private appendChatMessage(senderId: string, sender: string, scope: string, text: string): void {
    const log = document.getElementById("chat-log")!;
    const item = document.createElement("div");
    const canDM = senderId && this.room && senderId !== this.room.sessionId;
    const safeSender = escapeHtml(String(sender || ""));
    const safeScope = escapeHtml(String(scope || ""));
    const safeText = escapeHtml(String(text || ""));
    const nameHtml = canDM
      ? `<span class="chat-nick-link" data-chat-dm="${escapeHtml(senderId)}">[${safeScope}] ${safeSender}:</span>`
      : `<span style="color:#ffd700;">[${safeScope}] ${safeSender}:</span>`;

    item.innerHTML = `${nameHtml} ${safeText}`;
    log.appendChild(item);
    while (log.children.length > 90) {
      log.removeChild(log.firstChild!);
    }
    log.scrollTop = log.scrollHeight;

    item.querySelector("[data-chat-dm]")?.addEventListener("click", (e) => {
      const el = e.currentTarget as HTMLElement;
      const sid = el.dataset.chatDm!;
      const p = (this.room?.state as any)?.players?.get(sid);
      this.openPMThread(sid, p?.nick || sender || "Oyuncu", p?.seat || 1);
    });
  }

  private closeHudGearMenu(): void {
    document.getElementById("hud-gear-dropdown")?.classList.add("hidden");
  }

  private getChatSizeBounds(): {
    phase: string;
    isDay: boolean;
    isShortViewport: boolean;
    minH: number;
    dragMaxH: number;
    autoCapH: number;
    minW: number;
    maxW: number;
  } {
    const vw = Math.max(320, window.innerWidth || 360);
    const vvH = window.visualViewport?.height || window.innerHeight || 360;
    const vh = Math.max(200, Math.min(window.innerHeight || vvH, vvH));
    const phase = String((this.room?.state as any)?.phase || "LOBBY");
    const isDay = document.body.classList.contains("in-day-mode") || phase === "DAY";
    const isShortViewport = vh <= 600;
    const minH = vh <= 560 ? 34 : 42;

    let dragMaxH: number;
    let autoCapH: number;
    if (isDay) {
      const topAndChromeReserve = vh <= 560 ? 190 : 184;
      dragMaxH = Math.max(minH, Math.min(440, vh - topAndChromeReserve));
      autoCapH = dragMaxH;
    } else if (isShortViewport) {
      dragMaxH = Math.max(minH, Math.floor(vh * 0.4));
      autoCapH = Math.max(minH, Math.floor(vh * 0.16));
    } else {
      dragMaxH = Math.max(minH + 40, Math.min(310, Math.floor(vh * 0.34)));
      autoCapH = dragMaxH;
    }

    let minW: number;
    let maxW: number;
    if (isDay) {
      if (vw <= 560) {
        maxW = Math.max(210, Math.floor(vw * 0.94));
        minW = Math.min(230, maxW);
      } else {
        // Sol Kontrol Kümesi (🔍+ dahil, iPhone çentik payı dahil) + Sağ Aksiyon Çarkı arasına taşmayacak dinamik sınır
        let safeCorridorW = vw - 380;
        const leftCluster = document.querySelector(".left-control-cluster") as HTMLElement | null;
        const rightWheel = document.querySelector(".lol-wheel-cluster") as HTMLElement | null;
        const centerX = vw / 2;
        if (leftCluster && leftCluster.offsetParent !== null) {
          const lr = leftCluster.getBoundingClientRect();
          if (lr.width > 0 && lr.right < centerX) {
            safeCorridorW = Math.min(safeCorridorW, Math.floor((centerX - lr.right - 8) * 2));
          }
        }
        if (rightWheel && rightWheel.offsetParent !== null) {
          const rr = rightWheel.getBoundingClientRect();
          if (rr.width > 0 && rr.left > centerX) {
            safeCorridorW = Math.min(safeCorridorW, Math.floor((rr.left - centerX - 8) * 2));
          }
        }
        maxW = Math.max(192, Math.min(720, safeCorridorW));
        minW = Math.min(220, maxW);
      }
    } else {
      maxW = Math.max(240, Math.min(740, Math.floor(vw * 0.9)));
      minW = Math.min(260, maxW);
    }

    return { phase, isDay, isShortViewport, minH, dragMaxH, autoCapH, minW, maxW };
  }

  private syncChatDimensions(keepScrollBottom = false): void {
    const bottomChat = document.getElementById("ko-bottom-chat");
    if (!bottomChat) return;
    const bounds = this.getChatSizeBounds();
    const expandBtn = document.getElementById("btn-expand-chat");

    if (this.chatUserLogHeight !== null) {
      const capH =
        !bounds.isDay && bounds.isShortViewport && this.chatPanelOverridePhase !== bounds.phase
          ? bounds.autoCapH
          : bounds.dragMaxH;
      const clampedH = Math.round(Math.max(bounds.minH, Math.min(capH, this.chatUserLogHeight)));
      const nextH = `${clampedH}px`;
      if (bottomChat.style.getPropertyValue("--chat-log-h") !== nextH) {
        bottomChat.style.setProperty("--chat-log-h", nextH);
      }
      bottomChat.classList.toggle("chat-expanded", clampedH > bounds.minH + 10);
    } else {
      if (bottomChat.style.getPropertyValue("--chat-log-h")) {
        bottomChat.style.removeProperty("--chat-log-h");
      }
      bottomChat.classList.remove("chat-expanded");
    }

    if (this.chatUserBoxWidth !== null) {
      const clampedW = Math.round(Math.max(bounds.minW, Math.min(bounds.maxW, this.chatUserBoxWidth)));
      const nextW = `${clampedW}px`;
      if (bottomChat.style.getPropertyValue("--chat-box-w") !== nextW) {
        bottomChat.style.setProperty("--chat-box-w", nextW);
      }
    } else if (bottomChat.style.getPropertyValue("--chat-box-w")) {
      bottomChat.style.removeProperty("--chat-box-w");
    }

    if (expandBtn) {
      const isExpanded =
        (this.chatUserLogHeight !== null && this.chatUserLogHeight > bounds.minH + 10) ||
        this.chatUserBoxWidth !== null;
      expandBtn.classList.toggle("active", isExpanded);
    }

    if (keepScrollBottom) {
      const chatLog = document.getElementById("chat-log");
      if (chatLog) {
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    }
  }

  // ==========================================================================
  // HUD AKSİYONLARI & WILD RIFT + HİBRİT YÖN KONTROLLERİ
  // ==========================================================================
  private setupHUDActions(): void {
    // 🔊 Ses Aç/Kapat Düğmesi
    const btnSfx = document.getElementById("btn-hud-sfx");
    const syncSfxBtn = () => {
      if (!btnSfx) return;
      const muted = sfx.isMuted();
      btnSfx.textContent = muted ? "🔇" : "🔊";
      btnSfx.style.opacity = muted ? "0.65" : "1";
    };
    syncSfxBtn();
    btnSfx?.addEventListener("click", () => {
      const muted = sfx.toggleMute();
      syncSfxBtn();
      if (!muted) sfx.playUiClick();
    });

    // ⚙️ Kasa & Ayarlar Çarkı Açılır Menüsü
    const btnGear = document.getElementById("btn-hud-gear");
    const gearDropdown = document.getElementById("hud-gear-dropdown");
    btnGear?.addEventListener("click", (e) => {
      e.stopPropagation();
      sfx.playUiClick();
      gearDropdown?.classList.toggle("hidden");
    });
    document.addEventListener("pointerdown", (e) => {
      if (!gearDropdown || gearDropdown.classList.contains("hidden")) return;
      const target = e.target as Node | null;
      if (target && (gearDropdown.contains(target) || btnGear?.contains(target))) return;
      this.closeHudGearMenu();
    });

    const btnWatchAd = document.getElementById("btn-watch-ad")!;
    btnWatchAd.addEventListener("click", () => {
      btnWatchAd.setAttribute("disabled", "true");
      let left = 3;
      btnWatchAd.textContent = `⏳ Reklam (${left} sn)...`;
      const timer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          btnWatchAd.textContent = `⏳ Reklam (${left} sn)...`;
        } else {
          clearInterval(timer);
          this.vault.gold += 50;
          this.saveVault();
          sfx.playGoldChime();
          btnWatchAd.removeAttribute("disabled");
          btnWatchAd.textContent = "🎬 Reklam İzle (+50 🪙)";
          this.lastCenterRenderHash = "";
        }
      }, 1000);
    });

    const cycleLight = () => {
      const lbl = this.scene.cycleBrightnessBoost();
      const bEl = document.getElementById("btn-hud-brightness");
      if (bEl) bEl.textContent = lbl;
      sfx.playUiClick();
    };
    document.getElementById("btn-hud-zoom")?.addEventListener("click", () => {
      this.scene.cycleCameraZoom();
      this.syncCameraZoomUI();
      sfx.playUiClick();
    });
    this.bindHoldZoomButton(document.getElementById("btn-hud-zoom-in"), -1);
    this.bindHoldZoomButton(document.getElementById("btn-hud-zoom-out"), 1);
    const hudZoomSlider = document.getElementById("hud-zoom-slider") as HTMLInputElement | null;
    hudZoomSlider?.addEventListener("input", () => {
      this.scene.setCameraZoomProgress(Number(hudZoomSlider.value) / 100);
      this.syncCameraZoomUI();
    });
    this.syncCameraZoomUI();
    document.getElementById("btn-open-handbook")?.addEventListener("click", () => {
      this.closeHudGearMenu();
      this.toggleHandbookModal();
    });
    document.getElementById("handbook-modal")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement)?.id === "handbook-modal") {
        this.closeHandbookModal();
      }
    });
    document.getElementById("puzzle-modal")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement)?.id === "puzzle-modal") {
        const card = document.getElementById("puzzle-card-content");
        if (card) card.style.width = "";
        document.getElementById("puzzle-modal")?.classList.add("hidden");
      }
    });
    document.getElementById("dm-picker-modal")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement)?.id === "dm-picker-modal") {
        document.getElementById("dm-picker-modal")?.classList.add("hidden");
      }
    });
    document.getElementById("btn-open-rules")?.addEventListener("click", () => {
      this.closeHudGearMenu();
    });
    document.getElementById("btn-hud-brightness")?.addEventListener("click", cycleLight);
    document.getElementById("btn-force-landscape")?.addEventListener("click", () => this.enterLandscapeFullscreen());
    document.getElementById("btn-menu-landscape")?.addEventListener("click", () => this.enterLandscapeFullscreen());
    document.getElementById("btn-hud-landscape")?.addEventListener("click", () => {
      this.closeHudGearMenu();
      this.enterLandscapeFullscreen();
    });
    document.getElementById("btn-wheel-light")?.addEventListener("click", () => this.handleContextWheelClick());
    document.getElementById("btn-wheel-inspect")?.addEventListener("click", () => this.openInspectPickerModal());

    document.getElementById("day-quest-header")?.addEventListener("click", () => {
      const box = document.getElementById("day-quest-box");
      const tog = document.getElementById("day-quest-toggle");
      if (box) {
        box.classList.toggle("collapsed");
        if (tog) tog.textContent = box.classList.contains("collapsed") ? "▸" : "▾";
      }
    });

    document.getElementById("btn-ready-phase")?.addEventListener("click", () => {
      this.isLocalReadyForPhase = true;
      this.room?.send("ready_next_phase");
      const btn = document.getElementById("btn-ready-phase");
      if (btn) {
        btn.textContent = `✅ Hazırım${this.readyStatusText ? ` ${this.readyStatusText}` : ""}`;
      }
      sfx.playUiClick();
    });

    document.getElementById("btn-open-dm-list")?.addEventListener("click", () => this.openDMPickerModal());
    document.getElementById("btn-wheel-dm")?.addEventListener("click", () => this.openDMPickerModal());
    document.getElementById("btn-close-dm-picker")?.addEventListener("click", () => {
      document.getElementById("dm-picker-modal")?.classList.add("hidden");
    });

    document.getElementById("btn-wheel-door")?.addEventListener("click", () => this.tryInteractNearestDoor());

    // Alt sohbet küçült/büyüt + sürükleyerek uzatma (PC Fare & Mobil Dokunmatik Uyumlu)
    const bottomChat = document.getElementById("ko-bottom-chat")!;
    const chatLogEl = document.getElementById("chat-log")!;
    const minChatBtn = document.getElementById("btn-toggle-chat-min");
    const expandChatBtn = document.getElementById("btn-expand-chat");

    const ensureChatUnminimized = () => {
      if (bottomChat.classList.contains("minimized")) {
        bottomChat.classList.remove("minimized");
        if (minChatBtn) minChatBtn.textContent = "▾";
      }
    };

    minChatBtn?.addEventListener("click", (e) => {
      bottomChat.classList.toggle("minimized");
      (e.currentTarget as HTMLElement).textContent = bottomChat.classList.contains("minimized") ? "▴" : "▾";
    });

    expandChatBtn?.addEventListener("click", () => {
      ensureChatUnminimized();
      this.chatSizePresetIdx = (this.chatSizePresetIdx + 1) % 3;
      const bounds = this.getChatSizeBounds();
      if (this.chatSizePresetIdx === 0) {
        this.chatUserLogHeight = null;
        this.chatUserBoxWidth = null;
        this.chatPanelOverridePhase = "";
      } else if (this.chatSizePresetIdx === 1) {
        this.chatPanelOverridePhase = bounds.phase;
        this.chatUserLogHeight = Math.round(bounds.minH + (bounds.dragMaxH - bounds.minH) * 0.52);
        const targetMidW = window.innerWidth <= 940 ? 410 : 470;
        this.chatUserBoxWidth = Math.round(Math.max(bounds.minW, Math.min(bounds.maxW, targetMidW)));
      } else {
        this.chatPanelOverridePhase = bounds.phase;
        this.chatUserLogHeight = bounds.dragMaxH;
        const targetMaxW = window.innerWidth <= 940 ? 490 : 600;
        this.chatUserBoxWidth = Math.round(Math.max(bounds.minW, Math.min(bounds.maxW, targetMaxW)));
      }
      sfx.playUiClick();
      this.syncChatDimensions(true);
    });

    document.getElementById("ko-chat-resize-handle")?.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ensureChatUnminimized();
      const bounds = this.getChatSizeBounds();
      if (this.chatUserLogHeight !== null && this.chatUserLogHeight > bounds.minH + 14) {
        this.chatUserLogHeight = null;
        this.chatUserBoxWidth = null;
        this.chatSizePresetIdx = 0;
        this.chatPanelOverridePhase = "";
      } else {
        this.chatPanelOverridePhase = bounds.phase;
        this.chatUserLogHeight = Math.round(bounds.minH + (bounds.dragMaxH - bounds.minH) * 0.72);
        this.chatSizePresetIdx = 2;
      }
      this.syncChatDimensions(true);
    });

    bottomChat.querySelectorAll<HTMLElement>("[data-chat-resize]").forEach((grip) => {
      const mode = grip.dataset.chatResize || "n";
      let activePid: number | null = null;
      let startX = 0;
      let startY = 0;
      let startLogH = 42;
      let startBoxW = 355;

      const finishDrag = (ev: PointerEvent) => {
        if (activePid === null || ev.pointerId !== activePid) return;
        ev.preventDefault();
        ev.stopPropagation();
        try {
          if (grip.hasPointerCapture(activePid)) {
            grip.releasePointerCapture(activePid);
          }
        } catch {
          // ignore release errors
        }
        activePid = null;
        bottomChat.classList.remove("resizing");
        const bounds = this.getChatSizeBounds();
        if (this.chatUserLogHeight !== null && this.chatUserLogHeight <= bounds.minH + 2 && this.chatUserBoxWidth === null) {
          this.chatUserLogHeight = null;
          this.chatSizePresetIdx = 0;
        } else if (this.chatUserLogHeight !== null) {
          this.chatSizePresetIdx = this.chatUserLogHeight >= bounds.dragMaxH * 0.75 ? 2 : 1;
        }
        this.syncChatDimensions(true);
      };

      grip.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        ensureChatUnminimized();
        const bounds = this.getChatSizeBounds();
        this.chatPanelOverridePhase = bounds.phase;
        activePid = ev.pointerId;
        startX = ev.clientX;
        startY = ev.clientY;
        startLogH = chatLogEl.getBoundingClientRect().height || bounds.minH;
        startBoxW = bottomChat.getBoundingClientRect().width || 355;
        bottomChat.classList.add("resizing");
        try {
          grip.setPointerCapture(ev.pointerId);
        } catch {
          // ignore capture errors
        }
      });

      grip.addEventListener("pointermove", (ev) => {
        if (activePid === null || ev.pointerId !== activePid) return;
        ev.preventDefault();
        ev.stopPropagation();
        const bounds = this.getChatSizeBounds();
        if (mode.includes("n")) {
          const dy = startY - ev.clientY;
          this.chatUserLogHeight = Math.max(bounds.minH, Math.min(bounds.dragMaxH, startLogH + dy));
        }
        if (mode.includes("e") || mode.includes("w")) {
          const dx = ev.clientX - startX;
          const signedDx = mode.includes("w") ? -dx : dx;
          // Ortalanmış kutuda (align-self: center) kenarın parmak/imleç altında 1:1 kalması için 2x fark uygulanır
          this.chatUserBoxWidth = Math.max(bounds.minW, Math.min(bounds.maxW, startBoxW + signedDx * 2));
        }
        this.syncChatDimensions(true);
      });

      grip.addEventListener("pointerup", finishDrag);
      grip.addEventListener("pointercancel", finishDrag);
    });

    document.getElementById("btn-chat-all")?.addEventListener("click", () => {
      ensureChatUnminimized();
      (document.getElementById("chat-input") as HTMLInputElement | null)?.focus();
    });

    // Odadan Çık / Dramatik Veda Mektubu Bırak
    document.getElementById("btn-leave-room")?.addEventListener("click", () => {
      this.closeHudGearMenu();
      if (!this.room) return;
      const phase = (this.room.state as any)?.phase || "LOBBY";
      if (phase !== "LOBBY" && phase !== "RESULT") {
        const ok = window.confirm(
          "📜 Oyunun ortasında ayrılırsan masaya Dramatik Veda Mektubun bırakılır ve zarfın şömineye atılır! (Yanlışlıkla bastıysan İptal de). Ayrılmak istiyor musun?"
        );
        if (!ok) return;
        sessionStorage.removeItem("sofra_reconnect_token");
        this.room.send("forfeit_leave");
        return;
      }
      sessionStorage.removeItem("sofra_reconnect_token");
      this.room.leave(true);
    });

    const chatForm = document.getElementById("chat-form") as HTMLFormElement;
    const chatInput = document.getElementById("chat-input") as HTMLInputElement;
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text || !this.room) return;
      const curPhase = (this.room.state as any)?.phase || "";
      if (curPhase === "NIGHT" && this.myRole?.role === "HAIN") {
        this.room.send("chat", { text, channel: "HAIN" });
      } else {
        this.room.send("chat", { text });
      }
      chatInput.value = "";
    });
  }

  private async enterLandscapeFullscreen(): Promise<void> {
    const docEl: any = document.documentElement;
    const canReqFs = Boolean(docEl.requestFullscreen || docEl.webkitRequestFullscreen);
    if (!canReqFs) {
      // iPhone Safari: Fullscreen API desteklenmediğinde sessizce yutmak yerine nazik ipucu göster
      this.showExecutionToast(
        "📱 YATAY & TAM EKRAN OYUN İPUCU",
        "Telefonu yan (yatay) çevirerek hemen oynayabilir veya Safari 'Paylaş ⬆️ ➔ Ana Ekrana Ekle' ile tam ekran açabilirsiniz.",
        false,
        "📱 MOBİL EKRAN BİLGİSİ"
      );
      return;
    }
    try {
      if (!document.fullscreenElement) {
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
      }
      const orient: any = screen.orientation;
      if (orient && typeof orient.lock === "function") {
        await orient.lock("landscape");
      }
    } catch {
      // Yatay kilit tarayıcı tarafından kısıtlıysa telefonu yan çevirerek devam edilir.
    }
  }

  private syncCameraZoomUI(): void {
    const label = this.scene.getCameraZoomLabel();
    const prog = String(this.scene.getCameraZoomProgress());
    const zBtn = document.getElementById("btn-hud-zoom");
    if (zBtn) zBtn.textContent = label;
    const hudSlider = document.getElementById("hud-zoom-slider") as HTMLInputElement | null;
    if (hudSlider) hudSlider.value = prog;
    const inspSlider = document.getElementById("inspect-zoom-slider") as HTMLInputElement | null;
    if (inspSlider) inspSlider.value = prog;
    const inspBadge = document.getElementById("inspect-zoom-badge");
    if (inspBadge) inspBadge.textContent = label;
  }

  private bindHoldZoomButton(btn: HTMLElement | null, dir: number): void {
    if (!btn) return;
    let activePid: number | null = null;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activePid = e.pointerId;
      btn.setPointerCapture?.(e.pointerId);
      this.scene.adjustCameraZoom(dir * 0.45);
      this.syncCameraZoomUI();
      this.camZoomDir = dir;
    });
    const stop = (e: PointerEvent) => {
      if (activePid !== null && e.pointerId !== activePid) return;
      activePid = null;
      if (this.camZoomDir === dir) this.camZoomDir = 0;
    };
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("lostpointercapture", () => {
      activePid = null;
      if (this.camZoomDir === dir) this.camZoomDir = 0;
    });
  }

  private isAnyBlockingModalOpen(): boolean {
    if (this.handbookOpen || Boolean(this.scene.inspectTargetId)) return true;
    for (const id of ["puzzle-modal", "dm-picker-modal", "welcome-modal"]) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden")) return true;
    }
    return false;
  }

  private closeCharacterContextMenu(): void {
    document.getElementById("char-context-menu")?.classList.add("hidden");
  }

  private openCharacterContextMenu(picked: PickedCharacterInfo): void {
    if (!this.room) return;
    const menu = document.getElementById("char-context-menu");
    if (!menu) return;

    const state: any = this.room.state;
    const phase: string = state?.phase || "LOBBY";
    const myId = this.room.sessionId;
    const me = state?.players?.get(myId);
    const isMeAlive = Boolean(me && me.alive && !me.ghost);
    const isHain = this.myRole?.role === "HAIN";
    const mateIds = new Set((this.myRole?.traitorMates || []).map((m) => m.id));
    const targetPlayer = state?.players?.get(picked.sessionId);
    const isPickedAlive = targetPlayer ? Boolean(targetPlayer.alive && !targetPlayer.ghost) : true;
    const isMuted = this.mutedPlayerIds.has(picked.sessionId);
    const curStamp: SuspectStamp = this.suspectTags[picked.seat] || "unknown";
    const isPre = this.preTargetSeat === picked.seat;
    const safeNick = escapeHtml(String(picked.name || `Koltuk #${picked.seat}`));

    if (picked.isLocal) {
      menu.innerHTML = `
        <div class="char-ctx-header">
          <div>
            <strong>#${picked.seat} ${safeNick} (Sen)</strong>
            <div style="font-size:0.65rem; color:var(--text-muted);">${isPickedAlive ? "Hayatta" : "👻 Hayalet"}</div>
          </div>
          <button class="btn" id="ctx-btn-close" style="padding:1px 6px; font-size:0.7rem;">✕</button>
        </div>
        <button class="char-ctx-btn" id="ctx-btn-inspect">🔍 Kendimi 360° İncele & Barlar</button>
        <button class="char-ctx-btn" id="ctx-btn-handbook">📖 Dedektif El Kitapçığım (${this.clueJournal.length})</button>
      `;
    } else {
      const activeTieIds = this.getActiveTieCandidateIds(state);
      const tieLocked =
        phase === "VOTE" &&
        activeTieIds.length > 0 &&
        !activeTieIds.includes(picked.sessionId);

      let phaseActionBtns = "";
      if (isPickedAlive && isMeAlive) {
        if (phase === "VOTE") {
          phaseActionBtns = `
            ${
              !tieLocked
                ? `<button class="char-ctx-btn danger" id="ctx-btn-vote">🔥 #${picked.seat} İçin Oy Ver</button>`
                : ""
            }
            <button class="char-ctx-btn" id="ctx-btn-accuse">👉 Masada Suçla</button>
          `;
        } else if (phase === "TABLE") {
          phaseActionBtns = `
            <button class="char-ctx-btn danger" id="ctx-btn-accuse">👉 Masada Suçla</button>
            <button class="char-ctx-btn" id="ctx-btn-pretarget">${isPre ? "🎯 Ön-Hedefi Kaldır" : "🎯 Oylama Ön-Hedefi Seç"}</button>
          `;
        } else if (phase === "NIGHT" && isHain && !mateIds.has(picked.sessionId)) {
          phaseActionBtns = `
            <button class="char-ctx-btn danger" id="ctx-btn-night-pick">🩸 Gece İnfaz Hedefi Seç</button>
          `;
        } else if (phase === "DAY") {
          phaseActionBtns = `
            <button class="char-ctx-btn" id="ctx-btn-pretarget">${isPre ? "🎯 Ön-Hedefi Kaldır" : "🎯 Oylama Ön-Hedefi Kilitle"}</button>
          `;
        }
      }

      menu.innerHTML = `
        <div class="char-ctx-header">
          <div>
            <strong>#${picked.seat} ${safeNick}</strong>
            <div style="font-size:0.65rem; color:var(--text-muted);">${
              !isPickedAlive
                ? "👻 Hayalet"
                : state?.necklaceHolder === picked.sessionId
                ? "📿 Altın Kolye Sahibi"
                : "Hayatta"
            }</div>
          </div>
          <button class="btn" id="ctx-btn-close" style="padding:1px 6px; font-size:0.7rem;">✕</button>
        </div>
        <button class="char-ctx-btn" id="ctx-btn-pm" style="color:#efd2ff;">🤫 Özel Fısılda (PM Aç)</button>
        <button class="char-ctx-btn" id="ctx-btn-inspect">🔍 360° İncele & Yakınlık Barı</button>
        ${phaseActionBtns}
        <div class="char-ctx-stamps">
          <button class="char-ctx-stamp ${curStamp === "trust" ? "active" : ""}" data-ctx-stamp="trust" style="color:#9ef2c3;">🟢 Güven</button>
          <button class="char-ctx-stamp ${curStamp === "suspect" ? "active" : ""}" data-ctx-stamp="suspect" style="color:#ffe49c;">🟡 Şüphe</button>
          <button class="char-ctx-stamp ${curStamp === "traitor" ? "active" : ""}" data-ctx-stamp="traitor" style="color:#ff9aa6;">🔴 Hain</button>
        </div>
        <button class="char-ctx-btn" id="ctx-btn-mute">${isMuted ? "🔊 Susturmayı Kaldır" : "🔇 Oyuncuyu Sustur"}</button>
      `;
    }

    menu.classList.remove("hidden");
    // Ekran dışına taşmaması için pozisyonu sınırla
    const menuW = Math.min(238, window.innerWidth - 16);
    const menuH = Math.min(menu.offsetHeight || 230, window.innerHeight - 54);
    const left = Math.max(8, Math.min(window.innerWidth - menuW - 8, picked.screenX + 12));
    const top = Math.max(46, Math.min(window.innerHeight - menuH - 8, picked.screenY - 24));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    sfx.playUiClick();

    document.getElementById("ctx-btn-close")?.addEventListener("click", () => {
      this.closeCharacterContextMenu();
    });
    document.getElementById("ctx-btn-inspect")?.addEventListener("click", () => {
      this.closeCharacterContextMenu();
      this.inspectedFromHandbook = false;
      this.room?.send("request_inspect", { targetId: picked.sessionId });
    });
    document.getElementById("ctx-btn-handbook")?.addEventListener("click", () => {
      this.closeCharacterContextMenu();
      this.openHandbookModal("book");
    });
    document.getElementById("ctx-btn-pm")?.addEventListener("click", () => {
      this.closeCharacterContextMenu();
      this.openPMThread(picked.sessionId, targetPlayer?.nick || picked.name, picked.seat);
    });
    document.getElementById("ctx-btn-vote")?.addEventListener("click", () => {
      this.closeCharacterContextMenu();
      this.selectedVoteTargetId = picked.sessionId;
      this.room?.send("vote", { targetId: picked.sessionId });
      sfx.playVoteStamp();
      this.lastCenterRenderHash = "";
    });
    document.getElementById("ctx-btn-accuse")?.addEventListener("click", () => {
      this.closeCharacterContextMenu();
      this.openAccuseModal(picked.sessionId, picked.seat, targetPlayer?.nick || picked.name);
    });
    document.getElementById("ctx-btn-night-pick")?.addEventListener("click", () => {
      this.closeCharacterContextMenu();
      this.selectedNightTargetId = picked.sessionId;
      this.room?.send("night_pick", { targetId: picked.sessionId });
      sfx.playHeartbeat();
      this.lastCenterRenderHash = "";
    });
    document.getElementById("ctx-btn-pretarget")?.addEventListener("click", () => {
      this.preTargetSeat = this.preTargetSeat === picked.seat ? 0 : picked.seat;
      this.saveHandbookToSession();
      this.lastCenterRenderHash = "";
      sfx.playUiClick();
      this.closeCharacterContextMenu();
    });
    menu.querySelectorAll("[data-ctx-stamp]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = (btn as HTMLElement).dataset.ctxStamp as SuspectStamp;
        this.suspectTags[picked.seat] = this.suspectTags[picked.seat] === val ? "unknown" : val;
        this.saveHandbookToSession();
        this.lastCenterRenderHash = "";
        sfx.playUiClick();
        this.closeCharacterContextMenu();
      });
    });
    document.getElementById("ctx-btn-mute")?.addEventListener("click", () => {
      if (this.mutedPlayerIds.has(picked.sessionId)) {
        this.mutedPlayerIds.delete(picked.sessionId);
      } else {
        this.mutedPlayerIds.add(picked.sessionId);
      }
      this.renderPMWindows();
      sfx.playUiClick();
      this.closeCharacterContextMenu();
    });
  }

  private setupInputAndLoLWheel(): void {
    document.addEventListener("gesturestart" as any, (e: Event) => e.preventDefault(), { passive: false });
    document.addEventListener("gesturechange" as any, (e: Event) => e.preventDefault(), { passive: false });

    document.addEventListener("pointerdown", (e) => {
      const ctxMenu = document.getElementById("char-context-menu");
      if (ctxMenu && !ctxMenu.classList.contains("hidden")) {
        const target = e.target as Node | null;
        if (target && !ctxMenu.contains(target) && target !== this.scene.renderer.domElement) {
          this.closeCharacterContextMenu();
        }
      }
    });

    window.addEventListener("keydown", (e) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") {
        if (e.key === "Escape") {
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "escape") {
        const ctxMenu = document.getElementById("char-context-menu");
        if (ctxMenu && !ctxMenu.classList.contains("hidden")) {
          e.preventDefault();
          this.closeCharacterContextMenu();
          return;
        }
        const gearMenu = document.getElementById("hud-gear-dropdown");
        if (gearMenu && !gearMenu.classList.contains("hidden")) {
          e.preventDefault();
          this.closeHudGearMenu();
          return;
        }
        const puzModal = document.getElementById("puzzle-modal");
        if (puzModal && !puzModal.classList.contains("hidden")) {
          e.preventDefault();
          const pCard = document.getElementById("puzzle-card-content");
          if (pCard) pCard.style.width = "";
          puzModal.classList.add("hidden");
          return;
        }
        if (this.scene.inspectTargetId) {
          e.preventDefault();
          this.closeInspectOverlay();
          return;
        }
        const dmModal = document.getElementById("dm-picker-modal");
        if (dmModal && !dmModal.classList.contains("hidden")) {
          e.preventDefault();
          dmModal.classList.add("hidden");
          return;
        }
        if (this.handbookOpen) {
          e.preventDefault();
          this.closeHandbookModal();
          return;
        }
      }

      if ((k === "b" || k === "j") && this.room) {
        e.preventDefault();
        this.toggleHandbookModal();
        return;
      }
      if (k === "v" && (this.room || this.previewSelfOnMenu)) {
        e.preventDefault();
        this.scene.cycleCameraZoom();
        this.syncCameraZoomUI();
        return;
      }
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd" || e.key === "PageUp") {
          e.preventDefault();
          this.keys.add("__zoom_in__");
          return;
        }
        if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" || e.key === "PageDown") {
          e.preventDefault();
          this.keys.add("__zoom_out__");
          return;
        }
      }

      // 360° İnceleme açıkken Sol/Sağ yön tuşları karakterin etrafında dönsün
      if (this.scene.inspectTargetId && (k === "arrowleft" || k === "arrowright")) {
        e.preventDefault();
        this.scene.inspectOrbitYaw += k === "arrowleft" ? -0.38 : 0.38;
        return;
      }

      if (k === "enter" && this.room && !this.isAnyBlockingModalOpen()) {
        e.preventDefault();
        const bChat = document.getElementById("ko-bottom-chat");
        if (bChat?.classList.contains("minimized")) {
          bChat.classList.remove("minimized");
          const mBtn = document.getElementById("btn-toggle-chat-min");
          if (mBtn) mBtn.textContent = "▾";
        }
        const chatInp = document.getElementById("chat-input") as HTMLInputElement | null;
        chatInp?.focus();
        return;
      }
      if (k === "tab" && this.room) {
        e.preventDefault();
        const puzModal = document.getElementById("puzzle-modal");
        if (puzModal && !puzModal.classList.contains("hidden")) {
          puzModal.classList.add("hidden");
        } else {
          this.openInspectPickerModal();
        }
        return;
      }

      // Açık bir modal varken karakter arka planda körü körüne yürümesin veya kapı tetiklemesin!
      if (this.isAnyBlockingModalOpen()) return;

      this.keys.add(k);
      if (k === "e") {
        this.tryInteractNearestDoor();
      }
    });

    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd" || e.key === "PageUp") {
        this.keys.delete("__zoom_in__");
      }
      if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" || e.key === "PageDown") {
        this.keys.delete("__zoom_out__");
      }
    });

    // Sol Kamera Dönüş & Yakınlaş/Uzaklaş Tuşları (🔍− / ⟲ Sola / Sağa ⟳ / 🔍+)
    const bindTurnBtn = (id: string, dir: number) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      let turnPid: number | null = null;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        turnPid = e.pointerId;
        btn.setPointerCapture?.(e.pointerId);
        this.camTurnDir = dir;
      });
      const stop = (e: PointerEvent) => {
        if (turnPid !== null && e.pointerId !== turnPid) return;
        turnPid = null;
        if (this.camTurnDir === dir) this.camTurnDir = 0;
      };
      btn.addEventListener("pointerup", stop);
      btn.addEventListener("pointercancel", stop);
      btn.addEventListener("lostpointercapture", () => {
        turnPid = null;
        if (this.camTurnDir === dir) this.camTurnDir = 0;
      });
    };
    bindTurnBtn("btn-cam-left", 1);
    bindTurnBtn("btn-cam-right", -1);
    this.bindHoldZoomButton(document.getElementById("btn-cam-zoom-in"), -1);
    this.bindHoldZoomButton(document.getElementById("btn-cam-zoom-out"), 1);

    // 1. STANDART WEB 3D & MOBİL KAMERA KONTROLÜ + 3B KARAKTER / NESNE TIKLAMA (RAYCAST):
    const canvas = this.scene.renderer.domElement;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    const activeTouchPointers = new Map<number, { x: number; y: number }>();
    let lookPointerId: number | null = null;
    let lastLookX = 0;
    let lastLookY = 0;
    let lastPinchDist: number | null = null;
    let tapCandidate: {
      pointerId: number;
      startX: number;
      startY: number;
      maxDrag: number;
      hadMultiTouch: boolean;
    } | null = null;
    let lastHoverCheckAt = 0;

    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") {
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        if (lookPointerId !== null) return;
        lookPointerId = e.pointerId;
        lastLookX = e.clientX;
        lastLookY = e.clientY;
        tapCandidate =
          e.button === 0 || e.button === 2
            ? { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, maxDrag: 0, hadMultiTouch: false }
            : null;
        canvas.classList.add("dragging-cam");
        return;
      }

      // Dokunmatik (Mobil / Tablet): 1 parmak = kamera bakışı veya tıklama, 2 parmak = kıstır/aç (Pinch Zoom)
      activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activeTouchPointers.size >= 2) {
        lookPointerId = null;
        if (tapCandidate) tapCandidate.hadMultiTouch = true;
        const pts = Array.from(activeTouchPointers.values());
        lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        return;
      }

      if (lookPointerId === null) {
        lookPointerId = e.pointerId;
        lastLookX = e.clientX;
        lastLookY = e.clientY;
        tapCandidate = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          maxDrag: 0,
          hadMultiTouch: false
        };
      }
    });

    window.addEventListener("pointermove", (e) => {
      // PC fare boşta gezinirken tıklanabilir 3B karakter veya nesne üzerinde imleci pointer yap
      if (e.pointerType === "mouse" && e.buttons === 0 && e.target === canvas && this.room && !this.scene.inspectTargetId) {
        const nowMs = performance.now();
        if (nowMs - lastHoverCheckAt > 75) {
          lastHoverCheckAt = nowMs;
          const charHit = this.scene.pickCharacterAt(e.clientX, e.clientY);
          const phaseNow = (this.room.state as any)?.phase;
          const worldHit = !charHit && phaseNow === "DAY" ? this.scene.pickWorldInteractableAt(e.clientX, e.clientY) : null;
          canvas.style.cursor = charHit || worldHit ? "pointer" : "";
        }
      }

      if (tapCandidate && e.pointerId === tapCandidate.pointerId) {
        const moved = Math.hypot(e.clientX - tapCandidate.startX, e.clientY - tapCandidate.startY);
        if (moved > tapCandidate.maxDrag) {
          tapCandidate.maxDrag = moved;
          if (moved > 8) {
            this.closeCharacterContextMenu();
          }
        }
      }

      if (activeTouchPointers.has(e.pointerId)) {
        activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activeTouchPointers.size >= 2) {
          const pts = Array.from(activeTouchPointers.values());
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (lastPinchDist !== null && Math.abs(dist - lastPinchDist) > 0.35) {
            const delta = -(dist - lastPinchDist) * 0.04;
            this.scene.adjustCameraZoom(delta);
            this.syncCameraZoomUI();
          }
          lastPinchDist = dist;
          return;
        }
      }

      if (e.pointerId !== lookPointerId) return;

      if (e.pointerType === "mouse" && e.buttons === 0) {
        lookPointerId = null;
        canvas.classList.remove("dragging-cam");
        return;
      }

      const dx = e.clientX - lastLookX;
      const dy = e.clientY - lastLookY;
      lastLookX = e.clientX;
      lastLookY = e.clientY;

      if (this.scene.inspectTargetId) {
        this.scene.inspectOrbitYaw -= dx * 0.011;
        this.scene.inspectPitch = Math.max(-0.12, Math.min(0.65, this.scene.inspectPitch + dy * 0.005));
        return;
      }

      const sens = e.pointerType === "mouse" ? 0.0055 : 0.0062;
      const pitchSens = e.pointerType === "mouse" ? 0.004 : 0.0046;
      this.scene.cameraYaw -= dx * sens;
      this.scene.cameraPitch = Math.max(0.15, Math.min(1.05, this.scene.cameraPitch + dy * pitchSens));
    });

    const handleCanvasShortTap = (clientX: number, clientY: number) => {
      if (!this.room || this.scene.inspectTargetId) return;
      const pickedChar = this.scene.pickCharacterAt(clientX, clientY);
      if (pickedChar && pickedChar.sessionId !== "__kahya_npc__" && pickedChar.sessionId !== "__preview_self__") {
        this.openCharacterContextMenu(pickedChar);
        return;
      }
      this.closeCharacterContextMenu();

      const state: any = this.room.state;
      if (state?.phase === "DAY") {
        const worldHit = this.scene.pickWorldInteractableAt(clientX, clientY);
        if (worldHit) {
          const dist = Math.hypot(this.localX - worldHit.x, this.localZ - worldHit.z);
          const maxReach = worldHit.kind === "door" ? SOFRA_CONFIG.DOOR_INTERACT_DIST + 0.6 : 4.8;
          if (dist <= maxReach) {
            if (worldHit.kind === "door") {
              this.room.send("interact_door", { doorId: worldHit.id });
            } else if (worldHit.kind === "altar") {
              this.room.send("request_puzzle", { altarId: worldHit.id });
            } else if (worldHit.kind === "station") {
              const st = MEDIEVAL_STATIONS.find((s) => s.id === worldHit.id);
              if (st) this.openMedievalStationModal(st);
            } else if (worldHit.kind === "board") {
              this.openCouncilBoardModal();
            }
          } else {
            const annEl = document.getElementById("announcement-box");
            if (annEl) {
              this.announcementChangedAt = performance.now();
              annEl.textContent = `"👣 ${worldHit.label} ile etkileşmek için biraz daha yaklaş (${dist.toFixed(1)}m)."`;
              annEl.classList.remove("ann-auto-hidden");
            }
          }
        }
      }
    };

    const releaseLook = (e: PointerEvent, isCancel = false) => {
      if (!isCancel && tapCandidate && e.pointerId === tapCandidate.pointerId) {
        const validTap = !tapCandidate.hadMultiTouch && tapCandidate.maxDrag <= 7 && e.target === canvas;
        tapCandidate = null;
        if (validTap) {
          handleCanvasShortTap(e.clientX, e.clientY);
        }
      } else if (tapCandidate && e.pointerId === tapCandidate.pointerId) {
        tapCandidate = null;
      }

      if (activeTouchPointers.delete(e.pointerId)) {
        if (activeTouchPointers.size < 2) {
          lastPinchDist = null;
        }
        if (activeTouchPointers.size === 1) {
          const [remId, remPos] = Array.from(activeTouchPointers.entries())[0];
          lookPointerId = remId;
          lastLookX = remPos.x;
          lastLookY = remPos.y;
          return;
        }
      }
      if (e.pointerId === lookPointerId) {
        lookPointerId = null;
        canvas.classList.remove("dragging-cam");
      }
    };
    window.addEventListener("pointerup", (e) => releaseLook(e, false));
    window.addEventListener("pointercancel", (e) => releaseLook(e, true));

    // 1B. Global Fare Tekerleği & Trackpad Kıstırma ile Akıcı Yakınlaşma / Uzaklaşma
    const isInsideScrollableUI = (startEl: HTMLElement | null): boolean => {
      let el: HTMLElement | null = startEl;
      while (el && el !== document.body && el !== document.documentElement) {
        if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
          return false;
        }
        const style = window.getComputedStyle(el);
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight + 4
        ) {
          return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    window.addEventListener(
      "wheel",
      (e) => {
        if (!this.room && !this.previewSelfOnMenu) return;
        const welcomeOpen = !document.getElementById("welcome-modal")?.classList.contains("hidden");
        if (welcomeOpen) return;

        if (!e.ctrlKey && isInsideScrollableUI(e.target as HTMLElement | null)) {
          return;
        }

        e.preventDefault();
        const rawDelta = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
        const step = e.ctrlKey
          ? Math.max(-1.6, Math.min(1.6, rawDelta * 0.024))
          : Math.max(-1.4, Math.min(1.4, rawDelta * 0.0085));
        this.scene.adjustCameraZoom(step);
        this.syncCameraZoomUI();
      },
      { passive: false }
    );

    // 2. Sol Alt Hibrit Yön Okları (▲▼◄►) + Analog Joystick (İzole joyPointerId)
    const zone = document.getElementById("joystick-zone")!;
    const knob = document.getElementById("joystick-knob")!;
    let joyPointerId: number | null = null;

    const updateJoystick = (clientX: number, clientY: number) => {
      const rect = zone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxR = Math.max(18, rect.width * 0.38);
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joyX = dx / maxR;
      this.joyY = dy / maxR;
    };

    zone.addEventListener("pointerdown", (e) => {
      if (joyPointerId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      joyPointerId = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      updateJoystick(e.clientX, e.clientY);
    });

    window.addEventListener("pointermove", (e) => {
      if (e.pointerId === joyPointerId) updateJoystick(e.clientX, e.clientY);
    });

    const releaseJoy = (e: PointerEvent) => {
      if (e.pointerId !== joyPointerId) return;
      joyPointerId = null;
      knob.style.transform = "translate(0px, 0px)";
      this.joyX = 0;
      this.joyY = 0;
    };
    window.addEventListener("pointerup", releaseJoy);
    window.addEventListener("pointercancel", releaseJoy);

    // 3. Sağ Alt League of Legends: Wild Rift KOŞTURMA Butonu (Basılı Tut + Sürükleyerek Kamera Çevir!)
    const sprintBtn = document.getElementById("btn-lol-sprint")!;
    let sprintPointerId: number | null = null;
    let lastSprintX = 0;

    sprintBtn.addEventListener("pointerdown", (e) => {
      if (sprintPointerId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      sprintPointerId = e.pointerId;
      sprintBtn.setPointerCapture?.(e.pointerId);
      lastSprintX = e.clientX;
      this.mobileSprintHeld = true;
      sprintBtn.classList.add("sprinting");
    });

    window.addEventListener("pointermove", (e) => {
      if (e.pointerId !== sprintPointerId) return;
      const dx = e.clientX - lastSprintX;
      lastSprintX = e.clientX;
      // Başka bir parmak ekranda kamera/pinch-zoom yapmıyorsa koşarken yatay sürükleme bakışı çevirir
      if (activeTouchPointers.size === 0 && lookPointerId === null) {
        this.scene.cameraYaw -= dx * 0.0065;
      }
    });

    const releaseSprint = (e: PointerEvent) => {
      if (e.pointerId !== sprintPointerId) return;
      sprintPointerId = null;
      this.mobileSprintHeld = false;
      sprintBtn.classList.remove("sprinting");
    };
    window.addEventListener("pointerup", releaseSprint);
    window.addEventListener("pointercancel", releaseSprint);

    // Tüm basılı dokunma/tuş durumlarını tek noktadan temizleme (blur, sekme değişimi, yön çevirme)
    this.resetPointersFn = () => {
      this.keys.clear();
      this.camTurnDir = 0;
      this.camZoomDir = 0;
      activeTouchPointers.clear();
      lookPointerId = null;
      lastPinchDist = null;
      tapCandidate = null;
      canvas.classList.remove("dragging-cam");
      joyPointerId = null;
      knob.style.transform = "translate(0px, 0px)";
      this.joyX = 0;
      this.joyY = 0;
      sprintPointerId = null;
      this.mobileSprintHeld = false;
      sprintBtn.classList.remove("sprinting");
    };

    window.addEventListener("blur", () => this.resetPointersFn?.());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.resetPointersFn?.();
    });
  }

  private tryInteractNearestDoor(): void {
    if (!this.room) return;
    let nearestId = "";
    let bestDist: number = SOFRA_CONFIG.DOOR_INTERACT_DIST;
    for (const d of DOORS) {
      const dist = Math.hypot(this.localX - d.x, this.localZ - d.z);
      if (dist < bestDist) {
        bestDist = dist;
        nearestId = d.id;
      }
    }
    if (nearestId) {
      this.room.send("interact_door", { doorId: nearestId });
      return;
    }
    // Kapı yakınında değilsek [E] tuşu veya Kapı/Etkileşim butonu Orta Çağ Odası İstasyonu / Kürsü / Konsey Tahtasını açar!
    if ((this.room.state as any)?.phase === "DAY") {
      this.handleContextWheelClick(true);
    }
  }

  private sendCustomizeToServer(): void {
    if (!this.room) return;
    const charDef = CHARACTERS.find((c) => c.seat === this.vault.selectedSeat) ?? CHARACTERS[0];
    this.room.send("customize", {
      nick: this.vault.customName || charDef.name,
      seat: this.vault.selectedSeat,
      coatColor: this.vault.coatColor,
      accentColor: this.vault.accentColor,
      hat: this.vault.hat,
      mask: this.vault.mask
    });
  }

  // ==========================================================================
  // 360° KARAKTER İNCELEME, ARKADAŞLIK BARI, GÖREVLER & BULMACA MODALLARI
  // ==========================================================================
  private closeInspectOverlay(): void {
    const returnToHb = this.inspectedFromHandbook && Boolean(this.room);
    this.inspectedFromHandbook = false;
    const wasMenuPreview = this.previewSelfOnMenu;
    this.previewSelfOnMenu = false;
    this.scene.inspectTargetId = null;
    this.syncCameraZoomUI();
    document.getElementById("inspect-overlay")?.classList.add("hidden");
    if (wasMenuPreview && !this.room) {
      document.getElementById("main-menu-overlay")?.classList.remove("hidden");
      return;
    }
    this.lastCenterRenderHash = "";
    if (returnToHb) {
      this.openHandbookModal();
    }
  }

  private openMenuSelfInspect360(): void {
    const nickInput = document.getElementById("input-guest-nick") as HTMLInputElement | null;
    if (nickInput && nickInput.value.trim()) {
      this.vault.customName = nickInput.value.trim();
      this.saveVault(false);
    }

    this.inspectedFromHandbook = false;
    this.previewSelfOnMenu = true;
    this.scene.inspectTargetId = "__preview_self__";
    this.scene.resetInspectCamera();
    this.syncCameraZoomUI();

    document.getElementById("main-menu-overlay")?.classList.add("hidden");
    const overlay = document.getElementById("inspect-overlay")!;
    const card = document.getElementById("inspect-card-content")!;
    overlay.classList.remove("hidden");

    const renderPreviewCard = () => {
      const charDef = CHARACTERS.find((c) => c.seat === this.vault.selectedSeat) ?? CHARACTERS[0];
      const zoomProg = this.scene.getCameraZoomProgress();
      const zoomLbl = this.scene.getCameraZoomLabel();
      const safePreviewName = escapeHtml(String(this.vault.customName || charDef.name));
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <div style="font-size:0.74rem; color:var(--gold); letter-spacing:1px;">
              🔍 KAYIT ÖNCESİ 360° KARAKTER İNCELEME
            </div>
            <h3 style="font-size:1.05rem; color:var(--parchment); margin-top:2px;">
              #${charDef.seat} ${safePreviewName} (${escapeHtml(charDef.title)})
            </h3>
          </div>
          <button class="btn btn-crimson" id="btn-close-menu-inspect" style="padding:5px 10px;">
            🔙 Kayıt / Menü
          </button>
        </div>

        <div style="font-size:0.75rem; color:var(--text-muted);">
          Sürükleyerek 360° çevir, iki parmakla / tekerlekle veya çubukla yakınlaş-uzaklaş:
        </div>

        <div style="display:flex; gap:6px;">
          <button class="btn" id="btn-spin-left-menu" style="flex:1;">⟲ Sola Çevir</button>
          <button class="btn" id="btn-spin-right-menu" style="flex:1;">Sağa Çevir ⟳</button>
        </div>

        <div class="inspect-zoom-row">
          <button class="hud-zoom-step" id="btn-inspect-zoom-out" type="button" title="Uzaklaş">−</button>
          <input
            type="range"
            id="inspect-zoom-slider"
            class="inspect-zoom-slider"
            min="0"
            max="100"
            value="${zoomProg}"
            aria-label="Karakter Yakınlık Çubuğu"
          />
          <button class="hud-zoom-step" id="btn-inspect-zoom-in" type="button" title="Yakınlaş">+</button>
          <span id="inspect-zoom-badge" style="font-size:0.72rem; color:var(--gold); min-width:58px; text-align:right;">${zoomLbl}</span>
        </div>

        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <span style="font-size:0.75rem; color:var(--gold);">Pelerin:</span>
          ${COAT_PALETTE.map(
            (col) => `
            <div class="swatch ${this.vault.coatColor === col ? "active" : ""}" style="background:${col}; width:24px; height:24px;" data-menu-col="${col}"></div>
          `
          ).join("")}
        </div>
      `;

      document.getElementById("btn-spin-left-menu")?.addEventListener("click", () => {
        this.scene.inspectOrbitYaw -= 0.55;
      });
      document.getElementById("btn-spin-right-menu")?.addEventListener("click", () => {
        this.scene.inspectOrbitYaw += 0.55;
      });
      this.bindHoldZoomButton(document.getElementById("btn-inspect-zoom-in"), -1);
      this.bindHoldZoomButton(document.getElementById("btn-inspect-zoom-out"), 1);
      const inspSlider = document.getElementById("inspect-zoom-slider") as HTMLInputElement | null;
      inspSlider?.addEventListener("input", () => {
        this.scene.setCameraZoomProgress(Number(inspSlider.value) / 100);
        this.syncCameraZoomUI();
      });
      card.querySelectorAll("[data-menu-col]").forEach((el) => {
        el.addEventListener("click", () => {
          this.vault.coatColor = (el as HTMLElement).dataset.menuCol!;
          this.saveVault(false);
          renderPreviewCard();
        });
      });
      document.getElementById("btn-close-menu-inspect")?.addEventListener("click", () => {
        this.closeInspectOverlay();
      });
    };

    renderPreviewCard();
  }

  private openInspectPickerModal(): void {
    if (!this.room) {
      this.openMenuSelfInspect360();
      return;
    }
    const state: any = this.room.state;
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;

    const allPlayers: Array<{ id: string; seat: number; nick: string; isMe: boolean; alive: boolean }> = [];
    state?.players?.forEach((p: any, sid: string) => {
      allPlayers.push({
        id: sid,
        seat: p.seat,
        nick: p.nick,
        isMe: sid === this.room?.sessionId,
        alive: p.alive
      });
    });
    allPlayers.sort((a, b) => (a.isMe === b.isMe ? a.seat - b.seat : a.isMe ? -1 : 1));

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:var(--gold);">🔍 Kimi İnceleyeceksin? (360° & Yakınlık Barı)</strong>
        <button class="btn" id="btn-close-inspect-picker" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.76rem; color:var(--text-muted);">
        Seçtiğin karakter 360° yakınlaşır ve kimlerle ne kadar yakın konuştuğu / fısıldaştığı bar olarak görünür:
      </p>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${allPlayers
          .map(
            (p) => `
          <button class="btn ${p.isMe ? "btn-crimson" : ""}" data-inspect-pick="${escapeHtml(p.id)}" style="display:flex; justify-content:space-between; width:100%; padding:9px 12px;">
            <span>#${p.seat} ${escapeHtml(String(p.nick || ""))} ${p.isMe ? "(Sen)" : ""}</span>
            <span style="color:#7ab8ff;">${p.alive ? "🔍 İncele & Barlar" : "👻 Hayalet"}</span>
          </button>
        `
          )
          .join("")}
      </div>
    `;
    modal.classList.remove("hidden");

    document.getElementById("btn-close-inspect-picker")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    card.querySelectorAll("[data-inspect-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tid = (btn as HTMLElement).dataset.inspectPick!;
        modal.classList.add("hidden");
        this.inspectedFromHandbook = false;
        this.room?.send("request_inspect", { targetId: tid });
      });
    });
  }

  private renderInspectOverlay(data: {
    id: string;
    nick: string;
    charName: string;
    seat: number;
    alive: boolean;
    roomName: string;
    hasNecklace: boolean;
    topBonds: Array<{ peerId: string; seat: number; nick: string; score: number; tier: string; color: string }>;
  }): void {
    this.previewSelfOnMenu = false;
    this.scene.inspectTargetId = data.id;
    this.scene.resetInspectCamera();
    this.syncCameraZoomUI();
    this.lastCenterRenderHash = "";

    const overlay = document.getElementById("inspect-overlay")!;
    const card = document.getElementById("inspect-card-content")!;
    overlay.classList.remove("hidden");

    const isMe = data.id === this.room?.sessionId;
    const zoomProg = this.scene.getCameraZoomProgress();
    const zoomLbl = this.scene.getCameraZoomLabel();
    const curStamp: SuspectStamp = this.suspectTags[data.seat] || "unknown";
    const safeNick = escapeHtml(String(data.nick || ""));
    const safeCharName = escapeHtml(String(data.charName || ""));
    const safeRoomName = escapeHtml(String(data.roomName || ""));

    const bondsHtml =
      !data.topBonds || data.topBonds.length === 0
        ? `<div style="font-size:0.78rem; color:var(--text-muted); font-style:italic; padding:6px 0;">
            Henüz kimseyle fısıltı veya özel oda yakınlığı kurulmadı.
          </div>`
        : data.topBonds
            .map(
              (b) => `
            <div style="margin-bottom:5px;">
              <div style="display:flex; justify-content:space-between; font-size:0.76rem;">
                <strong>#${Number(b.seat)} ${escapeHtml(String(b.nick || ""))}</strong>
                <span style="color:${escapeHtml(String(b.color || "#ffd166"))};">${escapeHtml(String(b.tier || ""))} (%${Number(b.score)})</span>
              </div>
              <div class="bond-bar-track">
                <div class="bond-bar-fill" style="width:${Math.min(100, Math.max(0, Number(b.score)))}%; background:${escapeHtml(String(b.color || "#ffd166"))};"></div>
              </div>
            </div>
          `
            )
            .join("");

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div>
          <div style="font-size:0.72rem; color:var(--gold);">
            SANDALYE #${Number(data.seat)} · 📍 ${safeRoomName} ${data.hasNecklace ? "· 📿 Altın Kolye" : ""}
          </div>
          <h3 style="font-size:1.05rem; color:var(--parchment);">
            ${safeNick} <span style="font-size:0.78rem; color:var(--text-muted);">(${safeCharName})</span>
          </h3>
        </div>
        <button class="btn btn-crimson" id="btn-close-inspect" style="padding:5px 11px; font-weight:bold;">
          ${
            this.inspectedFromHandbook
              ? "📖 Kitapçığa Dön"
              : (this.room?.state as any)?.phase === "VOTE"
              ? "🗳️ Oylamaya Dön"
              : (this.room?.state as any)?.phase === "NIGHT"
              ? "🌑 Gece Ekranına Dön"
              : "✕ Kapat"
          }
        </button>
      </div>

      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn" id="btn-inspect-rot-l" style="flex:1; padding:5px;">⟲ 360° Sola</button>
        <button class="btn" id="btn-inspect-rot-r" style="flex:1; padding:5px;">Sağa ⟳</button>
        ${
          !isMe
            ? `<button class="btn" id="btn-inspect-dm" style="border-color:#c98bff; color:#e3b3ff; padding:5px 10px;">🤫 DM</button>
               <button class="btn" id="btn-inspect-mute" style="padding:5px 9px;">${
                 this.mutedPlayerIds.has(data.id) ? "🔊 Sesi Aç" : "🔇 Sustur"
               }</button>`
            : ""
        }
      </div>

      ${
        !isMe
          ? `<div style="display:flex; gap:5px;">
               <button class="btn ${curStamp === "trust" ? "btn-emerald" : ""}" data-insp-stamp="trust" style="flex:1; padding:4px 6px; font-size:0.7rem;">🟢 Güvenilir</button>
               <button class="btn ${curStamp === "suspect" ? "btn-crimson" : ""}" data-insp-stamp="suspect" style="flex:1; padding:4px 6px; font-size:0.7rem;">🟡 Şüpheli</button>
               <button class="btn ${curStamp === "traitor" ? "btn-crimson" : ""}" data-insp-stamp="traitor" style="flex:1; padding:4px 6px; font-size:0.7rem;">🔴 Hain</button>
             </div>`
          : ""
      }

      <div class="inspect-zoom-row">
        <button class="hud-zoom-step" id="btn-inspect-zoom-out" type="button" title="Uzaklaş">−</button>
        <input
          type="range"
          id="inspect-zoom-slider"
          class="inspect-zoom-slider"
          min="0"
          max="100"
          value="${zoomProg}"
          aria-label="Karakter Yakınlık Çubuğu"
        />
        <button class="hud-zoom-step" id="btn-inspect-zoom-in" type="button" title="Yakınlaş">+</button>
        <span id="inspect-zoom-badge" style="font-size:0.72rem; color:var(--gold); min-width:58px; text-align:right;">${zoomLbl}</span>
      </div>

      <div style="border-top:1px solid var(--gold-soft); padding-top:6px;">
        <div style="font-size:0.75rem; color:var(--gold); font-weight:bold; margin-bottom:4px;">
          🤝 ARKADAŞLIK & FISILTI YAKINLIK BARLARI (KİM KİMLE YAKIN?):
        </div>
        ${bondsHtml}
      </div>
    `;

    document.getElementById("btn-inspect-rot-l")?.addEventListener("click", () => {
      this.scene.inspectOrbitYaw -= 0.55;
    });
    document.getElementById("btn-inspect-rot-r")?.addEventListener("click", () => {
      this.scene.inspectOrbitYaw += 0.55;
    });
    this.bindHoldZoomButton(document.getElementById("btn-inspect-zoom-in"), -1);
    this.bindHoldZoomButton(document.getElementById("btn-inspect-zoom-out"), 1);
    const inspSlider = document.getElementById("inspect-zoom-slider") as HTMLInputElement | null;
    inspSlider?.addEventListener("input", () => {
      this.scene.setCameraZoomProgress(Number(inspSlider.value) / 100);
      this.syncCameraZoomUI();
    });
    card.querySelectorAll("[data-insp-stamp]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = (btn as HTMLElement).dataset.inspStamp as SuspectStamp;
        this.suspectTags[data.seat] = this.suspectTags[data.seat] === val ? "unknown" : val;
        this.saveHandbookToSession();
        sfx.playUiClick();
        this.renderInspectOverlay(data);
      });
    });
    document.getElementById("btn-inspect-dm")?.addEventListener("click", () => {
      this.inspectedFromHandbook = false;
      this.closeInspectOverlay();
      this.openPMThread(data.id, data.nick, data.seat);
    });
    document.getElementById("btn-inspect-mute")?.addEventListener("click", (e) => {
      if (this.mutedPlayerIds.has(data.id)) {
        this.mutedPlayerIds.delete(data.id);
        (e.currentTarget as HTMLElement).textContent = "🔇 Sustur";
      } else {
        this.mutedPlayerIds.add(data.id);
        (e.currentTarget as HTMLElement).textContent = "🔊 Sesi Aç";
      }
      this.renderPMWindows();
    });
    document.getElementById("btn-close-inspect")?.addEventListener("click", () => {
      this.closeInspectOverlay();
    });
  }

  private renderDayQuests(): void {
    const titleEl = document.getElementById("day-quest-title");
    const listEl = document.getElementById("day-quest-list");
    if (!titleEl || !listEl) return;

    const doneCount = this.myQuests.filter((q) => q.done).length;
    titleEl.textContent = `📜 Görevler (${doneCount}/${this.myQuests.length})`;

    if (this.myQuests.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-muted);">Yeni tur görevleri hazırlanıyor...</div>`;
      return;
    }

    listEl.innerHTML = this.myQuests
      .map(
        (q) => `
        <div style="background:rgba(255,255,255,0.05); border-left:3px solid ${
          q.done ? "#52b788" : "var(--gold)"
        }; padding:5px 7px; border-radius:6px;">
          <div style="display:flex; justify-content:space-between; font-weight:bold; color:${
            q.done ? "#8ce99a" : "var(--parchment)"
          };">
            <span>${q.done ? "✅" : "🎯"} ${q.title}</span>
            <span style="color:var(--gold);">+${q.rewardGold}🪙</span>
          </div>
          <div style="color:var(--text-muted); font-size:0.69rem; margin-top:2px;">
            ${q.description} ${q.goal > 1 ? `(${q.progress}/${q.goal})` : ""}
          </div>
        </div>
      `
      )
      .join("");
  }

  private getActiveMedievalStation(): MedievalStationDef | undefined {
    const curZoneId = detectRoomZone(this.localX, this.localZ).id;
    return MEDIEVAL_STATIONS.find(
      (s) => Math.hypot(this.localX - s.x, this.localZ - s.z) <= 5.2 || s.roomId === curZoneId
    );
  }

  private renderDayExtraActions(state: any): void {
    const box = document.getElementById("day-extra-actions");
    if (!box || !this.room) return;
    const me = state.players?.get(this.room.sessionId);
    const isHain = this.myRole?.role === "HAIN";
    const isGhost = !me?.alive || Boolean(me?.ghost);
    const canAskKahya = !isGhost && (state.pot || 0) >= 50;
    const activeStation = !isGhost ? this.getActiveMedievalStation() : undefined;

    const key = `${state.round}|${isHain}|${isGhost}|${canAskKahya}|${state.pot || 0}|${activeStation?.id || ""}|${this.clueJournal.length}|${this.unreadClueCount}`;
    if (key === this.lastDayExtraKey) return;
    this.lastDayExtraKey = key;

    const unreadTag = this.unreadClueCount > 0 ? ` (+${this.unreadClueCount} Yeni!)` : ` (${this.clueJournal.length})`;
    const btns: string[] = [
      `<button class="btn" id="btn-day-handbook" style="flex:1 1 100%; padding:5px 8px; font-size:0.72rem; border-color:#ffd166; color:#ffe9a8; background:linear-gradient(180deg,#54371d,#2b1b0f);">📖 El Kitapçığı & İpuçlarım${unreadTag}</button>`,
      `<button class="btn" id="btn-day-castle-map" style="flex:1; padding:4px 7px; font-size:0.7rem; border-color:var(--gold); color:var(--gold);">🗺️ Şato Odaları</button>`
    ];
    if (activeStation) {
      btns.push(
        `<button class="btn btn-emerald" id="btn-day-medieval-station" style="flex:1; padding:4px 7px; font-size:0.7rem;">${activeStation.icon} ${activeStation.shortLabel} Seçenekleri</button>`
      );
    }
    if (!isGhost && isHain) {
      btns.push(
        `<button class="btn btn-crimson" id="btn-day-sabotage" style="flex:1; padding:4px 7px; font-size:0.7rem;">🗡️ Sabotaj</button>`
      );
    }
    if (canAskKahya) {
      btns.push(
        `<button class="btn" id="btn-day-kahya-bell" style="flex:1; padding:4px 7px; font-size:0.7rem;">🔔 Kâhya Zili (50🪙)</button>`
      );
    }
    if (isGhost) {
      btns.push(
        `<button class="btn" id="btn-day-ghost-haunt" style="flex:1; padding:5px 8px; font-size:0.72rem; border-color:#9ed4ff; color:#cbe8ff;">👻 Mumları Titret</button>`
      );
    }

    box.innerHTML = btns.join("");

    document.getElementById("btn-day-handbook")?.addEventListener("click", () => {
      this.openHandbookModal();
    });
    document.getElementById("btn-day-castle-map")?.addEventListener("click", () => {
      this.openCastleRoomsGuideModal();
    });
    document.getElementById("btn-day-medieval-station")?.addEventListener("click", () => {
      const st = this.getActiveMedievalStation();
      if (st) this.openMedievalStationModal(st);
    });
    document.getElementById("btn-day-sabotage")?.addEventListener("click", () => {
      this.openSabotageModal();
    });
    document.getElementById("btn-day-kahya-bell")?.addEventListener("click", () => {
      this.openKahyaAskModal();
    });
    document.getElementById("btn-day-ghost-haunt")?.addEventListener("click", () => {
      this.room?.send("ghost_haunt");
      sfx.playSealBreak();
    });
  }

  private openSabotageModal(): void {
    const state: any = this.room?.state;
    if (!state || !this.room) return;
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;

    const others: Array<{ id: string; seat: number; nick: string }> = [];
    state.players?.forEach((p: any, sid: string) => {
      if (sid !== this.room?.sessionId && p.alive) {
        others.push({ id: sid, seat: p.seat, nick: p.nick });
      }
    });
    others.sort((a, b) => a.seat - b.seat);

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:#ff4d5e;">🗡️ GİZLİ HAİN SABOTAJ MENÜSÜ</strong>
        <button class="btn" id="btn-close-sabotage" style="padding:3px 8px;">✕</button>
      </div>
      <div style="background:rgba(155,18,32,0.2); border:1px solid #ff4d5e; border-radius:10px; padding:10px;">
        <div style="font-size:0.8rem; font-weight:bold; color:#ffb3bc; margin-bottom:5px;">
          1. Şato Karartması (12 Saniye)
        </div>
        <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:7px;">
          Tüm avize ve şamdanları aniden söndürerek şatoda panik yarat (75 sn bekleme süresi):
        </p>
        <button class="btn btn-crimson" id="btn-trigger-blackout" style="width:100%;">
          🕯️ Mumları Söndür (12 sn Karartma)
        </button>
      </div>
      <div style="background:rgba(28,18,40,0.9); border:1px solid var(--gold-soft); border-radius:10px; padding:10px;">
        <div style="font-size:0.8rem; font-weight:bold; color:var(--gold); margin-bottom:5px;">
          2. İsimsiz Sahte Not Bırak (Turda 1 Kez)
        </div>
        <select id="sabotage-note-target" style="width:100%; margin-bottom:6px;">
          ${others.map((o) => `<option value="${escapeHtml(o.id)}">#${o.seat} ${escapeHtml(String(o.nick || ""))}</option>`).join("")}
        </select>
        <input
          type="text"
          id="sabotage-note-text"
          maxlength="75"
          placeholder="Örn: Yanındaki kişiye güvenme, zarfı kanlı!"
          style="width:100%; margin-bottom:6px;"
        />
        <button class="btn" id="btn-send-fake-note" style="width:100%;">
          📜 İsimsiz Notu Gizlice Cebine Bırak
        </button>
      </div>
    `;
    modal.classList.remove("hidden");

    document.getElementById("btn-close-sabotage")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
    document.getElementById("btn-trigger-blackout")?.addEventListener("click", () => {
      modal.classList.add("hidden");
      this.room?.send("sabotage_lights");
    });
    document.getElementById("btn-send-fake-note")?.addEventListener("click", () => {
      const sel = document.getElementById("sabotage-note-target") as HTMLSelectElement | null;
      const inp = document.getElementById("sabotage-note-text") as HTMLInputElement | null;
      const targetId = sel?.value || "";
      const note = inp?.value.trim() || "Yanındaki kişiye sakın güvenme, zarfı kan kokuyor!";
      if (!targetId) return;
      modal.classList.add("hidden");
      this.room?.send("sabotage_note", { targetId, note });
    });
  }

  private openKahyaAskModal(): void {
    const state: any = this.room?.state;
    if (!state || !this.room) return;
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;

    const seats: Array<{ seat: number; nick: string }> = [];
    state.players?.forEach((p: any) => {
      if (p.alive) seats.push({ seat: p.seat, nick: p.nick });
    });
    seats.sort((a, b) => a.seat - b.seat);

    if (seats.length < 2) return;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:var(--gold);">🔔 KÂHYA ZİLİ — TAKIM SORGUSU (50🪙)</strong>
        <button class="btn" id="btn-close-kahya-ask" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.78rem; color:var(--parchment); line-height:1.45;">
        Ortak Şato Hazinesinden <strong>50🪙</strong> harcayarak seçtiğin iki koltuğun <strong>AYNI TAKIMDA</strong> mı yoksa <strong>FARKLI TAKIMDA</strong> mı olduğunu gizlice öğren!
      </p>
      <div style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:0.74rem; color:var(--gold);">1. Koltuk:</label>
        <select id="kahya-seat-a">
          ${seats.map((s, i) => `<option value="${s.seat}" ${i === 0 ? "selected" : ""}>#${s.seat} ${escapeHtml(String(s.nick || ""))}</option>`).join("")}
        </select>
        <label style="font-size:0.74rem; color:var(--gold);">2. Koltuk:</label>
        <select id="kahya-seat-b">
          ${seats.map((s, i) => `<option value="${s.seat}" ${i === 1 ? "selected" : ""}>#${s.seat} ${escapeHtml(String(s.nick || ""))}</option>`).join("")}
        </select>
      </div>
      <button class="btn btn-emerald" id="btn-confirm-kahya-ask" style="width:100%; padding:9px;">
        🔔 50🪙 Öde & Kâhya'ya Gizlice Sor
      </button>
    `;
    modal.classList.remove("hidden");

    document.getElementById("btn-close-kahya-ask")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
    document.getElementById("btn-confirm-kahya-ask")?.addEventListener("click", () => {
      const seatA = Number((document.getElementById("kahya-seat-a") as HTMLSelectElement).value);
      const seatB = Number((document.getElementById("kahya-seat-b") as HTMLSelectElement).value);
      if (seatA === seatB) {
        alert("Lütfen iki farklı koltuk seçin!");
        return;
      }
      modal.classList.add("hidden");
      this.room?.send("ask_kahya", { seatA, seatB });
    });
  }

  private handleContextWheelClick(fromKeyOnly = false): void {
    const state: any = this.room?.state;
    if (this.room && state?.phase === "DAY") {
      const nearAltar = PUZZLE_ALTARS.find(
        (a) => Math.hypot(this.localX - a.x, this.localZ - a.z) <= 4.3
      );
      if (nearAltar) {
        this.room.send("request_puzzle", { altarId: nearAltar.id });
        sfx.playSealBreak();
        return;
      }

      const distBoard = Math.hypot(
        this.localX - COUNCIL_BOARD_POS.x,
        this.localZ - COUNCIL_BOARD_POS.z
      );
      if (distBoard <= 4.5) {
        this.openCouncilBoardModal();
        return;
      }

      const activeStation = this.getActiveMedievalStation();
      if (activeStation) {
        this.openMedievalStationModal(activeStation);
        return;
      }
    }
    if (!fromKeyOnly) {
      this.scene.cycleBrightnessBoost();
    }
  }

  private openMedievalStationModal(station: MedievalStationDef): void {
    sfx.playRuneChime();
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;
    const state: any = this.room?.state;
    const maxUses = resolveDurationPreset(state?.paceMode, state?.fastMode).stationUsesPerDay || 2;
    const alreadyUsed = this.usedStationIdsThisRound.has(station.id);
    const usedCount = this.usedStationIdsThisRound.size;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--gold-soft); padding-bottom:6px;">
        <strong style="color:var(--gold); font-size:0.96rem;">${station.title}</strong>
        <button class="btn" id="btn-close-med-station" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.8rem; color:var(--parchment); line-height:1.45;">
        ${station.description}
      </p>
      ${
        alreadyUsed
          ? `<div style="font-size:0.74rem; color:#ffd166; background:rgba(212,175,55,0.14); border:1px solid var(--gold-soft); border-radius:8px; padding:5px 8px;">
               ✅ Bu odadaki etkileşimi bu gündüz turunda kullandın.
             </div>`
          : ""
      }
      <div style="display:flex; flex-direction:column; gap:7px;">
        ${station.options
          .map(
            (opt) => `
          <button
            class="btn"
            data-med-opt="${opt.id}"
            style="text-align:left; padding:9px 11px; display:flex; flex-direction:column; gap:3px; border-color:rgba(212,175,55,0.45);"
          >
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <strong style="color:var(--gold); font-size:0.84rem;">${opt.label}</strong>
              <span style="font-size:0.68rem; padding:2px 7px; border-radius:999px; background:rgba(212,175,55,0.18); color:#ffe69c;">${opt.badge}</span>
            </div>
            <span style="font-size:0.74rem; color:var(--text-muted); line-height:1.35;">${opt.desc}</span>
          </button>
        `
          )
          .join("")}
      </div>
      <div style="font-size:0.7rem; color:var(--text-muted); text-align:center;">
        🕯️ Bu oyun süresinde her gündüz turunda en fazla <strong>${maxUses}</strong> farklı oda etkileşimi kullanabilirsin (${usedCount}/${maxUses} kullanıldı).
      </div>
    `;
    modal.classList.remove("hidden");

    document.getElementById("btn-close-med-station")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
    card.querySelectorAll("[data-med-opt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const optionId = (btn as HTMLElement).dataset.medOpt!;
        this.usedStationIdsThisRound.add(station.id);
        modal.classList.add("hidden");
        this.room?.send("use_medieval_station", { stationId: station.id, optionId });
      });
    });
  }

  private openCastleRoomsGuideModal(): void {
    sfx.playSealBreak();
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;
    card.style.width = "min(640px, 94vw)";

    const curZone = detectRoomZone(this.localX, this.localZ);
    const wings = [
      { id: "kutuphane", pos: "Kuzeybatı Kulesi", name: "📚 Şato Kütüphanesi & Arşiv", info: "Fısıltı şeceresi okuma, Kâhya defteri ve Başbüyücü başlığı." },
      { id: "saat_kulesi", pos: "Kuzey Merkez", name: "🕰️ Saat Kulesi", info: "Dev Romen rakamlı saat çarkları ve kuzey gözetleme noktası." },
      { id: "zindan", pos: "Kuzeydoğu Kulesi", name: "⛓️ Zindan & Sorgu Mahzeni", info: "Hayatta kalan Hain sayısını öğrenme, zincir çınlatma ve Demir Maske." },
      { id: "toplanti_salonu", pos: "Batı Kuzey Kanadı", name: "📋 Konsey & Harita Salonu", info: "Şüphe Tahtasına tebeşirle isim yazma ve savaş haritası masası." },
      { id: "yemek_salonu", pos: "Şato Merkezi", name: "🍷 Büyük Şölen Salonu", info: "12 kişilik Yuvarlak Sofra, Kâhya Tahtı (#11) ve Hükmün Şöminesi." },
      { id: "etkinlik_salonu", pos: "Doğu Kuzey Kanadı", name: "🔮 Rün & Bulmaca Salonu", info: "3 kadim bulmaca kürsüsü, Altın Kolye ve Paslı Kâhya Anahtarı." },
      { id: "bati_koridor", pos: "Batı Kanadı", name: "🗝️ Özel Yatak Odaları (#1 - #6)", info: "Kişisel anahtarlı Orta Çağ yatak odaları (Kapını kapatıp gizli konuş!)." },
      { id: "antre", pos: "Güney Merkez", name: "🏰 Şato Antresi & Muhafız Holü", info: "Şövalye zırhları, avize ve ortak altın sandığı." },
      { id: "dogu_koridor", pos: "Doğu Kanadı", name: "🗝️ Özel Yatak Odaları (#7 - #12)", info: "Kişisel odalar ve #11 Kâhya'nın Mühürlü Odası." },
      { id: "simya_odasi", pos: "Güneybatı Mahzeni", name: "⚗️ Simya & İksir Mahzeni", info: "Doğruluk buharı, kurşunu altına çevirme (+15🪙) ve iksir rafları." },
      { id: "avlu", pos: "Güney Surları", name: "⛲ Kargalı Avlu & Dilek Kuyusu", info: "Dilek kuyusuna altın atma (+25🪙 Hazine) ve nöbetçi kuzgun gözcüsü." },
      { id: "cephanelik", pos: "Güneydoğu Burcu", name: "⚔️ Şövalye Cephaneliği", info: "Eksik hançer izi sürme, Şövalye Miğferi kuşanma ve kalkan bakımı." }
    ];

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--gold-soft); padding-bottom:6px;">
        <div>
          <div style="font-size:0.68rem; color:var(--gold); letter-spacing:1.4px;">◆ ORTA ÇAĞ ŞATO KROKİSİ (21 ODA & SALON) ◆</div>
          <strong style="color:var(--parchment); font-size:0.95rem;">📍 Şu Anki Konumun: ${curZone.name}</strong>
        </div>
        <button class="btn" id="btn-close-castle-map" style="padding:3px 9px;">✕</button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; max-height:58dvh; overflow-y:auto;">
        ${wings
          .map((w) => {
            const isHere =
              curZone.id === w.id ||
              (w.id === "bati_koridor" && curZone.id.startsWith("yatak_") && Number(curZone.id.split("_")[1]) <= 6) ||
              (w.id === "dogu_koridor" && curZone.id.startsWith("yatak_") && Number(curZone.id.split("_")[1]) >= 7);
            return `
              <div style="padding:7px 8px; border-radius:8px; background:${
                isHere ? "rgba(180, 32, 45, 0.34)" : "rgba(24, 17, 14, 0.88)"
              }; border:1px solid ${isHere ? "#ffd166" : "rgba(212,175,55,0.28)"}; font-size:0.72rem; line-height:1.35;">
                <div style="font-size:0.64rem; color:var(--gold);">${w.pos} ${isHere ? "· 📍 BURADASIN" : ""}</div>
                <strong style="color:var(--parchment); display:block; margin:2px 0;">${w.name}</strong>
                <span style="color:var(--text-muted); font-size:0.67rem;">${w.info}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
    modal.classList.remove("hidden");

    document.getElementById("btn-close-castle-map")?.addEventListener("click", () => {
      card.style.width = "";
      modal.classList.add("hidden");
    });
  }

  private openCouncilBoardModal(): void {
    const state: any = this.room?.state;
    if (!state || !this.room) return;
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;

    const suspects: Array<{ seat: number; nick: string }> = [];
    state.players?.forEach((p: any, sid: string) => {
      if (p.alive && sid !== this.room?.sessionId) {
        suspects.push({ seat: p.seat, nick: p.nick });
      }
    });
    suspects.sort((a, b) => a.seat - b.seat);

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:var(--gold);">📋 KONSEY ŞÜPHE TAHTASI</strong>
        <button class="btn" id="btn-close-board" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.78rem; color:var(--text-muted);">
        ${escapeHtml(String(state.councilBoardNote || "Tahtaya tebeşirle şüpheli gördüğün koltuğu yaz (Tüm şatoya duyurulur!):"))}
      </p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
        ${suspects
          .map(
            (s) => `
          <button class="btn" data-chalk-seat="${s.seat}">
            ✍️ #${s.seat} ${escapeHtml(String(s.nick || ""))}
          </button>
        `
          )
          .join("")}
      </div>
    `;
    modal.classList.remove("hidden");
    document.getElementById("btn-close-board")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
    card.querySelectorAll("[data-chalk-seat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seat = Number((btn as HTMLElement).dataset.chalkSeat);
        modal.classList.add("hidden");
        this.room?.send("chalk_suspect", { suspectSeat: seat });
        sfx.playUiClick();
      });
    });
  }

  private renderDayPuzzleModal(ch: {
    puzzleId: string;
    title: string;
    prompt: string;
    options: string[];
  }): void {
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:var(--gold);">🧩 ${escapeHtml(String(ch.title || ""))}</strong>
        <button class="btn" id="btn-close-puzzle" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.88rem; color:var(--parchment); line-height:1.45;">
        ${escapeHtml(String(ch.prompt || ""))}
      </p>
      <div style="display:flex; flex-direction:column; gap:7px;">
        ${ch.options
          .map(
            (opt, idx) => `
          <button class="btn" data-puz-opt="${idx}" style="text-align:left; padding:10px 12px;">
            <strong>${idx + 1}.</strong> ${escapeHtml(String(opt || ""))}
          </button>
        `
          )
          .join("")}
      </div>
    `;
    modal.classList.remove("hidden");

    document.getElementById("btn-close-puzzle")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
    card.querySelectorAll("[data-puz-opt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const optionIndex = Number((btn as HTMLElement).dataset.puzOpt);
        this.room?.send("submit_puzzle", { puzzleId: ch.puzzleId, optionIndex });
      });
    });
  }

  private showPuzzleFeedbackModal(text: string, ok: boolean, customTitle?: string): void {
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;
    const heading = customTitle || (ok ? "✨ KADİM MÜHÜR AÇILDI!" : "⚠️ MÜHÜR KAPALI KALDI");
    card.innerHTML = `
      <h3 style="color:${ok ? "#8ce99a" : "#ff6b6b"}; font-size:1rem;">
        ${escapeHtml(heading)}
      </h3>
      <p style="font-size:0.88rem; color:var(--parchment); line-height:1.45;">${escapeHtml(String(text || ""))}</p>
      <button class="btn btn-crimson" id="btn-ok-puzzle-fb" style="width:100%; padding:9px;">Tamam</button>
    `;
    modal.classList.remove("hidden");
    document.getElementById("btn-ok-puzzle-fb")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
  }

  // ==========================================================================
  // 📖 ORTA ÇAĞ DEDEKTİF & TAKTİK EL KİTAPÇIĞI (İPUCU KAYDI + HİBRİT SEÇİM)
  // ==========================================================================
  private getHandbookStorageKey(): string {
    return `sofra_handbook_${this.room?.roomId || "local"}`;
  }

  private saveHandbookToSession(): void {
    try {
      const payload = {
        clueJournal: this.clueJournal,
        recordedKeys: Array.from(this.recordedClueKeys),
        suspectTags: this.suspectTags,
        confirmedSeatFlames: this.confirmedSeatFlames,
        preTargetSeat: this.preTargetSeat
      };
      sessionStorage.setItem(this.getHandbookStorageKey(), JSON.stringify(payload));
    } catch {
      // ignore storage quota errors
    }
    this.updateHandbookHudBadge();
  }

  private loadHandbookFromSession(): void {
    this.clueJournal = [];
    this.recordedClueKeys.clear();
    this.suspectTags = {};
    this.confirmedSeatFlames = {};
    this.preTargetSeat = 0;
    this.unreadClueCount = 0;
    this.lastRecordedBoardNote = "";
    try {
      const raw = sessionStorage.getItem(this.getHandbookStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.clueJournal)) this.clueJournal = parsed.clueJournal;
        if (Array.isArray(parsed.recordedKeys)) {
          this.recordedClueKeys = new Set<string>(parsed.recordedKeys);
        }
        if (parsed.suspectTags && typeof parsed.suspectTags === "object") {
          this.suspectTags = parsed.suspectTags;
        }
        if (parsed.confirmedSeatFlames && typeof parsed.confirmedSeatFlames === "object") {
          this.confirmedSeatFlames = parsed.confirmedSeatFlames;
        }
        if (typeof parsed.preTargetSeat === "number") {
          this.preTargetSeat = parsed.preTargetSeat;
        }
      }
    } catch {
      // ignore parse errors
    }
    this.updateHandbookHudBadge();
  }

  private resetHandbookForNewMatch(): void {
    this.clueJournal = [];
    this.recordedClueKeys.clear();
    this.suspectTags = {};
    this.confirmedSeatFlames = {};
    this.preTargetSeat = 0;
    this.unreadClueCount = 0;
    this.lastRecordedBoardNote = "";
    try {
      sessionStorage.removeItem(this.getHandbookStorageKey());
    } catch {
      // ignore
    }
    this.updateHandbookHudBadge();
    if (this.handbookOpen) {
      this.renderHandbookModal();
    }
  }

  private updateHandbookHudBadge(): void {
    const btn = document.getElementById("btn-open-handbook");
    const badge = document.getElementById("handbook-badge");
    if (badge) {
      badge.textContent =
        this.unreadClueCount > 0 ? `+${this.unreadClueCount}` : `${this.clueJournal.length}`;
    }
    if (btn) {
      btn.classList.toggle("has-unread", this.unreadClueCount > 0);
    }
  }

  private addClueEntry(opts: {
    category: ClueCategory;
    icon: string;
    source: string;
    text: string;
    dedupeKey?: string;
    personal?: boolean;
    silent?: boolean;
  }): void {
    if (opts.dedupeKey && this.recordedClueKeys.has(opts.dedupeKey)) {
      return;
    }
    if (opts.dedupeKey) {
      this.recordedClueKeys.add(opts.dedupeKey);
    }
    const round = Math.max(1, Number((this.room?.state as any)?.round) || 1);
    const time = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    this.clueJournal.unshift({
      id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      round,
      category: opts.category,
      icon: opts.icon,
      source: opts.source,
      text: opts.text,
      time,
      personal: opts.personal
    });
    if (this.clueJournal.length > 80) {
      this.clueJournal.length = 80;
    }
    if (!this.handbookOpen && !opts.silent) {
      this.unreadClueCount += 1;
      sfx.playClueChime();
    }
    this.saveHandbookToSession();
    this.lastCenterRenderHash = "";
    if (this.handbookOpen) {
      this.renderHandbookModal();
    }
  }

  private cycleSuspectStamp(seat: number): void {
    const order: SuspectStamp[] = ["unknown", "trust", "suspect", "traitor"];
    const cur = this.suspectTags[seat] || "unknown";
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.suspectTags[seat] = next;
    this.saveHandbookToSession();
    this.lastCenterRenderHash = "";
    sfx.playUiClick();
  }

  private renderSeatSuspectBadge(seat: number): string {
    const stamp = this.suspectTags[seat] || "unknown";
    const isPre = this.preTargetSeat === seat;
    const parts: string[] = [];
    if (stamp === "trust") {
      parts.push(
        `<span style="background:rgba(27,94,67,0.55); border:1px solid #52b788; color:#b7f7d4; border-radius:99px; padding:1px 6px; font-size:0.64rem; font-weight:bold;">🟢 Güvenilir</span>`
      );
    } else if (stamp === "suspect") {
      parts.push(
        `<span style="background:rgba(168,112,18,0.52); border:1px solid #ffd166; color:#ffeaa7; border-radius:99px; padding:1px 6px; font-size:0.64rem; font-weight:bold;">🟡 Şüpheli</span>`
      );
    } else if (stamp === "traitor") {
      parts.push(
        `<span style="background:rgba(165,20,36,0.68); border:1px solid #ff5768; color:#ffd6dc; border-radius:99px; padding:1px 6px; font-size:0.64rem; font-weight:bold;">🔴 KESİN HAİN!</span>`
      );
    }
    if (isPre) {
      parts.push(
        `<span style="background:rgba(255,209,102,0.22); border:1px solid #ffd166; color:#ffe699; border-radius:99px; padding:1px 6px; font-size:0.64rem; font-weight:bold;">🎯 Ön-Hedefin</span>`
      );
    }
    if (parts.length === 0) return "";
    return `<div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">${parts.join("")}</div>`;
  }

  public toggleHandbookModal(): void {
    if (this.handbookOpen) {
      this.closeHandbookModal();
    } else {
      this.openHandbookModal();
    }
  }

  public openHandbookModal(mode?: "book" | "clues" | "suspects" | "actions"): void {
    if (!this.room) return;
    if (mode) this.handbookViewMode = mode;
    this.handbookOpen = true;
    this.unreadClueCount = 0;
    this.updateHandbookHudBadge();
    this.lastDayExtraKey = "";
    sfx.playPageFlip();
    const modal = document.getElementById("handbook-modal");
    modal?.classList.remove("hidden");
    this.renderHandbookModal();
  }

  public closeHandbookModal(): void {
    this.handbookOpen = false;
    document.getElementById("handbook-modal")?.classList.add("hidden");
  }

  private renderHandbookModal(): void {
    const shell = document.getElementById("handbook-shell-content");
    if (!shell || !this.room) return;

    // Kullanıcı o an kişisel not kutusuna yazı yazıyorsa metni ve odak durumunu koru
    const prevInput = document.getElementById("handbook-note-input") as HTMLInputElement | null;
    const savedNoteDraft = prevInput ? prevInput.value : "";
    const wasInputFocused = document.activeElement?.id === "handbook-note-input";

    const state: any = this.room.state || {};
    const phase: string = state.phase || "LOBBY";
    const round: number = state.round || 1;
    const myId = this.room.sessionId;
    const me = myId ? state.players?.get(myId) : null;
    const isAlive = Boolean(me && me.alive && !me.ghost);
    const isHain = this.myRole?.role === "HAIN";
    const mateIds = new Set((this.myRole?.traitorMates || []).map((m) => m.id));
    const curZone = detectRoomZone(this.localX, this.localZ);
    const remSec = Math.max(0, Math.ceil(((state.phaseEndsAt || 0) - Date.now()) / 1000));

    const rolePillHtml = this.myRole
      ? isHain
        ? `<span style="background:#8f1422; border:1px solid #ff6b7a; color:#fff; border-radius:99px; padding:2px 8px; font-size:0.7rem; font-weight:bold;">🗡️ Gizli Rolün: HAİN</span>`
        : `<span style="background:#1c3d5e; border:1px solid #7ab8ff; color:#e6f3ff; border-radius:99px; padding:2px 8px; font-size:0.7rem; font-weight:bold;">🕯️ Gizli Rolün: MİSAFİR</span>`
      : `<span style="color:var(--text-muted); font-size:0.7rem;">Lobi Hazırlığı</span>`;

    // Üst Canlı Evre Taktik Şeridi
    const activeTieIds = this.getActiveTieCandidateIds(state);
    let phaseActionHtml = "";
    if (phase === "VOTE") {
      const votedPlayer =
        this.selectedVoteTargetId && this.selectedVoteTargetId !== "ABSTAIN"
          ? state.players?.get(this.selectedVoteTargetId)
          : null;
      phaseActionHtml = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="color:#ff6b7a;">🗳️ ${
            activeTieIds.length > 0 ? "⚖️ İKİNCİ TUR EŞİTLİK OYLAMASI:" : "SOFRA & ŞÖMİNE OYLAMASI:"
          }</strong>
          <span>${
            !isAlive
              ? "👻 Hayalet olarak izliyorsun"
              : this.selectedVoteTargetId === "ABSTAIN"
              ? "🏳️ Çekimser kaldın"
              : votedPlayer
              ? `✅ Oyun Mühürlendi: #${votedPlayer.seat} ${escapeHtml(votedPlayer.nick)}`
              : "Sağ sayfadan kime oy atacağını veya kimi suçlayacağını tek tıkla seç!"
          }</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          ${
            isAlive && (state.pot || 0) >= 50
              ? `<button class="btn" id="hb-btn-kahya" style="padding:4px 9px; font-size:0.72rem;">🔔 Kâhya'ya Sor (50🪙)</button>`
              : ""
          }
          ${
            isAlive
              ? `<button class="btn" id="hb-btn-abstain" style="padding:4px 9px; font-size:0.72rem;">🏳️ Çekimser Kal</button>`
              : ""
          }
          <button class="btn btn-crimson" id="hb-btn-focus-main" style="padding:4px 9px; font-size:0.72rem;">🗳️ Ana Seçim Ekranı</button>
        </div>
      `;
    } else if (phase === "NIGHT") {
      if (isHain && isAlive) {
        const picked = this.selectedNightTargetId ? state.players?.get(this.selectedNightTargetId) : null;
        phaseActionHtml = `
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <strong style="color:#ff5768;">🩸 HAİNLER TOPLANTISI AKTİF:</strong>
            <span>${
              this.isNightSealed && picked
                ? `✅ İnfaz Mühürlendi: #${picked.seat} ${escapeHtml(picked.nick)}`
                : picked
                ? `🎯 Seçili Kurban: #${picked.seat} ${escapeHtml(picked.nick)}`
                : "Sağ sayfadan bu gece infaz edilecek Misafiri seç!"
            }</span>
          </div>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            ${
              picked
                ? `<button class="btn ${this.isNightSealed ? "btn-emerald" : "btn-crimson"}" id="hb-btn-seal-night" style="padding:4px 10px; font-size:0.73rem;">${
                    this.isNightSealed ? `✅ #${picked.seat} Mühürlendi` : `🩸 #${picked.seat} İnfazını Mühürle!`
                  }</button>`
                : ""
            }
            <button class="btn" id="hb-btn-focus-main" style="padding:4px 9px; font-size:0.72rem;">🌑 Meclis Sohbeti</button>
          </div>
        `;
      } else {
        phaseActionHtml = `
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <strong style="color:var(--gold);">🌑 GECE MOLASI (Hainler Toplantıda):</strong>
            <span>${
              this.nightWatchNote
                ? "✅ Bu gece koridoru dinledin."
                : isAlive
                ? "Kapı deliğinden koridoru dinleyerek ipucu yakala!"
                : "Sabah çanı bekleniyor..."
            }</span>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            ${
              isAlive && !this.nightWatchNote
                ? `<button class="btn btn-crimson" id="hb-btn-night-watch" style="padding:4px 10px; font-size:0.73rem;">🕯️ Kapı Deliğinden Dinle (+10🪙)</button>`
                : ""
            }
          </div>
        `;
      }
    } else if (phase === "TRIAL") {
      phaseActionHtml = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="color:#8ce99a;">🧩 ŞATO BULMACA SINAVI AKTİF!</strong>
          <span>3 aşamayı çözüp 📿 Altın Kolye ve Dedektif İpucu kazan!</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          ${
            isHain && isAlive && this.activeTrial?.canSabotage
              ? `<button class="btn btn-crimson" id="hb-btn-trial-sabotage" style="padding:4px 9px; font-size:0.72rem;">🗡️ Sınavı Sabote Et (+25🪙)</button>`
              : ""
          }
          <button class="btn btn-emerald" id="hb-btn-focus-main" style="padding:4px 10px; font-size:0.73rem;">🧩 Bulmacayı Çözmeye Geç</button>
        </div>
      `;
    } else if (phase === "FINAL") {
      phaseActionHtml = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="color:var(--gold);">⚖️ SON KİŞİLER FİNAL KARARI:</strong>
          <span>${
            isAlive
              ? "İpuçlarına göre son hükmünü buradan mühürleyebilirsin:"
              : "👻 Hayalet olarak kalan davetlilerin final kararını izliyorsun."
          }</span>
        </div>
        ${
          isAlive
            ? `<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                 <button class="btn ${this.selectedFinalChoice === "TRUST" ? "btn-emerald" : ""}" id="hb-btn-final-trust" style="padding:4px 10px; font-size:0.73rem;">🤝 Hepimiz Misafiriz</button>
                 <button class="btn ${this.selectedFinalChoice === "DOUBT" ? "btn-crimson" : ""}" id="hb-btn-final-doubt" style="padding:4px 10px; font-size:0.73rem;">🔥 Aramızda Hain Var</button>
               </div>`
            : ""
        }
      `;
    } else if (phase === "TABLE") {
      phaseActionHtml = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="color:var(--gold);">🗣️ YUVARLAK SOFRA TARTIŞMASI:</strong>
          <span>İpuçlarına bakarak sağ sayfadan <strong>👉 Suçla</strong> veya <strong>🎯 Oylama Ön-Hedefi</strong> kilitle!</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          ${
            isAlive && (state.pot || 0) >= 50
              ? `<button class="btn" id="hb-btn-kahya" style="padding:4px 9px; font-size:0.72rem;">🔔 Kâhya'ya Sor (50🪙)</button>`
              : ""
          }
          <button class="btn ${this.isLocalReadyForPhase ? "btn-emerald" : ""}" id="hb-btn-ready" style="padding:4px 9px; font-size:0.72rem;">${
            this.isLocalReadyForPhase ? "✅ Hazırım" : "⏩ Hazırım"
          } ${this.readyStatusText}</button>
        </div>
      `;
    } else if (phase === "DAY") {
      const st = isAlive ? this.getActiveMedievalStation() : undefined;
      phaseActionHtml = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="color:var(--gold);">📍 ${escapeHtml(curZone.name)} (Gün ${round}):</strong>
          <span>${
            st
              ? `${st.icon} Bu odada <strong>${escapeHtml(st.shortLabel)}</strong> etkileşimi hazır!`
              : "Odaları gez, fısıldaş ve yakaladığın ipuçlarını takip et."
          }</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          ${
            st
              ? `<button class="btn btn-emerald" id="hb-btn-open-station" style="padding:4px 9px; font-size:0.72rem;">${st.icon} ${escapeHtml(st.shortLabel)} Seçenekleri</button>`
              : ""
          }
          <button class="btn ${this.isLocalReadyForPhase ? "btn-emerald" : ""}" id="hb-btn-ready" style="padding:4px 9px; font-size:0.72rem;">${
            this.isLocalReadyForPhase ? "✅ Hazırım" : "⏩ Hazırım"
          } ${this.readyStatusText}</button>
        </div>
      `;
    } else {
      phaseActionHtml = `
        <div>
          <strong style="color:var(--gold);">📜 Durum:</strong> ${escapeHtml(state.announcement || "Şato kayıtları hazır.")}
        </div>
        <span style="color:var(--gold); font-size:0.74rem;">🪙 Ortak Hazine: ${state.pot || 0}</span>
      `;
    }

    // SOL SAYFA: YAKALANAN İPUÇLARI & KANITLAR
    const clueCount = this.clueJournal.filter((c) => c.category === "clue").length;
    const fireCount = this.clueJournal.filter((c) => c.category === "fire").length;
    const noteCount = this.clueJournal.filter((c) => c.category === "note").length;
    const filteredClues =
      this.clueFilter === "all"
        ? this.clueJournal
        : this.clueJournal.filter((c) => c.category === this.clueFilter);

    const cluesListHtml =
      filteredClues.length === 0
        ? `<div style="padding:14px 10px; text-align:center; color:var(--text-muted); font-size:0.78rem; line-height:1.5; border:1px dashed rgba(226,189,83,0.3); border-radius:10px;">
             🕯️ <strong>Henüz bu kategoride kayıtlı ipucu yok.</strong><br/>
             Şatoda <em>Rün Kürsüsü, Simya Mahzeni, Cephanelik, Kütüphane, Zindan, 1 Dk Bulmaca Sınavı, Kâhya Zili, Kapı Dinleme, Şömine Alevleri</em> ve <em>Açık Oylamalar</em> gerçekleştiğinde tüm kanıtlar buraya <strong>otomatik kaydedilir!</strong>
           </div>`
        : filteredClues
            .map(
              (c) => `
              <div class="clue-entry ${c.category === "fire" ? "cat-fire" : c.category === "note" ? "cat-note" : ""}">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:2px;">
                  <span style="font-size:0.68rem; color:var(--gold); font-weight:bold;">
                    GÜN ${c.round} · ${c.icon} ${c.source}
                  </span>
                  <span style="font-size:0.65rem; color:var(--text-muted); display:flex; align-items:center; gap:5px;">
                    ${c.time}
                    ${
                      c.personal
                        ? `<button class="btn" data-del-note="${c.id}" title="Notu Sil" style="padding:0 5px; font-size:0.62rem;">✕</button>`
                        : ""
                    }
                  </span>
                </div>
                <div>${c.text}</div>
              </div>
            `
            )
            .join("");

    const leftCluesPageHtml = `
      <div class="handbook-page">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
          <strong style="color:var(--gold); font-size:0.86rem;">🕵️ YAKALANAN İPUÇLARI & KANITLAR (${this.clueJournal.length})</strong>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            ${[
              { k: "all", lbl: `Tümü (${this.clueJournal.length})` },
              { k: "clue", lbl: `🔍 İpucu (${clueCount})` },
              { k: "fire", lbl: `🔥 Oylar (${fireCount})` },
              { k: "note", lbl: `✍️ Not (${noteCount})` }
            ]
              .map(
                (f) => `
                <button class="handbook-tab-btn ${this.clueFilter === f.k ? "active" : ""}" data-clue-filter="${f.k}" style="padding:2px 7px; font-size:0.68rem;">
                  ${f.lbl}
                </button>
              `
              )
              .join("")}
          </div>
        </div>

        <form id="handbook-note-form" style="display:flex; gap:5px;">
          <input
            type="text"
            id="handbook-note-input"
            maxlength="110"
            placeholder="✍️ Kendi dedektif notunu yaz (Örn: #4 Kütüphanede kaçtı)..."
            style="flex:1; padding:6px 9px; font-size:0.76rem;"
          />
          <button type="submit" class="btn" style="padding:6px 10px; font-size:0.74rem;">+ Not Al</button>
        </form>

        <div style="display:flex; flex-direction:column; gap:6px;">
          ${cluesListHtml}
        </div>
      </div>
    `;

    // SAĞ SAYFA: ŞÜPHELİ MATRİSİ, ÖN-HEDEF KİLİDİ & CANLI SEÇİM KONTROLÜ
    const allSeats: any[] = Array.from(state.players?.values() || []).sort(
      (a: any, b: any) => a.seat - b.seat
    );
    const stampCounts = { traitor: 0, suspect: 0, trust: 0 };
    allSeats.forEach((p) => {
      const st = this.suspectTags[p.seat];
      if (st === "traitor") stampCounts.traitor += 1;
      else if (st === "suspect") stampCounts.suspect += 1;
      else if (st === "trust") stampCounts.trust += 1;
    });

    const suspectRowsHtml =
      allSeats.length === 0
        ? `<div style="font-size:0.78rem; color:var(--text-muted); padding:10px;">Oyuncular yükleniyor...</div>`
        : allSeats
            .map((p: any) => {
              const isSelf = p.id === myId;
              const isMate = isHain && mateIds.has(p.id);
              const stamp: SuspectStamp = this.suspectTags[p.seat] || "unknown";
              const isPre = this.preTargetSeat === p.seat;
              const confirmed = this.confirmedSeatFlames[p.seat];
              const stampLabel =
                stamp === "trust"
                  ? "🟢 Güvenilir"
                  : stamp === "suspect"
                  ? "🟡 Şüpheli"
                  : stamp === "traitor"
                  ? "🔴 KESİN HAİN!"
                  : "❓ Damgala";
              const stampClass =
                stamp === "trust"
                  ? "stamp-trust"
                  : stamp === "suspect"
                  ? "stamp-suspect"
                  : stamp === "traitor"
                  ? "stamp-traitor"
                  : "";

              let subStatus = "";
              if (!p.alive) {
                if (confirmed === "RED") subStatus = "💀 Elendi · 🔥 Kırmızı Alev (HAİN)";
                else if (confirmed === "WHITE") subStatus = "💀 Elendi · ❄️ Beyaz Alev (MASUM)";
                else if (confirmed === "EXEC") subStatus = "💀 Gece İnfazında Öldü (MASUM)";
                else subStatus = "💀 Elendi (Hayalet)";
              } else {
                const flags: string[] = [];
                if (state.necklaceHolder === p.id) flags.push("📿 Altın Kolye");
                if (phase === "VOTE" && p.votedForId) flags.push("✉️ Oy Verdi");
                if (isPre) flags.push("🎯 Ön-Hedefin");
                if (isMate) flags.push("🗡️ Suç Ortağın");
                subStatus = flags.length > 0 ? flags.join(" · ") : "Hayatta";
              }

              // Evreye göre doğrudan Kitapçık İçi Seçim Düğmeleri!
              let phaseBtnHtml = "";
              if (p.alive && !isSelf) {
                if (phase === "VOTE" && isAlive) {
                  const picked = this.selectedVoteTargetId === p.id;
                  const tieBlocked = activeTieIds.length > 0 && !activeTieIds.includes(p.id);
                  phaseBtnHtml = `
                    <button class="btn ${picked ? "btn-emerald" : tieBlocked ? "" : "btn-crimson"}" data-hb-vote="${p.id}" ${
                    tieBlocked ? "disabled" : ""
                  } style="padding:4px 8px; font-size:0.7rem;">${
                    picked ? "✅ Oyun Bunda" : tieBlocked ? "⚖️ Eşitlik Dışı" : "🔥 Oy Ver"
                  }</button>
                    <button class="btn" data-hb-accuse="${p.id}" data-seat="${p.seat}" data-nick="${escapeHtml(p.nick)}" style="padding:3px 7px; font-size:0.68rem;">👉 Suçla</button>
                  `;
                } else if (phase === "NIGHT" && isHain && isAlive && !isMate) {
                  const picked = this.selectedNightTargetId === p.id;
                  phaseBtnHtml = `
                    <button class="btn btn-crimson" data-hb-night-kill="${p.id}" style="padding:4px 8px; font-size:0.7rem;">🗡️ İnfaz Et</button>
                    <button class="btn ${picked ? "btn-emerald" : ""}" data-hb-night-pick="${p.id}" style="padding:4px 7px; font-size:0.68rem;">${
                    picked ? "✅ Hedef" : "🎯"
                  }</button>
                  `;
                } else if (phase === "TABLE") {
                  phaseBtnHtml = `
                    <button class="btn btn-crimson" data-hb-accuse="${p.id}" data-seat="${p.seat}" data-nick="${escapeHtml(p.nick)}" style="padding:3px 7px; font-size:0.68rem;">👉 Suçla</button>
                    <button class="btn ${isPre ? "btn-emerald" : ""}" data-hb-pretarget="${p.seat}" title="Oylama/Gece için Ön-Hedef Kilitle" style="padding:3px 7px; font-size:0.68rem;">${
                    isPre ? "🎯 Kilitli" : "🎯 Hedef"
                  }</button>
                  `;
                } else {
                  phaseBtnHtml = `
                    <button class="btn ${isPre ? "btn-emerald" : ""}" data-hb-pretarget="${p.seat}" title="Oylama veya Gece İnfazı için Ön-Hedef Kilitle" style="padding:3px 7px; font-size:0.68rem;">${
                    isPre ? "🎯 Kilitli" : "🎯 Hedef"
                  }</button>
                  `;
                }
              }

              return `
                <div class="suspect-row ${isPre ? "pre-targeted" : ""} ${!p.alive ? "dead-seat" : ""}">
                  <div style="min-width:135px; flex:1;">
                    <div style="font-size:0.79rem; font-weight:bold; color:${
                      isMate ? "#ff8593" : isSelf ? "var(--gold)" : "var(--parchment)"
                    };">
                      #${p.seat} ${escapeHtml(p.nick)} ${isSelf ? "(Sen)" : ""}
                    </div>
                    <div style="font-size:0.67rem; color:${
                      confirmed === "RED" ? "#ff6b7a" : confirmed === "WHITE" ? "#9ed4ff" : "var(--text-muted)"
                    };">
                      ${subStatus}
                    </div>
                  </div>
                  <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;">
                    ${
                      !isSelf
                        ? `<button class="stamp-btn ${stampClass}" data-stamp-seat="${p.seat}" title="Şüphe Damgasını Değiştir">
                            ${stampLabel}
                          </button>`
                        : ""
                    }
                    ${phaseBtnHtml}
                    ${
                      !isSelf
                        ? `<button class="btn" data-hb-dm="${p.id}" data-seat="${p.seat}" data-nick="${escapeHtml(p.nick)}" title="Özel DM Fısılda" style="padding:3px 6px; font-size:0.68rem; border-color:rgba(201,139,255,0.45);">🤫</button>`
                        : ""
                    }
                    <button class="btn" data-hb-inspect="${p.id}" title="360° İncele & Yakınlık Barı" style="padding:3px 6px; font-size:0.68rem;">🔍</button>
                  </div>
                </div>
              `;
            })
            .join("");

    const rightSuspectsPageHtml = `
      <div class="handbook-page">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
          <strong style="color:var(--gold); font-size:0.86rem;">⚖️ ŞÜPHELİLER & TAKTİK SEÇİM KONTROLÜ</strong>
          <div style="font-size:0.68rem; color:var(--text-muted);">
            🔴 ${stampCounts.traitor} · 🟡 ${stampCounts.suspect} · 🟢 ${stampCounts.trust}
          </div>
        </div>
        <div style="font-size:0.71rem; color:var(--parchment); background:rgba(226,189,83,0.09); border:1px solid rgba(226,189,83,0.25); border-radius:7px; padding:5px 8px;">
          💡 <strong>Hibrit Kontrol:</strong> İpuçlarını okurken koltukları damgala (<em>Damgala</em>), oylama öncesi <strong>🎯 Hedef</strong> kilitle; Oylama veya Gece başladığında seçimini ister ana ekrandan ister doğrudan bu sayfadan mühürle!
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
          ${suspectRowsHtml}
        </div>
      </div>
    `;

    // 3. SEKME: ŞATO ODA EYLEMLERİ, GİZLİ GÖREVLER & REHBER
    const activeStation = phase === "DAY" && isAlive ? this.getActiveMedievalStation() : undefined;
    const nearAltar =
      phase === "DAY" &&
      isAlive &&
      PUZZLE_ALTARS.find((a) => Math.hypot(this.localX - a.x, this.localZ - a.z) <= 4.3);
    const nearBoard =
      phase === "DAY" &&
      isAlive &&
      (Math.hypot(this.localX - COUNCIL_BOARD_POS.x, this.localZ - COUNCIL_BOARD_POS.z) <= 4.5 ||
        curZone.id === "toplanti_salonu");

    const actionsPageHtml = `
      <div class="handbook-page">
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:10px;">
          <div style="display:flex; flex-direction:column; gap:7px; background:rgba(16,12,20,0.72); border:1px solid var(--gold-soft); border-radius:10px; padding:9px;">
            <strong style="color:var(--gold); font-size:0.82rem;">🏰 Bulunduğun Oda & Şato Eylemleri</strong>
            <div style="font-size:0.74rem; color:var(--parchment);">
              📍 Konumun: <strong>${escapeHtml(curZone.name)}</strong> · Ortak Hazine: <strong style="color:var(--gold);">🪙 ${state.pot || 0}</strong>
            </div>

            ${
              activeStation
                ? `<div style="display:flex; flex-direction:column; gap:5px; margin-top:2px;">
                     <div style="font-size:0.72rem; color:#8ce99a; font-weight:bold;">${activeStation.title} (Buradan Kullan):</div>
                     ${activeStation.options
                       .map(
                         (opt) => `
                         <button class="btn" data-hb-station="${activeStation.id}" data-hb-opt="${opt.id}" style="text-align:left; padding:6px 9px; font-size:0.73rem; display:flex; justify-content:space-between; align-items:center;">
                           <span>${opt.label}</span>
                           <span style="color:var(--gold); font-size:0.66rem;">${opt.badge}</span>
                         </button>
                       `
                       )
                       .join("")}
                   </div>`
                : nearAltar
                ? `<button class="btn btn-emerald" data-hb-altar="${nearAltar.id}" style="width:100%;">🔮 ${nearAltar.label} Bulmacasını Aç</button>`
                : nearBoard
                ? `<button class="btn btn-emerald" id="hb-act-board" style="width:100%;">📋 Konsey Şüphe Tahtasını Aç</button>`
                : `<div style="font-size:0.72rem; color:var(--text-muted); line-height:1.4;">
                     Gündüz keşfinde <strong>📚 Kütüphane, ⚗️ Simya Mahzeni, ⚔️ Cephanelik, ⛓️ Zindan, ⛲ Kargalı Avlu, 📋 Konsey Salonu</strong> veya <strong>🔮 Bulmaca Salonu</strong>'na gittiğinde oda seçenekleri burada aktifleşir!
                   </div>`
            }

            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
              <button class="btn" id="hb-act-castle-map" style="flex:1; font-size:0.72rem;">🗺️ 21 Oda Krokisi</button>
              ${
                (phase === "DAY" || phase === "TABLE" || phase === "VOTE") && isAlive && (state.pot || 0) >= 50
                  ? `<button class="btn btn-emerald" id="hb-act-kahya" style="flex:1; font-size:0.72rem;">🔔 Kâhya Zili (50🪙)</button>`
                  : ""
              }
              ${
                phase === "DAY" && isAlive && isHain
                  ? `<button class="btn btn-crimson" id="hb-act-sabotage" style="flex:1; font-size:0.72rem;">🗡️ Hain Sabotajı</button>`
                  : ""
              }
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:7px; background:rgba(16,12,20,0.72); border:1px solid var(--gold-soft); border-radius:10px; padding:9px;">
            <strong style="color:var(--gold); font-size:0.82rem;">📜 Günlük Gizli Görevlerin & Dedektif Rehberi</strong>
            ${
              this.myQuests.length === 0
                ? `<div style="font-size:0.73rem; color:var(--text-muted);">Oyun başladığında kişisel görevlerin burada listelenir.</div>`
                : this.myQuests
                    .map(
                      (q) => `
                      <div style="font-size:0.73rem; padding:5px 7px; border-radius:6px; background:rgba(255,255,255,0.04); border-left:3px solid ${
                        q.done ? "#52b788" : "var(--gold)"
                      };">
                        <strong>${q.done ? "✅" : "🎯"} ${escapeHtml(q.title)} (+${q.rewardGold}🪙)</strong>
                        <div style="color:var(--text-muted); font-size:0.68rem;">${escapeHtml(q.description)} ${
                        q.goal > 1 ? `(${q.progress}/${q.goal})` : ""
                      }</div>
                      </div>
                    `
                    )
                    .join("")
            }
            <div style="margin-top:auto; padding-top:6px; border-top:1px solid rgba(226,189,83,0.22); font-size:0.7rem; color:var(--parchment); line-height:1.45;">
              🔥 <strong>Şömine Kırmızı Alev:</strong> Yanan kişi <strong>HAİN</strong> idi.<br/>
              ❄️ <strong>Şömine Beyaz Alev:</strong> Yanan kişi <strong>MASUM MİSAFİR</strong> idi.<br/>
              📿 <strong>Altın Kolye:</strong> Sahibini o gece Hainlerin infazından korur.<br/>
              🔔 <strong>Kâhya Zili (50🪙):</strong> Seçilen 2 koltuğun aynı/farklı takımda olduğunu söyler.
            </div>
          </div>
        </div>
      </div>
    `;

    const bodyGridClass =
      this.handbookViewMode === "book" ? "handbook-open-book" : "handbook-open-book single-col";
    const bodyInnerHtml =
      this.handbookViewMode === "book"
        ? `${leftCluesPageHtml}${rightSuspectsPageHtml}`
        : this.handbookViewMode === "clues"
        ? leftCluesPageHtml
        : this.handbookViewMode === "suspects"
        ? rightSuspectsPageHtml
        : actionsPageHtml;

    shell.innerHTML = `
      <div class="handbook-header">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="color:var(--gold); font-size:1rem; letter-spacing:0.8px;">📖 KARGALI ŞATO EL KİTAPÇIĞI</strong>
          ${rolePillHtml}
          <span id="handbook-live-timer" style="font-size:0.73rem; color:#ffd166; font-weight:bold;">
            ${phase === "LOBBY" ? "Hazır" : `⏳ ${remSec} sn`}
          </span>
        </div>

        <div class="handbook-tabs">
          <button class="handbook-tab-btn ${this.handbookViewMode === "book" ? "active" : ""}" data-hb-tab="book">
            📖 Çift Sayfa (İpucu + Seçim)
          </button>
          <button class="handbook-tab-btn ${this.handbookViewMode === "clues" ? "active" : ""}" data-hb-tab="clues">
            🕵️ İpuçları (${this.clueJournal.length})
          </button>
          <button class="handbook-tab-btn ${this.handbookViewMode === "suspects" ? "active" : ""}" data-hb-tab="suspects">
            ⚖️ Şüpheliler
          </button>
          <button class="handbook-tab-btn ${this.handbookViewMode === "actions" ? "active" : ""}" data-hb-tab="actions">
            🏰 Eylemler & Rehber
          </button>
          <button class="btn btn-crimson" id="btn-close-handbook" style="padding:4px 10px; font-size:0.75rem;">
            ✕ Kapat
          </button>
        </div>
      </div>

      <div class="handbook-phase-strip">
        ${phaseActionHtml}
      </div>

      <div class="${bodyGridClass}">
        ${bodyInnerHtml}
      </div>
    `;

    // Yazılmakta olan taslak notu geri yükle
    const nextInput = document.getElementById("handbook-note-input") as HTMLInputElement | null;
    if (nextInput && savedNoteDraft) {
      nextInput.value = savedNoteDraft;
    }
    if (nextInput && wasInputFocused) {
      nextInput.focus();
    }

    // Sekme & Kapatma Olayları
    document.getElementById("btn-close-handbook")?.addEventListener("click", () => {
      this.closeHandbookModal();
    });
    shell.querySelectorAll("[data-hb-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sfx.playPageFlip();
        this.handbookViewMode = (btn as HTMLElement).dataset.hbTab as any;
        this.renderHandbookModal();
      });
    });
    shell.querySelectorAll("[data-clue-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sfx.playUiClick();
        this.clueFilter = (btn as HTMLElement).dataset.clueFilter as any;
        this.renderHandbookModal();
      });
    });

    // Kişisel Dedektif Notu Ekleme / Silme
    document.getElementById("handbook-note-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = document.getElementById("handbook-note-input") as HTMLInputElement | null;
      const val = inp?.value.trim() || "";
      if (!val) return;
      if (inp) inp.value = "";
      this.addClueEntry({
        category: "note",
        icon: "✍️",
        source: "Kişisel Dedektif Notum",
        text: escapeHtml(val),
        personal: true,
        silent: true
      });
      sfx.playSealBreak();
    });
    shell.querySelectorAll("[data-del-note]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.delNote!;
        this.clueJournal = this.clueJournal.filter((c) => c.id !== id);
        this.saveHandbookToSession();
        this.renderHandbookModal();
      });
    });

    // Şüphe Damgası & Ön-Hedef Kilidi
    shell.querySelectorAll("[data-stamp-seat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seat = Number((btn as HTMLElement).dataset.stampSeat);
        this.cycleSuspectStamp(seat);
        this.renderHandbookModal();
      });
    });
    shell.querySelectorAll("[data-hb-pretarget]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seat = Number((btn as HTMLElement).dataset.hbPretarget);
        this.preTargetSeat = this.preTargetSeat === seat ? 0 : seat;
        this.saveHandbookToSession();
        this.lastCenterRenderHash = "";
        sfx.playSealBreak();
        this.renderHandbookModal();
      });
    });

    // Doğrudan Kitapçıktan Canlı Oylama / Gece İnfazı / Suçlama / Final Seçimleri
    shell.querySelectorAll("[data-hb-vote]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = (btn as HTMLElement).dataset.hbVote!;
        if (!isAlive || targetId === myId) return;
        if (activeTieIds.length > 0 && !activeTieIds.includes(targetId)) return;
        this.selectedVoteTargetId = targetId;
        this.room?.send("vote", { targetId });
        sfx.playVoteStamp();
        this.lastCenterRenderHash = "";
        this.renderHandbookModal();
      });
    });
    document.getElementById("hb-btn-abstain")?.addEventListener("click", () => {
      if (!isAlive) return;
      this.selectedVoteTargetId = "ABSTAIN";
      this.room?.send("vote", { targetId: "ABSTAIN" });
      sfx.playVoteStamp();
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    shell.querySelectorAll("[data-hb-night-kill]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = (btn as HTMLElement).dataset.hbNightKill!;
        this.selectedNightTargetId = targetId;
        this.isNightSealed = true;
        this.room?.send("night_pick", { targetId, instantSeal: true });
        sfx.playDaggerDraw();
        this.lastCenterRenderHash = "";
        this.renderHandbookModal();
      });
    });
    shell.querySelectorAll("[data-hb-night-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = (btn as HTMLElement).dataset.hbNightPick!;
        this.selectedNightTargetId = targetId;
        this.room?.send("night_pick", { targetId });
        sfx.playHeartbeat();
        this.lastCenterRenderHash = "";
        this.renderHandbookModal();
      });
    });
    document.getElementById("hb-btn-seal-night")?.addEventListener("click", () => {
      if (!this.selectedNightTargetId) return;
      this.isNightSealed = true;
      this.room?.send("seal_night_execution");
      sfx.playDaggerDraw();
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    document.getElementById("hb-btn-night-watch")?.addEventListener("click", () => {
      this.room?.send("night_watch");
    });
    document.getElementById("hb-btn-trial-sabotage")?.addEventListener("click", () => {
      if (this.activeTrial) this.activeTrial.canSabotage = false;
      this.room?.send("sabotage_trial");
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    document.getElementById("hb-btn-final-trust")?.addEventListener("click", () => {
      if (!isAlive) return;
      this.selectedFinalChoice = "TRUST";
      this.room?.send("final_decision", { decision: "TRUST" });
      sfx.playVoteStamp();
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    document.getElementById("hb-btn-final-doubt")?.addEventListener("click", () => {
      if (!isAlive) return;
      this.selectedFinalChoice = "DOUBT";
      this.room?.send("final_decision", { decision: "DOUBT" });
      sfx.playVoteStamp();
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    document.getElementById("hb-btn-focus-main")?.addEventListener("click", () => {
      this.closeHandbookModal();
    });
    document.getElementById("hb-btn-ready")?.addEventListener("click", () => {
      this.isLocalReadyForPhase = true;
      this.room?.send("ready_next_phase");
      sfx.playSealBreak();
      const topReadyBtn = document.getElementById("btn-ready-phase");
      if (topReadyBtn) topReadyBtn.textContent = `✅ Hazırım ${this.readyStatusText}`;
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    document.getElementById("hb-btn-kahya")?.addEventListener("click", () => {
      this.openKahyaAskModal();
    });
    document.getElementById("hb-btn-open-station")?.addEventListener("click", () => {
      const st = this.getActiveMedievalStation();
      if (st) this.openMedievalStationModal(st);
    });

    shell.querySelectorAll("[data-hb-accuse]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLElement;
        this.openAccuseModal(el.dataset.hbAccuse!, Number(el.dataset.seat), el.dataset.nick!);
      });
    });
    shell.querySelectorAll("[data-hb-dm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLElement;
        this.closeHandbookModal();
        this.openPMThread(el.dataset.hbDm!, el.dataset.nick!, Number(el.dataset.seat));
      });
    });
    shell.querySelectorAll("[data-hb-inspect]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = (btn as HTMLElement).dataset.hbInspect!;
        this.inspectedFromHandbook = true;
        this.closeHandbookModal();
        this.room?.send("request_inspect", { targetId });
      });
    });

    // 3. Sekme Oda Etkileşimleri
    shell.querySelectorAll("[data-hb-station]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLElement;
        this.usedStationIdsThisRound.add(el.dataset.hbStation!);
        this.room?.send("use_medieval_station", {
          stationId: el.dataset.hbStation!,
          optionId: el.dataset.hbOpt!
        });
      });
    });
    shell.querySelectorAll("[data-hb-altar]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const altarId = (btn as HTMLElement).dataset.hbAltar!;
        this.room?.send("request_puzzle", { altarId });
      });
    });
    document.getElementById("hb-act-board")?.addEventListener("click", () => {
      this.closeHandbookModal();
      this.openCouncilBoardModal();
    });
    document.getElementById("hb-act-castle-map")?.addEventListener("click", () => {
      this.openCastleRoomsGuideModal();
    });
    document.getElementById("hb-act-kahya")?.addEventListener("click", () => {
      this.openKahyaAskModal();
    });
    document.getElementById("hb-act-sabotage")?.addEventListener("click", () => {
      this.openSabotageModal();
    });
  }

  // ==========================================================================
  // OYUN EVRELERİ ARAYÜZLERİ (LOBİ, ROL ZARFI, SINAV, SOFRA, GECE, FİNAL, SONUÇ)
  // ==========================================================================
  private getActiveTieCandidateIds(state: any): string[] {
    if (typeof state?.tieCandidateCsv === "string" && state.tieCandidateCsv.trim().length > 0) {
      return state.tieCandidateCsv
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    return this.tieCandidateIds || [];
  }

  private renderCenterPanel(state: any): void {
    const panel = document.getElementById("center-panel")!;
    const phase: string = state.phase || "LOBBY";

    // 360° Karakter İnceleme açıkken orta panel 3B karakterin önünü kapatmasın!
    if (this.scene.inspectTargetId) {
      panel.classList.add("hidden");
      return;
    }

    const playerSummary = Array.from(state.players?.values() || [])
      .map((p: any) => `${p.id}:${p.seat}:${p.nick}:${p.alive}:${p.connected}:${Boolean(p.isBot)}:${p.coatColor}:${p.hat}:${p.mask}:${p.votedForId}`)
      .join("|");
    const trialSecretKey = this.activeTrialSecretResult
      ? `${this.activeTrialSecretResult.wonNecklace}:${this.activeTrialSecretResult.someoneWon}:${this.activeTrialSecretResult.text}`
      : "";
    const trialKey = this.activeTrial
      ? `${this.activeTrial.stage}:${this.activeTrial.puzzleId}:${this.activeTrial.canSabotage}:${this.activeTrial.completedClue || ""}`
      : "";
    const picksKey = Array.from(this.traitorNightPicks.entries())
      .map(([k, v]) => `${k}>${v.targetSeat}`)
      .join(",");
    const stampsKey = Object.entries(this.suspectTags)
      .map(([s, t]) => `${s}:${t}`)
      .join(",");
    const tieKey = this.getActiveTieCandidateIds(state).join(",");
    const hash = `${phase}|${state.round}|${this.myRole?.role || ""}|${this.myHasSecretNecklace}|${trialSecretKey}|${state.fastMode}|${state.paceMode || "normal"}|${state.targetPlayerCount || 10}|${state.atmosphereTheme || "torch"}|${state.autoStart}|${state.pot}|${state.lastBurnedId}|${state.lastBurnedFlame}|${state.winReason}|${this.lastVoteReveal.length}|${this.mobileLobbyTab}|${this.vault.gold}|${this.vault.selectedSeat}|${this.vault.coatColor}|${this.vault.hat}|${this.vault.mask}|${this.selectedVoteTargetId}|${this.selectedNightTargetId}|${this.selectedFinalChoice}|${this.isLocalReadyForPhase}|${this.isNightSealed}|${this.readyStatusText}|${tieKey}|${this.preTargetSeat}|${stampsKey}|${this.clueJournal.length}|${trialKey}|${picksKey}|${this.nightConclaveLogs.length}|${this.nightWatchNote}|${Boolean(this.gameOverSummary)}|${playerSummary}`;

    if (hash === this.lastCenterRenderHash) return;
    this.lastCenterRenderHash = hash;
    if (this.handbookOpen && hash !== this.lastHandbookRenderHash) {
      this.lastHandbookRenderHash = hash;
      this.renderHandbookModal();
    }

    if (phase === "DAY") {
      panel.classList.add("hidden");
      return;
    }

    panel.classList.remove("hidden");

    if (phase === "LOBBY") {
      this.renderLobbyStudio(panel, state);
    } else if (phase === "ARRIVAL") {
      this.renderArrivalEnvelope(panel);
    } else if (phase === "TRIAL") {
      this.renderTrialPanel(panel, state);
    } else if (phase === "TABLE") {
      this.renderTableVotePanel(panel, state);
    } else if (phase === "VOTE") {
      this.renderVoteSelectionPanel(panel, state);
    } else if (phase === "FIRE") {
      this.renderFireRevealPanel(panel, state);
    } else if (phase === "NIGHT") {
      this.renderNightPanel(panel, state);
    } else if (phase === "MORNING") {
      this.renderMorningPanel(panel, state);
    } else if (phase === "FINAL") {
      this.renderFinalPanel(panel, state);
    } else if (phase === "RESULT") {
      this.renderResultPanel(panel, state);
    }
  }

  private renderLobbyStudio(panel: HTMLElement, state: any): void {
    const selectableChars = CHARACTERS.filter((c) => c.selectable);
    const playerCount = state.players?.size || 1;
    const myId = this.room?.sessionId || "";
    const isHost = state.hostId === myId;
    const targetCount = state.targetPlayerCount || 10;
    const activePreset = resolveDurationPreset(state.paceMode, state.fastMode);
    const paceMode = activePreset.id;
    const atmo = state.atmosphereTheme || "torch";

    const seatOccupants = new Map<number, { id: string; nick: string; isBot: boolean }>();
    let botCount = 0;
    state.players?.forEach((p: any, sid: string) => {
      const idStr = String(p.id || sid);
      const isBot = Boolean(p.isBot || idStr.startsWith("bot_"));
      if (isBot) botCount += 1;
      seatOccupants.set(p.seat, { id: idStr, nick: p.nick || "Misafir", isBot });
    });

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>🏰 ${state.hasPassword ? "🔒" : "🔓"} ${escapeHtml(state.roomTitle || "ORTA ÇAĞ SOFRA LOBİSİ")} (${playerCount}/${targetCount})</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            Oda Kodu: <strong style="color:var(--gold);">${escapeHtml(state.code || "---")}</strong> · <strong style="color:#ffe6a1;">${escapeHtml(activePreset.title)}</strong> (${escapeHtml(activePreset.summary)})
          </span>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn" id="btn-lobby-inspect-self">🔍 360° Karakterim</button>
          <button class="btn" id="btn-share-room">🔗 Davet Kopyala</button>
          ${
            isHost
              ? `
            <button class="btn" id="btn-add-bots">🤖 Bot Doldur</button>
            ${
              botCount > 0
                ? `<button class="btn" id="btn-remove-bots">🧹 Botları Sil</button>`
                : ""
            }
            <button class="btn" id="btn-auto-start">⏱️ Oto: ${state.autoStart ? "AÇIK" : "KAPALI"}</button>
            <button class="btn btn-crimson" id="btn-start-game">🔥 SOFRAYI BAŞLAT</button>
          `
              : `<span style="font-size:0.8rem; color:var(--gold);">Kurucunun başlatması bekleniyor...</span>`
          }
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:space-between; background:rgba(28,18,12,0.75); border:1px solid var(--gold-soft); border-radius:10px; padding:7px 10px; margin-bottom:8px; font-size:0.75rem;">
        <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
          <strong style="color:var(--gold);">👥 Sofra Kadrosu:</strong>
          ${[
            { n: 8, lbl: "8 Kişi (1 Hain)" },
            { n: 10, lbl: "10 Kişi (2 Hain)" },
            { n: 12, lbl: "12 Kişi (2 Hain)" }
          ]
            .map(
              (o) =>
                `<button class="btn ${targetCount === o.n ? "btn-crimson" : ""}" data-opt-count="${o.n}" ${
                  !isHost ? "disabled" : ""
                } style="padding:3px 8px; font-size:0.71rem;">${o.lbl}</button>`
            )
            .join("")}
        </div>
        <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
          <strong style="color:var(--gold);">⏱️ Oyun Süresi:</strong>
          ${[
            { k: "10m", lbl: "⚡ 10 Dk Hızlı" },
            { k: "20m", lbl: "⏳ 20 Dk Standart" },
            { k: "35m", lbl: "🕵️ 35 Dk Dedektif" },
            { k: "60m", lbl: "👑 1 Saat Destansı" }
          ]
            .map(
              (p) =>
                `<button class="btn ${paceMode === p.k ? "btn-crimson" : ""}" data-opt-pace="${p.k}" ${
                  !isHost ? "disabled" : ""
                } style="padding:3px 8px; font-size:0.71rem;">${p.lbl}</button>`
            )
            .join("")}
        </div>
        <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
          <strong style="color:var(--gold);">🕯️ Şato Havası:</strong>
          ${[
            { k: "torch", lbl: "🔥 Meşale & Taş" },
            { k: "crimson", lbl: "🩸 Kızıl Ay" },
            { k: "mist", lbl: "🌫️ Sisli Fırtına" }
          ]
            .map(
              (a) =>
                `<button class="btn ${atmo === a.k ? "btn-crimson" : ""}" data-opt-atmo="${a.k}" ${
                  !isHost ? "disabled" : ""
                } style="padding:3px 8px; font-size:0.71rem;">${a.lbl}</button>`
            )
            .join("")}
        </div>
      </div>

      <div class="mobile-lobby-tabs">
        <button class="btn ${this.mobileLobbyTab === "seats" ? "btn-crimson" : ""}" id="tab-btn-seats">
          🎭 Dizi Karakterleri
        </button>
        <button class="btn ${this.mobileLobbyTab === "custom" ? "btn-crimson" : ""}" id="tab-btn-custom">
          🛡️ Orta Çağ Zırh, Miğfer & Kasa
        </button>
      </div>

      <div class="studio-grid ${this.mobileLobbyTab === "custom" ? "mobile-tab-custom" : "mobile-tab-seats"}">
        <div class="studio-col-seats">
          <div class="seat-grid">
            ${selectableChars
              .map((c) => {
                const occ = seatOccupants.get(c.seat);
                const isMine = occ?.id === myId || (!occ && this.vault.selectedSeat === c.seat);
                const takenByHuman = Boolean(occ && !occ.isBot && occ.id !== myId);
                const occLabel = isMine
                  ? `<span style="color:#6ef2b1; font-weight:bold;">👑 Senin Koltuğun</span>`
                  : takenByHuman
                  ? `<span style="color:#ff8593;">👤 Dolu: ${escapeHtml(occ!.nick)}</span>`
                  : occ?.isBot
                  ? `<span style="color:#ffd166;">🤖 Bot (Dokun & Geç)</span>`
                  : `<span style="color:#8ce99a;">🟢 Boş Koltuk</span>`;
                return `
              <div class="seat-card ${isMine ? "active" : ""}" data-seat="${c.seat}" data-human-locked="${
                  takenByHuman ? "1" : "0"
                }" style="${takenByHuman ? "opacity:0.65; cursor:not-allowed;" : ""}">
                <div class="seat-num">SANDALYE #${c.seat} (Oda #${c.seat})</div>
                <div class="seat-name">${escapeHtml(c.name)}</div>
                <div class="seat-title">${escapeHtml(c.title)}</div>
                <div style="margin-top:4px; font-size:0.68rem;">${occLabel}</div>
              </div>
            `;
              })
              .join("")}
          </div>
        </div>

        <div class="customizer-box studio-col-custom">
          <h3 style="color:var(--gold); font-size:0.92rem;">🛡️ Orta Çağ Karakterini & Zırhını Seç</h3>
          <div class="field-row">
            <label>Görünecek Ünvan / Adın:</label>
            <input type="text" id="input-custom-name" maxlength="18" value="${escapeHtml(this.vault.customName)}" placeholder="Örn: Şövalye Cenker..." />
          </div>
          <div class="field-row">
            <label>Orta Çağ Pelerin & Zırh Rengi:</label>
            <div class="color-swatches">
              ${COAT_PALETTE.map(
                (col) => `
                <div class="swatch ${this.vault.coatColor === col ? "active" : ""}" style="background:${col}" data-color="${col}"></div>
              `
              ).join("")}
            </div>
          </div>
          <div class="field-row">
            <label>Orta Çağ Miğfer / Başlık / Taç:</label>
            <select id="select-hat">
              <option value="none" ${this.vault.hat === "none" ? "selected" : ""}>Başlık Yok</option>
              <option value="knight" ${this.vault.hat === "knight" ? "selected" : ""}>🪖 Şövalye Miğferi (Ücretsiz)</option>
              <option value="wizard" ${this.vault.hat === "wizard" ? "selected" : ""}>🧙 Simyacı / Alim Külahı (Ücretsiz)</option>
              <option value="noble" ${this.vault.hat === "noble" ? "selected" : ""}>🎩 Asilzade Tüylü Beresi (Ücretsiz)</option>
              <option value="hood" ${this.vault.hat === "hood" ? "selected" : ""}>🦅 Kuzgun Pelerin Kapüşonu (Ücretsiz)</option>
              <option value="fedora" ${this.vault.hat === "fedora" ? "selected" : ""}>🕵️ Gece Gezgini Şapkası (Ücretsiz)</option>
              <option value="bun" ${this.vault.hat === "bun" ? "selected" : ""}>💠 Hanedan Topuzu (Ücretsiz)</option>
              <option value="crown" ${this.vault.hat === "crown" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("crown") ? "👑 Kraliyet Tacı (Açık)" : "🔒 Kraliyet Tacı (50 🪙)"}
              </option>
            </select>
          </div>
          <div class="field-row">
            <label>Orta Çağ Maske & Sakal:</label>
            <select id="select-mask">
              <option value="none" ${this.vault.mask === "none" ? "selected" : ""}>Maske Yok</option>
              <option value="ironmask" ${this.vault.mask === "ironmask" ? "selected" : ""}>⛓️ Demir Şövalye Maskesi (Ücretsiz)</option>
              <option value="beard" ${this.vault.mask === "beard" ? "selected" : ""}>🧔 Uzun Orta Çağ Sakalı (Ücretsiz)</option>
              <option value="glasses" ${this.vault.mask === "glasses" ? "selected" : ""}>⚜️ Simyacı Gözlüğü (Ücretsiz)</option>
              <option value="royalvisor" ${this.vault.mask === "royalvisor" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("royalvisor") ? "⚜️ Altın Hanedan Maskesi (Açık)" : "🔒 Altın Hanedan Maskesi (50 🪙)"}
              </option>
              <option value="domino" ${this.vault.mask === "domino" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("domino") ? "🎭 Saray Balo Maskesi (Açık)" : "🔒 Saray Balo Maskesi (50 🪙)"}
              </option>
              <option value="plague" ${this.vault.mask === "plague" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("plague") ? "🦅 Orta Çağ Veba Maskesi (Açık)" : "🔒 Orta Çağ Veba Maskesi (50 🪙)"}
              </option>
            </select>
          </div>
          <button class="btn btn-crimson" id="btn-apply-custom" style="padding:10px;">
            ✨ Zırh & Görünümü Kaydet
          </button>
        </div>
      </div>
    `;

    panel.querySelectorAll("[data-opt-count]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const count = Number((btn as HTMLElement).dataset.optCount);
        this.room?.send("set_lobby_options", { targetPlayerCount: count });
      });
    });
    panel.querySelectorAll("[data-opt-pace]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pm = (btn as HTMLElement).dataset.optPace!;
        this.room?.send("set_lobby_options", { paceMode: pm });
      });
    });
    panel.querySelectorAll("[data-opt-atmo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const at = (btn as HTMLElement).dataset.optAtmo!;
        this.room?.send("set_lobby_options", { atmosphereTheme: at });
      });
    });

    document.getElementById("btn-lobby-inspect-self")?.addEventListener("click", () => {
      if (this.room) {
        this.room.send("request_inspect", { targetId: this.room.sessionId });
      }
    });

    document.getElementById("btn-share-room")?.addEventListener("click", () => {
      const shareUrl = `${window.location.origin}/?oda=${state.code}`;
      if (navigator.share) {
        navigator.share({ title: "SOFRA: Kargalı Şato", text: `Oda Kodumuz: ${state.code}`, url: shareUrl }).catch(() => {});
      } else {
        navigator.clipboard?.writeText(shareUrl);
        alert(`Davet bağlantısı kopyalandı: ${shareUrl}`);
      }
    });

    document.getElementById("tab-btn-seats")?.addEventListener("click", () => {
      this.mobileLobbyTab = "seats";
      this.lastCenterRenderHash = "";
    });
    document.getElementById("tab-btn-custom")?.addEventListener("click", () => {
      this.mobileLobbyTab = "custom";
      this.lastCenterRenderHash = "";
    });

    panel.querySelectorAll(".seat-card").forEach((el) => {
      el.addEventListener("click", () => {
        if ((el as HTMLElement).dataset.humanLocked === "1") {
          sfx.playDoorLocked();
          return;
        }
        const seat = Number((el as HTMLElement).dataset.seat);
        const charDef = CHARACTERS.find((c) => c.seat === seat);
        if (!charDef) return;
        sfx.playUiClick();
        this.vault.selectedSeat = seat;
        this.vault.coatColor = charDef.coatColor;
        this.vault.accentColor = charDef.accentColor;
        this.vault.hat = charDef.hat;
        this.vault.mask = charDef.mask;
        this.saveVault();
        this.sendCustomizeToServer();
        this.lastCenterRenderHash = "";
      });
    });

    panel.querySelectorAll(".swatch").forEach((el) => {
      el.addEventListener("click", () => {
        this.vault.coatColor = (el as HTMLElement).dataset.color!;
        this.saveVault();
        this.sendCustomizeToServer();
        this.lastCenterRenderHash = "";
      });
    });

    const nameInput = document.getElementById("input-custom-name") as HTMLInputElement;
    const hatSelect = document.getElementById("select-hat") as HTMLSelectElement;
    const maskSelect = document.getElementById("select-mask") as HTMLSelectElement;

    const tryUnlockCosmetic = (itemKey: string): boolean => {
      if (this.vault.unlockedItems.includes(itemKey)) return true;
      if (this.vault.gold < 50) {
        alert("Bu özel aksesuar için 50 Altın gerekiyor! Üstteki '🎬+50' düğmesine dokunarak hemen kazanabilirsin.");
        return false;
      }
      this.vault.gold -= 50;
      this.vault.unlockedItems.push(itemKey);
      sfx.playGoldChime();
      this.saveVault();
      return true;
    };

    document.getElementById("btn-apply-custom")?.addEventListener("click", () => {
      this.vault.customName = nameInput.value.trim();
      const chosenHat = hatSelect.value;
      const chosenMask = maskSelect.value;
      if (chosenHat === "crown" && !tryUnlockCosmetic("crown")) return;
      if (
        (chosenMask === "domino" || chosenMask === "plague" || chosenMask === "royalvisor") &&
        !tryUnlockCosmetic(chosenMask)
      ) {
        return;
      }
      this.vault.hat = chosenHat;
      this.vault.mask = chosenMask;
      this.saveVault();
      this.sendCustomizeToServer();
      this.lastCenterRenderHash = "";
    });

    document.getElementById("btn-add-bots")?.addEventListener("click", () => {
      sfx.playUiClick();
      this.room?.send("add_bots", { count: 11 });
    });
    document.getElementById("btn-remove-bots")?.addEventListener("click", () => {
      sfx.playUiClick();
      this.room?.send("remove_bots");
    });
    document.getElementById("btn-auto-start")?.addEventListener("click", () => {
      sfx.playUiClick();
      this.room?.send("toggle_auto_start");
    });
    document.getElementById("btn-fast-mode")?.addEventListener("click", () => {
      this.room?.send("toggle_fast_mode");
    });
    document.getElementById("btn-start-game")?.addEventListener("click", () => {
      sfx.playSealBreak();
      this.sendCustomizeToServer();
      this.room?.send("start_game");
    });
  }

  private renderArrivalEnvelope(panel: HTMLElement): void {
    if (!this.myRole) {
      panel.innerHTML = `
        <div style="text-align:center; padding:18px;">
          <p style="color:var(--gold); letter-spacing:1.5px; font-size:0.8rem;">◆ KARGALI ŞATO KABUL SALONU ◆</p>
          <h2 style="font-size:1.3rem; margin:10px 0; color:var(--parchment);">
            📜 Mühürlü Rol Zarfın Açılıyor...
          </h2>
          <p style="font-size:0.86rem; color:var(--text-muted);">
            Kâhya davetlilerin gizli mühürlerini dağıtıyor, lütfen bir an bekle.
          </p>
        </div>
      `;
      return;
    }

    const isHain = this.myRole.role === "HAIN";
    const fellows = this.myRole.traitorMates ?? [];

    panel.innerHTML = `
      <div style="text-align:center; padding:10px;">
        <p style="color:var(--gold); letter-spacing:1.5px; font-size:0.78rem;">◆ GİZLİ ROL ZARFINIZ AÇILDI ◆</p>
        <h2 style="font-size:1.45rem; margin:8px 0; color:${isHain ? "#ff4d5e" : "#7ab8ff"};">
          ${isHain ? "🗡️ ROLÜNÜZ: HAİN" : "🕯️ ROLÜNÜZ: MİSAFİR"}
        </h2>
        <p style="font-size:0.92rem; max-width:520px; margin:0 auto 10px; line-height:1.45;">
          ${
            isHain
              ? "Sofraya sızdın! Gündüz şüpheleri başkalarının üzerine çek, gece hedefini seç."
              : "Şatonun sadık davetlisin! Gündüz odaları gez, fısıltıları takip et ve Hainleri şömineye gönder."
          }
        </p>
        ${
          isHain && fellows.length > 0
            ? `<div style="background:rgba(155,18,32,0.25); border:1px solid #ff4d5e; border-radius:10px; padding:8px 12px; display:inline-block; font-size:0.85rem; margin-bottom:10px;">
                <strong>🗡️ Gizli Suç Ortağın:</strong> ${fellows
                  .map((f) => `#${f.seat} ${escapeHtml(f.nick)}`)
                  .join(", ")}
              </div>`
            : ""
        }
        <div style="margin-top:8px;">
          <button class="btn ${this.isLocalReadyForPhase ? "btn-emerald" : "btn-crimson"}" id="btn-arrival-ready" style="padding:9px 18px; font-size:0.9rem;">
            ${
              this.isLocalReadyForPhase
                ? `✅ Hazırım ${this.readyStatusText || "— Diğer Davetliler Bekleniyor"}`
                : "🔥 ZARFI ALDIM — ŞATO KEŞFİNE BAŞLA"
            }
          </button>
        </div>
      </div>
    `;

    document.getElementById("btn-arrival-ready")?.addEventListener("click", () => {
      this.isLocalReadyForPhase = true;
      this.room?.send("ready_next_phase");
      sfx.playSealBreak();
      this.lastCenterRenderHash = "";
    });
  }

  private renderTrialPanel(panel: HTMLElement, state: any): void {
    const tr = this.activeTrial;
    const secRes = this.activeTrialSecretResult;
    const isHain = this.myRole?.role === "HAIN";
    const me = state.players?.get(this.room?.sessionId);
    const isSpectating = !me || !me.alive || me.ghost;

    // 1. SÜRE BİTTİ VEYA HERKES TAMAMLADI -> GİZLİ KOLYE SONUÇ ZARFI!
    if (secRes) {
      const won = secRes.wonNecklace;
      panel.innerHTML = `
        <div style="text-align:center; padding:18px 14px;">
          <div style="font-size:0.76rem; letter-spacing:1.6px; color:var(--gold); margin-bottom:6px;">
            ◆ OYUN ZAMANI GİZLİ SONUÇ ZARFI ◆
          </div>
          <h2 style="font-size:1.35rem; color:${won ? "#ffd166" : "#f4e9d8"}; margin-bottom:10px;">
            ${
              won
                ? "📿 ALTIN KOLYE SENİN OLDU! (KİMSENİN HABERİ YOK)"
                : secRes.someoneWon
                ? "🤫 GİZLİ ALTIN KOLYE SAHİBİNİ BULDU!"
                : "⏳ SÜRE DOLDU — ALTIN KOLYE SAHİPSİZ KALDI"
            }
          </h2>
          <div style="margin:0 auto 12px; max-width:600px; background:${
            won ? "rgba(88, 66, 14, 0.52)" : "rgba(38, 16, 28, 0.68)"
          }; border:2px solid ${won ? "#ffd166" : "var(--gold-soft)"}; border-radius:14px; padding:14px; font-size:0.94rem; line-height:1.5; color:var(--parchment);">
            ${escapeHtml(secRes.text)}
          </div>
          <div style="font-size:0.82rem; color:var(--text-muted);">
            🔔 Yuvarlak Sofra & Şömine Oylaması birazdan başlıyor... Ortak Hazine: <strong style="color:var(--gold);">🪙 ${state.pot}</strong>
          </div>
        </div>
      `;
      return;
    }

    if (isSpectating) {
      panel.innerHTML = `
        <div style="text-align:center; padding:16px;">
          <h2 style="color:var(--gold);">🔔 EVET, OYUN ZAMANI! (1 DAKİKA)</h2>
          <p style="margin-top:8px; color:var(--text-muted);">
            Şatoda her şey 1 dakikalığına durdu! Hayatta kalan davetliler GİZLİ ALTIN KOLYE için yarışıyor... Ortak Hazine: <strong style="color:var(--gold);">🪙 ${state.pot}</strong>
          </p>
        </div>
      `;
      return;
    }

    if (!tr) {
      panel.innerHTML = `
        <div style="text-align:center; padding:16px;">
          <h2 style="color:var(--gold);">🔔 EVET, OYUN ZAMANI! YARIŞ BAŞLIYOR...</h2>
        </div>
      `;
      return;
    }

    if (tr.stage >= 4) {
      panel.innerHTML = `
        <div style="text-align:center; padding:14px;">
          <h2 style="color:#8ce99a; font-size:1.25rem;">⏳ 3/3 AŞAMA MÜHÜRLENDİ — GİZLİ SONUÇ BEKLENİYOR!</h2>
          <p style="margin:10px auto; max-width:580px; background:rgba(30,65,45,0.45); border:1px solid #8ce99a; border-radius:10px; padding:10px; font-size:0.9rem;">
            ${escapeHtml(tr.completedClue || "Dedektif ipucun açıldı!")}
          </p>
          <div style="font-size:0.84rem; color:#ffd166; margin-top:6px;">
            🤫 Yarış bittiğinde ilk bitirene <strong>KİMSENİN HABERİ OLMADAN</strong> Gizli Altın Kolye verilecek! (🪙 Hazine: ${state.pot})
          </div>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>🔔 EVET, OYUN ZAMANI! — AŞAMA ${tr.stage}/${tr.totalStages}</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            Şatoda her şey 1 dakikalığına durdu! İlk bitiren (veya ilk doğru yapan) sonuçlarda belirlenip <strong style="color:var(--gold);">KİMSENİN HABERİ OLMADAN 📿 Altın Kolyeyi</strong> alır!
          </span>
        </div>
        <span class="gold-badge">🪙 Hazine: ${state.pot}</span>
      </div>

      ${
        tr.feedback
          ? `<div style="margin-bottom:8px; padding:6px 10px; border-radius:8px; background:rgba(212,175,55,0.14); border:1px solid var(--gold-soft); font-size:0.8rem; color:var(--gold);">
              ${escapeHtml(tr.feedback)}
            </div>`
          : ""
      }

      <div style="background:rgba(22,16,34,0.92); border:1px solid var(--gold-soft); border-radius:12px; padding:12px; margin-bottom:10px;">
        <div style="font-size:0.76rem; color:var(--gold); margin-bottom:4px;">${escapeHtml(tr.title)}</div>
        <p style="font-size:0.95rem; line-height:1.45; margin-bottom:10px;">${escapeHtml(tr.prompt)}</p>
        <div style="display:flex; flex-direction:column; gap:7px;">
          ${(tr.options || [])
            .map(
              (opt: string, idx: number) => `
            <button class="btn" data-trial-opt="${idx}" style="text-align:left; padding:10px 12px;">
              <strong>${idx + 1}.</strong> ${escapeHtml(opt)}
            </button>
          `
            )
            .join("")}
        </div>
      </div>

      ${
        isHain && tr.canSabotage
          ? `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; background:rgba(155,18,32,0.22); border:1px solid #ff4d5e; border-radius:10px; padding:8px 12px;">
              <span style="font-size:0.78rem; color:#ffb3bc;">
                🗡️ <strong>Hain Yetkisi:</strong> Düzeneği gizlice bozup hazineden +25🪙 çalabilirsin (Kâhya sabotaj sayısını sofrada duyurur!).
              </span>
              <button class="btn btn-crimson" id="btn-sabotage-trial">🗡️ Gizlice Sabote Et (+25🪙)</button>
            </div>`
          : ""
      }
    `;

    panel.querySelectorAll("[data-trial-opt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const optionIndex = Number((btn as HTMLElement).dataset.trialOpt);
        this.room?.send("submit_trial_answer", { puzzleId: tr.puzzleId, optionIndex });
        sfx.playSealBreak();
      });
    });

    document.getElementById("btn-sabotage-trial")?.addEventListener("click", () => {
      if (this.activeTrial) this.activeTrial.canSabotage = false;
      this.room?.send("sabotage_trial");
      this.lastCenterRenderHash = "";
    });
  }

  private openAccuseModal(targetId: string, targetSeat: number, targetNick: string): void {
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;
    const presetReasons = [
      "Gizli odada şüpheli fısıltılaştı, Yakınlık Barı çok yüksek!",
      "Koridorda sürekli takip edip kapı önlerinde bekledi!",
      "Rün Kürsüsü ve istasyonlardan hep uzak durdu, ipucu paylaşmıyor!",
      "Savunması çelişkili, suçu masumların üstüne yıkıyor!"
    ];

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:#ff4d5e;">👉 SUÇLA: #${targetSeat} ${escapeHtml(targetNick)}</strong>
        <button class="btn" id="btn-close-accuse" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.78rem; color:var(--text-muted);">
        Yuvarlak Sofrada herkesin duyacağı gerekçeni seç veya kendi kanıtını yaz:
      </p>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${presetReasons
          .map(
            (r) => `
          <button class="btn" data-accuse-reason="${escapeHtml(r)}" style="text-align:left; font-size:0.78rem; padding:8px 10px;">
            🗣️ "${escapeHtml(r)}"
          </button>
        `
          )
          .join("")}
      </div>
      <form id="custom-accuse-form" style="display:flex; gap:6px; margin-top:4px;">
        <input type="text" id="custom-accuse-input" maxlength="85" placeholder="Bu hain, çünkü..." style="flex:1;" />
        <button type="submit" class="btn btn-crimson">Suçla!</button>
      </form>
    `;
    modal.classList.remove("hidden");

    document.getElementById("btn-close-accuse")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    card.querySelectorAll("[data-accuse-reason]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const reason = (btn as HTMLElement).dataset.accuseReason!;
        modal.classList.add("hidden");
        this.room?.send("accuse_player", { targetId, reason });
        sfx.playSealBreak();
      });
    });

    document.getElementById("custom-accuse-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = document.getElementById("custom-accuse-input") as HTMLInputElement;
      const reason = inp.value.trim() || "Hareketleri ve fısıltıları çok şüpheli!";
      modal.classList.add("hidden");
      this.room?.send("accuse_player", { targetId, reason });
      sfx.playSealBreak();
    });
  }

  private renderTableVotePanel(panel: HTMLElement, state: any): void {
    const players = Array.from(state.players?.values() || []).filter((p: any) => p.alive);
    const isVotePhase = state.phase === "VOTE";
    const myId = this.room?.sessionId;

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>🔔 YUVARLAK SOFRA — ${isVotePhase ? "ŞÖMİNE OYLAMASI" : "STRATEJİK TARTIŞMA & SAVUNMA"}</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            <strong>🔍 İncele</strong> ile kimin kiminle yakın fısıldaştığına bak, <strong>👉 Suçla</strong> ile gerekçeni masaya vur!
          </span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <button class="btn" id="btn-table-open-hb" style="padding:4px 9px; font-size:0.72rem; border-color:#ffd166; color:#ffe9a8;">
            📖 El Kitapçığı (${this.clueJournal.length})
          </button>
          ${
            !isVotePhase && (state.pot || 0) >= 50
              ? `<button class="btn" id="btn-table-kahya-ask" style="padding:4px 9px; font-size:0.72rem;">🔔 Kâhya'ya Sor (50🪙)</button>`
              : ""
          }
          <span style="font-size:0.76rem; color:var(--gold);">🪙 Hazine: ${state.pot} · #11 Kâhya İzliyor</span>
        </div>
      </div>
      <p style="font-size:0.82rem; color:var(--parchment); margin-bottom:10px;">
        ${
          isVotePhase
            ? "🔥 Zarfı şömineye atılacak şüphelinin kartına dokunarak oyunu mühürle (Kendine oy veremezsin):"
            : "🗣️ Sofrada taşları dökme vakti! Aşağıdan şüphelileri incele, gerekçeli suçlama yap veya alttaki sohbetten kendini savun."
        }
      </p>
      <div class="seat-grid">
        ${players
          .map(
            (p: any) => `
          <div class="seat-card ${this.selectedVoteTargetId === p.id ? "active" : ""}" data-vote-id="${p.id}">
            <div class="seat-num">SANDALYE #${p.seat}</div>
            <div class="seat-name">${escapeHtml(p.nick)} ${p.id === myId ? "(Sen)" : ""}</div>
            <div class="seat-title">${
              !p.connected
                ? "⚡ Bağlantı Bekleniyor..."
                : state.necklaceHolder === p.id
                ? "📿 Altın Kolye (Gece Korumalı)"
                : p.votedForId
                ? "✉️ Oyunu Mühürledi"
                : "Hayatta"
            }</div>
            ${this.renderSeatSuspectBadge(p.seat)}
            <div style="display:flex; gap:4px; margin-top:6px;">
              <button class="btn" data-table-inspect="${p.id}" style="flex:1; padding:3px 5px; font-size:0.68rem;">
                🔍 Bar
              </button>
              ${
                p.id !== myId
                  ? `<button class="btn btn-crimson" data-table-accuse="${p.id}" data-seat="${p.seat}" data-nick="${escapeHtml(p.nick)}" style="flex:1; padding:3px 5px; font-size:0.68rem;">
                      👉 Suçla
                    </button>`
                  : ""
              }
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    document.getElementById("btn-table-open-hb")?.addEventListener("click", () => {
      this.openHandbookModal("book");
    });
    document.getElementById("btn-table-kahya-ask")?.addEventListener("click", () => {
      this.openKahyaAskModal();
    });

    panel.querySelectorAll("[data-table-inspect]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tid = (btn as HTMLElement).dataset.tableInspect!;
        this.room?.send("request_inspect", { targetId: tid });
      });
    });

    panel.querySelectorAll("[data-table-accuse]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const el = btn as HTMLElement;
        this.openAccuseModal(el.dataset.tableAccuse!, Number(el.dataset.seat), el.dataset.nick!);
      });
    });

    if (isVotePhase) {
      panel.querySelectorAll("[data-vote-id]").forEach((el) => {
        el.addEventListener("click", () => {
          const targetId = (el as HTMLElement).dataset.voteId!;
          if (targetId === this.room?.sessionId) return;
          this.selectedVoteTargetId = targetId;
          this.room?.send("vote", { targetId });
          sfx.playVoteStamp();
          this.lastCenterRenderHash = "";
        });
      });
    }
  }

  private renderVoteSelectionPanel(panel: HTMLElement, state: any): void {
    const players = Array.from(state.players?.values() || []).filter((p: any) => p.alive);
    const myId = this.room?.sessionId;
    const me = myId ? state.players?.get(myId) : null;
    const canVote = Boolean(me && me.alive && !me.ghost);
    const activeTieIds = this.getActiveTieCandidateIds(state);
    const isTieRunoff = activeTieIds.length > 0;
    const chosenPlayer =
      this.selectedVoteTargetId && this.selectedVoteTargetId !== "ABSTAIN"
        ? state.players?.get(this.selectedVoteTargetId)
        : null;
    const preTargetPlayer: any =
      this.preTargetSeat > 0
        ? players.find(
            (cand: any) =>
              cand.seat === this.preTargetSeat &&
              cand.id !== myId &&
              (!isTieRunoff || activeTieIds.includes(cand.id))
          )
        : null;

    const tieRunoffBanner = isTieRunoff
      ? `<div style="margin-bottom:8px; padding:9px 12px; border-radius:10px; background:linear-gradient(135deg, rgba(165,24,38,0.42), rgba(212,175,55,0.22)); border:2px solid var(--gold); font-size:0.84rem; color:#fff2cc;">
           ⚖️ <strong>OYLAR EŞİT ÇIKTI — İKİNCİ TUR (RUNOFF) OYLAMA!</strong> Yalnızca en çok oyu paylaşan adaylara oy atılabilir:
           <strong>${activeTieIds
             .map((tid) => {
               const tp = state.players?.get(tid);
               return tp ? `#${tp.seat} ${escapeHtml(tp.nick)}` : "";
             })
             .filter(Boolean)
             .join(" · ")}</strong>
         </div>`
      : "";

    const statusBanner = !canVote
      ? `<div style="margin-bottom:10px; padding:9px 12px; border-radius:10px; background:rgba(70,85,120,0.25); border:1px solid #7ab8ff; font-size:0.84rem; color:#cfe5ff;">
           👻 Elenerek Hayalet oldun — yaşayan davetlilerin sofra tartışmasını ve şömine oylamasını izliyorsun.
         </div>`
      : this.selectedVoteTargetId === "ABSTAIN"
      ? `<div style="margin-bottom:10px; padding:9px 12px; border-radius:10px; background:rgba(212,175,55,0.18); border:1px solid var(--gold); font-size:0.86rem; color:var(--gold);">
           🏳️ <strong>Çekimser kaldın!</strong> İstersen süre bitmeden aşağıdaki kartlardan birine <strong>🔥 OY AT</strong> diyebilirsin.
         </div>`
      : chosenPlayer
      ? `<div style="margin-bottom:10px; padding:9px 12px; border-radius:10px; background:rgba(40,120,75,0.32); border:2px solid #6ef2b1; font-size:0.88rem; color:#d8ffeb;">
           ✅ <strong>OYUN MÜHÜRLENDİ:</strong> Koltuk #${chosenPlayer.seat} (${escapeHtml(chosenPlayer.nick)}) seçildi! Süre dolana kadar tartışmaya devam edebilir veya oyunu değiştirebilirsin.
         </div>`
      : `<div style="margin-bottom:10px; padding:10px 14px; border-radius:10px; background:rgba(178,22,30,0.34); border:2px solid #ff5768; font-size:0.88rem; color:#ffe5e8; font-weight:bold; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
           <span>🗣️ Tartış, <strong>👉 Suçla</strong> ve gizli zarfını mühürlemek için <strong>"🔥 BU KİŞİYE OY AT"</strong> butonuna bas!</span>
           ${
             preTargetPlayer
               ? `<button class="btn btn-emerald" id="btn-vote-pretarget-fast" style="padding:6px 11px; font-size:0.76rem;">
                    🎯 Ön-Hedefin (#${preTargetPlayer.seat} ${escapeHtml(preTargetPlayer.nick)}) İçin Oy Ver!
                  </button>`
               : ""
           }
         </div>`;

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2 style="color:#ff5768; font-size:1.06rem;">🔔 YUVARLAK SOFRA & ŞÖMİNE OYLAMASI — KİM ELENSİN?</h2>
          <span style="font-size:0.74rem; color:var(--text-muted);">
            Alttan sofraya yaz, gerekçenle suçla ve oyunu mühürle! <strong>Kırmızı Alev = Hain</strong>, <strong>Beyaz Alev = Masum</strong> · 🪙 Hazine: <strong style="color:var(--gold);">${state.pot || 0}</strong>
          </span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <button class="btn" id="btn-vote-open-hb" style="padding:5px 9px; font-size:0.73rem; border-color:#ffd166; color:#ffe9a8;">
            📖 El Kitapçığı (${this.clueJournal.length})
          </button>
          ${
            canVote && (state.pot || 0) >= 50
              ? `<button class="btn" id="btn-vote-kahya-ask" style="padding:5px 9px; font-size:0.73rem;">
                   🔔 Kâhya'ya Sor (50🪙)
                 </button>`
              : ""
          }
          ${
            canVote
              ? `<button class="btn" id="btn-vote-abstain" style="padding:5px 9px; font-size:0.73rem;">
                   🏳️ Çekimser Kal
                 </button>`
              : ""
          }
        </div>
      </div>

      ${tieRunoffBanner}
      ${statusBanner}

      <div class="seat-grid">
        ${players
          .map((p: any) => {
            const isMe = p.id === myId;
            const isPicked = this.selectedVoteTargetId === p.id;
            const tieBlocked = isTieRunoff && !activeTieIds.includes(p.id);
            return `
              <div class="seat-card ${isPicked ? "active" : ""}" style="border-width:${
              isPicked || this.preTargetSeat === p.seat ? "2px" : "1px"
            }; ${tieBlocked && !isMe ? "opacity:0.65;" : ""} display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div class="seat-num">SANDALYE #${p.seat}</div>
                  <div class="seat-name">${escapeHtml(p.nick)} ${isMe ? "(Sen)" : ""}</div>
                  <div class="seat-title" style="color:${p.votedForId ? "#ffd700" : "var(--text-muted)"};">
                    ${
                      !p.connected
                        ? "⚡ Bağlantı Bekleniyor · "
                        : isMe && this.myHasSecretNecklace
                        ? "📿 Gizli Kolye Sende · "
                        : ""
                    }${p.votedForId ? "✉️ Zarfını Mühürledi" : "⏳ Tartışıyor..."}
                  </div>
                  ${this.renderSeatSuspectBadge(p.seat)}
                </div>
                <div style="display:flex; flex-direction:column; gap:5px; margin-top:8px;">
                  ${
                    canVote && !isMe
                      ? `<button class="btn ${isPicked ? "" : tieBlocked ? "" : "btn-crimson"}" data-cast-vote="${p.id}" ${
                          tieBlocked ? "disabled" : ""
                        } style="width:100%; padding:7px 8px; font-weight:bold; ${
                          isPicked ? "border-color:#6ef2b1; color:#6ef2b1;" : ""
                        }">
                          ${
                            isPicked
                              ? "✅ OYUN BU KİŞİDE"
                              : tieBlocked
                              ? "⚖️ Eşitlik Dışı"
                              : "🔥 BU KİŞİYE OY AT"
                          }
                        </button>`
                      : isMe
                      ? `<div style="font-size:0.7rem; color:var(--text-muted); text-align:center; padding:5px 0;">Kendi Koltuğun</div>`
                      : ""
                  }
                  <div style="display:flex; gap:4px;">
                    <button class="btn" data-vote-inspect="${p.id}" style="flex:1; padding:4px 5px; font-size:0.68rem;">
                      🔍 Bar
                    </button>
                    ${
                      canVote && !isMe
                        ? `<button class="btn" data-vote-accuse="${p.id}" data-seat="${p.seat}" data-nick="${escapeHtml(p.nick)}" style="flex:1; padding:4px 5px; font-size:0.68rem; border-color:rgba(255,87,104,0.5); color:#ffb3bc;">
                            👉 Suçla
                          </button>`
                        : ""
                    }
                  </div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    const castVoteFor = (targetId: string) => {
      if (!canVote || targetId === myId) return;
      if (isTieRunoff && !activeTieIds.includes(targetId)) return;
      this.selectedVoteTargetId = targetId;
      this.room?.send("vote", { targetId });
      sfx.playVoteStamp();
      this.lastCenterRenderHash = "";
    };

    document.getElementById("btn-vote-open-hb")?.addEventListener("click", () => {
      this.openHandbookModal("book");
    });

    document.getElementById("btn-vote-kahya-ask")?.addEventListener("click", () => {
      this.openKahyaAskModal();
    });

    document.getElementById("btn-vote-pretarget-fast")?.addEventListener("click", () => {
      if (preTargetPlayer) {
        castVoteFor(preTargetPlayer.id);
      }
    });

    document.getElementById("btn-vote-abstain")?.addEventListener("click", () => {
      if (!canVote) return;
      this.selectedVoteTargetId = "ABSTAIN";
      this.room?.send("vote", { targetId: "ABSTAIN" });
      sfx.playVoteStamp();
      this.lastCenterRenderHash = "";
    });

    panel.querySelectorAll("[data-cast-vote]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        castVoteFor((btn as HTMLElement).dataset.castVote!);
      });
    });

    panel.querySelectorAll("[data-vote-accuse]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const el = btn as HTMLElement;
        this.openAccuseModal(el.dataset.voteAccuse!, Number(el.dataset.seat), el.dataset.nick!);
      });
    });

    panel.querySelectorAll("[data-vote-inspect]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.room?.send("request_inspect", { targetId: (btn as HTMLElement).dataset.voteInspect! });
      });
    });
  }

  private renderFireRevealPanel(panel: HTMLElement, state: any): void {
    const flame = state.lastBurnedFlame;
    const isRed = flame === "RED";
    const isWhite = flame === "WHITE";
    const burnedMe = Boolean(state.lastBurnedId && state.lastBurnedId === this.room?.sessionId);

    const personalBanner = burnedMe
      ? `<div style="margin-bottom:8px; padding:8px 12px; border-radius:10px; background:rgba(175,20,38,0.34); border:2px solid #ff4d5e; color:#ffdbe0; font-size:0.84rem; font-weight:bold;">
           🚨 DİKKAT: SOFRADA EN ÇOK OYU SEN ALDIN VE ZARFIN ŞÖMİNEYE ATILDI! Artık 👻 Hayalet olarak şatoyu izleyebilirsin.
         </div>`
      : "";

    const tallyHtml =
      this.lastVoteReveal.length > 0
        ? `<div style="margin-top:8px; padding-top:8px; border-top:1px solid var(--gold-soft);">
             <div style="font-size:0.73rem; color:var(--gold); font-weight:bold; margin-bottom:5px;">
               🗳️ AÇILAN MÜHÜRLÜ OYLAR (KİM KİME OY VERDİ?):
             </div>
             <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:5px;">
               ${this.lastVoteReveal
                 .map(
                   (v) => `
                 <span style="background:rgba(24,18,36,0.92); border:1px solid var(--gold-soft); border-radius:8px; padding:3px 7px; font-size:0.72rem;">
                   <strong>#${v.voterSeat} ${escapeHtml(v.voterNick)}</strong> ➔ ${
                     v.targetSeat > 0
                       ? `🔥 #${v.targetSeat} ${escapeHtml(v.targetNick)}`
                       : `🏳️ Çekimser`
                   }
                 </span>
               `
                 )
                 .join("")}
             </div>
           </div>`
        : "";

    panel.innerHTML = `
      <div style="text-align:center; padding:8px 10px;">
        ${personalBanner}
        <h2 style="font-size:1.22rem; color:${isRed ? "#ff3b4e" : isWhite ? "#a8d8ff" : "#d4af37"};">
          ${
            isRed
              ? "🔥 ŞÖMİNE KAN KIRMIZISI PARLADI! (HAİN YAKALANDI)"
              : isWhite
              ? "❄️ ŞÖMİNE BEYAZ ALEVLE YANDI! (MASUM MİSAFİR ELENDİ)"
              : "⚖️ OYLAR EŞİT ÇIKTI — ŞÖMİNEYE ZARF ATILMADI"
          }
        </h2>
        <p style="margin-top:6px; font-size:0.9rem;">${escapeHtml(state.announcement || "")}</p>
        ${tallyHtml}
      </div>
    `;
  }

  private renderNightPanel(panel: HTMLElement, state: any): void {
    const isHain = this.myRole?.role === "HAIN";
    const me = state.players?.get(this.room?.sessionId);
    const alivePlayers = Array.from(state.players?.values() || []).filter((p: any) => p.alive);

    if (!isHain || !me?.alive || me?.ghost) {
      const isGhostObserver = Boolean(me && (!me.alive || me.ghost));
      panel.innerHTML = `
        <div style="text-align:center; padding:14px;">
          <div style="font-size:0.76rem; letter-spacing:1.6px; color:#ff6b7a; font-weight:bold;">
            ⏳ GECE MOLASI — GİZLİ İNFAZ KONSEYİ TOPLANIYOR
          </div>
          <h2 style="color:var(--gold); font-size:1.22rem; margin:6px 0;">
            🌑 ŞATODA GECE: HAİNLER TOPLANTI YAPIYOR!
          </h2>
          <p style="color:var(--text-muted); font-size:0.85rem; max-width:580px; margin:0 auto 12px; line-height:1.45;">
            Yatak odalarının kapıları kilitlendi. Hainler şu an gizli kulede buluşup bu gecenin <strong>İNFAZ KARARINI</strong> tartışıyor! Hainler mührü bastığında sabah çanı çalacak.
          </p>

          ${
            me?.alive && !me?.ghost
              ? `<div style="margin-bottom:10px;">
                  ${
                    this.nightWatchNote
                      ? `<div style="background:rgba(212,175,55,0.14); border:1px solid var(--gold); border-radius:10px; padding:9px 12px; font-size:0.84rem; color:var(--parchment);">
                          ${escapeHtml(this.nightWatchNote)}
                        </div>`
                      : `<button class="btn btn-crimson" id="btn-night-watch" style="padding:9px 16px;">
                          🕯️ Kapı Deliğinden Koridoru Dinle (+10🪙 & İpucu)
                        </button>`
                  }
                </div>`
              : isGhostObserver
              ? `<div style="margin-bottom:10px;">
                   <button class="btn" id="btn-night-ghost-haunt" style="padding:8px 14px; border-color:rgba(122,184,255,0.5); color:#cfe5ff;">
                     👻 Şamdanların Mumlarını Titret (Ruh İşareti Ver)
                   </button>
                 </div>`
              : ""
          }

          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            <button class="btn" id="btn-night-open-hb-guest" style="padding:7px 14px; border-color:#ffd166; color:#ffe9a8;">
              📖 El Kitapçığı & İpuçlarım (${this.clueJournal.length})
            </button>
            <button class="btn" id="btn-night-inspect-bonds" style="padding:7px 14px;">
              🔍 Oyuncuların Yakınlık Barlarını İncele
            </button>
          </div>
        </div>
      `;

      document.getElementById("btn-night-open-hb-guest")?.addEventListener("click", () => {
        this.openHandbookModal("book");
      });
      document.getElementById("btn-night-watch")?.addEventListener("click", () => {
        sfx.playDoorCreak(true);
        this.room?.send("night_watch");
      });
      document.getElementById("btn-night-ghost-haunt")?.addEventListener("click", () => {
        sfx.playNightWind();
        this.room?.send("ghost_haunt");
      });
      document.getElementById("btn-night-inspect-bonds")?.addEventListener("click", () => {
        this.openInspectPickerModal();
      });
      return;
    }

    const mateIds = new Set((this.myRole?.traitorMates || []).map((m) => m.id));
    mateIds.add(this.room?.sessionId || "");
    const innocentTargets = alivePlayers.filter((p: any) => !mateIds.has(p.id));
    const livePicksSummary = Array.from(this.traitorNightPicks.values())
      .map(
        (pk) =>
          `#${pk.traitorSeat} ${escapeHtml(pk.traitorNick)} ➔ 🩸 #${pk.targetSeat} ${escapeHtml(pk.targetNick)}`
      )
      .join(" · ");
    const pickedVictim = this.selectedNightTargetId
      ? state.players?.get(this.selectedNightTargetId)
      : null;

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2 style="color:#ff4d5e; font-size:1.06rem;">🩸 HAİN GECE İNFAZ SEÇİM EKRANI — KİM ÖLECEK?</h2>
          <span style="font-size:0.74rem; color:var(--text-muted);">
            Misafirler odalarında bekliyor. Bu gece şatodan kimi sileceğini seç ve İnfaz Mührünü bas!
          </span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <button class="btn" id="btn-night-open-hb-hain" style="padding:7px 11px; font-size:0.74rem; border-color:#ffd166; color:#ffe9a8;">
            📖 El Kitapçığı (${this.clueJournal.length})
          </button>
          <button class="btn ${this.isNightSealed ? "btn-emerald" : "btn-crimson"}" id="btn-seal-execution" style="padding:8px 14px; font-weight:bold;">
            ${
              this.isNightSealed && pickedVictim
                ? `✅ #${pickedVictim.seat} ${escapeHtml(pickedVictim.nick)} İnfaz Mührü Basıldı!`
                : pickedVictim
                ? `🩸 #${pickedVictim.seat} ${escapeHtml(pickedVictim.nick)} İNFAZINI ONAYLA!`
                : "🩸 Önce Kurban Seç"
            }
          </button>
        </div>
      </div>

      ${
        pickedVictim
          ? `<div style="margin-bottom:8px; padding:9px 12px; border-radius:10px; background:rgba(40,120,75,0.3); border:2px solid #6ef2b1; font-size:0.86rem; color:#d8ffeb;">
               ${
                 this.isNightSealed
                   ? `✅ <strong>İNFAZ MÜHRÜN BASILDI:</strong> Koltuk #${pickedVictim.seat} (${escapeHtml(pickedVictim.nick)}) onaylandı! Sabah çanı çalmak üzere...`
                   : `🎯 <strong>SEÇİLEN İNFAZ KURBANI:</strong> Koltuk #${pickedVictim.seat} (${escapeHtml(pickedVictim.nick)})! Hazırsan sağ üstteki veya karttaki <strong>🗡️ HEMEN İNFAZ ET</strong> butonuna bas!`
               }
             </div>`
          : `<div style="margin-bottom:8px; padding:10px 14px; border-radius:10px; background:rgba(178,22,30,0.36); border:2px solid #ff5768; font-size:0.88rem; color:#ffe5e8; font-weight:bold;">
               🗡️ SEN HAİNSİN! Bu gece infaz edilecek masum Misafiri aşağıdan seç ("🗡️ HEMEN İNFAZ ET" ile tek tıkta mühürleyebilirsin)!
             </div>`
      }

      ${
        livePicksSummary
          ? `<div style="margin-bottom:8px; padding:6px 10px; border-radius:8px; background:rgba(165,20,35,0.28); border:1px solid #ff5768; font-size:0.8rem; color:#ffd6da;">
              <strong>Canlı Hain Meclisi Seçimleri:</strong> ${livePicksSummary}
            </div>`
          : ""
      }

      <div class="seat-grid" style="margin-bottom:10px;">
        ${innocentTargets
          .map((p: any) => {
            const isPicked = this.selectedNightTargetId === p.id;
            return `
              <div class="seat-card ${isPicked ? "active" : ""}" style="display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div class="seat-num">KURBAN ADAYI #${p.seat}</div>
                  <div class="seat-name">${escapeHtml(p.nick)}</div>
                  <div class="seat-title">${
                    state.necklaceHolder === p.id
                      ? "⚠️ 📿 Altın Kolye (Gece Korumalı!)"
                      : isPicked
                      ? "🎯 Hedef Seçildi"
                      : "Masum Misafir"
                  }</div>
                  ${this.renderSeatSuspectBadge(p.seat)}
                </div>
                <div style="display:flex; flex-direction:column; gap:5px; margin-top:8px;">
                  <button class="btn btn-crimson" data-night-instant="${p.id}" style="width:100%; padding:7px 8px; font-weight:bold;">
                    🗡️ HEMEN İNFAZ ET!
                  </button>
                  <button class="btn ${isPicked ? "btn-emerald" : ""}" data-night-pick-only="${p.id}" style="width:100%; padding:4px 6px; font-size:0.7rem;">
                    ${isPicked ? "✅ Seçili Hedef" : "🎯 Sadece Hedef Göster"}
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <div style="background:rgba(18,10,24,0.92); border:1px solid rgba(255,87,104,0.5); border-radius:10px; padding:8px;">
        <div style="font-size:0.74rem; color:#ff6b7a; font-weight:bold; margin-bottom:4px;">
          🤫 GİZLİ HAİNLER MECLİSİ SOHBETİ (Yalnızca Hainler Görür):
        </div>
        <div id="conclave-chat-box" style="max-height:85px; overflow-y:auto; font-size:0.78rem; margin-bottom:6px; display:flex; flex-direction:column; gap:3px;">
          ${
            this.nightConclaveLogs.length === 0
              ? `<div style="color:var(--text-muted); font-style:italic;">Suç ortaklarınla kimi infaz edeceğinizi yazışın...</div>`
              : this.nightConclaveLogs.map((l) => `<div>🗡️ ${l}</div>`).join("")
          }
        </div>
        <form id="conclave-chat-form" style="display:flex; gap:6px;">
          <input type="text" id="conclave-chat-input" maxlength="120" placeholder="Hain ortaklarına gizlice yaz..." style="flex:1;" />
          <button type="submit" class="btn btn-crimson">Gönder</button>
        </form>
      </div>
    `;

    panel.querySelectorAll("[data-night-instant]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const targetId = (btn as HTMLElement).dataset.nightInstant!;
        this.selectedNightTargetId = targetId;
        this.isNightSealed = true;
        this.room?.send("night_pick", { targetId, instantSeal: true });
        sfx.playDaggerDraw();
        this.lastCenterRenderHash = "";
      });
    });

    panel.querySelectorAll("[data-night-pick-only]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const targetId = (btn as HTMLElement).dataset.nightPickOnly!;
        this.selectedNightTargetId = targetId;
        this.room?.send("night_pick", { targetId });
        sfx.playHeartbeat();
        this.lastCenterRenderHash = "";
      });
    });

    document.getElementById("btn-night-open-hb-hain")?.addEventListener("click", () => {
      this.openHandbookModal("book");
    });

    document.getElementById("btn-seal-execution")?.addEventListener("click", () => {
      if (!this.selectedNightTargetId) {
        alert("Önce yukarıdaki listeden infaz edilecek kurbanı seçmelisin!");
        return;
      }
      this.isNightSealed = true;
      this.room?.send("seal_night_execution");
      sfx.playDaggerDraw();
      this.lastCenterRenderHash = "";
    });

    document.getElementById("conclave-chat-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = document.getElementById("conclave-chat-input") as HTMLInputElement;
      const text = inp.value.trim();
      if (!text || !this.room) return;
      this.room.send("chat", { text, channel: "HAIN" });
      inp.value = "";
    });
  }

  private renderMorningPanel(panel: HTMLElement, state: any): void {
    panel.innerHTML = `
      <div style="text-align:center; padding:14px;">
        <h2 style="color:var(--gold); font-size:1.28rem;">🌅 ŞATODA SABAH OLDU — İNFAZ HÜKMÜ</h2>
        <p style="margin-top:8px; font-size:0.95rem;">${escapeHtml(state.announcement || "")}</p>
        <div style="margin-top:10px;">
          <button class="btn" id="btn-morning-open-hb" style="padding:6px 12px; font-size:0.76rem; border-color:#ffd166; color:#ffe9a8;">
            📖 El Kitapçığı & Kanıtlar (${this.clueJournal.length})
          </button>
        </div>
      </div>
    `;
    document.getElementById("btn-morning-open-hb")?.addEventListener("click", () => {
      this.openHandbookModal("book");
    });
  }

  private renderFinalPanel(panel: HTMLElement, state: any): void {
    const alive = Array.from(state.players?.values() || []).filter((p: any) => p.alive);
    const myId = this.room?.sessionId;
    const me = myId ? state.players?.get(myId) : null;
    const canDecide = Boolean(me && me.alive && !me.ghost);

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>⚖️ FİNAL GÜVEN KARARI — SON ${alive.length} KİŞİ</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            <strong>Oybirliği Kuralı:</strong> Herkes <em>"🤝 Hepimiz Misafiriz"</em> derse oyun anında biter (içeride Hain gizliyse Hainler kazanır!). Tek kişi bile <em>"🔥 Aramızda Hain Var"</em> derse son Şömine Oylamasına gidilir!
          </span>
        </div>
        <button class="btn" id="btn-final-open-hb" style="padding:6px 10px; font-size:0.74rem; border-color:#ffd166; color:#ffe9a8;">
          📖 El Kitapçığı (${this.clueJournal.length})
        </button>
      </div>

      ${
        canDecide
          ? `<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin:10px 0 12px;">
               <button class="btn ${this.selectedFinalChoice === "TRUST" ? "btn-emerald" : ""}" id="btn-final-trust" style="padding:10px 15px; font-weight:bold;">
                 ${this.selectedFinalChoice === "TRUST" ? "✅ Seçimin: HEPİMİZ MİSAFİRİZ" : "🤝 HEPİMİZ MİSAFİRİZ (Güven & Bitir)"}
               </button>
               <button class="btn ${this.selectedFinalChoice === "DOUBT" ? "btn-crimson" : ""}" id="btn-final-doubt" style="padding:10px 15px; font-weight:bold;">
                 ${this.selectedFinalChoice === "DOUBT" ? "✅ Seçimin: ARAMIZDA HAİN VAR" : "🔥 ARAMIZDA HAİN VAR (Son Oylamaya Git)"}
               </button>
             </div>`
          : `<div style="margin:8px 0 12px; padding:9px 12px; border-radius:10px; background:rgba(70,85,120,0.25); border:1px solid #7ab8ff; font-size:0.84rem; color:#cfe5ff; text-align:center;">
               👻 Hayalet olarak son ${alive.length} davetlinin kritik güven kararını izliyorsun.
             </div>`
      }

      <div class="seat-grid">
        ${alive
          .map(
            (p: any) => `
          <div class="seat-card ${p.id === myId ? "active" : ""}">
            <div class="seat-num">KALAN DAVETLİ #${p.seat}</div>
            <div class="seat-name">${escapeHtml(p.nick)} ${p.id === myId ? "(Sen)" : ""}</div>
            ${this.renderSeatSuspectBadge(p.seat)}
            <button class="btn" data-final-inspect="${p.id}" style="width:100%; margin-top:6px; padding:4px 6px; font-size:0.68rem;">
              🔍 Yakınlık Barı
            </button>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    document.getElementById("btn-final-open-hb")?.addEventListener("click", () => {
      this.openHandbookModal("book");
    });
    document.getElementById("btn-final-trust")?.addEventListener("click", () => {
      if (!canDecide) return;
      this.selectedFinalChoice = "TRUST";
      this.room?.send("final_decision", { decision: "TRUST" });
      sfx.playVoteStamp();
      this.lastCenterRenderHash = "";
    });
    document.getElementById("btn-final-doubt")?.addEventListener("click", () => {
      if (!canDecide) return;
      this.selectedFinalChoice = "DOUBT";
      this.room?.send("final_decision", { decision: "DOUBT" });
      sfx.playVoteStamp();
      this.lastCenterRenderHash = "";
    });
    panel.querySelectorAll("[data-final-inspect]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.room?.send("request_inspect", { targetId: (btn as HTMLElement).dataset.finalInspect! });
      });
    });
  }

  private renderResultPanel(panel: HTMLElement, state: any): void {
    const guestsWon = state.winnerTeam === "MISAFIR";
    const rolesList: Array<{ id?: string; seat: number; nick: string; role: string; alive: boolean }> =
      this.gameOverSummary?.roles || [];
    const chronicle: string[] = this.gameOverSummary?.chronicle || [];
    const topBond: { seatA: number; nickA: string; seatB: number; nickB: string; score: number } | null =
      this.gameOverSummary?.topMatchBond || null;
    const myId = this.room?.sessionId;
    const isHost = Boolean(myId && state.hostId === myId);
    const meState = myId ? state.players?.get(myId) : null;
    const myRoleStr = this.myRole?.role === "HAIN" ? "🗡️ HAİN" : "🕯️ MİSAFİR";
    const iWon = this.myRole?.role === state.winnerTeam;

    panel.innerHTML = `
      <div style="text-align:center; padding:10px;">
        <p style="color:var(--gold); letter-spacing:2px; font-size:0.76rem;">◆ OYUN SONA ERDİ — TÜM MASKELER DÜŞTÜ ◆</p>
        <h2 style="font-size:1.42rem; margin:6px 0; color:${guestsWon ? "#7ab8ff" : "#ff4d5e"};">
          ${guestsWon ? "🕯️ MİSAFİRLER KAZANDI!" : "🗡️ HAİNLER SOFRAYI ELE GEÇİRDİ!"}
        </h2>

        ${
          state.winReason
            ? `<div style="margin:8px auto 10px; max-width:640px; padding:9px 14px; border-radius:10px; background:rgba(212,175,55,0.14); border:1px solid var(--gold); color:var(--parchment); font-size:0.86rem; line-height:1.4;">
                 <strong style="color:var(--gold);">📌 Maçın Bitme Sebebi:</strong> ${escapeHtml(state.winReason)}
               </div>`
            : `<p style="font-size:0.88rem; margin-bottom:10px;">${escapeHtml(state.announcement || "")}</p>`
        }

        ${
          meState
            ? `<div style="font-size:0.8rem; margin-bottom:8px; color:${iWon ? "#8ce99a" : "#ffa8a8"};">
                 Senin Rolün: <strong>${myRoleStr}</strong> · Durumun: <strong>${
                meState.alive ? "Hayatta Kaldın" : "Şöminede / Gece İnfazında Elendin"
              }</strong> · Sonuç: <strong>${iWon ? "🏆 TAKIMIN KAZANDI!" : "💔 KAYBETTİN"}</strong>
               </div>`
            : ""
        }

        ${
          topBond && topBond.score >= 10
            ? `<div style="font-size:0.76rem; color:var(--gold); margin-bottom:10px;">
                 🤝 Maçın En Yüksek Fısıltı Bağı: <strong>#${topBond.seatA} ${escapeHtml(topBond.nickA)}</strong> &amp; <strong>#${topBond.seatB} ${escapeHtml(topBond.nickB)}</strong> (%${topBond.score})
               </div>`
            : ""
        }

        ${
          rolesList.length > 0
            ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:6px; text-align:left; margin-bottom:10px;">
                ${[...rolesList]
                  .sort((a, b) => a.seat - b.seat)
                  .map(
                    (r) => `
                  <div style="padding:6px 8px; border-radius:8px; background:rgba(24,18,36,0.9); border:1px solid ${
                    r.role === "HAIN" ? "#ff4d5e" : "rgba(122,184,255,0.4)"
                  }; font-size:0.75rem;">
                    <strong>#${r.seat} ${escapeHtml(r.nick)}</strong><br/>
                    <span style="color:${r.role === "HAIN" ? "#ff6b7a" : "#8ecae6"};">
                      ${r.role === "HAIN" ? "🗡️ HAİN" : "🕯️ MİSAFİR"}
                    </span>
                    · <span>${r.alive ? "Hayatta" : "💀 Elendi/İnfaz"}</span>
                  </div>
                `
                  )
                  .join("")}
              </div>`
            : ""
        }

        ${
          chronicle.length > 0
            ? `<div style="text-align:left; background:rgba(14,10,22,0.88); border:1px solid var(--gold-soft); border-radius:10px; padding:8px 10px; margin-bottom:10px; max-height:110px; overflow-y:auto; font-size:0.76rem;">
                <strong style="color:var(--gold);">📜 Şato Gece İnfazları & Şömine Kayıtları:</strong>
                ${chronicle.map((c) => `<div style="margin-top:3px;">• ${escapeHtml(c)}</div>`).join("")}
              </div>`
            : ""
        }

        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          <button class="btn" id="btn-read-story" style="border-color:var(--gold); color:var(--gold);">
            📖 Hikayeyi Oku
          </button>
          <button class="btn" id="btn-result-open-hb" style="border-color:#ffd166; color:#ffe9a8;">
            🕵️ El Kitapçığı Notlarım (${this.clueJournal.length})
          </button>
          ${
            isHost
              ? `<button class="btn btn-crimson" id="btn-back-lobby">🔄 Yeni Oyun (Odayı Lobiye Döndür)</button>`
              : ""
          }
          <button class="btn ${isHost ? "" : "btn-crimson"}" id="btn-result-leave-menu">
            🏰 Ana Menüye Dön
          </button>
        </div>
      </div>
    `;

    document.getElementById("btn-read-story")?.addEventListener("click", () => {
      this.openStoryReaderModal(state);
    });
    document.getElementById("btn-result-open-hb")?.addEventListener("click", () => {
      this.openHandbookModal("clues");
    });
    document.getElementById("btn-back-lobby")?.addEventListener("click", () => {
      this.room?.send("back_to_lobby");
    });
    document.getElementById("btn-result-leave-menu")?.addEventListener("click", async () => {
      sessionStorage.removeItem("sofra_reconnect_token");
      this.activeReconnectRoomId = "";
      if (this.room) {
        await this.room.leave(true);
        this.room = null;
      }
      document.getElementById("hud")?.classList.add("hidden");
      document.getElementById("main-menu-overlay")?.classList.remove("hidden");
      this.refreshLiveRooms();
    });
  }

  private openStoryReaderModal(state: any): void {
    sfx.playPageFlip();
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;
    card.style.width = "min(650px, 94vw)";

    const guestsWon = state.winnerTeam === "MISAFIR";
    const rolesList: Array<{ id?: string; seat: number; nick: string; role: string; alive: boolean }> =
      this.gameOverSummary?.roles || [];
    const chronicle: string[] = this.gameOverSummary?.chronicle || [];
    const topBond: { seatA: number; nickA: string; seatB: number; nickB: string; score: number } | null =
      this.gameOverSummary?.topMatchBond || null;

    const traitors = rolesList.filter((r) => r.role === "HAIN");
    const survivors = rolesList.filter((r) => r.alive);
    const fallen = rolesList.filter((r) => !r.alive);

    const traitorNames =
      traitors.length > 0
        ? traitors.map((t) => `#${t.seat} ${escapeHtml(t.nick)}`).join(" ve ")
        : "meçhul bir gölge";
    const survivorNames =
      survivors.length > 0
        ? survivors.map((s) => `#${s.seat} ${escapeHtml(s.nick)}`).join(", ")
        : "kimse";
    const fallenNames =
      fallen.length > 0
        ? fallen.map((f) => `#${f.seat} ${escapeHtml(f.nick)}`).join(", ")
        : "";

    const myId = this.room?.sessionId;
    const isHost = Boolean(myId && state.hostId === myId);
    const meState = myId ? state.players?.get(myId) : null;
    const myRoleLabel =
      this.myRole?.role === "HAIN" ? "pelerininin altında hançer gizleyen bir HAİN" : "gerçeğin peşindeki masum bir MİSAFİR";

    const bondParagraph =
      topBond && topBond.score >= 15
        ? `Koridorlarda mum ışıkları titrerken en derin fısıltı bağı <strong>#${topBond.seatA} ${escapeHtml(topBond.nickA)}</strong> ile <strong>#${topBond.seatB} ${escapeHtml(topBond.nickB)}</strong> arasında kuruldu (<em>%${topBond.score} yakınlık</em>). Bakışlar bu ikilinin üzerinde toplandı.`
        : `Fırtına pencereleri döverken davetliler koridorlarda temkinli adımlarla yürüdü; kimse sırrını kolay kolay açık etmedi.`;

    const eventsHtml =
      chronicle.length > 0
        ? chronicle
            .map(
              (item) => `
              <div style="padding:6px 9px; border-left:2px solid var(--gold); background:rgba(255,255,255,0.04); border-radius:0 6px 6px 0; font-size:0.8rem; line-height:1.45;">
                ${escapeHtml(item)}
              </div>
            `
            )
            .join("")
        : `<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">
            İlk oylamayla birlikte maskeler erkenden düştü ve şöminenin hükmü gecenin kaderini mühürledi.
          </div>`;

    const endingProse = guestsWon
      ? `Şafak sökerken şöminenin kızıl külleri soğudu. <strong>${escapeHtml(
          state.winReason || "Tüm Hainlerin maskesi düşürüldü ve şatoda hiçbir Hain kalmadı."
        )}</strong> Geride kalan davetliler (${survivorNames}) Kargalı Şato'nun ağır kapılarını aralayıp fırtınadan sağ kurtuldu.`
      : `Gece yarısı çanları son kez çaldığında şatonun şamdanları kan kırmızısına büründü. <strong>${escapeHtml(
          state.winReason || "Hainler sayıca üstünlüğü ele geçirip Yuvarlak Sofraya hâkim oldu."
        )}</strong> Kargalı Şato'nun koridorları artık gölgelerin elindeydi.`;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--gold-soft); padding-bottom:8px;">
        <div>
          <div style="font-size:0.7rem; letter-spacing:1.8px; color:var(--gold);">◆ KARGALI ŞATO VAKAYİNAMESİ ◆</div>
          <h3 style="font-size:1.08rem; color:var(--parchment); margin-top:2px;">
            📖 Bu Gecenin Hikâyesi (${escapeHtml(state.roomTitle || "Yuvarlak Sofra")} · ${state.round || 1} Gün)
          </h3>
        </div>
        <button class="btn" id="btn-close-story-x" style="padding:4px 9px;">✕</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; font-size:0.83rem; line-height:1.52; color:var(--parchment); max-height:60dvh; overflow-y:auto; padding-right:4px;">
        <div style="background:rgba(212,175,55,0.08); border:1px solid rgba(212,175,55,0.3); border-radius:10px; padding:10px 12px;">
          <strong style="color:var(--gold); display:block; margin-bottom:4px;">Ⅰ. Fırtınalı Davet & Gizli Maskeler</strong>
          Kargalı Şato'nun demir kapıları kilitlendiğinde Yuvarlak Sofranın etrafına <strong>${
            rolesList.length || state.players?.size || 10
          } davetli</strong> oturdu. Herkes kadehini dostluk şerefine kaldırsa da karanlıkta gizlice yemin eden Hainler <strong>${traitorNames}</strong> idi.${
      meState
        ? ` Sen bu gecede <strong>#${meState.seat} ${escapeHtml(meState.nick)}</strong> koltuğunda ${myRoleLabel} olarak yerini aldın.`
        : ""
    }
        </div>

        <div style="background:rgba(20,14,30,0.85); border:1px solid var(--gold-soft); border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
          <strong style="color:var(--gold);">Ⅱ. Koridorlardaki Fısıltılar & Olaylar Zinciri</strong>
          <p style="font-size:0.81rem; color:#dfd4c3;">${bondParagraph}</p>
          <div style="display:flex; flex-direction:column; gap:5px; margin-top:2px;">
            ${eventsHtml}
          </div>
        </div>

        <div style="background:${
          guestsWon ? "rgba(40,85,140,0.22)" : "rgba(150,20,36,0.24)"
        }; border:1px solid ${
      guestsWon ? "rgba(122,184,255,0.5)" : "rgba(255,77,94,0.55)"
    }; border-radius:10px; padding:10px 12px;">
          <strong style="color:${guestsWon ? "#8ecae6" : "#ff6b7a"}; display:block; margin-bottom:4px;">
            Ⅲ. Son Perde — ${guestsWon ? "Misafirlerin Kurtuluşu" : "Hainlerin Saltanatı"}
          </strong>
          <p>${endingProse}</p>
          ${
            fallenNames
              ? `<div style="margin-top:6px; font-size:0.76rem; color:var(--text-muted);">
                   🕯️ <strong>Bu Gecede Elenen / İnfaz Edilenler:</strong> ${fallenNames} · 🪙 <strong>Ortak Hazine:</strong> ${
                  state.pot || 0
                } Altın
                 </div>`
              : ""
          }
          <div style="margin-top:8px; font-style:italic; font-size:0.78rem; color:var(--gold);">
            "Kâhya #11 numaralı tahtından kalkıp son şamdanı üfledi: 'Şöminenin külü yalan söylemez; yeni bir fırtınada tekrar görüşeceğiz...'"
          </div>
        </div>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; padding-top:4px;">
        <button class="btn" id="btn-close-story-modal">🔙 Sonuca Dön</button>
        ${
          isHost
            ? `<button class="btn btn-crimson" id="btn-story-back-lobby">🔄 Yeni Oyun (Lobi)</button>`
            : ""
        }
      </div>
    `;

    modal.classList.remove("hidden");

    const closeStory = () => {
      card.style.width = "";
      modal.classList.add("hidden");
    };

    document.getElementById("btn-close-story-x")?.addEventListener("click", closeStory);
    document.getElementById("btn-close-story-modal")?.addEventListener("click", closeStory);
    document.getElementById("btn-story-back-lobby")?.addEventListener("click", () => {
      closeStory();
      this.room?.send("back_to_lobby");
    });
  }

  // ==========================================================================
  // HAREKET, LO-L STAMINA HALKASI VE ANA ANİMASYON DÖNGÜSÜ
  // ==========================================================================
  private getOpenDoorsMap(state: any): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    state.doors?.forEach((d: any, id: string) => {
      out[id] = Boolean(d.open);
    });
    return out;
  }

  private getLockedDoorsMap(state: any): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    state.doors?.forEach((d: any, id: string) => {
      out[id] = Boolean(d.locked);
    });
    return out;
  }

  private updateLocalDayMovement(dt: number, state: any): void {
    let turnDir = this.camTurnDir;
    if (this.keys.has("arrowleft") || this.keys.has("q")) turnDir += 1;
    if (this.keys.has("arrowright")) turnDir -= 1;
    if (turnDir !== 0) {
      this.scene.cameraYaw += Math.max(-1, Math.min(1, turnDir)) * 2.1 * dt;
    }

    if (!this.room || state.phase !== "DAY") return;

    let forward = 0;
    let strafe = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) forward += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) forward -= 1;
    if (this.keys.has("a")) strafe -= 1;
    if (this.keys.has("d")) strafe += 1;

    if (Math.abs(this.joyY) > 0.1 || Math.abs(this.joyX) > 0.1) {
      forward = -this.joyY;
      strafe = this.joyX;
    }

    const now = performance.now();
    const wantsSprint =
      (this.keys.has("shift") || this.mobileSprintHeld) && now > this.staminaExhaustedUntil;
    // Wild Rift Koşturma Butonuna basılı tutarken yön seçilmemişse doğrudan kameranın baktığı yöne depar atar!
    if (this.mobileSprintHeld && Math.hypot(forward, strafe) < 0.1) {
      forward = 1;
    }

    const isMoving = Math.hypot(forward, strafe) > 0.05;

    let speed: number = SOFRA_CONFIG.WALK_SPEED;
    if (isMoving && wantsSprint && this.stamina > 0) {
      speed = SOFRA_CONFIG.RUN_SPEED;
      this.stamina = Math.max(0, this.stamina - (100 / SOFRA_CONFIG.STAMINA_MAX_SEC) * dt);
      if (this.stamina <= 0) {
        this.staminaExhaustedUntil = now + 2000;
      }
    } else {
      this.stamina = Math.min(100, this.stamina + (100 / SOFRA_CONFIG.STAMINA_RECOVER_SEC) * dt);
    }

    // SVG Stamina Halkası Güncellemesi (Çevre = 283)
    const ringCircle = document.getElementById("stamina-ring-circle");
    if (ringCircle) {
      const offset = 283 - (283 * this.stamina) / 100;
      ringCircle.setAttribute("stroke-dashoffset", String(offset));
      ringCircle.setAttribute(
        "stroke",
        now < this.staminaExhaustedUntil ? "#ff3b4e" : "#ffd700"
      );
    }

    if (!isMoving) return;

    const len = Math.hypot(forward, strafe);
    const nf = forward / len;
    const ns = strafe / len;

    const sin = Math.sin(this.scene.cameraYaw);
    const cos = Math.cos(this.scene.cameraYaw);
    const vx = (-sin * nf + cos * ns) * speed;
    const vz = (-cos * nf - sin * ns) * speed;

    const desiredX = this.localX + vx * dt;
    const desiredZ = this.localZ + vz * dt;

    const me = state.players?.get(this.room.sessionId);
    const resolved = me?.ghost
      ? {
          x: Math.max(-25.2, Math.min(25.2, desiredX)),
          z: Math.max(-31, Math.min(33, desiredZ))
        }
      : resolveCastleStep(this.localX, this.localZ, desiredX, desiredZ, this.getOpenDoorsMap(state), 0.42, {
          seat: me?.seat,
          currentRoomId: me?.roomId || detectRoomZone(this.localX, this.localZ).id,
          lockedDoors: this.getLockedDoorsMap(state),
          hasKahyaKey: Boolean(me?.hasKahyaKey)
        });

    this.localX = resolved.x;
    this.localZ = resolved.z;
    this.localRotY = Math.atan2(vx, vz);

    if (!me?.ghost) {
      sfx.playFootstep(speed > SOFRA_CONFIG.WALK_SPEED);
    }

    this.netSyncAccum += dt;
    if (this.netSyncAccum >= 0.05) {
      this.netSyncAccum = 0;
      this.room.send("move", {
        x: this.localX,
        z: this.localZ,
        rotY: this.localRotY,
        anim: speed > SOFRA_CONFIG.WALK_SPEED ? "run" : "walk"
      });
    }
  }

  private animate(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    this.frameCount += 1;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.5) {
      const fps = Math.round(this.frameCount / this.fpsAccum);
      const fpsEl = document.getElementById("fps-label");
      if (fpsEl) fpsEl.textContent = `${fps} FPS`;
      this.frameCount = 0;
      this.fpsAccum = 0;
    }

    let activeZoomDir = this.camZoomDir;
    if (this.keys.has("__zoom_in__")) activeZoomDir = -1;
    else if (this.keys.has("__zoom_out__")) activeZoomDir = 1;
    if (activeZoomDir !== 0 && (this.room || this.previewSelfOnMenu)) {
      this.scene.adjustCameraZoom(activeZoomDir * 7.6 * dt);
      this.syncCameraZoomUI();
    }

    const state: any = this.room?.state;
    if (state && this.room) {
      this.scene.setActivePhase(state.phase);
      if (state.round !== this.lastRoundNumber) {
        this.lastRoundNumber = state.round || 1;
        this.usedStationIdsThisRound.clear();
      }

      const me = state.players?.get(this.room.sessionId);

      if (state.phase !== this.lastPhase) {
        const prevPhase = this.lastPhase;
        this.readyStatusText = "";
        this.isLocalReadyForPhase = false;
        this.lastCountdownSec = -1;
        this.announcementChangedAt = now;
        this.closeCharacterContextMenu();
        document.body.classList.toggle("in-fire-mode", state.phase === "FIRE");

        if (state.phase === "DAY") {
          this.dayPhaseEnteredAt = now;
          this.tieCandidateIds = null;
          this.myHasSecretNecklace = false;
          this.activeTrialSecretResult = null;
          const pill = document.getElementById("my-role-pill");
          if (pill && this.myRole) {
            pill.textContent = this.myRole.role === "HAIN" ? "🗡️ HAİN" : "🕯️ MİSAFİR";
          }
          sfx.playMorningHorn();
          document.getElementById("pc-mouse-hint")?.classList.remove("hint-faded");
        }
        const readyBtn = document.getElementById("btn-ready-phase");
        if (readyBtn) readyBtn.textContent = "⏩ Hazırım";
        const pCard = document.getElementById("puzzle-card-content");
        if (pCard) pCard.style.width = "";
        document.getElementById("puzzle-modal")?.classList.add("hidden");
        document.getElementById("dm-picker-modal")?.classList.add("hidden");

        // Evre her değiştiğinde açık kalan 360° İncele kartını kapat ki Oylama / Gece İnfazı seçim ekranı ASLA gizli kalmasın!
        if (this.scene.inspectTargetId) {
          this.inspectedFromHandbook = false;
          this.closeInspectOverlay();
        }

        // Oyun Zamanı, Oylama, Gece İnfazı ve Final seçim ekranlarına girerken soldaki PM pencerelerini küçült ki yarış/seçim ekranı tam odakta açılsın!
        if (state.phase === "TRIAL" || state.phase === "VOTE" || state.phase === "NIGHT" || state.phase === "FINAL") {
          this.pmThreads.forEach((t) => {
            t.minimized = true;
          });
          this.renderPMWindows();
        }

        if (state.phase === "ARRIVAL" || state.phase === "RESULT") {
          this.closeHandbookModal();
        }

        if (state.phase === "TRIAL") {
          this.activeTrialSecretResult = null;
          sfx.playCastleBell();
          sfx.playRuneChime();
          this.room.send("request_my_state");
        } else if (state.phase === "TABLE") {
          sfx.playCastleBell();
          this.selectedVoteTargetId = "";
          this.lastVoteReveal = [];
          this.tieCandidateIds = null;
        } else if (state.phase === "VOTE") {
          this.selectedVoteTargetId = "";
          if (prevPhase !== "VOTE") {
            this.tieCandidateIds = null;
          }
          sfx.playCastleBell();
          sfx.playTensionDrum();
        } else if (state.phase === "FIRE") {
          this.tieCandidateIds = null;
          const burnedP = state.lastBurnedId ? state.players?.get(state.lastBurnedId) : null;
          if (state.lastBurnedFlame === "RED") {
            this.scene.triggerFireplaceFlame("red");
            sfx.playFireWhoosh(true);
            if (burnedP) {
              this.confirmedSeatFlames[burnedP.seat] = "RED";
              this.addClueEntry({
                category: "fire",
                icon: "🔥",
                source: "Şömine Hükmü (Kırmızı Alev)",
                text: escapeHtml(
                  `Koltuk #${burnedP.seat} (${burnedP.nick}) şöminede yandı: KIRMIZI ALEV = HAİN YAKALANDI!`
                ),
                dedupeKey: `fire_${state.round}_${burnedP.seat}`
              });
            }
          } else if (state.lastBurnedFlame === "WHITE") {
            this.scene.triggerFireplaceFlame("white");
            sfx.playFireWhoosh(false);
            if (burnedP) {
              this.confirmedSeatFlames[burnedP.seat] = "WHITE";
              this.addClueEntry({
                category: "fire",
                icon: "❄️",
                source: "Şömine Hükmü (Beyaz Alev)",
                text: escapeHtml(
                  `Koltuk #${burnedP.seat} (${burnedP.nick}) şöminede yandı: BEYAZ ALEV = MASUM MİSAFİR ELENDİ!`
                ),
                dedupeKey: `fire_${state.round}_${burnedP.seat}`
              });
            }
          } else {
            this.addClueEntry({
              category: "fire",
              icon: "⚖️",
              source: "Şömine Hükmü (Beraberlik)",
              text: "Oylar eşit çıktı, bu akşam şömineye hiçbir zarf atılmadı.",
              dedupeKey: `fire_${state.round}_tie`,
              silent: true
            });
          }
        } else if (state.phase === "NIGHT") {
          this.isNightSealed = false;
          this.selectedNightTargetId = "";
          this.traitorNightPicks.clear();
          this.nightConclaveLogs = [];
          this.nightWatchNote = "";
          if (this.myRole?.role === "HAIN" && me?.alive && !me?.ghost && this.preTargetSeat > 0) {
            const mateIds = new Set((this.myRole?.traitorMates || []).map((m) => m.id));
            mateIds.add(this.room.sessionId);
            state.players?.forEach((cand: any, cid: string) => {
              if (cand.seat === this.preTargetSeat && cand.alive && !mateIds.has(cid)) {
                this.selectedNightTargetId = cid;
                this.room?.send("night_pick", { targetId: cid });
              }
            });
          }
          this.room.send("request_my_state");
          sfx.playNightWind();
          sfx.playHeartbeat();
        } else if (state.phase === "FINAL") {
          this.selectedFinalChoice = null;
          sfx.playTensionDrum();
        } else if (state.phase === "LOBBY") {
          this.myRole = null;
          this.myHasSecretNecklace = false;
          this.activeTrialSecretResult = null;
          document.getElementById("my-role-pill")?.classList.add("hidden");
          this.selectedVoteTargetId = "";
          this.selectedNightTargetId = "";
          this.selectedFinalChoice = null;
          this.tieCandidateIds = null;
          this.isNightSealed = false;
          this.activeTrial = null;
          this.myQuests = [];
          this.lastVoteReveal = [];
          this.traitorNightPicks.clear();
          this.nightConclaveLogs = [];
          this.nightWatchNote = "";
          this.usedStationIdsThisRound.clear();
          this.gameOverSummary = null;
          this.resetHandbookForNewMatch();
        }
        if (state.phase !== "DAY") {
          this.chatPanelOverridePhase = "";
        }
        this.lastPhase = state.phase;
        this.lastCenterRenderHash = "";
      }

      if (
        state.councilBoardNote &&
        state.councilBoardNote !== this.lastRecordedBoardNote &&
        state.phase !== "LOBBY" &&
        !String(state.councilBoardNote).startsWith("Henüz Konsey")
      ) {
        this.lastRecordedBoardNote = state.councilBoardNote;
        this.addClueEntry({
          category: "clue",
          icon: "📋",
          source: "Konsey Şüphe Tahtası",
          text: escapeHtml(state.councilBoardNote),
          dedupeKey: `board_${state.councilBoardNote}`
        });
      }

      const isDay = state.phase === "DAY";
      const wasInDayClass = document.body.classList.contains("in-day-mode");
      document.body.classList.toggle("in-day-mode", isDay);
      document.getElementById("day-action-hud")?.classList.toggle("day-active", isDay);
      if (wasInDayClass !== isDay) {
        this.syncChatDimensions(false);
      } else if (this.chatUserLogHeight !== null || this.chatUserBoxWidth !== null) {
        this.syncChatDimensions(false);
      }
      if (isDay) {
        this.renderDayExtraActions(state);
      }

      const canEarlyReady =
        state.phase === "ARRIVAL" ||
        ((state.phase === "DAY" || state.phase === "TABLE") &&
          Boolean(me && me.alive && !me.ghost));
      const readyBtnEl = document.getElementById("btn-ready-phase");
      if (readyBtnEl) {
        readyBtnEl.classList.toggle("hidden", !canEarlyReady);
        if (canEarlyReady) {
          const compactReady = window.innerWidth <= 880;
          const baseLbl = this.isLocalReadyForPhase
            ? compactReady
              ? "✅ Hazır"
              : "✅ Hazırım"
            : compactReady
            ? "⏩ Hazır"
            : "⏩ Hazırım";
          const nextReadyTxt = this.readyStatusText ? `${baseLbl} ${this.readyStatusText}` : baseLbl;
          if (readyBtnEl.textContent !== nextReadyTxt) {
            readyBtnEl.textContent = nextReadyTxt;
          }
        }
      }

      const titleEl = document.getElementById("room-title-label");
      if (titleEl) titleEl.textContent = state.roomTitle || "SOFRA";
      const codeEl = document.getElementById("room-code-label");
      if (codeEl) {
        const pBadge = resolveDurationPreset(state.paceMode, state.fastMode).badge;
        codeEl.textContent = `Kod: ${state.code || "---"} · ${pBadge}`;
      }

      const aliveCount = Array.from(state.players?.values() || []).filter((p: any) => p.alive).length;
      const isTieVote = state.phase === "VOTE" && this.getActiveTieCandidateIds(state).length > 0;
      const isCompactHud = window.innerWidth <= 940;

      const phaseTitleEl = document.getElementById("phase-title");
      if (phaseTitleEl) {
        const phaseMap: Record<string, string> = isCompactHud
          ? {
              LOBBY: "LOBİ",
              ARRIVAL: "GİZLİ ZARF",
              DAY: `GÜN ${state.round} · KEŞİF`,
              TRIAL: `GÜN ${state.round} · OYUN ZAMANI`,
              TABLE: `GÜN ${state.round} · SOFRA`,
              VOTE: isTieVote ? `GÜN ${state.round} · EŞİTLİK` : `GÜN ${state.round} · SOFRA & OY`,
              FIRE: `GÜN ${state.round} · ŞÖMİNE`,
              NIGHT: `GECE ${state.round} · KONSEY`,
              MORNING: `SABAH ${state.round + 1}`,
              FINAL: `SON ${aliveCount || 4} · FİNAL`,
              RESULT: "OYUN SONUCU"
            }
          : {
              LOBBY: "LOBİ — KARAKTER & SÜRE",
              ARRIVAL: "GİRİŞ — GİZLİ ZARFLAR",
              DAY: `GÜN ${state.round} — ŞATO KEŞFİ`,
              TRIAL: `GÜN ${state.round} — 🔔 EVET, OYUN ZAMANI! (1 DK)`,
              TABLE: `GÜN ${state.round} — SOFRA TARTIŞMASI`,
              VOTE: isTieVote
                ? `GÜN ${state.round} — ⚖️ EŞİTLİK OYLAMASI`
                : `GÜN ${state.round} — SOFRA & ŞÖMİNE OYLAMASI`,
              FIRE: `GÜN ${state.round} — ŞÖMİNE ALEVİ`,
              NIGHT: `GECE ${state.round} — HAİNLER TOPLANTISI`,
              MORNING: `SABAH ${state.round + 1} — İNFAZ HÜKMÜ`,
              FINAL: `SON ${aliveCount || 4} KİŞİ — GÜVEN KARARI`,
              RESULT: "OYUN SONUCU"
            };
        const targetPhaseTitle = phaseMap[state.phase] || state.phase;
        if (phaseTitleEl.textContent !== targetPhaseTitle) {
          phaseTitleEl.textContent = targetPhaseTitle;
        }
      }

      const compassEl = document.getElementById("phase-guide-compass");
      if (compassEl) {
        const isHain = this.myRole?.role === "HAIN";
        let compassText = "";
        switch (state.phase) {
          case "LOBBY":
            compassText = "🧭 Koltuğunu ve zırhını seç; kurucu başlattığında şato kapıları açılır.";
            break;
          case "ARRIVAL":
            compassText = "🧭 Gizli rol zarfını incele ve şato keşfine başlamak için Hazırım'a bas.";
            break;
          case "DAY":
            compassText =
              "🧭 Odaları gez, ipucu topla ve fısıldaş; keşif bitince 1 dakikalık 🔔 Oyun Zamanı başlayacak!";
            break;
          case "TRIAL":
            compassText =
              "🧭 Her şey 1 dakikalığına durdu! İlk bitiren (veya ilk doğru yapan) kimsenin haberi olmadan 📿 Gizli Kolyeyi alır!";
            break;
          case "VOTE":
            compassText = isTieVote
              ? "🧭 Oylar eşit çıktı! Eşit kalan adaylardan birine ikinci tur oyunu mühürle."
              : "🧭 Yuvarlak Sofrada kanıtları tartış, 👉 Suçla ve gizli zarf oyunu mühürle!";
            break;
          case "FIRE":
            compassText = "🧭 Şömine alevini izle: 🔥 Kırmızı Alev = Hain, ❄️ Beyaz Alev = Masum!";
            break;
          case "NIGHT":
            compassText =
              isHain && me?.alive && !me?.ghost
                ? "🧭 Suç ortaklarınla infaz edilecek kurbanı seç ve mührünü bas!"
                : me?.alive && !me?.ghost
                ? "🧭 Kapı deliğinden koridoru dinleyerek ipucu yakala ve sabahı bekle."
                : "🧭 Hayalet olarak gece konseyini izle veya mumları titret.";
            break;
          case "MORNING":
            compassText = "🧭 Gece infazının sonucunu oku; birazdan yeni gün başlayacak.";
            break;
          case "FINAL":
            compassText =
              "🧭 Oybirliğiyle güvenip bitirecek misiniz, yoksa son oylamaya mı gideceksiniz?";
            break;
          case "RESULT":
            compassText = "🧭 Tüm maskeler düştü! Vakayinameyi oku veya yeni oyuna geç.";
            break;
          default:
            compassText = "🧭 İpuçlarını 📖 Kitapçıkta takip et ve şüphelileri damgala.";
        }
        if (compassEl.textContent !== compassText) {
          compassEl.textContent = compassText;
        }
      }

      const chatInput = document.getElementById("chat-input") as HTMLInputElement | null;
      if (chatInput) {
        const isGhost = Boolean(me && (!me.alive || me.ghost));
        const isHainAlive = this.myRole?.role === "HAIN" && !isGhost;
        if (state.phase === "NIGHT" && !isHainAlive && !isGhost) {
          chatInput.disabled = true;
          chatInput.placeholder = "🕯️ Gece sessizliği — sabah çanını bekle...";
        } else {
          chatInput.disabled = false;
          if (isGhost) {
            chatInput.placeholder = "👻 Ruhlar kanalına yaz (Enter)...";
          } else if (state.phase === "NIGHT" && isHainAlive) {
            chatInput.placeholder = "🗡️ Gizli Hain ortaklarına yaz (Enter)...";
          } else if (state.phase === "DAY") {
            chatInput.placeholder = "💬 Yakındakilere konuş (Enter)...";
          } else if (state.phase === "VOTE" || state.phase === "TABLE" || state.phase === "FINAL") {
            chatInput.placeholder = "🗣️ Yuvarlak Sofraya konuş (Enter)...";
          } else {
            chatInput.placeholder = "Mesaj yaz (Enter)...";
          }
        }
      }

      const remSec = Math.max(0, Math.ceil(((state.phaseEndsAt || 0) - Date.now()) / 1000));
      const timedCountdownPhase =
        state.phase === "DAY" ||
        state.phase === "TRIAL" ||
        state.phase === "TABLE" ||
        state.phase === "VOTE" ||
        state.phase === "NIGHT" ||
        state.phase === "FINAL";
      if (timedCountdownPhase && remSec !== this.lastCountdownSec) {
        this.lastCountdownSec = remSec;
        if (remSec >= 1 && remSec <= 10) {
          sfx.playCountdownTick(remSec);
        } else if (state.phase === "DAY" && remSec === 15) {
          sfx.playEveningWarningBell();
        }
      }

      const timerEl = document.getElementById("phase-timer");
      if (timerEl) {
        const tText =
          state.phase === "LOBBY" && (!state.autoStart || remSec <= 0)
            ? "Hazır"
            : `⏳ ${remSec} sn`;
        timerEl.textContent = tText;
        const isUrgent = timedCountdownPhase && remSec >= 1 && remSec <= 10;
        timerEl.style.color = isUrgent ? (remSec <= 3 ? "#ff4d5e" : "#ffd166") : "";
        timerEl.style.transform = isUrgent && remSec % 2 === 1 ? "scale(1.08)" : "";
        if (this.handbookOpen) {
          const hbTimer = document.getElementById("handbook-live-timer");
          if (hbTimer) hbTimer.textContent = tText;
        }
      }

      const annEl = document.getElementById("announcement-box");
      if (annEl) {
        if (state.announcement && state.announcement !== this.lastAnnouncementText) {
          this.lastAnnouncementText = state.announcement;
          this.announcementChangedAt = now;
          annEl.textContent = `"${state.announcement}"`;
        }
        const autoHideAnn = isDay && now - this.announcementChangedAt > 5200;
        annEl.classList.toggle("ann-auto-hidden", autoHideAnn);
      }

      if (isDay) {
        document
          .getElementById("pc-mouse-hint")
          ?.classList.toggle("hint-faded", now - this.dayPhaseEnteredAt > 7500);
      }

      this.updateLocalDayMovement(dt, state);

      const zone = detectRoomZone(this.localX, this.localZ);
      const zoneEl = document.getElementById("zone-label");
      if (zoneEl) {
        const myRoomTag =
          zone.ownerSeat && me?.seat === zone.ownerSeat ? " (Senin Odan 🗝️)" : zone.isPrivateBedroom ? " (Özel)" : "";
        zoneEl.textContent = `📍 ${zone.name}${myRoomTag}`;
      }

      const nearDoor = DOORS.some(
        (d) => Math.hypot(this.localX - d.x, this.localZ - d.z) < SOFRA_CONFIG.DOOR_INTERACT_DIST
      );
      document.getElementById("btn-wheel-door")?.classList.toggle("ready-glow", nearDoor && isDay);

      this.scene.setAtmosphereTheme(state.atmosphereTheme || "torch");

      // Bağlamsal Sağ Üst Çark Uydusu: Kürsü / Konsey Tahtası / Orta Çağ İstasyonu yakınına gelince parlar!
      const nearAltar =
        isDay && PUZZLE_ALTARS.some((a) => Math.hypot(this.localX - a.x, this.localZ - a.z) <= 4.3);
      const nearBoard =
        isDay &&
        Math.hypot(this.localX - COUNCIL_BOARD_POS.x, this.localZ - COUNCIL_BOARD_POS.z) <= 4.5;
      const nearStation = isDay ? this.getActiveMedievalStation() : undefined;
      const ctxIcon = document.getElementById("wheel-context-icon");
      const ctxLabel = document.getElementById("wheel-context-label");
      if (ctxIcon && ctxLabel) {
        if (nearAltar) {
          ctxIcon.textContent = "🧩";
          ctxLabel.textContent = "KÜRSÜ";
        } else if (nearBoard) {
          ctxIcon.textContent = "📋";
          ctxLabel.textContent = "TAHTA";
        } else if (nearStation) {
          ctxIcon.textContent = nearStation.icon;
          ctxLabel.textContent = nearStation.shortLabel;
        } else {
          ctxIcon.textContent = "💡";
          ctxLabel.textContent = "IŞIK";
        }
      }
      document
        .getElementById("btn-wheel-light")
        ?.classList.toggle("ready-glow", Boolean(nearAltar || nearBoard || nearStation));

      this.scene.syncDoorStates(this.getOpenDoorsMap(state));

      const charList: CharacterVisualState[] = [];
      state.players?.forEach((p: any, sid: string) => {
        const isLocal = sid === this.room?.sessionId;
        charList.push({
          sessionId: sid,
          name: p.nick,
          seat: p.seat,
          x: isLocal && isDay ? this.localX : p.x,
          y: 0,
          z: isLocal && isDay ? this.localZ : p.z,
          rotY: isLocal && isDay ? this.localRotY : p.rotY,
          alive: p.alive,
          isGhost: p.ghost,
          hasGoldNecklace: isLocal && this.myHasSecretNecklace,
          coatColor: p.coatColor,
          accentColor: p.accentColor,
          hat: p.hat,
          mask: p.mask,
          isLocal
        });
      });

      this.scene.syncCharacters(charList, dt);
      this.scene.updateCamera(this.localX, this.localZ, dt);
      this.renderCenterPanel(state);
    } else {
      this.scene.setActivePhase("LOBBY");
      // Kayıt / Ana Menüde "🔍 Karakterimi 360° İncele" açıkken önizleme karakterini Antre halısında çiz!
      if (this.previewSelfOnMenu) {
        const charDef = CHARACTERS.find((c) => c.seat === this.vault.selectedSeat) ?? CHARACTERS[0];
        this.scene.syncCharacters(
          [
            {
              sessionId: "__preview_self__",
              name: this.vault.customName || charDef.name,
              seat: charDef.seat,
              x: 0,
              y: 0,
              z: 15.2,
              rotY: 0,
              alive: true,
              isGhost: false,
              hasGoldNecklace: false,
              coatColor: this.vault.coatColor,
              accentColor: this.vault.accentColor,
              hat: this.vault.hat,
              mask: this.vault.mask,
              isLocal: true
            }
          ],
          dt
        );
        this.scene.updateCamera(0, 15.2, dt);
      } else {
        this.menuOrbitAngle += dt * 0.18;
        this.scene.cameraYaw = this.menuOrbitAngle;
        this.scene.cameraPitch = 0.42;
        this.scene.updateCamera(0, 0, dt);
      }
    }

    this.scene.render(dt, now / 1000);
    requestAnimationFrame((t) => this.animate(t));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new SofraGameApp();
});
