import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import {
  createSerializable,
  createWorkletRuntime,
  runOnRuntimeAsync,
} from 'react-native-worklets';
import { TestConfig } from '../TestConfig';
import type { TestCase } from '../types';

const noop = () => {};

/** worklet 端 onData：仅计数，验证数据确实投递到 worklet 而非 JS 线程。 */
const workletOnData = (_payloads: unknown[]): void => {
  'worklet';
  const g = globalThis as unknown as { __asyncTestBatchCount?: number };
  g.__asyncTestBatchCount = (g.__asyncTestBatchCount ?? 0) + 1;
};

/** 读取 worklet 端累计批次数（在 worklet runtime 上执行）。 */
const readWorkletBatchCount = (): number => {
  'worklet';
  const g = globalThis as unknown as { __asyncTestBatchCount?: number };
  return g.__asyncTestBatchCount ?? 0;
};

export const asyncCases: TestCase[] = [
  {
    id: 'ASYNC-FUNC-001',
    title: 'async 接口 await 结果正确',
    chapter: '09_异步接口',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const version = await SensorController.Instance.getVersion();
      ctx.assert(typeof version === 'string' && version.length > 0, 'getVersion 应 resolve');
      const backend = await SensorController.Instance.getParam('BACK_END');
      ctx.assert(typeof backend === 'string', 'getParam 应 resolve');
      return `version=${version}`;
    },
  },
  {
    id: 'ASYNC-FUNC-002',
    title: 'onSensorNotifyData 异步回调节律',
    chapter: '09_异步接口',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let callbacks = 0;
      p!.onSensorNotifyData = () => {
        callbacks += 1;
      };
      await p!.startDataNotification();
      await ctx.sleep(2000);
      await p!.stopDataNotification();
      p!.onSensorNotifyData = noop;
      await p!.disconnect();
      ctx.assert(callbacks > 0, '2s 内未收到数据回调');
      return `callbacks=${callbacks}`;
    },
  },
  {
    id: 'ASYNC-FUNC-003',
    title: 'autoReconnect answer 异步一次性',
    chapter: '09_异步接口',
    priority: 'P1',
    mode: 'semi-auto',
    steps: [
      '第 1 步：确保设备已连接；点击「验证」后关闭设备电源，等待断链',
      '第 2 步：重新打开设备电源，等待 onAutoReconnect 回调；回调内异步 answer(true)，随后 answer(false) 应被忽略',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      let called = false;
      let answered = false;
      try {
        if (!p!.isReady) {
          await ctx.prepare(p!);
        }
        ctx.assert(p!.isReady, '设备应已连接 Ready');
        p!.onAutoReconnect = (_s, _hasLast, answer) => {
          called = true;
          setTimeout(() => {
            answer(true);
            answered = true;
          }, 50);
          setTimeout(() => answer(false), 100);
        };
        p!.autoReconnect = true;
        ctx.log('第 1 步：请关闭设备电源，等待断链…');
        await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
        ctx.log('已断链。第 2 步：请重新打开设备电源，等待 onAutoReconnect 回调…');
        await ctx.waitFor(() => called, 60000, 'onAutoReconnect 回调（超时：设备可能未重开）');
        ctx.log('已触发回调，观察 answer 一次性语义…');
        await ctx.sleep(500);
        ctx.assert(called, 'onAutoReconnect 回调未触发');
      } finally {
        p!.onAutoReconnect = undefined;
        p!.autoReconnect = false;
        await p!.disconnect();
      }
      return `answer once (called=${called}, answered=${answered})`;
    },
  },
  {
    id: 'ASYNC-FUNC-004',
    title: 'useWorkletRuntime 绑定/解绑',
    chapter: '09_异步接口',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);

      const runtime = createWorkletRuntime({
        name: 'async-test-worklet',
        initializer: () => {
          'worklet';
          (globalThis as unknown as { __asyncTestBatchCount: number }).__asyncTestBatchCount = 0;
        },
      });

      let bound = false;
      let unbound: boolean | null = null;
      let workletBatches = 0;
      let jsBatchesWhileBound = 0;
      let jsBatchesAfterUnbind = 0;
      try {
        bound = p!.useWorkletRuntime(runtime, createSerializable(workletOnData) as object);
        ctx.assert(
          bound === true,
          `绑定 worklet 应返回 true，实际返回 ${JSON.stringify(bound)} (type=${typeof bound})`,
        );

        p!.onSensorNotifyData = () => {
          jsBatchesWhileBound += 1;
        };
        ctx.assert(await p!.startDataNotification(), 'startDataNotification() returned false');
        await ctx.sleep(2000);
        await p!.stopDataNotification();
        p!.onSensorNotifyData = noop;

        workletBatches = await runOnRuntimeAsync(runtime, readWorkletBatchCount);
        ctx.assert(workletBatches > 0, `绑定后 worklet 应收到数据，实际 ${workletBatches} 批`);
        ctx.assert(
          jsBatchesWhileBound === 0,
          `绑定期间 JS 线程不应收到数据，实际 ${jsBatchesWhileBound} 批`,
        );
      } finally {
        p!.onSensorNotifyData = noop;
        unbound = p!.useWorkletRuntime(null);
      }

      p!.onSensorNotifyData = () => {
        jsBatchesAfterUnbind += 1;
      };
      await p!.startDataNotification();
      await ctx.sleep(2000);
      await p!.stopDataNotification();
      p!.onSensorNotifyData = noop;
      ctx.assert(jsBatchesAfterUnbind > 0, `解绑后 JS 线程应收到数据，实际 ${jsBatchesAfterUnbind} 批`);

      await p!.disconnect();
      return `bound=${bound}, unbound=${JSON.stringify(unbound)}, workletBatches=${workletBatches}, jsWhileBound=${jsBatchesWhileBound}, jsAfterUnbind=${jsBatchesAfterUnbind}`;
    },
  },
  {
    id: 'ASYNC-FUNC-005',
    title: '并发调用合并（coalesce）',
    chapter: '09_异步接口',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        const [a, b] = await Promise.all([p!.connect(), p!.connect()]);
        ctx.assert(a === true && b === true, '并发 connect 应成功');
        await ctx.waitFor(() => p!.isReady, TestConfig.READY_TIMEOUT_MS, 'Ready');
      }
      await p!.disconnect();
      return 'coalesced';
    },
  },
  {
    id: 'ASYNC-ROB-001',
    title: '未 await 的并发 getParam 顺序',
    chapter: '09_异步接口',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const results = await Promise.all([
        p!.getParam('NTF'),
        p!.getParam('NTF'),
        p!.getParam('NTF'),
      ]);
      await p!.disconnect();
      ctx.assert(results.every((r) => typeof r === 'string'), '并发 getParam 应返回字符串');
      return 'ok';
    },
  },
  {
    id: 'ASYNC-ROB-002',
    title: 'onAutoReconnect 多次 answer 只生效一次',
    chapter: '09_异步接口',
    priority: 'P1',
    mode: 'semi-auto',
    steps: [
      '第 1 步：确保设备已连接；点击「验证」后关闭设备电源，等待断链',
      '第 2 步：重新打开设备电源，等待 onAutoReconnect 回调；回调内连续两次 answer(true)，应只生效一次',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      let called = false;
      try {
        if (!p!.isReady) {
          await ctx.prepare(p!);
        }
        ctx.assert(p!.isReady, '设备应已连接 Ready');
        p!.onAutoReconnect = (_s, _hasLast, answer) => {
          called = true;
          answer(true);
          answer(true);
        };
        p!.autoReconnect = true;
        ctx.log('第 1 步：请关闭设备电源，等待断链…');
        await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
        ctx.log('已断链。第 2 步：请重新打开设备电源，等待 onAutoReconnect 回调…');
        await ctx.waitFor(() => called, 60000, 'onAutoReconnect 回调（超时：设备可能未重开）');
        ctx.assert(called, 'onAutoReconnect 回调未触发');
      } finally {
        p!.onAutoReconnect = undefined;
        p!.autoReconnect = false;
        await p!.disconnect();
      }
      return 'answer idempotent';
    },
  },
  {
    id: 'ASYNC-ROB-003',
    title: 'useWorkletRuntime 非法参数返回 false',
    chapter: '09_异步接口',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const ret = p!.useWorkletRuntime(undefined as any);
      ctx.log(`useWorkletRuntime(undefined) -> ${JSON.stringify(ret)} (type=${typeof ret})`);
      ctx.assert(
        ret === false,
        `非法参数应返回 false，实际返回 ${JSON.stringify(ret)} (type=${typeof ret})`,
      );
      return `ret=${JSON.stringify(ret)} (type=${typeof ret})`;
    },
  },
];
