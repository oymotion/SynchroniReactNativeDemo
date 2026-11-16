import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type {
  BLEDevice,
  DeviceInfo,
  SensorData,
  SensorProfile,
} from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from './TestConfig';
import type { TestContext } from './types';

const noop = () => {};

/** 跳过信号：由用例主动抛出，runner 将其记为 SKIP 而非 FAIL。 */
export class SkipError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SkipError';
  }
}

export function createContext(log: (msg: string) => void): TestContext {
  const ctx: TestContext = {
    log,

    assert(cond, msg) {
      if (!cond) {
        throw new Error(msg);
      }
    },

    skip(msg) {
      throw new SkipError(msg);
    },

    sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },

    async waitFor(cond, timeoutMs, what) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (cond()) {
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`timeout waiting for ${what}`);
    },

    async scanTarget(timeoutMs = TestConfig.SCAN_TIMEOUT_MS) {
      const devices: BLEDevice[] = await SensorController.Instance.scanOnce(timeoutMs);
      return devices.find((d) => TestConfig.matchesTarget(d));
    },

    async requireTarget() {
      const device = await ctx.scanTarget();
      if (!device) {
        ctx.log(`[scan] target not found (identity=${TestConfig.TARGET_IDENTITY})`);
        return undefined;
      }
      const profile = SensorController.Instance.requireSensor(device);
      if (!profile) {
        ctx.log(`[scan] requireSensor failed for ${device.Address}`);
      }
      return profile;
    },

    async prepare(profile) {
      if (!profile.isReady) {
        const ok = await profile.connect();
        ctx.assert(ok, 'connect() returned false');
        await ctx.waitFor(() => profile.isReady, TestConfig.READY_TIMEOUT_MS, 'device Ready');
      }
      if (!profile.hasInited) {
        const ok = await profile.init(
          TestConfig.INIT_PACKAGE_SAMPLE_COUNT,
          TestConfig.INIT_POWER_REFRESH_MS,
        );
        ctx.assert(ok, 'init() returned false');
      }
    },

    async captureBatch(profile, timeoutMs = TestConfig.DATA_TIMEOUT_MS) {
      await ctx.prepare(profile);

      let resolve: (d: SensorData) => void;
      let reject: (e: Error) => void;
      const p = new Promise<SensorData>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      const handler = (_s: SensorProfile, list: SensorData[]) => {
        if (list && list.length > 0) {
          resolve(list[0].clone());
        }
      };
      profile.onSensorNotifyData = handler;

      const timer = setTimeout(
        () => reject(new Error('no data received within timeout')),
        timeoutMs,
      );
      try {
        const started = await profile.startDataNotification();
        ctx.assert(started, 'startDataNotification() returned false');
        return await p;
      } finally {
        clearTimeout(timer);
        profile.onSensorNotifyData = noop;
      }
    },

    async fetchDeviceInfo(profile) {
      const info = await profile.fetchDeviceInfo();
      if (info === undefined) {
        ctx.log('[deviceInfo] fetchDeviceInfo returned undefined');
      }
      return info;
    },
  };

  return ctx;
}
