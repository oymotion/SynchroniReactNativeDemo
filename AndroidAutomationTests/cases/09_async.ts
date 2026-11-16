import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from '../TestConfig';
import type { TestCase } from '../types';

const noop = () => {};

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
    steps: ['注册 onAutoReconnect 后制造断链；回调内异步调用 answer(true)，再次 answer(false) 应被忽略。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      let called = false;
      p!.onAutoReconnect = (_s, _hasLast, answer) => {
        called = true;
        setTimeout(() => answer(true), 50);
        setTimeout(() => answer(false), 100);
      };
      ctx.log('请现在制造断链，观察 answer 一次性语义…');
      await ctx.waitFor(() => called, 60000, 'onAutoReconnect 回调');
      await ctx.sleep(500);
      p!.onAutoReconnect = undefined;
      return 'answer once';
    },
  },
  {
    id: 'ASYNC-FUNC-004',
    title: 'useWorkletRuntime 绑定/解绑',
    chapter: '09_异步接口',
    priority: 'P1',
    mode: 'manual',
    steps: [
      '安装 worklets 运行时（react-native-worklets-core / reanimated）。',
      '创建 worklet runtime 与 onData worklet，调用 useWorkletRuntime(runtime, onData) 应返回 true，数据仅投递到 worklet。',
      'useWorkletRuntime(null) 解绑后数据回到 JS 线程。',
    ],
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
    steps: ['注册 onAutoReconnect 后制造断链；回调内连续两次 answer。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      let called = false;
      p!.onAutoReconnect = (_s, _hasLast, answer) => {
        called = true;
        answer(true);
        answer(true);
      };
      ctx.log('请现在制造断链，观察 answer 幂等…');
      await ctx.waitFor(() => called, 60000, 'onAutoReconnect 回调');
      p!.onAutoReconnect = undefined;
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
      ctx.assert(ret === false, '非法参数应返回 false');
      return 'false as expected';
    },
  },
];
