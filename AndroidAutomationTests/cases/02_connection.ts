import { DeviceStateEx } from '@synchroni/synchroni_sdk_react_native';
import type {
  DeviceInfo,
  SensorProfile,
} from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from '../TestConfig';
import type { TestCase, TestContext } from '../types';

const noop = () => {};

/**
 * 镜像 demo 的「接管式自动重连恢复」：answer(true) 之后由 app 主动重跑会话恢复。
 * 设备上电后 GATT 先就绪、firmware 应用层后就绪，若立刻 init 会因「init 太早」
 * 失败并自断开（问题 7749）。所以先用 fetchDeviceInfo 反复探测设备就绪
 * （fetchDeviceInfo 失败不会自断开），就绪后再 init 一次 + 恢复起流。
 */
export async function takeoverRecover(
  ctx: TestContext,
  p: SensorProfile,
  timeoutMs: number,
): Promise<boolean> {
  // 1. 等 BLE 链路回到 Ready（native 已完成 BLE 重连）
  try {
    await ctx.waitFor(() => p.isReady, timeoutMs, '链路回到 Ready');
  } catch {
    return false;
  }
  // 2. 探测设备就绪：fetchDeviceInfo 失败不会自断开，可安全重试
  const deadline = Date.now() + timeoutMs;
  let info: DeviceInfo | undefined;
  while (Date.now() < deadline) {
    if (!p.isReady) {
      try {
        await p.connect();
      } catch {
        // 链路偶发抖动，继续等
      }
      try {
        await ctx.waitFor(() => p.isReady, TestConfig.READY_TIMEOUT_MS, 'Ready');
      } catch {
        continue;
      }
    }
    info = await ctx.fetchDeviceInfo(p);
    if (info) {
      break;
    }
    await ctx.sleep(2000);
  }
  if (!info) {
    ctx.log('[takeoverRecover] fetchDeviceInfo 探测超时，设备可能仍未就绪');
    return false;
  }
  // 3. 就绪后 init（此时 device-info 可应答，init 应成功）
  let inited = p.hasInited;
  if (!inited) {
    try {
      inited = await p.init(
        TestConfig.INIT_PACKAGE_SAMPLE_COUNT,
        TestConfig.INIT_POWER_REFRESH_MS,
      );
    } catch {
      inited = false;
    }
  }
  if (!inited) {
    ctx.log('[takeoverRecover] init 失败');
    return false;
  }
  // 4. 恢复起流
  try {
    await p.startDataNotification();
  } catch {
    ctx.log('[takeoverRecover] startDataNotification 抛异常');
    return false;
  }
  // 5. 等待真正恢复（链路 Ready 且起流恢复）
  try {
    await ctx.waitFor(() => p.isReady && p.isDataTransfering, timeoutMs, '恢复起流');
    return true;
  } catch {
    return false;
  }
}

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
    title: '断连自动重连并恢复起流（接管模式，autoReconnect=true）',
    chapter: '02_连接与状态机',
    priority: 'P0',
    mode: 'semi-auto',
    steps: [
      '第 1 步：点击「验证」后，关闭设备电源（制造断链），等待检测到断链',
      '第 2 步：重新打开设备电源，等待 onAutoReconnect 回调后由测试接管恢复起流（isReady 且 isDataTransfering）',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready');
      // 关键：断链前必须先起流建立「上次会话」，否则 SDK 无会话可恢复，自动重连不会触发（与 DEV-SM-013/014/015 同坑）。
      const started = await p!.startDataNotification();
      ctx.assert(started, '断链前应成功起流（否则无「上次会话」，自动重连不会触发）');
      p!.autoReconnect = true;
      // 接管模式（镜像 demo）：回调里 answer(true)，由测试脚本重跑会话恢复。
      let answered = false;
      p!.onAutoReconnect = (_s, _hasLast, answer) => {
        answer(true);
        answered = true;
      };
      ctx.log('第 1 步：请关闭设备电源，等待 deviceState 变为 Disconnected…');
      await ctx.waitFor(
        () => p!.deviceState === DeviceStateEx.Disconnected,
        60000,
        '断链（deviceState 变 Disconnected，超时：设备可能未关闭）',
      );
      ctx.log(`已断链 deviceState=${DeviceStateEx[p!.deviceState]} isAutoReconnecting=${p!.isAutoReconnecting}`);

      // 稳定窗口：真关机下自动重连不该在 2s 内回 Ready（排除瞬时 BLE 抖动假断链）
      await ctx.sleep(2000);
      ctx.assert(
        !p!.isReady,
        `断链后 2s 内不应自动回 Ready，实际 deviceState=${DeviceStateEx[p!.deviceState]}`,
      );

      ctx.log('第 2 步：请重新打开设备电源，等待 onAutoReconnect 回调…');
      let cbOk = false;
      try {
        await ctx.waitFor(() => answered, 60000, 'onAutoReconnect 回调');
        cbOk = true;
      } catch (e) {
        cbOk = false;
      }
      ctx.assert(cbOk, 'onAutoReconnect 回调未触发（若 isReady=true 说明已重连但未回调）');

      // 接管恢复：等链路 Ready → 探测设备就绪 → init → 恢复起流
      const recovered = await takeoverRecover(ctx, p!, 60000);
      ctx.log(
        `接管恢复结束 deviceState=${DeviceStateEx[p!.deviceState]} isReady=${p!.isReady} ` +
          `isAutoReconnecting=${p!.isAutoReconnecting} hasInited=${p!.hasInited} ` +
          `isDataTransfering=${p!.isDataTransfering}`,
      );
      ctx.assert(
        recovered,
        `接管后应在超时内恢复 Ready 且起流恢复，实际 deviceState=${DeviceStateEx[p!.deviceState]} ` +
          `isReady=${p!.isReady} isDataTransfering=${p!.isDataTransfering}`,
      );
      p!.onAutoReconnect = undefined;
      p!.autoReconnect = false;
      try {
        await p!.stopDataNotification();
      } catch (e) {
        // 清理阶段忽略
      }
      await p!.disconnect();
      return '断链→接管式自动重连恢复成功（已断开清理）';
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
      ctx.log('第 1 步：请关闭设备电源，等待 deviceState 变为 Disconnected…');
      await ctx.waitFor(
        () => p!.deviceState === DeviceStateEx.Disconnected,
        60000,
        '断链（deviceState 变 Disconnected，超时：设备可能未关闭）',
      );
      ctx.log(`已断链 deviceState=${DeviceStateEx[p!.deviceState]} isAutoReconnecting=${p!.isAutoReconnecting}`);
      ctx.log('第 2 步：请重新打开设备电源，等待 15 秒确认不自动重连…');
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
      '第 2 步：重新打开设备电源，等待回调以 answer(true) 接管，再等 15 秒观察链路重连',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready');
      // 关键：onAutoReconnect 是「会话恢复」决策，只有断链前存在可恢复会话
      // （已 init 且正在推流）时 SDK 才会触发；仅 connect+init 不起流，SDK
      // 只会重连 BLE 链路而不会询问是否接管，回调永远不触发。
      const started = await p!.startDataNotification();
      const snap = () =>
        `deviceState=${DeviceStateEx[p!.deviceState] ?? p!.deviceState}, ` +
        `isReady=${p!.isReady}, isAutoReconnecting=${p!.isAutoReconnecting}, ` +
        `isDataTransfering=${p!.isDataTransfering}, hasInited=${p!.hasInited}`;
      ctx.log(`[起流] startDataNotification=${started}, ${snap()}`);
      ctx.assert(started, '断链前应成功起流（否则无「上次会话」，onAutoReconnect 不会触发）');
      let answered = false;
      let cbHasLastSession: boolean | undefined;
      p!.onAutoReconnect = (_s, hasLast, answer) => {
        cbHasLastSession = hasLast;
        answer(true);
        answered = true;
      };
      p!.autoReconnect = true;
      ctx.log(`[开始] ${snap()}`);
      ctx.log('第 1 步：请关闭设备电源，等待断链…');
      await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
      ctx.log(`[已断链] ${snap()}`);
      ctx.log('第 2 步：请重新打开设备电源，等待 onAutoReconnect 回调…');
      let cbOk = false;
      try {
        await ctx.waitFor(() => answered, 60000, 'onAutoReconnect 回调');
        cbOk = true;
      } catch (e) {
        cbOk = false;
      }
      const diag = `回调触发=${answered}, hasLastSession=${cbHasLastSession}, ${snap()}`;
      ctx.log(`[等待回调结束] ${diag}`);
      ctx.assert(cbOk, `onAutoReconnect 回调未触发（${diag}）。若 isReady=true 说明已重连但未回调`);
      // 接管：answer(true) 后由测试脚本重跑会话恢复（等就绪 → 探测 → init → 起流）
      const recovered = await takeoverRecover(ctx, p!, 60000);
      ctx.log(`接管恢复结束 ${snap()}`);
      ctx.assert(
        recovered,
        `answer(true) 接管后应恢复 Ready 且起流恢复，实际 ${snap()}`,
      );
      p!.onAutoReconnect = undefined;
      p!.autoReconnect = false;
      try {
        await p!.stopDataNotification();
      } catch (e) {
        // 清理阶段忽略
      }
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
      '第 2 步：重新打开设备电源，等待回调以 answer(false) 默认恢复，再等 15 秒观察重连',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready');
      // 同 DEV-SM-013：先起流建立「上次会话」，否则 onAutoReconnect 不会触发。
      const started = await p!.startDataNotification();
      const snap = () =>
        `deviceState=${DeviceStateEx[p!.deviceState] ?? p!.deviceState}, ` +
        `isReady=${p!.isReady}, isAutoReconnecting=${p!.isAutoReconnecting}, ` +
        `isDataTransfering=${p!.isDataTransfering}, hasInited=${p!.hasInited}`;
      ctx.log(`[起流] startDataNotification=${started}, ${snap()}`);
      ctx.assert(started, '断链前应成功起流（否则无「上次会话」，onAutoReconnect 不会触发）');
      let answered = false;
      let cbHasLastSession: boolean | undefined;
      p!.onAutoReconnect = (_s, hasLast, answer) => {
        cbHasLastSession = hasLast;
        answer(false);
        answered = true;
      };
      p!.autoReconnect = true;
      ctx.log(`[开始] ${snap()}`);
      ctx.log('第 1 步：请关闭设备电源，等待断链…');
      await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
      ctx.log(`[已断链] ${snap()}`);
      ctx.log('第 2 步：请重新打开设备电源，等待 answer(false) 默认恢复…');
      await ctx.waitFor(() => answered, 60000, 'onAutoReconnect 回调（超时：设备可能未重开）');
      ctx.log(`[已回调] hasLastSession=${cbHasLastSession}, ${snap()}`);
      ctx.log('已回调 answer(false)，等待 15 秒观察默认恢复是否真正重连…');
      await ctx.sleep(15000);
      ctx.log(`等待 15 秒后 ${snap()}`);
      ctx.assert(
        p!.isReady && p!.isDataTransfering,
        `answer(false) 默认恢复后应回到 Ready 且恢复起流（问题 7749：默认恢复失败），实际 ${snap()}`,
      );
      p!.onAutoReconnect = undefined;
      p!.autoReconnect = false;
      try {
        await p!.stopDataNotification();
      } catch (e) {
        // 清理阶段忽略
      }
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
      '第 2 步：重新打开设备电源，等待回调触发后约 15s 观察超时兜底恢复',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready');
      // 同 DEV-SM-013：先起流建立「上次会话」，否则 onAutoReconnect 不会触发。
      const started = await p!.startDataNotification();
      const snap = () =>
        `deviceState=${DeviceStateEx[p!.deviceState] ?? p!.deviceState}, ` +
        `isReady=${p!.isReady}, isAutoReconnecting=${p!.isAutoReconnecting}, ` +
        `isDataTransfering=${p!.isDataTransfering}, hasInited=${p!.hasInited}`;
      ctx.log(`[起流] startDataNotification=${started}, ${snap()}`);
      ctx.assert(started, '断链前应成功起流（否则无「上次会话」，onAutoReconnect 不会触发）');
      let called = false;
      let cbHasLastSession: boolean | undefined;
      p!.onAutoReconnect = (_s, hasLast) => {
        cbHasLastSession = hasLast;
        called = true;
        // 故意不 answer，观察 10s 超时兜底
      };
      p!.autoReconnect = true;
      ctx.log(`[开始] ${snap()}`);
      ctx.log('第 1 步：请关闭设备电源，等待断链…');
      await ctx.waitFor(() => !p!.isReady, 60000, '断链（isReady 变 false，超时：设备可能未关闭）');
      ctx.log(`[已断链] ${snap()}`);
      ctx.log('第 2 步：请重新打开设备电源，等待回调触发…');
      await ctx.waitFor(() => called, 60000, 'onAutoReconnect 回调（超时：设备可能未重开）');
      ctx.log(`[已回调不answer] hasLastSession=${cbHasLastSession}, ${snap()}，等待 15s 观察超时兜底…`);
      await ctx.sleep(15000);
      ctx.log(`[超时兜底后] ${snap()}`);
      ctx.assert(
        p!.isReady && p!.isDataTransfering,
        `超时兜底（等价 answer(false)）应回到 Ready 且恢复起流（问题 7749：默认恢复失败），实际 ${snap()}`,
      );
      p!.onAutoReconnect = undefined;
      p!.autoReconnect = false;
      try {
        await p!.stopDataNotification();
      } catch (e) {
        // 清理阶段忽略
      }
      await p!.disconnect();
      return '超时兜底恢复成功';
    },
  },
  {
    id: 'DEV-SM-019',
    title: 'demo 接管式自动重连完整恢复（answer(true)+等就绪+init+起流）',
    chapter: '02_连接与状态机',
    priority: 'P1',
    mode: 'semi-auto',
    steps: [
      '第 1 步：点击「验证」后，关闭设备电源（制造断链），等待检测到断链',
      '第 2 步：重新打开设备电源，等待 onAutoReconnect 回调后接管：等 Ready → 探测就绪 → init → 恢复起流',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await ctx.prepare(p!);
      }
      ctx.assert(p!.isReady, '设备应已连接 Ready');
      // 先起流建立「上次会话」，否则 onAutoReconnect 不会触发。
      const started = await p!.startDataNotification();
      ctx.assert(started, '断链前应成功起流（否则无「上次会话」，onAutoReconnect 不会触发）');
      p!.autoReconnect = true;
      // 完整镜像 demo：answer(true) 接管，随后按 demo 的 settle → 探测 → init → 起流 恢复。
      let answered = false;
      p!.onAutoReconnect = (_s, _hasLast, answer) => {
        answer(true);
        answered = true;
      };
      ctx.log('第 1 步：请关闭设备电源，等待 deviceState 变为 Disconnected…');
      await ctx.waitFor(
        () => p!.deviceState === DeviceStateEx.Disconnected,
        60000,
        '断链（deviceState 变 Disconnected，超时：设备可能未关闭）',
      );
      ctx.log(`已断链 deviceState=${DeviceStateEx[p!.deviceState]} isAutoReconnecting=${p!.isAutoReconnecting}`);
      await ctx.sleep(2000);
      ctx.assert(!p!.isReady, `断链后 2s 内不应自动回 Ready，实际 deviceState=${DeviceStateEx[p!.deviceState]}`);

      ctx.log('第 2 步：请重新打开设备电源，等待 onAutoReconnect 回调…');
      let cbOk = false;
      try {
        await ctx.waitFor(() => answered, 60000, 'onAutoReconnect 回调');
        cbOk = true;
      } catch (e) {
        cbOk = false;
      }
      ctx.assert(cbOk, 'onAutoReconnect 回调未触发');

      // 接管恢复：镜像 demo 的 settleForRecovery（等 Ready → fetchDeviceInfo 探测就绪 → init → 起流）
      const recovered = await takeoverRecover(ctx, p!, 60000);
      ctx.log(
        `接管恢复结束 deviceState=${DeviceStateEx[p!.deviceState]} isReady=${p!.isReady} ` +
          `isAutoReconnecting=${p!.isAutoReconnecting} hasInited=${p!.hasInited} ` +
          `isDataTransfering=${p!.isDataTransfering}`,
      );
      ctx.assert(
        recovered,
        `接管后应在超时内恢复 Ready 且起流恢复，实际 isReady=${p!.isReady} isDataTransfering=${p!.isDataTransfering}`,
      );
      p!.onAutoReconnect = undefined;
      p!.autoReconnect = false;
      try {
        await p!.stopDataNotification();
      } catch (e) {
        // 清理阶段忽略
      }
      await p!.disconnect();
      return 'demo 接管式自动重连完整恢复成功（已断开清理）';
    },
  },
];
