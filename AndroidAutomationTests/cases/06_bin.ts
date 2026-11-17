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
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const c = SensorController.Instance;
      const info = await c.getBinFileInfo(binPath);
      ctx.assert(info.Valid, 'bin 无效');
      const profile = c.requireSensor({ Name: info.DeviceName || 'Replay', Address: info.Mac, RSSI: 0 });
      ctx.assert(!!profile, '无法创建回放 profile');
      let count = 0;
      profile!.onSensorNotifyData = (_s: SensorProfile, list: SensorData[]) => {
        count += list.length;
      };
      const ok = await c.replayBinFile(binPath, info.Mac, true, 30000);
      ctx.assert(ok === true, 'replayBinFile 应返回 true');
      await ctx.waitFor(() => count > 0, TestConfig.DATA_TIMEOUT_MS, 'replay data');
      const r = await c.pauseBinReplay(info.Mac);
      ctx.assert(typeof r === 'string' && !r.startsWith('Error'), `pauseBinReplay 应成功，实际 ${r}`);
      // pause 后先等缓冲批次投递完（延迟消退），再观察增量，避免把缓冲尾流误判为未暂停。
      await ctx.sleep(2000);
      const before = count;
      await ctx.sleep(2000);
      const growth = count - before;
      ctx.assert(growth === 0, `暂停后数据应停止增长，实际增量 ${growth}`);
      await c.stopBinReplay(info.Mac);
      profile!.onSensorNotifyData = () => {};
      return `pause ok (growth=${growth})`;
    },
  },
  {
    id: 'BIN-FUNC-004',
    title: 'resumeBinReplay 恢复',
    chapter: '06_Bin录制回放解析',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const c = SensorController.Instance;
      const info = await c.getBinFileInfo(binPath);
      ctx.assert(info.Valid, 'bin 无效');
      const profile = c.requireSensor({ Name: info.DeviceName || 'Replay', Address: info.Mac, RSSI: 0 });
      ctx.assert(!!profile, '无法创建回放 profile');
      let count = 0;
      profile!.onSensorNotifyData = (_s: SensorProfile, list: SensorData[]) => {
        count += list.length;
      };
      const ok = await c.replayBinFile(binPath, info.Mac, true, 30000);
      ctx.assert(ok === true, 'replayBinFile 应返回 true');
      await ctx.waitFor(() => count > 0, TestConfig.DATA_TIMEOUT_MS, 'replay data');
      await c.pauseBinReplay(info.Mac);
      await ctx.sleep(1000);
      const paused = count;
      const r = await c.resumeBinReplay(info.Mac);
      ctx.assert(typeof r === 'string' && !r.startsWith('Error'), `resumeBinReplay 应成功，实际 ${r}`);
      await ctx.sleep(2000);
      const growth = count - paused;
      ctx.assert(growth > 0, `恢复后数据应继续增长，实际增量 ${growth}`);
      await c.stopBinReplay(info.Mac);
      profile!.onSensorNotifyData = () => {};
      return `resume ok (growth=${growth})`;
    },
  },
  {
    id: 'BIN-FUNC-005',
    title: 'stopBinReplay 停止',
    chapter: '06_Bin录制回放解析',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const c = SensorController.Instance;
      const info = await c.getBinFileInfo(binPath);
      ctx.assert(info.Valid, 'bin 无效');
      const profile = c.requireSensor({ Name: info.DeviceName || 'Replay', Address: info.Mac, RSSI: 0 });
      ctx.assert(!!profile, '无法创建回放 profile');
      let count = 0;
      profile!.onSensorNotifyData = (_s: SensorProfile, list: SensorData[]) => {
        count += list.length;
      };
      const ok = await c.replayBinFile(binPath, info.Mac, true, 30000);
      ctx.assert(ok === true, 'replayBinFile 应返回 true');
      await ctx.waitFor(() => count > 0, TestConfig.DATA_TIMEOUT_MS, 'replay data');
      const r = await c.stopBinReplay(info.Mac);
      ctx.assert(typeof r === 'string' && !r.startsWith('Error'), `stopBinReplay 应成功，实际 ${r}`);
      // stop 后先等缓冲尾流投递完，再观察增量，避免把缓冲尾流误判为未停止。
      await ctx.sleep(2000);
      const before = count;
      await ctx.sleep(2000);
      const growth = count - before;
      ctx.assert(growth === 0, `停止后数据应停止增长，实际增量 ${growth}`);
      profile!.onSensorNotifyData = () => {};
      return `stop ok (growth=${growth})`;
    },
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
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const c = SensorController.Instance;
      const info = await c.getBinFileInfo(binPath);
      ctx.assert(info.Valid, 'bin 无效');
      const profile = c.requireSensor({ Name: info.DeviceName || 'Replay', Address: info.Mac, RSSI: 0 });
      ctx.assert(!!profile, '无法创建回放 profile');
      let count = 0;
      profile!.onSensorNotifyData = (_s: SensorProfile, list: SensorData[]) => {
        count += list.length;
      };
      const ok = await c.replayBinFile(binPath, info.Mac, true, 30000);
      ctx.assert(ok === true, 'replayBinFile 应返回 true');
      await ctx.waitFor(() => count > 0, TestConfig.DATA_TIMEOUT_MS, 'replay data');
      // 快速交替 pause/resume 多次，断言无死锁无异常。
      for (let i = 0; i < 3; i++) {
        await c.pauseBinReplay(info.Mac);
        await c.resumeBinReplay(info.Mac);
      }
      // 最后一次为 resume，数据应继续增长。
      await ctx.sleep(2000);
      const before = count;
      await ctx.sleep(1500);
      const growth = count - before;
      ctx.assert(growth > 0, `最后一次 resume 后数据应继续增长，实际增量 ${growth}`);
      await c.stopBinReplay(info.Mac);
      profile!.onSensorNotifyData = () => {};
      return `repeated pause/resume ok (growth=${growth})`;
    },
  },
  {
    id: 'BIN-ROB-002',
    title: '回放未开始时 pause/stop',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const c = SensorController.Instance;
      const info = await c.getBinFileInfo(binPath);
      ctx.assert(info.Valid, 'bin 无效');
      // 未回放时调用 pause/stop（合法 MAC 但未起播），观察不崩溃（返回值可为 "Error: ..." 或 "OK"，以实测为准）。
      const results: string[] = [];
      for (const op of ['pause', 'stop'] as const) {
        try {
          const r = op === 'pause' ? await c.pauseBinReplay(info.Mac) : await c.stopBinReplay(info.Mac);
          results.push(`${op}=${r}`);
        } catch (e) {
          results.push(`${op}=throw:${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return `no-replay control tolerant: ${results.join(' ')}`;
    },
  },
  {
    id: 'BIN-ROB-003',
    title: '回放中 terminate',
    chapter: '06_Bin录制回放解析',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const binPath = TestConfig.BIN_PATH;
      if (!binPath) {
        ctx.skip('未配置 TestConfig.BIN_PATH');
        return '';
      }
      const c = SensorController.Instance;
      const info = await c.getBinFileInfo(binPath);
      ctx.assert(info.Valid, 'bin 无效');
      const profile = c.requireSensor({ Name: info.DeviceName || 'Replay', Address: info.Mac, RSSI: 0 });
      ctx.assert(!!profile, '无法创建回放 profile');
      let count = 0;
      profile!.onSensorNotifyData = (_s: SensorProfile, list: SensorData[]) => {
        count += list.length;
      };
      const ok = await c.replayBinFile(binPath, info.Mac, true, 30000);
      ctx.assert(ok === true, 'replayBinFile 应返回 true');
      await ctx.waitFor(() => count > 0, TestConfig.DATA_TIMEOUT_MS, 'replay data');
      await c.terminate();
      // terminate 后先等缓冲尾流，再观察数据停止。
      await ctx.sleep(2000);
      const before = count;
      await ctx.sleep(2000);
      const growth = count - before;
      ctx.assert(growth === 0, `terminate 后数据应停止，实际增量 ${growth}`);
      return `terminate ok (growth=${growth})`;
    },
  },
];
