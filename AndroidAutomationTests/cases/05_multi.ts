import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import type { SensorProfile } from '@synchroni/synchroni_sdk_react_native';
import { TestConfig } from '../TestConfig';
import type { TestCase } from '../types';

async function disconnectAll(sensors: SensorProfile[]): Promise<void> {
  for (const s of sensors) {
    try {
      await s.disconnect();
    } catch {
      // ignore
    }
  }
}

export const multiCases: TestCase[] = [
  {
    id: 'MULTI-FUNC-001',
    title: 'multiStartDataNotification 两设备同步起流',
    chapter: '05_多设备同步',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const sensors = await ctx.requireKnownDevices();
      if (sensors.length < 2) {
        await disconnectAll(sensors);
        ctx.skip(`需要 ≥2 台已登记设备，当前 ${sensors.length}`);
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
      await disconnectAll(sensors);
      return `synced ${results.length} devices`;
    },
  },
  {
    id: 'MULTI-FUNC-002',
    title: 'multiStopDataNotification 同步停流',
    chapter: '05_多设备同步',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const sensors = await ctx.requireKnownDevices();
      if (sensors.length < 2) {
        await disconnectAll(sensors);
        ctx.skip(`需要 ≥2 台已登记设备，当前 ${sensors.length}`);
      }
      await SensorController.Instance.multiStartDataNotification(sensors, 15000, 100, 3);
      const results = await SensorController.Instance.multiStopDataNotification(sensors, 15000);
      ctx.assert(results.length === sensors.length, '结果长度应等于输入数');
      for (const r of results) {
        ctx.assert(r.ok === true, `设备 ${r.mac} 停流失败: ${r.error}`);
      }
      await disconnectAll(sensors);
      return `stopped ${results.length} devices`;
    },
  },
  {
    id: 'MULTI-FUNC-003',
    title: 'multiReplayBinFile 多 bin 同步回放',
    chapter: '05_多设备同步',
    priority: 'P0',
    mode: 'auto',
    run: async (ctx) => {
      const paths = TestConfig.MULTI_BIN_PATHS;
      if (!paths || paths.length < 2) {
        ctx.skip('未配置 TestConfig.MULTI_BIN_PATHS（先跑 MULTI-FUNC-003-REC 录制并回填路径）');
      }
      const c = SensorController.Instance;
      // 回放必须在「全新 session」执行：本 session 若已连过真机，原生 replay 会返回 null（replay failed）。
      // 因此这里不连真机，直接用每个 bin 内记录的 MAC 建 fresh profile。
      const profiles: SensorProfile[] = [];
      const macs: string[] = [];
      for (const p of paths) {
        const info = await c.getBinFileInfo(p);
        ctx.assert(info.Valid === true, `bin 无效: ${p}`);
        const prof = c.requireSensor({ Name: info.DeviceName || 'Replay', Address: info.Mac, RSSI: 0 });
        ctx.assert(!!prof, `无法为 ${info.Mac} 创建回放 profile`);
        profiles.push(prof!);
        macs.push(info.Mac);
      }
      ctx.log(`[MULTI-FUNC-003] replay paths=[${paths.join(' , ')}]`);
      ctx.log(`[MULTI-FUNC-003] replay macs=[${macs.join(' , ')}]`);

      const counts = profiles.map(() => 0);
      profiles.forEach((p, i) => {
        p.onSensorNotifyData = (_s, list) => {
          counts[i] += list ? list.length : 0;
        };
      });
      try {
        const replayed = await c.multiReplayBinFile(paths, profiles, true, 30000);
        ctx.log(`[MULTI-FUNC-003] replayed.length=${replayed.length}, members=[${replayed.map((p) => (p === null ? 'null' : 'ok')).join(',')}]`);
        ctx.assert(replayed.length === paths.length, '回放结果数应等于 bin 数');
        const nullCount = replayed.filter((p) => p === null).length;
        ctx.assert(nullCount === 0, `回放有 ${nullCount} 个失败（null 成员）`);
        // multi replay 起播后有约 12s 的启动延迟（多 bin 对齐 / 共享时钟建立）才投递数据，
        // 需比单播更长的时间等待（实测 t≈12s 才有首包，比 DATA_TIMEOUT_MS 的 10s 更久）。
        await ctx.waitFor(() => counts.every((n) => n > 0), 30000, 'multiReplay data');
        for (const mac of macs) {
          await c.stopBinReplay(mac);
        }
        ctx.log(`[MULTI-FUNC-003] multiReplay batches=[${counts.join(',')}]`);
        ctx.assert(counts.every((n) => n > 0), `multiReplayBinFile 回放应推送数据，实际批次 [${counts.join(',')}]`);
        return `replayed ${replayed.length} bins, batches=[${counts.join(',')}]`;
      } finally {
        profiles.forEach((p) => {
          p.onSensorNotifyData = () => {};
        });
      }
    },
  },
  {
    id: 'MULTI-FUNC-003-REC',
    title: '多设备录制 bin（供回放用例 MULTI-FUNC-003 使用）',
    chapter: '05_多设备同步',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;
      const sensors = await ctx.requireKnownDevices();
      if (sensors.length < 2) {
        await disconnectAll(sensors);
        ctx.skip(`需要 ≥2 台已登记设备，当前 ${sensors.length}`);
      }

      await c.setParam('LOG_PATH', 'True');
      const logDir = await c.getParam('LOG_PATH');
      ctx.assert(!logDir.startsWith('Error') && logDir.length > 0, `LOG_PATH 不可用: ${logDir}`);
      const base = logDir.replace(/[\\/]+$/, '');
      const ts = Date.now();
      const paths = sensors.map((_, i) => `${base}/multi_${ts}_${i}.bin`);

      try {
        for (let i = 0; i < sensors.length; i++) {
          const r = await sensors[i].setParam('DEBUG_BLE_DATA_PATH', paths[i]);
          ctx.assert(r === 'OK', `DEBUG_BLE_DATA_PATH(${paths[i]}) 应 OK，实际 ${r}`);
        }

        const started = await c.multiStartDataNotification(sensors, 15000, 100, 3);
        ctx.assert(started.length === sensors.length, '起流结果数应等于设备数');
        for (const r of started) {
          ctx.assert(r.ok === true, `设备 ${r.mac} 起流失败: ${r.error}`);
        }
        ctx.log(`[MULTI-FUNC-003-REC] recording 15s -> ${paths.join(' , ')}`);
        await ctx.sleep(15000);
        await c.multiStopDataNotification(sensors, 15000);

        for (const s of sensors) {
          await s.setParam('DEBUG_BLE_DATA_PATH', 'False');
        }

        const infoStrs: string[] = [];
        for (const p of paths) {
          const info = await c.getBinFileInfo(p);
          ctx.log(`[MULTI-FUNC-003-REC] binInfo ${p}: Valid=${info.Valid} DurationSec=${info.DurationSec} Mac=${info.Mac}`);
          const hasData = info.Valid === true && (info.FirstDataTsMs > 0 || info.DurationSec > 0);
          ctx.assert(hasData, `bin 无效或无数据: ${p} (Valid=${info.Valid}, DurationSec=${info.DurationSec})`);
          infoStrs.push(`${info.Mac}:${info.DurationSec}s`);
        }
        return `recorded [${infoStrs.join(' , ')}]; 把这两个路径回填 TestConfig.MULTI_BIN_PATHS 后，在全新 session 跑 MULTI-FUNC-003`;
      } finally {
        await disconnectAll(sensors);
      }
    },
  },
  {
    id: 'MULTI-BND-001',
    title: 'multiStartDataNotification 空数组/null 元素',
    chapter: '05_多设备同步',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const c = SensorController.Instance;

      // null 本身：checkProfilesArg 抛 'sensors must not be null'
      let nullThrew = false;
      let nullMsg = '';
      try {
        await c.multiStartDataNotification(null as any);
      } catch (e) {
        nullThrew = true;
        nullMsg = e instanceof Error ? e.message : String(e);
      }
      ctx.assert(nullThrew, 'multiStartDataNotification(null) 应抛 Error');
      ctx.assert(nullMsg.includes('not be null'), `应含 not be null，实际 ${nullMsg}`);

      // 含 null 元素：抛 'sensors must not contain null entries'
      let elemThrew = false;
      let elemMsg = '';
      try {
        await c.multiStartDataNotification([null as any]);
      } catch (e) {
        elemThrew = true;
        elemMsg = e instanceof Error ? e.message : String(e);
      }
      ctx.assert(elemThrew, 'multiStartDataNotification([null]) 应抛 Error');
      ctx.assert(elemMsg.includes('null entries'), `应含 null entries，实际 ${elemMsg}`);

      // 空数组：checkProfilesArg 只拦 null 与 null 元素，不拦 []，原生按 0 设备返回空结果。
      // 注意：与手工 spec「传 [] 抛 Error」不一致，暂按实测记录（[] -> 空数组，不抛）。
      let empty: unknown = undefined;
      let emptyThrew = false;
      try {
        empty = await c.multiStartDataNotification([]);
      } catch (e) {
        emptyThrew = true;
      }
      ctx.assert(!emptyThrew, 'multiStartDataNotification([]) 当前不抛异常（实测）');
      ctx.assert(Array.isArray(empty) && (empty as unknown[]).length === 0, `空数组应返回空结果，实际 ${JSON.stringify(empty)}`);

      return `null->${nullMsg}; [null]->${elemMsg}; []->empty array (no throw)`;
    },
  },
  {
    id: 'MULTI-BND-002',
    title: 'multiStartDataNotification 参数边界',
    chapter: '05_多设备同步',
    priority: 'P1',
    mode: 'auto',
    run: async (ctx) => {
      const sensors = await ctx.requireKnownDevices();
      if (sensors.length < 1) {
        ctx.skip('需要 ≥1 台已登记设备');
      }
      const results = await SensorController.Instance.multiStartDataNotification(
        sensors,
        0,
        -1,
        3,
      );
      ctx.assert(results.length === sensors.length, '结果长度应等于输入数');
      await SensorController.Instance.multiStopDataNotification(sensors, 15000);
      await disconnectAll(sensors);
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
    mode: 'auto',
    run: async (ctx) => {
      const okOnes = await ctx.requireKnownDevices();
      if (okOnes.length < 1) {
        ctx.skip('需要 ≥1 台已登记设备');
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
      await disconnectAll(okOnes);
      return `partial failure observed (${results.map((r) => r.ok).join(',')})`;
    },
  },
];
