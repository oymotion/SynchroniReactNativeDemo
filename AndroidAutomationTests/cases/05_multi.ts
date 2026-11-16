import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { TestCase } from '../types';

export const multiCases: TestCase[] = [
  {
    id: 'MULTI-FUNC-001',
    title: 'multiStartDataNotification 两设备同步起流',
    chapter: '05_多设备同步',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['先在 Demo 页扫描并连接 ≥2 台设备，再点击验证。'],
    run: async (ctx) => {
      const sensors = SensorController.Instance.getConnectedSensors();
      if (sensors.length < 2) {
        ctx.skip(`需要 ≥2 台已连接设备，当前 ${sensors.length}`);
      }
      const results = await SensorController.Instance.multiStartDataNotification(
        sensors,
        15000,
        100,
        3,
      );
      ctx.assert(results.length === sensors.length, '结果长度应等于输入数');
      for (const r of results) {
        ctx.assert(r.ok === true, `设备 ${r.mac} 同步起流失败: ${r.error}`);
      }
      await SensorController.Instance.multiStopDataNotification(sensors, 15000);
      return `synced ${results.length} devices`;
    },
  },
  {
    id: 'MULTI-FUNC-002',
    title: 'multiStopDataNotification 同步停流',
    chapter: '05_多设备同步',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['先在 Demo 页连接 ≥2 台设备并同步起流，再点击验证。'],
    run: async (ctx) => {
      const sensors = SensorController.Instance.getConnectedSensors();
      if (sensors.length < 2) {
        ctx.skip(`需要 ≥2 台已连接设备，当前 ${sensors.length}`);
      }
      const results = await SensorController.Instance.multiStopDataNotification(sensors, 15000);
      ctx.assert(results.length === sensors.length, '结果长度应等于输入数');
      for (const r of results) {
        ctx.assert(r.ok === true, `设备 ${r.mac} 停流失败: ${r.error}`);
      }
      return `stopped ${results.length} devices`;
    },
  },
  {
    id: 'MULTI-FUNC-003',
    title: 'multiReplayBinFile 多 bin 同步回放',
    chapter: '05_多设备同步',
    priority: 'P0',
    mode: 'manual',
    steps: [
      '准备 ≥2 个对应设备 MAC 的 .bin 文件。',
      '构造 paths 与 sensors 数组（长度一致）。',
      '调用 multiReplayBinFile(paths, sensors, realtime, timeoutMs)，观察按共享时钟对齐回放。',
    ],
  },
  {
    id: 'MULTI-BND-001',
    title: 'multiStartDataNotification 空数组/null 元素',
    chapter: '05_多设备同步',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      for (const arg of [[], [null]] as any[]) {
        let threw = false;
        try {
          await c.multiStartDataNotification(arg);
        } catch (e) {
          threw = true;
        }
        ctx.assert(threw, `multiStartDataNotification(${JSON.stringify(arg)}) 应抛 Error`);
      }
      return 'invalid args rejected';
    },
  },
  {
    id: 'MULTI-BND-002',
    title: 'multiStartDataNotification 参数边界',
    chapter: '05_多设备同步',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['连接 ≥1 台设备后点击验证（timeoutMs=0 自选时、maxDelayDispersionMs=-1 禁用检查）。'],
    run: async (ctx) => {
      const sensors = SensorController.Instance.getConnectedSensors();
      if (sensors.length < 1) {
        ctx.skip('需要 ≥1 台已连接设备');
      }
      const results = await SensorController.Instance.multiStartDataNotification(
        sensors,
        0,
        -1,
        3,
      );
      ctx.assert(results.length === sensors.length, '结果长度应等于输入数');
      await SensorController.Instance.multiStopDataNotification(sensors, 15000);
      return 'boundary params accepted';
    },
  },
  {
    id: 'MULTI-BND-003',
    title: 'multiReplayBinFile paths/sensors 长度不匹配',
    chapter: '05_多设备同步',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      const p = c.requireSensor({ Name: 'x', Address: '11:22:33:44:55:66', RSSI: 0 });
      if (!p) {
        ctx.skip('无法创建测试 profile');
      }
      let threw = false;
      try {
        await c.multiReplayBinFile(['a', 'b'], [p!], true, 1000);
      } catch (e) {
        threw = true;
      }
      ctx.assert(threw, '长度不匹配应抛 Error');
      return 'length mismatch rejected';
    },
  },
  {
    id: 'MULTI-ROB-001',
    title: '部分设备失败返回含失败项',
    chapter: '05_多设备同步',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['连接 ≥1 台正常设备；另加一台未连接/未知 profile；点击验证。'],
    run: async (ctx) => {
      const okOnes = SensorController.Instance.getConnectedSensors();
      if (okOnes.length < 1) {
        ctx.skip('需要 ≥1 台已连接设备');
      }
      const fake = SensorController.Instance.requireSensor({
        Name: 'fake',
        Address: '11:22:33:44:55:66',
        RSSI: -50,
      })!;
      const mixed = [...okOnes, fake];
      const results = await SensorController.Instance.multiStartDataNotification(mixed, 15000, 100, 1);
      ctx.assert(results.some((r) => r.ok === false), '应存在失败项');
      await SensorController.Instance.multiStopDataNotification(okOnes, 15000);
      return `partial failure observed (${results.map((r) => r.ok).join(',')})`;
    },
  },
];
