/**
 * Real-time band filter for the bio waveforms (EMG/EEG/ECG/BRTH/PPG/SpO2):
 * a causal 4th-order Butterworth bandpass whose per-channel state carries
 * over between data batches, applied in the data callback right before the
 * samples enter the display rings. The selected band is a UI choice shared
 * by every device; switching the band (or a stream sample-rate change)
 * rebuilds the filter state, and the rings replace old samples naturally as
 * new data arrives.
 */

// (label, low Hz, high Hz); index 0 = Off. The Greek letters are written as
// unicode escapes to keep the source file ASCII-only.
const BANDS: ReadonlyArray<{ label: string; lo: number; hi: number }> = [
  { label: 'Off', lo: 0, hi: 0 },
  { label: 'δ 0.5-4Hz', lo: 0.5, hi: 4 },
  { label: 'θ 4-8Hz', lo: 4, hi: 8 },
  { label: 'α 8-13Hz', lo: 8, hi: 13 },
  { label: 'β 13-30Hz', lo: 13, hi: 30 },
  { label: 'γ 30-45Hz', lo: 30, hi: 45 },
];
const ORDER = 4;
const PI = 3.14159265358979323846;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface StreamState {
  band: number;
  rate: number;
  sections: Biquad[];
  // Per-section unit-step steady state, used as each channel's initial
  // filter state (scipy sosfilt_zi equivalent).
  zi0: number[][];
  // channel -> per-section running state.
  channels: Map<number, number[][]>;
}

/** Minimal complex arithmetic for the filter design math. */
class C {
  public constructor(
    public readonly re: number,
    public readonly im: number
  ) {}

  public static polar(r: number, theta: number): C {
    return new C(r * Math.cos(theta), r * Math.sin(theta));
  }

  public static real(v: number): C {
    return new C(v, 0);
  }

  public static sqrt(c: C): C {
    const m = Math.sqrt(c.abs());
    const a = Math.atan2(c.im, c.re) / 2;
    return new C(m * Math.cos(a), m * Math.sin(a));
  }

  public add(o: C | number): C {
    return typeof o === 'number'
      ? new C(this.re + o, this.im)
      : new C(this.re + o.re, this.im + o.im);
  }

  public sub(o: C): C {
    return new C(this.re - o.re, this.im - o.im);
  }

  public mul(o: C | number): C {
    return typeof o === 'number'
      ? new C(this.re * o, this.im * o)
      : new C(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re);
  }

  public div(o: C): C {
    const d = o.re * o.re + o.im * o.im;
    return new C(
      (this.re * o.re + this.im * o.im) / d,
      (this.im * o.re - this.re * o.im) / d
    );
  }

  public conj(): C {
    return new C(this.re, -this.im);
  }

  public abs(): number {
    return Math.hypot(this.re, this.im);
  }
}

export class LiveFilter {
  /** Band index 0 is Off. bandLabels() feeds the filter selector. */
  public static bandLabels(): string[] {
    return BANDS.map((b) => b.label);
  }

  private _band = 0;
  private streams = new Map<number, StreamState>(); // key: DataType value

  /** UI thread. Out-of-range indexes select Off. */
  public setBand(bandIndex: number): void {
    this._band = bandIndex > 0 && bandIndex < BANDS.length ? bandIndex : 0;
    // A band switch rebuilds every stream's filter state; old ring contents
    // scroll out with new data, so the rings are not cleared.
    this.streams.clear();
  }

  /** Currently selected band index (0 = Off). */
  public get band(): number {
    return this._band;
  }

  /** Drops all designed filters and channel states (device switch / clear). */
  public reset(): void {
    this.streams.clear();
  }

  /**
   * Filters one channel batch in place. Pass-through when Off, when the rate
   * is unknown/invalid, or when the band top exceeds the Nyquist frequency
   * (e.g. the 1 Hz SpO2 stream).
   */
  public apply(
    dataType: number,
    channel: number,
    vals: Float32Array,
    sampleRate: number
  ): void {
    if (vals.length === 0 || this._band === 0) {
      return;
    }
    let st = this.streams.get(dataType);
    if (!st) {
      st = { band: 0, rate: 0, sections: [], zi0: [], channels: new Map() };
      this.streams.set(dataType, st);
    }
    if (st.band !== this._band || st.rate !== sampleRate) {
      // Band or sample-rate change: redesign and reset every channel state.
      st.sections = [];
      st.zi0 = [];
      st.channels.clear();
      st.band = this._band;
      st.rate = sampleRate;
      const designed = LiveFilter.design(this._band, sampleRate);
      if (!designed) {
        // Invalid band/rate (e.g. the band top exceeds Nyquist): keep the
        // empty section list as the pass-through marker until the band or
        // rate changes again.
        return;
      }
      st.sections = designed;
      // Unit-step steady state per section (scipy sosfilt_zi equivalent):
      // with a constant input u, a section settles at output y = G*u where
      // G is its DC gain, and the states follow from the fixed point.
      let u = 1;
      for (const s of designed) {
        const g = (s.b0 + s.b1 + s.b2) / (1 + s.a1 + s.a2);
        const y = g * u;
        st.zi0.push([y - s.b0 * u, s.b2 * u - s.a2 * y]);
        u = y;
      }
    }
    if (st.sections.length === 0) {
      return;
    }
    let chState = st.channels.get(channel);
    if (!chState) {
      chState = st.zi0.map((z) => [z[0]!, z[1]!]);
      st.channels.set(channel, chState);
    }
    for (let i = 0; i < vals.length; i++) {
      let x = vals[i]!;
      for (let s = 0; s < st.sections.length; s++) {
        const q = st.sections[s]!;
        const z = chState[s]!;
        const y = q.b0 * x + z[0]!;
        z[0] = q.b1 * x - q.a1 * y + z[1]!;
        z[1] = q.b2 * x - q.a2 * y;
        x = y;
      }
      vals[i] = x;
    }
  }

  /**
   * Butterworth bandpass design (order 4): analog prototype -> lp2bp ->
   * bilinear, grouped into second-order sections. Returns null when the band
   * is invalid for the rate.
   */
  private static design(bandIndex: number, fs: number): Biquad[] | null {
    if (bandIndex <= 0 || bandIndex >= BANDS.length || fs <= 0) {
      return null;
    }
    const { lo, hi } = BANDS[bandIndex]!;
    if (hi >= fs / 2) {
      return null; // band top beyond the Nyquist frequency
    }
    // Prewarp to the analog domain.
    const w1 = 2 * fs * Math.tan((PI * lo) / fs);
    const w2 = 2 * fs * Math.tan((PI * hi) / fs);
    const bw = w2 - w1;
    const wo = Math.sqrt(w1 * w2);
    const fs2 = 2 * fs;

    // Analog Butterworth lowpass prototype poles (no finite zeros, gain 1).
    const poles: C[] = [];
    const zeros: C[] = []; // z-plane zeros, filled below
    for (let k = 0; k < ORDER; k++) {
      const ang = (PI * (2 * k + 1 + ORDER)) / (2 * ORDER);
      const p = C.polar(1, ang);
      // lp2bp: each pole maps to the roots of s^2 - bw*p*s + wo^2 = 0.
      const mid = p.mul(0.5 * bw);
      const disc = C.sqrt(mid.mul(mid).sub(C.real(wo * wo)));
      const sp1 = mid.add(disc);
      const sp2 = mid.sub(disc);
      // Bilinear transform z = (2fs + s) / (2fs - s).
      poles.push(sp1.add(fs2).div(C.real(fs2).sub(sp1)));
      poles.push(sp2.add(fs2).div(C.real(fs2).sub(sp2)));
    }
    // Prototype zeros: ORDER zeros at s=0 (-> z=+1) plus ORDER zeros at
    // infinity (-> z=-1).
    for (let k = 0; k < ORDER; k++) {
      zeros.push(C.real(1));
      zeros.push(C.real(-1));
    }
    // Gain: k_bp = bw^order; k_z = k_bp * prod(2fs - z_s) / prod(2fs - p_s)
    // over the finite analog zeros (all at s=0) and poles.
    const gain = C.real(Math.pow(bw, ORDER)).mul(Math.pow(fs2, ORDER));
    let denom = C.real(1);
    for (let k = 0; k < ORDER; k++) {
      const ang = (PI * (2 * k + 1 + ORDER)) / (2 * ORDER);
      const p = C.polar(1, ang);
      const mid = p.mul(0.5 * bw);
      const disc = C.sqrt(mid.mul(mid).sub(C.real(wo * wo)));
      denom = denom.mul(
        C.real(fs2)
          .sub(mid.add(disc))
          .mul(C.real(fs2).sub(mid.sub(disc)))
      );
    }
    const kz = gain.div(denom).re;

    // Group into biquads: pair each pole with its conjugate and hand the
    // pair its two nearest zeros (the overall response is
    // pairing-independent).
    const sections: Biquad[] = [];
    while (poles.length > 0) {
      const p = poles.pop()!;
      const pc0 = p.conj();
      let best = 0;
      for (let i = 1; i < poles.length; i++) {
        if (poles[i]!.sub(pc0).abs() < poles[best]!.sub(pc0).abs()) {
          best = i;
        }
      }
      const pc = poles.splice(best, 1)[0]!;
      const zpair: C[] = [];
      for (let j = 0; j < 2; j++) {
        let bz = 0;
        for (let i = 1; i < zeros.length; i++) {
          const d = Math.min(zeros[i]!.sub(p).abs(), zeros[i]!.sub(pc).abs());
          const db = Math.min(
            zeros[bz]!.sub(p).abs(),
            zeros[bz]!.sub(pc).abs()
          );
          if (d < db) {
            bz = i;
          }
        }
        zpair.push(zeros.splice(bz, 1)[0]!);
      }
      sections.push({
        b0: 1,
        b1: -zpair[0]!.add(zpair[1]!).re,
        b2: zpair[0]!.mul(zpair[1]!).re,
        a1: -p.add(pc).re,
        a2: p.mul(pc).re,
      });
    }
    // Overall gain on the first section.
    sections[0]!.b0 *= kz;
    sections[0]!.b1 *= kz;
    sections[0]!.b2 *= kz;
    return sections;
  }
}
