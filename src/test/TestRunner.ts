import RNFS from 'react-native-fs';
import {
  SensorController,
  DeviceStateEx,
  DataType,
} from '@synchroni/synchroni_sdk_react_native';
import type {
  BLEDevice,
  DeviceInfo,
  SensorData,
  SensorProfile,
} from '@synchroni/synchroni_sdk_react_native';
import { DemoController } from '../demo/DemoController';

export type Automation = 'auto' | 'semi-auto' | 'manual';
export type Priority = 'P0' | 'P1' | 'P2';
export type ResultStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip';

export interface RunOutcome {
  status: ResultStatus;
  detail: string;
}

export interface TestCase {
  id: string;
  group: string;
  title: string;
  priority: Priority;
  platform: string;
  deviceRelated: string;
  automation: Automation;
  manualSteps: string;
  expected: string;
  run?: (ctx: TestContext) => Promise<RunOutcome>;
}

export interface TestContext {
  expectThrow(fn: () => unknown): Promise<boolean>;
  expectNoThrow(fn: () => unknown): Promise<boolean>;
  expectWarn(fn: () => unknown): Promise<string[]>;
  ok(cond: boolean, detail?: string): RunOutcome;
  pass(detail: string): RunOutcome;
  fail(detail: string): RunOutcome;
  skip(detail: string): RunOutcome;
  sleep(ms: number): Promise<void>;
  waitFor(fn: () => boolean, timeoutMs: number, intervalMs?: number): Promise<boolean>;
  controller: typeof SensorController.Instance;
  targetDevice(): BLEDevice | undefined;
  activeProfile(): SensorProfile | undefined;
  activeInfo(): DeviceInfo | undefined;
  ensureConnected(): Promise<SensorProfile | undefined>;
  ensureStreaming(): Promise<SensorProfile | undefined>;
  disconnectAll(): Promise<void>;
  collectData(ms: number): Promise<SensorData[]>;
  findBin(): Promise<string | undefined>;
}

export const AUTO = 'auto' as const;
export const SEMI = 'semi-auto' as const;
export const MANUAL = 'manual' as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Test harness. Exposes SDK/device helpers and non-throwing assertion
 * utilities so every auto case can be written as a short, self-contained
 * async function. Device lifecycle is driven through DemoController so the
 * harness never fights the demo for the SDK's single-slot callbacks.
 */
class Harness implements TestContext {
  public controller = SensorController.Instance;
  private noDeviceUntil = 0;

  // ---- primitive assertions ----

  async expectThrow(fn: () => unknown): Promise<boolean> {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  }

  async expectNoThrow(fn: () => unknown): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  }

  async expectWarn(fn: () => unknown): Promise<string[]> {
    const original = console.warn;
    const captured: string[] = [];
    console.warn = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(' '));
    };
    try {
      try {
        await fn();
      } catch {
        // warn assertions only care about captured warnings
      }
    } finally {
      console.warn = original;
    }
    return captured;
  }

  ok(cond: boolean, detail = ''): RunOutcome {
    return cond
      ? { status: 'pass', detail }
      : { status: 'fail', detail };
  }

  pass(detail = ''): RunOutcome {
    return { status: 'pass', detail };
  }

  fail(detail = ''): RunOutcome {
    return { status: 'fail', detail };
  }

  skip(detail = ''): RunOutcome {
    return { status: 'skip', detail };
  }

  sleep = sleep;

  async waitFor(
    fn: () => boolean,
    timeoutMs: number,
    intervalMs = 100
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (fn()) {
          return true;
        }
      } catch {
        // keep polling
      }
      await sleep(intervalMs);
    }
    try {
      return !!fn();
    } catch {
      return false;
    }
  }

  // ---- device helpers ----

  targetDevice(): BLEDevice | undefined {
    const ctrl = DemoController.Instance;
    const selected = ctrl.devices.find((d) => d.Address === ctrl.selectedMac);
    return selected ?? ctrl.devices[0];
  }

  activeProfile(): SensorProfile | undefined {
    return DemoController.Instance.getActiveState()?.profile;
  }

  activeInfo(): DeviceInfo | undefined {
    return DemoController.Instance.getActiveState()?.info;
  }

  private async scanForDevice(): Promise<BLEDevice | undefined> {
    const ctrl = DemoController.Instance;
    if (ctrl.devices.length > 0) {
      return this.targetDevice();
    }
    if (Date.now() < this.noDeviceUntil) {
      return undefined;
    }
    if (!SensorController.Instance.isEnable) {
      return undefined;
    }
    await ctrl.startScanning();
    const found = await this.waitFor(() => ctrl.devices.length > 0, 6000, 200);
    await ctrl.stopScanning();
    if (!found) {
      this.noDeviceUntil = Date.now() + 15000;
    }
    return found ? this.targetDevice() : undefined;
  }

  async ensureConnected(): Promise<SensorProfile | undefined> {
    const ctrl = DemoController.Instance;
    let profile = this.activeProfile();
    if (profile?.isReady) {
      return profile;
    }
    const device = await this.scanForDevice();
    if (!device) {
      return undefined;
    }
    ctrl.selectDevice(device.Address);
    await ctrl.connectSelected();
    const ok = await this.waitFor(() => {
      const p = this.activeProfile();
      return !!p && p.deviceState === DeviceStateEx.Ready;
    }, 20000, 200);
    profile = this.activeProfile();
    return ok && profile ? profile : undefined;
  }

  async ensureStreaming(): Promise<SensorProfile | undefined> {
    const profile = await this.ensureConnected();
    if (!profile) {
      return undefined;
    }
    if (profile.isDataTransfering) {
      return profile;
    }
    try {
      if (!profile.hasInited) {
        const ok = await profile.init(32, 60000);
        if (!ok) {
          return undefined;
        }
      }
      if (!profile.isDataTransfering) {
        await profile.startDataNotification();
      }
    } catch {
      return undefined;
    }
    const ok = await this.waitFor(
      () => profile.isDataTransfering,
      10000,
      100
    );
    return ok ? profile : undefined;
  }

  async disconnectAll(): Promise<void> {
    const ctrl = DemoController.Instance;
    for (const st of ctrl.deviceStates.values()) {
      try {
        if (st.profile.deviceState !== DeviceStateEx.Disconnected) {
          await st.profile.disconnect();
        }
      } catch {
        // best-effort cleanup; stale/terminated profiles are ignored
      }
    }
    if (ctrl.scanning) {
      try {
        await ctrl.stopScanning();
      } catch {
        // ignore scan teardown errors
      }
    }
  }

  async collectData(ms: number): Promise<SensorData[]> {
    const ctrl = DemoController.Instance;
    const collected: SensorData[] = [];
    const unsub = ctrl.addTestDataListener((list) => {
      for (const data of list) {
        collected.push(data);
      }
    });
    try {
      await sleep(ms);
    } finally {
      unsub();
    }
    return collected;
  }

  async findBin(): Promise<string | undefined> {
    const root = `${RNFS.DocumentDirectoryPath}/sensorsdklog`;
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: Awaited<ReturnType<typeof RNFS.readDir>>;
      try {
        entries = await RNFS.readDir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(entry.path);
        } else if (entry.name.toLowerCase().endsWith('.bin')) {
          found.push(entry.path);
        }
      }
    };
    await walk(root);
    return found[0];
  }
}

export const harness = new Harness();

export interface CaseResult extends RunOutcome {
  id: string;
  at: number;
}

export type SessionListener = () => void;

/** Tracks per-case results and drives auto-case execution. */
export class TestSession {
  private results = new Map<string, CaseResult>();
  private listeners = new Set<SessionListener>();
  private running = false;

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  isRunning(): boolean {
    return this.running;
  }

  get(id: string): CaseResult | undefined {
    return this.results.get(id);
  }

  all(): Record<string, CaseResult> {
    return Object.fromEntries(this.results);
  }

  async runCase(tc: TestCase): Promise<CaseResult> {
    this.results.set(tc.id, { id: tc.id, status: 'running', detail: '', at: Date.now() });
    this.notify();
    try {
      let result: CaseResult;
      try {
        const outcome = tc.run
          ? await tc.run(harness)
          : { status: 'skip' as const, detail: 'no auto step' };
        result = { id: tc.id, ...outcome, at: Date.now() };
      } catch (e) {
        result = {
          id: tc.id,
          status: 'fail',
          detail: e instanceof Error ? e.message : String(e),
          at: Date.now(),
        };
      }
      this.results.set(tc.id, result);
      this.notify();
      return result;
    } finally {
      // Isolate each case: leave the device disconnected so the next case
      // starts from a clean, known state.
      await harness.disconnectAll();
    }
  }

  async runMany(
    cases: TestCase[],
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    this.running = true;
    this.notify();
    try {
      for (let i = 0; i < cases.length; i++) {
        await this.runCase(cases[i]!);
        onProgress?.(i + 1, cases.length);
      }
    } finally {
      this.running = false;
      // Ensure the device is disconnected once the full run finishes.
      await harness.disconnectAll();
      this.notify();
    }
  }

  markManual(id: string, status: 'pass' | 'fail' | 'skip', detail = ''): void {
    this.results.set(id, { id, status, detail, at: Date.now() });
    this.notify();
  }

  reset(ids?: string[]): void {
    if (ids) {
      for (const id of ids) {
        this.results.delete(id);
      }
    } else {
      this.results.clear();
    }
    this.notify();
  }
}

/** Type-only re-export of the enums so case files can reference them
 * without touching the SDK package directly. */
export { DeviceStateEx, DataType };
