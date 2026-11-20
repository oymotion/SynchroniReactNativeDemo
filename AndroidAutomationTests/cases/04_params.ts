import { DataType, SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { SensorProfile } from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from '../TestConfig';
import type { TestCase } from '../types';

const CANDIDATE_RATE_LISTS = [
  'EEG_SAMPLE_RATE_LIST',
  'EMG_SAMPLE_RATE_LIST',
  'IMU_SAMPLE_RATE_LIST',
  'PPG_SAMPLE_RATE_LIST',
  'SPO2_SAMPLE_RATE_LIST',
];

/** setParam 在 native 侧失败会 reject（抛异常），这里转成字符串返回，便于带 key 定位是哪个开关失败。 */
async function safeSetParam(p: SensorProfile, key: string, value: string): Promise<string> {
  try {
    return await p.setParam(key, value);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function findRateListKey(p: SensorProfile): Promise<string | undefined> {
  for (const key of CANDIDATE_RATE_LISTS) {
    const s = await p.getParam(key);
    if (typeof s === 'string' && !s.startsWith('Error')) {
      return key;
    }
  }
  return undefined;
}

export const paramCases: TestCase[] = [
  {
    id: 'PARAM-FUNC-001',
    title: 'getParam("NTF") 返回流开关列表',
    chapter: '04_参数',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const s = await p!.getParam('NTF');
      ctx.assert(!s.startsWith('Error'), `getParam(NTF) 失败: ${s}`);
      ctx.assert(s.includes('|'), 'NTF 列表格式异常');
      await p!.disconnect();
      return s;
    },
  },
  {
    id: 'PARAM-FUNC-002',
    title: 'getParam("FILTER") 返回滤波开关',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const s = await p!.getParam('FILTER');
      ctx.assert(typeof s === 'string', 'getParam(FILTER) 应返回字符串');
      await p!.disconnect();
      return s.startsWith('Error') ? 'FILTER not supported (recorded)' : s;
    },
  },
  {
    id: 'PARAM-FUNC-003',
    title: 'setParam 流开关 ON/OFF',
    chapter: '04_参数',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const ntf = await p!.getParam('NTF');
      ctx.assert(!ntf.startsWith('Error'), `getParam(NTF) 失败: ${ntf}`);
      // 逐个遍历 NTF 里所有受支持的流开关（含 EEG/EMG），每个都做 ON/OFF 下发并回读，
      // 而非只取第一个（原来只测到 NTF_ANGLE）。
      const entries = [...ntf.matchAll(/(NTF_[A-Z0-9_]+)\|(ON|OFF)/g)];
      ctx.assert(entries.length > 0, `无法从 NTF 解析流开关: ${ntf}`);
      const toggled: string[] = [];
      const failed: string[] = [];
      for (const m of entries) {
        const key = m[1];
        const orig = m[2];
        const flip = orig === 'ON' ? 'OFF' : 'ON';
        ctx.log(`[PARAM-FUNC-003] toggling ${key}: ${orig} -> ${flip}`);
        const a = await safeSetParam(p!, key, flip);
        let back = '';
        try {
          back = await p!.getParam('NTF');
        } catch (e) {
          back = e instanceof Error ? e.message : String(e);
        }
        const b = await safeSetParam(p!, key, orig);
        const ok = a === 'OK' && new RegExp(`${key}\\|${flip}`).test(back) && b === 'OK';
        toggled.push(key);
        if (!ok) {
          failed.push(`${key}(set=${a},readback=${back},restore=${b})`);
        }
      }
      await p!.disconnect();
      ctx.assert(failed.length === 0, `以下流开关失败: ${failed.join(' | ')}`);
      return `${toggled.join(',')} toggled`;
    },
  },
  {
    id: 'PARAM-FUNC-004',
    title: 'setParam 采样率下发并回读',
    chapter: '04_参数',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const listKey = await findRateListKey(p!);
      if (!listKey) {
        ctx.skip('设备不支持任何采样率参数');
      }
      const list = await p!.getParam(listKey!);
      const rates = list.split('|').filter((x) => x.length > 0);
      ctx.assert(rates.length > 0, `采样率列表为空: ${list}`);
      const rateKey = listKey!.replace('_LIST', '');
      const ok = await p!.setParam(rateKey, rates[0]);
      ctx.assert(ok === 'OK', `setParam(${rateKey},${rates[0]}) 应为 OK: ${ok}`);
      const back = await p!.getParam(rateKey);
      ctx.assert(back === rates[0], `回读应一致: ${back} vs ${rates[0]}`);
      await p!.disconnect();
      return `${rateKey}=${rates[0]}`;
    },
  },
  {
    id: 'PARAM-FUNC-005',
    title: 'getParam 采样率回读',
    chapter: '04_参数',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const listKey = await findRateListKey(p!);
      if (!listKey) {
        ctx.skip('设备不支持采样率参数');
      }
      const list = await p!.getParam(listKey!);
      const rates = list.split('|').filter((x) => x.length > 0);
      ctx.assert(rates.length > 0, `采样率列表为空: ${list}`);
      const rateKey = listKey!.replace('_LIST', '');
      // 逐档位下发并回读，验证 getParam 始终反映最新下发值。
      for (const rate of rates) {
        const set = await safeSetParam(p!, rateKey, rate);
        ctx.assert(set === 'OK', `setParam(${rateKey},${rate}) 应为 OK: ${set}`);
        const back = await p!.getParam(rateKey);
        ctx.assert(back === rate, `回读应一致: ${back} vs ${rate}`);
      }
      await p!.disconnect();
      return `${rateKey} readback ok (${rates.join(',')})`;
    },
  },
  {
    id: 'PARAM-FUNC-006',
    title: 'setParam 滤波开关',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const f = await p!.getParam('FILTER');
      if (f.startsWith('Error') || !f) {
        await p!.disconnect();
        ctx.skip(`无滤波能力: ${f || '(empty)'}`);
      }
      const entries = [...f.matchAll(/(FILTER_[A-Z0-9_]+)\|(ON|OFF)/g)];
      ctx.assert(entries.length > 0, `无法从 FILTER 解析滤波开关: ${f}`);
      const toggled: string[] = [];
      const failed: string[] = [];
      for (const m of entries) {
        const key = m[1];
        const orig = m[2];
        const flip = orig === 'ON' ? 'OFF' : 'ON';
        ctx.log(`[PARAM-FUNC-006] toggling ${key}: ${orig} -> ${flip}`);
        const a = await safeSetParam(p!, key, flip);
        let back = '';
        try {
          back = await p!.getParam('FILTER');
        } catch (e) {
          back = e instanceof Error ? e.message : String(e);
        }
        const b = await safeSetParam(p!, key, orig);
        const ok = a === 'OK' && new RegExp(`${key}\\|${flip}`).test(back) && b === 'OK';
        toggled.push(key);
        if (!ok) {
          failed.push(`${key}(set=${a},readback=${back},restore=${b})`);
        }
      }
      await p!.disconnect();
      ctx.assert(failed.length === 0, `以下滤波开关失败: ${failed.join(' | ')}`);
      return `${toggled.join(',')} toggled`;
    },
  },
  {
    id: 'PARAM-FUNC-009',
    title: '采样率可选档位查询（_LIST）',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const listKey = await findRateListKey(p!);
      if (!listKey) {
        ctx.skip('设备不支持任何采样率参数');
      }
      const list = await p!.getParam(listKey!);
      ctx.assert(!list.startsWith('Error'), `查询档位失败: ${list}`);
      await p!.disconnect();
      return `${listKey}=${list}`;
    },
  },
  {
    id: 'PARAM-FUNC-007',
    title: '控制器 setParam DEBUG_ENABLED/DATA_LOG_ENABLED',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      for (const [k, v] of [['DEBUG_ENABLED', 'True'], ['DEBUG_ENABLED', 'False'], ['DATA_LOG_ENABLED', 'True'], ['DATA_LOG_ENABLED', 'False']]) {
        const ok = await c.setParam(k, v);
        ctx.assert(ok === 'OK', `setParam(${k},${v}) 应为 OK: ${ok}`);
      }
      return 'ok';
    },
  },
  {
    id: 'PARAM-FUNC-008',
    title: '控制器 getParam 回读',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      for (const k of ['DEBUG_ENABLED', 'DATA_LOG_ENABLED', 'LOG_PATH', 'BACK_END']) {
        const v = await c.getParam(k);
        ctx.assert(typeof v === 'string', `getParam(${k}) 应返回字符串`);
      }
      return 'ok';
    },
  },
  {
    id: 'PARAM-FUNC-010',
    title: '角度流 NTF_ANGLE 独立开关',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const info = await ctx.fetchDeviceInfo(p!);
      if (!info || (info.AngleChannelCount ?? 0) <= 0) {
        ctx.skip('设备不支持角度流');
      }
      const ok = await p!.setParam('NTF_ANGLE', 'OFF');
      ctx.assert(ok === 'OK', `NTF_ANGLE 应为可设置，实际 ${ok}`);
      const dataKey = await p!.setParam('NTF_ANGLE_DATA', 'OFF');
      ctx.assert(dataKey.startsWith('Error') || dataKey.startsWith('Not supported'),
        `NTF_ANGLE_DATA 应为 Error/Not supported，实际 ${dataKey}`);
      await p!.setParam('NTF_ANGLE', 'ON');
      await p!.disconnect();
      return 'angle switch isolated';
    },
  },
  {
    id: 'PARAM-FUNC-011',
    title: '磁力计无独立开关（随 NTF_IMU 聚合）',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const mag = await p!.setParam('NTF_MAG', 'OFF');
      ctx.assert(mag.startsWith('Error') || mag.startsWith('Not supported'),
        `NTF_MAG 应为 Error/Not supported，实际 ${mag}`);
      await p!.disconnect();
      return `NTF_MAG -> ${mag}`;
    },
  },
  {
    id: 'PARAM-BND-001',
    title: 'setParam 空 key / null value',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      for (const args of [['', 'ON'], ['NTF_EEG', null]] as any[]) {
        let threw = false;
        try {
          await p!.setParam(args[0], args[1]);
        } catch (e) {
          threw = true;
        }
        ctx.assert(threw, `setParam(${JSON.stringify(args)}) 应抛 Error`);
      }
      return 'invalid args rejected';
    },
  },
  {
    id: 'PARAM-BND-002',
    title: 'setParam 非法 key',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      // RN setParam 对「未知 key」是 reject（抛异常），不是返回 "Error: ..." 字符串
      // （README 明确要求 try/catch）；返回 "Error/Not supported" 字符串的是 getParam 语义。
      let threw = false;
      let msg = '';
      try {
        msg = await p!.setParam('NOT_EXIST_KEY', '1');
      } catch (e) {
        threw = true;
        msg = e instanceof Error ? e.message : String(e);
      }
      ctx.assert(
        threw || msg.startsWith('Error') || msg.startsWith('Not supported'),
        `非法 key 应被拒绝（抛异常或返回 Error/Not supported），实际 ${msg}`,
      );
      await p!.disconnect();
      return threw ? `rejected: ${msg}` : msg;
    },
  },
  {
    id: 'PARAM-BND-003',
    title: 'setParam 非法 value（不支持档位）',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      try {
        await ctx.prepare(p!);
        const listKey = await findRateListKey(p!);
        if (!listKey) {
          ctx.skip('设备不支持采样率参数');
        }
        const rateKey = listKey!.replace('_LIST', '');
        // setParam 在 native 侧对「Error: ...」结果走 reject（而非 resolve 返回字符串），
        // 因此捕获异常信息作为判定依据，而不是读 resolve 的返回值。
        let s = '';
        try {
          s = await p!.setParam(rateKey, '9999');
        } catch (e) {
          s = e instanceof Error ? e.message : String(e);
        }
        ctx.assert(s.startsWith('Error') || s.startsWith('Not supported'),
          `非法档位应返回 Error，实际 ${s}`);
        return s;
      } finally {
        await p!.disconnect();
      }
    },
  },
  {
    id: 'PARAM-BND-004',
    title: 'getParam 空 key',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      let threw = false;
      let s = '';
      try {
        s = await p!.getParam('');
      } catch (e) {
        threw = true;
      }
      ctx.assert(threw || s.startsWith('Error'), '空 key 应被拒绝');
      return 'ok';
    },
  },
  {
    id: 'PARAM-BND-005',
    title: '未连接时 setParam/getParam',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (p!.isReady) {
        await p!.disconnect();
      }
      // setParam 在 native 侧对「Error: ...」结果走 reject（而非 resolve 返回字符串），
      // 因此捕获异常信息作为判定依据。
      let s = '';
      try {
        s = await p!.setParam('NTF_EEG', 'ON');
      } catch (e) {
        s = e instanceof Error ? e.message : String(e);
      }
      ctx.assert(s.startsWith('Error') || s.startsWith('Not supported'),
        `未连接 setParam 应返回 Error，实际 ${s}`);
      return s;
    },
  },
  {
    id: 'PARAM-ROB-001',
    title: '快速连续 setParam',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let threw = false;
      try {
        const ps: Promise<string>[] = [];
        for (let i = 0; i < 5; i++) {
          ps.push(p!.getParam('NTF'));
        }
        await Promise.all(ps);
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, '连续 getParam 不应抛异常');
      await p!.disconnect();
      return 'ok';
    },
  },
  {
    id: 'PARAM-ROB-002',
    title: '设置 EEG 采样率 500 并起流验证 EEG 数据',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      // 设置 EEG 采样率 500（采样率 key = EEG_SAMPLE_RATE，value 为档位字符串）
      const s = await safeSetParam(p!, 'EEG_SAMPLE_RATE', '500');
      ctx.assert(s === 'OK', `EEG_SAMPLE_RATE=500 应返回 OK，实际 ${s}`);
      // 起流并收集 EEG 数据（按 dataType 隔离，只看 EEG 流）
      let eegRate = 0;
      let eegCh = 0;
      let eegSamples = 0;
      const firstValues: number[] = [];
      const absDeltas: number[] = []; // 相邻样本绝对时间戳差（秒），用于验证真实 500Hz
      let prevAbs = -1;
      p!.onSensorNotifyData = (_p, list) => {
        for (const d of list) {
          if (d.dataType === DataType.NTF_EEG) {
            eegRate = d.sampleRate;
            eegCh = d.channelCount;
            eegSamples = d.sampleCount;
            if (firstValues.length === 0 && d.sampleCount > 0) {
              for (let si = 0; si < Math.min(5, d.sampleCount); si++) {
                firstValues.push(d.getData(0, si));
              }
              // 采集第一包 EEG 通道 0 相邻样本的绝对时间戳差（秒）
              for (let si = 0; si < d.sampleCount; si++) {
                const abs = d.getAbsTimeStampInSec(0, si);
                if (abs > 0 && prevAbs > 0) {
                  absDeltas.push(abs - prevAbs);
                }
                prevAbs = abs;
              }
            }
          }
        }
      };
      try {
        const ok = await p!.startDataNotification();
        ctx.assert(ok === true, '起流应成功');
        await ctx.waitFor(
          () => p!.isDataTransfering && eegSamples > 0,
          TestConfig.DATA_TIMEOUT_MS,
          'EEG 起流并收到数据',
        );
        ctx.assert(p!.isDataTransfering, '起流后 isDataTransfering 应为 true');
        ctx.assert(eegSamples > 0, '应收到 EEG 数据');
        ctx.assert(eegRate === 500, `EEG 采样率应为 500，实际 ${eegRate}`);
        ctx.assert(eegCh > 0, `EEG 通道数应 >0，实际 ${eegCh}`);
        // 用相邻样本绝对时间戳差验证真实采样率（500Hz → 1/500 = 0.002s）
        ctx.assert(absDeltas.length > 0, '应能采集到相邻样本绝对时间戳差（absTimeStamp 未填充）');
        const expectAbsDelta = 1 / 500;
        const avgAbsDelta = absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length;
        ctx.assert(
          Math.abs(avgAbsDelta - expectAbsDelta) < 0.001,
          `500Hz 相邻样本绝对时间戳差应 ≈0.002s，实际平均 ${avgAbsDelta.toFixed(6)}s，deltas=[${absDeltas.map((v) => v.toFixed(5)).join(',')}]`,
        );
      } finally {
        p!.onSensorNotifyData = () => {};
        await p!.stopDataNotification();
        await p!.disconnect();
      }
      const avgAbs = absDeltas.length
        ? absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length
        : 0;
      return `EEG rate=${eegRate} ch=${eegCh} samples=${eegSamples} absDeltaAvg=${avgAbs.toFixed(6)}s ch0前5样本=[${firstValues.map((v) => v.toFixed(2)).join(', ')}]`;
    },
  },
];
