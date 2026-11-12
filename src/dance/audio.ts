/**
 * ステージ用の音楽トランスポート。
 * フリー楽曲の MP3 を Web Audio で再生し、BPM から拍位相を作る。
 */
import { TRACKS, type TrackId } from "./show";

export class DanceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private bufferTrack: TrackId | null = null;
  private timer: number | null = null;
  private nextBeatAt = 0;
  private beatCount = 0;
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
    const bpm = Math.min(150, Math.max(70, value));
    this._bpm = bpm;
    if (!this.ctx || !this.source || !this._playing) return;
    // 楽曲は 120 BPM 固定。速度を変えるとピッチも動くが、ダンスとの同期を優先する。
    const now = this.ctx.currentTime;
    const oldBeats = Math.max(0, ((now - this.anchor) * this.anchorBpm) / 60);
    const phase = oldBeats % 1;
    const natural = TRACKS[this._track].bpm;
    this.source.playbackRate.setTargetAtTime(bpm / natural, now, 0.05);
    this.anchor = now - (phase * 60) / bpm;
    this.anchorBpm = bpm;
    this.nextBeatAt = now + ((1 - phase) * 60) / bpm;
    this.beatCount = (Math.floor(oldBeats) + 1) % 4;
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
    }
    await this.ctx.resume();
    // stop() が await 中に呼ばれたら、この start は諦める
    if (myGen !== this.gen) return;

    try {
      if (!this.buffer || this.bufferTrack !== this._track) {
        const response = await fetch(TRACKS[this._track].file);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
        this.bufferTrack = this._track;
      }
    } catch (error) {
      console.error("AUDIO load failed", error);
      return;
    }
    if (myGen !== this.gen) return;

    this.stopSource();
    const startAt = this.ctx.currentTime + 0.08;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.loopStart = 0;
    // ループ末尾の MP3 パディングを拍境界で切って、周回ごとのズレを防ぐ
    const naturalBeat = 60 / TRACKS[this._track].bpm;
    const loopEnd = Math.min(this.buffer.duration, Math.round(this.buffer.duration / naturalBeat) * naturalBeat);
    source.loopEnd = Math.max(naturalBeat * 4, loopEnd);
    source.playbackRate.value = this._bpm / TRACKS[this._track].bpm;
    source.connect(this.music!);
    source.start(startAt);
    this.source = source;

    this._playing = true;
    this.music?.gain.cancelScheduledValues(this.ctx.currentTime);
    this.music?.gain.setTargetAtTime(this._ducked ? 0.28 : 1, this.ctx.currentTime, 0.06);
    this.anchor = startAt;
    this.anchorBpm = this._bpm;
    this.nextBeatAt = startAt;
    this.beatCount = 0;
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 25);
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
    const source = this.source;
    if (source) {
      try {
        source.stop(now + fade);
      } catch {
        /* already stopped */
      }
      window.setTimeout(() => {
        source.disconnect();
        if (this.source === source) this.source = null;
      }, (fade + 0.1) * 1000);
    }
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
    this.stopSource();
    this.ctx?.close();
    this.ctx = null;
  }

  private stopSource() {
    const source = this.source;
    this.source = null;
    if (!source) return;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
  }

  private tick() {
    if (!this.ctx || !this._playing) return;
    const now = this.ctx.currentTime;
    while (this.nextBeatAt < now + 0.05) {
      const isBar = this.beatCount % 4 === 0;
      const delay = Math.max(0, (this.nextBeatAt - now) * 1000);
      window.setTimeout(() => {
        if (!this._playing) return;
        this.onBeat?.();
        if (isBar) this.onBar?.();
      }, delay);
      this.nextBeatAt += 60 / this._bpm;
      this.beatCount++;
    }
  }
}
