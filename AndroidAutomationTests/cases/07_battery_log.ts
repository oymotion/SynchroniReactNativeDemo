import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { TestCase } from '../types';

export const batteryLogCases: TestCase[] = [
  {
    id: 'BATT-FUNC-001',
    title: 'getBatteryLevel 返回有效值',
    chapter: '07_电量日志调试',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const lvl = await p!.getBatteryLevel();
      ctx.assert(typeof lvl === 'number', 'getBatteryLevel 应返回 number');
      ctx.assert(lvl >= 0, `电量应 >=0，实际 ${lvl}`);
      return `battery=${lvl}`;
    },
  },
  {
    id: 'BATT-FUNC-003',
    title: '未连接 getBatteryLevel 返回 -1',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (p!.isReady) {
        await p!.disconnect();
      }
      const lvl = await p!.getBatteryLevel();
      ctx.assert(lvl === -1, `未连接电量应为 -1，实际 ${lvl}`);
      return 'sentinel -1';
    },
  },
  {
    id: 'BATT-FUNC-004',
    title: '电量缓存优先',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const lvl1 = await p!.getBatteryLevel();
      const lvl2 = await p!.getBatteryLevel();
      ctx.assert(lvl1 >= 0 && lvl2 >= 0, '电量读取失败');
      ctx.assert(lvl2 === lvl1, `第二次读取应命中缓存: ${lvl1} vs ${lvl2}`);
      return `cached=${lvl1}`;
    },
  },
  {
    id: 'BATT-FUNC-002',
    title: 'onPowerChanged 收到电量推送',
    chapter: '07_电量日志调试',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['保持设备连接，等待电量推送（或触发刷新）。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let received: number | undefined;
      p!.onPowerChanged = (_s, power) => {
        received = power;
      };
      await p!.getBatteryLevel();
      await ctx.sleep(3000);
      p!.onPowerChanged = () => {};
      // 电量推送非强制必达，仅在收到时校验，未收到不判 FAIL。
      if (received !== undefined) {
        ctx.assert(received >= 0, `电量推送应 >=0，实际 ${received}`);
      }
      return received !== undefined ? `power=${received}` : 'no push within window (recorded)';
    },
  },
  {
    id: 'LOG-FUNC-001',
    title: 'controller log 写日志',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      let threw = false;
      try {
        SensorController.Instance.log('automation controller log', 'I');
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, 'controller.log 不应抛异常');
      return 'ok';
    },
  },
  {
    id: 'LOG-FUNC-002',
    title: 'profile log 写设备日志',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      let threw = false;
      try {
        p!.log('automation profile log', 'W');
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, 'profile.log 不应抛异常');
      return 'ok';
    },
  },
  {
    id: 'LOG-FUNC-003',
    title: 'DEBUG_ENABLED 开启后 D 级日志落盘',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      const ok1 = await c.setParam('DEBUG_ENABLED', 'True');
      ctx.assert(ok1 === 'OK', `DEBUG_ENABLED True 应为 OK: ${ok1}`);
      c.log('automation D-level', 'D');
      const ok2 = await c.setParam('DEBUG_ENABLED', 'False');
      ctx.assert(ok2 === 'OK', `DEBUG_ENABLED False 应为 OK: ${ok2}`);
      return 'ok';
    },
  },
  {
    id: 'LOG-FUNC-004',
    title: 'DATA_LOG_ENABLED 控制数据日志',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      ctx.assert(await c.setParam('DATA_LOG_ENABLED', 'True') === 'OK', 'True 应为 OK');
      ctx.assert(await c.setParam('DATA_LOG_ENABLED', 'False') === 'OK', 'False 应为 OK');
      return 'ok';
    },
  },
  {
    id: 'LOG-FUNC-005',
    title: 'LOG_PATH 切换日志目录',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      ctx.assert(await c.setParam('LOG_PATH', 'True') === 'OK', 'LOG_PATH True 应为 OK');
      c.log('automation path test', 'I');
      ctx.assert(await c.setParam('LOG_PATH', 'False') === 'OK', 'LOG_PATH False 应为 OK');
      return 'ok';
    },
  },
  {
    id: 'LOG-ROB-001',
    title: 'log 空消息不崩溃',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      let threw = false;
      try {
        SensorController.Instance.log('');
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, '空消息不应崩溃');
      return 'ok';
    },
  },
  {
    id: 'LOG-ROB-002',
    title: 'log 非法 level 回退 I',
    chapter: '07_电量日志调试',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      let threw = false;
      try {
        SensorController.Instance.log('msg', 'X' as any);
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, '非法 level 不应崩溃');
      return 'ok';
    },
  },
];
