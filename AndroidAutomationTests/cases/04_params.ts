import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { SensorProfile } from '@synchroni/synchroni_sdk_react_native';
import type { TestCase } from '../types';

const CANDIDATE_RATE_LISTS = [
  'EEG_SAMPLE_RATE_LIST',
  'EMG_SAMPLE_RATE_LIST',
  'IMU_SAMPLE_RATE_LIST',
  'PPG_SAMPLE_RATE_LIST',
  'SPO2_SAMPLE_RATE_LIST',
];

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
      const m = ntf.match(/(NTF_[A-Z0-9_]+)\|ON/);
      ctx.assert(!!m, `无法从 NTF 解析流开关: ${ntf}`);
      const key = m![1];
      const off = await p!.setParam(key, 'OFF');
      ctx.assert(off === 'OK', `setParam(${key},OFF) 应为 OK，实际 ${off}`);
      const on = await p!.setParam(key, 'ON');
      ctx.assert(on === 'OK', `setParam(${key},ON) 应为 OK，实际 ${on}`);
      return `${key} toggled`;
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
      return `${rateKey}=${rates[0]}`;
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
      const s = await p!.setParam('NOT_EXIST_KEY', '1');
      ctx.assert(s.startsWith('Error') || s.startsWith('Not supported'),
        `非法 key 应返回 Error，实际 ${s}`);
      return s;
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
      await ctx.prepare(p!);
      const listKey = await findRateListKey(p!);
      if (!listKey) {
        ctx.skip('设备不支持采样率参数');
      }
      const rateKey = listKey!.replace('_LIST', '');
      const s = await p!.setParam(rateKey, '9999');
      ctx.assert(s.startsWith('Error') || s.startsWith('Not supported'),
        `非法档位应返回 Error，实际 ${s}`);
      return s;
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
      const s = await p!.setParam('NTF_EEG', 'ON');
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
      return 'ok';
    },
  },
  {
    id: 'PARAM-ROB-002',
    title: '参数下发后立即起流',
    chapter: '04_参数',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const ntf = await p!.getParam('NTF');
      ctx.assert(!ntf.startsWith('Error'), `getParam(NTF) 失败: ${ntf}`);
      const m = ntf.match(/(NTF_[A-Z0-9_]+)\|ON/);
      ctx.assert(!!m, `无法解析流开关: ${ntf}`);
      await p!.setParam(m![1], 'ON');
      const ok = await p!.startDataNotification();
      ctx.assert(ok === true, '参数后起流应成功');
      await p!.stopDataNotification();
      return 'ok';
    },
  },
];
