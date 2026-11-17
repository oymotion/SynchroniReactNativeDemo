import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { DeviceInfo } from '@synchroni/synchroni_sdk_react_native';
import { AUTO } from './TestRunner';
import type { TestCase } from './TestRunner';

const G = 'PARAM';

function auto(
  id: string,
  title: string,
  priority: TestCase['priority'],
  deviceRelated: string,
  expected: string,
  run: TestCase['run']
): TestCase {
  return {
    id, group: G, title, priority, platform: '通用', deviceRelated,
    automation: AUTO, manualSteps: '', expected, run,
  };
}

function isError(v: unknown): boolean {
  return typeof v === 'string' && /^error/i.test(v);
}

function parseNtf(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const parts = s.split('|');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const key = (parts[i] ?? '').trim();
    const val = (parts[i + 1] ?? '').trim();
    if (key) out.push([key, val]);
  }
  return out;
}

const RATE_STREAMS = ['EEG', 'EMG', 'IMU', 'PPG'];

export const PARAM_CASES: TestCase[] = [
  auto('PARAM-FUNC-001', 'getParam("NTF") 返回流开关列表', 'P0', '通用',
    '返回形如 NTF_EEG|ON|... 的字符串', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const v = await profile.getParam('NTF');
      return ctx.ok(typeof v === 'string' && v.includes('|') && !isError(v),
        `NTF=${v}`);
    }),

  auto('PARAM-FUNC-002', 'getParam("FILTER") 返回滤波开关', 'P1', '通用',
    '返回滤波开关列表或能力缺失时 Error', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const v = await profile.getParam('FILTER');
      if (isError(v)) return ctx.skip('no filter capability');
      return ctx.ok(typeof v === 'string' && v.length > 0, `FILTER=${v}`);
    }),

  auto('PARAM-FUNC-003', 'setParam 流开关 ON/OFF', 'P0', '设备相关（需对应流能力）',
    '返回 OK 且回读一致', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const ntf = await profile.getParam('NTF');
      if (isError(ntf)) return ctx.skip('cannot read NTF');
      const pairs = parseNtf(String(ntf));
      const key = pairs[0]?.[0];
      if (!key) return ctx.skip('no stream key');
      const r1 = await profile.setParam(key, 'ON');
      const readOn = await profile.getParam('NTF');
      const on = parseNtf(String(readOn)).find(([k]) => k === key)?.[1];
      const r2 = await profile.setParam(key, 'OFF');
      const readOff = await profile.getParam('NTF');
      const off = parseNtf(String(readOff)).find(([k]) => k === key)?.[1];
      return ctx.ok(r1 === 'OK' && r2 === 'OK' && on === 'ON' && off === 'OFF',
        `${key} on=${on} off=${off}`);
    }),

  auto('PARAM-FUNC-004', 'setParam 采样率下发', 'P0', '设备相关（需采样率可设）',
    '返回 OK 且起流后 sampleRate 一致', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      for (const s of RATE_STREAMS) {
        const list = await profile.getParam(`${s}_SAMPLE_RATE_LIST`);
        if (isError(list)) continue;
        const vals = String(list).split('|').map((x) => x.trim()).filter(Boolean);
        if (vals.length < 2) continue;
        const target = vals[0]!;
        const r = await profile.setParam(`${s}_SAMPLE_RATE`, target);
        const read = await profile.getParam(`${s}_SAMPLE_RATE`);
        return ctx.ok(r === 'OK' && String(read) === target,
          `${s}_SAMPLE_RATE set=${r} read=${read}`);
      }
      return ctx.skip('no configurable sample rate');
    }),

  auto('PARAM-FUNC-005', 'getParam 采样率回读', 'P0', '设备相关（需采样率参数）',
    '返回当前档位与下发一致', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      for (const s of RATE_STREAMS) {
        const list = await profile.getParam(`${s}_SAMPLE_RATE_LIST`);
        if (isError(list)) continue;
        const vals = String(list).split('|').map((x) => x.trim()).filter(Boolean);
        if (vals.length < 2) continue;
        const target = vals[0]!;
        await profile.setParam(`${s}_SAMPLE_RATE`, target);
        const read = await profile.getParam(`${s}_SAMPLE_RATE`);
        return ctx.ok(String(read) === target, `${s} read=${read}`);
      }
      return ctx.skip('no configurable sample rate');
    }),

  auto('PARAM-FUNC-006', 'setParam 滤波开关', 'P1', '设备相关（需滤波能力）',
    '返回 OK 且回读一致', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const f = await profile.getParam('FILTER');
      if (isError(f)) return ctx.skip('no filter capability');
      const r1 = await profile.setParam('FILTER_50HZ', 'ON');
      const read = await profile.getParam('FILTER');
      const on = String(read).includes('FILTER_50HZ|ON');
      await profile.setParam('FILTER_50HZ', 'OFF');
      return ctx.ok(r1 === 'OK' && on, `FILTER_50HZ set=${r1} on=${on}`);
    }),

  auto('PARAM-FUNC-007', '控制器 setParam DEBUG_ENABLED/DATA_LOG_ENABLED', 'P1', '通用',
    '返回 OK 且回读一致', async (ctx) => {
      const a = await SensorController.Instance.setParam('DEBUG_ENABLED', 'True');
      const ra = await SensorController.Instance.getParam('DEBUG_ENABLED');
      const b = await SensorController.Instance.setParam('DATA_LOG_ENABLED', 'False');
      const rb = await SensorController.Instance.getParam('DATA_LOG_ENABLED');
      await SensorController.Instance.setParam('DEBUG_ENABLED', 'False');
      return ctx.ok(
        a === 'OK' && b === 'OK' &&
          String(ra).toLowerCase() === 'true' &&
          String(rb).toLowerCase() === 'false',
        `DEBUG=${ra} DATA_LOG=${rb}`
      );
    }),

  auto('PARAM-FUNC-008', '控制器 getParam 回读', 'P1', '通用',
    '返回对应值，未知 key 返回 Error', async (ctx) => {
      const v = await SensorController.Instance.getParam('BACK_END');
      const u = await SensorController.Instance.getParam('NOT_EXIST_KEY');
      return ctx.ok(!isError(v) && isError(u), `BACK_END=${v} unknown=${u}`);
    }),

  auto('PARAM-FUNC-009', '采样率可选档位查询（_LIST）', 'P1', '设备相关（需采样率参数）',
    '返回档位列表', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      for (const s of RATE_STREAMS) {
        const list = await profile.getParam(`${s}_SAMPLE_RATE_LIST`);
        if (!isError(list)) {
          return ctx.ok(String(list).includes('|'), `${s}_LIST=${list}`);
        }
      }
      return ctx.skip('no sample rate list');
    }),

  auto('PARAM-FUNC-010', '角度流 NTF_ANGLE 独立开关', 'P1', '设备相关（需角度能力）',
    'NTF_ANGLE 返回 OK，NTF_ANGLE_DATA 返回 Error', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const info = await profile.fetchDeviceInfo();
      if (!info || (info as DeviceInfo).AngleChannelCount <= 0) {
        return ctx.skip('no angle capability');
      }
      const r1 = await profile.setParam('NTF_ANGLE', 'OFF');
      const r2 = await profile.setParam('NTF_ANGLE_DATA', 'OFF');
      await profile.setParam('NTF_ANGLE', 'ON');
      return ctx.ok(r1 === 'OK' && isError(r2), `NTF_ANGLE=${r1} NTF_ANGLE_DATA=${r2}`);
    }),

  auto('PARAM-FUNC-011', '磁力计无独立开关（随 NTF_IMU 聚合）', 'P1', '设备相关（需 IMU 能力）',
    'NTF_MAG 返回 Error，NTF_IMU OFF 生效', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const info = await profile.fetchDeviceInfo();
      if (!info || ((info as DeviceInfo).AccChannelCount <= 0 && (info as DeviceInfo).GyroChannelCount <= 0)) {
        return ctx.skip('no IMU capability');
      }
      const rMag = await profile.setParam('NTF_MAG', 'OFF');
      const rImu = await profile.setParam('NTF_IMU', 'OFF');
      await profile.setParam('NTF_IMU', 'ON');
      return ctx.ok(isError(rMag) && rImu === 'OK', `NTF_MAG=${rMag} NTF_IMU=${rImu}`);
    }),

  auto('PARAM-BND-001', 'setParam 空 key / null value', 'P1', '通用',
    '抛 Error("invalid arguments")', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const a = await ctx.expectThrow(() => profile.setParam('', 'ON'));
      const b = await ctx.expectThrow(() => profile.setParam('NTF_EEG', null as unknown as string));
      return ctx.ok(a && b, 'empty key / null value throw');
    }),

  auto('PARAM-BND-002', 'setParam 非法 key', 'P1', '通用',
    '返回 Error 或 reject', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      let threw = false;
      let result: unknown;
      try {
        result = await profile.setParam('NOT_EXIST_KEY', '1');
      } catch (e) {
        threw = true;
        result = e;
      }
      return ctx.ok(threw || isError(result), `result=${String(result)} threw=${threw}`);
    }),

  auto('PARAM-BND-003', 'setParam 非法 value（不支持档位）', 'P1', '设备相关（需采样率参数）',
    '返回 Error 不生效', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      for (const s of RATE_STREAMS) {
        const list = await profile.getParam(`${s}_SAMPLE_RATE_LIST`);
        if (isError(list)) continue;
        const result = await profile.setParam(`${s}_SAMPLE_RATE`, '9999');
        return ctx.ok(isError(result), `${s} illegal value -> ${result}`);
      }
      return ctx.skip('no sample rate parameter');
    }),

  auto('PARAM-BND-004', 'getParam 空 key', 'P1', '通用',
    '返回 Error 或抛异常不崩溃', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      let threw = false;
      let result: unknown;
      try {
        result = await profile.getParam('');
      } catch (e) {
        threw = true;
        result = e;
      }
      return ctx.ok(threw || isError(result), `result=${String(result)} threw=${threw}`);
    }),

  auto('PARAM-BND-005', '未连接时 setParam/getParam', 'P1', '通用',
    '返回 Error 或 reject', async (ctx) => {
      const profile = SensorController.Instance.requireSensor({
        Name: 'T', Address: 'AA:BB:CC:DD:EE:03', RSSI: 0,
      });
      if (!profile) return ctx.skip('cannot create profile');
      let threw = false;
      let result: unknown;
      try {
        result = await profile.setParam('NTF_EEG', 'ON');
      } catch (e) {
        threw = true;
        result = e;
      }
      return ctx.ok(threw || isError(result), `result=${String(result)} threw=${threw}`);
    }),

  auto('PARAM-ROB-001', '快速连续 setParam', 'P1', '通用',
    '均返回 OK/Error 无死锁无崩溃', async (ctx) => {
      const noThrow = await ctx.expectNoThrow(async () => {
        for (let i = 0; i < 10; i++) {
          await SensorController.Instance.setParam('DEBUG_ENABLED', i % 2 ? 'True' : 'False');
        }
      });
      return ctx.ok(noThrow, 'rapid controller setParam OK');
    }),

  auto('PARAM-ROB-002', '参数下发后立即起流', 'P1', '设备相关（需采样率参数）',
    '起流成功且 sampleRate 与下发一致', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      for (const s of RATE_STREAMS) {
        const list = await profile.getParam(`${s}_SAMPLE_RATE_LIST`);
        if (isError(list)) continue;
        const vals = String(list).split('|').map((x) => x.trim()).filter(Boolean);
        if (vals.length < 2) continue;
        const target = vals[0]!;
        await profile.setParam(`${s}_SAMPLE_RATE`, target);
        if (!profile.hasInited) await profile.init(32, 60000);
        await profile.startDataNotification();
        const data = await ctx.collectData(1000);
        const hit = data.find((d) => d.sampleRate === Number(target));
        return ctx.ok(!!hit, `${s} target=${target} found=${!!hit}`);
      }
      return ctx.skip('no sample rate parameter');
    }),
];
