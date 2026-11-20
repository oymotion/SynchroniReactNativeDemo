import type { SensorData, SensorProfile } from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from '../TestConfig';
import type { TestCase } from '../types';

export const dataflowCases: TestCase[] = [
  {
    id: 'DATA-FUNC-001',
    title: 'init 成功 hasInited==true',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (!p!.isReady) {
        await p!.connect();
        await ctx.waitFor(() => p!.isReady, TestConfig.READY_TIMEOUT_MS, 'Ready');
      }
      const ok = await p!.init(TestConfig.INIT_PACKAGE_SAMPLE_COUNT, TestConfig.INIT_POWER_REFRESH_MS);
      ctx.assert(ok === true, 'init 应返回 true');
      ctx.assert(p!.hasInited === true, 'hasInited 应为 true');
      await p!.disconnect();
      return 'inited';
    },
  },
  {
    id: 'DATA-FUNC-002',
    title: '未 Ready 时 init 返回 false',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (p!.isReady) {
        await p!.disconnect();
      }
      const ok = await p!.init(32, 60000);
      ctx.assert(ok === false, '未连接时 init 应返回 false');
      return 'false as expected';
    },
  },
  {
    id: 'DATA-FUNC-003',
    title: 'startDataNotification 成功且 isDataTransfering==true',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const ok = await p!.startDataNotification();
      ctx.assert(ok === true, 'startDataNotification 应返回 true');
      ctx.assert(p!.isDataTransfering === true, 'isDataTransfering 应为 true');
      await p!.stopDataNotification();
      await p!.disconnect();
      return 'started';
    },
  },
  {
    id: 'DATA-FUNC-004',
    title: 'stopDataNotification 成功且 isDataTransfering==false',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let batches = 0;
      p!.onSensorNotifyData = () => {
        batches += 1;
      };
      try {
        const started = await p!.startDataNotification();
        ctx.assert(started === true, 'startDataNotification 应返回 true');
        await ctx.waitFor(
          () => p!.isDataTransfering && batches > 0,
          TestConfig.DATA_TIMEOUT_MS,
          '起流并收到数据',
        );
        ctx.assert(p!.isDataTransfering === true, '起流后 isDataTransfering 应为 true');
        ctx.assert(batches > 0, '起流后应收到数据');
        const ok = await p!.stopDataNotification();
        ctx.assert(ok === true, 'stopDataNotification 应返回 true');
        ctx.assert(p!.isDataTransfering === false, '停流后 isDataTransfering 应为 false');
      } finally {
        p!.onSensorNotifyData = () => {};
        await p!.disconnect();
      }
      return `stopped (batches=${batches})`;
    },
  },
  {
    id: 'DATA-FUNC-005',
    title: 'onSensorNotifyData 收到 SensorData[]',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(!!d, '未收到数据');
      await p!.disconnect();
      return `dataType=${d.dataType}`;
    },
  },
  {
    id: 'DATA-FUNC-006',
    title: 'SensorData.dataType 为合法数值',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(typeof d.dataType === 'number', 'dataType 应为 number');
      await p!.disconnect();
      return `dataType=${d.dataType}`;
    },
  },
  {
    id: 'DATA-FUNC-007',
    title: 'sampleRate/channelCount/sampleCount 有效',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(d.sampleRate > 0, 'sampleRate 应 >0');
      ctx.assert(d.channelCount > 0, 'channelCount 应 >0');
      ctx.assert(d.sampleCount > 0, 'sampleCount 应 >0');
      await p!.disconnect();
      return `rate=${d.sampleRate} ch=${d.channelCount} samples=${d.sampleCount}`;
    },
  },
  {
    id: 'DATA-FUNC-008',
    title: 'getData/getRawData 范围内取值',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      const raw = d.getRawData(0, 0);
      const data = d.getData(0, 0);
      ctx.assert(typeof raw === 'number', 'getRawData 应返回 number');
      ctx.assert(typeof data === 'number', 'getData 应返回 number');
      await p!.disconnect();
      return `raw=${raw} data=${data}`;
    },
  },
  {
    id: 'DATA-FUNC-009',
    title: 'getChannelData 返回 Float32Array 长度==sampleCount',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      const arr = d.getChannelData(0);
      ctx.assert(ArrayBuffer.isView(arr), 'getChannelData 应返回类型化数组');
      ctx.assert(arr.length === d.sampleCount, `长度应等于 sampleCount (${arr.length} vs ${d.sampleCount})`);
      await p!.disconnect();
      return `len=${arr.length}`;
    },
  },
  {
    id: 'DATA-FUNC-010',
    title: 'clone 后仍可读且 ownsSamples==true',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      const c = d.clone();
      ctx.assert(c !== d, 'clone 应返回新对象');
      ctx.assert(c.ownsSamples === true, 'clone ownsSamples 应为 true');
      ctx.assert(typeof c.getData(0, 0) === 'number', 'clone 数据应可读');
      await p!.disconnect();
      return 'clone ok';
    },
  },
  {
    id: 'DATA-FUNC-011',
    title: 'isDataValid 默认探测整批有效性',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(typeof d.isDataValid() === 'boolean', 'isDataValid 应返回 boolean');
      ctx.assert(d.isDataValid() === true, '当前批次应有效');
      ctx.assert(d.isDataValid(d.channelCount, 0) === false, '越界应返回 false');
      await p!.disconnect();
      return 'ok';
    },
  },
  {
    id: 'DATA-FUNC-012',
    title: 'getTimeStampInMs/getAbsTimeStampInSec 单调',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(d.sampleCount > 0, '批次样本数应 > 0');

      // 相对时间戳：随样本索引单调不减（>1000Hz 时 getTimeStampInMs 会截断为同值，故用「不减」而非「严格增」）
      const n = Math.min(d.sampleCount, 32);
      const rel: number[] = [];
      for (let si = 0; si < n; si++) {
        rel.push(d.getTimeStampInMs(0, si));
      }
      for (let si = 1; si < n; si++) {
        ctx.assert(
          rel[si] >= rel[si - 1],
          `getTimeStampInMs 应单调不减：rel[${si}]=${rel[si]} < rel[${si - 1}]=${rel[si - 1]}`,
        );
      }

      // 绝对时间戳：有限数且不随样本倒退（是否为 Unix 秒由打印值人工核对）
      const absFirst = d.getAbsTimeStampInSec(0, 0);
      const absLast = d.getAbsTimeStampInSec(0, n - 1);
      ctx.assert(Number.isFinite(absFirst), `getAbsTimeStampInSec 应为有限数，实际 ${absFirst}`);
      ctx.assert(absLast >= absFirst, `abs 时间戳不应倒退：abs[0]=${absFirst} abs[${n - 1}]=${absLast}`);

      await p!.disconnect();
      return (
        `sampleRate=${d.sampleRate} sampleCount=${d.sampleCount} ` +
        `relMs[0]=${rel[0]} relMs[${n - 1}]=${rel[n - 1]} ` +
        `absSec[0]=${absFirst.toFixed(6)} absSec[${n - 1}]=${absLast.toFixed(6)}`
      );
    },
  },
  {
    id: 'DATA-FUNC-013',
    title: 'isChannelEnabled 按 channelMask',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(typeof d.channelMask === 'bigint', 'channelMask 应为 bigint');
      ctx.assert(typeof d.isChannelEnabled(0) === 'boolean', 'isChannelEnabled 应返回 boolean');
      await p!.disconnect();
      return `mask=${d.channelMask}`;
    },
  },
  {
    id: 'DATA-FUNC-016',
    title: 'SensorData 元数据字段完整性',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(typeof d.deviceMac === 'string', 'deviceMac');
      ctx.assert(typeof d.deviceName === 'string', 'deviceName');
      ctx.assert(typeof d.startSampleIndex === 'number', 'startSampleIndex');
      ctx.assert(d.lostPackageCount >= 0, 'lostPackageCount>=0');
      ctx.assert(typeof d.startTimeStamp === 'number', 'startTimeStamp');
      ctx.assert(typeof d.delay === 'number', 'delay');
      ctx.assert(typeof d.startTimeSec === 'number', 'startTimeSec');
      await p!.disconnect();
      return `mac=${d.deviceMac} lost=${d.lostPackageCount}`;
    },
  },
  {
    id: 'DATA-BND-001',
    title: 'init packageSampleCount 边界',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (p!.isReady) {
        await p!.disconnect();
      }
      await p!.connect();
      await ctx.waitFor(() => p!.isReady, TestConfig.READY_TIMEOUT_MS, 'Ready');
      for (const v of [0, -1, 4097]) {
        const ok = await p!.init(v, 60000);
        ctx.assert(ok === false, `init(${v}) 应返回 false`);
      }
      const ok = await p!.init(32, 60000);
      ctx.assert(ok === true, 'init(32) 应返回 true');
      await p!.disconnect();
      return 'boundaries enforced';
    },
  },
  {
    id: 'DATA-BND-002',
    title: 'init powerRefreshInterval 边界',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (p!.isReady) {
        await p!.disconnect();
      }
      await p!.connect();
      await ctx.waitFor(() => p!.isReady, TestConfig.READY_TIMEOUT_MS, 'Ready');
      const bad = await p!.init(32, -1);
      ctx.assert(bad === false, 'init(32,-1) 应返回 false');
      const good = await p!.init(32, 0);
      ctx.assert(good === true, 'init(32,0) 应返回 true');
      await p!.disconnect();
      return 'ok';
    },
  },
  {
    id: 'DATA-BND-003',
    title: 'init timeout 参数不抛异常',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let threw = false;
      try {
        await p!.init(32, 60000, 0);
        await p!.init(32, 60000, -1);
        await p!.init(32, 60000, 10000);
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, 'init timeout 变体不应抛异常');
      await p!.disconnect();
      return 'ok';
    },
  },
  {
    id: 'DATA-BND-004',
    title: 'getData/getRawData 越界返回 0 不抛异常',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(d.getData(d.channelCount, 0) === 0, '越界 ch 应返回 0');
      ctx.assert(d.getData(0, d.sampleCount) === 0, '越界 si 应返回 0');
      ctx.assert(d.getRawData(-1, 0) === 0, '负 ch 应返回 0');
      await p!.disconnect();
      return 'ok';
    },
  },
  {
    id: 'DATA-BND-005',
    title: 'getImpedance/getSaturation/isLost 越界返回安全值',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(d.getImpedance(d.channelCount, 0) === 0, 'getImpedance 越界应返回 0');
      ctx.assert(d.getSaturation(d.channelCount, 0) === 0, 'getSaturation 越界应返回 0');
      ctx.assert(d.isLost(d.channelCount, 0) === false, 'isLost 越界应返回 false');
      await p!.disconnect();
      return 'ok';
    },
  },
  {
    id: 'DATA-BND-006',
    title: 'getChannelData 越界通道返回 fillValue',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      const arr = d.getChannelData(d.channelCount, 999);
      ctx.assert(arr.length === d.sampleCount, '越界通道长度应等于 sampleCount');
      ctx.assert(arr[0] === 999, '越界通道应填充 fillValue');
      await p!.disconnect();
      return 'ok';
    },
  },
  {
    id: 'DATA-BND-007',
    title: 'isDataValid/isChannelEnabled 越界返回 false',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const d = await ctx.captureBatch(p!);
      ctx.assert(d.isDataValid(-1, 0) === false, 'isDataValid(-1) 应为 false');
      ctx.assert(d.isDataValid(d.channelCount, 0) === false, 'isDataValid 越界应为 false');
      ctx.assert(d.isChannelEnabled(-1) === false, 'isChannelEnabled(-1) 应为 false');
      ctx.assert(d.isChannelEnabled(d.channelCount) === false, 'isChannelEnabled 越界应为 false');
      await p!.disconnect();
      return 'ok';
    },
  },
  {
    id: 'DATA-FUNC-015',
    title: '阻抗值仅在 NTF_IMPEDANCE 流有效',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const info = await ctx.fetchDeviceInfo(p!);
      if (!info) {
        ctx.skip('无 DeviceInfo');
      }
      if ((info!.ImpeChannelCount ?? 0) <= 0) {
        ctx.skip('设备不支持阻抗能力');
      }
      const on = await p!.setParam('NTF_IMPEDANCE', 'ON');
      ctx.assert(!on.startsWith('Error'), `开启阻抗流失败: ${on}`);
      const d = await ctx.captureBatch(p!);
      ctx.assert(typeof d.getImpedance(0, 0) === 'number', 'getImpedance 应可读');
      await p!.setParam('NTF_IMPEDANCE', 'OFF');
      await p!.disconnect();
      return 'impedance readable';
    },
  },
  {
    id: 'DATA-FUNC-014',
    title: '多流并存按 dataType 分桶统计',
    chapter: '03_数据流',
    priority: 'P0',
    mode: 'semi-auto',
    steps: [
      '在 Demo 页面同时开启 ≥2 类流（如 EEG + IMU）。',
      '观察各流 dataType 独立编号，不跨流混加通道/样本。',
    ],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const types = new Set<number>();
      const handler = (_s: SensorProfile, list: SensorData[]) => {
        list.forEach((d) => types.add(d.dataType));
      };
      p!.onSensorNotifyData = handler;
      await p!.startDataNotification();
      await ctx.sleep(3000);
      await p!.stopDataNotification();
      p!.onSensorNotifyData = () => {};
      ctx.assert(types.size >= 1, '未收到任何数据流');
      await p!.disconnect();
      return `observed dataTypes=[${Array.from(types).join(',')}]`;
    },
  },
  {
    id: 'DATA-PERF-001',
    title: '实测采样率与标称一致',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['保持设备稳定连接并起流 ≥10s，观察采样率无掉速。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let batches = 0;
      const handler = () => {
        batches += 1;
      };
      p!.onSensorNotifyData = handler;
      await p!.startDataNotification();
      await ctx.sleep(5000);
      await p!.stopDataNotification();
      p!.onSensorNotifyData = () => {};
      ctx.assert(batches > 0, '5s 内未收到数据');
      await p!.disconnect();
      return `batches=${batches} in 5s`;
    },
  },
  {
    id: 'DATA-PERF-002',
    title: '长稳连续起流不中断',
    chapter: '03_数据流',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['起流持续（测试值 30s，正式按需 1800s），观察数据持续无中断。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let batches = 0;
      p!.onSensorNotifyData = () => {
        batches += 1;
      };
      await p!.startDataNotification();
      await ctx.sleep(30000);
      await p!.stopDataNotification();
      p!.onSensorNotifyData = () => {};
      ctx.assert(batches > 0, '30s 内未收到数据');
      await p!.disconnect();
      return `batches=${batches} in 30s`;
    },
  },
  {
    id: 'DATA-PERF-003',
    title: '干扰下逐通道丢包可观测（isLost）',
    chapter: '03_数据流',
    priority: 'P2',
    mode: 'semi-auto',
    steps: ['起流后拉远距离/制造弱信号，观察各通道 isLost 丢失样本数增长。'],
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      let batches = 0;
      let totalLost = 0;
      let maxLostPackageCount = -1;
      const dataTypes = new Set<number>();
      const perChannel = new Map<number, number>();
      const transitions: string[] = [];
      p!.onSensorNotifyData = (_s, list) => {
        for (const d of list) {
          dataTypes.add(d.dataType);
          batches++;
          if (d.lostPackageCount > maxLostPackageCount) {
            maxLostPackageCount = d.lostPackageCount;
          }
          if (!d.isDataValid()) {
            continue;
          }
          let batchLost = 0;
          for (let ch = 0; ch < d.channelCount; ch++) {
            for (let i = 0; i < d.sampleCount; i++) {
              if (d.isLost(ch, i)) {
                perChannel.set(ch, (perChannel.get(ch) ?? 0) + 1);
                batchLost++;
              }
            }
          }
          if (batchLost > 0) {
            totalLost += batchLost;
            transitions.push(`+${batchLost}`);
          }
        }
      };
      await p!.startDataNotification();
      await ctx.sleep(20000);
      await p!.stopDataNotification();
      p!.onSensorNotifyData = () => {};
      const channelSummary = Array.from(perChannel.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ch, n]) => `ch${ch}:${n}`)
        .join(',');
      ctx.log(
        `isLost 采样 type=[${Array.from(dataTypes).join(',')}] 批数=${batches} totalLost=${totalLost} 通道=[${channelSummary || '无'}] 走向=[${transitions.join(',')}] lostPackageCount_max=${maxLostPackageCount}`
      );
      ctx.assert(batches > 0, '应收到数据批次');
      ctx.assert(totalLost >= 0, '累计丢失样本数应 >=0');
      await p!.disconnect();
      return `type=[${Array.from(dataTypes).join(',')}] batches=${batches} totalLost=${totalLost} channels=[${channelSummary || 'none'}] lostPackageCount_max=${maxLostPackageCount}`;
    },
  },
];
