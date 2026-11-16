import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { SensorProfile } from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from '../TestConfig';
import type { TestCase, TestContext } from '../types';

const noop = () => {};

async function liveCheck(ctx: TestContext, p: SensorProfile): Promise<number> {
  await ctx.prepare(p);
  let batches = 0;
  p.onSensorNotifyData = () => {
    batches += 1;
  };
  await p.startDataNotification();
  await ctx.sleep(2000);
  await p.stopDataNotification();
  p.onSensorNotifyData = noop;
  return batches;
}

export const systemCases: TestCase[] = [
  {
    id: 'SYS-ROB-001',
    title: '扫描/连接中关闭蓝牙',
    chapter: '08_系统异常',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['关闭系统蓝牙（Android 快速设置 / iOS 控制中心）。'],
    run: async (ctx) => {
      await ctx.sleep(1500);
      ctx.assert(SensorController.Instance.isEnable === false, '关闭蓝牙后 isEnable 应为 false');
      return 'isEnable=false';
    },
  },
  {
    id: 'SYS-ROB-002',
    title: '起流中关闭蓝牙',
    chapter: '08_系统异常',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['先建立连接并起流，随后关闭系统蓝牙。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.sleep(1500);
      ctx.assert(!p!.isDataTransfering, '关闭蓝牙后数据流应停止');
      return 'data stopped';
    },
  },
  {
    id: 'SYS-ROB-003',
    title: '蓝牙重开后自动恢复',
    chapter: '08_系统异常',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['先起流，关闭蓝牙，再重新打开蓝牙。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      p!.autoReconnect = true;
      await ctx.waitFor(() => p!.isReady, 60000, '蓝牙重开后自动重连 Ready');
      return 'recovered';
    },
  },
  {
    id: 'SYS-ROB-004',
    title: '飞行模式开关',
    chapter: '08_系统异常',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['开启飞行模式（等价关闭蓝牙）。'],
    run: async (ctx) => {
      await ctx.sleep(1500);
      ctx.assert(SensorController.Instance.isEnable === false, '飞行模式开启后 isEnable 应为 false');
      return 'isEnable=false';
    },
  },
  {
    id: 'SYS-ROB-005',
    title: 'WiFi 开关不影响已起 BLE 数据',
    chapter: '08_系统异常',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['建立连接并起流后，反复开关 WiFi。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const n = await liveCheck(ctx, p!);
      ctx.assert(n > 0, 'WiFi 切换后 BLE 数据未续传');
      return `batches=${n}`;
    },
  },
  {
    id: 'SYS-ROB-006',
    title: '扫描中开关 WiFi',
    chapter: '08_系统异常',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['startScan 过程中反复开关 WiFi。'],
    run: async (ctx) => {
      const list = await SensorController.Instance.scanOnce(TestConfig.SCAN_TIMEOUT_MS);
      ctx.assert(Array.isArray(list), '扫描应正常返回');
      return `found ${list.length} device(s)`;
    },
  },
  {
    id: 'SYS-ROB-007',
    title: '通知/横幅弹窗打断不中断起流',
    chapter: '08_系统异常',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['起流稳定后触发系统通知横幅/弹窗。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const n = await liveCheck(ctx, p!);
      ctx.assert(n > 0, '弹窗打断后数据未续传');
      return `batches=${n}`;
    },
  },
  {
    id: 'SYS-ROB-008',
    title: '来电打断后恢复',
    chapter: '08_系统异常',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['起流中来电（或模拟通话），通话结束后回到 App。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const n = await liveCheck(ctx, p!);
      ctx.assert(n > 0, '来电打断后数据未恢复');
      return `batches=${n}`;
    },
  },
  {
    id: 'SYS-ROB-009',
    title: 'App 切后台再回前台（onSuspend）',
    chapter: '08_系统异常',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['起流中切后台（App Switcher）再回前台；或直接触发 onSuspend。'],
    run: async (ctx) => {
      let threw = false;
      try {
        SensorController.Instance.onSuspend();
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, 'onSuspend 不应抛异常');
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const n = await liveCheck(ctx, p!);
      ctx.assert(n > 0, '回前台后数据未续传');
      return 'suspended + resumed';
    },
  },
  {
    id: 'SYS-ROB-010',
    title: '锁屏/解锁',
    chapter: '08_系统异常',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['起流中锁屏，数秒后解锁。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const n = await liveCheck(ctx, p!);
      ctx.assert(n > 0, '解锁后数据未恢复');
      return `batches=${n}`;
    },
  },
  {
    id: 'SYS-ROB-011',
    title: '屏幕旋转（横竖屏）',
    chapter: '08_系统异常',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['起流中旋转屏幕（横竖屏切换）。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const n = await liveCheck(ctx, p!);
      ctx.assert(n > 0, '旋转后数据未续传');
      return `batches=${n}`;
    },
  },
  {
    id: 'SYS-ROB-012',
    title: '分屏/多窗口',
    chapter: '08_系统异常',
    priority: 'P2',
    mode: 'manual',
    steps: ['起流中进入分屏/多窗口，观察数据持续、无崩溃；切回全屏正常。'],
  },
  {
    id: 'SYS-ROB-013',
    title: '权限授予/撤销（Android 定位/蓝牙）',
    chapter: '08_系统异常',
    priority: 'P0',
    mode: 'manual',
    steps: [
      '撤销 ACCESS_FINE_LOCATION / BLUETOOTH_SCAN / BLUETOOTH_CONNECT 后调用 startScan/connect，观察拒绝引导且不崩溃。',
      '重新授予后扫描/连接恢复正常。',
    ],
  },
  {
    id: 'SYS-ROB-014',
    title: '系统弹窗（低电量提示等）打断',
    chapter: '08_系统异常',
    priority: 'P2',
    mode: 'semi-auto',
    steps: ['起流中触发低电量/系统提示弹窗。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const n = await liveCheck(ctx, p!);
      ctx.assert(n > 0, '系统弹窗打断后数据未续传');
      return `batches=${n}`;
    },
  },
];
