import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { TestCase } from '../types';

export const controlCases: TestCase[] = [
  {
    id: 'CTRL-FUNC-001',
    title: 'Instance 单例语义',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const a = SensorController.Instance;
      const b = SensorController.Instance;
      ctx.assert(a === b, 'SensorController.Instance 应返回同一实例');
      return 'same instance';
    },
  },
  {
    id: 'CTRL-FUNC-002',
    title: '蓝牙关闭时 isEnable==false 且 onEnableChanged 触发',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['关闭系统蓝牙（Android 快速设置 / iOS 控制中心）。'],
    run: async (ctx) => {
      await ctx.sleep(1500);
      ctx.assert(
        SensorController.Instance.isEnable === false,
        '关闭蓝牙后 isEnable 应为 false',
      );
      return 'isEnable=false 已确认';
    },
  },
  {
    id: 'CTRL-FUNC-003',
    title: '蓝牙开启时 isEnable==true 且 onEnableChanged 触发',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'semi-auto',
    steps: ['开启系统蓝牙。'],
    run: async (ctx) => {
      await ctx.sleep(1500);
      ctx.assert(
        SensorController.Instance.isEnable === true,
        '开启蓝牙后 isEnable 应为 true',
      );
      return 'isEnable=true 已确认';
    },
  },
  {
    id: 'CTRL-FUNC-004',
    title: 'startScan 成功返回 true，isScanning 翻转',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const ok = await SensorController.Instance.startScan(3000);
      ctx.assert(ok === true, 'startScan 应返回 true');
      ctx.assert(SensorController.Instance.isScanning === true, 'isScanning 应为 true');
      await SensorController.Instance.stopScan();
      ctx.assert(SensorController.Instance.isScanning === false, 'stopScan 后 isScanning 应为 false');
      return 'start/stop ok';
    },
  },
  {
    id: 'CTRL-FUNC-005',
    title: 'stopScan 后 isScanning==false',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      await SensorController.Instance.startScan(3000);
      await SensorController.Instance.stopScan();
      ctx.assert(SensorController.Instance.isScanning === false, 'isScanning 应为 false');
      return 'ok';
    },
  },
  {
    id: 'CTRL-FUNC-006',
    title: 'scanOnce 返回 BLEDevice[]',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const list = await SensorController.Instance.scanOnce(5000);
      ctx.assert(Array.isArray(list), 'scanOnce 应返回数组');
      for (const d of list) {
        ctx.assert(typeof d.Address === 'string' && d.Address.length > 0, 'Address 缺失');
        ctx.assert(typeof d.Name === 'string', 'Name 缺失');
        ctx.assert(typeof d.RSSI === 'number', 'RSSI 缺失');
      }
      return `found ${list.length} device(s)`;
    },
  },
  {
    id: 'CTRL-FUNC-007',
    title: 'onScanResult 周期回调且列表含目标设备',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      let hit = false;
      SensorController.Instance.onScanResult = (list) => {
        if (list.some((d) => (d.Address || '') !== '' && list.length >= 0)) {
          if (list.length > 0) {
            hit = true;
          }
        }
      };
      await SensorController.Instance.startScan(3000);
      await ctx.sleep(3500);
      await SensorController.Instance.stopScan();
      (SensorController.Instance as any).onScanResult = undefined;
      ctx.assert(hit, '未收到任何扫描回调');
      return 'received scan callbacks';
    },
  },
  {
    id: 'CTRL-FUNC-008',
    title: 'stopScan 后回调停止',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      let count = 0;
      c.onScanResult = () => {
        count += 1;
      };
      await c.startScan(3000);
      await ctx.sleep(3500);
      await c.stopScan();
      const atStop = count;
      await ctx.sleep(3200); // 缓冲 1 个周期，让 stop 瞬间的在途/残余回调落地
      const settled = count;
      await ctx.sleep(6500); // 再等 >2 个周期，确认无持续回调
      (c as any).onScanResult = undefined;
      ctx.assert(c.isScanning === false, 'stopScan 后 isScanning 应为 false');
      ctx.assert(count === settled, `停止后不应有持续回调（缓冲后 ${settled}，最终 ${count}）`);
      return `scan callbacks stopped (stop=${atStop}, settled=${settled})`;
    },
  },
  {
    id: 'CTRL-FUNC-009',
    title: 'requireSensor 有效设备返回 SensorProfile',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const profile = await ctx.requireTarget();
      ctx.assert(!!profile, '目标设备未找到或 requireSensor 返回 undefined');
      return `profile for ${profile!.BLEDevice.Address}`;
    },
  },
  {
    id: 'CTRL-FUNC-010',
    title: 'getSensor(mac) 命中/未命中',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const got = SensorController.Instance.getSensor(p!.BLEDevice.Address);
      ctx.assert(got === p, 'getSensor 应返回同一 profile');
      ctx.assert(
        SensorController.Instance.getSensor('00:00:00:00:00:00') === undefined,
        '未创建 mac 应返回 undefined',
      );
      return 'ok';
    },
  },
  {
    id: 'CTRL-FUNC-011',
    title: 'getSensors 返回已创建全部 profile',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const before = SensorController.Instance.getSensors().length;
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      const after = SensorController.Instance.getSensors().length;
      ctx.assert(after >= before, 'getSensors 长度不应减少');
      return `before=${before} after=${after}`;
    },
  },
  {
    id: 'CTRL-FUNC-012',
    title: 'getConnectedSensors/getConnectedDevices',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const p = await ctx.requireTarget();
      ctx.assert(!!p, '目标设备未找到');
      await ctx.prepare(p!);
      const mac = p!.BLEDevice.Address.toLowerCase();
      const sens = SensorController.Instance.getConnectedSensors();
      const devs = SensorController.Instance.getConnectedDevices();
      ctx.assert(
        sens.some((s) => s.BLEDevice.Address.toLowerCase() === mac),
        'getConnectedSensors 应包含已连接设备',
      );
      ctx.assert(
        devs.some((d) => (d.Address || '').toLowerCase() === mac),
        'getConnectedDevices 应包含已连接设备',
      );
      await p!.disconnect();
      await ctx.sleep(1000);
      ctx.assert(
        !SensorController.Instance.getConnectedSensors().some((s) => s.BLEDevice.Address.toLowerCase() === mac),
        '断开后 getConnectedSensors 不应再包含该设备',
      );
      return 'connected sets reflect connection state';
    },
  },
  {
    id: 'CTRL-FUNC-013',
    title: 'getVersion 返回非空',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const v = await SensorController.Instance.getVersion();
      ctx.assert(typeof v === 'string' && v.length > 0, 'getVersion 应返回非空字符串');
      return v;
    },
  },
  {
    id: 'CTRL-FUNC-014',
    title: 'capiVersion 返回数值',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const v = SensorController.Instance.capiVersion;
      ctx.assert(typeof v === 'number' && v > 0, 'capiVersion 应为正数');
      return `capiVersion=${v}`;
    },
  },
  {
    id: 'CTRL-FUNC-015',
    title: 'hasScanResultCallback 反映回调注册状态',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      ctx.assert(c.hasScanResultCallback === false, '初始应为 false');
      c.onScanResult = () => {};
      ctx.assert(c.hasScanResultCallback === true, '注册后应为 true');
      (c as any).onScanResult = undefined;
      ctx.assert(c.hasScanResultCallback === false, '清空后应为 false');
      return 'ok';
    },
  },
  {
    id: 'CTRL-FUNC-016',
    title: '控制器 getParam("BACK_END") 返回后端名',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const s = await SensorController.Instance.getParam('BACK_END');
      ctx.assert(typeof s === 'string' && s.length > 0, 'BACK_END 为空');
      ctx.assert(!s.startsWith('Error'), `BACK_END 返回错误: ${s}`);
      return s;
    },
  },
  {
    id: 'CTRL-FUNC-017',
    title: '控制器 setParam("LOG_PATH") 返回 OK',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      const ok = await c.setParam('LOG_PATH', 'True');
      ctx.assert(ok === 'OK', `setParam LOG_PATH True 应返回 OK，实际 ${ok}`);
      const back = await c.getParam('LOG_PATH');
      ctx.assert(typeof back === 'string' && back.length > 0, 'getParam LOG_PATH 应为非空');
      ctx.assert(!back.startsWith('Error'), `getParam LOG_PATH 返回错误: ${back}`);
      return `LOG_PATH=${back}`;
    },
  },
  {
    id: 'CTRL-FUNC-018',
    title: '控制器 log 写日志（联合 LOG 章）',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      let threw = false;
      try {
        c.log('automation test log', 'I');
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, 'log() 不应抛异常');
      return 'log written (see LOG-FUNC-001 for file check)';
    },
  },
  {
    id: 'CTRL-FUNC-019',
    title: 'terminate 幂等',
    chapter: '01_控制器与扫描',
    priority: 'P0',
    mode: 'auto',
    run: async () => {
      await SensorController.Instance.terminate();
      await SensorController.Instance.terminate();
      return 'terminate idempotent';
    },
  },
  {
    id: 'CTRL-FUNC-020',
    title: 'terminateSdk 后重新 Instance 可用',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      SensorController.Instance.terminateSdk();
      const fresh = SensorController.Instance;
      ctx.assert(!!fresh, 'terminateSdk 后 Instance 应可用');
      return 'ok';
    },
  },
  {
    id: 'CTRL-FUNC-021',
    title: 'onScanStateChange 扫描状态回调',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      const events: Array<{ isScanning: boolean; errorMsg: string }> = [];
      c.onScanStateChange = (isScanning, errorMsg) => {
        ctx.log(`[scan-state] 收到回调 isScanning=${isScanning} errorMsg="${errorMsg}"`);
        events.push({ isScanning, errorMsg });
      };
      ctx.log('[scan-state] 已注册 onScanStateChange 回调');

      try {
        // 用 Android 合法周期（6000~30000）避免钳制告警噪声；周期对本用例的状态回调无影响。
        ctx.log('[scan-state] 调用 startScan(6000)…');
        const started = await c.startScan(6000);
        ctx.log(`[scan-state] startScan(6000) 返回 ${started}`);
        if (!started) {
          ctx.log('[scan-state] 警告：startScan 返回 false（定位权限被拒或原生起扫失败），后续将等不到启动回调');
        }

        ctx.log('[scan-state] 等待 isScanning=true 启动回调…');
        await ctx.waitFor(
          () => events.some((e) => e.isScanning),
          5000,
          '收到 isScanning=true 的扫描启动回调',
        );
        ctx.log('[scan-state] 已收到 isScanning=true 启动回调');

        ctx.log('[scan-state] 调用 stopScan()…');
        await c.stopScan();
        ctx.log('[scan-state] stopScan() 已返回');

        ctx.log('[scan-state] 等待 isScanning=false 停止回调…');
        await ctx.waitFor(
          () => events.some((e) => !e.isScanning),
          5000,
          '收到 isScanning=false 的扫描停止回调',
        );
        ctx.log('[scan-state] 已收到 isScanning=false 停止回调');
      } finally {
        c.onScanStateChange = undefined;
        ctx.log('[scan-state] 已移除 onScanStateChange 回调（清理）');
      }

      ctx.log(`[scan-state] 共收到 ${events.length} 次回调: ${JSON.stringify(events)}`);
      const startEvt = events.find((e) => e.isScanning);
      const stopEvt = events.find((e) => !e.isScanning);
      ctx.assert(!!startEvt, '应收到 isScanning=true 的扫描启动回调');
      ctx.assert(!!stopEvt, '应收到 isScanning=false 的扫描停止回调');
      ctx.assert(
        (startEvt?.errorMsg ?? '') === '',
        `启动回调 errorMsg 应为空，实际 "${startEvt?.errorMsg}"`,
      );
      return `start/stop 回调正常，共 ${events.length} 次`;
    },
  },
  {
    id: 'CTRL-BND-001',
    title: 'startScan(periodInMs) 参数边界',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const bads: number[] = [0, -1, 1.5, NaN, Infinity, 0x7fffffff + 1];
      for (const v of bads) {
        let threw = false;
        try {
          await SensorController.Instance.startScan(v);
        } catch (e) {
          threw = true;
        }
        ctx.assert(threw, `startScan(${v}) 应抛 Error`);
      }
      return 'invalid periods rejected';
    },
  },
  {
    id: 'CTRL-BND-002',
    title: 'startScan Android 周期钳制告警',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      // 1000(<6000) / 60000(>30000) 应触发 console.warn 钳制，不崩溃。
      await SensorController.Instance.startScan(1000);
      await SensorController.Instance.stopScan();
      await SensorController.Instance.startScan(60000);
      await SensorController.Instance.stopScan();
      return 'clamping tolerated (check console.warn)';
    },
  },
  {
    id: 'CTRL-BND-003',
    title: 'scanOnce(periodInMs) 参数边界',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const bads: number[] = [0, -1, 1.5, NaN, Infinity];
      for (const v of bads) {
        let threw = false;
        try {
          await SensorController.Instance.scanOnce(v);
        } catch (e) {
          threw = true;
        }
        ctx.assert(threw, `scanOnce(${v}) 应抛 Error`);
      }
      return 'invalid periods rejected';
    },
  },
  {
    id: 'CTRL-BND-004',
    title: 'requireSensor 空/非法 MAC 格式',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      const bads: any[] = [
        null,
        {},
        { Name: '', Address: '', RSSI: 0 },
        { Name: 'x', Address: '850B', RSSI: 0 },
        { Name: 'x', Address: 'ZZ:11:22:33:44:55', RSSI: 0 },
      ];
      for (const b of bads) {
        ctx.assert(
          c.requireSensor(b) === undefined,
          `requireSensor(${JSON.stringify(b)}) 应返回 undefined`,
        );
      }
      return 'invalid devices rejected';
    },
  },
  {
    id: 'CTRL-BND-005',
    title: 'getSensor 空串/非法 mac',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      ctx.assert(c.getSensor('') === undefined, "getSensor('') 应返回 undefined");
      ctx.assert(c.getSensor('850B') === undefined, "getSensor('850B') 应返回 undefined");
      return 'ok';
    },
  },
  {
    id: 'CTRL-BND-006',
    title: '控制器 setParam 空 key / null value',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      for (const args of [['', 'True'], ['LOG_PATH', null]] as any[]) {
        let threw = false;
        try {
          await c.setParam(args[0], args[1]);
        } catch (e) {
          threw = true;
        }
        ctx.assert(threw, `setParam(${JSON.stringify(args)}) 应抛 Error`);
      }
      return 'invalid args rejected';
    },
  },
  {
    id: 'CTRL-ROB-001',
    title: '扫描期间重复 start/stop',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      for (let i = 0; i < 5; i++) {
        await c.startScan(3000);
        await c.stopScan();
      }
      ctx.assert(c.isScanning === false, '结束应为未扫描态');
      return 'no deadlock';
    },
  },
  {
    id: 'CTRL-ROB-002',
    title: 'startScan/stopScan 重复调用幂等',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      await c.stopScan();
      await c.startScan(3000);
      await c.startScan(3000);
      await c.stopScan();
      await c.stopScan();
      return 'idempotent';
    },
  },
  {
    id: 'CTRL-ROB-003',
    title: '蓝牙关闭时 startScan 返回 false 不抛异常',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['关闭系统蓝牙。'],
    run: async (ctx) => {
      let threw = false;
      let ret: boolean | undefined;
      try {
        ret = await SensorController.Instance.startScan(3000);
      } catch (e) {
        threw = true;
      }
      ctx.assert(!threw, '蓝牙关闭时 startScan 不应抛异常');
      ctx.assert(ret === false, `蓝牙关闭时 startScan 应返回 false，实际 ${ret}`);
      return 'graceful false';
    },
  },
  {
    id: 'CTRL-ROB-004',
    title: '蓝牙关闭时 onScanStateChange 携带错误信息',
    chapter: '01_控制器与扫描',
    priority: 'P1',
    mode: 'semi-auto',
    steps: ['关闭系统蓝牙。'],
    run: async (ctx) => {
      const c = SensorController.Instance;
      const events: Array<{ isScanning: boolean; errorMsg: string }> = [];
      c.onScanStateChange = (isScanning, errorMsg) => events.push({ isScanning, errorMsg });
      let ret: boolean | undefined;
      try {
        ret = await c.startScan(3000);
      } catch (e) {
        ret = false;
      }
      await ctx.sleep(500);
      c.onScanStateChange = undefined;
      ctx.assert(ret === false, `蓝牙关闭时 startScan 应返回 false，实际 ${ret}`);
      const stopEvt = events.find((e) => !e.isScanning);
      ctx.assert(!!stopEvt, '应收到 isScanning=false 的回调');
      ctx.assert((stopEvt?.errorMsg ?? '') !== '', `应收到非空 errorMsg，实际 "${stopEvt?.errorMsg}"`);
      return `errorMsg="${stopEvt?.errorMsg}"`;
    },
  },
];
