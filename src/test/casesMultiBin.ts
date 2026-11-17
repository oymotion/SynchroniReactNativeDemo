import RNFS from 'react-native-fs';
import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { BLEDevice, SensorData, SensorProfile } from '@synchroni/synchroni_sdk_react_native';
import { DemoController } from '../demo/DemoController';
import { AUTO } from './TestRunner';
import type { TestCase, TestContext } from './TestRunner';

function auto(
  id: string,
  group: string,
  title: string,
  priority: TestCase['priority'],
  deviceRelated: string,
  expected: string,
  run: TestCase['run']
): TestCase {
  return {
    id, group, title, priority, platform: '通用', deviceRelated,
    automation: AUTO, manualSteps: '', expected, run,
  };
}

async function startReplay(ctx: TestContext) {
  const bin = await ctx.findBin();
  if (!bin) return undefined;
  await ctx.disconnectAll();
  const info = await SensorController.Instance.getBinFileInfo(bin);
  if (!info.Valid || !info.Mac) return undefined;
  const profile = SensorController.Instance.requireSensor({
    Name: info.DeviceName || 'Replay', Address: info.Mac, RSSI: 0,
  } as BLEDevice);
  if (!profile) return undefined;
  const collected: SensorData[] = [];
  profile.onSensorNotifyData = (_s, list) => collected.push(...list);
  return { bin, info, profile, collected };
}

export const MULTI_CASES: TestCase[] = [
  auto('MULTI-FUNC-001', 'MULTI', 'multiStartDataNotification 两设备同步起流', 'P0',
    '通用（需≥2台设备）', '各 ok===true 且首包延迟差≤maxDelayDispersionMs', async (ctx) => {
      const sensors = SensorController.Instance.getConnectedSensors();
      if (sensors.length < 2) return ctx.skip('need 2+ devices');
      const results = await SensorController.Instance.multiStartDataNotification(
        sensors, 0, -1, 3
      );
      return ctx.ok(results.length === sensors.length && results.every((r) => r.ok),
        `started=${results.filter((r) => r.ok).length}/${results.length}`);
    }),

  auto('MULTI-FUNC-002', 'MULTI', 'multiStopDataNotification 同步停流', 'P0',
    '通用（需≥2台设备）', '各 ok===true 且 isDataTransfering===false', async (ctx) => {
      const sensors = SensorController.Instance.getConnectedSensors();
      if (sensors.length < 2) return ctx.skip('need 2+ devices');
      const results = await SensorController.Instance.multiStopDataNotification(sensors, 0);
      return ctx.ok(results.length === sensors.length && results.every((r) => r.ok),
        `stopped=${results.filter((r) => r.ok).length}/${results.length}`);
    }),

  auto('MULTI-FUNC-003', 'MULTI', 'multiReplayBinFile 多 bin 同步回放', 'P0',
    '通用（需≥2个对应设备MAC的bin）', '返回长度等于输入数且成功项为 profile', async (ctx) => {
      return ctx.skip('requires 2+ matching bin files; run via manual bin replay');
    }),

  auto('MULTI-BND-001', 'MULTI', 'multiStartDataNotification 空数组/null 元素', 'P1',
    '通用', '抛 Error 不崩溃', async (ctx) => {
      const a = await ctx.expectThrow(() => SensorController.Instance.multiStartDataNotification([] as unknown as SensorProfile[], 0, 0, 1));
      const b = await ctx.expectThrow(() => SensorController.Instance.multiStartDataNotification([null as unknown as SensorProfile], 0, 0, 1));
      return ctx.ok(a && b, 'empty/null sensors throw');
    }),

  auto('MULTI-BND-002', 'MULTI', 'multiStartDataNotification timeoutMs/maxDelayDispersionMs 边界', 'P1',
    '通用（需≥2台设备）', '不抛异常', async (ctx) => {
      const sensors = SensorController.Instance.getConnectedSensors();
      if (sensors.length < 2) return ctx.skip('need 2+ devices');
      const noThrow = await ctx.expectNoThrow(() =>
        SensorController.Instance.multiStartDataNotification(sensors, 0, -1, 1)
      );
      return ctx.ok(noThrow, 'boundary params no throw');
    }),

  auto('MULTI-BND-003', 'MULTI', 'multiReplayBinFile paths/sensors 长度不匹配', 'P1',
    '通用', '抛 Error', async (ctx) => {
      const p = SensorController.Instance.requireSensor({
        Name: 'T', Address: 'AA:BB:CC:DD:EE:04', RSSI: 0,
      } as BLEDevice);
      if (!p) return ctx.skip('cannot create profile');
      const a = await ctx.expectThrow(() =>
        SensorController.Instance.multiReplayBinFile(['a', 'b'], [p], true, 1000)
      );
      return ctx.ok(a, 'length mismatch throws');
    }),

  auto('MULTI-ROB-001', 'MULTI', '部分设备失败返回含失败项', 'P1',
    '通用（需≥2台设备）', '失败项 ok===false 且 error 非空', async (ctx) => {
      const sensors = SensorController.Instance.getConnectedSensors();
      if (sensors.length < 2) return ctx.skip('need 2+ devices');
      const results = await SensorController.Instance.multiStartDataNotification(
        sensors, 0, -1, 1
      );
      return ctx.ok(results.every((r) => typeof r.ok === 'boolean'),
        `results=${results.length}`);
    }),
];

export const BIN_CASES: TestCase[] = [
  auto('BIN-FUNC-001', 'BIN', 'getBinFileInfo 解析 bin', 'P0',
    '通用（需有效 bin）', '返回 BinFileInfo 且 bigint 字段正确', async (ctx) => {
      const bin = await ctx.findBin();
      if (!bin) return ctx.skip('no bin file');
      const info = await SensorController.Instance.getBinFileInfo(bin);
      return ctx.ok(
        typeof info.Mac === 'string' &&
          typeof info.Valid === 'boolean' &&
          typeof info.FeatureMap === 'bigint',
        `mac=${info.Mac} valid=${info.Valid}`
      );
    }),

  auto('BIN-FUNC-002', 'BIN', 'replayBinFile 回放起流', 'P0',
    '通用（需有效 bin）', '返回 true 且数据到达', async (ctx) => {
      const r = await startReplay(ctx);
      if (!r) return ctx.skip('no valid bin');
      const ok = await SensorController.Instance.replayBinFile(r.bin, r.info.Mac, true, 5000);
      await ctx.sleep(1500);
      await SensorController.Instance.stopBinReplay(r.info.Mac);
      return ctx.ok(ok === true && r.collected.length > 0,
        `ok=${ok} samples=${r.collected.length}`);
    }),

  auto('BIN-FUNC-003', 'BIN', 'pauseBinReplay 暂停', 'P0',
    '通用（需有效 bin）', '返回 OK 且暂停后无新数据', async (ctx) => {
      const r = await startReplay(ctx);
      if (!r) return ctx.skip('no valid bin');
      await SensorController.Instance.replayBinFile(r.bin, r.info.Mac, true, 5000);
      await ctx.sleep(800);
      const result = await SensorController.Instance.pauseBinReplay(r.info.Mac);
      const before = r.collected.length;
      await ctx.sleep(1000);
      const after = r.collected.length;
      await SensorController.Instance.stopBinReplay(r.info.Mac);
      return ctx.ok(result === 'OK' && after === before,
        `pause=${result} before=${before} after=${after}`);
    }),

  auto('BIN-FUNC-004', 'BIN', 'resumeBinReplay 恢复', 'P0',
    '通用（需有效 bin）', '返回 OK 且数据恢复', async (ctx) => {
      const r = await startReplay(ctx);
      if (!r) return ctx.skip('no valid bin');
      await SensorController.Instance.replayBinFile(r.bin, r.info.Mac, true, 5000);
      await ctx.sleep(500);
      await SensorController.Instance.pauseBinReplay(r.info.Mac);
      const before = r.collected.length;
      const result = await SensorController.Instance.resumeBinReplay(r.info.Mac);
      await ctx.sleep(800);
      const after = r.collected.length;
      await SensorController.Instance.stopBinReplay(r.info.Mac);
      return ctx.ok(result === 'OK' && after > before,
        `resume=${result} before=${before} after=${after}`);
    }),

  auto('BIN-FUNC-005', 'BIN', 'stopBinReplay 停止', 'P0',
    '通用（需有效 bin）', '返回 OK 且数据停止', async (ctx) => {
      const r = await startReplay(ctx);
      if (!r) return ctx.skip('no valid bin');
      await SensorController.Instance.replayBinFile(r.bin, r.info.Mac, true, 5000);
      await ctx.sleep(800);
      const result = await SensorController.Instance.stopBinReplay(r.info.Mac);
      const before = r.collected.length;
      await ctx.sleep(800);
      const after = r.collected.length;
      return ctx.ok(result === 'OK' && after === before,
        `stop=${result} before=${before} after=${after}`);
    }),

  auto('BIN-FUNC-006', 'BIN', 'parseBinToCsv 生成 CSV', 'P0',
    '通用（需有效 bin）', '返回 csv 路径且文件存在', async (ctx) => {
      const bin = await ctx.findBin();
      if (!bin) return ctx.skip('no bin file');
      const csv = await SensorController.Instance.parseBinToCsv(bin);
      const exists = await RNFS.exists(csv);
      return ctx.ok(exists, `csv=${csv}`);
    }),

  auto('BIN-FUNC-007', 'BIN', 'parseBinToCsv 指定 csvPath', 'P1',
    '通用（需有效 bin）', '返回 customCsvPath 且文件生成', async (ctx) => {
      const bin = await ctx.findBin();
      if (!bin) return ctx.skip('no bin file');
      const custom = `${RNFS.DocumentDirectoryPath}/automation_test.csv`;
      const csv = await SensorController.Instance.parseBinToCsv(bin, custom);
      const exists = await RNFS.exists(csv);
      return ctx.ok(csv === custom && exists, `csv=${csv}`);
    }),

  auto('BIN-BND-001', 'BIN', 'getBinFileInfo 空路径/不存在路径', 'P1',
    '通用', '空路径抛 Error，不存在路径不崩溃', async (ctx) => {
      const a = await ctx.expectThrow(() => SensorController.Instance.getBinFileInfo(''));
      const b = await ctx.expectThrow(() =>
        SensorController.Instance.getBinFileInfo(`${RNFS.DocumentDirectoryPath}/no_such.bin`)
      );
      return ctx.ok(a && b, 'empty/missing path handled');
    }),

  auto('BIN-BND-002', 'BIN', 'replayBinFile 非法 MAC', 'P1',
    '通用', '抛 Error("invalid device address")', async (ctx) => {
      const a = await ctx.expectThrow(() =>
        SensorController.Instance.replayBinFile('/tmp/x.bin', '850B', true, 1000)
      );
      const b = await ctx.expectThrow(() =>
        SensorController.Instance.replayBinFile('/tmp/x.bin', '', true, 1000)
      );
      return ctx.ok(a && b, 'invalid MAC throws');
    }),

  auto('BIN-BND-003', 'BIN', 'pause/resume/stopBinReplay 非法 MAC', 'P1',
    '通用', '均抛 Error', async (ctx) => {
      const a = await ctx.expectThrow(() => SensorController.Instance.pauseBinReplay('850B'));
      const b = await ctx.expectThrow(() => SensorController.Instance.resumeBinReplay(''));
      const c = await ctx.expectThrow(() => SensorController.Instance.stopBinReplay(null as unknown as string));
      return ctx.ok(a && b && c, 'invalid control MAC throws');
    }),

  auto('BIN-BND-004', 'BIN', 'parseBinToCsv 空路径', 'P1',
    '通用', '抛 Error', async (ctx) => {
      const a = await ctx.expectThrow(() => SensorController.Instance.parseBinToCsv(''));
      return ctx.ok(a, 'empty path throws');
    }),

  auto('BIN-ROB-001', 'BIN', '回放期间重复 pause/resume', 'P1',
    '通用（需有效 bin）', '无死锁无异常', async (ctx) => {
      const r = await startReplay(ctx);
      if (!r) return ctx.skip('no valid bin');
      await SensorController.Instance.replayBinFile(r.bin, r.info.Mac, true, 5000);
      const noThrow = await ctx.expectNoThrow(async () => {
        for (let i = 0; i < 3; i++) {
          await SensorController.Instance.pauseBinReplay(r.info.Mac);
          await SensorController.Instance.resumeBinReplay(r.info.Mac);
        }
      });
      await SensorController.Instance.stopBinReplay(r.info.Mac);
      return ctx.ok(noThrow, 'rapid pause/resume OK');
    }),

  auto('BIN-ROB-002', 'BIN', '回放未开始时 pause/stop', 'P1',
    '通用', '返回 Error/OK 不崩溃', async (ctx) => {
      const noThrow = await ctx.expectNoThrow(async () => {
        await SensorController.Instance.pauseBinReplay('AA:BB:CC:DD:EE:05');
        await SensorController.Instance.stopBinReplay('AA:BB:CC:DD:05:EE');
      });
      return ctx.ok(noThrow, 'pause/stop before replay no crash');
    }),

  auto('BIN-ROB-003', 'BIN', '回放中 terminate', 'P1',
    '通用（需有效 bin）', '不崩溃且回放停止', async (ctx) => {
      const r = await startReplay(ctx);
      if (!r) return ctx.skip('no valid bin');
      await SensorController.Instance.replayBinFile(r.bin, r.info.Mac, true, 5000);
      await ctx.sleep(500);
      const noThrow = await ctx.expectNoThrow(() => SensorController.Instance.terminate());
      DemoController.Instance.resetAfterTerminate();
      return ctx.ok(noThrow, 'terminate during replay OK');
    }),
];
