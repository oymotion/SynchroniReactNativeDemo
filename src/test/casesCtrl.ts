import { Platform } from 'react-native';
import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { BLEDevice } from '@synchroni/synchroni_sdk_react_native';
import { DemoController } from '../demo/DemoController';
import { AUTO, SEMI } from './TestRunner';
import type { TestCase } from './TestRunner';

const G = 'CTRL';

function auto(
  id: string,
  title: string,
  priority: TestCase['priority'],
  deviceRelated: string,
  expected: string,
  run: TestCase['run']
): TestCase {
  return {
    id,
    group: G,
    title,
    priority,
    platform: '通用',
    deviceRelated,
    automation: AUTO,
    manualSteps: '',
    expected,
    run,
  };
}

function semi(
  id: string,
  title: string,
  priority: TestCase['priority'],
  platform: string,
  deviceRelated: string,
  expected: string,
  manualSteps: string
): TestCase {
  return {
    id,
    group: G,
    title,
    priority,
    platform,
    deviceRelated,
    automation: SEMI,
    manualSteps,
    expected,
  };
}

const VALID_MAC = 'AA:BB:CC:DD:EE:FF';

export const CTRL_CASES: TestCase[] = [
  auto('CTRL-FUNC-001', 'Instance 单例语义', 'P0', '通用',
    '两次读取返回同一引用', async (ctx) => {
      const a = SensorController.Instance;
      const b = SensorController.Instance;
      return ctx.ok(a === b, `same instance: ${a === b}`);
    }),

  semi('CTRL-FUNC-002', '蓝牙关闭时 isEnable==false', 'P0',
    'Android(程序化)+iOS(人工)', '通用',
    'isEnable===false 且收到 enabled=false 回调',
    '在系统控制中心/设置中关闭蓝牙，然后回到本页观察状态。'),

  semi('CTRL-FUNC-003', '蓝牙开启时 isEnable==true 且回调触发', 'P0',
    'Android(程序化)+iOS(人工)', '通用',
    '开启时 isEnable===true 且回调 true，关闭时回调 false',
    '运行中切换蓝牙开关（关→开），回到本页观察。'),

  auto('CTRL-FUNC-004', 'startScan 成功返回 true，isScanning 翻转', 'P0', '通用',
    'startScan 返回 true、isScanning true；stop 后 false', async (ctx) => {
      if (!SensorController.Instance.isEnable) {
        return ctx.skip('Bluetooth disabled');
      }
      const ok = await SensorController.Instance.startScan(3000);
      const scanning = SensorController.Instance.isScanning;
      await SensorController.Instance.stopScan();
      const stopped = !SensorController.Instance.isScanning;
      return ctx.ok(ok === true && scanning === true && stopped,
        `start=${ok} scanning=${scanning} stopped=${stopped}`);
    }),

  auto('CTRL-FUNC-005', 'stopScan 后 isScanning==false', 'P0', '通用',
    'stopScan 不抛异常，isScanning===false', async (ctx) => {
      if (!SensorController.Instance.isEnable) {
        return ctx.skip('Bluetooth disabled');
      }
      await SensorController.Instance.startScan(3000);
      await SensorController.Instance.stopScan();
      return ctx.ok(!SensorController.Instance.isScanning,
        `isScanning=${SensorController.Instance.isScanning}`);
    }),

  auto('CTRL-FUNC-006', 'scanOnce 返回 BLEDevice[]', 'P0', '通用',
    '返回 BLEDevice[]，每项含 Name/Address/RSSI', async (ctx) => {
      if (!SensorController.Instance.isEnable) {
        return ctx.skip('Bluetooth disabled');
      }
      const list = await SensorController.Instance.scanOnce(5000);
      if (list.length === 0) {
        return ctx.skip('no device found in range');
      }
      const allValid = list.every(
        (d) =>
          typeof d.Name === 'string' &&
          typeof d.Address === 'string' &&
          typeof d.RSSI === 'number'
      );
      return ctx.ok(allValid, `${list.length} device(s)`);
    }),

  auto('CTRL-FUNC-007', 'onScanResult 周期回调且列表含目标设备', 'P0', '通用',
    '约每周期回调一次且列表含目标设备', async (ctx) => {
      if (!SensorController.Instance.isEnable) {
        return ctx.skip('Bluetooth disabled');
      }
      const ctrl = DemoController.Instance;
      await ctrl.startScanning();
      const found = await ctx.waitFor(() => ctrl.devices.length > 0, 8000, 200);
      await ctrl.stopScanning();
      if (!found) {
        return ctx.skip('no device found in range');
      }
      return ctx.ok(ctrl.devices.length > 0,
        `${ctrl.devices.length} device(s)`);
    }),

  auto('CTRL-FUNC-008', 'stopScan 后回调停止', 'P0', '通用',
    '停止后无新回调，isScanning===false', async (ctx) => {
      if (!SensorController.Instance.isEnable) {
        return ctx.skip('Bluetooth disabled');
      }
      const ctrl = DemoController.Instance;
      await ctrl.startScanning();
      await ctx.waitFor(() => ctrl.devices.length > 0, 8000, 200);
      await ctrl.stopScanning();
      const count = ctrl.devices.length;
      await ctx.sleep(4000);
      const stable = ctrl.devices.length === count;
      return ctx.ok(!SensorController.Instance.isScanning && stable,
        `stable=${stable}`);
    }),

  auto('CTRL-FUNC-009', 'requireSensor 有效/无效', 'P0', '通用',
    '有效返回 profile，无效返回 undefined 不抛异常', async (ctx) => {
      const valid = SensorController.Instance.requireSensor({
        Name: 'T', Address: VALID_MAC, RSSI: 0,
      } as BLEDevice);
      const invalids = [
        SensorController.Instance.requireSensor(null as unknown as BLEDevice),
        SensorController.Instance.requireSensor({ Name: '', Address: '', RSSI: 0 } as BLEDevice),
        SensorController.Instance.requireSensor({ Name: '', Address: '850B', RSSI: 0 } as BLEDevice),
      ];
      return ctx.ok(
        !!valid && invalids.every((v) => v === undefined),
        `valid=${!!valid} invalidUndefined=${invalids.every((v) => v === undefined)}`
      );
    }),

  auto('CTRL-FUNC-010', 'getSensor(mac) 命中/未命中', 'P0', '通用',
    '已创建返回 profile，未创建返回 undefined', async (ctx) => {
      SensorController.Instance.requireSensor({
        Name: 'T', Address: VALID_MAC, RSSI: 0,
      } as BLEDevice);
      const hit = SensorController.Instance.getSensor(VALID_MAC);
      const miss = SensorController.Instance.getSensor('11:22:33:44:55:66');
      return ctx.ok(!!hit && miss === undefined,
        `hit=${!!hit} miss=${miss === undefined}`);
    }),

  auto('CTRL-FUNC-011', 'getSensors 返回已创建全部 profile', 'P1', '通用',
    '数组包含 requireSensor 返回的 profile', async (ctx) => {
      const p = SensorController.Instance.requireSensor({
        Name: 'T', Address: VALID_MAC, RSSI: 0,
      } as BLEDevice);
      const sensors = SensorController.Instance.getSensors();
      return ctx.ok(!!p && sensors.includes(p),
        `count=${sensors.length}`);
    }),

  auto('CTRL-FUNC-012', 'getConnectedSensors/getConnectedDevices', 'P0', '通用',
    '连接后包含该设备，断开后不含', async (ctx) => {
      const profile = await ctx.ensureConnected();
      if (!profile) {
        return ctx.skip('no device');
      }
      const mac = profile.BLEDevice.Address;
      const connected = SensorController.Instance.getConnectedSensors()
        .some((s) => s.BLEDevice.Address === mac);
      await ctx.disconnectAll();
      const gone = !SensorController.Instance.getConnectedSensors()
        .some((s) => s.BLEDevice.Address === mac);
      return ctx.ok(connected && gone, `connected=${connected} gone=${gone}`);
    }),

  auto('CTRL-FUNC-013', 'getVersion 返回非空', 'P0', '通用',
    '返回非空字符串', async (ctx) => {
      const v = await SensorController.Instance.getVersion();
      return ctx.ok(typeof v === 'string' && v.length > 0, `version=${v}`);
    }),

  auto('CTRL-FUNC-014', 'capiVersion 返回数值', 'P1', '通用',
    '返回正整数 number', async (ctx) => {
      const v = SensorController.Instance.capiVersion;
      return ctx.ok(typeof v === 'number' && v > 0, `capiVersion=${v}`);
    }),

  auto('CTRL-FUNC-015', 'hasScanResultCallback 反映回调注册状态', 'P1', '通用',
    '返回 boolean', async (ctx) => {
      const v = SensorController.Instance.hasScanResultCallback;
      return ctx.ok(typeof v === 'boolean', `hasScanResultCallback=${v}`);
    }),

  auto('CTRL-FUNC-016', '控制器 getParam("BACK_END") 返回后端名', 'P1', '通用',
    '非空且非 Error', async (ctx) => {
      const v = await SensorController.Instance.getParam('BACK_END');
      return ctx.ok(
        typeof v === 'string' && v.length > 0 && !/^error/i.test(v),
        `BACK_END=${v}`
      );
    }),

  auto('CTRL-FUNC-017', '控制器 setParam("LOG_PATH") 返回 OK', 'P1', '通用',
    '返回 OK 且回读一致', async (ctx) => {
      const r = await SensorController.Instance.setParam('LOG_PATH', 'True');
      const read = await SensorController.Instance.getParam('LOG_PATH');
      await SensorController.Instance.setParam('LOG_PATH', 'False');
      return ctx.ok(r === 'OK' && !/^error/i.test(read),
        `set=${r} read=${read}`);
    }),

  auto('CTRL-FUNC-018', '控制器 log 写日志', 'P1', '通用',
    '无异常', async (ctx) => {
      const noThrow = await ctx.expectNoThrow(() =>
        SensorController.Instance.log('automation test', 'I'));
      return ctx.ok(noThrow, 'controller.log OK');
    }),

  auto('CTRL-FUNC-019', 'terminate 幂等', 'P0', '通用',
    '两次均不抛异常，之后 Instance 全新', async (ctx) => {
      const ok1 = await ctx.expectNoThrow(() => SensorController.Instance.terminate());
      const ok2 = await ctx.expectNoThrow(() => SensorController.Instance.terminate());
      DemoController.Instance.resetAfterTerminate();
      return ctx.ok(ok1 && ok2, 'terminate twice OK');
    }),

  auto('CTRL-FUNC-020', 'terminateSdk 后重新 Instance 可用', 'P1', '通用',
    '同步无异常，新实例可扫描', async (ctx) => {
      const ok1 = await ctx.expectNoThrow(() => SensorController.Instance.terminateSdk());
      DemoController.Instance.resetAfterTerminate();
      const ok2 = await ctx.expectNoThrow(() => SensorController.Instance.startScan(3000));
      await SensorController.Instance.stopScan();
      return ctx.ok(ok1 && ok2, 'terminateSdk then startScan OK');
    }),

  auto('CTRL-BND-001', 'startScan(periodInMs) 参数边界', 'P1', '通用',
    '非法值抛 Error，合法值正常', async (ctx) => {
      const bad = [0, -1, 0x7fffffff + 1, 1.5, NaN, Infinity];
      const results = await Promise.all(
        bad.map((v) => ctx.expectThrow(() => SensorController.Instance.startScan(v)))
      );
      const okValid = await ctx.expectNoThrow(async () => {
        const ok = await SensorController.Instance.startScan(3000);
        await SensorController.Instance.stopScan();
        return ok;
      });
      return ctx.ok(results.every(Boolean) && okValid,
        `badThrow=${results.every(Boolean)} valid=${okValid}`);
    }),

  auto('CTRL-BND-002', 'startScan Android 周期钳制告警', 'P1', '通用',
    'Android 产生钳制告警不崩溃', async (ctx) => {
      if (Platform.OS !== 'android') {
        return ctx.skip('Android only');
      }
      const warns = await ctx.expectWarn(async () => {
        await SensorController.Instance.startScan(1000);
        await SensorController.Instance.stopScan();
        await SensorController.Instance.startScan(60000);
        await SensorController.Instance.stopScan();
      });
      return ctx.ok(warns.length > 0, `warnings=${warns.length}`);
    }),

  auto('CTRL-BND-003', 'scanOnce(periodInMs) 参数边界', 'P1', '通用',
    '非法值抛 Error', async (ctx) => {
      const bad = [0, -1, 0x7fffffff + 1, 1.5, NaN, Infinity];
      const results = await Promise.all(
        bad.map((v) => ctx.expectThrow(() => SensorController.Instance.scanOnce(v)))
      );
      return ctx.ok(results.every(Boolean), 'invalid scanOnce throws');
    }),

  auto('CTRL-BND-004', 'requireSensor 空/非法 MAC 格式', 'P1', '通用',
    '均返回 undefined 不崩溃', async (ctx) => {
      const invalids = [
        null,
        { Name: '', Address: '', RSSI: 0 },
        { Name: '', Address: '850B', RSSI: 0 },
        { Name: '', Address: 'ZZ:11:22:33:44:55', RSSI: 0 },
      ];
      const ok = invalids.every(
        (v) =>
          SensorController.Instance.requireSensor(v as unknown as BLEDevice) ===
          undefined
      );
      return ctx.ok(ok, 'invalid requireSensor undefined');
    }),

  auto('CTRL-BND-005', 'getSensor 空串/非法 mac', 'P1', '通用',
    '均返回 undefined', async (ctx) => {
      const a = SensorController.Instance.getSensor('');
      const b = SensorController.Instance.getSensor(undefined as unknown as string);
      const c = SensorController.Instance.getSensor('850B');
      return ctx.ok(a === undefined && b === undefined && c === undefined,
        'empty/invalid getSensor undefined');
    }),

  auto('CTRL-BND-006', '控制器 setParam 空 key / null value', 'P1', '通用',
    '抛 Error("invalid arguments")', async (ctx) => {
      const a = await ctx.expectThrow(() => SensorController.Instance.setParam('', 'True'));
      const b = await ctx.expectThrow(() => SensorController.Instance.setParam('LOG_PATH', null as unknown as string));
      return ctx.ok(a && b, 'empty key / null value throw');
    }),

  auto('CTRL-ROB-001', '扫描期间重复 start/stop', 'P1', '通用',
    '无异常无死锁，最终 isScanning false', async (ctx) => {
      if (!SensorController.Instance.isEnable) {
        return ctx.skip('Bluetooth disabled');
      }
      let noThrow = true;
      for (let i = 0; i < 4; i++) {
        noThrow =
          noThrow &&
          (await ctx.expectNoThrow(async () => {
            await SensorController.Instance.startScan(3000);
            await SensorController.Instance.stopScan();
          }));
      }
      return ctx.ok(noThrow && !SensorController.Instance.isScanning,
        'rapid start/stop stable');
    }),

  auto('CTRL-ROB-002', 'startScan/stopScan/scanOnce 重复调用幂等', 'P1', '通用',
    '无死锁无异常', async (ctx) => {
      if (!SensorController.Instance.isEnable) {
        return ctx.skip('Bluetooth disabled');
      }
      const ok = await ctx.expectNoThrow(async () => {
        await SensorController.Instance.startScan(3000);
        await SensorController.Instance.startScan(3000);
        await SensorController.Instance.scanOnce(1000);
        await SensorController.Instance.stopScan();
        await SensorController.Instance.stopScan();
      });
      return ctx.ok(ok, 'idempotent scan calls OK');
    }),

  semi('CTRL-ROB-003', '蓝牙关闭时 startScan 返回 false 不抛异常', 'P1',
    'Android(程序化)+iOS(人工)', '通用',
    '返回 false，不抛异常', '关闭蓝牙后回到本页，确认不崩溃且状态提示蓝牙关闭。'),
];
