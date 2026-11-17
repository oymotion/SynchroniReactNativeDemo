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

    async scanKnownDevices(timeoutMs = TestConfig.SCAN_TIMEOUT_MS) {
      const devices: BLEDevice[] = await SensorController.Instance.scanOnce(timeoutMs);
      return devices.filter((d) => TestConfig.matchesKnownDevice(d));
    },

    async requireKnownDevices() {
      const devices = await ctx.scanKnownDevices();
      const profiles: SensorProfile[] = [];
      for (const d of devices) {
        const p = SensorController.Instance.requireSensor(d);
        if (!p) {
          ctx.log(`[multi] requireSensor failed for ${d.Address}`);
          continue;
        }
        try {
          if (!p.isReady) {
            const ok = await p.connect();
            if (!ok) {
              ctx.log(`[multi] connect failed for ${d.Address}`);
              continue;
            }
            await ctx.waitFor(() => p.isReady, TestConfig.READY_TIMEOUT_MS, `device ${d.Address} Ready`);
          }
          if (!p.hasInited) {
            const ok = await p.init(TestConfig.INIT_PACKAGE_SAMPLE_COUNT, TestConfig.INIT_POWER_REFRESH_MS);
            ctx.log(`[multi] init ${d.Address} -> ${ok}`);
          }
          profiles.push(p);
        } catch (e) {
          ctx.log(`[multi] prepare ${d.Address} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return profiles;
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
      let nativeError = '';
      // 临时挂 error 回调，把 fetchDeviceInfo 内部吞掉的 native 错误抓出来，便于区分
      // 「设备不支持/未应答 DeviceInfo 读取」还是「SDK 真 bug」。
      profile.onErrorCallback = (_s, reason) => {
        const r = reason as unknown;
        nativeError =
          r && typeof r === 'object' && typeof (r as { message?: unknown }).message === 'string'
            ? (r as { message: string }).message
            : String(reason);
      };
      try {
        const info = await profile.fetchDeviceInfo();
        if (info === undefined) {
          ctx.log(
            `[deviceInfo] fetchDeviceInfo returned undefined${nativeError ? `, native error: ${nativeError}` : ' (no native error emitted)'}`,
          );
        }
        return info;
      } finally {
        profile.onErrorCallback = noop;
      }
    },
  };

  return ctx;
}
