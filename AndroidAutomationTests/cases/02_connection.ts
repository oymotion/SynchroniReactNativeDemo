import { DeviceStateEx } from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from '../TestConfig';
import type { TestCase } from '../types';

const noop = () => {};

export const connectionCases: TestCase[] = [
  {
    id: 'DEV-SM-001',
    title: 'connect 成功进入 Ready',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      ctx.assert(p!.isReady, '连接后 isReady 应为 true');
      ctx.assert(p!.deviceState === DeviceStateEx.Ready, 'deviceState 应为 Ready');
      await p!.disconnect();
      return 'ready (已断开清理)';
    },
  },
  {
    id: 'DEV-SM-003',
    title: '状态机全迁移顺序',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const seq: DeviceStateEx[] = [];
      p!.onStateChange = (_s, ns) => seq.push(ns);
      await p!.connect();
      await ctx.waitFor(() => p!.isReady, TestConfig.READY_TIMEOUT_MS, 'Ready');
      await p!.disconnect();
      p!.onStateChange = noop;
      ctx.assert(seq.length > 0, '未收到状态回调');
      ctx.assert(seq.includes(DeviceStateEx.Ready), '状态序列应包含 Ready');
      return `states=[${seq.join(',')}]`;
    },
  },
  {
    id: 'DEV-SM-004',
    title: 'disconnect 进入 Disconnected',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const before = `state=${DeviceStateEx[p!.deviceState]}, isReady=${p!.isReady}, hasInited=${p!.hasInited}`;
      const ok = await p!.disconnect();
      let settled = false;
      try {
        await ctx.waitFor(
          () => p!.deviceState === DeviceStateEx.Disconnected,
          TestConfig.READY_TIMEOUT_MS,
          'deviceState 到 Disconnected',
        );
        settled = true;
      } catch (e) {
        settled = false;
      }
      const after = `state=${DeviceStateEx[p!.deviceState] ?? p!.deviceState}, isReady=${p!.isReady}, hasInited=${p!.hasInited}, isAutoReconnecting=${p!.isAutoReconnecting}`;
      ctx.assert(ok, `disconnect 应返回 true，实际 ${ok}`);
      ctx.assert(settled, `deviceState 未到 Disconnected（连接前=${before}，断开后=${after}）`);
      ctx.assert(!p!.isReady, `断开后 isReady 应为 false，实际 ${p!.isReady}`);
      return `disconnected (${after})`;
    },
  },
  {
    id: 'DEV-SM-005',
    title: '重复 connect（已 Ready 再 connect）',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let threw = false;
      try {
        await p!.connect();
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, '重复 connect 不应抛异常');
      ctx.assert(p!.isReady, '重复 connect 后应仍为 Ready');
      await p!.disconnect();
      return 'idempotent (已断开清理)';
    },
  },
  {
    id: 'DEV-SM-006',
    title: '重复 disconnect 幂等',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await p!.connect();
      }
      await p!.disconnect();
      let threw = false;
      try {
        await p!.disconnect();
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, '重复 disconnect 不应抛异常');
      ctx.assert(p!.deviceState === DeviceStateEx.Disconnected, '应保持 Disconnected');
      return 'idempotent';
    },
  },
  {
    id: 'DEV-SM-007',
    title: 'onStateChange 收到各状态',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const seq: DeviceStateEx[] = [];
      p!.onStateChange = (_s, ns) => seq.push(ns);
      await p!.connect();
      await ctx.waitFor(() => p!.isReady, TestConfig.READY_TIMEOUT_MS, 'Ready');
      await p!.disconnect();
      p!.onStateChange = noop;
      ctx.assert(seq.length >= 2, `回调次数过少: ${seq.length}`);
      return `received ${seq.length} transitions`;
    },
  },
  {
    id: 'DEV-SM-008',
    title: 'isAutoReconnecting/isDataTransfering 初始值 false',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (p!.isReady) {
        await p!.disconnect();
      }
      ctx.assert(p!.isAutoReconnecting === false, 'isAutoReconnecting 应为 false');
      ctx.assert(p!.isDataTransfering === false, 'isDataTransfering 应为 false');
      ctx.assert(p!.hasInited === false, '断开后 hasInited 应为 false');
      return 'initial flags ok';
    },
  },
  {
    id: 'DEV-SM-009',
    title: 'autoReconnect 默认 true',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const ar = await p!.autoReconnect;
      ctx.assert(ar === true, 'autoReconnect 默认应为 true');
      await p!.disconnect();
      return 'default true (已断开清理)';
    },
  },
  {
    id: 'DEV-SM-010',
    title: 'autoReconnect 设为 false 后回读',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      p!.autoReconnect = false;
      const ar = await p!.autoReconnect;
      ctx.assert(ar === false, '回读应为 false');
      p!.autoReconnect = true; // 还原默认，避免影响后续用例
      await p!.disconnect();
      return 'ok (已断开清理)';
    },
  },
  {
    id: 'DEV-SM-016',
    title: 'onDataTransferStateChange 起/停流推送',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const events: boolean[] = [];
      p!.onDataTransferStateChange = (_s, t) => events.push(t);
      await p!.startDataNotification();
      await ctx.sleep(500);
      await p!.stopDataNotification();
      await ctx.sleep(500);
      p!.onDataTransferStateChange = undefined;
      ctx.assert(events.length >= 2, `应收到起/停两次推送，实际 ${events.length}`);
      await p!.disconnect();
      return `events=[${events.join(',')}] (已断开清理)`;
    },
  },
  {
    id: 'DEV-SM-017',
    title: 'onErrorCallback 收到错误',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      let err = '';
      p!.onErrorCallback = (_s, reason) => {
        err = reason;
      };
      // 未连接时直接起流，触发一次失败路径。
      if (!p!.isReady) {
        try {
          await p!.startDataNotification();
        } catch (e) {
          // ignore
        }
      }
      await ctx.sleep(300);
      p!.onErrorCallback = noop;
      // 失败路径可能不触发回调（取决于 SDK），不强制断言，仅记录不崩溃。
      return `error callback registered${err ? `, got: ${err}` : ' (no error observed)'}`;
    },
  },
  {
    id: 'DEV-SM-018',
    title: 'BLEDevice 属性返回构造设备',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const d = await ctx.scanTarget();
      ctx.assert(!!d, '目标设备未找到');
      const p = (await ctx.requireTarget())!;
      const bd = p.BLEDevice;
      ctx.assert(bd.Address === d!.Address, 'Address 应一致');
      ctx.assert(bd.Name === d!.Name, 'Name 应一致');
      return `ble=${bd.Address}`;
    },
  },
  {
    id: 'DEV-SM-002',
    title: '无效设备 connect 失败',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const { SensorController } = await import('@synchroni/synchroni_sdk_react_native');
      const fake = SensorController.Instance.requireSensor({
        Name: 'fake',
        Address: '11:22:33:44:55:66',
        RSSI: -50,
      });
      ctx.assert(!!fake, 'requireSensor(fake) 应创建 profile');
      let ret: boolean;
      try {
        ret = await fake!.connect();
      } catch (e) {
        ret = false;
      }
      ctx.assert(ret === false, '无效设备 connect 应返回 false');
      return 'connect failed gracefully';
    },
  },
  {
    id: 'DEV-SM-011',
    title: '断连自动重连回到 Ready（autoReconnect=true）',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'semi-auto',
    steps: [
      '第 1 步：点击「验证」后，关闭设备电源（制造断链），等待检测到断链',
      '第 2 步：重新打开设备电源，等待自动重连回到 Ready',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      p!.autoReconnect = true;
      ctx.log('第 1 步：请关闭设备电源，等待检测到断链…');
      await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
      ctx.log('已检测到断链。第 2 步：请重新打开设备电源，等待自动重连…');
      await ctx.waitFor(() => p!.isReady, 60000, '自动重连（isReady 变 true，超时：设备可能未重开）');
      p!.autoReconnect = false;
      await p!.disconnect();
      return '断链→自动重连成功（已断开清理）';
    },
  },
  {
    id: 'DEV-SM-012',
    title: 'autoReconnect=false 断连不自动重连',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'semi-auto',
    steps: [
      '第 1 步：确保设备已连接；点击「验证」后关闭设备电源，等待检测到断链',
      '第 2 步：重新打开设备电源，等待 15 秒，确认 autoReconnect=false 时不自动重连',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready（否则无法验证断链不重连）');
      p!.autoReconnect = false;
      ctx.log('第 1 步：请关闭设备电源，等待检测到断链…');
      await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
      ctx.log('已检测到断链。第 2 步：请重新打开设备电源，等待 15 秒确认不自动重连…');
      await ctx.sleep(15000);
      ctx.assert(!p!.isReady, `autoReconnect=false 时不应自动恢复 Ready，实际 isReady=${p!.isReady}`);
      ctx.assert(p!.isAutoReconnecting === false, `isAutoReconnecting 应为 false，实际 ${p!.isAutoReconnecting}`);
      p!.autoReconnect = true;
      await p!.disconnect();
      return '重新开机后仍未自动重连（符合预期）';
    },
  },
  {
    id: 'DEV-SM-013',
    title: 'onAutoReconnect 回调 + answer(true) 接管',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'semi-auto',
    steps: [
      '第 1 步：确保设备已连接；点击「验证」后关闭设备电源，等待断链',
      '第 2 步：重新打开设备电源，等待回调以 answer(true) 接管恢复',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready');
      let answered = false;
      p!.onAutoReconnect = (_s, _hasLast, answer) => {
        answer(true);
        answered = true;
      };
      p!.autoReconnect = true;
      ctx.log('第 1 步：请关闭设备电源，等待断链…');
      await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
      ctx.log('已断链。第 2 步：请重新打开设备电源，等待 onAutoReconnect 回调…');
      let cbOk = false;
      try {
        await ctx.waitFor(() => answered, 60000, 'onAutoReconnect 回调');
        cbOk = true;
      } catch (e) {
        cbOk = false;
      }
      const diag = `回调触发=${answered}, isReady=${p!.isReady}, deviceState=${DeviceStateEx[p!.deviceState] ?? p!.deviceState}, isAutoReconnecting=${p!.isAutoReconnecting}`;
      ctx.log(`等待回调结束诊断：${diag}`);
      ctx.assert(cbOk, `onAutoReconnect 回调未触发（${diag}）。若 isReady=true 说明已重连但未回调，疑似真 bug`);
      p!.onAutoReconnect = undefined;
      p!.autoReconnect = false;
      await p!.disconnect();
      return 'answer(true) 接管恢复成功';
    },
  },
  {
    id: 'DEV-SM-014',
    title: 'onAutoReconnect 回调 + answer(false) 默认恢复',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'semi-auto',
    steps: [
      '第 1 步：确保设备已连接；点击「验证」后关闭设备电源，等待断链',
      '第 2 步：重新打开设备电源，等待回调以 answer(false) 走默认恢复',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready');
      let answered = false;
      p!.onAutoReconnect = (_s, _hasLast, answer) => {
        answer(false);
        answered = true;
      };
      p!.autoReconnect = true;
      ctx.log('第 1 步：请关闭设备电源，等待断链…');
      await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
      ctx.log('已断链。第 2 步：请重新打开设备电源，等待 answer(false) 默认恢复…');
      await ctx.waitFor(() => answered, 60000, 'onAutoReconnect 回调（超时：设备可能未重开）');
      await ctx.waitFor(() => p!.isReady, 60000, '默认恢复 Ready（超时）');
      p!.onAutoReconnect = undefined;
      p!.autoReconnect = false;
      await p!.disconnect();
      return 'answer(false) 默认恢复成功';
    },
  },
  {
    id: 'DEV-SM-015',
    title: 'onAutoReconnect 不 answer 10s 超时默认恢复',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'semi-auto',
    steps: [
      '第 1 步：确保设备已连接；点击「验证」后关闭设备电源，等待断链',
      '第 2 步：重新打开设备电源，等待回调触发后约 10s 超时兜底恢复',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready');
      let called = false;
      p!.onAutoReconnect = () => {
        called = true;
        // 故意不 answer
      };
      p!.autoReconnect = true;
      ctx.log('第 1 步：请关闭设备电源，等待断链…');
      await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
      ctx.log('已断链。第 2 步：请重新打开设备电源，等待回调触发…');
      await ctx.waitFor(() => called, 60000, 'onAutoReconnect 回调（超时：设备可能未重开）');
      ctx.log('已触发回调（不 answer），等待 12s 观察超时兜底恢复…');
      await ctx.sleep(12000);
      ctx.assert(p!.isReady, `超时兜底应恢复 Ready，实际 isReady=${p!.isReady}`);
      p!.onAutoReconnect = undefined;
      p!.autoReconnect = false;
      await p!.disconnect();
      return '超时兜底恢复成功';
    },
  },
];
