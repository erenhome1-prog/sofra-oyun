import { Client, Room } from "colyseus.js";
import {
  CHARACTERS,
  DOORS,
  SOFRA_CONFIG,
  detectRoomZone,
  resolveCastleCollision
} from "@sofra/shared";
import { CastleScene, CharacterVisualState } from "./castleScene";
import { sfx } from "./sfx";

interface VaultData {
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

const DEFAULT_VAULT: VaultData = {
  welcomed: false,
  gold: 100,
  customName: "",
  selectedSeat: 1,
  coatColor: "#5c1a24",
  accentColor: "#d4af37",
  hat: "fedora",
  mask: "none",
  unlockedItems: ["none", "fedora", "hood", "bun", "glasses", "beard"]
};

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

class SofraGameApp {
  private scene: CastleScene;
  private client: Client;
  private room: Room | null = null;

  private vault: VaultData;
  private myRole: SecretRolePayload | null = null;
  private lastPhase = "";
  private lastCenterRenderHash = "";
  private mobileLobbyTab: "seats" | "custom" = "seats";
  private mobileChatOpen = false;

  // Local player movement & stamina
  private localX = 0;
  private localZ = 16;
  private localRotY = Math.PI;
  private stamina = 100;
  private staminaExhaustedUntil = 0;
  private keys = new Set<string>();
  private mobileSprintHeld = false;
  private joyX = 0;
  private joyY = 0;
  private netSyncAccum = 0;

  // Selections for phases
  private selectedVoteTargetId = "";
  private selectedNightTargetId = "";
  private selectedFinalChoice: "TRUST" | "DOUBT" | null = null;

  // FPS tracking
  private frameCount = 0;
  private fpsAccum = 0;
  private lastFrameTime = performance.now();

  constructor() {
    const container = document.getElementById("canvas-container")!;
    this.scene = new CastleScene(container);

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost = window.location.hostname || "localhost";
    const wsUrl = `${wsProtocol}//${wsHost}:${SOFRA_CONFIG.SERVER_PORT}`;
    this.client = new Client(wsUrl);

    this.vault = this.loadVault();
    this.setupWelcomeModal();
    this.setupHUDActions();
    this.setupInputHandlers();
    this.connectToServer();

    requestAnimationFrame((t) => this.animate(t));
  }

  private loadVault(): VaultData {
    try {
      const raw = localStorage.getItem("sofra_player_vault_v1");
      if (!raw) return { ...DEFAULT_VAULT };
      return { ...DEFAULT_VAULT, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_VAULT };
    }
  }

  private saveVault(): void {
    try {
      localStorage.setItem("sofra_player_vault_v1", JSON.stringify(this.vault));
    } catch {
      // ignore storage errors
    }
    const goldEl = document.getElementById("gold-balance-label");
    if (goldEl) {
      goldEl.textContent = `🪙 ${this.vault.gold}`;
    }
  }

  private setupWelcomeModal(): void {
    const modal = document.getElementById("welcome-modal")!;
    const closedView = document.getElementById("envelope-closed-view")!;
    const openView = document.getElementById("envelope-open-view")!;
    const btnBreakSeal = document.getElementById("btn-break-seal")!;
    const btnEnterCastle = document.getElementById("btn-enter-castle")!;
    const btnCloseX = document.getElementById("btn-close-envelope-x");
    const btnOpenRules = document.getElementById("btn-open-rules")!;

    this.saveVault();

    if (this.vault.welcomed) {
      modal.classList.add("hidden");
    }

    btnBreakSeal.addEventListener("click", () => {
      sfx.playSealBreak();
      closedView.classList.add("hidden");
      openView.classList.remove("hidden");
      if (!this.vault.welcomed) {
        this.vault.welcomed = true;
        this.vault.gold += 100;
        this.saveVault();
        sfx.playGoldChime();
      }
    });

    const closeEnvelope = () => {
      modal.classList.add("hidden");
      sfx.playDoorCreak(true);
    };

    btnEnterCastle.addEventListener("click", closeEnvelope);
    btnCloseX?.addEventListener("click", closeEnvelope);

    btnOpenRules.addEventListener("click", () => {
      closedView.classList.add("hidden");
      openView.classList.remove("hidden");
      modal.classList.remove("hidden");
    });
  }

  private setupHUDActions(): void {
    const btnWatchAd = document.getElementById("btn-watch-ad")!;
    btnWatchAd.addEventListener("click", () => {
      btnWatchAd.setAttribute("disabled", "true");
      let left = 3;
      btnWatchAd.textContent = `⏳ ${left}sn`;
      const timer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          btnWatchAd.textContent = `⏳ ${left}sn`;
        } else {
          clearInterval(timer);
          this.vault.gold += 50;
          this.saveVault();
          sfx.playGoldChime();
          btnWatchAd.removeAttribute("disabled");
          btnWatchAd.textContent = "🎬 +50🪙";
          this.lastCenterRenderHash = "";
        }
      }, 1000);
    });

    const btnDoor = document.getElementById("btn-door-interact")!;
    const btnMobileDoor = document.getElementById("btn-mobile-door")!;
    btnDoor.addEventListener("click", () => this.tryInteractNearestDoor());
    btnMobileDoor.addEventListener("click", () => this.tryInteractNearestDoor());

    // Mobile Sprint Hold Button
    const btnMobileSprint = document.getElementById("btn-mobile-sprint")!;
    const setSprint = (val: boolean) => {
      this.mobileSprintHeld = val;
      btnMobileSprint.classList.toggle("active-hold", val);
    };
    btnMobileSprint.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      setSprint(true);
    });
    btnMobileSprint.addEventListener("pointerup", () => setSprint(false));
    btnMobileSprint.addEventListener("pointercancel", () => setSprint(false));
    btnMobileSprint.addEventListener("pointerleave", () => setSprint(false));

    // Mobile Collapsible Chat Drawer
    const chatCluster = document.getElementById("chat-cluster")!;
    const btnMobileChatToggle = document.getElementById("btn-mobile-chat-toggle")!;
    const btnCloseMobileChat = document.getElementById("btn-close-mobile-chat")!;
    const unreadDot = document.getElementById("chat-unread-dot")!;

    const toggleMobileChat = (open?: boolean) => {
      this.mobileChatOpen = open !== undefined ? open : !this.mobileChatOpen;
      chatCluster.classList.toggle("mobile-open", this.mobileChatOpen);
      if (this.mobileChatOpen) {
        unreadDot.classList.add("hidden");
      }
    };

    btnMobileChatToggle.addEventListener("click", () => toggleMobileChat());
    btnCloseMobileChat.addEventListener("click", () => toggleMobileChat(false));

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

  private setupInputHandlers(): void {
    window.addEventListener("keydown", (e) => {
      if (document.activeElement?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
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

    // Multi-touch safe Camera Look on 3D Canvas (tracks specific pointerId)
    let lookPointerId: number | null = null;
    let lastLookX = 0;
    let lastLookY = 0;
    const canvas = this.scene.renderer.domElement;

    canvas.addEventListener("pointerdown", (e) => {
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
      this.scene.cameraYaw -= dx * 0.006;
      this.scene.cameraPitch = Math.max(0.15, Math.min(1.05, this.scene.cameraPitch + dy * 0.0045));
    });

    const releaseLookPointer = (e: PointerEvent) => {
      if (e.pointerId === lookPointerId) {
        lookPointerId = null;
      }
    };
    window.addEventListener("pointerup", releaseLookPointer);
    window.addEventListener("pointercancel", releaseLookPointer);

    // Multi-touch safe Virtual Joystick (tracks its own pointerId independently)
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
      if (e.pointerId === joyPointerId) {
        updateJoystick(e.clientX, e.clientY);
      }
    });

    const releaseJoyPointer = (e: PointerEvent) => {
      if (e.pointerId !== joyPointerId) return;
      joyPointerId = null;
      knob.style.transform = "translate(0px, 0px)";
      this.joyX = 0;
      this.joyY = 0;
    };
    window.addEventListener("pointerup", releaseJoyPointer);
    window.addEventListener("pointercancel", releaseJoyPointer);
  }

  private async connectToServer(): Promise<void> {
    try {
      const charDef =
        CHARACTERS.find((c) => c.seat === this.vault.selectedSeat) ?? CHARACTERS[0];
      const room = await this.client.joinOrCreate(SOFRA_CONFIG.ROOM_NAME, {
        nick: this.vault.customName || charDef.name,
        seat: this.vault.selectedSeat,
        coatColor: this.vault.coatColor,
        accentColor: this.vault.accentColor,
        hat: this.vault.hat,
        mask: this.vault.mask
      });

      this.room = room;

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

      room.onMessage("chat_msg", (msg: { senderId: string; senderNick: string; channel: string; text: string }) => {
        this.appendChatMessage(msg.senderNick, msg.channel, msg.text);
        this.scene.setCharacterChatBubble(msg.senderId, msg.text);
      });

      room.onMessage("door_sfx", (data: { doorId: string; open: boolean }) => {
        sfx.playDoorCreak(data.open);
      });

      room.onMessage("necklace_alert", (data: { text: string }) => {
        sfx.playGoldChime();
        this.appendChatMessage("KÂHYA", "KOLYE", data.text);
      });

      room.onStateChange((state: any) => {
        const me = state.players?.get(room.sessionId);
        if (me && state.phase !== "DAY") {
          this.localX = me.x;
          this.localZ = me.z;
          this.localRotY = me.rotY;
        }
      });
    } catch (err) {
      console.error("Sunucu bağlantı hatası:", err);
      const roomLabel = document.getElementById("room-code-label");
      if (roomLabel) roomLabel.textContent = "Sunucu bekleniyor...";
      setTimeout(() => this.connectToServer(), 2500);
    }
  }

  private appendChatMessage(sender: string, scope: string, text: string): void {
    const log = document.getElementById("chat-log")!;
    const item = document.createElement("div");
    item.innerHTML = `<span style="color:#d4af37;">[${scope}] ${sender}:</span> ${text}`;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;

    if (!this.mobileChatOpen && window.innerWidth <= 860) {
      document.getElementById("chat-unread-dot")?.classList.remove("hidden");
    }
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

  private renderCenterPanel(state: any): void {
    const panel = document.getElementById("center-panel")!;
    const phase: string = state.phase || "LOBBY";

    const playerSummary = Array.from(state.players?.values() || [])
      .map((p: any) => `${p.id}:${p.seat}:${p.nick}:${p.alive}:${p.coatColor}:${p.hat}:${p.mask}:${p.votedForId}`)
      .join("|");
    const hash = `${phase}|${state.round}|${state.fastMode}|${state.lastBurnedFlame}|${this.mobileLobbyTab}|${this.vault.gold}|${this.vault.selectedSeat}|${this.vault.coatColor}|${this.vault.hat}|${this.vault.mask}|${this.selectedVoteTargetId}|${this.selectedNightTargetId}|${this.selectedFinalChoice}|${playerSummary}`;

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
        <h2>🕯️ SOFRA LOBİSİ (${playerCount}/12 Oyuncu)</h2>
        <div style="display:flex; gap:6px; flex-wrap:wrap; width:100%; justify-content:flex-end;">
          ${
            isHost
              ? `
            <button class="btn" id="btn-add-bots" style="flex:1 1 auto;">🤖 Bot Doldur</button>
            <button class="btn" id="btn-fast-mode" style="flex:1 1 auto;">
              ⚡ Hızlı: ${state.fastMode ? "AÇIK" : "KAPALI"}
            </button>
            <button class="btn btn-crimson" id="btn-start-game" style="flex:1.5 1 auto;">
              🔥 SOFRAYI BAŞLAT
            </button>
          `
              : `<span style="font-size:0.8rem; color:var(--gold);">Kurucunun oyunu başlatması bekleniyor...</span>`
          }
        </div>
      </div>

      <!-- Mobil Sekme Geçişi (Telefonda tek ekrana sığdırır) -->
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
          <p style="font-size:0.78rem; color:var(--text-muted); margin-bottom:8px;">
            Sandalyeni ve Dizi Karakterini Seç (#11 Kâhya'nın Boş Tahtıdır):
          </p>
          <div class="seat-grid" id="lobby-seat-grid">
            ${selectableChars
              .map(
                (c) => `
              <div class="seat-card ${this.vault.selectedSeat === c.seat ? "active" : ""}" data-seat="${c.seat}">
                <div class="seat-num">SANDALYE #${c.seat}</div>
                <div class="seat-name">${c.name}</div>
                <div class="seat-title">${c.title}</div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>

        <div class="customizer-box studio-col-custom">
          <h3 style="color:var(--gold); font-size:0.94rem;">
            🎨 Kendi Karakterini Yarat & Kasa
          </h3>

          <div class="field-row">
            <label>Oyuncu Adın (İsteğe Bağlı):</label>
            <input type="text" id="input-custom-name" maxlength="18" value="${this.vault.customName}" placeholder="Örn: Kont Cenker..." />
          </div>

          <div class="field-row">
            <label>Pelerin / Ceket Rengi:</label>
            <div class="color-swatches" id="coat-swatches">
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

          <button class="btn btn-crimson" id="btn-apply-custom" style="margin-top:4px; padding:10px;">
            ✨ Görünümü Kaydet & Uygula
          </button>
        </div>
      </div>
    `;

    // Mobile tab switching
    document.getElementById("tab-btn-seats")?.addEventListener("click", () => {
      this.mobileLobbyTab = "seats";
      this.lastCenterRenderHash = "";
    });
    document.getElementById("tab-btn-custom")?.addEventListener("click", () => {
      this.mobileLobbyTab = "custom";
      this.lastCenterRenderHash = "";
    });

    // Bind seat cards
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

    // Bind coat color swatches
    panel.querySelectorAll(".swatch").forEach((el) => {
      el.addEventListener("click", () => {
        const col = (el as HTMLElement).dataset.color!;
        this.vault.coatColor = col;
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
        alert("Bu özel aksesuar için 50 Altın gerekiyor! Üstteki '🎬 +50🪙' düğmesine dokunarak hemen kazanabilirsin.");
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
      <div style="text-align:center; padding: 10px;">
        <p style="color:var(--gold); letter-spacing:1.5px; font-size:0.78rem;">◆ GİZLİ ROL ZARFINIZ AÇILDI ◆</p>
        <h2 style="font-size:1.45rem; margin:8px 0; color:${isHain ? "#ff4d5e" : "#7ab8ff"};">
          ${isHain ? "🗡️ ROLÜNÜZ: HAİN" : "🕯️ ROLÜNÜZ: MİSAFİR"}
        </h2>
        <p style="font-size:0.92rem; max-width:520px; margin:0 auto 12px; line-height:1.45;">
          ${
            isHain
              ? "Sofraya sızdın! Gündüz şüpheleri başkalarının üzerine çek, gece olduğunda hedefini seç."
              : "Şatonun sadık bir davetlisin! Gündüz odaları gez, şüphelileri gözlemle ve Sofrada Hainleri şömineye gönder."
          }
        </p>
        ${
          isHain && fellows.length > 0
            ? `<div style="background:rgba(155,18,32,0.25); border:1px solid #ff4d5e; border-radius:10px; padding:8px 12px; display:inline-block; font-size:0.86rem;">
                <strong>Suç Ortakların:</strong>
                ${fellows.map((f) => `#${f.seat} ${f.nick}`).join(", ")}
              </div>`
            : ""
        }
      </div>
    `;
  }

  private renderTableVotePanel(panel: HTMLElement, state: any): void {
    const players = Array.from(state.players?.values() || []).filter((p: any) => p.alive);
    const isVotePhase = state.phase === "VOTE";

    panel.innerHTML = `
      <div class="panel-header">
        <h2>🔔 YUVARLAK SOFRA — ${isVotePhase ? "OYLAMA" : "TARTIŞMA"}</h2>
        <span style="font-size:0.78rem; color:var(--gold);">
          #11 Kâhya İzliyor
        </span>
      </div>
      <p style="font-size:0.84rem; color:var(--text-muted); margin-bottom:10px;">
        ${
          isVotePhase
            ? "Zarfı şömineye atılacak şüpheliye dokunun (Kendinize oy veremezsiniz):"
            : "Gündüz kim hangi odadaydı? Tartışın; birazdan oylama başlayacak."
        }
      </p>
      <div class="seat-grid">
        ${players
          .map(
            (p: any) => `
          <div class="seat-card ${this.selectedVoteTargetId === p.id ? "active" : ""}" data-vote-id="${p.id}">
            <div class="seat-num">SANDALYE #${p.seat}</div>
            <div class="seat-name">${p.nick}</div>
            <div class="seat-title">${state.necklaceHolder === p.id ? "📿 Altın Kolye" : "Hayatta"}</div>
          </div>
        `
          )
          .join("")}
      </div>
    `;

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

    panel.innerHTML = `
      <div style="text-align:center; padding:14px;">
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
      </div>
    `;
  }

  private renderNightPanel(panel: HTMLElement, state: any): void {
    const isHain = this.myRole?.role === "HAIN";
    const targets = Array.from(state.players?.values() || []).filter((p: any) => p.alive);

    if (!isHain) {
      panel.innerHTML = `
        <div style="text-align:center; padding:18px;">
          <h2 style="color:var(--gold); font-size:1.25rem;">🌑 ŞATODA GECE ÇÖKTÜ</h2>
          <p style="margin-top:8px; color:var(--text-muted); font-size:0.9rem;">
            Kapılar kilitlendi, mumlar söndü... Hainler karanlıkta bir hedef seçiyor.
          </p>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="panel-header">
        <h2 style="color:#ff4d5e;">🗡️ GECE KONSEYİ — KURBAN SEÇİN</h2>
      </div>
      <div class="seat-grid">
        ${targets
          .map(
            (p: any) => `
          <div class="seat-card ${this.selectedNightTargetId === p.id ? "active" : ""}" data-night-id="${p.id}">
            <div class="seat-num">SANDALYE #${p.seat}</div>
            <div class="seat-name">${p.nick}</div>
            <div class="seat-title">Hedef Seç</div>
          </div>
        `
          )
          .join("")}
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
  }

  private renderMorningPanel(panel: HTMLElement, state: any): void {
    panel.innerHTML = `
      <div style="text-align:center; padding:14px;">
        <h2 style="color:var(--gold); font-size:1.3rem;">🌅 ŞATODA SABAH OLDU</h2>
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
        Sofrada kalan herkes ya birbirine güvenip el sıkışacak ya da son bir oylamaya gidecek:
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

    panel.innerHTML = `
      <div style="text-align:center; padding:14px;">
        <p style="color:var(--gold); letter-spacing:2px; font-size:0.78rem;">◆ OYUN SONA ERDİ ◆</p>
        <h2 style="font-size:1.5rem; margin:8px 0; color:${guestsWon ? "#7ab8ff" : "#ff4d5e"};">
          ${guestsWon ? "🕯️ MİSAFİRLER KAZANDI!" : "🗡️ HAİNLER SOFRAYI ELE GEÇİRDİ!"}
        </h2>
        <p style="font-size:0.92rem; margin-bottom:14px;">${state.announcement}</p>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          <button class="btn" id="btn-download-story">📸 9:16 Story İndir</button>
          <button class="btn btn-crimson" id="btn-back-lobby">🔄 Yeni Oyun</button>
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
    ctx.fillText(`Tur Sayısı: ${state.round}`, 540, 640);

    const link = document.createElement("a");
    link.download = `sofra-hikaye-${Date.now()}.png`;
    link.href = c.toDataURL("image/png");
    link.click();
  }

  private getOpenDoorsMap(state: any): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    state.doors?.forEach((d: any, id: string) => {
      out[id] = Boolean(d.open);
    });
    return out;
  }

  private updateLocalDayMovement(dt: number, state: any): void {
    if (!this.room || state.phase !== "DAY") return;

    let forward = 0;
    let strafe = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) forward += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) forward -= 1;
    if (this.keys.has("a")) strafe -= 1;
    if (this.keys.has("d")) strafe += 1;

    if (Math.abs(this.joyY) > 0.08 || Math.abs(this.joyX) > 0.08) {
      forward = -this.joyY;
      strafe = this.joyX;
    }

    const now = performance.now();
    const wantsSprint =
      (this.keys.has("shift") || this.mobileSprintHeld) && now > this.staminaExhaustedUntil;
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

    const staminaBar = document.getElementById("stamina-bar");
    if (staminaBar) {
      staminaBar.style.width = `${this.stamina}%`;
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

    const resolved = resolveCastleCollision(
      desiredX,
      desiredZ,
      this.getOpenDoorsMap(state)
    );

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

    // FPS Counter
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
    if (state) {
      if (state.phase !== this.lastPhase) {
        if (state.phase === "TABLE") {
          sfx.playCastleBell();
          this.selectedVoteTargetId = "";
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
          sfx.playHeartbeat();
        }
        this.lastPhase = state.phase;
      }

      const isDay = state.phase === "DAY";

      // Toggle Mobile 3D Controls ONLY during DAY phase
      const mobileControls = document.getElementById("mobile-controls");
      mobileControls?.classList.toggle("day-active", isDay);

      // Hide bottom status bar on mobile outside DAY phase to maximize panel room
      const statusCluster = document.getElementById("status-cluster");
      if (statusCluster) {
        const hideOnMobilePanel = !isDay && window.innerWidth <= 860;
        statusCluster.classList.toggle("hidden", hideOnMobilePanel);
      }

      // Update Top HUD Labels
      const roomCodeEl = document.getElementById("room-code-label");
      if (roomCodeEl) roomCodeEl.textContent = `${state.code || "SOFRA"}`;

      const phaseTitleEl = document.getElementById("phase-title");
      if (phaseTitleEl) {
        const phaseMap: Record<string, string> = {
          LOBBY: "LOBİ — KARAKTER & KASA",
          ARRIVAL: "GİRİŞ — MÜHÜRLÜ ZARFLAR",
          DAY: `GÜN ${state.round} — SERBEST KEŞİF`,
          TABLE: `GÜN ${state.round} — YUVARLAK SOFRA`,
          VOTE: `GÜN ${state.round} — OYLAMA`,
          FIRE: `GÜN ${state.round} — ŞÖMİNE ALEVİ`,
          NIGHT: `GECE ${state.round} — KARANLIK SAATLER`,
          MORNING: `SABAH ${state.round + 1} — SOFRA`,
          FINAL: "SON 4 KİŞİ — FİNAL KARARI",
          RESULT: "OYUN SONUCU"
        };
        phaseTitleEl.textContent = phaseMap[state.phase] || state.phase;
      }

      const timerEl = document.getElementById("phase-timer");
      if (timerEl) {
        const remSec = Math.max(0, Math.ceil(((state.phaseEndsAt || 0) - Date.now()) / 1000));
        timerEl.textContent = state.phase === "LOBBY" ? "Hazır" : `⏳ ${remSec} sn`;
      }

      const annEl = document.getElementById("announcement-box");
      if (annEl && state.announcement) {
        annEl.textContent = `"${state.announcement}"`;
      }

      // Update local movement in DAY phase
      this.updateLocalDayMovement(dt, state);

      // Update Zone Label & Door Button visibility
      const zone = detectRoomZone(this.localX, this.localZ);
      const zoneEl = document.getElementById("zone-label");
      if (zoneEl) {
        zoneEl.textContent = `📍 ${zone.name}${zone.isPrivateBedroom ? " (Özel)" : ""}`;
      }

      const nearDoor = DOORS.some(
        (d) => Math.hypot(this.localX - d.x, this.localZ - d.z) < SOFRA_CONFIG.DOOR_INTERACT_DIST
      );
      document.getElementById("btn-door-interact")?.classList.toggle("hidden", !(nearDoor && isDay));
      document.getElementById("btn-mobile-door")?.classList.toggle("hidden", !(nearDoor && isDay));

      // Sync Doors & Characters in 3D Scene
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
      this.scene.updateCamera(0, 12, dt);
    }

    this.scene.render(dt, now / 1000);
    requestAnimationFrame((t) => this.animate(t));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new SofraGameApp();
});
