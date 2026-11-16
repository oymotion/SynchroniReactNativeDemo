import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { SensorData, SensorProfile } from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from '../TestConfig';
import type { TestCase } from '../types';

export const binCases: TestCase[] = [
  {
    id: 'BIN-FUNC-001',
    title: 'getBinFileInfo 解析 bin',
    chapter: '06_Bin录制回放解析',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const info = await SensorController.Instance.getBinFileInfo(binPath);
      ctx.assert(typeof info.Mac === 'string' && info.Mac.length > 0, 'Mac 缺失');
      ctx.assert(typeof info.Valid === 'boolean', 'Valid 缺失');
      ctx.assert(typeof info.DurationSec === 'number', 'DurationSec 缺失');
      return `mac=${info.Mac} valid=${info.Valid} dur=${info.DurationSec}`;
    },
  },
  {
    id: 'BIN-FUNC-002',
    title: 'replayBinFile 回放起流',
    chapter: '06_Bin录制回放解析',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const info = await SensorController.Instance.getBinFileInfo(binPath);
      ctx.assert(info.Valid, 'bin 无效');
      const profile = SensorController.Instance.requireSensor({
        Name: info.DeviceName || 'Replay',
        Address: info.Mac,
        RSSI: 0,
      });
      ctx.assert(!!profile, '无法创建回放 profile');
      let got = false;
      profile!.onSensorNotifyData = (_s: SensorProfile, list: SensorData[]) => {
        if (list.length > 0) {
          got = true;
        }
      };
      const ok = await SensorController.Instance.replayBinFile(
        binPath,
        info.Mac,
        true,
        30000,
      );
      ctx.assert(ok === true, 'replayBinFile 应返回 true');
      await ctx.waitFor(() => got, TestConfig.DATA_TIMEOUT_MS, 'replay data');
      await SensorController.Instance.stopBinReplay(info.Mac);
      return 'replay delivered data';
    },
  },
  {
    id: 'BIN-FUNC-006',
    title: 'parseBinToCsv 生成 CSV',
    chapter: '06_Bin录制回放解析',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const csvPath = await SensorController.Instance.parseBinToCsv(binPath);
      ctx.assert(typeof csvPath === 'string' && csvPath.length > 0, 'csvPath 为空');
      return csvPath;
    },
  },
  {
    id: 'BIN-FUNC-007',
    title: 'parseBinToCsv 指定 csvPath',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const custom = `${binPath.replace(/\.bin$/i, '')}_custom.csv`;
      const csvPath = await SensorController.Instance.parseBinToCsv(binPath, custom);
      ctx.assert(csvPath === custom, `应返回指定路径: ${csvPath} vs ${custom}`);
      return csvPath;
    },
  },
  {
    id: 'BIN-FUNC-003',
    title: 'pauseBinReplay 暂停',
    chapter: '06_Bin录制回放解析',
    priority: 'P0',
    mode: 'manual',
    steps: [
      '先通过 BIN-FUNC-002 或 Demo 启动回放。',
      '调用 pauseBinReplay(mac)，观察数据停止；返回 "OK"。',
    ],
  },
  {
    id: 'BIN-FUNC-004',
    title: 'resumeBinReplay 恢复',
    chapter: '06_Bin录制回放解析',
    priority: 'P0',
    mode: 'manual',
    steps: ['回放暂停后调用 resumeBinReplay(mac)，观察数据恢复。'],
  },
  {
    id: 'BIN-FUNC-005',
    title: 'stopBinReplay 停止',
    chapter: '06_Bin录制回放解析',
    priority: 'P0',
    mode: 'manual',
    steps: ['回放中调用 stopBinReplay(mac)，观察数据停止与 onDataTransferStateChange=false。'],
  },
  {
    id: 'BIN-BND-001',
    title: 'getBinFileInfo 空路径/不存在路径',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      let threw = false;
      try {
        await SensorController.Instance.getBinFileInfo('');
      } catch (e) {
        threw = true;
      }
      ctx.assert(threw, '空路径应抛 Error');
      let failed = false;
      try {
        await SensorController.Instance.getBinFileInfo('/no/such/file.bin');
      } catch (e) {
        failed = true;
      }
      ctx.assert(failed, '不存在路径应 reject');
      return 'path validation ok';
    },
  },
  {
    id: 'BIN-BND-002',
    title: 'replayBinFile 非法 MAC',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      let threw = false;
      try {
        await SensorController.Instance.replayBinFile('/tmp/x.bin', '850B', true, 1000);
      } catch (e) {
        threw = true;
      }
      ctx.assert(threw, '非法 MAC 应抛 Error');
      return 'mac validation ok';
    },
  },
  {
    id: 'BIN-BND-003',
    title: 'pause/resume/stopBinReplay 非法 MAC',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      for (const fn of [
        () => c.pauseBinReplay('850B'),
        () => c.resumeBinReplay('850B'),
        () => c.stopBinReplay('850B'),
      ]) {
        let threw = false;
        try {
          await fn();
        } catch (e) {
          threw = true;
        }
        ctx.assert(threw, '非法 MAC 应抛 Error');
      }
      return 'mac validation ok';
    },
  },
  {
    id: 'BIN-BND-004',
    title: 'parseBinToCsv 空路径',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      let threw = false;
      try {
        await SensorController.Instance.parseBinToCsv('');
      } catch (e) {
        threw = true;
      }
      ctx.assert(threw, '空路径应抛 Error');
      return 'path validation ok';
    },
  },
  {
    id: 'BIN-ROB-001',
    title: '回放期间重复 pause/resume',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'manual',
    steps: ['回放中快速交替 pause/resume 多次，观察无死锁、无异常。'],
  },
  {
    id: 'BIN-ROB-002',
    title: '回放未开始时 pause/stop',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'manual',
    steps: ['未回放时调用 pauseBinReplay/stopBinReplay(mac)，观察不崩溃。'],
  },
  {
    id: 'BIN-ROB-003',
    title: '回放中 terminate',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'manual',
    steps: ['回放中调用 terminate()，观察数据停止、控制器重置、无崩溃。'],
  },
];
