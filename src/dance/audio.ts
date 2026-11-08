/**
 * ステージ用の最小ビートシンセ。
 * 音源ファイルを持たずに Web Audio だけで 4/4 のループを鳴らす。
 * 本番の music-to-dance に差し替えるまでのプレースホルダ。
 */
import { TRACKS, type TrackId } from "./show";

const STEPS = 16;

export class DanceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: number | null = null;
  private next = 0;
  private step = 0;
  private _bpm = TRACKS.neon.bpm;
  private _muted = false;
  private _playing = false;
  private _ducked = false;
  private _track: TrackId = "neon";
  private anchor = 0;
  private anchorBpm = TRACKS.neon.bpm;
  private gen = 0;

  /** 拍の頭で呼ばれる。ライトのパルス用。 */
  onBeat: (() => void) | null = null;
  /** 小節の頭で呼ばれる。MCのタイミング用。 */
  onBar: (() => void) | null = null;

  get bpm() {
    return this._bpm;
  }

  get track(): TrackId {
    return this._track;
  }

  get playing() {
    return this._playing;
  }

  setBpm(value: number) {
    if (!Number.isFinite(value)) return;
    this._bpm = Math.min(150, Math.max(70, value));
    this.anchor = this.ctx?.currentTime ?? 0;
    this.anchorBpm = this._bpm;
  }

  setMuted(muted: boolean) {
    this._muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.04);
    }
  }

  setDucked(ducked: boolean) {
    this._ducked = ducked;
    if (!this.ctx || !this.music) return;
    const level = this._playing ? (ducked ? 0.28 : 1) : 0;
    this.music.gain.setTargetAtTime(level, this.ctx.currentTime, 0.08);
  }

  async start(trackId?: TrackId) {
    const myGen = ++this.gen;
    if (trackId) {
      this._track = trackId;
      this._bpm = TRACKS[trackId].bpm;
    }
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.45;
      this.music = this.ctx.createGain();
      this.music.gain.value = 0;
      this.master.connect(this.music).connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
    }
    await this.ctx.resume();
    // stop() が await 中に呼ばれたら、この start は諦める
    if (myGen !== this.gen) return;
    this._playing = true;
    this.music?.gain.cancelScheduledValues(this.ctx.currentTime);
    this.music?.gain.setTargetAtTime(this._ducked ? 0.28 : 1, this.ctx.currentTime, 0.06);
    this.next = this.ctx.currentTime + 0.08;
    this.anchor = this.next;
    this.anchorBpm = this._bpm;
    this.step = 0;
    if (this.timer === null) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** 曲を止める。fadeBars は 4/4 の小節数。 */
  stop(fadeBars = 1) {
    if (!this.ctx || !this.music) return;
    const bars = Number.isFinite(fadeBars) ? Math.max(0.25, Math.min(4, fadeBars)) : 1;
    this.gen++;
    this._playing = false;
    const now = this.ctx.currentTime;
    const fade = Math.max(0.12, (60 / this._bpm) * 4 * bars);
    this.music.gain.cancelScheduledValues(now);
    this.music.gain.setValueAtTime(this.music.gain.value, now);
    this.music.gain.linearRampToValueAtTime(0, now + fade);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  async playTrack(trackId: TrackId) {
    await this.start(trackId);
  }

  /** 描画用の拍位相。音と3Dの揺れを同じクロックに乗せる。 */
  getPhase() {
    if (!this.ctx) return { phase: 0, beat: 0, bar: 0, playing: false };
    const beats = Math.max(0, ((this.ctx.currentTime - this.anchor) * this.anchorBpm) / 60);
    return {
      phase: beats % 1,
      beat: Math.floor(beats) % 4,
      bar: Math.floor(beats / 4),
      playing: this._playing,
    };
  }

  /** 現在の小節（停止中も最後の位置を返す） */
  get bar() {
    return this.getPhase().bar;
  }

  dispose() {
    this.gen++;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.ctx?.close();
    this.ctx = null;
  }

  private makeNoise(ctx: AudioContext) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private schedule() {
    if (!this.ctx || !this._playing) return;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.next);
      this.next += 60 / this._bpm / 4;
      this.step = (this.step + 1) % STEPS;
    }
  }

  private playStep(step: number, time: number) {
    if (!this.ctx || !this.master || !this._playing) return;

    if (step % 4 === 0) this.kick(time);
    if (step % 4 === 2) this.hat(time);
    if (step === 4 || step === 12) this.clap(time);
    if (step % 2 === 0) this.bass(time, TRACKS[this._track].bass[(step / 2) % 8]);
    if (step === 0 || step === 8) {
      this.chord(time, TRACKS[this._track].chords[step === 0 ? 0 : 1]);
    }

    if (step % 4 === 0) {
      const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
      window.setTimeout(() => {
        if (!this._playing) return;
        this.onBeat?.();
        if (step === 0) this.onBar?.();
      }, delay);
    }
  }

  private kick(time: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.28);
    gain.gain.setValueAtTime(0.85, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
    osc.connect(gain).connect(this.master!);
    osc.start(time);
    osc.stop(time + 0.34);
  }

  private hat(time: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noise;
    filter.type = "highpass";
    filter.frequency.value = 7000;
    gain.gain.setValueAtTime(0.11, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(time);
    src.stop(time + 0.06);
  }

  private clap(time: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noise;
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.22, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(time);
    src.stop(time + 0.15);
  }

  private bass(time: number, frequency: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = frequency;
    filter.type = "lowpass";
    filter.frequency.value = 420;
    gain.gain.setValueAtTime(0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    osc.connect(filter).connect(gain).connect(this.master!);
    osc.start(time);
    osc.stop(time + 0.22);
  }

  private chord(time: number, root: number) {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.045, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.7);
    gain.connect(this.master!);
    for (const ratio of [1, 1.1892, 1.4983]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = root * ratio;
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.72);
    }
  }
}
