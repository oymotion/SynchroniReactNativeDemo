/**
 * Off-JS-thread DSP pipeline: one worklet runtime PER DEVICE, bound via
 * `SensorProfile.useWorkletRuntime(runtime, onData)`. While bound, that
 * device's data batches are processed there (live band filter, display
 * rings, IMU split, FFT spectra) and snapshots are posted back to the JS
 * thread; sensor events stay on the JS thread.
 *
 * Payload buffers are only valid while the data callback runs (see the
 * demo's Clone Data toggle). The pipeline runs as 'worklet' functions on
 * a plain state object held on the runtime's globalThis; DataType values
 * are restated as numeric constants so no library enum crosses into the
 * worklet closure.
 */

import {
  createWorkletRuntime,
  scheduleOnRN,
  scheduleOnRuntime,
} from 'react-native-worklets';
import type { WorkletRuntime } from 'react-native-worklets';
import { SensorData } from '@synchroni/synchroni_sdk_react_native';

type SensorDataPayload = ConstructorParameters<typeof SensorData>[0];
import { computeSpectrum } from './SpectrumCompute';
import type { SpectrumResult } from './SpectrumCompute';

// ---- data type constants (same values as the library's DataType enum) ----

const T_ACC = 0x1;
const T_GYRO = 0x2;
const T_EULER = 0x4;
const T_QUAT = 0x5;
const T_EMG_GEST = 0x7;
const T_EMG_ADC = 0x8;
const T_MAG_ANGLE = 0xd;
const T_EEG = 0x10;
const T_ECG = 0x11;
const T_IMPEDANCE = 0x12;
const T_IMU = 0x13;
const T_BRTH = 0x15;
const T_SPO2_HR = 0x17;
const T_PPG = 0x18;

/** Bio streams keep 1s of history, slower aux streams keep 5s. */
const BIO_TYPES = [T_EMG_ADC, T_EEG, T_ECG, T_BRTH, T_MAG_ANGLE];

/** Bio streams whose samples can carry per-channel impedance extras. */
const IMPEDANCE_TYPES = [T_EMG_ADC, T_EEG, T_ECG, T_BRTH];

/** Streams that pass through the live band filter before the rings. */
const LIVE_FILTER_TYPES = [T_EMG_ADC, T_EEG, T_ECG, T_BRTH, T_PPG, T_SPO2_HR];

/** IMU channel windows -> per-sensor stream types. */
const IMU_SPLIT: Array<[number, number, number]> = [
  [T_ACC, 0, 3],
  [T_GYRO, 3, 6],
  [T_EULER, 6, 9],
  [T_QUAT, 9, 13],
];

// ---- worklet-side state shapes ----------------------------------------------

interface Ring {
  rate: number;
  channelCount: number;
  head: number;
  channels: Float32Array[]; // length = rate * seconds
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface FilterStream {
  band: number;
  rate: number;
  sections: Biquad[];
  zi0: number[][];
  channels: Map<number, number[][]>;
}

interface Pipeline {
  rings: Map<number, Ring>;
  streams: Map<number, FilterStream>;
  /** Cumulative ingested batches (feeds the JS-side demo stats). */
  batches: number;
  /** dataType -> cumulative ingested sample count. */
  samples: Map<number, number>;
  /** channel -> latest impedance value. */
  impedance: Map<number, number>;
  /** Latest gesture sample (gesture/possibility/strength). */
  gesture?: { gesture: number; possibility: number; strength: number };
}

// ---- filter design ----------------------------------------------------------

const BANDS: Array<{ lo: number; hi: number }> = [
  { lo: 0, hi: 0 }, // 0 = Off
  { lo: 0.5, hi: 4 },
  { lo: 4, hi: 8 },
  { lo: 8, hi: 13 },
  { lo: 13, hi: 30 },
  { lo: 30, hi: 45 },
];
const FILTER_ORDER = 4;
const PI = 3.14159265358979323846;

interface Cx {
  re: number;
  im: number;
}

function cx(re: number, im: number): Cx {
  'worklet';
  return { re, im };
}
function cxAbs(c: Cx): number {
  'worklet';
  return Math.hypot(c.re, c.im);
}
function cxPolar(r: number, theta: number): Cx {
  'worklet';
  return cx(r * Math.cos(theta), r * Math.sin(theta));
}
function cxSqrt(c: Cx): Cx {
  'worklet';
  const m = Math.sqrt(cxAbs(c));
  const a = Math.atan2(c.im, c.re) / 2;
  return cx(m * Math.cos(a), m * Math.sin(a));
}
function cxAdd(a: Cx, b: Cx): Cx {
  'worklet';
  return cx(a.re + b.re, a.im + b.im);
}
function cxSub(a: Cx, b: Cx): Cx {
  'worklet';
  return cx(a.re - b.re, a.im - b.im);
}
function cxMul(a: Cx, b: Cx): Cx {
  'worklet';
  return cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}
function cxDiv(a: Cx, b: Cx): Cx {
  'worklet';
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
function cxConj(a: Cx): Cx {
  'worklet';
  return cx(a.re, -a.im);
}

/** Butterworth bandpass design (order 4); null when invalid for the rate. */
function designBandpass(bandIndex: number, fs: number): Biquad[] | null {
  'worklet';
  if (bandIndex <= 0 || bandIndex >= BANDS.length || fs <= 0) {
    return null;
  }
  const band = BANDS[bandIndex]!;
  const lo = band.lo;
  const hi = band.hi;
  if (hi >= fs / 2) {
    return null; // band top beyond Nyquist
  }
  const w1 = 2 * fs * Math.tan((PI * lo) / fs);
  const w2 = 2 * fs * Math.tan((PI * hi) / fs);
  const bw = w2 - w1;
  const wo = Math.sqrt(w1 * w2);
  const fs2 = 2 * fs;

  const poles: Cx[] = [];
  const zeros: Cx[] = [];
  for (let k = 0; k < FILTER_ORDER; k++) {
    const ang = (PI * (2 * k + 1 + FILTER_ORDER)) / (2 * FILTER_ORDER);
    const p = cxPolar(1, ang);
    const mid = cxMul(p, cx(0.5 * bw, 0));
    const disc = cxSqrt(cxSub(cxMul(mid, mid), cx(wo * wo, 0)));
    const sp1 = cxAdd(mid, disc);
    const sp2 = cxSub(mid, disc);
    poles.push(cxDiv(cxAdd(sp1, cx(fs2, 0)), cxSub(cx(fs2, 0), sp1)));
    poles.push(cxDiv(cxAdd(sp2, cx(fs2, 0)), cxSub(cx(fs2, 0), sp2)));
  }
  for (let k = 0; k < FILTER_ORDER; k++) {
    zeros.push(cx(1, 0));
    zeros.push(cx(-1, 0));
  }
  const gain = cxMul(
    cx(Math.pow(bw, FILTER_ORDER), 0),
    cx(Math.pow(fs2, FILTER_ORDER), 0)
  );
  let denom = cx(1, 0);
  for (let k = 0; k < FILTER_ORDER; k++) {
    const ang = (PI * (2 * k + 1 + FILTER_ORDER)) / (2 * FILTER_ORDER);
    const p = cxPolar(1, ang);
    const mid = cxMul(p, cx(0.5 * bw, 0));
    const disc = cxSqrt(cxSub(cxMul(mid, mid), cx(wo * wo, 0)));
    denom = cxMul(
      denom,
      cxMul(
        cxSub(cx(fs2, 0), cxAdd(mid, disc)),
        cxSub(cx(fs2, 0), cxSub(mid, disc))
      )
    );
  }
  const kz = cxDiv(gain, denom).re;

  const sections: Biquad[] = [];
  while (poles.length > 0) {
    const p = poles.pop()!;
    const pc0 = cxConj(p);
    let best = 0;
    for (let i = 1; i < poles.length; i++) {
      if (cxAbs(cxSub(poles[i]!, pc0)) < cxAbs(cxSub(poles[best]!, pc0))) {
        best = i;
      }
    }
    const pc = poles.splice(best, 1)[0]!;
    const zpair: Cx[] = [];
    for (let j = 0; j < 2; j++) {
      let bz = 0;
      for (let i = 1; i < zeros.length; i++) {
        const d = Math.min(
          cxAbs(cxSub(zeros[i]!, p)),
          cxAbs(cxSub(zeros[i]!, pc))
        );
        const db = Math.min(
          cxAbs(cxSub(zeros[bz]!, p)),
          cxAbs(cxSub(zeros[bz]!, pc))
        );
        if (d < db) {
          bz = i;
        }
      }
      zpair.push(zeros.splice(bz, 1)[0]!);
    }
    sections.push({
      b0: 1,
      b1: -cxAdd(zpair[0]!, zpair[1]!).re,
      b2: cxMul(zpair[0]!, zpair[1]!).re,
      a1: -cxAdd(p, pc).re,
      a2: cxMul(p, pc).re,
    });
  }
  sections[0]!.b0 *= kz;
  sections[0]!.b1 *= kz;
  sections[0]!.b2 *= kz;
  return sections;
}

/** Filters one channel batch in place. */
function applyFilter(
  pipe: Pipeline,
  band: number,
  dataType: number,
  channel: number,
  vals: Float32Array,
  sampleRate: number
): void {
  'worklet';
  if (vals.length === 0 || band === 0) {
    return;
  }
  let st = pipe.streams.get(dataType);
  if (!st) {
    st = { band: 0, rate: 0, sections: [], zi0: [], channels: new Map() };
    pipe.streams.set(dataType, st);
  }
  if (st.band !== band || st.rate !== sampleRate) {
    st.sections = [];
    st.zi0 = [];
    st.channels.clear();
    st.band = band;
    st.rate = sampleRate;
    const designed = designBandpass(band, sampleRate);
    if (!designed) {
      return;
    }
    st.sections = designed;
    // Unit-step steady state per section (scipy sosfilt_zi equivalent).
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

// ---- rings ------------------------------------------------------------------

function ensureRing(
  pipe: Pipeline,
  type: number,
  channelCount: number,
  rate: number
): Ring | null {
  'worklet';
  if (channelCount <= 0 || rate <= 0) {
    return null;
  }
  const seconds = BIO_TYPES.indexOf(type) >= 0 ? 1 : 5;
  const length = Math.max(1, Math.round(rate * seconds));
  let ring = pipe.rings.get(type);
  if (ring && ring.channelCount === channelCount && ring.rate === rate) {
    return ring;
  }
  ring = { rate, channelCount, head: 0, channels: [] };
  for (let ch = 0; ch < channelCount; ch++) {
    ring.channels.push(new Float32Array(length));
  }
  pipe.rings.set(type, ring);
  return ring;
}

function appendToRing(ring: Ring, values: Float32Array[]): void {
  'worklet';
  const count = values[0]?.length ?? 0;
  const length = ring.channels[0]?.length ?? 0;
  if (length === 0) {
    return;
  }
  for (let i = 0; i < count; i++) {
    for (let ch = 0; ch < ring.channelCount; ch++) {
      const buf = ring.channels[ch];
      const src = values[ch];
      if (buf && src) {
        buf[ring.head] = src[i] ?? 0;
      }
    }
    ring.head = (ring.head + 1) % length;
  }
}

/** Ordered oldest -> newest copy of one channel. */
function ringChannel(ring: Ring, ch: number): Float32Array {
  'worklet';
  const buf = ring.channels[ch];
  if (!buf || buf.length === 0) {
    return new Float32Array(0);
  }
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[(ring.head + i) % buf.length] ?? 0;
  }
  return out;
}

// ---- batch ingest ------------------------------------------------------------

/**
 * One data batch list for this runtime's device; stale batches (e.g. left
 * over from a restarted stream) are dropped.
 */
function ingestBatch(
  pipe: Pipeline,
  dataList: SensorData[],
  band: number
): void {
  'worklet';
  for (const data of dataList) {
    if (!data.isDataValid()) {
      continue;
    }
    const dataType: number = data.dataType;
    const channelCount = data.channelCount;
    const sampleCount = data.sampleCount;
    const last = sampleCount - 1;
    // Capture the extras the skipped JS data path would have extracted.
    if (dataType === T_EMG_GEST) {
      // gesture=data, possibility=impedance, strength=saturation.
      if (last >= 0 && data.isDataValid(0, last)) {
        pipe.gesture = {
          gesture: data.getData(0, last),
          possibility: data.getImpedance(0, last),
          strength: data.getSaturation(0, last),
        };
      }
      continue; // no display ring for gesture
    }
    if (dataType === T_IMPEDANCE) {
      for (let ch = 0; ch < channelCount; ch++) {
        if (data.isDataValid(ch, last)) {
          pipe.impedance.set(ch, data.getImpedance(ch, last));
        }
      }
      continue; // no display ring for the impedance stream
    }
    const rate = data.sampleRate;
    if (channelCount <= 0 || sampleCount <= 0 || rate <= 0) {
      continue;
    }
    pipe.batches += 1;
    pipe.samples.set(dataType, (pipe.samples.get(dataType) ?? 0) + sampleCount);
    const filter = LIVE_FILTER_TYPES.indexOf(dataType) >= 0;
    const extract = (from: number, to: number): Float32Array[] => {
      const out: Float32Array[] = [];
      for (let ch = from; ch < to; ch++) {
        // Lost samples are masked to 0, matching the JS-thread path.
        const vals = data.getChannelData(ch);
        for (let i = 0; i < sampleCount; i++) {
          if (data.isLost(ch, i)) {
            vals[i] = 0;
          }
        }
        if (filter) {
          applyFilter(pipe, band, dataType, ch, vals, rate);
        }
        out.push(vals);
      }
      return out;
    };
    if (dataType === T_IMU) {
      for (const [type, from, to] of IMU_SPLIT) {
        if (channelCount < to) {
          continue;
        }
        const ring = ensureRing(pipe, type, to - from, rate);
        if (ring) {
          appendToRing(ring, extract(from, to));
        }
      }
    } else {
      const ring = ensureRing(pipe, dataType, channelCount, rate);
      if (ring) {
        appendToRing(ring, extract(0, channelCount));
      }
      // Bio streams can also carry per-sample impedance values.
      if (IMPEDANCE_TYPES.indexOf(dataType) >= 0) {
        for (let ch = 0; ch < channelCount; ch++) {
          if (data.isDataValid(ch, last)) {
            pipe.impedance.set(ch, data.getImpedance(ch, last));
          }
        }
      }
    }
  }
}

// ---- emission back to the RN thread ------------------------------------------

/** [type, channelBuffers] pairs. */
type WaveformEntry = [number, ArrayBuffer[]];
/** [type, rate, freqsBuffer, magBuffers] tuples. */
type SpectrumEntry = [number, number, ArrayBuffer, ArrayBuffer[]];

/**
 * Per-device data entry point handed to
 * `SensorProfile.useWorkletRuntime`; wraps the raw payloads as SensorData.
 * Clone Data (demo UI toggle): ON deep-copies each batch so it stays
 * valid after the callback; OFF consumes batches directly.
 */
const dspOnData = (payloads: SensorDataPayload[]): void => {
  'worklet';
  const g = globalThis as unknown as {
    __dspPipeline?: Pipeline;
    __dspBand: number;
    __dspCloneData: boolean;
  };
  if (!g.__dspPipeline) {
    g.__dspPipeline = {
      rings: new Map(),
      streams: new Map(),
      batches: 0,
      samples: new Map(),
      impedance: new Map(),
    };
  }
  const dataList = payloads.map((p) => new SensorData(p));
  ingestBatch(
    g.__dspPipeline,
    g.__dspCloneData ? dataList.map((d) => d.clone()) : dataList,
    g.__dspBand
  );
};

function emitWaveforms(): void {
  'worklet';
  const g = globalThis as unknown as {
    __dspActive: boolean;
    __dspPipeline?: Pipeline;
    __dspOnWaveform: (entries: WaveformEntry[], statsJson: string) => void;
  };
  // Parked runtime (device unbound): emit nothing.
  if (!g.__dspActive) {
    return;
  }
  const pipe = g.__dspPipeline;
  if (!pipe || pipe.rings.size === 0) {
    return;
  }
  const entries: WaveformEntry[] = [];
  pipe.rings.forEach((ring, type) => {
    const buffers: ArrayBuffer[] = [];
    for (let ch = 0; ch < ring.channelCount; ch++) {
      buffers.push(ringChannel(ring, ch).buffer as ArrayBuffer);
    }
    entries.push([type, buffers]);
  });
  // Ingest stats ride along for the skipped JS data path; they cross
  // runtimes as one JSON string.
  const rates: Array<[number, number]> = [];
  pipe.rings.forEach((ring, type) => {
    rates.push([type, ring.rate]);
  });
  scheduleOnRN(
    g.__dspOnWaveform,
    entries,
    JSON.stringify({
      batches: pipe.batches,
      samples: Array.from(pipe.samples),
      rates: rates,
      impedance: Array.from(pipe.impedance),
      gesture: pipe.gesture,
    })
  );
}

function emitSpectra(): void {
  'worklet';
  const g = globalThis as unknown as {
    __dspActive: boolean;
    __dspPipeline?: Pipeline;
    __dspOnSpectrum: (entries: SpectrumEntry[]) => void;
  };
  if (!g.__dspActive) {
    return;
  }
  const pipe = g.__dspPipeline;
  if (!pipe || pipe.rings.size === 0) {
    return;
  }
  const entries: SpectrumEntry[] = [];
  pipe.rings.forEach((ring, type) => {
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < ring.channelCount; ch++) {
      channels.push(ringChannel(ring, ch));
    }
    const result = computeSpectrum(channels, ring.rate);
    if (result) {
      entries.push([
        type,
        ring.rate,
        result.freqs.buffer as ArrayBuffer,
        result.mags.map((m) => m.buffer as ArrayBuffer),
      ]);
    }
  });
  if (entries.length > 0) {
    scheduleOnRN(g.__dspOnSpectrum, entries);
  }
}

// ---- JS-facing API -------------------------------------------------------------

export interface WaveformSnapshot {
  type: number;
  channels: Float32Array[];
}

export interface SpectrumSnapshot {
  type: number;
  rate: number;
  result: SpectrumResult;
}

/** Per-batch extras for the JS side: latest impedance per channel and
 * the latest EMG gesture sample. */
export interface DspExtras {
  impedance: Array<[number, number]>;
  gesture?: { gesture: number; possibility: number; strength: number };
}

export interface DspHandlers {
  onWaveform: (
    mac: string,
    entries: WaveformSnapshot[],
    batches: number,
    samples: Array<[number, number]>,
    rates: Array<[number, number]>,
    extras: DspExtras
  ) => void;
  onSpectrum: (mac: string, entries: SpectrumSnapshot[]) => void;
}

/** One device's DSP endpoint: the runtime plus the onData worklet to bind. */
export interface DspRuntimeHandle {
  runtime: WorkletRuntime;
  onData: (payloads: SensorDataPayload[]) => void;
}

/**
 * Creates one device's DSP worklet runtime and returns it together with
 * the `onData` worklet — bind both via
 * `SensorProfile.useWorkletRuntime(runtime, onData)`. Sensor events stay
 * on the JS thread.
 */
export function startDspRuntime(
  handlers: DspHandlers,
  mac: string,
  initialBand: number,
  initialCloneData: boolean = false
): DspRuntimeHandle {
  // Decode the emit payload back into Float32Arrays before notifying.
  const onWaveformRaw = (entries: WaveformEntry[], statsJson: string) => {
    const stats = JSON.parse(statsJson) as {
      batches: number;
      samples: Array<[number, number]>;
      rates: Array<[number, number]>;
      impedance?: Array<[number, number]>;
      gesture?: { gesture: number; possibility: number; strength: number };
    };
    handlers.onWaveform(
      mac,
      decodeWaveformEntries(entries),
      stats.batches,
      stats.samples,
      stats.rates,
      { impedance: stats.impedance ?? [], gesture: stats.gesture }
    );
  };
  const onSpectrumRaw = (entries: SpectrumEntry[]) =>
    handlers.onSpectrum(mac, decodeSpectrumEntries(entries));
  const runtime = createWorkletRuntime({
    name: `synchronisdk-dsp-${mac}`,
    initializer: () => {
      'worklet';
      const g = globalThis as unknown as {
        __dspActive: boolean;
        __dspBand: number;
        __dspCloneData: boolean;
        __dspOnWaveform: (entries: WaveformEntry[], statsJson: string) => void;
        __dspOnSpectrum: (entries: SpectrumEntry[]) => void;
      };
      g.__dspActive = true;
      g.__dspBand = initialBand;
      g.__dspCloneData = initialCloneData;
      g.__dspOnWaveform = onWaveformRaw as unknown as (
        entries: WaveformEntry[]
      ) => void;
      g.__dspOnSpectrum = onSpectrumRaw as unknown as (
        entries: SpectrumEntry[]
      ) => void;
      setInterval(emitWaveforms, 50);
      setInterval(emitSpectra, 200);
    },
  });
  return { runtime, onData: dspOnData };
}

/** Switches the runtime's live-filter band (0 = Off). */
export function dspSetBand(runtime: WorkletRuntime, band: number): void {
  scheduleOnRuntime(
    runtime,
    (b: number) => {
      'worklet';
      const g = globalThis as unknown as {
        __dspBand: number;
        __dspPipeline?: Pipeline;
      };
      g.__dspBand = b;
      // A band switch rebuilds every stream's filter state on the next batch.
      g.__dspPipeline?.streams.clear();
    },
    band
  );
}

/** Switches the Clone Data mode for incoming batches. */
export function dspSetCloneData(
  runtime: WorkletRuntime,
  enabled: boolean
): void {
  scheduleOnRuntime(
    runtime,
    (on: boolean) => {
      'worklet';
      (globalThis as unknown as { __dspCloneData: boolean }).__dspCloneData =
        on;
    },
    enabled
  );
}

/**
 * Parks/wakes the runtime and drops its rings. A runtime cannot be
 * destroyed, so an unbound device must be parked explicitly. Call with
 * `false` on unbind/teardown, `true` on (re)bind; both start with fresh
 * rings.
 */
export function dspSetActive(runtime: WorkletRuntime, active: boolean): void {
  scheduleOnRuntime(
    runtime,
    (on: boolean) => {
      'worklet';
      const g = globalThis as unknown as {
        __dspActive: boolean;
        __dspPipeline?: Pipeline;
      };
      g.__dspActive = on;
      g.__dspPipeline = undefined;
    },
    active
  );
}

/** Drops the runtime's rings/filters/stats (disconnect teardown). */
export function dspReset(runtime: WorkletRuntime): void {
  scheduleOnRuntime(runtime, () => {
    'worklet';
    (globalThis as unknown as { __dspPipeline?: Pipeline }).__dspPipeline =
      undefined;
  });
}

/** Decoders for the RN-thread side of the emit payloads. */
export function decodeWaveformEntries(
  entries: WaveformEntry[]
): WaveformSnapshot[] {
  return entries.map(([type, buffers]) => ({
    type,
    channels: buffers.map((b) => new Float32Array(b)),
  }));
}

export function decodeSpectrumEntries(
  entries: SpectrumEntry[]
): SpectrumSnapshot[] {
  return entries.map(([type, rate, freqs, mags]) => ({
    type,
    rate,
    result: {
      freqs: new Float32Array(freqs),
      mags: mags.map((b) => new Float32Array(b)),
    },
  }));
}
