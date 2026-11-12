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
  resolveDurationPreset
} from "@sofra/shared";
import { CastleScene, CharacterVisualState } from "./castleScene";
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

  // Menu idle rotation, PC zero-click mouse edge pan, auto-declutter timers & FPS
  private pcEdgePanDir = 0;
  private menuOrbitAngle = 0;
  private lastAnnouncementText = "";
  private announcementChangedAt = 0;
  private dayPhaseEnteredAt = 0;
  private frameCount = 0;
  private fpsAccum = 0;
  private lastFrameTime = performance.now();

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

  private setupMobileOrientationGate(): void {
    const syncOrientationState = () => {
      const isTouchMobile =
        window.matchMedia("(pointer: coarse)").matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

      const isLandscape = window.innerWidth >= window.innerHeight;

      if (!isTouchMobile) {
        document.body.classList.remove("force-rotate-gate");
        document.body.classList.add("is-landscape");
        return;
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
      }
    };

    syncOrientationState();
    window.addEventListener("resize", syncOrientationState);
    window.addEventListener("orientationchange", () => {
      syncOrientationState();
      for (const ms of [90, 220, 450]) {
        window.setTimeout(syncOrientationState, ms);
      }
    });
    screen.orientation?.addEventListener?.("change", () => {
      syncOrientationState();
      for (const ms of [90, 220, 450]) {
        window.setTimeout(syncOrientationState, ms);
      }
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
  private openCinematicEnvelope(bonusMessage?: string): void {
    const modal = document.getElementById("welcome-modal")!;
    const closedView = document.getElementById("envelope-closed-view")!;
    const openView = document.getElementById("envelope-open-view")!;
    const box3d = document.getElementById("env-3d-box")!;
    const bonusEl = document.getElementById("welcome-bonus-text");

    if (bonusEl && bonusMessage) {
      bonusEl.textContent = bonusMessage;
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
            `👑 @${p.username} Kayıt Hediyesi: Kişisel Kasanıza +150 Altın Eklendi!`
          );
        }
        this.checkActiveServerSession();
      } catch {
        feedbackEl.textContent = "Sunucuya ulaşılamadı.";
      }
    });

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
        banner.classList.remove("hidden");
        textEl.textContent = `${data.session.roomTitle} (${data.session.code}) — Durum: ${data.session.phase}`;
        btn.onclick = () => {
          this.joinRoomFlow("byId", { roomId: data.session.roomId });
        };
      } else {
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
          return `
        <div class="room-row">
          <div>
            <div style="font-weight:bold; font-size:0.86rem; color:var(--gold); display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <span>${r.hasPassword ? "🔒" : "🔓"} ${r.roomTitle}</span>
              <span style="font-size:0.69rem; padding:1px 6px; border-radius:99px; background:rgba(226,189,83,0.16); border:1px solid var(--gold-soft); color:#ffe6a1;">${preset.badge}</span>
              <span style="font-size:0.72rem; color:var(--text-muted);">(${r.code})</span>
            </div>
            <div style="font-size:0.72rem; color:var(--text-muted);">
              Kurucu: ${r.hostNick} · Kadro: ${r.playerCount}/${cap} · ${
            r.phase === "LOBBY" ? "🟢 Lobide" : "🔥 Oyunda"
          }
            </div>
          </div>
          <button
            class="btn ${r.phase === "LOBBY" ? "btn-crimson" : ""}"
            data-join-id="${r.roomId}"
            data-has-pass="${r.hasPassword ? "1" : "0"}"
          >
            ${r.phase === "LOBBY" ? "Katıl" : "İzle/Dön"}
          </button>
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
    this.myQuests = [];
    this.activeTrial = null;
    this.traitorNightPicks.clear();
    this.nightConclaveLogs = [];
    this.nightWatchNote = "";
    this.gameOverSummary = null;
    this.lastVoteReveal = [];
    this.lastDayExtraKey = "";
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
    this.lastCenterRenderHash = "";

    room.onMessage("role_envelope", (payload: SecretRolePayload) => {
      this.myRole = payload;
      sfx.playSealBreak();
      const pill = document.getElementById("my-role-pill")!;
      pill.classList.remove("hidden", "role-hain", "role-misafir");
      if (payload.role === "HAIN") {
        pill.classList.add("role-hain");
        pill.textContent = "🗡️ HAİN";
      } else {
        pill.classList.add("role-misafir");
        pill.textContent = "🕯️ MİSAFİR";
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
        this.appendChatMessage(msg.senderId, msg.senderNick, msg.channel, msg.text);
        if (msg.channel === "HAİN MECLİSİ") {
          this.nightConclaveLogs.push(`${msg.senderNick}: ${msg.text}`);
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
          sfx.playSealBreak();
          if (thread.minimized) thread.unread = true;
        }
        this.renderPMWindows();
      }
    );

    room.onMessage("pm_error", (err: { text: string }) => {
      this.appendChatMessage("", "UYARI", "FISILTI", err.text);
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

    room.onMessage("door_sfx", (data: { doorId: string; open: boolean }) => {
      sfx.playDoorCreak(data.open);
    });

    // 🔍 KARAKTER İNCELE & ARKADAŞLIK / FISILTI YAKINLIK BARI SONUCU
    room.onMessage("inspect_result", (data: any) => {
      this.renderInspectOverlay(data);
      if (data?.topBonds?.length > 0 && data.topBonds[0].score >= 25) {
        const top = data.topBonds[0];
        const rnd = (this.room?.state as any)?.round || 1;
        this.addClueEntry({
          category: "clue",
          icon: "🔍",
          source: `Yakınlık Raporu (#${data.seat} ${escapeHtml(String(data.nick || ""))})`,
          text: escapeHtml(
            `En güçlü fısıltı bağı: #${top.seat} ${top.nick} ile %${top.score} (${top.tier}) · Konum: ${data.roomName}`
          ),
          dedupeKey: `insp_${rnd}_${data.seat}_${top.seat}`,
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
        this.renderDayPuzzleModal(ch);
      }
    );

    room.onMessage("puzzle_feedback", (fb: { ok: boolean; bonusGold?: number; text: string }) => {
      if (fb.bonusGold) {
        this.vault.gold += fb.bonusGold;
        this.saveVault(false);
        sfx.playGoldChime();
      }
      if (fb.ok && fb.text) {
        const rnd = (this.room?.state as any)?.round || 1;
        this.addClueEntry({
          category: "clue",
          icon: "🔮",
          source: "Şato Keşif & Kürsü İpucu",
          text: escapeHtml(fb.text),
          dedupeKey: `puz_${rnd}_${fb.text}`
        });
      }
      this.showPuzzleFeedbackModal(fb.text, fb.ok);
    });

    // 🧩 1 DAKİKALIK ORTAK ŞATO BULMACA SINAVI (TRIAL)
    room.onMessage("trial_challenge", (ch: any) => {
      this.activeTrial = ch;
      this.lastCenterRenderHash = "";
    });

    room.onMessage("trial_completed", (res: { wonNecklace: boolean; clueText: string }) => {
      sfx.playGoldChime();
      if (this.activeTrial) {
        this.activeTrial.stage = 4;
        this.activeTrial.completedClue = `${res.wonNecklace ? "📿 ALTIN KOLYE KAZANDIN! | " : ""}${res.clueText}`;
      }
      const rnd = (this.room?.state as any)?.round || 1;
      this.addClueEntry({
        category: "clue",
        icon: res.wonNecklace ? "📿" : "🧩",
        source: "1 Dk Bulmaca Sınavı Kanıtı",
        text: escapeHtml(`${res.wonNecklace ? "[Altın Kolye Kazanıldı] " : ""}${res.clueText}`),
        dedupeKey: `trial_${rnd}_${res.clueText}`
      });
      this.lastCenterRenderHash = "";
    });

    // ⏩ ERKEN HAZIR SAYACI
    room.onMessage("ready_count_update", (d: { readyCount: number; totalHumans: number }) => {
      this.readyStatusText = `(${d.readyCount}/${d.totalHumans})`;
      const btn = document.getElementById("btn-ready-phase");
      if (btn) btn.textContent = `⏩ Hazırım ${this.readyStatusText}`;
    });

    // 🗡️ GECE HAİNLER MECLİSİ CANLI İNFAZ SEÇİMLERİ & KAPI DİNLEME
    room.onMessage("traitor_pick_update", (d: any) => {
      this.traitorNightPicks.set(d.traitorId, d);
      this.lastCenterRenderHash = "";
    });

    room.onMessage("night_watch_result", (d: { text: string }) => {
      this.nightWatchNote = d.text;
      sfx.playSealBreak();
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
            false
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
          const isMe = ev.victimId === this.room?.sessionId;
          this.showExecutionToast(
            isMe ? "💀 HAİNLER TOPLANTISINDA İNFAZ EDİLDİN!" : `🩸 GECE İNFAZI: KOLTUK #${ev.victimSeat}`,
            isMe
              ? "Gece Hainler Meclisi senin için infaz kararı verdi! Porselen tabağın ters çevrildi; artık Hayalet olarak şatoda süzülüp oyun sonunu izleyebilirsin."
              : `Hainler gece toplantısında Koltuk #${ev.victimSeat} (${ev.victimNick}) için İNFAZ mührü bastı!`,
            true
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

    // 🗳️ ŞÖMİNE ÖNCESİ KİM KİME OY VERDİ AÇIKLAMASI
    room.onMessage(
      "vote_reveal",
      (d: {
        votes: Array<{ voterSeat: number; voterNick: string; targetSeat: number; targetNick: string }>;
      }) => {
        this.lastVoteReveal = d.votes || [];
        if (this.lastVoteReveal.length > 0) {
          const rnd = (this.room?.state as any)?.round || 1;
          const summary = this.lastVoteReveal
            .map((v) => `#${v.voterSeat} ${v.voterNick} ➔ #${v.targetSeat} ${v.targetNick}`)
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
      sfx.playFireWhoosh(true);
      this.showExecutionToast(
        "🕯️ ŞATODA KARARTMA SABOTAJI!",
        "Gizli bir Hain avizeleri ve şamdanları söndürdü! 12 saniye boyunca karanlıkta kimseye sırtını dönme!",
        true
      );
    });

    // 📜 GÜNDÜZ HAİN SABOTAJI: İSİMSİZ SAHTE NOT
    room.onMessage("anonymous_note", (d: { text: string }) => {
      sfx.playSealBreak();
      const rnd = (this.room?.state as any)?.round || 1;
      this.addClueEntry({
        category: "clue",
        icon: "📜",
        source: "Cebe Bırakılan İsimsiz Not (⚠️ Sahte Olabilir)",
        text: escapeHtml(`"${d.text}"`),
        dedupeKey: `anon_${rnd}_${d.text}`
      });
      this.showExecutionToast("📜 CEBİNE İSİMSİZ BİR NOT BIRAKILDI!", `"${d.text}"`, true);
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
      this.showPuzzleFeedbackModal(d.text, true);
    });

    // 👻 HAYALET ŞAMDAN TİTRETMESİ
    room.onMessage("ghost_flicker", () => {
      this.scene.triggerGhostFlicker();
      sfx.playSealBreak();
    });

    room.onStateChange((state: any) => {
      sessionStorage.setItem("sofra_reconnect_token", room.reconnectionToken);
      const me = state.players?.get(room.sessionId);
      if (me && state.phase !== "DAY") {
        this.localX = me.x;
        this.localZ = me.z;
        this.localRotY = me.rotY;
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
    toast.innerHTML = `
      <div style="font-size:0.78rem; letter-spacing:1.5px; color:var(--gold);">
        📜 MASAYA BIRAKILAN VEDA MEKTUBU
      </div>
      <h3 style="margin:6px 0; color:${isRed ? "#ff4d5e" : "#9ed4ff"};">
        Koltuk #${data.seat} ${data.nick} (${data.roleLabel})
      </h3>
      <p style="font-style:italic; font-size:0.92rem; color:var(--parchment); line-height:1.45;">
        "${data.note}"
      </p>
    `;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 6500);
  }

  private showExecutionToast(title: string, body: string, isDanger: boolean): void {
    const toast = document.getElementById("farewell-toast")!;
    toast.innerHTML = `
      <div style="font-size:0.78rem; letter-spacing:1.5px; color:var(--gold);">
        🕯️ GECE HAİNLER MECLİSİ HÜKMÜ
      </div>
      <h3 style="margin:6px 0; color:${isDanger ? "#ff4d5e" : "#ffd166"};">
        ${title}
      </h3>
      <p style="font-size:0.92rem; color:var(--parchment); line-height:1.45;">
        ${body}
      </p>
    `;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 7000);
  }

  private returnToMainMenu(): void {
    this.room = null;
    this.myRole = null;
    this.lastPhase = "";
    this.previewSelfOnMenu = false;
    this.scene.inspectTargetId = null;
    this.myQuests = [];
    this.activeTrial = null;
    this.traitorNightPicks.clear();
    this.nightConclaveLogs = [];
    this.nightWatchNote = "";
    this.gameOverSummary = null;
    document.body.classList.remove("in-day-mode");
    document.getElementById("day-action-hud")?.classList.remove("day-active");
    document.getElementById("hud")?.classList.add("hidden");
    document.getElementById("my-role-pill")?.classList.add("hidden");
    document.getElementById("inspect-overlay")?.classList.add("hidden");
    document.getElementById("puzzle-modal")?.classList.add("hidden");
    this.closeHandbookModal();
    document.getElementById("main-menu-overlay")?.classList.remove("hidden");
    this.scene.syncCharacters([], 0);
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
      const win = document.createElement("div");
      win.className = "ko-pm-window";
      win.innerHTML = `
        <div class="ko-pm-header ${th.unread ? "unread-pulse" : ""}">
          <span>🤫 [PM] #${th.peerSeat} ${th.peerNick}</span>
          <div style="display:flex; gap:5px;">
            <button class="btn" data-pm-mute="${peerId}" title="${isMuted ? "Sesi Aç" : "Sustur"}" style="padding:1px 6px; font-size:0.72rem;">${
        isMuted ? "🔇" : "🔊"
      }</button>
            <button class="btn" data-pm-min="${peerId}" style="padding:1px 7px; font-size:0.72rem;">${
        th.minimized ? "▢" : "—"
      }</button>
            <button class="btn btn-crimson" data-pm-close="${peerId}" style="padding:1px 7px; font-size:0.72rem;">✕</button>
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
                        `<div><strong style="color:${m.fromMe ? "#ffd700" : "#e3b3ff"};">${
                          m.senderNick
                        }:</strong> ${m.text}</div>`
                    )
                    .join("")
            }
          </div>
          <form class="ko-pm-form" data-pm-form="${peerId}">
            <input type="text" maxlength="120" placeholder="#${th.peerSeat} ${th.peerNick} kişisine fısılda..." />
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
        <button class="btn" data-pick-dm="${o.id}" data-nick="${o.nick}" data-seat="${o.seat}" style="display:flex; justify-content:space-between; width:100%; padding:9px 12px;">
          <span>#${o.seat} ${o.nick}</span>
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
        modal.classList.add("hidden");
        this.openPMThread(b.dataset.pickDm!, b.dataset.nick!, Number(b.dataset.seat));
      });
    });
  }

  private appendChatMessage(senderId: string, sender: string, scope: string, text: string): void {
    const log = document.getElementById("chat-log")!;
    const item = document.createElement("div");
    const canDM = senderId && this.room && senderId !== this.room.sessionId;
    const nameHtml = canDM
      ? `<span class="chat-nick-link" data-chat-dm="${senderId}" data-nick="${sender}">[${scope}] ${sender}:</span>`
      : `<span style="color:#ffd700;">[${scope}] ${sender}:</span>`;

    item.innerHTML = `${nameHtml} ${text}`;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;

    item.querySelector("[data-chat-dm]")?.addEventListener("click", (e) => {
      const el = e.currentTarget as HTMLElement;
      const sid = el.dataset.chatDm!;
      const p = (this.room?.state as any)?.players?.get(sid);
      this.openPMThread(sid, p?.nick || el.dataset.nick || "Oyuncu", p?.seat || 1);
    });
  }

  // ==========================================================================
  // HUD AKSİYONLARI & WILD RIFT + HİBRİT YÖN KONTROLLERİ
  // ==========================================================================
  private setupHUDActions(): void {
    const btnWatchAd = document.getElementById("btn-watch-ad")!;
    btnWatchAd.addEventListener("click", () => {
      btnWatchAd.setAttribute("disabled", "true");
      let left = 3;
      btnWatchAd.textContent = `⏳${left}s`;
      const timer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          btnWatchAd.textContent = `⏳${left}s`;
        } else {
          clearInterval(timer);
          this.vault.gold += 50;
          this.saveVault();
          sfx.playGoldChime();
          btnWatchAd.removeAttribute("disabled");
          btnWatchAd.textContent = "🎬+50";
          this.lastCenterRenderHash = "";
        }
      }, 1000);
    });

    const cycleLight = () => {
      this.scene.cycleBrightnessBoost();
    };
    const updateZoomBtn = (label: string) => {
      const zBtn = document.getElementById("btn-hud-zoom");
      if (zBtn) zBtn.textContent = label;
    };
    document.getElementById("btn-hud-zoom")?.addEventListener("click", () => {
      updateZoomBtn(this.scene.cycleCameraZoom());
    });
    document.getElementById("btn-open-handbook")?.addEventListener("click", () => this.toggleHandbookModal());
    document.getElementById("handbook-modal")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement)?.id === "handbook-modal") {
        this.closeHandbookModal();
      }
    });
    document.getElementById("btn-hud-brightness")?.addEventListener("click", cycleLight);
    document.getElementById("btn-force-landscape")?.addEventListener("click", () => this.enterLandscapeFullscreen());
    document.getElementById("btn-menu-landscape")?.addEventListener("click", () => this.enterLandscapeFullscreen());
    document.getElementById("btn-hud-landscape")?.addEventListener("click", () => this.enterLandscapeFullscreen());
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
      this.room?.send("ready_next_phase");
      sfx.playSealBreak();
    });

    document.getElementById("btn-open-dm-list")?.addEventListener("click", () => this.openDMPickerModal());
    document.getElementById("btn-wheel-dm")?.addEventListener("click", () => this.openDMPickerModal());
    document.getElementById("btn-close-dm-picker")?.addEventListener("click", () => {
      document.getElementById("dm-picker-modal")?.classList.add("hidden");
    });

    document.getElementById("btn-wheel-door")?.addEventListener("click", () => this.tryInteractNearestDoor());

    // Alt sohbet küçült/büyüt
    const bottomChat = document.getElementById("ko-bottom-chat")!;
    const minChatBtn = document.getElementById("btn-toggle-chat-min");
    minChatBtn?.addEventListener("click", (e) => {
      bottomChat.classList.toggle("minimized");
      (e.currentTarget as HTMLElement).textContent = bottomChat.classList.contains("minimized") ? "▴" : "▾";
    });
    document.getElementById("btn-chat-all")?.addEventListener("click", () => {
      if (bottomChat.classList.contains("minimized")) {
        bottomChat.classList.remove("minimized");
        if (minChatBtn) minChatBtn.textContent = "▾";
      }
      (document.getElementById("chat-input") as HTMLInputElement | null)?.focus();
    });

    // Odadan Çık / Dramatik Veda Mektubu Bırak
    document.getElementById("btn-leave-room")?.addEventListener("click", () => {
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
      this.room.send("chat", { text });
      chatInput.value = "";
    });
  }

  private async enterLandscapeFullscreen(): Promise<void> {
    try {
      const docEl: any = document.documentElement;
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
      // iOS Safari tam ekran / yatay kilidi desteklemiyorsa sessizce geçer; kullanıcı telefonu yan çevirerek oynar.
    }
  }

  private setupInputAndLoLWheel(): void {
    window.addEventListener("keydown", (e) => {
      if (document.activeElement?.tagName === "INPUT") {
        if (e.key === "Escape") {
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "escape" && this.handbookOpen) {
        e.preventDefault();
        this.closeHandbookModal();
        return;
      }
      if ((k === "b" || k === "j") && this.room) {
        e.preventDefault();
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        this.toggleHandbookModal();
        return;
      }
      if (k === "v" && this.room) {
        e.preventDefault();
        const label = this.scene.cycleCameraZoom();
        const zBtn = document.getElementById("btn-hud-zoom");
        if (zBtn) zBtn.textContent = label;
        return;
      }
      if (k === "enter" && this.room) {
        e.preventDefault();
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
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
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        const puzModal = document.getElementById("puzzle-modal");
        if (puzModal && !puzModal.classList.contains("hidden")) {
          puzModal.classList.add("hidden");
        } else {
          this.openInspectPickerModal();
        }
        return;
      }
      if (k === "alt" && document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      this.keys.add(k);
      if (k === "e") {
        this.tryInteractNearestDoor();
      } else if (k === "q" || k === "arrowleft") {
        this.scene.cameraYaw += 0.14;
      } else if (k === "arrowright") {
        this.scene.cameraYaw -= 0.14;
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    // Sol Kamera Dönüş Tuşları (⟲ Sola Bak / Sağa Bak ⟳)
    const bindTurnBtn = (id: string, dir: number) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.camTurnDir = dir;
      });
      const stop = () => {
        if (this.camTurnDir === dir) this.camTurnDir = 0;
      };
      btn.addEventListener("pointerup", stop);
      btn.addEventListener("pointercancel", stop);
      btn.addEventListener("pointerleave", stop);
    };
    bindTurnBtn("btn-cam-left", 1);
    bindTurnBtn("btn-cam-right", -1);

    // 1A. PC WEB: MOUSE BASMADAN (TIKLAMADAN) DOĞRUDAN FARE HAREKETİYLE SERBEST YÖNLENDİRME!
    const canvas = this.scene.renderer.domElement;
    let hasLastMouse = false;
    let lastHoverX = 0;
    let lastHoverY = 0;

    window.addEventListener("mousemove", (e) => {
      // 1) Eğer Pointer Lock aktifse sınırsız 360° döndür
      if (document.pointerLockElement === canvas) {
        if (this.scene.inspectTargetId) {
          this.scene.inspectOrbitYaw -= e.movementX * 0.008;
          return;
        }
        this.scene.cameraYaw -= e.movementX * 0.0036;
        this.scene.cameraPitch = Math.max(0.15, Math.min(1.05, this.scene.cameraPitch + e.movementY * 0.0026));
        return;
      }

      // 2) Pointer Lock yokken bile (hiçbir fare tuşuna basmadan!) Gündüz keşfinde fare hareketiyle yönlendir!
      const phase = (this.room?.state as any)?.phase;
      if (phase !== "DAY" || this.scene.inspectTargetId || document.activeElement?.tagName === "INPUT" || e.altKey) {
        this.pcEdgePanDir = 0;
        hasLastMouse = false;
        return;
      }

      const targetEl = e.target as HTMLElement | null;
      const overInteractiveUI = Boolean(
        targetEl?.closest(
          ".interactive, .ko-pm-window, .day-quest-box, .lol-wheel-cluster, .left-control-cluster, #puzzle-modal, #dm-picker-modal, #inspect-overlay, #handbook-modal"
        )
      );
      if (overInteractiveUI) {
        this.pcEdgePanDir = 0;
        lastHoverX = e.clientX;
        lastHoverY = e.clientY;
        hasLastMouse = true;
        return;
      }

      if (!hasLastMouse) {
        lastHoverX = e.clientX;
        lastHoverY = e.clientY;
        hasLastMouse = true;
        return;
      }

      const dx = typeof e.movementX === "number" && e.movementX !== 0 ? e.movementX : e.clientX - lastHoverX;
      const dy = typeof e.movementY === "number" && e.movementY !== 0 ? e.movementY : e.clientY - lastHoverY;
      lastHoverX = e.clientX;
      lastHoverY = e.clientY;

      this.scene.cameraYaw -= dx * 0.0056;
      this.scene.cameraPitch = Math.max(0.15, Math.min(1.05, this.scene.cameraPitch + dy * 0.0036));

      // Ekranın sol/sağ %8 kenarına gelindiğinde takılmadan dönmeye devam etsin!
      if (e.clientX < window.innerWidth * 0.08) {
        this.pcEdgePanDir = 1;
      } else if (e.clientX > window.innerWidth * 0.92) {
        this.pcEdgePanDir = -1;
      } else {
        this.pcEdgePanDir = 0;
      }
    });

    // PC Fare Tekerleği ile Kamera Uzaklığı (Zoom) Ayarı
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.room || this.scene.inspectTargetId) return;
        e.preventDefault();
        const label = this.scene.adjustCameraZoom(e.deltaY > 0 ? 0.65 : -0.65);
        const zBtn = document.getElementById("btn-hud-zoom");
        if (zBtn) zBtn.textContent = label;
      },
      { passive: false }
    );

    // PC'de 3B sahneye bir kez tıklanırsa tam 360° sonsuz fare kilidi (Pointer Lock) de açılabilir (ESC/Enter ile çıkılır)
    canvas.addEventListener("click", (e) => {
      const isTouch = "ontouchstart" in window && navigator.maxTouchPoints > 0;
      if (isTouch) return;
      const phase = (this.room?.state as any)?.phase;
      if (phase === "DAY" && !this.scene.inspectTargetId && !document.pointerLockElement) {
        (canvas as any).requestPointerLock?.()?.catch?.(() => {});
      }
      void e;
    });

    // 1B. Mobil Dokunmatik & 360° İnceleme Sürükleme Bakışı (İzole lookPointerId)
    let lookPointerId: number | null = null;
    let lastLookX = 0;
    let lastLookY = 0;

    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && !this.scene.inspectTargetId && (this.room?.state as any)?.phase === "DAY") {
        return;
      }
      if (lookPointerId !== null) return;
      lookPointerId = e.pointerId;
      lastLookX = e.clientX;
      lastLookY = e.clientY;
    });

    window.addEventListener("pointermove", (e) => {
      if (e.pointerId !== lookPointerId) return;
      const dx = e.clientX - lastLookX;
      const dy = e.clientY - lastLookY;
      lastLookX = e.clientX;
      lastLookY = e.clientY;
      if (this.scene.inspectTargetId) {
        this.scene.inspectOrbitYaw -= dx * 0.012;
        return;
      }
      this.scene.cameraYaw -= dx * 0.006;
      this.scene.cameraPitch = Math.max(0.15, Math.min(1.05, this.scene.cameraPitch + dy * 0.0045));
    });

    const releaseLook = (e: PointerEvent) => {
      if (e.pointerId === lookPointerId) lookPointerId = null;
    };
    window.addEventListener("pointerup", releaseLook);
    window.addEventListener("pointercancel", releaseLook);

    // 2. Sol Alt Hibrit Yön Okları (▲▼◄►) + Analog Joystick (İzole joyPointerId)
    const zone = document.getElementById("joystick-zone")!;
    const knob = document.getElementById("joystick-knob")!;
    let joyPointerId: number | null = null;

    const updateJoystick = (clientX: number, clientY: number) => {
      const rect = zone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxR = rect.width * 0.38;
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
      e.preventDefault();
      e.stopPropagation();
      joyPointerId = e.pointerId;
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
      e.preventDefault();
      e.stopPropagation();
      sprintPointerId = e.pointerId;
      lastSprintX = e.clientX;
      this.mobileSprintHeld = true;
      sprintBtn.classList.add("sprinting");
    });

    window.addEventListener("pointermove", (e) => {
      if (e.pointerId !== sprintPointerId) return;
      const dx = e.clientX - lastSprintX;
      lastSprintX = e.clientX;
      this.scene.cameraYaw -= dx * 0.0065;
    });

    const releaseSprint = (e: PointerEvent) => {
      if (e.pointerId !== sprintPointerId) return;
      sprintPointerId = null;
      this.mobileSprintHeld = false;
      sprintBtn.classList.remove("sprinting");
    };
    window.addEventListener("pointerup", releaseSprint);
    window.addEventListener("pointercancel", releaseSprint);
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
  private openMenuSelfInspect360(): void {
    const nickInput = document.getElementById("menu-nick-input") as HTMLInputElement | null;
    if (nickInput && nickInput.value.trim()) {
      this.vault.customName = nickInput.value.trim();
      this.saveVault(false);
    }

    this.previewSelfOnMenu = true;
    this.scene.inspectTargetId = "__preview_self__";
    this.scene.inspectOrbitYaw = 0;

    document.getElementById("main-menu-overlay")?.classList.add("hidden");
    const overlay = document.getElementById("inspect-overlay")!;
    const card = document.getElementById("inspect-card-content")!;
    overlay.classList.remove("hidden");

    const renderPreviewCard = () => {
      const charDef = CHARACTERS.find((c) => c.seat === this.vault.selectedSeat) ?? CHARACTERS[0];
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <div style="font-size:0.74rem; color:var(--gold); letter-spacing:1px;">
              🔍 KAYIT ÖNCESİ 360° KARAKTER İNCELEME
            </div>
            <h3 style="font-size:1.05rem; color:var(--parchment); margin-top:2px;">
              #${charDef.seat} ${this.vault.customName || charDef.name} (${charDef.title})
            </h3>
          </div>
          <button class="btn btn-crimson" id="btn-close-menu-inspect" style="padding:5px 10px;">
            🔙 Kayıt / Menü
          </button>
        </div>

        <div style="font-size:0.76rem; color:var(--text-muted);">
          Ekranı parmağınla / fareyle sağa sola sürükleyerek karakterini 360° çevirebilirsin:
        </div>

        <div style="display:flex; gap:6px;">
          <button class="btn" id="btn-spin-left-menu" style="flex:1;">⟲ Sola Çevir</button>
          <button class="btn" id="btn-spin-right-menu" style="flex:1;">Sağa Çevir ⟳</button>
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
      card.querySelectorAll("[data-menu-col]").forEach((el) => {
        el.addEventListener("click", () => {
          this.vault.coatColor = (el as HTMLElement).dataset.menuCol!;
          this.saveVault(false);
          renderPreviewCard();
        });
      });
      document.getElementById("btn-close-menu-inspect")?.addEventListener("click", () => {
        this.previewSelfOnMenu = false;
        this.scene.inspectTargetId = null;
        overlay.classList.add("hidden");
        document.getElementById("main-menu-overlay")?.classList.remove("hidden");
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
          <button class="btn ${p.isMe ? "btn-crimson" : ""}" data-inspect-pick="${p.id}" style="display:flex; justify-content:space-between; width:100%; padding:9px 12px;">
            <span>#${p.seat} ${p.nick} ${p.isMe ? "(Sen)" : ""}</span>
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
    this.scene.inspectOrbitYaw = 0;
    this.lastCenterRenderHash = "";

    const overlay = document.getElementById("inspect-overlay")!;
    const card = document.getElementById("inspect-card-content")!;
    overlay.classList.remove("hidden");

    const isMe = data.id === this.room?.sessionId;
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
                <strong>#${b.seat} ${b.nick}</strong>
                <span style="color:${b.color};">${b.tier} (%${b.score})</span>
              </div>
              <div class="bond-bar-track">
                <div class="bond-bar-fill" style="width:${b.score}%; background:${b.color};"></div>
              </div>
            </div>
          `
            )
            .join("");

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div>
          <div style="font-size:0.72rem; color:var(--gold);">
            SANDALYE #${data.seat} · 📍 ${data.roomName} ${data.hasNecklace ? "· 📿 Altın Kolye" : ""}
          </div>
          <h3 style="font-size:1.05rem; color:var(--parchment);">
            ${data.nick} <span style="font-size:0.78rem; color:var(--text-muted);">(${data.charName})</span>
          </h3>
        </div>
        <button class="btn btn-crimson" id="btn-close-inspect" style="padding:5px 11px; font-weight:bold;">
          ${
            (this.room?.state as any)?.phase === "VOTE"
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
    document.getElementById("btn-inspect-dm")?.addEventListener("click", () => {
      this.scene.inspectTargetId = null;
      overlay.classList.add("hidden");
      this.lastCenterRenderHash = "";
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
      this.scene.inspectTargetId = null;
      overlay.classList.add("hidden");
      this.lastCenterRenderHash = "";
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
          ${others.map((o) => `<option value="${o.id}">#${o.seat} ${o.nick}</option>`).join("")}
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
          ${seats.map((s, i) => `<option value="${s.seat}" ${i === 0 ? "selected" : ""}>#${s.seat} ${s.nick}</option>`).join("")}
        </select>
        <label style="font-size:0.74rem; color:var(--gold);">2. Koltuk:</label>
        <select id="kahya-seat-b">
          ${seats.map((s, i) => `<option value="${s.seat}" ${i === 1 ? "selected" : ""}>#${s.seat} ${s.nick}</option>`).join("")}
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
    sfx.playSealBreak();
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--gold-soft); padding-bottom:6px;">
        <strong style="color:var(--gold); font-size:0.96rem;">${station.title}</strong>
        <button class="btn" id="btn-close-med-station" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.8rem; color:var(--parchment); line-height:1.45;">
        ${station.description}
      </p>
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
        🕯️ Her gündüz turunda en fazla 2 farklı Orta Çağ odası etkileşimi kullanabilirsin.
      </div>
    `;
    modal.classList.remove("hidden");

    document.getElementById("btn-close-med-station")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
    card.querySelectorAll("[data-med-opt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const optionId = (btn as HTMLElement).dataset.medOpt!;
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
        ${state.councilBoardNote || "Tahtaya tebeşirle şüpheli gördüğün koltuğu yaz (Tüm şatoya duyurulur!):"}
      </p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
        ${suspects
          .map(
            (s) => `
          <button class="btn" data-chalk-seat="${s.seat}">
            ✍️ #${s.seat} ${s.nick}
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
        sfx.playSealBreak();
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
        <strong style="color:var(--gold);">🧩 ${ch.title}</strong>
        <button class="btn" id="btn-close-puzzle" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.88rem; color:var(--parchment); line-height:1.45;">
        ${ch.prompt}
      </p>
      <div style="display:flex; flex-direction:column; gap:7px;">
        ${ch.options
          .map(
            (opt, idx) => `
          <button class="btn" data-puz-opt="${idx}" style="text-align:left; padding:10px 12px;">
            <strong>${idx + 1}.</strong> ${opt}
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

  private showPuzzleFeedbackModal(text: string, ok: boolean): void {
    const modal = document.getElementById("puzzle-modal")!;
    const card = document.getElementById("puzzle-card-content")!;
    card.innerHTML = `
      <h3 style="color:${ok ? "#8ce99a" : "#ff6b6b"}; font-size:1rem;">
        ${ok ? "✨ KADİM MÜHÜR AÇILDI!" : "⚠️ MÜHÜR KAPALI KALDI"}
      </h3>
      <p style="font-size:0.88rem; color:var(--parchment); line-height:1.45;">${text}</p>
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
    sfx.playSealBreak();
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
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    if (mode) this.handbookViewMode = mode;
    this.handbookOpen = true;
    this.unreadClueCount = 0;
    this.updateHandbookHudBadge();
    this.lastDayExtraKey = "";
    sfx.playSealBreak();
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
    let phaseActionHtml = "";
    if (phase === "VOTE") {
      const votedPlayer =
        this.selectedVoteTargetId && this.selectedVoteTargetId !== "ABSTAIN"
          ? state.players?.get(this.selectedVoteTargetId)
          : null;
      phaseActionHtml = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="color:#ff6b7a;">🗳️ ŞÖMİNE OYLAMASI AKTİF:</strong>
          <span>${
            !isAlive
              ? "👻 Hayalet olarak izliyorsun"
              : this.selectedVoteTargetId === "ABSTAIN"
              ? "🏳️ Çekimser kaldın"
              : votedPlayer
              ? `✅ Oyun Mühürlendi: #${votedPlayer.seat} ${escapeHtml(votedPlayer.nick)}`
              : "Sağ sayfadan kime oy atacağını tek tıkla seç!"
          }</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
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
              picked
                ? `🎯 Seçili Kurban: #${picked.seat} ${escapeHtml(picked.nick)}`
                : "Sağ sayfadan bu gece infaz edilecek Misafiri seç!"
            }</span>
          </div>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            ${
              picked
                ? `<button class="btn btn-crimson" id="hb-btn-seal-night" style="padding:4px 10px; font-size:0.73rem;">🩸 #${picked.seat} İnfazını Mühürle!</button>`
                : ""
            }
            <button class="btn" id="hb-btn-focus-main" style="padding:4px 9px; font-size:0.72rem;">🌑 Meclis Sohbeti</button>
          </div>
        `;
      } else {
        phaseActionHtml = `
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <strong style="color:var(--gold);">🌑 2 DK GECE MOLASI (Hainler Toplantıda):</strong>
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
          <strong style="color:#8ce99a;">🧩 1 DK ORTAK ŞATO BULMACA SINAVI AKTİF!</strong>
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
          <span>İpuçlarına göre son hükmünü buradan mühürleyebilirsin:</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <button class="btn ${this.selectedFinalChoice === "TRUST" ? "btn-emerald" : ""}" id="hb-btn-final-trust" style="padding:4px 10px; font-size:0.73rem;">🤝 Hepimiz Misafiriz</button>
          <button class="btn ${this.selectedFinalChoice === "DOUBT" ? "btn-crimson" : ""}" id="hb-btn-final-doubt" style="padding:4px 10px; font-size:0.73rem;">🔥 Aramızda Hain Var</button>
        </div>
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
          <button class="btn" id="hb-btn-ready" style="padding:4px 9px; font-size:0.72rem;">⏩ Hazırım ${this.readyStatusText}</button>
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
          <button class="btn" id="hb-btn-ready" style="padding:4px 9px; font-size:0.72rem;">⏩ Hazırım ${this.readyStatusText}</button>
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
                  phaseBtnHtml = `<button class="btn ${picked ? "btn-emerald" : "btn-crimson"}" data-hb-vote="${p.id}" style="padding:4px 8px; font-size:0.7rem;">${
                    picked ? "✅ Oyun Bunda" : "🔥 Oy Ver"
                  }</button>`;
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
                : `<div style="font-size:0.72rem; color:var(--text-muted); line-height:1.4;">
                     Gündüz keşfinde <strong>📚 Kütüphane, ⚗️ Simya Mahzeni, ⚔️ Cephanelik, ⛓️ Zindan, ⛲ Kargalı Avlu</strong> veya <strong>🔮 Bulmaca Salonu</strong>'na gittiğinde oda seçenekleri burada aktifleşir!
                   </div>`
            }

            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
              <button class="btn" id="hb-act-castle-map" style="flex:1; font-size:0.72rem;">🗺️ 21 Oda Krokisi</button>
              ${
                (phase === "DAY" || phase === "TABLE") && isAlive && (state.pot || 0) >= 50
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
        this.handbookViewMode = (btn as HTMLElement).dataset.hbTab as any;
        this.renderHandbookModal();
      });
    });
    shell.querySelectorAll("[data-clue-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
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
        this.selectedVoteTargetId = targetId;
        this.room?.send("vote", { targetId });
        sfx.playSealBreak();
        this.lastCenterRenderHash = "";
        this.renderHandbookModal();
      });
    });
    document.getElementById("hb-btn-abstain")?.addEventListener("click", () => {
      if (!isAlive) return;
      this.selectedVoteTargetId = "ABSTAIN";
      this.room?.send("vote", { targetId: "ABSTAIN" });
      sfx.playSealBreak();
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    shell.querySelectorAll("[data-hb-night-kill]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = (btn as HTMLElement).dataset.hbNightKill!;
        this.selectedNightTargetId = targetId;
        this.room?.send("night_pick", { targetId, instantSeal: true });
        sfx.playCastleBell();
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
      this.room?.send("seal_night_execution");
      sfx.playCastleBell();
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
      this.selectedFinalChoice = "TRUST";
      this.room?.send("final_decision", { decision: "TRUST" });
      sfx.playSealBreak();
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    document.getElementById("hb-btn-final-doubt")?.addEventListener("click", () => {
      this.selectedFinalChoice = "DOUBT";
      this.room?.send("final_decision", { decision: "DOUBT" });
      sfx.playSealBreak();
      this.lastCenterRenderHash = "";
      this.renderHandbookModal();
    });
    document.getElementById("hb-btn-focus-main")?.addEventListener("click", () => {
      this.closeHandbookModal();
    });
    document.getElementById("hb-btn-ready")?.addEventListener("click", () => {
      this.room?.send("ready_next_phase");
      sfx.playSealBreak();
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
        this.closeHandbookModal();
        this.room?.send("request_inspect", { targetId });
      });
    });

    // 3. Sekme Oda Etkileşimleri
    shell.querySelectorAll("[data-hb-station]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLElement;
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
  private renderCenterPanel(state: any): void {
    const panel = document.getElementById("center-panel")!;
    const phase: string = state.phase || "LOBBY";

    // 360° Karakter İnceleme açıkken orta panel 3B karakterin önünü kapatmasın!
    if (this.scene.inspectTargetId) {
      panel.classList.add("hidden");
      return;
    }

    const playerSummary = Array.from(state.players?.values() || [])
      .map((p: any) => `${p.id}:${p.seat}:${p.nick}:${p.alive}:${p.connected}:${p.coatColor}:${p.hat}:${p.mask}:${p.votedForId}`)
      .join("|");
    const trialKey = this.activeTrial
      ? `${this.activeTrial.stage}:${this.activeTrial.puzzleId}:${this.activeTrial.canSabotage}:${this.activeTrial.completedClue || ""}`
      : "";
    const picksKey = Array.from(this.traitorNightPicks.entries())
      .map(([k, v]) => `${k}>${v.targetSeat}`)
      .join(",");
    const stampsKey = Object.entries(this.suspectTags)
      .map(([s, t]) => `${s}:${t}`)
      .join(",");
    const hash = `${phase}|${state.round}|${this.myRole?.role || ""}|${state.fastMode}|${state.paceMode || "normal"}|${state.targetPlayerCount || 10}|${state.atmosphereTheme || "torch"}|${state.autoStart}|${state.pot}|${state.lastBurnedId}|${state.lastBurnedFlame}|${state.winReason}|${this.lastVoteReveal.length}|${this.mobileLobbyTab}|${this.vault.gold}|${this.vault.selectedSeat}|${this.vault.coatColor}|${this.vault.hat}|${this.vault.mask}|${this.selectedVoteTargetId}|${this.selectedNightTargetId}|${this.selectedFinalChoice}|${this.preTargetSeat}|${stampsKey}|${this.clueJournal.length}|${trialKey}|${picksKey}|${this.nightConclaveLogs.length}|${this.nightWatchNote}|${Boolean(this.gameOverSummary)}|${playerSummary}`;

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
    const isHost = state.hostId === this.room?.sessionId;
    const targetCount = state.targetPlayerCount || 10;
    const activePreset = resolveDurationPreset(state.paceMode, state.fastMode);
    const paceMode = activePreset.id;
    const atmo = state.atmosphereTheme || "torch";

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>🏰 ${state.hasPassword ? "🔒" : "🔓"} ${state.roomTitle || "ORTA ÇAĞ SOFRA LOBİSİ"} (${playerCount}/${targetCount})</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            Oda Kodu: <strong style="color:var(--gold);">${state.code}</strong> · <strong style="color:#ffe6a1;">${activePreset.title}</strong> (${activePreset.summary})
          </span>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn" id="btn-lobby-inspect-self">🔍 360° Karakterim</button>
          <button class="btn" id="btn-share-room">🔗 Davet Kopyala</button>
          ${
            isHost
              ? `
            <button class="btn" id="btn-add-bots">🤖 Bot Doldur</button>
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
            { n: 12, lbl: "12 Kişi (Tam Şölen)" }
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
              .map(
                (c) => `
              <div class="seat-card ${this.vault.selectedSeat === c.seat ? "active" : ""}" data-seat="${c.seat}">
                <div class="seat-num">SANDALYE #${c.seat} (Oda #${c.seat})</div>
                <div class="seat-name">${c.name}</div>
                <div class="seat-title">${c.title}</div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>

        <div class="customizer-box studio-col-custom">
          <h3 style="color:var(--gold); font-size:0.92rem;">🛡️ Orta Çağ Karakterini & Zırhını Seç</h3>
          <div class="field-row">
            <label>Görünecek Ünvan / Adın:</label>
            <input type="text" id="input-custom-name" maxlength="18" value="${this.vault.customName}" placeholder="Örn: Şövalye Cenker..." />
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
        const seat = Number((el as HTMLElement).dataset.seat);
        const charDef = CHARACTERS.find((c) => c.seat === seat);
        if (!charDef) return;
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
      this.room?.send("add_bots", { count: 11 });
    });
    document.getElementById("btn-auto-start")?.addEventListener("click", () => {
      this.room?.send("toggle_auto_start");
    });
    document.getElementById("btn-fast-mode")?.addEventListener("click", () => {
      this.room?.send("toggle_fast_mode");
    });
    document.getElementById("btn-start-game")?.addEventListener("click", () => {
      this.sendCustomizeToServer();
      this.room?.send("start_game");
    });
  }

  private renderArrivalEnvelope(panel: HTMLElement): void {
    const role = this.myRole?.role ?? "MISAFIR";
    const isHain = role === "HAIN";
    const fellows = this.myRole?.traitorMates ?? [];

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
                <strong>🗡️ Gizli Suç Ortağın:</strong> ${fellows.map((f) => `#${f.seat} ${f.nick}`).join(", ")}
              </div>`
            : ""
        }
        <div style="margin-top:8px;">
          <button class="btn btn-crimson" id="btn-arrival-ready" style="padding:9px 18px; font-size:0.9rem;">
            🔥 ZARFI ALDIM — ŞATO KEŞFİNE BAŞLA
          </button>
        </div>
      </div>
    `;

    document.getElementById("btn-arrival-ready")?.addEventListener("click", () => {
      this.room?.send("ready_next_phase");
      sfx.playSealBreak();
    });
  }

  private renderTrialPanel(panel: HTMLElement, state: any): void {
    const tr = this.activeTrial;
    const isHain = this.myRole?.role === "HAIN";
    const me = state.players?.get(this.room?.sessionId);
    const isSpectating = !me || !me.alive || me.ghost;

    if (isSpectating) {
      panel.innerHTML = `
        <div style="text-align:center; padding:16px;">
          <h2 style="color:var(--gold);">🧩 ŞATO BULMACA SINAVI (1 DAKİKA)</h2>
          <p style="margin-top:8px; color:var(--text-muted);">
            Hayatta kalan davetliler 3 aşamalı kadim düzeneği çözmeye çalışıyor... Ortak Hazine: <strong style="color:var(--gold);">🪙 ${state.pot}</strong>
          </p>
        </div>
      `;
      return;
    }

    if (!tr) {
      panel.innerHTML = `
        <div style="text-align:center; padding:16px;">
          <h2 style="color:var(--gold);">🧩 ŞATO BULMACA SINAVI HAZIRLANIYOR...</h2>
        </div>
      `;
      return;
    }

    if (tr.stage >= 4) {
      panel.innerHTML = `
        <div style="text-align:center; padding:14px;">
          <h2 style="color:#8ce99a; font-size:1.25rem;">🏆 3/3 AŞAMA TAMAMLANDI!</h2>
          <p style="margin:10px auto; max-width:560px; background:rgba(30,65,45,0.45); border:1px solid #8ce99a; border-radius:10px; padding:10px; font-size:0.9rem;">
            ${tr.completedClue || "Dedektif ipucun açıldı! Birazdan Yuvarlak Sofra tartışması başlayacak."}
          </p>
          <div style="font-size:0.82rem; color:var(--gold);">
            🪙 Ortak Şato Hazinesi: ${state.pot} · İstersen üstteki <strong>⏩ Hazırım</strong> düğmesine basabilirsin!
          </div>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>🧩 1 DAKİKALIK ŞATO BULMACA SINAVI — AŞAMA ${tr.stage}/${tr.totalStages}</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            3 aşamayı tamamla: Hazineyi büyüt, <strong style="color:var(--gold);">📿 Altın Kolye</strong> ve Gerçek Dedektif İpucu kazan!
          </span>
        </div>
        <span class="gold-badge">🪙 Hazine: ${state.pot}</span>
      </div>

      ${
        tr.feedback
          ? `<div style="margin-bottom:8px; padding:6px 10px; border-radius:8px; background:rgba(212,175,55,0.14); border:1px solid var(--gold-soft); font-size:0.8rem; color:var(--gold);">
              ${tr.feedback}
            </div>`
          : ""
      }

      <div style="background:rgba(22,16,34,0.92); border:1px solid var(--gold-soft); border-radius:12px; padding:12px; margin-bottom:10px;">
        <div style="font-size:0.76rem; color:var(--gold); margin-bottom:4px;">${tr.title}</div>
        <p style="font-size:0.95rem; line-height:1.45; margin-bottom:10px;">${tr.prompt}</p>
        <div style="display:flex; flex-direction:column; gap:7px;">
          ${(tr.options || [])
            .map(
              (opt: string, idx: number) => `
            <button class="btn" data-trial-opt="${idx}" style="text-align:left; padding:10px 12px;">
              <strong>${idx + 1}.</strong> ${opt}
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
      "Az önceki Şato Bulmaca Sınavını sabote ettiğinden şüpheleniyorum!",
      "Koridorda sürekli takip edip kapı önlerinde bekledi!",
      "Savunması çelişkili, suçu masumların üstüne yıkıyor!"
    ];

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:#ff4d5e;">👉 SUÇLA: #${targetSeat} ${targetNick}</strong>
        <button class="btn" id="btn-close-accuse" style="padding:3px 8px;">✕</button>
      </div>
      <p style="font-size:0.78rem; color:var(--text-muted);">
        Yuvarlak Sofrada herkesin duyacağı gerekçeni seç veya kendi kanıtını yaz:
      </p>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${presetReasons
          .map(
            (r) => `
          <button class="btn" data-accuse-reason="${r}" style="text-align:left; font-size:0.78rem; padding:8px 10px;">
            🗣️ "${r}"
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
            <div class="seat-name">${p.nick} ${p.id === myId ? "(Sen)" : ""}</div>
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
                  ? `<button class="btn btn-crimson" data-table-accuse="${p.id}" data-seat="${p.seat}" data-nick="${p.nick}" style="flex:1; padding:3px 5px; font-size:0.68rem;">
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
          sfx.playSealBreak();
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
    const chosenPlayer = this.selectedVoteTargetId
      ? state.players?.get(this.selectedVoteTargetId)
      : null;
    const preTargetPlayer: any =
      this.preTargetSeat > 0
        ? players.find((cand: any) => cand.seat === this.preTargetSeat && cand.id !== myId)
        : null;

    const statusBanner = !canVote
      ? `<div style="margin-bottom:10px; padding:9px 12px; border-radius:10px; background:rgba(70,85,120,0.25); border:1px solid #7ab8ff; font-size:0.84rem; color:#cfe5ff;">
           👻 Elenerek Hayalet oldun — yaşayan davetlilerin şömine oylamasını izliyorsun.
         </div>`
      : this.selectedVoteTargetId === "ABSTAIN"
      ? `<div style="margin-bottom:10px; padding:9px 12px; border-radius:10px; background:rgba(212,175,55,0.18); border:1px solid var(--gold); font-size:0.86rem; color:var(--gold);">
           🏳️ <strong>Çekimser kaldın!</strong> İstersen süre bitmeden aşağıdaki kartlardan birine <strong>🔥 OY AT</strong> diyebilirsin.
         </div>`
      : chosenPlayer
      ? `<div style="margin-bottom:10px; padding:9px 12px; border-radius:10px; background:rgba(40,120,75,0.32); border:2px solid #6ef2b1; font-size:0.88rem; color:#d8ffeb;">
           ✅ <strong>OYUN MÜHÜRLENDİ:</strong> Koltuk #${chosenPlayer.seat} (${chosenPlayer.nick}) seçildi! Herkes oy verdiğinde zarflar şömineye atılacak.
         </div>`
      : `<div style="margin-bottom:10px; padding:10px 14px; border-radius:10px; background:rgba(178,22,30,0.34); border:2px solid #ff5768; font-size:0.9rem; color:#ffe5e8; font-weight:bold; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
           <span>🗳️ SIRA SENDE — OYUNU AT! Şömineye göndermek istediğin şüphelinin kartındaki "🔥 OY AT" butonuna bas!</span>
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
          <h2 style="color:#ff5768; font-size:1.08rem;">🗳️ ŞÖMİNE OYLAMASI SEÇİM EKRANI — KİM ELENSİN?</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            En çok oyu alan kişinin zarfı şömineye atılır: <strong>Kırmızı Alev = Hain</strong>, <strong>Beyaz Alev = Masum Misafir</strong>!
          </span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <button class="btn" id="btn-vote-open-hb" style="padding:6px 10px; font-size:0.74rem; border-color:#ffd166; color:#ffe9a8;">
            📖 El Kitapçığı & İpuçları (${this.clueJournal.length})
          </button>
          ${
            canVote
              ? `<button class="btn" id="btn-vote-abstain" style="padding:6px 10px; font-size:0.74rem;">
                   🏳️ Çekimser Kal
                 </button>`
              : ""
          }
        </div>
      </div>

      ${statusBanner}

      <div class="seat-grid">
        ${players
          .map((p: any) => {
            const isMe = p.id === myId;
            const isPicked = this.selectedVoteTargetId === p.id;
            return `
              <div class="seat-card ${isPicked ? "active" : ""}" data-vote-card="${p.id}" style="border-width:${
              isPicked || this.preTargetSeat === p.seat ? "2px" : "1px"
            }; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div class="seat-num">SANDALYE #${p.seat}</div>
                  <div class="seat-name">${p.nick} ${isMe ? "(Sen)" : ""}</div>
                  <div class="seat-title" style="color:${p.votedForId ? "#ffd700" : "var(--text-muted)"};">
                    ${
                      state.necklaceHolder === p.id
                        ? "📿 Altın Kolye · "
                        : ""
                    }${p.votedForId ? "✉️ Oyunu Verdi" : "⏳ Düşünüyor..."}
                  </div>
                  ${this.renderSeatSuspectBadge(p.seat)}
                </div>
                <div style="display:flex; flex-direction:column; gap:5px; margin-top:8px;">
                  ${
                    canVote && !isMe
                      ? `<button class="btn ${isPicked ? "" : "btn-crimson"}" data-cast-vote="${p.id}" style="width:100%; padding:7px 8px; font-weight:bold; ${
                          isPicked ? "border-color:#6ef2b1; color:#6ef2b1;" : ""
                        }">
                          ${isPicked ? "✅ OYUN BU KİŞİDE" : "🔥 BU KİŞİYE OY AT"}
                        </button>`
                      : isMe
                      ? `<div style="font-size:0.7rem; color:var(--text-muted); text-align:center; padding:5px 0;">Kendi Koltuğun</div>`
                      : ""
                  }
                  <button class="btn" data-vote-inspect="${p.id}" style="width:100%; padding:3px 5px; font-size:0.68rem;">
                    🔍 Yakınlık Barı
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    const castVoteFor = (targetId: string) => {
      if (!canVote || targetId === myId) return;
      this.selectedVoteTargetId = targetId;
      this.room?.send("vote", { targetId });
      sfx.playSealBreak();
      this.lastCenterRenderHash = "";
    };

    document.getElementById("btn-vote-open-hb")?.addEventListener("click", () => {
      this.openHandbookModal("book");
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
      sfx.playSealBreak();
      this.lastCenterRenderHash = "";
    });

    panel.querySelectorAll("[data-cast-vote]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        castVoteFor((btn as HTMLElement).dataset.castVote!);
      });
    });

    panel.querySelectorAll("[data-vote-card]").forEach((cardEl) => {
      cardEl.addEventListener("click", () => {
        castVoteFor((cardEl as HTMLElement).dataset.voteCard!);
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
      ? `<div style="margin-bottom:10px; padding:10px 14px; border-radius:10px; background:rgba(175,20,38,0.34); border:2px solid #ff4d5e; color:#ffdbe0; font-size:0.88rem; font-weight:bold;">
           🚨 DİKKAT: SOFRADA EN ÇOK OYU SEN ALDIN VE ZARFIN ŞÖMİNEYE ATILDI! Artık 👻 Hayalet olarak şatoyu izleyebilirsin.
         </div>`
      : "";

    const tallyHtml =
      this.lastVoteReveal.length > 0
        ? `<div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--gold-soft);">
             <div style="font-size:0.75rem; color:var(--gold); font-weight:bold; margin-bottom:6px;">
               🗳️ AÇILAN MÜHÜRLÜ OYLAR (KİM KİME OY VERDİ?):
             </div>
             <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:6px;">
               ${this.lastVoteReveal
                 .map(
                   (v) => `
                 <span style="background:rgba(24,18,36,0.92); border:1px solid var(--gold-soft); border-radius:8px; padding:4px 8px; font-size:0.74rem;">
                   <strong>#${v.voterSeat} ${v.voterNick}</strong> ➔ 🔥 #${v.targetSeat} ${v.targetNick}
                 </span>
               `
                 )
                 .join("")}
             </div>
           </div>`
        : "";

    panel.innerHTML = `
      <div style="text-align:center; padding:14px;">
        ${personalBanner}
        <h2 style="font-size:1.35rem; color:${isRed ? "#ff3b4e" : isWhite ? "#a8d8ff" : "#d4af37"};">
          ${
            isRed
              ? "🔥 ŞÖMİNE KAN KIRMIZISI PARLADI! (HAİN YAKALANDI)"
              : isWhite
              ? "❄️ ŞÖMİNE BEYAZ ALEVLE YANDI! (MASUM MİSAFİR ELENDİ)"
              : "⚖️ OYLAR EŞİT ÇIKTI — ŞÖMİNEYE ZARF ATILMADI"
          }
        </h2>
        <p style="margin-top:8px; font-size:0.95rem;">${state.announcement}</p>
        ${tallyHtml}
      </div>
    `;
  }

  private renderNightPanel(panel: HTMLElement, state: any): void {
    const isHain = this.myRole?.role === "HAIN";
    const me = state.players?.get(this.room?.sessionId);
    const alivePlayers = Array.from(state.players?.values() || []).filter((p: any) => p.alive);

    if (!isHain || !me?.alive || me?.ghost) {
      panel.innerHTML = `
        <div style="text-align:center; padding:14px;">
          <div style="font-size:0.76rem; letter-spacing:1.6px; color:#ff6b7a; font-weight:bold;">
            ⏳ 2 DAKİKA GECE MOLASI — GİZLİ İNFAZ KONSEYİ TOPLANIYOR
          </div>
          <h2 style="color:var(--gold); font-size:1.25rem; margin:6px 0;">
            🌑 ŞATODA MOLA: HAİNLER TOPLANTI YAPIYOR!
          </h2>
          <p style="color:var(--text-muted); font-size:0.86rem; max-width:580px; margin:0 auto 12px; line-height:1.45;">
            Yatak odalarının kapıları kilitlendi. Hainler şu an gizli kulede buluşup bu gecenin <strong>İNFAZ KARARINI</strong> tartışıyor! Hainler mührü bastığında sabah çanı çalacak.
          </p>

          ${
            me?.alive && !me?.ghost
              ? `<div style="margin-bottom:10px;">
                  ${
                    this.nightWatchNote
                      ? `<div style="background:rgba(212,175,55,0.14); border:1px solid var(--gold); border-radius:10px; padding:9px 12px; font-size:0.84rem; color:var(--parchment);">
                          ${this.nightWatchNote}
                        </div>`
                      : `<button class="btn btn-crimson" id="btn-night-watch" style="padding:9px 16px;">
                          🕯️ Kapı Deliğinden Koridoru Dinle (+10🪙 & İpucu)
                        </button>`
                  }
                </div>`
              : ""
          }

          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            <button class="btn" id="btn-night-open-hb-guest" style="padding:7px 14px; border-color:#ffd166; color:#ffe9a8;">
              📖 El Kitapçığı & İpuçlarım (${this.clueJournal.length})
            </button>
            <button class="btn" id="btn-night-inspect-bonds" style="padding:7px 14px;">
              🔍 Mola Sırasında Oyuncuların Yakınlık Barlarını İncele
            </button>
          </div>
        </div>
      `;

      document.getElementById("btn-night-open-hb-guest")?.addEventListener("click", () => {
        this.openHandbookModal("book");
      });
      document.getElementById("btn-night-watch")?.addEventListener("click", () => {
        this.room?.send("night_watch");
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
      .map((pk) => `#${pk.traitorSeat} ${pk.traitorNick} ➔ 🩸 #${pk.targetSeat} ${pk.targetNick}`)
      .join(" · ");
    const pickedVictim = this.selectedNightTargetId
      ? state.players?.get(this.selectedNightTargetId)
      : null;

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2 style="color:#ff4d5e; font-size:1.08rem;">🩸 HAİN GECE İNFAZ SEÇİM EKRANI — KİM ÖLECEK?</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            Misafirler "2 Dakika Mola" ekranında bekliyor. Bu gece şatodan kimi sileceğini seç ve İnfaz Mührünü bas!
          </span>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <button class="btn" id="btn-night-open-hb-hain" style="padding:7px 11px; font-size:0.74rem; border-color:#ffd166; color:#ffe9a8;">
            📖 El Kitapçığı (${this.clueJournal.length})
          </button>
          <button class="btn btn-crimson" id="btn-seal-execution" style="padding:8px 14px; font-weight:bold;">
            ${
              pickedVictim
                ? `🩸 #${pickedVictim.seat} ${pickedVictim.nick} İNFAZINI ONAYLA!`
                : "🩸 Önce Kurban Seç"
            }
          </button>
        </div>
      </div>

      ${
        pickedVictim
          ? `<div style="margin-bottom:8px; padding:9px 12px; border-radius:10px; background:rgba(40,120,75,0.3); border:2px solid #6ef2b1; font-size:0.86rem; color:#d8ffeb;">
               🎯 <strong>SEÇİLEN İNFAZ KURBANI:</strong> Koltuk #${pickedVictim.seat} (${pickedVictim.nick})! Hazırsan sağ üstteki veya karttaki <strong>🗡️ İNFAZ ET</strong> butonuna bas!
             </div>`
          : `<div style="margin-bottom:8px; padding:10px 14px; border-radius:10px; background:rgba(178,22,30,0.36); border:2px solid #ff5768; font-size:0.9rem; color:#ffe5e8; font-weight:bold;">
               🗡️ SEN HAİNSİN! Bu gece infaz edilecek masum Misafiri aşağıdan seç ("🗡️ HEMEN İNFAZ ET" ile tek tıkta infaz edebilirsin)!
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
              <div class="seat-card ${isPicked ? "active" : ""}" data-night-id="${p.id}" style="display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div class="seat-num">KURBAN ADAYI #${p.seat}</div>
                  <div class="seat-name">${p.nick}</div>
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
                  <button class="btn" data-night-pick-only="${p.id}" style="width:100%; padding:4px 6px; font-size:0.7rem;">
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
        this.room?.send("night_pick", { targetId, instantSeal: true });
        sfx.playCastleBell();
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

    panel.querySelectorAll("[data-night-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const targetId = (el as HTMLElement).dataset.nightId!;
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
      this.room?.send("seal_night_execution");
      sfx.playCastleBell();
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
        <h2 style="color:var(--gold); font-size:1.3rem;">🌅 ŞATODA SABAH OLDU — İNFAZ HÜKMÜ</h2>
        <p style="margin-top:8px; font-size:0.95rem;">${state.announcement}</p>
      </div>
    `;
  }

  private renderFinalPanel(panel: HTMLElement, state: any): void {
    const alive = Array.from(state.players?.values() || []).filter((p: any) => p.alive);

    panel.innerHTML = `
      <div class="panel-header">
        <h2>⚖️ FİNAL KARARI — SON ${alive.length} KİŞİ</h2>
      </div>
      <p style="margin-bottom:12px; font-size:0.9rem;">
        Birbirinize güvenip el mi sıkışacaksınız, yoksa son bir oylamaya mı gideceksiniz?
      </p>
      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button class="btn ${this.selectedFinalChoice === "TRUST" ? "btn-crimson" : ""}" id="btn-final-trust" style="padding:10px 14px;">
          🤝 HEPİMİZ MİSAFİRİZ
        </button>
        <button class="btn ${this.selectedFinalChoice === "DOUBT" ? "btn-crimson" : ""}" id="btn-final-doubt" style="padding:10px 14px;">
          🔥 ARAMIZDA HAİN VAR
        </button>
      </div>
    `;

    document.getElementById("btn-final-trust")?.addEventListener("click", () => {
      this.selectedFinalChoice = "TRUST";
      this.room?.send("final_decision", { decision: "TRUST" });
      this.lastCenterRenderHash = "";
    });
    document.getElementById("btn-final-doubt")?.addEventListener("click", () => {
      this.selectedFinalChoice = "DOUBT";
      this.room?.send("final_decision", { decision: "DOUBT" });
      this.lastCenterRenderHash = "";
    });
  }

  private renderResultPanel(panel: HTMLElement, state: any): void {
    const guestsWon = state.winnerTeam === "MISAFIR";
    const rolesList: Array<{ id?: string; seat: number; nick: string; role: string; alive: boolean }> =
      this.gameOverSummary?.roles || [];
    const chronicle: string[] = this.gameOverSummary?.chronicle || [];
    const myId = this.room?.sessionId;
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
                 <strong style="color:var(--gold);">📌 Maçın Bitme Sebebi:</strong> ${state.winReason}
               </div>`
            : `<p style="font-size:0.88rem; margin-bottom:10px;">${state.announcement}</p>`
        }

        ${
          meState
            ? `<div style="font-size:0.8rem; margin-bottom:10px; color:${iWon ? "#8ce99a" : "#ffa8a8"};">
                 Senin Rolün: <strong>${myRoleStr}</strong> · Durumun: <strong>${
                meState.alive ? "Hayatta Kaldın" : "Şöminede / Gece İnfazında Elendin"
              }</strong> · Sonuç: <strong>${iWon ? "🏆 TAKIMIN KAZANDI!" : "💔 KAYBETTİN"}</strong>
               </div>`
            : ""
        }

        ${
          rolesList.length > 0
            ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:6px; text-align:left; margin-bottom:10px;">
                ${rolesList
                  .sort((a, b) => a.seat - b.seat)
                  .map(
                    (r) => `
                  <div style="padding:6px 8px; border-radius:8px; background:rgba(24,18,36,0.9); border:1px solid ${
                    r.role === "HAIN" ? "#ff4d5e" : "rgba(122,184,255,0.4)"
                  }; font-size:0.75rem;">
                    <strong>#${r.seat} ${r.nick}</strong><br/>
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
                ${chronicle.map((c) => `<div style="margin-top:3px;">• ${c}</div>`).join("")}
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
          <button class="btn btn-crimson" id="btn-back-lobby">🔄 Yeni Oyun (Lobi)</button>
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
  }

  private openStoryReaderModal(state: any): void {
    sfx.playSealBreak();
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
        ? traitors.map((t) => `#${t.seat} ${t.nick}`).join(" ve ")
        : "meçhul bir gölge";
    const survivorNames =
      survivors.length > 0
        ? survivors.map((s) => `#${s.seat} ${s.nick}`).join(", ")
        : "kimse";
    const fallenNames =
      fallen.length > 0
        ? fallen.map((f) => `#${f.seat} ${f.nick}`).join(", ")
        : "";

    const myId = this.room?.sessionId;
    const meState = myId ? state.players?.get(myId) : null;
    const myRoleLabel =
      this.myRole?.role === "HAIN" ? "pelerininin altında hançer gizleyen bir HAİN" : "gerçeğin peşindeki masum bir MİSAFİR";

    const bondParagraph =
      topBond && topBond.score >= 15
        ? `Koridorlarda mum ışıkları titrerken en derin fısıltı bağı <strong>#${topBond.seatA} ${topBond.nickA}</strong> ile <strong>#${topBond.seatB} ${topBond.nickB}</strong> arasında kuruldu (<em>%${topBond.score} yakınlık</em>). Bakışlar bu ikilinin üzerinde toplandı.`
        : `Fırtına pencereleri döverken davetliler koridorlarda temkinli adımlarla yürüdü; kimse sırrını kolay kolay açık etmedi.`;

    const eventsHtml =
      chronicle.length > 0
        ? chronicle
            .map(
              (item) => `
              <div style="padding:6px 9px; border-left:2px solid var(--gold); background:rgba(255,255,255,0.04); border-radius:0 6px 6px 0; font-size:0.8rem; line-height:1.45;">
                ${item}
              </div>
            `
            )
            .join("")
        : `<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">
            İlk oylamayla birlikte maskeler erkenden düştü ve şöminenin hükmü gecenin kaderini mühürledi.
          </div>`;

    const endingProse = guestsWon
      ? `Şafak sökerken şöminenin kızıl külleri soğudu. <strong>${
          state.winReason || "Tüm Hainlerin maskesi düşürüldü ve şatoda hiçbir Hain kalmadı."
        }</strong> Geride kalan davetliler (${survivorNames}) Kargalı Şato'nun ağır kapılarını aralayıp fırtınadan sağ kurtuldu.`
      : `Gece yarısı çanları son kez çaldığında şatonun şamdanları kan kırmızısına büründü. <strong>${
          state.winReason || "Hainler sayıca üstünlüğü ele geçirip Yuvarlak Sofraya hâkim oldu."
        }</strong> Kargalı Şato'nun koridorları artık gölgelerin elindeydi.`;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--gold-soft); padding-bottom:8px;">
        <div>
          <div style="font-size:0.7rem; letter-spacing:1.8px; color:var(--gold);">◆ KARGALI ŞATO VAKAYİNAMESİ ◆</div>
          <h3 style="font-size:1.08rem; color:var(--parchment); margin-top:2px;">
            📖 Bu Gecenin Hikâyesi (${state.roomTitle || "Yuvarlak Sofra"} · ${state.round || 1} Gün)
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
        ? ` Sen bu gecede <strong>#${meState.seat} ${meState.nick}</strong> koltuğunda ${myRoleLabel} olarak yerini aldın.`
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
        <button class="btn btn-crimson" id="btn-story-back-lobby">🔄 Yeni Oyun (Lobi)</button>
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
    if (this.camTurnDir !== 0) {
      this.scene.cameraYaw += this.camTurnDir * 2.1 * dt;
    }
    if (this.pcEdgePanDir !== 0 && state.phase === "DAY" && !document.pointerLockElement) {
      this.scene.cameraYaw += this.pcEdgePanDir * 1.75 * dt;
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
      : resolveCastleCollision(desiredX, desiredZ, this.getOpenDoorsMap(state), 0.42, {
          seat: me?.seat,
          currentRoomId: me?.roomId || detectRoomZone(this.localX, this.localZ).id,
          lockedDoors: this.getLockedDoorsMap(state),
          hasKahyaKey: Boolean(me?.hasKahyaKey)
        });

    this.localX = resolved.x;
    this.localZ = resolved.z;
    this.localRotY = Math.atan2(vx, vz);

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

    const state: any = this.room?.state;
    if (state && this.room) {
      this.scene.setActivePhase(state.phase);
      if (state.phase !== this.lastPhase) {
        this.readyStatusText = "";
        this.pcEdgePanDir = 0;
        this.announcementChangedAt = now;
        if (state.phase === "DAY") {
          this.dayPhaseEnteredAt = now;
          document.getElementById("pc-mouse-hint")?.classList.remove("hint-faded");
        }
        if (state.phase !== "DAY" && document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        const readyBtn = document.getElementById("btn-ready-phase");
        if (readyBtn) readyBtn.textContent = "⏩ Hazırım";
        const pCard = document.getElementById("puzzle-card-content");
        if (pCard) pCard.style.width = "";
        document.getElementById("puzzle-modal")?.classList.add("hidden");
        document.getElementById("dm-picker-modal")?.classList.add("hidden");

        // ÇOK ÖNEMLİ: Evre her değiştiğinde açık kalan 360° İncele kartını kapat ki Oylama / Gece İnfazı seçim ekranı ASLA gizli kalmasın!
        if (this.scene.inspectTargetId) {
          this.scene.inspectTargetId = null;
          document.getElementById("inspect-overlay")?.classList.add("hidden");
        }

        // Oylama, Gece İnfazı ve Final seçim ekranlarına girerken soldaki PM pencerelerini küçült ki seçim ekranı tam odakta açılsın!
        if (state.phase === "VOTE" || state.phase === "NIGHT" || state.phase === "FINAL") {
          this.pmThreads.forEach((t) => {
            t.minimized = true;
          });
          this.renderPMWindows();
        }

        if (state.phase === "ARRIVAL" || state.phase === "RESULT") {
          this.closeHandbookModal();
        }

        if (state.phase === "TRIAL") {
          sfx.playSealBreak();
          this.room.send("request_my_state");
        } else if (state.phase === "TABLE") {
          sfx.playCastleBell();
          this.selectedVoteTargetId = "";
          this.lastVoteReveal = [];
        } else if (state.phase === "VOTE") {
          this.selectedVoteTargetId = "";
          sfx.playCastleBell();
        } else if (state.phase === "FIRE") {
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
          this.selectedNightTargetId = "";
          if (this.myRole?.role === "HAIN" && this.preTargetSeat > 0) {
            const mateIds = new Set((this.myRole?.traitorMates || []).map((m) => m.id));
            mateIds.add(this.room.sessionId);
            state.players?.forEach((cand: any, cid: string) => {
              if (cand.seat === this.preTargetSeat && cand.alive && !mateIds.has(cid)) {
                this.selectedNightTargetId = cid;
              }
            });
          }
          this.traitorNightPicks.clear();
          this.nightConclaveLogs = [];
          this.nightWatchNote = "";
          this.room.send("request_my_state");
          sfx.playHeartbeat();
        } else if (state.phase === "LOBBY") {
          this.gameOverSummary = null;
          this.resetHandbookForNewMatch();
        }
        this.lastPhase = state.phase;
        this.lastCenterRenderHash = "";
      }

      if (state.councilBoardNote && state.councilBoardNote !== this.lastRecordedBoardNote) {
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
      document.body.classList.toggle("in-day-mode", isDay);
      document.getElementById("day-action-hud")?.classList.toggle("day-active", isDay);
      if (isDay) {
        this.renderDayExtraActions(state);
      }

      const canEarlyReady =
        state.phase === "DAY" || state.phase === "TRIAL" || state.phase === "TABLE";
      document.getElementById("btn-ready-phase")?.classList.toggle("hidden", !canEarlyReady);

      const titleEl = document.getElementById("room-title-label");
      if (titleEl) titleEl.textContent = state.roomTitle || "SOFRA";
      const codeEl = document.getElementById("room-code-label");
      if (codeEl) {
        const pBadge = resolveDurationPreset(state.paceMode, state.fastMode).badge;
        codeEl.textContent = `Kod: ${state.code || "---"} · ${pBadge}`;
      }

      const phaseTitleEl = document.getElementById("phase-title");
      if (phaseTitleEl) {
        const phaseMap: Record<string, string> = {
          LOBBY: "LOBİ — KARAKTER & SÜRE",
          ARRIVAL: "GİRİŞ — GİZLİ ZARFLAR",
          DAY: `GÜN ${state.round} — ŞATO KEŞFİ`,
          TRIAL: `GÜN ${state.round} — BULMACA SINAVI`,
          TABLE: `GÜN ${state.round} — SOFRA TARTIŞMASI`,
          VOTE: `GÜN ${state.round} — ŞÖMİNE OYLAMASI`,
          FIRE: `GÜN ${state.round} — ŞÖMİNE ALEVİ`,
          NIGHT: `GECE ${state.round} — HAİNLER TOPLANTISI`,
          MORNING: `SABAH ${state.round + 1} — İNFAZ HÜKMÜ`,
          FINAL: "SON 4 KİŞİ — FİNAL KARARI",
          RESULT: "OYUN SONUCU"
        };
        phaseTitleEl.textContent = phaseMap[state.phase] || state.phase;
      }

      const timerEl = document.getElementById("phase-timer");
      if (timerEl) {
        const remSec = Math.max(0, Math.ceil(((state.phaseEndsAt || 0) - Date.now()) / 1000));
        const tText =
          state.phase === "LOBBY" && (!state.autoStart || remSec <= 0)
            ? "Hazır"
            : `⏳ ${remSec} sn`;
        timerEl.textContent = tText;
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

      const me = state.players?.get(this.room.sessionId);
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
          hasGoldNecklace: state.necklaceHolder === sid,
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
      // Kayıt / Ana Menüde "🔍 Karakterimi 360° İncele" açıkken önizleme karakterini çiz!
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
              z: 6.2,
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
        this.scene.updateCamera(0, 6.2, dt);
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
