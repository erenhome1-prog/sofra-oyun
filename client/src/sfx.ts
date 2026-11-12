/**
 * WebAudio Tabanlı Gotik Şato Ses Efekt Sentezleyicisi
 * Harici ses dosyası yüklenmesini beklemeden anında sıfır gecikmeli ses üretir.
 */
class SofraSoundEngine {
  private ctx: AudioContext | null = null;

  private ensureCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** Mühürlü zarf açılma sesi */
  playSealBreak() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.28);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /** Sofra çağrısı derin şato çanı */
  playCastleBell() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const freq of [220, 440, 659.25]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 2.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 2.45);
    }
  }

  /** Yatak odası demir menteşeli kapı gıcırtısı */
  playDoorCreak(open: boolean) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(open ? 140 : 185, now);
    osc.frequency.linearRampToValueAtTime(open ? 210 : 115, now + 0.35);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  /** Şömine zarf yanma / alev parlaması */
  playFireWhoosh(isTraitorRed: boolean) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isTraitorRed ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(isTraitorRed ? 95 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(isTraitorRed ? 38 : 130, now + 1.1);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.2);
  }

  /** Gece kalp atışı */
  playHeartbeat() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const offset of [0, 0.22]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(58, now + offset);
      osc.frequency.exponentialRampToValueAtTime(32, now + offset + 0.16);
      gain.gain.setValueAtTime(0.3, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.19);
    }
  }

  /** Altın kasa sesi */
  playGoldChime() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [idx, freq] of [587.33, 880, 1174.66].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.2, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.46);
    }
  }
}

export const sfx = new SofraSoundEngine();
