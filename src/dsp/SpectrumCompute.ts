/**
 * Hann-windowed one-sided magnitude spectrum of the snapshot channels:
 * radix-2 FFT over the zero-padded window, amplitudes normalized by the
 * window gain so a peak reads close to the true amplitude.
 *
 * Worklet note: `fft` MUST stay above `computeSpectrum` — a worklet
 * function captures its helper references at module-evaluation time, so a
 * helper defined later would be captured as undefined.
 */

const PI = 3.14159265358979323846;

export interface SpectrumResult {
  /** one-sided frequency axis (nfft/2 + 1 bins, 0 .. rate/2 Hz) */
  freqs: Float32Array;
  /** one magnitude row per input channel, aligned with freqs */
  mags: Float32Array[];
}

/** In-place iterative radix-2 FFT (bit-reversal + butterflies). */
function fft(re: Float64Array, im: Float64Array, n: number): void {
  'worklet';
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * PI) / len;
    const wlenR = Math.cos(ang);
    const wlenI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * wr - im[i + k + len / 2]! * wi;
        const vi = re[i + k + len / 2]! * wi + im[i + k + len / 2]! * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nwr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nwr;
      }
    }
  }
}

/** Returns null for empty/short input (< 16 samples) or an unknown rate. */
export function computeSpectrum(
  channels: ReadonlyArray<ArrayLike<number>>,
  rate: number
): SpectrumResult | null {
  'worklet';
  if (channels.length === 0 || rate <= 0) {
    return null;
  }
  const n = channels[0]?.length ?? 0;
  if (n < 16) {
    return null;
  }
  let nfft = 1;
  while (nfft < n) {
    nfft <<= 1;
  }
  // Hann window over the actual samples (zero tail is not windowed).
  const win = new Float64Array(n);
  let winSum = 0;
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * PI * i) / (n - 1));
    winSum += win[i]!;
  }
  const freqs = new Float32Array(nfft / 2 + 1);
  for (let k = 0; k <= nfft / 2; k++) {
    freqs[k] = (k * rate) / nfft;
  }
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const mags: Float32Array[] = [];
  for (const ch of channels) {
    const m = Math.min(n, ch.length);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < m; i++) {
      re[i] = (ch[i] ?? 0) * win[i]!;
    }
    fft(re, im, nfft);
    const scale = 2 / Math.max(winSum, 1e-12);
    const row = new Float32Array(nfft / 2 + 1);
    for (let k = 0; k <= nfft / 2; k++) {
      row[k] = scale * Math.hypot(re[k]!, im[k]!);
    }
    mags.push(row);
  }
  return { freqs, mags };
}
