import RNFS from 'react-native-fs';
import { NativeModules, Platform } from 'react-native';
import {
  pick,
  keepLocalCopy,
  releaseSecureAccess,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';
import type {
  DocumentPickerOptionsOpenOnce,
  DocumentPickerResponse,
} from '@react-native-documents/picker';
import {
  SensorController,
  DeviceStateEx,
  DataType,
} from '@synchroni/synchroni_sdk_react_native';
import type {
  BLEDevice,
  DeviceInfo,
  MultiDeviceResult,
  SensorData,
  SensorProfile,
} from '@synchroni/synchroni_sdk_react_native';
import { LiveFilter } from '../dsp/LiveFilter';
import {
  startDspRuntime,
  dspSetActive,
  dspSetBand,
  dspSetCloneData,
} from '../dsp/WorkletPipeline';
import type {
  DspExtras,
  DspRuntimeHandle,
  SpectrumSnapshot,
  WaveformSnapshot,
} from '../dsp/WorkletPipeline';
import type { SpectrumResult } from '../dsp/SpectrumCompute';
import { createSerializable } from 'react-native-worklets';
import type { WorkletRuntime } from 'react-native-worklets';

export const SCAN_DEVICE_PERIOD_MS = 3000;
// Grace period before an unseen device leaves the list, so a brief
// dropout does not flicker its row.
const DEVICE_EXPIRE_MS = 2 * SCAN_DEVICE_PERIOD_MS + 1500;
// List refresh throttle; membership changes always refresh immediately.
const DEVICE_LIST_REFRESH_MS = 1000;
export const PACKAGE_COUNT = 32;
export const CMD_TIMEOUT_MS = 5000;
export const PLOT_UPDATE_INTERVAL_MS = 50;
export const POWER_REFRESH_PERIOD_MS = 60000;

interface DemoStorageSpec {
  isAllFilesAccessGranted(): boolean;
  requestAllFilesAccess(): void;
}
// Example-app-only Android module: requests all-files access for session
// logs / .bin exports.
const DemoStorage = NativeModules.DemoStorage as DemoStorageSpec | undefined;

/** One picked bin file: filesystem path plus, on iOS, the picker's
 * security-scoped URL. */
interface PickedBin {
  path: string;
  secureUri?: string;
}
// Spectrum recompute interval.
export const SPECTRUM_UPDATE_INTERVAL_MS = 200;

export const NTF_OPTIONS = [
  { label: 'EEG', key: 'NTF_EEG' },
  { label: 'IMPE', key: 'NTF_IMPEDANCE' },
  { label: 'EMG', key: 'NTF_EMG' },
  { label: 'GESTURE', key: 'NTF_GEST' },
  { label: 'PPG', key: 'NTF_PPG' },
  { label: 'SpO2', key: 'NTF_SPO2' },
  { label: 'IMU', key: 'NTF_IMU' },
  { label: 'Angle', key: 'NTF_ANGLE' },
] as const;

export const FILTER_OPTIONS = [
  { label: '50Hz', key: 'FILTER_50HZ' },
  { label: '60Hz', key: 'FILTER_60HZ' },
  { label: 'HPF', key: 'FILTER_HPF' },
  { label: 'LPF', key: 'FILTER_LPF' },
] as const;

const NTF_KEYS: string[] = NTF_OPTIONS.map((o) => o.key);
const FILTER_KEYS: string[] = FILTER_OPTIONS.map((o) => o.key);

/** `yyyyMMdd_HHmmss` local-time stamp for session log directory names. */
function logDirStamp(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

// Sample-rate radio groups on the Device page; options and the checked
// rate are device-reported.
export const SAMPLE_RATE_CONTROLS = [
  {
    key: 'EEG_SAMPLE_RATE',
    label: 'EEG Sample Rate',
    candidates: [250, 500, 1000, 2000],
  },
  { key: 'EMG_SAMPLE_RATE', label: 'EMG Sample Rate', candidates: [500, 1000] },
  {
    key: 'IMU_SAMPLE_RATE',
    label: 'IMU Sample Rate',
    candidates: [50, 100, 200, 250, 400, 500, 1000, 2000],
  },
  {
    key: 'PPG_SAMPLE_RATE',
    label: 'PPG Sample Rate',
    candidates: [50, 100, 200, 400, 800, 1000, 1600, 3200],
  },
] as const;

// Bio streams keep 1s of history, slower aux streams keep 5s.
const BIO_TYPES = new Set<DataType>([
  DataType.NTF_EMG_ADC,
  DataType.NTF_EEG,
  DataType.NTF_ECG,
  DataType.NTF_BRTH,
  DataType.NTF_ANGLE,
]);

// Bio streams whose samples can carry per-channel impedance extras.
const IMPEDANCE_TYPES = new Set<DataType>([
  DataType.NTF_EMG_ADC,
  DataType.NTF_EEG,
  DataType.NTF_ECG,
  DataType.NTF_BRTH,
]);

// Streams that pass through the Live Filter before the display rings.
const LIVE_FILTER_TYPES = new Set<DataType>([
  DataType.NTF_EMG_ADC,
  DataType.NTF_EEG,
  DataType.NTF_ECG,
  DataType.NTF_BRTH,
  DataType.NTF_PPG,
  DataType.NTF_SPO2_HR,
]);

const RATE_LABEL_ORDER: Array<[DataType, string]> = [
  [DataType.NTF_EEG, 'EEG'],
  [DataType.NTF_ECG, 'ECG'],
  [DataType.NTF_EMG_ADC, 'EMG'],
  [DataType.NTF_BRTH, 'BRTH'],
  [DataType.NTF_PPG, 'PPG'],
  [DataType.NTF_SPO2_HR, 'SPO2'],
  [DataType.NTF_IMU, 'IMU'],
  [DataType.NTF_ACC, 'ACC'],
  [DataType.NTF_GYRO, 'GYRO'],
  [DataType.NTF_EULER, 'EULER'],
  [DataType.NTF_QUAT, 'QUAT'],
  [DataType.NTF_ANGLE, 'Angle'],
];

/** Per-channel circular sample buffer; lost/stale slots read as 0. */
export class RingBuffer {
  public channelCount = 0;
  public length = 0;
  private data: Float32Array[] = [];
  private head = 0;

  public ensureSize(channelCount: number, length: number): void {
    const len = Math.max(1, Math.round(length));
    if (this.channelCount === channelCount && this.length === len) {
      return;
    }
    this.channelCount = channelCount;
    this.length = len;
    this.data = [];
    for (let ch = 0; ch < channelCount; ch++) {
      this.data.push(new Float32Array(len));
    }
    this.head = 0;
  }

  /** New samples per channel; lost slots arrive zero-filled. */
  public appendBatch(channelValues: ReadonlyArray<ArrayLike<number>>): void {
    const count = channelValues[0]?.length ?? 0;
    for (let i = 0; i < count; i++) {
      for (let ch = 0; ch < this.channelCount; ch++) {
        const buf = this.data[ch];
        if (buf) {
          buf[this.head] = channelValues[ch]?.[i] ?? 0;
        }
      }
      this.head = (this.head + 1) % this.length;
    }
  }

  /** Ordered oldest -> newest copy of one channel. */
  public getChannel(ch: number): Float32Array {
    const buf = this.data[ch];
    if (!buf || this.length === 0) {
      return new Float32Array(0);
    }
    const out = new Float32Array(this.length);
    for (let i = 0; i < this.length; i++) {
      out[i] = buf[(this.head + i) % this.length] ?? 0;
    }
    return out;
  }

  public getAllChannels(): Float32Array[] {
    const out: Float32Array[] = [];
    for (let ch = 0; ch < this.channelCount; ch++) {
      out.push(this.getChannel(ch));
    }
    return out;
  }

  public latest(ch: number): number {
    const buf = this.data[ch];
    if (!buf || this.length === 0) {
      return 0;
    }
    return buf[(this.head + this.length - 1) % this.length] ?? 0;
  }

  public clear(): void {
    for (const buf of this.data) {
      buf.fill(0);
    }
    this.head = 0;
  }
}

export interface GestureInfo {
  gesture: number;
  rawGesture: string;
  possibility: number;
  strength: number;
}

export interface DeviceState {
  profile: SensorProfile;
  info?: DeviceInfo;
  power?: number;
  buffers: Map<DataType, RingBuffer>;
  /** Raw impedance per channel. */
  impedance: number[];
  expectedRates: Map<DataType, number>;
  actualRates: Map<DataType, number>;
  rateTotalCounts: Map<DataType, number>;
  rateStreamStartMs: Map<DataType, number>;
  rateStreamTags: Map<DataType, number>;
  rateLastDataMs: number;
  lostCounts: Map<DataType, number>;
  /** Total data batches seen this session */
  batches: number;
  /** Cumulative samples this session. */
  totalSamples: number;
  gesture?: GestureInfo;
  /** per-device bio band filter */
  liveFilter: LiveFilter;
  flowStarted: boolean;
  flowRunning: boolean;
  flowGeneration: number;
  isReplay: boolean;
  /** True while the data stream is actually flowing. */
  streaming: boolean;
  /** Replay only: streaming was observed */
  replayStreamingSeen: boolean;
  /** Stream-start wall clock per data type (Unix seconds, 0 = unknown). */
  streamStartTimeSecs: Map<DataType, number>;
  /** First-packet delay (ms, 0 = not reported) of the current session */
  streamDelayMs: number;
}

type Listener = () => void;

/**
 * Shared demo data layer (singleton). Screens subscribe and re-render on
 * notify(); data batches never notify directly — periodic ticks drive the
 * waveform refresh and the actual-rate stats.
 */
export class DemoController {
  private static _instance: DemoController | undefined;
  public static get Instance(): DemoController {
    return this._instance || (this._instance = new DemoController());
  }

  // scan / selection
  public devices: BLEDevice[] = [];
  public selectedMac: string | undefined;
  /** Live SDK scan state (no JS-side shadow flag). */
  public get scanning(): boolean {
    return SensorController.Instance.isScanning;
  }
  // Last-seen time per scanned device (grace period before removal).
  private scanCache = new Map<
    string,
    { device: BLEDevice; lastSeenAt: number }
  >();
  private lastDeviceListRefreshAt = 0;

  // per-mac state
  public deviceStates = new Map<string, DeviceState>();

  // status line
  public status = 'Idle';

  // SDK version shown on the device page.
  public sdkVersion = '';
  private sdkVersionPromise: Promise<string> = Promise.resolve('');
  /** Current SDK session log/bin directory. */
  private sessionLogDir: string | undefined;

  // settings
  private _autoReconnect = true;
  public debugLogEnabled = true;
  public binDataEnabled = true;
  /**
   * "Translate IMU" toggle: when on, the SDK broadcasts IMU data as the
   * split ACC/GYRO/EULER/QUAT streams instead of the combined IMU stream.
   */
  public translateImu = true;
  /**
   * "Use Worklets" toggle: when on, data batches are processed in a
   * dedicated background runtime instead of on the JS thread. Falls back
   * to the pure-JS path without worklets support.
   */
  public useWorklets = true;
  /**
   * "Clone Data" toggle, worklets path only: ON deep-copies every
   * incoming batch; OFF reads batches directly, valid only until newer
   * data arrives.
   */
  public cloneData = false;
  /** True while at least one device has a bound DSP worklet runtime. */
  public workletsActive = false;
  // Per-device DSP worklet runtimes (mac -> runtime).
  private dspRuntimes = new Map<string, WorkletRuntime>();
  // Idle runtimes kept for reuse: a runtime cannot be dropped once
  // created, so unbound runtimes are parked instead.
  private dspRuntimePool = new Map<string, DspRuntimeHandle>();
  // Worklets path output: mac -> DataType -> channel snapshots / spectra.
  private processedBuffers = new Map<string, Map<number, Float32Array[]>>();
  private spectra = new Map<string, Map<number, SpectrumResult>>();
  // Last cumulative per-type sample totals reported by the DSP runtime.
  private dspCumulative = new Map<string, Map<number, number>>();
  public ntfStates: Record<string, boolean> = {};
  public filterStates: Record<string, boolean> = {};
  // Sample-rate control state per param key: device-reported candidates
  // and current rate (0 = none / unknown).
  public sampleRateOptions: Record<string, number[]> = {};
  public sampleRateCurrent: Record<string, number> = {};

  // Live Filter band selection (0 = Off), shared by every device.
  public liveFilterBand = 0;

  // bin replay
  // Active replay member mac -> bin path (single and group replay alike).
  public replayFiles = new Map<string, string>();
  public replayMac: string | undefined;
  /** Group replay members still running. */
  public replayMacs: string[] = [];
  public replayPaused = false;
  /** Macs with a user-requested replay stop in flight */
  private replayStopRequestedMacs = new Set<string>();

  private listeners = new Set<Listener>();
  // Per-device DEBUG_LOG_PATH read-back cache, re-sent on later sessions.
  private lastLogPaths = new Map<string, string>();
  // Same read-back cache for DEBUG_BLE_DATA_PATH.
  private lastDataPaths = new Map<string, string>();
  // Recorded user setParam history per mac, replayed after an
  // auto-reconnect recovery that restored a last session.
  private savedParamsByMac = new Map<string, Array<[string, string]>>();
  // Macs whose saved params must replay after the recovering stream start.
  private restoreParamsMacs = new Set<string>();
  // Macs currently running the callback-driven recovery chain.
  private autoRecoveryMacs = new Set<string>();
  private plotTimer: ReturnType<typeof setInterval> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;

  private constructor() {
    for (const key of NTF_KEYS) {
      this.ntfStates[key] = true;
    }
    for (const key of FILTER_KEYS) {
      this.filterStates[key] = false;
    }
    this.resetSampleRateStates();
    SensorController.Instance.onScanResult = this.onScanResult;
    SensorController.Instance.onEnableChanged = this.onEnableChanged;
    this.sdkVersionPromise = SensorController.Instance.getVersion()
      .then((v) => {
        this.sdkVersion = v;
        this.notify();
        return v;
      })
      .catch(() => '');
    // Order matters: LOG_PATH first, then DEBUG_ENABLED.
    this.applyLogPath().finally(() => {
      SensorController.Instance.setParam(
        'DEBUG_ENABLED',
        this.debugLogEnabled ? 'True' : 'False'
      ).catch((error: unknown) => console.warn('DEBUG_ENABLED failed', error));
    });
    // Ask for all-files access once per app start (session logs/bins).
    if (Platform.OS === 'android') {
      DemoStorage?.requestAllFilesAccess();
    }
    this.plotTimer = setInterval(() => {
      this.notify();
    }, PLOT_UPDATE_INTERVAL_MS);
    this.statsTimer = setInterval(() => {
      this.settleStats();
    }, 1000);
    if (__DEV__) {
      // DEV ONLY: let host-side CDP probes reach the controller for automated
      // debugging (windowless Xcode "My Mac" runs).
      (globalThis as any).__demoController = this;
      this.dbgCommandTimer = setInterval(() => {
        void this.pollDbgCommand();
      }, 2000);
      // DEV ONLY: React dev builds accumulate undrained performance
      // entries that balloon memory in long sessions; drain them
      // periodically.
      this.perfDrainTimer = setInterval(() => {
        try {
          performance.clearMeasures();
          performance.clearMarks();
        } catch {
          // draining must never fail the app
        }
      }, 30000);
    }
  }

  /** Remove timers/listeners. Native teardown (terminate) is intentionally left out. */
  public release(): void {
    if (this.plotTimer) {
      clearInterval(this.plotTimer);
      this.plotTimer = undefined;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
    if (this.dbgCommandTimer) {
      clearInterval(this.dbgCommandTimer);
      this.dbgCommandTimer = undefined;
    }
    if (this.perfDrainTimer) {
      clearInterval(this.perfDrainTimer);
      this.perfDrainTimer = undefined;
    }
    this.listeners.clear();
    SensorController.Instance.onEnableChanged = undefined;
    this.unbindAllWorklets();
  }

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public notify(): void {
    this.listeners.forEach((l) => l());
  }

  // ---------- worklets DSP path ----------

  /**
   * Idempotent per-device bind: routes this device's data batches to its
   * pooled DSP worklet runtime instead of the JS thread. A runtime cannot
   * be dropped once created, so teardown parks it for reuse.
   */
  private ensureWorkletBinding(st: DeviceState): void {
    if (!this.useWorklets) {
      return;
    }
    const mac = st.profile.BLEDevice.Address;
    if (this.dspRuntimes.has(mac)) {
      return;
    }
    try {
      let handle = this.dspRuntimePool.get(mac);
      if (!handle) {
        handle = startDspRuntime(
          {
            onWaveform: this.onDspWaveform,
            onSpectrum: this.onDspSpectrum,
          },
          mac,
          this.liveFilterBand,
          this.cloneData
        );
        this.dspRuntimePool.set(mac, handle);
      }
      if (
        st.profile.useWorkletRuntime(
          handle.runtime,
          // Serialize the worklet so it can cross into the runtime
          // (static import required under Metro).
          createSerializable(handle.onData) as object
        )
      ) {
        this.dspRuntimes.set(mac, handle.runtime);
        this.workletsActive = true;
        // Re-apply the current settings; a pooled runtime's may be stale.
        dspSetActive(handle.runtime, true);
        dspSetBand(handle.runtime, this.liveFilterBand);
        dspSetCloneData(handle.runtime, this.cloneData);
      }
    } catch (error) {
      console.warn('worklets init failed', error);
    }
  }

  /** Unbinds every device's worklet runtime (toggle off / release). */
  private unbindAllWorklets(): void {
    this.dspRuntimes.forEach((runtime, mac) => {
      this.deviceStates.get(mac)?.profile.useWorkletRuntime(null);
      dspSetActive(runtime, false);
    });
    this.dspRuntimes.clear();
    this.workletsActive = false;
  }

  /** True when this device's data batches are routed to its DSP worklet runtime. */
  public isWorkletsBound(st: DeviceState): boolean {
    return this.dspRuntimes.has(st.profile.BLEDevice.Address);
  }

  /** DSP runtime waveform callback: store only, no notify — the plot
   * timer already drives re-renders. Carries the ingest stats the
   * skipped JS data path would have produced. */
  private onDspWaveform = (
    mac: string,
    entries: WaveformSnapshot[],
    batches: number,
    samples: Array<[number, number]>,
    rates: Array<[number, number]>,
    extras: DspExtras
  ): void => {
    const st = this.deviceStates.get(mac);
    if (!st) {
      // Drop late emissions for a torn-down device.
      return;
    }
    let byType = this.processedBuffers.get(mac);
    if (!byType) {
      byType = new Map();
      this.processedBuffers.set(mac, byType);
    }
    for (const entry of entries) {
      byType.set(entry.type, entry.channels);
    }
    st.batches = batches;
    let cum = this.dspCumulative.get(mac);
    if (!cum) {
      cum = new Map();
      this.dspCumulative.set(mac, cum);
    }
    for (const [type, total] of samples) {
      const prev = cum.get(type) ?? 0;
      cum.set(type, total);
      const delta = total - prev;
      if (delta > 0) {
        const t = type as DataType;
        this.noteRateSamples(st, t, 0, delta);
        st.totalSamples += delta;
      }
    }
    for (const [type, rate] of rates) {
      st.expectedRates.set(type as DataType, rate);
    }
    // Extras the skipped JS data path would have extracted.
    for (const [ch, value] of extras.impedance) {
      st.impedance[ch] = value;
    }
    if (extras.gesture) {
      st.gesture = { ...extras.gesture, rawGesture: '-' };
    }
  };

  private onDspSpectrum = (mac: string, entries: SpectrumSnapshot[]): void => {
    if (!this.deviceStates.has(mac)) {
      // Drop late emissions for a torn-down device.
      return;
    }
    let byType = this.spectra.get(mac);
    if (!byType) {
      byType = new Map();
      this.spectra.set(mac, byType);
    }
    for (const entry of entries) {
      byType.set(entry.type, entry.result);
    }
  };

  public setUseWorklets = (enabled: boolean): void => {
    this.appLog(`User: use worklets ${enabled ? 'ON' : 'OFF'}`);
    this.useWorklets = enabled;
    if (enabled) {
      this.deviceStates.forEach((st) => this.ensureWorkletBinding(st));
    } else {
      this.unbindAllWorklets();
    }
    // Both data paths start clean so the switch is visible immediately.
    this.processedBuffers.clear();
    this.spectra.clear();
    this.deviceStates.forEach((st) => {
      this.clearBuffers(st);
      st.liveFilter.reset();
    });
    this.notify();
  };

  public setCloneData = (enabled: boolean): void => {
    this.appLog(`User: clone data ${enabled ? 'ON' : 'OFF'}`);
    this.cloneData = enabled;
    // Forward the switch to every bound DSP runtime.
    this.dspRuntimes.forEach((runtime) => dspSetCloneData(runtime, enabled));
    this.notify();
  };

  // ---------- view helpers (data-source agnostic) ----------

  /**
   * Ordered channel snapshots for the waveform views: from the device's DSP
   * worklet runtime when bound, otherwise the JS-path rings.
   */
  public getDisplayChannels(st: DeviceState, type: DataType): Float32Array[] {
    if (this.isWorkletsBound(st)) {
      return (
        this.processedBuffers.get(st.profile.BLEDevice.Address)?.get(type) ?? []
      );
    }
    return st.buffers.get(type)?.getAllChannels() ?? [];
  }

  public getDisplayChannelCount(st: DeviceState, type: DataType): number {
    if (this.isWorkletsBound(st)) {
      return (
        this.processedBuffers.get(st.profile.BLEDevice.Address)?.get(type)
          ?.length ?? 0
      );
    }
    return st.buffers.get(type)?.channelCount ?? 0;
  }

  public getDisplayLatest(
    st: DeviceState,
    type: DataType,
    channel: number
  ): number {
    if (this.isWorkletsBound(st)) {
      const arr = this.processedBuffers
        .get(st.profile.BLEDevice.Address)
        ?.get(type)?.[channel];
      return arr && arr.length > 0 ? arr[arr.length - 1]! : 0;
    }
    return st.buffers.get(type)?.latest(channel) ?? 0;
  }

  /** Latest spectrum for a type, worklets path only (null on the JS path). */
  public getSpectrumFor(
    st: DeviceState,
    type: DataType
  ): SpectrumResult | null {
    if (!this.isWorkletsBound(st)) {
      return null;
    }
    return this.spectra.get(st.profile.BLEDevice.Address)?.get(type) ?? null;
  }

  /**
   * Writes one app event line into the SDK log (the active device's log
   * when there is one), so app and SDK records share one timeline.
   * level: "D"/"I"/"W"/"E"; never throws.
   */
  public appLog = (
    message: string,
    level: string = 'I',
    st?: DeviceState
  ): void => {
    try {
      const target = st ?? this.getActiveState();
      if (target) {
        target.profile.log(message, level);
      } else {
        SensorController.Instance.log(message, level);
      }
    } catch {
      // logging must never fail the action it annotates
    }
  };

  // ---------- scan ----------

  // The SDK pushes BT adapter on/off; only the off transition needs UI action.
  private onEnableChanged = (enabled: boolean): void => {
    if (!enabled) {
      this.status = 'Please enable Bluetooth first';
      this.notify();
    }
  };

  private onScanResult = (deviceList: BLEDevice[]): void => {
    // Merge the delivery into the seen cache and refresh the list; an
    // empty delivery (scan just stopped) leaves the list untouched.
    if (deviceList.length === 0) {
      return;
    }
    const now = Date.now();
    deviceList.forEach((d) =>
      this.scanCache.set(d.Address, { device: { ...d }, lastSeenAt: now })
    );
    this.refreshDeviceList(now);
  };

  // Rebuilds the visible list: drops devices unseen past the grace period,
  // keeps connected devices listed, and keeps rows in a stable order.
  // Membership changes refresh immediately; the rest is throttled.
  private refreshDeviceList(now: number, force = false): void {
    for (const [mac, entry] of this.scanCache) {
      if (now - entry.lastSeenAt > DEVICE_EXPIRE_MS) {
        this.scanCache.delete(mac);
      }
    }
    const merged = this.mergeLiveDevices(
      [...this.scanCache.values()].map((entry) => entry.device)
    );
    const byMac = new Map(merged.map((d) => [d.Address, d]));
    const next: BLEDevice[] = [];
    for (const old of this.devices) {
      const current = byMac.get(old.Address);
      if (current) {
        next.push(current);
        byMac.delete(old.Address);
      }
    }
    next.push(...byMac.values());
    const membershipChanged =
      next.length !== this.devices.length ||
      next.some((d, i) => d.Address !== this.devices[i]?.Address);
    const rssiChanged = next.some((d, i) => d.RSSI !== this.devices[i]?.RSSI);
    if (!membershipChanged && !rssiChanged) {
      return;
    }
    if (
      !force &&
      !membershipChanged &&
      now - this.lastDeviceListRefreshAt < DEVICE_LIST_REFRESH_MS
    ) {
      return;
    }
    this.lastDeviceListRefreshAt = now;
    this.devices = next;
    if (!this.selectedMac && this.devices.length > 0) {
      this.selectedMac = this.devices[0]?.Address;
    }
    this.notify();
  }

  // Connected devices vanish from scan results; keep them listed until
  // they disconnect.
  private mergeLiveDevices(scanned: BLEDevice[]): BLEDevice[] {
    const merged = scanned.map((d) => ({ ...d }));
    const seen = new Set(merged.map((d) => d.Address));
    this.deviceStates.forEach((st, mac) => {
      if (
        !seen.has(mac) &&
        st.profile.deviceState !== DeviceStateEx.Disconnected
      ) {
        merged.push({ ...st.profile.BLEDevice });
      }
    });
    merged.sort((a, b) => b.RSSI - a.RSSI);
    return merged;
  }

  public startScanning = async (): Promise<void> => {
    if (!SensorController.Instance.isEnable) {
      this.appLog('User: start scan rejected (Bluetooth disabled)', 'W');
      this.status = 'Please enable bluetooth';
      this.notify();
      return;
    }
    this.appLog('User: start scan');
    const ok = await SensorController.Instance.startScan(SCAN_DEVICE_PERIOD_MS);
    this.status = ok ? 'Scanning ...' : 'Scan failed, try again';
    this.notify();
  };

  public stopScanning = async (): Promise<void> => {
    this.appLog('Stop scan');
    await SensorController.Instance.stopScan();
    this.status = 'Scan stopped';
    this.notify();
  };

  public selectDevice = (mac: string): void => {
    this.selectedMac = mac;
    this.notify();
  };

  // ---------- connect / disconnect ----------

  public connectSelected = async (): Promise<void> => {
    const mac = this.selectedMac;
    const device = this.devices.find((d) => d.Address === mac);
    if (!mac || !device) {
      this.appLog('User: connect rejected (no device selected)', 'W');
      this.status = 'Select a device first';
      this.notify();
      return;
    }
    this.appLog(`User: connect ${device.Name} (${mac})`);
    // Stop an active scan before connecting.
    if (this.scanning) {
      await this.stopScanning();
    }
    const profile = SensorController.Instance.requireSensor(device);
    if (!profile) {
      this.appLog(`App: failed to create SensorProfile for ${mac}`, 'E');
      this.status = 'Connect failed: invalid device';
      this.notify();
      return;
    }
    const st = this.ensureState(mac, profile);
    st.isReplay = false;
    this.attachProfileCallbacks(st);
    profile.autoReconnect = this._autoReconnect;
    this.status = `Connecting: ${device.Name}`;
    this.notify();
    const ok = await profile.connect();
    if (!ok && !profile.isReady) {
      this.status = `Connect failed: ${device.Name}`;
      this.notify();
    }
  };

  public disconnectSelected = async (): Promise<void> => {
    const st = this.selectedMac
      ? this.deviceStates.get(this.selectedMac)
      : undefined;
    if (!st) {
      this.status = 'Select a device first';
      this.notify();
      return;
    }
    this.appLog(`User: disconnect ${st.profile.BLEDevice.Address}`, 'I', st);
    this.status = `Disconnecting: ${st.profile.BLEDevice.Name}`;
    this.notify();
    await st.profile.disconnect();
  };

  private ensureState(mac: string, profile: SensorProfile): DeviceState {
    let st = this.deviceStates.get(mac);
    if (!st) {
      st = {
        profile,
        info: undefined,
        power: undefined,
        buffers: new Map<DataType, RingBuffer>(),
        impedance: [],
        expectedRates: new Map<DataType, number>(),
        actualRates: new Map<DataType, number>(),
        rateTotalCounts: new Map<DataType, number>(),
        rateStreamStartMs: new Map<DataType, number>(),
        rateStreamTags: new Map<DataType, number>(),
        rateLastDataMs: 0,
        lostCounts: new Map<DataType, number>(),
        batches: 0,
        totalSamples: 0,
        gesture: undefined,
        liveFilter: new LiveFilter(),
        flowStarted: false,
        flowRunning: false,
        flowGeneration: 0,
        isReplay: false,
        streaming: false,
        replayStreamingSeen: false,
        streamStartTimeSecs: new Map<DataType, number>(),
        streamDelayMs: 0,
      };
      this.deviceStates.set(mac, st);
    }
    // A band selected before this device appeared still applies to it.
    st.liveFilter.setBand(this.liveFilterBand);
    return st;
  }

  private attachProfileCallbacks(st: DeviceState): void {
    const { profile } = st;
    profile.onStateChange = (_sensor: SensorProfile, newstate: DeviceStateEx) =>
      this.onStateChange(st, newstate);
    profile.onErrorCallback = (_sensor: SensorProfile, reason: string) => {
      this.appLog(`App: error callback: ${String(reason)}`, 'E', st);
      this.status = `Error: ${String(reason)}`;
      this.notify();
    };
    profile.onSensorNotifyData = (
      _sensor: SensorProfile,
      dataList: SensorData[]
    ) => {
      for (const data of dataList) {
        this.onData(st, data);
      }
    };
    profile.onPowerChanged = (_sensor: SensorProfile, power: number) => {
      st.power = power;
      this.notify();
    };
    profile.onDeviceInfoUpdate = (_sensor: SensorProfile, info: DeviceInfo) => {
      st.info = info;
      this.seedSampleRateCurrent(info);
      if (st.flowStarted) {
        this.updateConnectedStatus(st);
      }
      this.notify();
    };
    // When enabled, the app takes over session recovery and replays the
    // recorded setParam history after the stream start.
    profile.onAutoReconnect = (
      sensor: SensorProfile,
      hasLastSession: boolean,
      answer: (takeover: boolean) => void
    ) => {
      this.appLog(
        `App: auto reconnect callback received, restore=${
          hasLastSession ? 'True' : 'False'
        }`,
        'I',
        st
      );
      const mac = sensor.BLEDevice.Address;
      if (!this._autoReconnect) {
        sensor.autoReconnect = false;
        this.autoRecoveryMacs.delete(mac);
        this.restoreParamsMacs.delete(mac);
        answer(false);
        return;
      }
      answer(true);
      this.autoRecoveryMacs.add(mac);
      if (hasLastSession) {
        this.restoreParamsMacs.add(mac);
      }
      const recovered = this.ensureState(mac, sensor);
      recovered.isReplay = false;
      this.selectedMac = mac;
      this.status = `Connection restored, recovering session: ${sensor.BLEDevice.Name} (${mac})`;
      this.notify();
      if (sensor.isReady) {
        this.runReadyChain(recovered);
      }
    };
    // Authoritative stream on/off push (also fires on link loss and
    // replay EOF). Drives the [Streaming] list mark and the replay-done
    // log.
    profile.onDataTransferStateChange = (
      _sensor: SensorProfile,
      isTransferring: boolean
    ) => {
      const mac = st.profile.BLEDevice.Address;
      st.streaming = isTransferring;
      this.appLog(
        `App: data stream ${isTransferring ? 'ON' : 'OFF'} ${mac}`,
        'I',
        st
      );
      if (st.isReplay) {
        if (isTransferring) {
          st.replayStreamingSeen = true;
        } else {
          const stopRequested = this.replayStopRequestedMacs.delete(mac);
          const isMember =
            this.replayMac === mac || this.replayMacs.includes(mac);
          if ((isMember && st.replayStreamingSeen) || stopRequested) {
            // Replay EOF or user stop; the per-mac stop flag
            // distinguishes them (the other replay bookkeeping may
            // already be cleared).
            const message = stopRequested
              ? 'Replay stopped'
              : `Replay finished (${st.batches} batches, ${st.totalSamples} samples)`;
            st.replayStreamingSeen = false;
            this.appLog(`App: replay done: ${message}`, 'I', st);
            this.status = message;
            // DEV ONLY: memory-soak loop — restart after a natural EOF
            // (never after Stop).
            if (
              !stopRequested &&
              this.debugReplayLoop &&
              (this.replayMac === mac || this.replayMacs.includes(mac))
            ) {
              setTimeout(() => {
                void this.debugReplayLatestBin();
              }, 500);
            }
          }
        }
      }
      this.notify();
    };
  }

  private onStateChange(st: DeviceState, newstate: DeviceStateEx): void {
    const mac = st.profile.BLEDevice.Address;
    if (newstate === DeviceStateEx.Ready) {
      if (st.isReplay) {
        st.flowStarted = true;
        this.status = `Replaying: ${st.profile.BLEDevice.Name}`;
        this.notify();
      } else {
        this.runReadyChain(st);
      }
    } else if (newstate === DeviceStateEx.Disconnected) {
      this.autoRecoveryMacs.delete(mac);
      if (st.isReplay) {
        // Replay EOF/stop: the OFF push already logged and set the
        // status; just tear down here.
        this.teardownState(st);
      } else {
        // Disconnect tears the UI state down; auto-reconnect recovery
        // rebuilds it once the link is back.
        this.restoreParamsMacs.delete(mac);
        this.teardownState(st);
        // Keep the just-disconnected device listed for the scan grace
        // period.
        this.scanCache.set(mac, {
          device: { ...st.profile.BLEDevice },
          lastSeenAt: Date.now(),
        });
        this.status = 'Disconnected (device)';
        this.appLog(`App: device disconnected, removed from UI: ${mac}`);
      }
      if (st.isReplay) {
        this.replayFiles.delete(mac);
        this.replayMacs = this.replayMacs.filter((m) => m !== mac);
        if (this.replayMac === mac) {
          this.replayMac = undefined;
        }
        if (!this.replayActive()) {
          this.replayPaused = false;
        }
      }
      this.notify();
    }
  }

  private teardownState(st: DeviceState): void {
    st.flowStarted = false;
    st.flowGeneration += 1;
    st.streaming = false;
    st.replayStreamingSeen = false;
    st.buffers.forEach((b) => b.clear());
    // Drop the filter state; the band selection survives.
    st.liveFilter.reset();
    const mac = st.profile.BLEDevice.Address;
    this.processedBuffers.delete(mac);
    this.spectra.delete(mac);
    // Unbind the device's DSP runtime and park it for reuse.
    const dspRuntime = this.dspRuntimes.get(mac);
    if (dspRuntime) {
      this.dspRuntimes.delete(mac);
      st.profile.useWorkletRuntime(null);
      dspSetActive(dspRuntime, false);
      this.workletsActive = this.dspRuntimes.size > 0;
    }
    st.impedance = [];
    st.gesture = undefined;
    st.power = undefined;
    st.expectedRates.clear();
    st.actualRates.clear();
    st.rateTotalCounts.clear();
    st.rateStreamStartMs.clear();
    st.rateStreamTags.clear();
    st.rateLastDataMs = 0;
    st.streamStartTimeSecs.clear();
    st.lostCounts.clear();
    st.batches = 0;
    st.totalSamples = 0;
    this.dspCumulative.delete(mac);
    this.resetSampleRateStates();
    // A finished/stopped replay leaves the UI entirely; real devices keep
    // their state row.
    if (st.isReplay) {
      this.deviceStates.delete(mac);
    }
  }

  private async shouldContinueAutoRecovery(
    st: DeviceState,
    autoRecovery: boolean,
    generation: number
  ): Promise<boolean> {
    const { profile } = st;
    const mac = profile.BLEDevice.Address;
    if (
      st.flowGeneration !== generation ||
      profile.deviceState === DeviceStateEx.Disconnected
    ) {
      return false;
    }
    if (!autoRecovery) {
      return true;
    }
    let nativeEnabled = false;
    try {
      nativeEnabled = await profile.autoReconnect;
    } catch (error) {
      console.warn('getAutoReconnect failed', error);
    }
    if (st.flowGeneration !== generation) {
      return false;
    }
    if (this._autoReconnect && nativeEnabled) {
      return true;
    }
    profile.autoReconnect = false;
    this.autoRecoveryMacs.delete(mac);
    this.restoreParamsMacs.delete(mac);
    return false;
  }

  private async runReadyChain(st: DeviceState): Promise<void> {
    if (st.flowRunning) {
      return;
    }
    const { profile } = st;
    const name = profile.BLEDevice.Name;
    const mac = profile.BLEDevice.Address;
    const autoRecovery = this.autoRecoveryMacs.has(mac);
    const generation = st.flowGeneration;
    st.flowRunning = true;
    try {
      if (
        !(await this.shouldContinueAutoRecovery(st, autoRecovery, generation))
      ) {
        return;
      }
      if (st.flowStarted && profile.hasInited) {
        this.autoRecoveryMacs.delete(mac);
        this.updateConnectedStatus(st);
        return;
      }
      this.status = `Initializing: ${name}`;
      this.notify();
      if (!profile.hasInited) {
        const ok = await profile.init(PACKAGE_COUNT, POWER_REFRESH_PERIOD_MS);
        if (!ok) {
          this.appLog(
            `App: failed to initialize ${name} (${profile.BLEDevice.Address})`,
            'E',
            st
          );
          throw new Error('init failed');
        }
      }
      const info = await profile.fetchDeviceInfo();
      if (info) {
        st.info = info;
        this.seedSampleRateCurrent(info);
      }
      if (!profile.isDataTransfering) {
        try {
          await profile.startDataNotification();
        } catch (error) {
          this.appLog(
            `App: failed to start data stream on ${profile.BLEDevice.Address}`,
            'E',
            st
          );
          throw error;
        }
        this.appLog(
          `App: device connected and streaming: ${name} (${profile.BLEDevice.Address})`,
          'I',
          st
        );
      }
      if (this.debugLogEnabled) {
        // Apply the per-device log path, then read back and cache the
        // actual path.
        try {
          await profile.setParam(
            'DEBUG_LOG_PATH',
            this.lastLogPaths.get(mac) ?? 'True'
          );
          try {
            const current = await profile.getParam('DEBUG_LOG_PATH');
            if (current && !/^error/i.test(current)) {
              this.lastLogPaths.set(mac, current);
            }
          } catch (error) {
            console.warn('getParam(DEBUG_LOG_PATH) failed', error);
          }
        } catch (error) {
          console.warn('DEBUG_LOG_PATH failed', error);
        }
      }
      if (this.binDataEnabled) {
        // Apply the cached data path, then read back and cache the
        // resolved path.
        try {
          const path = this.lastDataPaths.get(mac) ?? 'True';
          await profile.setParam('DEBUG_BLE_DATA_PATH', path);
          try {
            const current = await profile.getParam('DEBUG_BLE_DATA_PATH');
            if (current && !/^error/i.test(current)) {
              this.lastDataPaths.set(mac, current);
            }
          } catch (error) {
            console.warn('getParam(DEBUG_BLE_DATA_PATH) failed', error);
          }
        } catch (error) {
          console.warn('DEBUG_BLE_DATA_PATH failed', error);
        }
      }
      // A recovery with a restored session replays the setParam history;
      // a normal session start just reads the control states back.
      if (this.restoreParamsMacs.delete(mac)) {
        await this.restoreSavedParams(mac, 0, autoRecovery, generation);
      } else {
        await this.refreshParamStates(st, autoRecovery, generation);
      }
      try {
        st.power = await profile.getBatteryLevel();
      } catch (error) {
        console.warn('getBatteryLevel failed', error);
      }
      if (
        st.flowGeneration !== generation ||
        profile.deviceState !== DeviceStateEx.Ready
      ) {
        return;
      }
      // Idempotent; also re-binds after an auto-reconnect recovery
      // re-runs this chain.
      this.ensureWorkletBinding(st);
      st.flowStarted = true;
      this.autoRecoveryMacs.delete(mac);
      this.updateConnectedStatus(st);
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    } finally {
      const interrupted = st.flowGeneration !== generation;
      st.flowRunning = false;
      this.notify();
      if (
        interrupted &&
        !st.isReplay &&
        profile.deviceState === DeviceStateEx.Ready
      ) {
        this.runReadyChain(st);
      }
    }
  }

  private updateConnectedStatus(st: DeviceState): void {
    const summary = st.info ? this.streamSummary(st.info) : '';
    this.status =
      `Connected: ${st.profile.BLEDevice.Name}` +
      (summary ? ` | ${summary}` : '');
  }

  private streamSummary(info: DeviceInfo): string {
    const parts: string[] = [];
    const add = (label: string, ch: number, rate: number) => {
      if (ch > 0) {
        parts.push(`${label} ${ch}ch @ ${rate}Hz`);
      }
    };
    add('EEG', info.EegChannelCount, info.EegSampleRate);
    add('ECG', info.EcgChannelCount, info.EcgSampleRate);
    add('EMG', info.EmgChannelCount, info.EmgSampleRate);
    add('BRTH', info.BrthChannelCount, info.BrthSampleRate);
    add('PPG', info.PpgChannelCount, info.PpgSampleRate);
    add('SpO2', info.Spo2ChannelCount, info.Spo2SampleRate);
    add('ACC', info.AccChannelCount, info.AccSampleRate);
    add('GYRO', info.GyroChannelCount, info.GyroSampleRate);
    return parts.join(' | ');
  }

  // ---------- data ----------

  private onData = (st: DeviceState, data: SensorData): void => {
    st.batches += 1;
    st.totalSamples += data.sampleCount;
    st.expectedRates.set(data.dataType, data.sampleRate);
    if (data.sampleCount > 0 && data.channelCount > 0) {
      const fresh = data.isDataValid();
      let valid = 0;
      if (fresh && data.isChannelEnabled(0)) {
        for (let i = 0; i < data.sampleCount; i++) {
          if (!data.isLost(0, i)) {
            valid++;
          }
        }
      }
      this.noteRateSamples(st, data.dataType, data.startTimeStamp, valid);
    }
    st.lostCounts.set(
      data.dataType,
      (st.lostCounts.get(data.dataType) ?? 0) + data.lostPackageCount
    );
    // Stream-start wall clock per data type + first-packet delay for the
    // status line.
    if (data.startTimeSec > 0) {
      st.streamStartTimeSecs.set(data.dataType, data.startTimeSec);
    }
    if (data.delay > 0) {
      st.streamDelayMs = data.delay;
    }

    const last = data.sampleCount - 1;
    if (last < 0 || data.channelCount <= 0) {
      return;
    }

    if (data.dataType === DataType.NTF_EMG_GEST) {
      // gesture=data, possibility=impedance, strength=saturation; raw gesture stays '-'.
      if (data.isDataValid(0, last)) {
        st.gesture = {
          gesture: data.getData(0, last),
          rawGesture: '-',
          possibility: data.getImpedance(0, last),
          strength: data.getSaturation(0, last),
        };
      }
      return;
    }

    if (data.dataType === DataType.NTF_IMPEDANCE) {
      for (let ch = 0; ch < data.channelCount; ch++) {
        if (data.isDataValid(ch, last)) {
          st.impedance[ch] = data.getImpedance(ch, last);
        }
      }
      return;
    }

    if (data.dataType === DataType.NTF_IMU) {
      // Split the aggregate IMU stream into per-sensor channel windows.
      const split: Array<[DataType, number, number]> = [
        [DataType.NTF_ACC, 0, 3],
        [DataType.NTF_GYRO, 3, 6],
        [DataType.NTF_EULER, 6, 9],
        [DataType.NTF_QUAT, 9, 13],
      ];
      const fresh = data.isDataValid();
      for (const [type, from, to] of split) {
        if (data.channelCount < to) {
          continue;
        }
        let valid = 0;
        if (fresh && data.isChannelEnabled(0)) {
          for (let i = 0; i < data.sampleCount; i++) {
            if (!data.isLost(from, i)) {
              valid++;
            }
          }
        }
        if (valid > 0) {
          this.noteRateSamples(st, type, data.startTimeStamp, valid);
        }
        st.expectedRates.set(type, data.sampleRate);
        if (data.startTimeSec > 0) {
          st.streamStartTimeSecs.set(type, data.startTimeSec);
        }
        if (this.isWorkletsBound(st)) {
          // The DSP runtime maintains the display rings for these types.
          continue;
        }
        const values: Float32Array[] = [];
        for (let ch = from; ch < to; ch++) {
          values.push(data.getChannelData(ch));
        }
        this.appendToBuffer(st, type, values, data.sampleRate);
      }
      return;
    }

    if (this.isWorkletsBound(st)) {
      // The DSP runtime handles the waveforms; the JS path keeps only
      // the stats above plus the impedance extras.
      if (IMPEDANCE_TYPES.has(data.dataType)) {
        for (let ch = 0; ch < data.channelCount; ch++) {
          if (data.isDataValid(ch, last)) {
            st.impedance[ch] = data.getImpedance(ch, last);
          }
        }
      }
      return;
    }

    // Bio streams pass through the Live Filter before the display rings.
    const filter = LIVE_FILTER_TYPES.has(data.dataType);
    const values: Float32Array[] = [];
    for (let ch = 0; ch < data.channelCount; ch++) {
      const channelValues = data.getChannelData(ch);
      if (filter) {
        st.liveFilter.apply(data.dataType, ch, channelValues, data.sampleRate);
      }
      values.push(channelValues);
    }
    this.appendToBuffer(st, data.dataType, values, data.sampleRate);

    // Bio streams can carry impedance extras on their samples.
    if (IMPEDANCE_TYPES.has(data.dataType)) {
      for (let ch = 0; ch < data.channelCount; ch++) {
        if (data.isDataValid(ch, last)) {
          st.impedance[ch] = data.getImpedance(ch, last);
        }
      }
    }
  };

  private appendToBuffer(
    st: DeviceState,
    type: DataType,
    channelValues: ReadonlyArray<ArrayLike<number>>,
    sampleRate: number
  ): void {
    let buf = st.buffers.get(type);
    if (!buf) {
      buf = new RingBuffer();
      st.buffers.set(type, buf);
    }
    const seconds = BIO_TYPES.has(type) ? 1.0 : 5.0;
    buf.ensureSize(channelValues.length, sampleRate * seconds);
    buf.appendBatch(channelValues);
  }

  private noteRateSamples(
    st: DeviceState,
    type: DataType,
    sessionTag: number,
    valid: number
  ): void {
    if (valid <= 0) {
      return;
    }
    const now = Date.now();
    if (st.rateStreamTags.get(type) !== sessionTag) {
      st.rateStreamTags.set(type, sessionTag);
      st.rateTotalCounts.set(type, 0);
      st.rateStreamStartMs.set(type, now);
    }
    st.rateTotalCounts.set(type, (st.rateTotalCounts.get(type) ?? 0) + valid);
    st.rateLastDataMs = now;
  }

  private settleStats(): void {
    const now = Date.now();
    // While scanning, expire unseen devices; after the scan stops the
    // last known list stays unchanged.
    if (this.scanning) {
      this.refreshDeviceList(now, true);
    }
    this.deviceStates.forEach((st) => {
      if (st.rateLastDataMs > 0 && now - st.rateLastDataMs > 2000) {
        st.actualRates.clear();
        st.rateTotalCounts.clear();
        st.rateStreamStartMs.clear();
        st.rateStreamTags.clear();
        st.rateLastDataMs = 0;
        return;
      }
      st.actualRates.clear();
      st.rateTotalCounts.forEach((total, type) => {
        const start = st.rateStreamStartMs.get(type) ?? now;
        const elapsed = Math.max((now - start) / 1000, 0.001);
        st.actualRates.set(type, total / elapsed);
      });
    });
    this.notify();
  }

  public clearBuffers(st: DeviceState): void {
    st.buffers.forEach((b) => b.clear());
    st.impedance = [];
  }

  // ---------- params / settings ----------

  // Remember every successful user setParam so a recovery can replay it.
  private recordSavedParam(
    mac: string,
    key: string,
    value: string,
    result: string
  ): void {
    if (!mac || /^error/i.test(result)) {
      return;
    }
    const saved = this.savedParamsByMac.get(mac) ?? [];
    const existing = saved.find((kv) => kv[0] === key);
    if (existing) {
      existing[1] = value;
    } else {
      saved.push([key, value]);
    }
    this.savedParamsByMac.set(mac, saved);
  }

  // Replay the recorded history, then settle the control states and
  // clear the views.
  private async restoreSavedParams(
    mac: string,
    index: number,
    autoRecovery: boolean,
    generation: number
  ): Promise<void> {
    const st = this.deviceStates.get(mac);
    const saved = this.savedParamsByMac.get(mac) ?? [];
    if (
      !st ||
      !(await this.shouldContinueAutoRecovery(st, autoRecovery, generation))
    ) {
      return;
    }
    if (index >= saved.length) {
      await this.refreshParamStates(st, autoRecovery, generation);
      this.clearBuffers(st);
      return;
    }
    const [key, value] = saved[index]!;
    try {
      const result = await st.profile.setParam(key, value);
      this.appLog(
        `App: restore setParam(${key}, ${value}) -> ${result}`,
        'I',
        st
      );
    } catch (error) {
      this.appLog(
        `App: restore setParam(${key}, ${value}) -> ${String(error)}`,
        'W',
        st
      );
    }
    await this.restoreSavedParams(mac, index + 1, autoRecovery, generation);
  }

  private async refreshParamStates(
    st: DeviceState,
    autoRecovery = this.autoRecoveryMacs.has(st.profile.BLEDevice.Address),
    generation = st.flowGeneration
  ): Promise<void> {
    if (
      !(await this.shouldContinueAutoRecovery(st, autoRecovery, generation))
    ) {
      return;
    }
    const { profile } = st;
    try {
      const ntf = await profile.getParam('NTF');
      this.parseParamStates(ntf, NTF_KEYS, this.ntfStates);
    } catch (error) {
      console.warn('getParam(NTF) failed', error);
    }
    try {
      const filter = await profile.getParam('FILTER');
      this.parseParamStates(filter, FILTER_KEYS, this.filterStates);
    } catch (error) {
      console.warn('getParam(FILTER) failed', error);
    }
    for (const control of SAMPLE_RATE_CONTROLS) {
      try {
        const list = await profile.getParam(`${control.key}_LIST`);
        this.sampleRateOptions[control.key] =
          !list || /^error/i.test(list)
            ? []
            : list
                .split('|')
                .map((item) => parseInt(item, 10))
                .filter((rate) => !Number.isNaN(rate));
      } catch (error) {
        console.warn(`getParam(${control.key}_LIST) failed`, error);
        this.sampleRateOptions[control.key] = [];
      }
      try {
        const current = await profile.getParam(control.key);
        const rate = parseInt(current, 10);
        this.sampleRateCurrent[control.key] = Number.isNaN(rate) ? 0 : rate;
      } catch (error) {
        console.warn(`getParam(${control.key}) failed`, error);
        this.sampleRateCurrent[control.key] = 0;
      }
    }
  }

  private resetSampleRateStates(): void {
    for (const control of SAMPLE_RATE_CONTROLS) {
      this.sampleRateOptions[control.key] = [];
      this.sampleRateCurrent[control.key] = 0;
    }
  }

  // Seed the checked sample rates from DeviceInfo (> 0 only); IMU's rate
  // is the accelerometer rate.
  private seedSampleRateCurrent(info: DeviceInfo): void {
    const seeds: Array<[string, number]> = [
      ['EEG_SAMPLE_RATE', info.EegSampleRate],
      ['EMG_SAMPLE_RATE', info.EmgSampleRate],
      ['IMU_SAMPLE_RATE', info.AccSampleRate],
      ['PPG_SAMPLE_RATE', info.PpgSampleRate],
    ];
    for (const [key, rate] of seeds) {
      if (rate > 0) {
        this.sampleRateCurrent[key] = rate;
      }
    }
  }

  private parseParamStates(
    text: string,
    keys: string[],
    states: Record<string, boolean>
  ): void {
    if (!text || /^error/i.test(text)) {
      return;
    }
    const items = text.split('|');
    const parsed = new Map<string, string>();
    for (let i = 0; i + 1 < items.length; i += 2) {
      parsed.set(items[i]!, items[i + 1]!);
    }
    for (const key of keys) {
      const value = parsed.get(key);
      if (value !== undefined) {
        states[key] = value.toUpperCase() === 'ON';
      }
    }
  }

  public setNtfEnabled = async (
    key: string,
    enabled: boolean
  ): Promise<void> => {
    const st = this.getActiveState();
    if (!st || !st.profile.isReady) {
      return;
    }
    const value = enabled ? 'ON' : 'OFF';
    try {
      const result = await st.profile.setParam(key, value);
      this.appLog(`User: setParam(${key}, ${value}) -> ${result}`);
      this.recordSavedParam(st.profile.BLEDevice.Address, key, value, result);
      this.ntfStates[key] = enabled;
      await this.refreshParamStates(st);
      this.clearBuffers(st);
      this.status = `${key}: ${enabled ? 'ON' : 'OFF'}`;
    } catch (error) {
      this.appLog(`User: setParam(${key}, ${value}) -> ${String(error)}`);
      this.status = `Error: ${key} failed`;
      console.warn(error);
    }
    this.notify();
  };

  public setSampleRate = async (key: string, rate: number): Promise<void> => {
    const st = this.getActiveState();
    if (!st || !st.profile.isReady) {
      return;
    }
    try {
      const result = await st.profile.setParam(key, String(rate));
      this.appLog(`User: setParam(${key}, ${rate}) -> ${result}`);
      this.recordSavedParam(
        st.profile.BLEDevice.Address,
        key,
        String(rate),
        result
      );
      this.sampleRateCurrent[key] = rate;
      await this.refreshParamStates(st);
      this.clearBuffers(st);
      this.status = `setParam ${key}=${rate} -> ${result}`;
    } catch (error) {
      this.appLog(`User: setParam(${key}, ${rate}) -> ${String(error)}`);
      this.status = `Error: ${key} failed`;
      console.warn(error);
    }
    this.notify();
  };

  public setFilterEnabled = async (
    key: string,
    enabled: boolean
  ): Promise<void> => {
    const st = this.getActiveState();
    if (!st || !st.profile.isReady) {
      return;
    }
    const value = enabled ? 'ON' : 'OFF';
    try {
      const result = await st.profile.setParam(key, value);
      this.appLog(`User: setParam(${key}, ${value}) -> ${result}`);
      this.recordSavedParam(st.profile.BLEDevice.Address, key, value, result);
      this.filterStates[key] = enabled;
      await this.refreshParamStates(st);
      this.clearBuffers(st);
      this.status = `${key}: ${enabled ? 'ON' : 'OFF'}`;
    } catch (error) {
      this.appLog(`User: setParam(${key}, ${value}) -> ${String(error)}`);
      this.status = `Error: ${key} failed`;
      console.warn(error);
    }
    this.notify();
  };

  public setLiveFilterBand = (index: number): void => {
    this.liveFilterBand = index;
    this.appLog(
      `User: live filter -> ${LiveFilter.bandLabels()[index] ?? 'Off'}`
    );
    // Applies to every device.
    this.deviceStates.forEach((st) => st.liveFilter.setBand(index));
    this.dspRuntimes.forEach((runtime) => dspSetBand(runtime, index));
    this.notify();
  };

  public get autoReconnect(): boolean {
    return this._autoReconnect;
  }

  public set autoReconnect(enabled: boolean) {
    this.appLog(`User: auto reconnect ${enabled ? 'ON' : 'OFF'}`);
    this._autoReconnect = enabled;
    SensorController.Instance.getSensors().forEach((profile) => {
      profile.autoReconnect = enabled;
    });
    this.notify();
  }

  public setBinDataEnabled = async (enabled: boolean): Promise<void> => {
    this.binDataEnabled = enabled;
    this.appLog(`User: data debug log ${enabled ? 'ON' : 'OFF'}`);
    // Push to every ready+inited device, not just the active one.
    const value = enabled ? 'True' : 'False';
    await Promise.all(
      [...this.deviceStates.values()]
        .filter((st) => st.profile.isReady && st.profile.hasInited)
        .map(async (st) => {
          try {
            const result = await st.profile.setParam(
              'DEBUG_BLE_DATA_PATH',
              value
            );
            st.profile.log(
              `App: setParam(DEBUG_BLE_DATA_PATH, ${value}) -> ${result}`
            );
          } catch (error) {
            st.profile.log(
              `App: setParam(DEBUG_BLE_DATA_PATH, ${value}) -> ${String(error)}`
            );
            console.warn('DEBUG_BLE_DATA_PATH failed', error);
          }
        })
    );
    this.notify();
  };

  public setDebugLogEnabled = async (enabled: boolean): Promise<void> => {
    this.debugLogEnabled = enabled;
    this.appLog(`User: SDK debug log ${enabled ? 'ON' : 'OFF'}`);
    await this.applyDebugLog(enabled);
  };

  public setTranslateImu = async (enabled: boolean): Promise<void> => {
    this.translateImu = enabled;
    const value = enabled ? 'True' : 'False';
    this.appLog(`User: translate IMU ${value}`);
    try {
      const result = await SensorController.Instance.setParam(
        'TRANSLATE_IMU',
        value
      );
      this.appLog(`App: setParam(TRANSLATE_IMU, ${value}) -> ${result}`);
    } catch (error) {
      this.appLog(`App: setParam(TRANSLATE_IMU, ${value}) -> ${String(error)}`);
      console.warn('TRANSLATE_IMU failed', error);
    }
    this.notify();
  };

  private applyDebugLog = async (enabled: boolean): Promise<void> => {
    // Log path first, then the debug switch; OFF also releases the
    // custom log path.
    try {
      if (enabled) {
        await this.applyLogPath();
      } else {
        await SensorController.Instance.setParam('LOG_PATH', 'False');
      }
      await SensorController.Instance.setParam(
        'DEBUG_ENABLED',
        enabled ? 'True' : 'False'
      );
    } catch (error) {
      console.warn('applyDebugLog failed', error);
    }
    // Push to every ready+inited device.
    const value = enabled ? 'True' : 'False';
    await Promise.all(
      [...this.deviceStates.values()]
        .filter((st) => st.profile.isReady && st.profile.hasInited)
        .map(async (st) => {
          try {
            const result = await st.profile.setParam('DEBUG_LOG_PATH', value);
            st.profile.log(
              `App: setParam(DEBUG_LOG_PATH, ${value}) -> ${result}`
            );
          } catch (error) {
            st.profile.log(
              `App: setParam(DEBUG_LOG_PATH, ${value}) -> ${String(error)}`
            );
            console.warn('DEBUG_LOG_PATH failed', error);
          }
        })
    );
    this.notify();
  };

  private logDirPath(): string {
    // Public Documents on Android (all-files access); app Documents on
    // iOS.
    return Platform.OS === 'android'
      ? '/sdcard/Documents/sensorsdklog'
      : `${RNFS.DocumentDirectoryPath}/sensorsdklog`;
  }

  private async applyLogPath(): Promise<void> {
    const dir = this.logDirPath();
    try {
      await RNFS.mkdir(dir);
    } catch (error) {
      console.warn('mkdir log dir failed', error);
    }
    // A fresh session directory each time the log path is (re)applied.
    const version = (await this.sdkVersionPromise).replace(/\./g, '_');
    const session = version ? `${logDirStamp()}_${version}` : logDirStamp();
    this.sessionLogDir = `${dir}/${session}`;
    try {
      await SensorController.Instance.setParam('LOG_PATH', this.sessionLogDir);
    } catch (error) {
      console.warn('setParam(LOG_PATH) failed', error);
    }
  }

  // ---------- synchronized multi-device stream start/stop ----------

  /** Multi Start button: sync-starts every connected, initialized device. */
  public multiStart = async (): Promise<void> => {
    const states = [...this.deviceStates.values()].filter(
      (st) => !st.isReplay && st.profile.isReady && st.profile.hasInited
    );
    if (states.length === 0) {
      this.appLog('User: multi start rejected (no connected device)', 'W');
      this.status = 'No connected device to sync-start';
      this.notify();
      return;
    }
    this.appLog(`User: multi start on ${states.length} device(s)`);
    try {
      const sensors = states.map((st) => st.profile);
      const transferring = sensors.filter((p) => p.isDataTransfering);
      if (transferring.length > 0) {
        // Already-streaming devices are sync-stopped first so the whole set
        // restarts on one barrier.
        const stopResults =
          await SensorController.Instance.multiStopDataNotification(
            transferring,
            10000
          );
        const stopFailed = stopResults.filter((r) => !r.ok);
        if (stopFailed.length > 0) {
          const macs = stopFailed.map((r) => r.mac).join(', ');
          this.appLog(`App: multi stop failed on: ${macs}`, 'W');
          this.status = `Multi stop failed on: ${macs}`;
          this.notify();
          return;
        }
      }
      const results =
        await SensorController.Instance.multiStartDataNotification(sensors);
      this.reportMultiResult('start', 'started', results);
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  /** Multi Stop button: sync-stops every streaming device. */
  public multiStop = async (): Promise<void> => {
    const sensors = [...this.deviceStates.values()]
      .filter((st) => !st.isReplay && st.profile.isDataTransfering)
      .map((st) => st.profile);
    if (sensors.length === 0) {
      this.appLog('User: multi stop rejected (no streaming device)', 'W');
      this.status = 'No streaming device to sync-stop';
      this.notify();
      return;
    }
    this.appLog(`User: multi stop on ${sensors.length} device(s)`);
    try {
      const results = await SensorController.Instance.multiStopDataNotification(
        sensors,
        10000
      );
      this.reportMultiResult('stop', 'stopped', results);
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  /** Status + per-mac log lines for a multi start/stop result. */
  private reportMultiResult(
    action: string,
    past: string,
    results: MultiDeviceResult[]
  ): void {
    const failed = results.filter((r) => !r.ok);
    for (const r of failed) {
      this.appLog(
        `App: multi ${action} failed[${r.mac}]: ${r.error}`,
        'W',
        this.deviceStates.get(r.mac)
      );
    }
    if (failed.length === 0) {
      this.appLog(
        `App: multi ${action} OK: ${results.length} device(s) ${past}`
      );
      this.status = `Multi ${action}: ${results.length} device(s) ${past}`;
    } else {
      this.status = `Multi ${action} failed on: ${failed
        .map((r) => r.mac)
        .join(', ')}`;
    }
  }

  // ---------- bin replay / analyze ----------

  /**
   * System file picker for bin files, opened at the session log dir when
   * possible. Returns real filesystem paths (the SDK cannot consume
   * content:// URIs), or an empty list when the user cancels.
   */
  private pickBinPaths = async (multi: boolean): Promise<PickedBin[]> => {
    const options = {
      // .bin has no MIME/UTI of its own: '*/*' on Android, public.data on iOS.
      type: Platform.OS === 'ios' ? ['public.data'] : ['*/*'],
      allowMultiSelection: multi,
      mode: 'open',
      ...this.pickerInitialDirOptions(),
    };
    let results: DocumentPickerResponse[];
    try {
      results = await pick(options as DocumentPickerOptionsOpenOnce);
    } catch (error) {
      if (
        !isErrorWithCode(error) ||
        error.code !== errorCodes.OPERATION_CANCELED
      ) {
        this.status = `File picker unavailable: ${String(error)}`;
        this.notify();
      }
      return [];
    }
    const bins: PickedBin[] = [];
    for (const result of results) {
      const bin = await this.resolvePickedBin(result);
      if (bin) {
        bins.push(bin);
      } else {
        this.status = `Unsupported file: ${result.uri}`;
        this.notify();
      }
    }
    return bins;
  };

  /** Picker start location: the session log dir (only when it maps to
   * primary external storage). */
  private pickerInitialDirOptions(): Record<string, string> {
    const dir = this.sessionLogDir;
    if (!dir) {
      return {};
    }
    if (Platform.OS === 'android') {
      if (!dir.startsWith('/sdcard/')) {
        return {};
      }
      const docId = encodeURIComponent(
        `primary:${dir.slice('/sdcard/'.length)}`
      );
      return {
        initialDirectoryUrl: `content://com.android.externalstorage.documents/tree/${docId}/document/${docId}`,
      };
    }
    return { initialDirectoryUri: `file://${encodeURI(dir)}` };
  }

  /**
   * Picked file -> real filesystem path: resolve the content URI directly
   * when reachable, otherwise copy into the cache dir. iOS open mode keeps
   * the file in place.
   */
  private resolvePickedBin = async (
    result: DocumentPickerResponse
  ): Promise<PickedBin | undefined> => {
    if (Platform.OS === 'ios') {
      return {
        path: decodeURIComponent(result.uri).replace(/^file:\/\//, ''),
        secureUri: result.uri,
      };
    }
    const prefix = 'content://com.android.externalstorage.documents/document/';
    if (result.uri.startsWith(prefix)) {
      const docId = decodeURIComponent(result.uri.slice(prefix.length));
      const sep = docId.indexOf(':');
      if (sep > 0) {
        const volume = docId.slice(0, sep);
        const rel = docId.slice(sep + 1);
        const candidate =
          volume === 'primary' ? `/sdcard/${rel}` : `/storage/${volume}/${rel}`;
        try {
          if (await RNFS.exists(candidate)) {
            return { path: candidate };
          }
        } catch {
          // fall through to the cache copy
        }
      }
    }
    try {
      const [copy] = await keepLocalCopy({
        files: [{ uri: result.uri, fileName: result.name ?? 'replay.bin' }],
        destination: 'cachesDirectory',
      });
      if (copy.status === 'success') {
        return {
          path: decodeURIComponent(copy.localUri).replace(/^file:\/\//, ''),
        };
      }
    } catch {
      // fall through
    }
    return undefined;
  };

  /** Release the iOS security scopes once the SDK has opened the files. */
  private releasePickedBins(bins: PickedBin[]): void {
    const uris = bins
      .map((b) => b.secureUri)
      .filter((u): u is string => u !== undefined);
    if (uris.length > 0) {
      releaseSecureAccess(uris).catch(() => {});
    }
  }

  /** Any replay (single or group) currently active. */
  public replayActive(): boolean {
    return this.replayMac !== undefined || this.replayMacs.length > 0;
  }

  /** A real (non-replay) device is currently Ready. */
  public hasRealDeviceConnected(): boolean {
    for (const [, st] of this.deviceStates) {
      if (!st.isReplay && st.profile.isReady) {
        return true;
      }
    }
    return false;
  }

  /**
   * Display gate for the waveform screens. Real devices gate on the Ready
   * state; a replay profile never fires a Ready state change, so replay
   * gates on the seeded info being present.
   */
  public isDisplayReady(st: DeviceState | undefined): st is DeviceState {
    if (!st) {
      return false;
    }
    return st.profile.isReady || (st.isReplay && st.info !== undefined);
  }

  /** Replay Bin… button: system file picker, single selection. */
  public pickAndReplayBin = async (): Promise<void> => {
    const [bin] = await this.pickBinPaths(false);
    if (!bin) {
      return;
    }
    try {
      await this.startSingleReplay(bin.path);
    } finally {
      this.releasePickedBins([bin]);
    }
  };

  private startSingleReplay = async (path: string): Promise<void> => {
    if (this.replayActive()) {
      this.status = 'Stop the running replay first';
      this.notify();
      return;
    }
    if (this.hasRealDeviceConnected()) {
      this.status = 'Disconnect the real device before replay';
      this.notify();
      return;
    }
    this.appLog(`User: replay bin file: ${path}`);
    try {
      const info = await SensorController.Instance.getBinFileInfo(path);
      if (!info.Valid) {
        this.appLog(`App: invalid bin file (no config record): ${path}`, 'W');
        this.status = 'Invalid bin file';
        this.notify();
        return;
      }
      const mac = info.Mac;
      const profile = SensorController.Instance.requireSensor({
        Name: info.DeviceName || 'Replay',
        Address: mac,
        RSSI: 0,
      });
      if (!profile) {
        this.status = 'Replay failed: cannot create profile';
        this.notify();
        return;
      }
      const st = this.ensureState(mac, profile);
      st.isReplay = true;
      // Seed the UI DeviceInfo from the bin header; a replay fires
      // neither DEVICE_INFO_UPDATE nor a Ready state change.
      st.info = info.DeviceInfo;
      st.flowStarted = true;
      this.attachProfileCallbacks(st);
      // A replay answers no parameter queries; the bin header is the
      // only source for the checked sample rates.
      this.seedSampleRateCurrent(info.DeviceInfo);
      // Stop an active scan before replaying.
      if (this.scanning) {
        await this.stopScanning();
      }
      const ok = await SensorController.Instance.replayBinFile(
        path,
        mac,
        true,
        CMD_TIMEOUT_MS
      );
      if (ok) {
        this.replayMac = mac;
        this.replayFiles.set(mac, path);
        this.replayPaused = false;
        this.selectedMac = mac;
        this.ensureWorkletBinding(st);
        this.status = `Replaying: ${info.DeviceName || mac}`;
      } else {
        this.status = 'Replay start failed';
      }
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  // ---------- dev-only debug helpers ----------

  /** DEV ONLY: when true, a naturally-finished debug replay restarts itself
   * (memory soak testing without touching the picker). */
  public debugReplayLoop = false;

  // DEV ONLY: dbg_command.txt poller timer.
  private dbgCommandTimer?: ReturnType<typeof setInterval>;
  // DEV ONLY: performance-entry drain timer.
  private perfDrainTimer?: ReturnType<typeof setInterval>;

  /**
   * DEV ONLY: file-based remote control for automated soaks (windowless
   * runs). The host drops one command line into
   * <Documents>/dbg_command.txt; the poller executes it and deletes the
   * file. Commands: replay_once, loop_on, loop_off, worklets_on,
   * worklets_off, stop_replay.
   */
  private pollDbgCommand = async (): Promise<void> => {
    const file = `${RNFS.DocumentDirectoryPath}/dbg_command.txt`;
    try {
      if (!(await RNFS.exists(file))) {
        return;
      }
      const cmd = (await RNFS.readFile(file, 'utf8')).trim();
      await RNFS.unlink(file);
      if (!cmd) {
        return;
      }
      this.appLog(`User: dbg command: ${cmd}`);
      this.status = `dbg: ${cmd}`;
      this.notify();
      switch (cmd) {
        case 'replay_once':
          void this.debugReplayLatestBin();
          break;
        case 'loop_on':
          if (!this.debugReplayLoop) {
            this.toggleDebugReplayLoop();
          }
          void this.debugReplayLatestBin();
          break;
        case 'loop_off':
          if (this.debugReplayLoop) {
            this.toggleDebugReplayLoop();
          }
          break;
        case 'worklets_on':
          this.setUseWorklets(true);
          break;
        case 'worklets_off':
          this.setUseWorklets(false);
          break;
        case 'stop_replay':
          void this.stopReplay();
          break;
        default:
          break;
      }
    } catch {
      // remote control must never kill the poller
    }
  };

  public toggleDebugReplayLoop = (): void => {
    this.debugReplayLoop = !this.debugReplayLoop;
    this.appLog(
      `User: debug replay loop ${this.debugReplayLoop ? 'ON' : 'OFF'}`
    );
    this.notify();
  };

  /**
   * DEV ONLY: replays the newest .bin under the session log root
   * directly, skipping the system file picker.
   */
  public debugReplayLatestBin = async (): Promise<void> => {
    try {
      let newest: { path: string; mtime: number } | null = null;
      for (const entry of await RNFS.readDir(this.logDirPath())) {
        if (!entry.isDirectory()) {
          continue;
        }
        for (const file of await RNFS.readDir(entry.path)) {
          if (!file.isDirectory() && file.name.endsWith('.bin')) {
            const mtime = file.mtime ? new Date(file.mtime).getTime() : 0;
            if (!newest || mtime > newest.mtime) {
              newest = { path: file.path, mtime };
            }
          }
        }
      }
      if (!newest) {
        this.status = 'No .bin under the session log root';
        this.notify();
        return;
      }
      this.appLog(`User: debug replay latest bin: ${newest.path}`);
      await this.startSingleReplay(newest.path);
    } catch (error) {
      this.status = `Error: ${String(error)}`;
      this.notify();
    }
  };

  /** Multi Replay Bin… button: system file picker, multiple selection. */
  public pickAndMultiReplayBins = async (): Promise<void> => {
    const bins = await this.pickBinPaths(true);
    if (bins.length === 0) {
      return;
    }
    try {
      await this.startGroupReplay(bins.map((b) => b.path));
    } finally {
      this.releasePickedBins(bins);
    }
  };

  /**
   * Synchronized replay of several bins on one shared clock; the first
   * started member becomes the selected device.
   */
  private startGroupReplay = async (paths: string[]): Promise<void> => {
    if (paths.length < 2) {
      this.status = 'Multi replay needs 2+ bin files';
      this.notify();
      return;
    }
    if (this.replayActive()) {
      this.status = 'Stop the running replay first';
      this.notify();
      return;
    }
    if (this.hasRealDeviceConnected()) {
      this.status = 'Disconnect the real device before replay';
      this.notify();
      return;
    }
    this.appLog(`User: replay ${paths.length} bin files: ${paths.join('; ')}`);
    try {
      const items: {
        path: string;
        deviceMac: string;
        profile: SensorProfile;
      }[] = [];
      for (const path of paths) {
        if (!(await RNFS.exists(path))) {
          this.status = `Replay failed: file not found: ${path}`;
          this.notify();
          return;
        }
        const info = await SensorController.Instance.getBinFileInfo(path);
        if (!info.Valid) {
          this.appLog(`App: invalid bin file (no config record): ${path}`, 'W');
        }
        const mac = info.Valid && info.Mac ? info.Mac : 'REPLAY';
        const profile = SensorController.Instance.requireSensor({
          Name: (info.Valid && info.DeviceName) || 'Replay',
          Address: mac,
          RSSI: 0,
        });
        if (!profile) {
          this.status = `Replay failed: cannot create profile (${mac})`;
          this.notify();
          return;
        }
        const st = this.ensureState(mac, profile);
        st.isReplay = true;
        // Same seeding as a single replay.
        if (info.Valid) {
          st.info = info.DeviceInfo;
        }
        st.flowStarted = true;
        this.attachProfileCallbacks(st);
        items.push({ path, deviceMac: mac, profile });
      }
      // Stop an active scan before replaying.
      if (this.scanning) {
        await this.stopScanning();
      }
      const startedProfiles =
        await SensorController.Instance.multiReplayBinFile(
          items.map((item) => item.path),
          items.map((item) => item.profile),
          true,
          CMD_TIMEOUT_MS
        );
      const started: string[] = [];
      items.forEach((item, index) => {
        if (startedProfiles[index]) {
          this.replayFiles.set(item.deviceMac, item.path);
          started.push(item.deviceMac);
        } else {
          this.appLog(
            `App: replay failed to start: ${item.path} (mac=${item.deviceMac})`,
            'W'
          );
          const failed = this.deviceStates.get(item.deviceMac);
          if (failed) {
            this.teardownState(failed);
          }
        }
      });
      if (started.length === 0) {
        this.status = 'Replay failed: multiReplayBinFile started no member';
        this.notify();
        return;
      }
      this.replayMacs = started;
      this.replayPaused = false;
      this.selectedMac = started[0];
      // Seed the checked sample rates from the selected member's bin
      // header.
      const selectedInfo = started[0]
        ? this.deviceStates.get(started[0])?.info
        : undefined;
      if (selectedInfo) {
        this.seedSampleRateCurrent(selectedInfo);
      }
      started.forEach((mac) => {
        const st = this.deviceStates.get(mac);
        if (st) {
          this.ensureWorkletBinding(st);
        }
      });
      this.status = `Replaying ${started.length} bin files (realtime=true) ...`;
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  public pauseResumeReplay = async (): Promise<void> => {
    // One call on any member pauses/resumes the whole group.
    const mac = this.replayMac ?? this.replayMacs[0];
    if (!mac) {
      return;
    }
    const action = this.replayPaused ? 'resume' : 'pause';
    try {
      const result = this.replayPaused
        ? await SensorController.Instance.resumeBinReplay(mac)
        : await SensorController.Instance.pauseBinReplay(mac);
      this.appLog(
        `User: ${action} replay -> ${result}`,
        result === 'OK' ? 'I' : 'W',
        this.deviceStates.get(mac)
      );
      this.status = this.replayPaused ? 'Replay resumed' : 'Replay paused';
      this.replayPaused = !this.replayPaused;
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  public stopReplay = async (): Promise<void> => {
    // One stop covers the whole group.
    const macs = [
      ...(this.replayMac ? [this.replayMac] : []),
      ...this.replayMacs,
    ];
    if (macs.length === 0) {
      return;
    }
    // The per-mac stop flags mark user-requested stops so the later
    // data-transfer OFF push logs them as such.
    macs.forEach((mac) => this.replayStopRequestedMacs.add(mac));
    this.replayMac = undefined;
    this.replayMacs = [];
    this.replayPaused = false;
    for (const mac of macs) {
      try {
        const result = await SensorController.Instance.stopBinReplay(mac);
        this.appLog(
          `User: stop replay -> ${result}`,
          result === 'OK' ? 'I' : 'W',
          this.deviceStates.get(mac)
        );
        if (result !== 'OK') {
          this.replayStopRequestedMacs.delete(mac);
        }
      } catch (error) {
        this.replayStopRequestedMacs.delete(mac);
        this.status = `Error: ${String(error)}`;
      }
      this.replayFiles.delete(mac);
      const st = this.deviceStates.get(mac);
      if (st) {
        this.teardownState(st);
      }
    }
    this.status = 'Replay stopped';
    this.notify();
  };

  /** Analyze Bin… button: system file picker, single selection; the CSV
   * lands next to the picked bin. */
  public pickAndAnalyzeBin = async (): Promise<void> => {
    const [bin] = await this.pickBinPaths(false);
    if (!bin) {
      return;
    }
    try {
      await this.analyzeBinAtPath(bin.path);
    } finally {
      this.releasePickedBins([bin]);
    }
  };

  private analyzeBinAtPath = async (path: string): Promise<void> => {
    if (this.hasRealDeviceConnected()) {
      this.status = 'Disconnect the real device before analyze';
      this.notify();
      return;
    }
    this.appLog(`User: analyze bin file: ${path}`);
    try {
      this.status = 'Analyzing bin ...';
      this.notify();
      // The CSV replaces the .bin extension; it does not append.
      const csvPath = await SensorController.Instance.parseBinToCsv(
        path,
        path.replace(/\.bin$/i, '') + '.csv'
      );
      this.appLog(`App: CSV saved: ${csvPath}`);
      this.status = `CSV: ${csvPath}`;
    } catch (error) {
      this.appLog(`App: analyze failed: ${String(error)}`, 'E');
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  // ---------- view helpers ----------

  public getActiveState(): DeviceState | undefined {
    if (this.selectedMac) {
      const st = this.deviceStates.get(this.selectedMac);
      if (st) {
        return st;
      }
    }
    for (const st of this.deviceStates.values()) {
      if (st.profile.isReady) {
        return st;
      }
    }
    return undefined;
  }

  public get rateText(): string {
    const st = this.getActiveState();
    if (!st) {
      return 'Actual: --';
    }
    const parts: string[] = [];
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    for (const [type, label] of RATE_LABEL_ORDER) {
      const expected = st.expectedRates.get(type);
      if (expected === undefined) {
        continue;
      }
      const actual = st.actualRates.get(type) ?? 0;
      let entry = `${label} ${actual.toFixed(1)} / ${expected}Hz`;
      // The type's own stream-start wall clock.
      const startSec = st.streamStartTimeSecs.get(type) ?? 0;
      if (startSec > 0) {
        const d = new Date(startSec * 1000);
        entry +=
          ` (start ${p(d.getHours())}:${p(d.getMinutes())}:` +
          `${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)})`;
      }
      parts.push(entry);
    }
    // First-packet delay.
    if (st.streamDelayMs > 0) {
      parts.push(`delay ${st.streamDelayMs}ms`);
    }
    return parts.length > 0 ? `Actual: ${parts.join(' | ')}` : 'Actual: --';
  }

  public get lostText(): string {
    const st = this.getActiveState();
    if (!st) {
      return 'Packet Loss: --';
    }
    const parts: string[] = [];
    for (const [type, label] of RATE_LABEL_ORDER) {
      const lost = st.lostCounts.get(type);
      if (lost === undefined) {
        continue;
      }
      parts.push(`${label} ${lost}`);
    }
    return parts.length > 0
      ? `Packet Loss: ${parts.join(' | ')}`
      : 'Packet Loss: --';
  }
}
