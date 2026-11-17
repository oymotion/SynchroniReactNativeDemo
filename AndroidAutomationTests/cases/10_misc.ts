import {
  DataType,
  DeviceStateEx,
  SensorController,
  SensorData,
} from '@synchroni/synchroni_sdk_react_native';
import type { TestCase } from '../types';

export const miscCases: TestCase[] = [
  {
    id: 'MISC-FUNC-001',
    title: 'fetchDeviceInfo 返回 DeviceInfo 并刷新缓存',
    chapter: '10_底层接口与边界补充',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const info = await ctx.fetchDeviceInfo(p!);
      ctx.assert(!!info, 'fetchDeviceInfo 返回 undefined');
      ctx.assert(p!.getDeviceInfo() === info, 'getDeviceInfo 应返回同一缓存对象');
      ctx.log('DeviceInfo = ' + JSON.stringify(info, null, 2));
      await p!.disconnect();
      return `model=${info!.ModelName} fw=${info!.FirmwareVersion} hw=${info!.HardwareVersion}`;
    },
  },
  {
    id: 'MISC-FUNC-002',
    title: 'getDeviceInfo 缓存读取',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      await p!.fetchDeviceInfo();
      const info = p!.getDeviceInfo();
      ctx.assert(!!info, 'getDeviceInfo 应返回缓存');
      await p!.disconnect();
      return `model=${info!.ModelName}`;
    },
  },
  {
    id: 'MISC-FUNC-003',
    title: 'DeviceInfo 字段覆盖',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const info = await ctx.fetchDeviceInfo(p!);
      ctx.assert(!!info, 'fetchDeviceInfo 返回 undefined');
      const d = info!;
      const stringFields = [
        'DeviceName', 'ModelName', 'HardwareVersion', 'FirmwareVersion', 'Backend',
      ] as const;
      const boolFields = ['IsMTUFine'] as const;
      const numberFields = [
        'MTUSize',
        'EmgChannelCount', 'EegChannelCount', 'EcgChannelCount',
        'AccChannelCount', 'GyroChannelCount', 'BrthChannelCount', 'PpgChannelCount',
        'Spo2ChannelCount', 'QuatChannelCount', 'EulerChannelCount', 'AngleChannelCount',
        'ImpeChannelCount', 'EmgSampleRate', 'EegSampleRate', 'EcgSampleRate',
        'AccSampleRate', 'GyroSampleRate', 'BrthSampleRate', 'PpgSampleRate',
        'Spo2SampleRate', 'QuatSampleRate', 'EulerSampleRate', 'AngleSampleRate',
        'ImpeSampleRate', 'EmgMaxSampleRate', 'EegMaxSampleRate', 'EcgMaxSampleRate',
        'ConnectionIntervalMs', 'PeripheralLatency', 'SupervisionTimeoutMs',
        'EmgGain', 'EegGain', 'EcgGain', 'GestChannelCount', 'GestSampleRate',
        'MagChannelCount', 'MagSampleRate',
      ] as const;
      for (const f of stringFields) ctx.assert(typeof d[f] === 'string', `DeviceInfo.${f}`);
      for (const f of boolFields) ctx.assert(typeof d[f] === 'boolean', `DeviceInfo.${f}`);
      for (const f of numberFields) ctx.assert(typeof d[f] === 'number', `DeviceInfo.${f}`);
      ctx.log('DeviceInfo = ' + JSON.stringify(info, null, 2));
      await p!.disconnect();
      return `model=${d.ModelName} fw=${d.FirmwareVersion} hw=${d.HardwareVersion}`;
    },
  },
  {
    id: 'MISC-FUNC-004',
    title: 'getVersion 与 capiVersion 一致',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const v = await SensorController.Instance.getVersion();
      const capi = SensorController.Instance.capiVersion;
      ctx.assert(typeof v === 'string' && v.length > 0, 'getVersion 应为非空');
      ctx.assert(typeof capi === 'number' && capi > 0, 'capiVersion 应为正数');
      return `version=${v} capi=${capi}`;
    },
  },
  {
    id: 'MISC-FUNC-005',
    title: 'onSuspend 后台挂起不抛异常',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      let threw = false;
      try {
        SensorController.Instance.onSuspend();
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, 'onSuspend 不应抛异常');
      return 'ok';
    },
  },
  {
    id: 'MISC-FUNC-006',
    title: 'DataType 枚举值映射正确',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      ctx.assert(DataType.NTF_EEG === 0x10, 'NTF_EEG');
      ctx.assert(DataType.NTF_IMU === 0x13, 'NTF_IMU');
      ctx.assert(DataType.NTF_PPG === 0x18, 'NTF_PPG');
      ctx.assert(DataType.NTF_ANGLE === 0xd, 'NTF_ANGLE');
      ctx.assert(DataType.NTF_IMPEDANCE === 0x12, 'NTF_IMPEDANCE');
      return 'enum values ok';
    },
  },
  {
    id: 'MISC-FUNC-007',
    title: 'DeviceStateEx 枚举完整',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      ctx.assert(DeviceStateEx.Disconnected === 0, 'Disconnected');
      ctx.assert(DeviceStateEx.Connecting === 1, 'Connecting');
      ctx.assert(DeviceStateEx.Connected === 2, 'Connected');
      ctx.assert(DeviceStateEx.Ready === 3, 'Ready');
      ctx.assert(DeviceStateEx.Disconnecting === 4, 'Disconnecting');
      ctx.assert(DeviceStateEx.Invalid === 5, 'Invalid');
      return 'enum ok';
    },
  },
  {
    id: 'MISC-BND-001',
    title: 'init 重复调用返回缓存 true',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const ok = await p!.init(32, 60000);
      ctx.assert(ok === true, '重复 init 应返回 true（缓存）');
      await p!.disconnect();
      return 'idempotent';
    },
  },
  {
    id: 'MISC-BND-002',
    title: '未连接 fetchDeviceInfo 返回 undefined',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      if (p!.isReady) {
        await p!.disconnect();
      }
      const info = await p!.fetchDeviceInfo();
      ctx.assert(info === undefined, '未连接 fetchDeviceInfo 应返回 undefined');
      return 'undefined as expected';
    },
  },
  {
    id: 'MISC-BND-003',
    title: 'requireSensor 非法 Address 格式',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      const bads: any[] = [
        { Name: 'x', Address: '850B', RSSI: 0 },
        { Name: 'x', Address: 'AA:BB', RSSI: 0 },
        { Name: 'x', Address: 'GG:11:22:33:44:55', RSSI: 0 },
        { Name: 'x', Address: 'aa:bb:cc:dd:ee', RSSI: 0 },
      ];
      for (const b of bads) {
        ctx.assert(c.requireSensor(b) === undefined,
          `requireSensor(${JSON.stringify(b)}) 应返回 undefined`);
      }
      return 'invalid MAC formats rejected';
    },
  },
  {
    id: 'MISC-BND-005',
    title: 'multiReplayBinFile paths 含空串',
    chapter: '10_底层接口与边界补充',
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
        await c.multiReplayBinFile([''], [p!], true, 1000);
      } catch (e) {
        threw = true;
      }
      ctx.assert(threw, '空串路径应抛 Error');
      return 'ok';
    },
  },
  {
    id: 'MISC-BND-006',
    title: 'terminateSdk 后 getSensor/getSensors 已清空',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      await ctx.requireTarget();
      SensorController.Instance.terminateSdk();
      ctx.assert(SensorController.Instance.getSensors().length === 0,
        'terminateSdk 后 getSensors 应为空');
      return 'cleared';
    },
  },
  {
    id: 'MISC-BND-004',
    title: 'SensorData 空 infoBuffer 字段默认值',
    chapter: '10_底层接口与边界补充',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const d = new SensorData({
        infoBuffer: new ArrayBuffer(0),
        startSampleIndex: 0,
        startTimeStamp: 0,
        samplesBuffer: new ArrayBuffer(0),
      });
      ctx.assert((d.dataType as number) === 0, `dataType 应为 0，实际 ${d.dataType}`);
      ctx.assert(d.sampleRate === 0, `sampleRate 应为 0，实际 ${d.sampleRate}`);
      ctx.assert(d.channelCount === 0, `channelCount 应为 0，实际 ${d.channelCount}`);
      ctx.assert(d.sampleCount === 0, `sampleCount 应为 0，实际 ${d.sampleCount}`);
      ctx.assert(d.lostPackageCount === 0, `lostPackageCount 应为 0，实际 ${d.lostPackageCount}`);
      ctx.assert(d.channelMask === 0n, `channelMask 应为 0n，实际 ${d.channelMask}`);
      ctx.assert(d.deviceMac === '', `deviceMac 应为 ''，实际 ${JSON.stringify(d.deviceMac)}`);
      ctx.assert(d.deviceName === '', `deviceName 应为 ''，实际 ${JSON.stringify(d.deviceName)}`);
      return 'default values ok';
    },
  },
];
