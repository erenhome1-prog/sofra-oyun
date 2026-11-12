/**
 * WebAudio Tabanlı Zengin Gotik Orta Çağ Ses Efekt Sentezleyicisi
 * Harici ses dosyası gerektirmeden sıfır gecikmeli, canlı prosedürel sesler üretir.
 */
class SofraSoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private unlockBound = false;
  private lastFootstepAt = 0;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = localStorage.getItem("sofra_sfx_muted") === "1";
      } catch {
        this.muted = false;
      }
      this.bindAutoUnlock();
    }
  }

  private bindAutoUnlock(): void {
    if (this.unlockBound || typeof window === "undefined") return;
    this.unlockBound = true;
    const unlock = () => {
      if (this.muted) return;
      const ctx = this.ensureCtx();
      if (ctx && ctx.state === "running") {
        window.removeEventListener("pointerdown", unlock, true);
        window.removeEventListener("touchstart", unlock, true);
        window.removeEventListener("keydown", unlock, true);
      }
    };
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("touchstart", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true, passive: true });
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem("sofra_sfx_muted", this.muted ? "1" : "0");
    } catch {
      // ignore storage restrictions
    }
    if (!this.muted) {
      this.ensureCtx();
      this.playUiClick();
    }
    return this.muted;
  }

  public unlock(): void {
    if (!this.muted) {
      this.ensureCtx();
    }
  }

  private ensureCtx(): AudioContext | null {
    if (typeof window === "undefined" || this.muted) return null;
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const length = Math.floor(ctx.sampleRate * 1.4);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
    return buf;
  }

  private playTone(
    ctx: AudioContext,
    type: OscillatorType,
    startFreq: number,
    endFreq: number | null,
    rampMode: "exp" | "lin" | "none",
    gainVal: number,
    startTime: number,
    duration: number,
    attackSec = 0.006
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(16, startFreq), startTime);
    if (endFreq !== null && rampMode === "exp") {
      osc.frequency.exponentialRampToValueAtTime(Math.max(16, endFreq), startTime + duration * 0.94);
    } else if (endFreq !== null && rampMode === "lin") {
      osc.frequency.linearRampToValueAtTime(Math.max(16, endFreq), startTime + duration * 0.9);
    }
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(gainVal, startTime + Math.min(attackSec, duration * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private playFilteredNoise(
    ctx: AudioContext,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    qVal: number,
    gainVal: number,
    startTime: number,
    duration: number,
    attackSec = 0.01
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer(ctx);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(qVal, startTime);
    filter.frequency.setValueAtTime(Math.max(40, freqStart), startTime);
    if (freqEnd !== freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startTime + duration);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(gainVal, startTime + Math.min(attackSec, duration * 0.4));
    gain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };
    src.start(startTime, Math.random() * 0.4);
    src.stop(startTime + duration + 0.02);
  }

  /** Mühürlü zarf açılma sesi */
  playSealBreak(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, "triangle", 195, 68, "exp", 0.32, now, 0.28);
    this.playFilteredNoise(ctx, "bandpass", 1400, 620, 1.8, 0.16, now, 0.22);
  }

  /** Sofra çağrısı derin şato çanı (`TABLE` & `bell_tolls`) */
  playCastleBell(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [freq, amp, dur] of [
      [196, 0.24, 2.5],
      [392, 0.18, 2.1],
      [587.33, 0.12, 1.7],
      [783.99, 0.07, 1.2]
    ] as [number, number, number][]) {
      this.playTone(ctx, "sine", freq, null, "none", amp, now, dur, 0.004);
    }
    this.playTone(ctx, "triangle", 98, 92, "lin", 0.16, now, 1.6, 0.005);
  }

  /** Son 10 Saniye Gerilim Geri Sayım Çanı ("DİN! DİN! DİN!") */
  playCountdownTick(secLeft: number): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const urgent = secLeft <= 3;
    const baseFreq = urgent ? 880 : secLeft <= 5 ? 740 : 659.25;
    const gain = urgent ? 0.24 : 0.17;

    // Tok bronz çan vuruşu + harmonik tını
    this.playTone(ctx, "sine", baseFreq, baseFreq * 0.985, "lin", gain, now, urgent ? 0.36 : 0.44, 0.003);
    this.playTone(ctx, "triangle", baseFreq * 1.5, null, "none", gain * 0.45, now, 0.24, 0.003);
    this.playTone(ctx, "sine", baseFreq * 0.5, null, "none", gain * 0.55, now, 0.32, 0.003);

    // Son 3 saniyede çift vuruşlu ("DİN-DİN!") yüksek gerilim
    if (urgent) {
      const t2 = now + 0.16;
      this.playTone(ctx, "sine", baseFreq * 1.12, null, "none", gain * 0.85, t2, 0.28, 0.003);
      this.playTone(ctx, "triangle", baseFreq * 1.68, null, "none", gain * 0.38, t2, 0.18, 0.003);
    }
  }

  /** Gündüz bitimine 15 sn kala "Akşam Sofrası Yaklaşıyor" uyarı çanı */
  playEveningWarningBell(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [idx, freq] of [523.25, 659.25].entries()) {
      const t = now + idx * 0.22;
      this.playTone(ctx, "sine", freq, null, "none", 0.2, t, 0.65, 0.004);
      this.playTone(ctx, "triangle", freq * 0.5, null, "none", 0.11, t, 0.5, 0.004);
    }
  }

  /** Sabah / Gündüz başlangıcı Orta Çağ av/şato borusu (`DAY` & `MORNING`) */
  playMorningHorn(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes: [number, number, number][] = [
      [293.66, 0, 0.32],
      [440.0, 0.26, 0.72]
    ];
    for (const [freq, offset, dur] of notes) {
      this.playTone(ctx, "sawtooth", freq * 0.5, freq * 0.502, "lin", 0.09, now + offset, dur, 0.045);
      this.playTone(ctx, "triangle", freq, freq * 1.003, "lin", 0.2, now + offset, dur, 0.04);
    }
  }

  /** Kadim Rün / Bulmaca evresi gizemli tınısı (`TRIAL`) */
  playRuneChime(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [idx, freq] of [523.25, 659.25, 783.99, 1046.5].entries()) {
      const t = now + idx * 0.075;
      this.playTone(ctx, "sine", freq, null, "none", 0.15, t, 0.62, 0.005);
    }
  }

  /** Bulmaca doğru cevap / görev başarısı zafer akoru */
  playSuccessChord(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [idx, freq] of [440, 554.37, 659.25, 880].entries()) {
      const t = now + idx * 0.055;
      this.playTone(ctx, "triangle", freq, null, "none", 0.18, t, 0.52, 0.005);
    }
  }

  /** Yanlış cevap / Hain sabotajı / Karanlık çökmesi uğursuz ses */
  playSabotageDark(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, "sawtooth", 145, 58, "exp", 0.22, now, 0.55, 0.008);
    this.playTone(ctx, "triangle", 103, 46, "exp", 0.24, now + 0.04, 0.6, 0.008);
    this.playFilteredNoise(ctx, "lowpass", 520, 140, 1.4, 0.14, now, 0.45);
  }

  /** Oylama & Final başlangıcı tok hüküm davulu (`VOTE` & `FINAL`) */
  playTensionDrum(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [idx, amp] of [0.3, 0.22, 0.34].entries()) {
      const t = now + idx * (idx === 2 ? 0.22 : 0.18);
      this.playTone(ctx, "sine", 96, 38, "exp", amp, t, 0.34, 0.003);
      this.playFilteredNoise(ctx, "lowpass", 360, 110, 1.1, amp * 0.38, t, 0.14, 0.003);
    }
  }

  /** Oy / Karar pusulası mühürleme tok damga sesi */
  playVoteStamp(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, "sine", 132, 44, "exp", 0.3, now, 0.22, 0.003);
    this.playFilteredNoise(ctx, "bandpass", 920, 340, 1.6, 0.16, now, 0.14, 0.003);
  }

  /** Yatak odası demir menteşeli kapı gıcırtısı */
  playDoorCreak(open: boolean): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, "sawtooth", open ? 140 : 185, open ? 212 : 112, "lin", 0.11, now, 0.36, 0.01);
    this.playTone(ctx, "sine", open ? 92 : 76, 48, "exp", 0.16, now + 0.22, 0.16, 0.004);
  }

  /** Kilitli kapı demir sürgü takırtısı */
  playDoorLocked(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const offset of [0, 0.09]) {
      this.playTone(ctx, "square", 168, 92, "exp", 0.13, now + offset, 0.08, 0.002);
    }
  }

  /** Şömine zarf yanma / alev harlaması (`FIRE` & `fireplace_burn`) */
  playFireWhoosh(isTraitorRed: boolean): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playFilteredNoise(
      ctx,
      "bandpass",
      isTraitorRed ? 680 : 1050,
      isTraitorRed ? 190 : 320,
      0.85,
      0.3,
      now,
      1.25,
      0.04
    );
    this.playTone(
      ctx,
      isTraitorRed ? "sawtooth" : "sine",
      isTraitorRed ? 102 : 262,
      isTraitorRed ? 38 : 131,
      "exp",
      0.26,
      now,
      1.15,
      0.02
    );
  }

  /** Gece başlangıcı karanlık rüzgâr uğultusu + kalp atışı (`NIGHT`) */
  playNightWind(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playFilteredNoise(ctx, "bandpass", 280, 520, 2.4, 0.18, now, 1.5, 0.25);
    this.playHeartbeat();
  }

  /** Gece kalp atışı */
  playHeartbeat(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const offset of [0, 0.22]) {
      this.playTone(ctx, "sine", 58, 32, "exp", 0.3, now + offset, 0.18, 0.004);
    }
  }

  /** Hain hedef seçimi / infaz mühürleme çelik hançer çekiş sesi */
  playDaggerDraw(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playFilteredNoise(ctx, "highpass", 2200, 4800, 2.2, 0.14, now, 0.26, 0.01);
    this.playTone(ctx, "triangle", 980, 1760, "exp", 0.12, now, 0.24, 0.005);
  }

  /** Taş zeminde yürüyüş / koşu ritmik adım sesi (kulağı yormayan yumuşak taş dokunuşu) */
  playFootstep(isSprint = false): void {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const minGap = isSprint ? 265 : 410;
    if (nowMs - this.lastFootstepAt < minGap) return;
    this.lastFootstepAt = nowMs;

    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const pitchJitter = 0.92 + Math.random() * 0.16;
    this.playTone(
      ctx,
      "sine",
      (isSprint ? 108 : 88) * pitchJitter,
      42,
      "exp",
      isSprint ? 0.075 : 0.052,
      now,
      0.075,
      0.002
    );
    this.playFilteredNoise(
      ctx,
      "bandpass",
      (isSprint ? 1150 : 880) * pitchJitter,
      460,
      1.5,
      isSprint ? 0.055 : 0.038,
      now,
      0.055,
      0.002
    );
  }

  /** Gizli DM / Fısıltı geldiğinde gizemli kristal çan */
  playWhisperPing(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, "sine", 783.99, null, "none", 0.13, now, 0.28, 0.004);
    this.playTone(ctx, "sine", 1174.66, null, "none", 0.11, now + 0.08, 0.36, 0.004);
  }

  /** Genel sohbet mesajı hafif parşömen tık sesi */
  playChatTick(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, "triangle", 420, 240, "exp", 0.06, now, 0.055, 0.002);
  }

  /** El Kitapçığı açılma / sekme çevirme parşömen sayfa hışırtısı */
  playPageFlip(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playFilteredNoise(ctx, "bandpass", 1600, 900, 1.1, 0.12, now, 0.16, 0.012);
  }

  /** Yeni dedektif ipucu bulunduğunda kristal büyüteç tınısı */
  playClueChime(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [idx, freq] of [659.25, 987.77, 1318.51].entries()) {
      this.playTone(ctx, "sine", freq, null, "none", 0.13, now + idx * 0.065, 0.38, 0.004);
    }
  }

  /** Hafif Orta Çağ UI buton tık sesi */
  playUiClick(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, "triangle", 540, 290, "exp", 0.065, now, 0.045, 0.002);
  }

  /** Altın kasa sesi */
  playGoldChime(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [idx, freq] of [587.33, 880, 1174.66].entries()) {
      this.playTone(ctx, "triangle", freq, null, "none", 0.2, now + idx * 0.08, 0.45, 0.004);
    }
  }
}

export const sfx = new SofraSoundEngine();
