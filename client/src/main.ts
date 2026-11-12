import { Client, Room } from "colyseus.js";
import {
  CHARACTERS,
  COUNCIL_BOARD_POS,
  DOORS,
  PUZZLE_ALTARS,
  SOFRA_CONFIG,
  detectRoomZone,
  normalizeRoomCode,
  resolveCastleCollision
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

const DEFAULT_UNLOCKED = ["none", "fedora", "hood", "bun", "glasses", "beard"];

const COAT_PALETTE = [
  "#5c1a24", // Şato Bordosu
  "#1e293b", // Gece Laciverti
  "#1b4332", // Zümrüt Yeşili
  "#3b1d54", // Asil Mor
  "#4a2c18", // Koyu Kehribar
  "#18181b", // Kuzgun Siyahı
  "#7f1d1d", // Kan Kırmızısı
  "#0f4c5c"  // Okyanus Derini
];

function createGuestToken(): string {
  return `gst_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

class SofraGameApp {
  private scene: CastleScene;
  private client: Client;
  private apiBase: string;
  private room: Room | null = null;

  private vault: VaultData;
  private authTabMode: "guest" | "register" | "login" = "guest";
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
  } | null = null;

  // Menu idle rotation, PC zero-click mouse edge pan & FPS
  private pcEdgePanDir = 0;
  private menuOrbitAngle = 0;
  private frameCount = 0;
  private fpsAccum = 0;
  private lastFrameTime = performance.now();

  constructor() {
    const container = document.getElementById("canvas-container")!;
    this.scene = new CastleScene(container);

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

    document.getElementById("btn-create-room")?.addEventListener("click", () => {
      this.syncGuestNameFromInput();
      const title = (document.getElementById("input-create-title") as HTMLInputElement).value.trim();
      const pass = (document.getElementById("input-create-pass") as HTMLInputElement).value.trim();
      this.joinRoomFlow("create", { roomTitle: title, roomPassword: pass });
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
        .map(
          (r) => `
        <div class="room-row">
          <div>
            <div style="font-weight:bold; font-size:0.86rem; color:var(--gold);">
              ${r.hasPassword ? "🔒" : "🔓"} ${r.roomTitle}
              <span style="font-size:0.72rem; color:var(--text-muted);">(${r.code})</span>
            </div>
            <div style="font-size:0.72rem; color:var(--text-muted);">
              Kurucu: ${r.hostNick} · Oyuncu: ${r.playerCount}/${r.maxClients} · ${
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
      `
        )
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
    extra?: { roomId?: string; roomTitle?: string; roomPassword?: string }
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
        roomPassword: extra?.roomPassword || ""
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
          thread = {
            peerId,
            peerNick,
            peerSeat,
            minimized: false,
            unread: false,
            messages: []
          };
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
        this.scene.triggerFireplaceFlame(isRed ? "red" : "white");
        sfx.playFireWhoosh(isRed);
        this.showFarewellToast(data);
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
    });

    // 📜 KİŞİSEL GİZLİ GÖREVLER ("Bunla Yakınlaş, Bunla Konuş" + Şato Görevleri)
    room.onMessage("quests_update", (data: { round: number; quests: any[] }) => {
      this.myQuests = data.quests || [];
      this.renderDayQuests();
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
      this.lastCenterRenderHash = "";
    });

    // 💀 SABAH GECE İNFAZI SAHNESİ
    room.onMessage(
      "night_execution_event",
      (ev: { protectedByNecklace: boolean; victimId: string; victimSeat: number; victimNick: string }) => {
        sfx.playCastleBell();
        if (ev.protectedByNecklace) {
          this.showExecutionToast(
            "📿 ALTIN KOLYE İNFAZI DURDURDU!",
            "Gece Hainler Meclisi infaz mührünü bastı ancak Altın Kolye parlayarak sahibini ölümden kurtardı!",
            false
          );
        } else if (ev.victimId) {
          const isMe = ev.victimId === this.room?.sessionId;
          this.showExecutionToast(
            isMe ? "💀 HAİNLER TOPLANTISINDA İNFAZ EDİLDİN!" : `🩸 GECE İNFAZI: KOLTUK #${ev.victimSeat}`,
            isMe
              ? "Gece Hainler Meclisi senin için infaz kararı verdi! Porselen tabağın ters çevrildi; artık Hayalet olarak şatoda süzülüp oyun sonunu izleyebilirsin."
              : `Hainler gece toplantısında Koltuk #${ev.victimSeat} (${ev.victimNick}) için İNFAZ mührü bastı!`,
            true
          );
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
      this.showExecutionToast("📜 CEBİNE İSİMSİZ BİR NOT BIRAKILDI!", `"${d.text}"`, true);
    });

    // 🔔 KÂHYA ZİLİ GİZLİ TAKIM YANITI
    room.onMessage("kahya_answer", (d: { sameTeam: boolean; text: string }) => {
      sfx.playGoldChime();
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
          t.minimized = !t.minimized;
          if (!t.minimized) t.unread = false;
          this.renderPMWindows();
        }
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
    document.getElementById("btn-toggle-chat-min")?.addEventListener("click", (e) => {
      bottomChat.classList.toggle("minimized");
      (e.currentTarget as HTMLElement).textContent = bottomChat.classList.contains("minimized") ? "▴" : "▾";
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
      if (k === "enter" && this.room) {
        e.preventDefault();
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
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
          ".interactive, .ko-pm-window, .day-quest-box, .lol-wheel-cluster, .left-control-cluster, #puzzle-modal, #dm-picker-modal, #inspect-overlay"
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
        <button class="btn btn-crimson" id="btn-close-inspect" style="padding:4px 10px;">✕ Kapat</button>
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
    titleEl.textContent = `📜 GİZLİ GÖREVLERİM (${doneCount}/${this.myQuests.length})`;

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

  private renderDayExtraActions(state: any): void {
    const box = document.getElementById("day-extra-actions");
    if (!box || !this.room) return;
    const me = state.players?.get(this.room.sessionId);
    const isHain = this.myRole?.role === "HAIN";
    const isGhost = !me?.alive || Boolean(me?.ghost);
    const canAskKahya = !isGhost && (state.pot || 0) >= 50;

    const key = `${state.round}|${isHain}|${isGhost}|${canAskKahya}|${state.pot || 0}`;
    if (key === this.lastDayExtraKey) return;
    this.lastDayExtraKey = key;

    const btns: string[] = [];
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

  private handleContextWheelClick(): void {
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
    }
    this.scene.cycleBrightnessBoost();
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
    const hash = `${phase}|${state.round}|${state.fastMode}|${state.autoStart}|${state.pot}|${state.lastBurnedId}|${state.lastBurnedFlame}|${state.winReason}|${this.lastVoteReveal.length}|${this.mobileLobbyTab}|${this.vault.gold}|${this.vault.selectedSeat}|${this.vault.coatColor}|${this.vault.hat}|${this.vault.mask}|${this.selectedVoteTargetId}|${this.selectedNightTargetId}|${this.selectedFinalChoice}|${trialKey}|${picksKey}|${this.nightConclaveLogs.length}|${this.nightWatchNote}|${Boolean(this.gameOverSummary)}|${playerSummary}`;

    if (hash === this.lastCenterRenderHash) return;
    this.lastCenterRenderHash = hash;

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
    } else if (phase === "TABLE" || phase === "VOTE") {
      this.renderTableVotePanel(panel, state);
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

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>🕯️ ${state.hasPassword ? "🔒" : "🔓"} ${state.roomTitle || "SOFRA LOBİSİ"} (${playerCount}/12)</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            Arkadaşlarını davet et — Oda Kodu: <strong style="color:var(--gold);">${state.code}</strong>
          </span>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn" id="btn-lobby-inspect-self">🔍 360° Karakterimi İncele</button>
          <button class="btn" id="btn-share-room">🔗 Davet Kopyala</button>
          ${
            isHost
              ? `
            <button class="btn" id="btn-add-bots">🤖 Bot Doldur</button>
            <button class="btn" id="btn-auto-start">⏱️ Oto: ${state.autoStart ? "AÇIK" : "KAPALI"}</button>
            <button class="btn" id="btn-fast-mode">⚡ Hızlı: ${state.fastMode ? "AÇIK" : "KAPALI"}</button>
            <button class="btn btn-crimson" id="btn-start-game">🔥 SOFRAYI BAŞLAT</button>
          `
              : `<span style="font-size:0.8rem; color:var(--gold);">Kurucunun başlatması bekleniyor...</span>`
          }
        </div>
      </div>

      <div class="mobile-lobby-tabs">
        <button class="btn ${this.mobileLobbyTab === "seats" ? "btn-crimson" : ""}" id="tab-btn-seats">
          🎭 Dizi Karakterleri
        </button>
        <button class="btn ${this.mobileLobbyTab === "custom" ? "btn-crimson" : ""}" id="tab-btn-custom">
          🎨 Kendi Karakterin & Kasa
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
          <h3 style="color:var(--gold); font-size:0.92rem;">🎨 Kendi Karakterini Yarat & Kasa</h3>
          <div class="field-row">
            <label>Görünecek Oyuncu Adın:</label>
            <input type="text" id="input-custom-name" maxlength="18" value="${this.vault.customName}" placeholder="Örn: Kont Cenker..." />
          </div>
          <div class="field-row">
            <label>Pelerin / Ceket Rengi:</label>
            <div class="color-swatches">
              ${COAT_PALETTE.map(
                (col) => `
                <div class="swatch ${this.vault.coatColor === col ? "active" : ""}" style="background:${col}" data-color="${col}"></div>
              `
              ).join("")}
            </div>
          </div>
          <div class="field-row">
            <label>Başlık / Taç (Kasa):</label>
            <select id="select-hat">
              <option value="none" ${this.vault.hat === "none" ? "selected" : ""}>Başlık Yok</option>
              <option value="fedora" ${this.vault.hat === "fedora" ? "selected" : ""}>Dedektif Şapkası (Ücretsiz)</option>
              <option value="hood" ${this.vault.hat === "hood" ? "selected" : ""}>Gizemli Kapüşon (Ücretsiz)</option>
              <option value="bun" ${this.vault.hat === "bun" ? "selected" : ""}>Aristokrat Topuz (Ücretsiz)</option>
              <option value="crown" ${this.vault.hat === "crown" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("crown") ? "👑 Altın Şato Tacı (Açık)" : "🔒 Altın Şato Tacı (50 🪙)"}
              </option>
            </select>
          </div>
          <div class="field-row">
            <label>Maske & Aksesuar (Kasa):</label>
            <select id="select-mask">
              <option value="none" ${this.vault.mask === "none" ? "selected" : ""}>Maske Yok</option>
              <option value="glasses" ${this.vault.mask === "glasses" ? "selected" : ""}>Altın Gözlük (Ücretsiz)</option>
              <option value="beard" ${this.vault.mask === "beard" ? "selected" : ""}>Bilge Sakalı (Ücretsiz)</option>
              <option value="domino" ${this.vault.mask === "domino" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("domino") ? "🎭 Balo Maskesi (Açık)" : "🔒 Balo Maskesi (50 🪙)"}
              </option>
              <option value="plague" ${this.vault.mask === "plague" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("plague") ? "🦅 Veba Maskesi (Açık)" : "🔒 Veba Maskesi (50 🪙)"}
              </option>
            </select>
          </div>
          <button class="btn btn-crimson" id="btn-apply-custom" style="padding:10px;">
            ✨ Görünümü Kaydet & Uygula
          </button>
        </div>
      </div>
    `;

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
      if ((chosenMask === "domino" || chosenMask === "plague") && !tryUnlockCosmetic(chosenMask)) return;
      this.vault.hat = chosenHat;
      this.vault.mask = chosenMask;
      this.saveVault();
      this.sendCustomizeToServer();
      this.lastCenterRenderHash = "";
    });

    document.getElementById("btn-add-bots")?.addEventListener("click", () => {
      this.room?.send("add_bots", { count: 9 });
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
            ? `<div style="background:rgba(155,18,32,0.25); border:1px solid #ff4d5e; border-radius:10px; padding:8px 12px; display:inline-block; font-size:0.85rem;">
                <strong>Suç Ortakların:</strong> ${fellows.map((f) => `#${f.seat} ${f.nick}`).join(", ")}
              </div>`
            : ""
        }
      </div>
    `;
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

          <button class="btn" id="btn-night-inspect-bonds" style="padding:7px 14px;">
            🔍 Mola Sırasında Oyuncuların Yakınlık Barlarını İncele
          </button>
        </div>
      `;

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

    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2 style="color:#ff4d5e;">🗡️ HAİNLER MECLİSİ — GİZLİ İNFAZ TOPLANTISI (2 DK)</h2>
          <span style="font-size:0.75rem; color:var(--text-muted);">
            Misafirler "2 Dakika Mola: Hainler Toplantı Yapıyor" ekranında bekliyor. Ortağınla konuş, hedefi seç ve İnfaz Mührünü bas!
          </span>
        </div>
        <button class="btn btn-crimson" id="btn-seal-execution" style="padding:8px 12px;">
          🩸 İNFAZ KARARINI MÜHÜRLE
        </button>
      </div>

      ${
        livePicksSummary
          ? `<div style="margin-bottom:8px; padding:6px 10px; border-radius:8px; background:rgba(165,20,35,0.28); border:1px solid #ff5768; font-size:0.8rem; color:#ffd6da;">
              <strong>Canlı İnfaz Oyları:</strong> ${livePicksSummary}
            </div>`
          : ""
      }

      <div class="seat-grid" style="margin-bottom:10px;">
        ${innocentTargets
          .map(
            (p: any) => `
          <div class="seat-card ${this.selectedNightTargetId === p.id ? "active" : ""}" data-night-id="${p.id}">
            <div class="seat-num">KURBAN ADAYI #${p.seat}</div>
            <div class="seat-name">${p.nick}</div>
            <div class="seat-title">${
              state.necklaceHolder === p.id ? "⚠️ 📿 Altın Kolye (Korumalı!)" : "🩸 İnfaz Hedefi Seç"
            }</div>
          </div>
        `
          )
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

    panel.querySelectorAll("[data-night-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const targetId = (el as HTMLElement).dataset.nightId!;
        this.selectedNightTargetId = targetId;
        this.room?.send("night_pick", { targetId });
        sfx.playHeartbeat();
        this.lastCenterRenderHash = "";
      });
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
          <button class="btn" id="btn-download-story">📸 9:16 Story İndir</button>
          <button class="btn btn-crimson" id="btn-back-lobby">🔄 Yeni Oyun (Lobi)</button>
        </div>
      </div>
    `;

    document.getElementById("btn-download-story")?.addEventListener("click", () => {
      this.downloadStoryCard(state);
    });
    document.getElementById("btn-back-lobby")?.addEventListener("click", () => {
      this.room?.send("back_to_lobby");
    });
  }

  private downloadStoryCard(state: any): void {
    const c = document.createElement("canvas");
    c.width = 1080;
    c.height = 1920;
    const ctx = c.getContext("2d")!;

    const grad = ctx.createLinearGradient(0, 0, 0, 1920);
    grad.addColorStop(0, "#120914");
    grad.addColorStop(0.5, "#260c16");
    grad.addColorStop(1, "#08060c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1920);

    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 8;
    ctx.strokeRect(48, 48, 984, 1824);

    ctx.fillStyle = "#d4af37";
    ctx.font = "bold 64px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("SOFRA: KARGALI ŞATO", 540, 220);

    ctx.fillStyle = "#f4ebd9";
    ctx.font = "bold 82px Georgia, serif";
    ctx.fillText(
      state.winnerTeam === "MISAFIR" ? "MİSAFİRLER KAZANDI" : "HAİNLER KAZANDI",
      540,
      420
    );

    ctx.fillStyle = "#cfb891";
    ctx.font = "42px Georgia, serif";
    ctx.fillText(`Rolüm: ${this.myRole?.role === "HAIN" ? "HAİN" : "MİSAFİR"}`, 540, 560);
    ctx.fillText(`Tur Sayısı: ${state.round} · Hazine: ${state.pot} Altın`, 540, 640);

    const link = document.createElement("a");
    link.download = `sofra-hikaye-${Date.now()}.png`;
    link.href = c.toDataURL("image/png");
    link.click();
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
      if (state.phase !== this.lastPhase) {
        this.readyStatusText = "";
        this.pcEdgePanDir = 0;
        if (state.phase !== "DAY" && document.pointerLockElement) {
          document.exitPointerLock?.();
        }
        const readyBtn = document.getElementById("btn-ready-phase");
        if (readyBtn) readyBtn.textContent = "⏩ Hazırım";
        document.getElementById("puzzle-modal")?.classList.add("hidden");

        if (state.phase === "DAY" && this.scene.inspectTargetId) {
          this.scene.inspectTargetId = null;
          document.getElementById("inspect-overlay")?.classList.add("hidden");
        } else if (state.phase === "TRIAL") {
          sfx.playSealBreak();
        } else if (state.phase === "TABLE") {
          sfx.playCastleBell();
          this.selectedVoteTargetId = "";
          this.lastVoteReveal = [];
        } else if (state.phase === "FIRE") {
          if (state.lastBurnedFlame === "RED") {
            this.scene.triggerFireplaceFlame("red");
            sfx.playFireWhoosh(true);
          } else if (state.lastBurnedFlame === "WHITE") {
            this.scene.triggerFireplaceFlame("white");
            sfx.playFireWhoosh(false);
          }
        } else if (state.phase === "NIGHT") {
          this.selectedNightTargetId = "";
          this.traitorNightPicks.clear();
          this.nightConclaveLogs = [];
          this.nightWatchNote = "";
          sfx.playHeartbeat();
        } else if (state.phase === "LOBBY") {
          this.gameOverSummary = null;
        }
        this.lastPhase = state.phase;
        this.lastCenterRenderHash = "";
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
      if (codeEl) codeEl.textContent = `Kod: ${state.code || "---"}`;

      const phaseTitleEl = document.getElementById("phase-title");
      if (phaseTitleEl) {
        const phaseMap: Record<string, string> = {
          LOBBY: "LOBİ — KARAKTER & KASA",
          ARRIVAL: "GİRİŞ — GİZLİ ZARFLAR",
          DAY: `GÜN ${state.round} — ŞATO KEŞFİ & GÖREVLER`,
          TRIAL: `GÜN ${state.round} — 1 DK BULMACA SINAVI`,
          TABLE: `GÜN ${state.round} — YUVARLAK SOFRA TARTIŞMASI`,
          VOTE: `GÜN ${state.round} — ŞÖMİNE OYLAMASI`,
          FIRE: `GÜN ${state.round} — ŞÖMİNE ALEVİ`,
          NIGHT: `GECE ${state.round} — 2 DK HAİNLER TOPLANTISI`,
          MORNING: `SABAH ${state.round + 1} — İNFAZ HÜKMÜ`,
          FINAL: "SON 4 KİŞİ — FİNAL KARARI",
          RESULT: "OYUN SONUCU"
        };
        phaseTitleEl.textContent = phaseMap[state.phase] || state.phase;
      }

      const timerEl = document.getElementById("phase-timer");
      if (timerEl) {
        const remSec = Math.max(0, Math.ceil(((state.phaseEndsAt || 0) - Date.now()) / 1000));
        timerEl.textContent =
          state.phase === "LOBBY" && (!state.autoStart || remSec <= 0)
            ? "Hazır"
            : `⏳ ${remSec} sn`;
      }

      const annEl = document.getElementById("announcement-box");
      if (annEl && state.announcement) {
        annEl.textContent = `"${state.announcement}"`;
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

      // Bağlamsal Sağ Üst Çark Uydusu: Kürsü / Konsey Tahtası yakınına gelince parlar!
      const nearAltar =
        isDay && PUZZLE_ALTARS.some((a) => Math.hypot(this.localX - a.x, this.localZ - a.z) <= 4.3);
      const nearBoard =
        isDay &&
        Math.hypot(this.localX - COUNCIL_BOARD_POS.x, this.localZ - COUNCIL_BOARD_POS.z) <= 4.5;
      const ctxIcon = document.getElementById("wheel-context-icon");
      const ctxLabel = document.getElementById("wheel-context-label");
      if (ctxIcon && ctxLabel) {
        if (nearAltar) {
          ctxIcon.textContent = "🧩";
          ctxLabel.textContent = "KÜRSÜ";
        } else if (nearBoard) {
          ctxIcon.textContent = "📋";
          ctxLabel.textContent = "TAHTA";
        } else {
          ctxIcon.textContent = "💡";
          ctxLabel.textContent = "IŞIK";
        }
      }
      document
        .getElementById("btn-wheel-light")
        ?.classList.toggle("ready-glow", Boolean(nearAltar || nearBoard));

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
