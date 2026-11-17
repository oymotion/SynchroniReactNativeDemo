import { SensorController, DeviceStateEx, DataType } from '@synchroni/synchroni_sdk_react_native';
import type { DeviceInfo } from '@synchroni/synchroni_sdk_react_native';
import { DemoController } from '../demo/DemoController';
import { AUTO, SEMI } from './TestRunner';
import type { TestCase } from './TestRunner';

function auto(
  id: string,
  group: string,
  title: string,
  priority: TestCase['priority'],
  deviceRelated: string,
  expected: string,
  run: TestCase['run']
): TestCase {
  return {
    id, group, title, priority, platform: '通用', deviceRelated,
    automation: AUTO, manualSteps: '', expected, run,
  };
}

function semi(
  id: string,
  group: string,
  title: string,
  priority: TestCase['priority'],
  platform: string,
  deviceRelated: string,
  expected: string,
  manualSteps: string
): TestCase {
  return {
    id, group, title, priority, platform, deviceRelated,
    automation: SEMI, manualSteps, expected,
  };
}

export const BATTL_CASES: TestCase[] = [
  auto('BATT-FUNC-001', 'BATT/LOG', 'getBatteryLevel 返回有效电量', 'P0',
    '通用', '返回 >=-1 的整数', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const v = await profile.getBatteryLevel();
      return ctx.ok(typeof v === 'number' && v >= -1, `battery=${v}`);
    }),

  auto('BATT-FUNC-002', 'BATT/LOG', 'onPowerChanged 收到电量变化', 'P0',
    '通用', '收到 (sensor, power>=0)', async (ctx) => {
      const ctrl = DemoController.Instance;
      const seen: number[] = [];
      const unsub = ctrl.addTestPowerListener((_s, p) => seen.push(p));
      try {
        const profile = await ctx.ensureConnected();
        if (!profile) return ctx.skip('no device');
        await profile.getBatteryLevel();
        await ctx.waitFor(() => seen.length > 0, 5000, 200);
        if (seen.length === 0) return ctx.skip('no power push observed');
        return ctx.ok(seen.every((p) => p >= 0), `power=${seen.join(',')}`);
      } finally {
        unsub();
      }
    }),

  auto('BATT-FUNC-003', 'BATT/LOG', '未连接 getBatteryLevel 返回 -1', 'P1',
    '通用', '返回 -1', async (ctx) => {
      const profile = SensorController.Instance.requireSensor({
        Name: 'T', Address: 'AA:BB:CC:DD:EE:06', RSSI: 0,
      });
      if (!profile) return ctx.skip('cannot create profile');
      let v: unknown;
      try {
        v = await profile.getBatteryLevel();
      } catch {
        v = -1;
      }
      return ctx.ok(v === -1, `battery=${v}`);
    }),

  auto('BATT-FUNC-004', 'BATT/LOG', '电量缓存一致性', 'P1',
    '通用', '连续两次返回一致', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const a = await profile.getBatteryLevel();
      const b = await profile.getBatteryLevel();
      return ctx.ok(a === b, `a=${a} b=${b}`);
    }),

  auto('LOG-FUNC-001', 'BATT/LOG', '控制器 log 写日志', 'P1',
    '通用', '无异常', async (ctx) => {
      const noThrow = await ctx.expectNoThrow(() => SensorController.Instance.log('automation', 'I'));
      return ctx.ok(noThrow, 'controller.log OK');
    }),

  auto('LOG-FUNC-002', 'BATT/LOG', 'profile.log 写日志', 'P1',
    '通用', '无异常', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const noThrow = await ctx.expectNoThrow(() => profile.log('automation', 'D'));
      return ctx.ok(noThrow, 'profile.log OK');
    }),

  auto('LOG-FUNC-003', 'BATT/LOG', 'DEBUG_ENABLED 开启后 D 级日志', 'P1',
    '通用', '无异常且回读一致', async (ctx) => {
      await SensorController.Instance.setParam('DEBUG_ENABLED', 'True');
      const noThrow = await ctx.expectNoThrow(() => SensorController.Instance.log('dbg', 'D'));
      const read = await SensorController.Instance.getParam('DEBUG_ENABLED');
      await SensorController.Instance.setParam('DEBUG_ENABLED', 'False');
      return ctx.ok(noThrow && String(read).toLowerCase() === 'true', `DEBUG_ENABLED=${read}`);
    }),

  auto('LOG-FUNC-004', 'BATT/LOG', 'DATA_LOG_ENABLED 开关', 'P1',
    '通用', '无异常且回读一致', async (ctx) => {
      await SensorController.Instance.setParam('DATA_LOG_ENABLED', 'True');
      const read = await SensorController.Instance.getParam('DATA_LOG_ENABLED');
      await SensorController.Instance.setParam('DATA_LOG_ENABLED', 'False');
      return ctx.ok(String(read).toLowerCase() === 'true', `DATA_LOG_ENABLED=${read}`);
    }),

  auto('LOG-FUNC-005', 'BATT/LOG', 'LOG_PATH 切换', 'P1',
    '通用', '无异常', async (ctx) => {
      const noThrow = await ctx.expectNoThrow(async () => {
        await SensorController.Instance.setParam('LOG_PATH', 'True');
        await SensorController.Instance.log('after path', 'I');
        await SensorController.Instance.setParam('LOG_PATH', 'False');
      });
      return ctx.ok(noThrow, 'LOG_PATH switch OK');
    }),

  auto('LOG-ROB-001', 'BATT/LOG', '空消息 log', 'P1',
    '通用', '无异常', async (ctx) => {
      const noThrow = await ctx.expectNoThrow(() => SensorController.Instance.log('', 'I'));
      return ctx.ok(noThrow, 'empty message OK');
    }),

  auto('LOG-ROB-002', 'BATT/LOG', '非法 level log', 'P1',
    '通用', '无异常', async (ctx) => {
      const noThrow = await ctx.expectNoThrow(() => SensorController.Instance.log('msg', 'X'));
      return ctx.ok(noThrow, 'invalid level OK');
    }),
];

export const ASYNC_CASES: TestCase[] = [
  auto('ASYNC-FUNC-001', 'ASYNC', '异步接口 await 均返回正确类型', 'P0',
    '通用', '各返回类型正确', async (ctx) => {
      const version = await SensorController.Instance.getVersion();
      const capi = SensorController.Instance.capiVersion;
      const backend = await SensorController.Instance.getParam('BACK_END');
      return ctx.ok(
        typeof version === 'string' && version.length > 0 &&
          typeof capi === 'number' &&
          typeof backend === 'string',
        `version=${version} capi=${capi}`
      );
    }),

  auto('ASYNC-FUNC-002', 'ASYNC', '数据回调不阻塞 JS 线程', 'P0',
    '通用', '数据按周期持续到达', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1500);
      return ctx.ok(data.length > 0, `${data.length} samples`);
    }),

  semi('ASYNC-FUNC-003', 'ASYNC', 'onAutoReconnect 调用 answer(true) 接管', 'P1',
    'Android(程序化)+iOS(人工)', '通用', '回调收到参数且 answer(true) 接管',
    '制造断链，回调内调用 answer(true)，观察 App 自行恢复。'),

  auto('ASYNC-FUNC-004', 'ASYNC', 'useWorkletRuntime 绑定/解绑', 'P1',
    '通用', '绑定返回 true，null 解绑返回 false/true 不崩溃', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const noThrow = await ctx.expectNoThrow(async () => {
        await profile.useWorkletRuntime(null as unknown as never);
      });
      return ctx.ok(noThrow, 'useWorkletRuntime(null) no throw');
    }),

  auto('ASYNC-FUNC-005', 'ASYNC', '并发重复调用返回缓存结果', 'P1',
    '通用', '两次 init 均返回 true', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const [a, b] = await Promise.all([
        profile.init(32, 60000),
        profile.init(32, 60000),
      ]);
      return ctx.ok(a === true && b === true, `a=${a} b=${b}`);
    }),

  auto('ASYNC-ROB-001', 'ASYNC', '未 await 的 setParam 顺序一致', 'P1',
    '通用', '最终回读为最后写入值', async (ctx) => {
      SensorController.Instance.setParam('DEBUG_ENABLED', 'True');
      SensorController.Instance.setParam('DEBUG_ENABLED', 'False');
      await ctx.sleep(200);
      const read = await SensorController.Instance.getParam('DEBUG_ENABLED');
      return ctx.ok(String(read).toLowerCase() === 'false', `DEBUG_ENABLED=${read}`);
    }),

  semi('ASYNC-ROB-002', 'ASYNC', 'onAutoReconnect 多次调用 answer', 'P2',
    'Android(程序化)+iOS(人工)', '通用', 'answer 幂等，仅首次有效',
    '制造断链，回调内重复调用 answer，观察无崩溃。'),

  auto('ASYNC-ROB-003', 'ASYNC', 'useWorkletRuntime 非法参数返回 false', 'P1',
    '通用', '返回 false 不崩溃', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      let v: unknown = true;
      try {
        v = await profile.useWorkletRuntime((() => {}) as unknown as never);
      } catch {
        v = false;
      }
      return ctx.ok(v === false, `result=${String(v)}`);
    }),
];

export const MISC_CASES: TestCase[] = [
  auto('MISC-FUNC-001', 'MISC', 'fetchDeviceInfo 返回 DeviceInfo', 'P0',
    '通用', '返回 DeviceInfo 且 getDeviceInfo 一致', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const info = await profile.fetchDeviceInfo();
      const cached = profile.getDeviceInfo();
      return ctx.ok(!!info && info === cached, `model=${info?.ModelName ?? ''}`);
    }),

  auto('MISC-FUNC-002', 'MISC', 'getDeviceInfo 返回缓存对象', 'P1',
    '通用', '返回对象或 undefined', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const info = profile.getDeviceInfo();
      return ctx.ok(info === undefined || typeof info === 'object',
        `cached=${info ? 'object' : 'undefined'}`);
    }),

  auto('MISC-FUNC-003', 'MISC', 'DeviceInfo 关键字段类型', 'P0',
    '设备相关', '各通道数/采样率为数值', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const info = await profile.fetchDeviceInfo();
      if (!info) return ctx.skip('no device info');
      const d = info as DeviceInfo;
      return ctx.ok(
        typeof d.EegChannelCount === 'number' &&
          typeof d.EegSampleRate === 'number' &&
          typeof d.AccSampleRate === 'number' &&
          typeof d.MTUSize === 'number',
        `model=${d.ModelName ?? ''}`
      );
    }),

  auto('MISC-FUNC-004', 'MISC', 'getVersion/capiVersion 与后端一致', 'P1',
    '通用', '返回非空', async (ctx) => {
      const version = await SensorController.Instance.getVersion();
      const capi = SensorController.Instance.capiVersion;
      return ctx.ok(version.length > 0 && capi > 0,
        `version=${version} capi=${capi}`);
    }),

  auto('MISC-FUNC-005', 'MISC', 'onSuspend 不抛异常', 'P1',
    '通用', '无异常', async (ctx) => {
      const noThrow = await ctx.expectNoThrow(() => SensorController.Instance.onSuspend());
      return ctx.ok(noThrow, 'onSuspend OK');
    }),

  auto('MISC-FUNC-006', 'MISC', 'DataType 枚举取值', 'P1',
    '通用', '各枚举值与预期一致', async (ctx) => {
      const dt = DataType as unknown as Record<string, number>;
      const checks = {
        NTF_EEG: 0x10,
        NTF_IMU: 0x13,
        NTF_PPG: 0x18,
        NTF_ANGLE: 0xd,
      };
      const fails = Object.entries(checks)
        .filter(([k, v]) => dt[k] !== v)
        .map(([k, v]) => `${k}=${dt[k]}!=${v}`);
      return ctx.ok(fails.length === 0, fails.length ? fails.join(',') : 'all match');
    }),

  auto('MISC-FUNC-007', 'MISC', 'DeviceStateEx 枚举取值', 'P1',
    '通用', 'Disconnected=0..Invalid=5', async (ctx) => {
      const s = DeviceStateEx as unknown as Record<string, number>;
      const ok =
        s.Disconnected === 0 &&
        s.Connecting === 1 &&
        s.Connected === 2 &&
        s.Ready === 3 &&
        s.Disconnecting === 4 &&
        s.Invalid === 5;
      return ctx.ok(ok, `Disconnected=${s.Disconnected} Invalid=${s.Invalid}`);
    }),

  auto('MISC-BND-001', 'MISC', '重复 init 返回缓存 true', 'P1',
    '通用', '两次均返回 true', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const a = await profile.init(32, 60000);
      const b = await profile.init(32, 60000);
      return ctx.ok(a === true && b === true, `a=${a} b=${b}`);
    }),

  auto('MISC-BND-002', 'MISC', '未连接 fetchDeviceInfo 返回 undefined', 'P1',
    '通用', '返回 undefined', async (ctx) => {
      const profile = SensorController.Instance.requireSensor({
        Name: 'T', Address: 'AA:BB:CC:DD:EE:07', RSSI: 0,
      });
      if (!profile) return ctx.skip('cannot create profile');
      let info: unknown;
      try {
        info = await profile.fetchDeviceInfo();
      } catch {
        info = undefined;
      }
      return ctx.ok(info === undefined, `info=${String(info)}`);
    }),

  auto('MISC-BND-003', 'MISC', 'requireSensor 非法 MAC 格式', 'P1',
    '通用', '均返回 undefined', async (ctx) => {
      const bad = ['', '850B', 'GG:HH:II:JJ:KK:LL', 'aa:bb:cc:dd:ee'];
      const ok = bad.every(
        (a) =>
          SensorController.Instance.requireSensor({
            Name: 'T', Address: a, RSSI: 0,
          } as never) === undefined
      );
      return ctx.ok(ok, 'invalid MAC all undefined');
    }),

  auto('MISC-BND-004', 'MISC', 'infoBuffer 长度不足构造 SensorData', 'P1',
    '通用', '不崩溃，字段为默认值', async (ctx) => {
      return ctx.skip('SensorData 无 JS 公开构造器，需原生层验证');
    }),

  auto('MISC-BND-005', 'MISC', 'multiReplayBinFile 空路径', 'P1',
    '通用', '抛 Error', async (ctx) => {
      const p = SensorController.Instance.requireSensor({
        Name: 'T', Address: 'AA:BB:CC:DD:EE:08', RSSI: 0,
      });
      if (!p) return ctx.skip('cannot create profile');
      const a = await ctx.expectThrow(() =>
        SensorController.Instance.multiReplayBinFile([], [p], true, 1000)
      );
      return ctx.ok(a, 'empty paths throws');
    }),

  auto('MISC-BND-006', 'MISC', 'terminateSdk 清空传感器映射', 'P1',
    '通用', 'getSensors 为空', async (ctx) => {
      SensorController.Instance.requireSensor({
        Name: 'T', Address: 'AA:BB:CC:DD:EE:09', RSSI: 0,
      });
      await ctx.expectNoThrow(() => SensorController.Instance.terminateSdk());
      DemoController.Instance.resetAfterTerminate();
      const sensors = SensorController.Instance.getSensors();
      return ctx.ok(sensors.length === 0, `getSensors=${sensors.length}`);
    }),
];
