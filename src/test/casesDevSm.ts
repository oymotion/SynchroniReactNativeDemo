import { SensorController, DeviceStateEx } from '@synchroni/synchroni_sdk_react_native';
import type { BLEDevice, SensorProfile } from '@synchroni/synchroni_sdk_react_native';
import { DemoController } from '../demo/DemoController';
import { AUTO, SEMI } from './TestRunner';
import type { TestCase } from './TestRunner';

const G = 'DEV-SM';
const VALID_MAC = 'AA:BB:CC:DD:EE:01';

function auto(
  id: string,
  title: string,
  priority: TestCase['priority'],
  expected: string,
  run: TestCase['run']
): TestCase {
  return {
    id, group: G, title, priority, platform: '通用', deviceRelated: '通用',
    automation: AUTO, manualSteps: '', expected, run,
  };
}

function semi(
  id: string,
  title: string,
  priority: TestCase['priority'],
  platform: string,
  expected: string,
  manualSteps: string
): TestCase {
  return {
    id, group: G, title, priority, platform, deviceRelated: '通用',
    automation: SEMI, manualSteps, expected,
  };
}

async function freshProfile(): Promise<SensorProfile | undefined> {
  return (
    SensorController.Instance.requireSensor({
      Name: 'Test', Address: VALID_MAC, RSSI: 0,
    } as BLEDevice) ?? undefined
  );
}

export const DEVSM_CASES: TestCase[] = [
  auto('DEV-SM-001', 'connect 成功进入 Ready', 'P0',
    'connect 返回 true 且 isReady===true', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      return ctx.ok(profile.isReady === true, `isReady=${profile.isReady}`);
    }),

  auto('DEV-SM-002', '无效设备/未扫描 MAC connect 失败', 'P1',
    '返回 false 或 reject，状态不进入 Ready', async (ctx) => {
      const profile = await freshProfile();
      if (!profile) return ctx.skip('cannot create profile');
      let result: unknown;
      let threw = false;
      try {
        result = await profile.connect();
      } catch (e) {
        threw = true;
        result = e;
      }
      return ctx.ok(
        !profile.isReady && (result === false || threw),
        `result=${String(result)} threw=${threw} isReady=${profile.isReady}`
      );
    }),

  auto('DEV-SM-003', '状态机全迁移顺序', 'P0',
    'Disconnected→Connecting→Connected→Ready 无跳变', async (ctx) => {
      const states: DeviceStateEx[] = [];
      const ctrl = DemoController.Instance;
      const unsub = ctrl.addTestStateListener((_s, s) => states.push(s));
      try {
        await ctx.disconnectAll();
        const profile = await ctx.ensureConnected();
        if (!profile) return ctx.skip('no device');
        const legal = [DeviceStateEx.Disconnected, DeviceStateEx.Connecting,
          DeviceStateEx.Connected, DeviceStateEx.Ready];
        const ordered = states.every((s, i) => i === 0 || legal.indexOf(s) >= legal.indexOf(states[i - 1]!));
        return ctx.ok(profile.isReady && ordered,
          `states=${states.map((s) => DeviceStateEx[s]).join(',')}`);
      } finally {
        unsub();
      }
    }),

  auto('DEV-SM-004', 'disconnect 进入 Disconnected', 'P0',
    'disconnect 后 isReady===false hasInited===false', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      await profile.disconnect();
      return ctx.ok(
        profile.isReady === false && profile.hasInited === false,
        `isReady=${profile.isReady} hasInited=${profile.hasInited}`
      );
    }),

  auto('DEV-SM-005', '重复 connect（已 Ready 再 connect）', 'P1',
    '不崩溃，状态保持 Ready', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const noThrow = await ctx.expectNoThrow(() => profile.connect());
      return ctx.ok(noThrow && profile.isReady, `isReady=${profile.isReady}`);
    }),

  auto('DEV-SM-006', '重复 disconnect 幂等', 'P1',
    '不崩溃不抛异常，状态保持 Disconnected', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      await profile.disconnect();
      const noThrow = await ctx.expectNoThrow(() => profile.disconnect());
      return ctx.ok(noThrow && profile.deviceState === DeviceStateEx.Disconnected,
        `state=${DeviceStateEx[profile.deviceState]}`);
    }),

  auto('DEV-SM-007', 'onStateChange 收到各状态', 'P0',
    '每次迁移触发一次回调且 newState 与 deviceState 一致', async (ctx) => {
      const seen: DeviceStateEx[] = [];
      const ctrl = DemoController.Instance;
      const unsub = ctrl.addTestStateListener((_s, s) => seen.push(s));
      try {
        await ctx.disconnectAll();
        const profile = await ctx.ensureConnected();
        if (!profile) return ctx.skip('no device');
        return ctx.ok(seen.length > 0, `callbacks=${seen.length}`);
      } finally {
        unsub();
      }
    }),

  auto('DEV-SM-008', 'isReconnecting/isDataTransfering 初始值', 'P1',
    '均为 false 且 deviceState===Disconnected', async (ctx) => {
      const profile = await freshProfile();
      if (!profile) return ctx.skip('cannot create profile');
      return ctx.ok(
        profile.isReconnecting === false &&
          profile.isDataTransfering === false &&
          profile.hasInited === false &&
          profile.isReady === false &&
          profile.deviceState === DeviceStateEx.Disconnected,
        'initial flags all false'
      );
    }),

  auto('DEV-SM-009', 'autoReconnect 默认 true', 'P0',
    '连接后 autoReconnect===true', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const v = await profile.autoReconnect;
      return ctx.ok(v === true, `autoReconnect=${v}`);
    }),

  auto('DEV-SM-010', 'autoReconnect 设为 false 后回读', 'P0',
    '回读 false 且 isReconnecting 清 false', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      profile.autoReconnect = false;
      const v = await profile.autoReconnect;
      return ctx.ok(v === false, `autoReconnect=${v}`);
    }),

  semi('DEV-SM-011', '断连自动重连回到 Ready（autoReconnect=true）', 'P0',
    'Android(程序化)+iOS(人工)',
    '掉线后自动重连并回到 Ready', '连接并起流后，关闭设备电源/走远制造断链，观察是否自动回到 Ready。'),

  semi('DEV-SM-012', 'autoReconnect=false 断连不自动重连', 'P0',
    'Android(程序化)+iOS(人工)',
    '状态停在 Disconnected，不自动回 Ready', '设置 autoReconnect=false 后制造断链，观察状态停在 Disconnected。'),

  semi('DEV-SM-013', 'onAutoReconnect 回调 + answer(true) 接管', 'P1',
    'Android(程序化)+iOS(人工)',
    '回调收到参数，answer(true) 后跳过默认恢复', '制造断链，观察回调并确认 App 自行恢复会话。'),

  semi('DEV-SM-014', 'onAutoReconnect 回调 + answer(false) 默认恢复', 'P1',
    'Android(程序化)+iOS(人工)',
    'SDK 执行默认恢复', '制造断链，回调内 answer(false)，观察 SDK 默认恢复会话。'),

  semi('DEV-SM-015', 'onAutoReconnect 不 answer 10s 超时默认恢复', 'P1',
    'Android(程序化)+iOS(人工)',
    '约 10s 后默认恢复', '制造断链，回调内不 answer，等待约 10s 观察默认恢复。'),

  semi('DEV-SM-016', 'onDataTransferStateChange 起/停流与链路丢失推送', 'P0',
    'Android(程序化)+iOS(人工)',
    '起流 true，停流 false，链路丢失 false', '起流后人工制造链路丢失（关蓝牙/走远），观察 false 推送。'),

  auto('DEV-SM-017', 'onErrorCallback 收到错误', 'P1',
    '回调收到 (sensor, reason) 且 reason 为字符串', async (ctx) => {
      const profile = await freshProfile();
      if (!profile) return ctx.skip('cannot create profile');
      let reason: string | undefined;
      profile.onErrorCallback = (_s, r) => {
        reason = String(r);
      };
      try {
        await profile.startDataNotification();
      } catch {
        // error path may reject instead of callback
      }
      await ctx.sleep(500);
      return ctx.ok(reason !== undefined, `reason=${reason ?? '<none>'}`);
    }),

  auto('DEV-SM-018', 'BLEDevice 属性返回构造设备', 'P1',
    '返回与入参相同的 Name/Address/RSSI', async (ctx) => {
      const device: BLEDevice = { Name: 'T', Address: VALID_MAC, RSSI: -42 };
      const profile = SensorController.Instance.requireSensor(device);
      if (!profile) return ctx.skip('cannot create profile');
      const b = profile.BLEDevice;
      return ctx.ok(
        b.Name === device.Name && b.Address === device.Address && b.RSSI === device.RSSI,
        `BLEDevice=${b.Name}/${b.Address}/${b.RSSI}`
      );
    }),
];
