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

  // Local player movement & stamina
  private localX = 0;
  private localZ = 16;
  private localRotY = Math.PI;
  private stamina = 100;
  private staminaExhaustedUntil = 0;
  private keys = new Set<string>();
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
      goldEl.textContent = `🪙 ${this.vault.gold} Altın`;
    }
  }

  private setupWelcomeModal(): void {
    const modal = document.getElementById("welcome-modal")!;
    const closedView = document.getElementById("envelope-closed-view")!;
    const openView = document.getElementById("envelope-open-view")!;
    const btnBreakSeal = document.getElementById("btn-break-seal")!;
    const btnEnterCastle = document.getElementById("btn-enter-castle")!;
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

    btnEnterCastle.addEventListener("click", () => {
      modal.classList.add("hidden");
      sfx.playDoorCreak(true);
    });

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
      btnWatchAd.textContent = `⏳ Reklam (${left}sn)...`;
      const timer = setInterval(() => {
        left -= 1;
        if (left > 0) {
          btnWatchAd.textContent = `⏳ Reklam (${left}sn)...`;
        } else {
          clearInterval(timer);
          this.vault.gold += 50;
          this.saveVault();
          sfx.playGoldChime();
          btnWatchAd.removeAttribute("disabled");
          btnWatchAd.textContent = "🎬 Reklam İzle (+50 🪙)";
          this.lastCenterRenderHash = ""; // force refresh studio
        }
      }, 1000);
    });

    const btnDoor = document.getElementById("btn-door-interact")!;
    btnDoor.addEventListener("click", () => this.tryInteractNearestDoor());

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

    // Mouse drag on canvas rotates camera
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const canvas = this.scene.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.scene.cameraYaw -= dx * 0.0055;
      this.scene.cameraPitch = Math.max(0.15, Math.min(1.05, this.scene.cameraPitch + dy * 0.004));
    });
    window.addEventListener("pointerup", () => {
      dragging = false;
    });

    // Mobile Virtual Joystick
    const zone = document.getElementById("joystick-zone")!;
    const knob = document.getElementById("joystick-knob")!;
    let joyActive = false;

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
      joyActive = true;
      updateJoystick(e.clientX, e.clientY);
    });
    window.addEventListener("pointermove", (e) => {
      if (joyActive) updateJoystick(e.clientX, e.clientY);
    });
    window.addEventListener("pointerup", () => {
      if (!joyActive) return;
      joyActive = false;
      knob.style.transform = "translate(0px, 0px)";
      this.joyX = 0;
      this.joyY = 0;
    });
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
          pill.textContent = "🗡️ ROLÜN: HAİN";
        } else {
          pill.classList.add("role-misafir");
          pill.textContent = "🕯️ ROLÜN: MİSAFİR";
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
    const hash = `${phase}|${state.round}|${state.fastMode}|${state.lastBurnedFlame}|${this.vault.gold}|${this.vault.selectedSeat}|${this.vault.coatColor}|${this.vault.hat}|${this.vault.mask}|${this.selectedVoteTargetId}|${this.selectedNightTargetId}|${this.selectedFinalChoice}|${playerSummary}`;

    if (hash === this.lastCenterRenderHash) return;
    this.lastCenterRenderHash = hash;

    if (phase === "DAY") {
      // Hide center panel during 3D Day exploration so full screen is clear!
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

    panel.innerHTML = `
      <div class="panel-header">
        <h2>🕯️ YUVARLAK SOFRA LOBİSİ & KARAKTER ATÖLYESİ</h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn" id="btn-add-bots">🤖 Botlarla Doldur (10 Kişi)</button>
          <button class="btn" id="btn-fast-mode">
            ⚡ Hızlı Mod: ${state.fastMode ? "AÇIK" : "KAPALI"}
          </button>
          <button class="btn btn-crimson" id="btn-start-game">
            🔥 SOFRAYI BAŞLAT
          </button>
        </div>
      </div>

      <div class="studio-grid">
        <div>
          <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:8px;">
            Dizi Karakterlerinden Birini Seçin (#11 Kâhya'nın Boş Tahtıdır):
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

        <div class="customizer-box">
          <h3 style="color:var(--gold); font-size:0.98rem;">
            🎨 Kendi Karakterini Yarat & Kişisel Kasa
          </h3>

          <div class="field-row">
            <label>Kendi Oyuncu Adın (Boş bırakırsan dizi karakterinin adı görünür):</label>
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
                ${this.vault.unlockedItems.includes("crown") ? "👑 Altın Şato Tacı (Açık)" : "🔒 Altın Şato Tacı (50 🪙 ile Aç)"}
              </option>
            </select>
          </div>

          <div class="field-row">
            <label>Maske & Aksesuar (Kasa):</label>
            <select id="select-mask">
              <option value="none" ${this.vault.mask === "none" ? "selected" : ""}>Maske Yok</option>
              <option value="glasses" ${this.vault.mask === "glasses" ? "selected" : ""}>Altın Çerçeve Gözlük (Ücretsiz)</option>
              <option value="beard" ${this.vault.mask === "beard" ? "selected" : ""}>Bilge Sakalı (Ücretsiz)</option>
              <option value="domino" ${this.vault.mask === "domino" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("domino") ? "🎭 Balo Maskesi (Açık)" : "🔒 Balo Maskesi (50 🪙 ile Aç)"}
              </option>
              <option value="plague" ${this.vault.mask === "plague" ? "selected" : ""}>
                ${this.vault.unlockedItems.includes("plague") ? "🦅 Veba Doktoru Maskesi (Açık)" : "🔒 Veba Doktoru Maskesi (50 🪙 ile Aç)"}
              </option>
            </select>
          </div>

          <button class="btn" id="btn-apply-custom" style="margin-top:4px;">
            ✨ Karakter Görünümünü Kaydet & Uygula
          </button>
        </div>
      </div>
    `;

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
        alert("Bu özel aksesuar için 50 Altın gerekiyor! Sağ üstten '🎬 Reklam İzle (+50 🪙)' butonuna basarak hemen kazanabilirsin.");
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
      <div style="text-align:center; padding: 14px;">
        <p style="color:var(--gold); letter-spacing:2px; font-size:0.82rem;">◆ GİZLİ ROL ZARFINIZ AÇILDI ◆</p>
        <h2 style="font-size:1.75rem; margin:10px 0; color:${isHain ? "#ff4d5e" : "#7ab8ff"};">
          ${isHain ? "🗡️ KARANLIĞIN HİZMETKÂRI: HAİN" : "🕯️ SADIK DAVETLİ: MİSAFİR"}
        </h2>
        <p style="font-size:1rem; max-width:560px; margin:0 auto 14px; line-height:1.5;">
          ${
            isHain
              ? "Sofraya sızdın! Gündüz şüpheleri başkalarının üzerine çek, gece olduğunda hedefini seç."
              : "Şatonun sadık bir davetlisin! Gündüz odaları gez, şüphelileri gözlemle ve Sofrada Hainleri şömineye gönder."
          }
        </p>
        ${
          isHain && fellows.length > 0
            ? `<div style="background:rgba(155,18,32,0.25); border:1px solid #ff4d5e; border-radius:10px; padding:10px; display:inline-block;">
                <strong>Suç Ortakların (Diğer Hainler):</strong>
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
        <h2>🔔 YUVARLAK SOFRA — ${isVotePhase ? "ŞÜPHELİ OYLAMASI" : "TARTIŞMA ZAMANI"}</h2>
        <span style="font-size:0.85rem; color:var(--gold);">
          #11 Kâhya'nın Boş Sandalyesi Sofrayı İzliyor
        </span>
      </div>
      <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:12px;">
        ${
          isVotePhase
            ? "Zarfı şömineye atılacak şüpheliyi seçin (Kendinize oy veremezsiniz):"
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
            <div class="seat-title">${state.necklaceHolder === p.id ? "📿 Altın Kolye Sahibi" : "Hayatta"}</div>
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
      <div style="text-align:center; padding:18px;">
        <h2 style="font-size:1.6rem; color:${isRed ? "#ff3b4e" : isWhite ? "#a8d8ff" : "#d4af37"};">
          ${
            isRed
              ? "🔥 ŞÖMİNE KAN KIRMIZISI PARLADI! (HAİN YAKALANDI)"
              : isWhite
              ? "❄️ ŞÖMİNE BEYAZ ALEVLE YANDI! (MASUM MİSAFİR ELENDİ)"
              : "⚖️ OYLAR EŞİT ÇIKTI — ŞÖMİNEYE ZARF ATILMADI"
          }
        </h2>
        <p style="margin-top:10px; font-size:1rem;">${state.announcement}</p>
      </div>
    `;
  }

  private renderNightPanel(panel: HTMLElement, state: any): void {
    const isHain = this.myRole?.role === "HAIN";
    const targets = Array.from(state.players?.values() || []).filter((p: any) => p.alive);

    if (!isHain) {
      panel.innerHTML = `
        <div style="text-align:center; padding:22px;">
          <h2 style="color:var(--gold);">🌑 ŞATODA GECE ÇÖKTÜ</h2>
          <p style="margin-top:8px; color:var(--text-muted);">
            Kapılar kilitlendi, mumlar söndü... Hainler karanlıkta bir hedef seçiyor.
          </p>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="panel-header">
        <h2 style="color:#ff4d5e;">🗡️ HAİNLERİN GECE KONSEYİ — KURBAN SEÇİN</h2>
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
      <div style="text-align:center; padding:18px;">
        <h2 style="color:var(--gold);">🌅 ŞATODA SABAH OLDU</h2>
        <p style="margin-top:10px; font-size:1.05rem;">${state.announcement}</p>
      </div>
    `;
  }

  private renderFinalPanel(panel: HTMLElement, state: any): void {
    const alive = Array.from(state.players?.values() || []).filter((p: any) => p.alive);

    panel.innerHTML = `
      <div class="panel-header">
        <h2>⚖️ FİNAL KARARI — SON ${alive.length} KİŞİ</h2>
      </div>
      <p style="margin-bottom:14px; font-size:0.95rem;">
        Sofrada kalan herkes ya birbirine güvenip el sıkışacak ya da son bir şüpheli oylamasına gidecek:
      </p>
      <div style="display:flex; gap:12px; justify-content:center; margin-bottom:14px; flex-wrap:wrap;">
        <button class="btn ${this.selectedFinalChoice === "TRUST" ? "btn-crimson" : ""}" id="btn-final-trust">
          🤝 HEPİMİZ MİSAFİRİZ (Oyunu Bitir)
        </button>
        <button class="btn ${this.selectedFinalChoice === "DOUBT" ? "btn-crimson" : ""}" id="btn-final-doubt">
          🔥 ARAMIZDA HAİN VAR (Son Oylama)
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
      <div style="text-align:center; padding:18px;">
        <p style="color:var(--gold); letter-spacing:2px; font-size:0.82rem;">◆ OYUN SONA ERDİ ◆</p>
        <h2 style="font-size:1.8rem; margin:10px 0; color:${guestsWon ? "#7ab8ff" : "#ff4d5e"};">
          ${guestsWon ? "🕯️ MİSAFİRLER KAZANDI!" : "🗡️ HAİNLER SOFRAYI ELE GEÇİRDİ!"}
        </h2>
        <p style="font-size:1rem; margin-bottom:16px;">${state.announcement}</p>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn" id="btn-download-story">📸 9:16 Instagram Story Kartı İndir</button>
          <button class="btn btn-crimson" id="btn-back-lobby">🔄 Yeni Oyun (Lobiye Dön)</button>
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
    const wantsSprint = this.keys.has("shift") && now > this.staminaExhaustedUntil;
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

      // Update Top HUD Labels
      const roomCodeEl = document.getElementById("room-code-label");
      if (roomCodeEl) roomCodeEl.textContent = `Oda Kodu: ${state.code || "SOFRA"}`;

      const phaseTitleEl = document.getElementById("phase-title");
      if (phaseTitleEl) {
        const phaseMap: Record<string, string> = {
          LOBBY: "LOBİ — KARAKTER & KASA",
          ARRIVAL: "GİRİŞ — MÜHÜRLÜ ZARFLAR",
          DAY: `GÜN ${state.round} — ŞATODA SERBEST KEŞİF`,
          TABLE: `GÜN ${state.round} — YUVARLAK SOFRA`,
          VOTE: `GÜN ${state.round} — ŞÜPHELİ OYLAMASI`,
          FIRE: `GÜN ${state.round} — ŞÖMİNE ALEVİ`,
          NIGHT: `GECE ${state.round} — KARANLIK SAATLER`,
          MORNING: `SABAH ${state.round + 1} — TERS ÇEVRİLEN TABAK`,
          FINAL: "SON 4 KİŞİ — FİNAL KARARI",
          RESULT: "OYUN SONUCU"
        };
        phaseTitleEl.textContent = phaseMap[state.phase] || state.phase;
      }

      const timerEl = document.getElementById("phase-timer");
      if (timerEl) {
        const remSec = Math.max(0, Math.ceil(((state.phaseEndsAt || 0) - Date.now()) / 1000));
        timerEl.textContent =
          state.phase === "LOBBY" ? "Oyuncular hazır olduğunda başlatın" : `Kalan Süre: ${remSec} sn`;
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
        zoneEl.textContent = `📍 ${zone.name}${zone.isPrivateBedroom ? " (Özel Oda)" : ""}`;
      }

      const btnDoor = document.getElementById("btn-door-interact")!;
      const nearDoor = DOORS.some(
        (d) => Math.hypot(this.localX - d.x, this.localZ - d.z) < SOFRA_CONFIG.DOOR_INTERACT_DIST
      );
      if (nearDoor && state.phase === "DAY") {
        btnDoor.classList.remove("hidden");
      } else {
        btnDoor.classList.add("hidden");
      }

      // Sync Doors & Characters in 3D Scene
      this.scene.syncDoorStates(this.getOpenDoorsMap(state));

      const charList: CharacterVisualState[] = [];
      state.players?.forEach((p: any, sid: string) => {
        const isLocal = sid === this.room?.sessionId;
        charList.push({
          sessionId: sid,
          name: p.nick,
          seat: p.seat,
          x: isLocal && state.phase === "DAY" ? this.localX : p.x,
          y: 0,
          z: isLocal && state.phase === "DAY" ? this.localZ : p.z,
          rotY: isLocal && state.phase === "DAY" ? this.localRotY : p.rotY,
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
