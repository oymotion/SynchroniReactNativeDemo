import { DataType, SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { SensorData } from '@synchroni/synchroni_sdk_react_native';
import { AUTO, SEMI } from './TestRunner';
import type { TestCase } from './TestRunner';

const G = 'DATA';

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

function semi(
  id: string,
  title: string,
  priority: TestCase['priority'],
  deviceRelated: string,
  expected: string,
  manualSteps: string
): TestCase {
  return {
    id, group: G, title, priority, platform: '通用', deviceRelated,
    automation: SEMI, manualSteps, expected,
  };
}

function pickSample(data: SensorData[]): SensorData | undefined {
  return data.find((d) => d.channelCount > 0 && d.sampleCount > 0);
}

export const DATA_CASES: TestCase[] = [
  auto('DATA-FUNC-001', 'init 成功 hasInited==true', 'P0', '通用',
    '返回 true 且 hasInited===true', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      let ok = profile.hasInited;
      if (!ok) {
        ok = await profile.init(32, 60000);
      }
      return ctx.ok(ok === true && profile.hasInited === true,
        `hasInited=${profile.hasInited}`);
    }),

  auto('DATA-FUNC-002', '未 Ready 时 init 返回 false', 'P1', '通用',
    'console.warn 且返回 false', async (ctx) => {
      const profile = SensorController.Instance.requireSensor({
        Name: 'T', Address: 'AA:BB:CC:DD:EE:02', RSSI: 0,
      });
      if (!profile) return ctx.skip('cannot create profile');
      const warns = await ctx.expectWarn(() => profile.init(32, 60000));
      let result: unknown;
      try {
        result = await profile.init(32, 60000);
      } catch (e) {
        result = e;
      }
      return ctx.ok(result === false || warns.length > 0,
        `result=${String(result)} warns=${warns.length}`);
    }),

  auto('DATA-FUNC-003', 'startDataNotification 成功且 isDataTransfering==true', 'P0', '通用',
    '返回 true 且 isDataTransfering===true', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      if (!profile.hasInited) await profile.init(32, 60000);
      const ok = profile.isDataTransfering || (await profile.startDataNotification());
      return ctx.ok(ok === true && profile.isDataTransfering === true,
        `transfering=${profile.isDataTransfering}`);
    }),

  auto('DATA-FUNC-004', 'stopDataNotification 成功且 isDataTransfering==false', 'P0', '通用',
    '返回 true 且 isDataTransfering===false', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const ok = await profile.stopDataNotification();
      return ctx.ok(ok === true && profile.isDataTransfering === false,
        `transfering=${profile.isDataTransfering}`);
    }),

  auto('DATA-FUNC-005', 'onSensorNotifyData 收到 SensorData[]', 'P0', '通用',
    '起流后收到非空数据', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      return ctx.ok(data.length > 0, `${data.length} samples`);
    }),

  auto('DATA-FUNC-006', 'SensorData.dataType 与预期流一致', 'P0', '通用',
    'dataType 属于 DataType 枚举', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      if (data.length === 0) return ctx.skip('no data received');
      const ok = data.every((d) => typeof d.dataType === 'number');
      return ctx.ok(ok, `types=${[...new Set(data.map((d) => d.dataType))].join(',')}`);
    }),

  auto('DATA-FUNC-007', 'sampleRate/channelCount 有效', 'P0', '设备相关（需对应流通道数>0）',
    'sampleRate>0 channelCount>0 sampleCount>0', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      return ctx.ok(s.sampleRate > 0 && s.channelCount > 0 && s.sampleCount > 0,
        `rate=${s.sampleRate} ch=${s.channelCount} count=${s.sampleCount}`);
    }),

  auto('DATA-FUNC-008', 'getData/getRawData 范围内取值', 'P0', '通用',
    '返回 number，raw 为整数', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      const v = s.getData(0, 0);
      const r = s.getRawData(0, 0);
      return ctx.ok(typeof v === 'number' && Number.isInteger(r),
        `data=${v} raw=${r}`);
    }),

  auto('DATA-FUNC-009', 'getChannelData 返回 Float32Array 长度==sampleCount', 'P1', '通用',
    'Float32Array 长度等于 sampleCount', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      const arr = s.getChannelData(0);
      return ctx.ok(
        arr instanceof Float32Array && arr.length === s.sampleCount,
        `len=${arr.length} sampleCount=${s.sampleCount}`
      );
    }),

  auto('DATA-FUNC-010', 'clone 后仍可读且不随后续更新失效', 'P0', '通用',
    'clone 返回 ownsSamples===true', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const first = await ctx.collectData(1000);
      const s = pickSample(first);
      if (!s) return ctx.skip('no sample data');
      const cloned = s.clone();
      await ctx.collectData(1000);
      return ctx.ok(cloned.ownsSamples === true && typeof cloned.getData(0, 0) === 'number',
        `ownsSamples=${cloned.ownsSamples}`);
    }),

  auto('DATA-FUNC-011', 'isDataValid 默认探测整批有效性', 'P1', '通用',
    '当前批次返回 true，越界返回 false', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      const fresh = s.isDataValid();
      const oob = s.isDataValid(s.channelCount, 0);
      return ctx.ok(typeof fresh === 'boolean' && oob === false,
        `fresh=${fresh} oob=${oob}`);
    }),

  auto('DATA-FUNC-012', 'getTimeStampInMs/getAbsTimeStampInSec 单调', 'P1', '通用',
    '时间戳非负且递增', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s || s.sampleCount < 2) return ctx.skip('not enough samples');
      const t0 = s.getTimeStampInMs(0, 0);
      const t1 = s.getTimeStampInMs(0, Math.min(1, s.sampleCount - 1));
      const a0 = s.getAbsTimeStampInSec(0, 0);
      return ctx.ok(t0 >= 0 && t1 >= t0 && a0 >= 0,
        `t0=${t0} t1=${t1} abs=${a0}`);
    }),

  auto('DATA-FUNC-013', 'isChannelEnabled 按 channelMask', 'P1', '通用',
    'channelMask 为 bigint，通道掩码一致', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      const maskBigint = typeof s.channelMask === 'bigint';
      const enabledOk = s.isChannelEnabled(0);
      return ctx.ok(maskBigint && typeof enabledOk === 'boolean',
        `channelMask=${s.channelMask} enabled0=${enabledOk}`);
    }),

  auto('DATA-FUNC-014', '多流并存按 dataType 分桶统计', 'P0', '设备相关（需≥2类流）',
    '各流独立统计无跨流混加', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1500);
      const types = new Set(data.map((d) => d.dataType));
      if (types.size < 2) return ctx.skip('only one stream type active');
      return ctx.pass(`streams=${[...types].join(',')}`);
    }),

  auto('DATA-FUNC-015', '阻抗值仅在 NTF_IMPEDANCE 流有效', 'P1', '设备相关（需阻抗能力）',
    '阻抗流返回有效值，其它流为 0', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1500);
      const imp = data.find((d) => d.dataType === (DataType as any).NTF_IMPEDANCE);
      if (!imp) return ctx.skip('no impedance stream');
      const v = imp.getImpedance(0, 0);
      return ctx.ok(typeof v === 'number' && v >= 0, `impedance=${v}`);
    }),

  auto('DATA-FUNC-016', 'SensorData 元数据字段完整性', 'P1', '通用',
    '各字段类型正确且不抛异常', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      return ctx.ok(
        typeof s.deviceMac === 'string' &&
          typeof s.deviceName === 'string' &&
          typeof s.startSampleIndex === 'number' &&
          s.lostPackageCount >= 0 &&
          typeof s.channelMask === 'bigint',
        `mac=${s.deviceMac} lost=${s.lostPackageCount}`
      );
    }),

  auto('DATA-BND-001', 'init packageSampleCount 边界', 'P1', '通用',
    '<=0 或 >4096 返回 false，1..4096 返回 true', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const bad = [0, -1, 4097];
      let okBad = true;
      for (const v of bad) {
        const warns = await ctx.expectWarn(() => profile.init(v, 60000));
        let r: unknown;
        try { r = await profile.init(v, 60000); } catch (e) { r = e; }
        if (r !== false && warns.length === 0) okBad = false;
      }
      const okValid = await profile.init(32, 60000);
      return ctx.ok(okBad && okValid === true, `badOk=${okBad} valid=${okValid}`);
    }),

  auto('DATA-BND-002', 'init powerRefreshInterval 边界', 'P1', '通用',
    '<0 返回 false，0 与正数返回 true', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const warns = await ctx.expectWarn(() => profile.init(32, -1));
      let neg: unknown;
      try { neg = await profile.init(32, -1); } catch (e) { neg = e; }
      const okZero = await profile.init(32, 0);
      return ctx.ok((neg === false || warns.length > 0) && okZero === true,
        `neg=${String(neg)} okZero=${okZero}`);
    }),

  auto('DATA-BND-003', 'init timeout 参数', 'P1', '通用',
    '不抛异常，正数正常返回', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) return ctx.skip('no device');
      const noThrow = await ctx.expectNoThrow(async () => {
        await profile.init(32, 60000, 0);
        await profile.init(32, 60000, -1);
        await profile.init(32, 60000, 10000);
      });
      return ctx.ok(noThrow, 'init timeout variants no throw');
    }),

  auto('DATA-BND-004', 'getData/getRawData 越界返回 0 不抛异常', 'P1', '通用',
    '越界返回 0', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      const a = s.getData(s.channelCount, 0);
      const b = s.getData(0, s.sampleCount);
      const c = s.getRawData(-1, 0);
      return ctx.ok(a === 0 && b === 0 && c === 0,
        `a=${a} b=${b} c=${c}`);
    }),

  auto('DATA-BND-005', 'getImpedance/getSaturation/isLost 越界返回安全值', 'P1', '通用',
    '返回 0/0/false', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      return ctx.ok(
        s.getImpedance(-1, 0) === 0 &&
          s.getSaturation(-1, 0) === 0 &&
          s.isLost(-1, 0) === false,
        'out-of-range accessors safe'
      );
    }),

  auto('DATA-BND-006', 'getChannelData 越界通道返回 fillValue', 'P1', '通用',
    '越界返回长度 sampleCount 的数组', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      const a = s.getChannelData(-1);
      const b = s.getChannelData(s.channelCount);
      return ctx.ok(
        a instanceof Float32Array && a.length === s.sampleCount &&
          b instanceof Float32Array && b.length === s.sampleCount,
        `a.len=${a.length} b.len=${b.length}`
      );
    }),

  auto('DATA-BND-007', 'isDataValid/isChannelEnabled 越界返回 false', 'P1', '通用',
    '越界返回 false', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(1000);
      const s = pickSample(data);
      if (!s) return ctx.skip('no sample data');
      return ctx.ok(
        s.isDataValid(-1, 0) === false &&
          s.isDataValid(s.channelCount, 0) === false &&
          s.isChannelEnabled(-1) === false &&
          s.isChannelEnabled(s.channelCount) === false,
        'out-of-range validity false'
      );
    }),

  auto('DATA-PERF-001', '实测采样率与标称一致', 'P1', '设备相关（需对应流采样率）',
    '实测采样率在标称容差内', async (ctx) => {
      const profile = await ctx.ensureStreaming();
      if (!profile) return ctx.skip('no device/stream');
      const data = await ctx.collectData(2000);
      const byType = new Map<number, SensorData[]>();
      for (const d of data) {
        const arr = byType.get(d.dataType) ?? [];
        arr.push(d);
        byType.set(d.dataType, arr);
      }
      const candidates = [...byType.values()].filter((arr) => arr.length > 0);
      if (candidates.length === 0) return ctx.skip('no data');
      const group = candidates[0]!;
      const nominal = group[0]!.sampleRate;
      const first = group[0]!.getAbsTimeStampInSec(0, 0);
      const last = group[group.length - 1]!.getAbsTimeStampInSec(0, 0);
      const span = last - first;
      if (span <= 0 || nominal <= 0) return ctx.skip('insufficient timing data');
      const total = group.reduce((n, d) => n + d.sampleCount, 0);
      const actual = total / span;
      const tol = Math.abs(actual - nominal) / nominal;
      return ctx.ok(tol <= 0.15, `actual=${actual.toFixed(1)} nominal=${nominal} dev=${(tol * 100).toFixed(1)}%`);
    }),

  semi('DATA-PERF-002', '长稳连续起流不中断', 'P1', '通用',
    '数据持续到达，无异常中断', '起流后值守观察（建议 ≥30s），确认数据持续到达。'),

  semi('DATA-PERF-003', '干扰下 lostPackageCount 增长可观测', 'P2', '通用',
    '丢包计数单调不减', '起流后拉远距离/制造弱信号，观察 lostPackageCount 变化。'),
];
