import type { BLEDevice } from '@synchroni/synchroni_sdk_react_native';

/**
 * 自动化测试目标设备与通用参数配置。
 * 对应 Android SDK 的 TestConfig：MAC 精确匹配优先，广播名后四位 identity 兜底。
 * 修改 TARGET_MAC / TARGET_IDENTITY 以适配当前待测设备，不硬编码型号名。
 */
export const TestConfig = {
  /** 已知精确 MAC（大写/小写均可），用于精确匹配；不知道时留 undefined 走 identity 兜底。 */
  TARGET_MAC: 'BC:93:2A:3F:84:F9' as string | undefined,

  /** 广播名后四位 identity（如 "850B" / "851C"），用于名称后缀匹配。 */
  TARGET_IDENTITY: '84F9',

  /** 多设备用例登记的目标设备表（MAC 精确匹配优先，广播名后四位 identity 兜底）。 */
  DEVICES: [
    { mac: 'BC:93:2A:3F:84:F9', identity: '84F9' },
    { mac: 'BC:93:2A:3F:85:4A', identity: '854A' },
  ] as { mac?: string; identity: string }[],

  /** scanOnce 的扫描窗口（毫秒）。 */
  SCAN_TIMEOUT_MS: 8000,

  /** 连接后的 Ready 等待上限（毫秒）。 */
  READY_TIMEOUT_MS: 15000,

  /** connect() 原生调用在 JS 侧的等待上限（毫秒），避免设备不可达时无限挂起。 */
  CONNECT_TIMEOUT_MS: 15000,

  /** fetchDeviceInfo/getDeviceInfo 原生调用在 JS 侧的等待上限（毫秒）。 */
  DEVICE_INFO_TIMEOUT_MS: 10000,

  /** 等待首包数据上限（毫秒）。 */
  DATA_TIMEOUT_MS: 10000,

  /** init 的 packageSampleCount（每包样本数）。 */
  INIT_PACKAGE_SAMPLE_COUNT: 32,

  /** init 的电量刷新间隔（毫秒）。 */
  INIT_POWER_REFRESH_MS: 60000,

  /** init() 原生调用在 JS 侧的等待上限（毫秒），避免设备未就绪时 init 无限挂起。 */
  INIT_TIMEOUT_MS: 30000,

  /** 电量读取/推送等待上限（毫秒）。 */
  POWER_TIMEOUT_MS: 10000,

  /**
   * 待测 .bin 文件在设备上的绝对路径（用于 Bin 相关用例）。
   * 可先通过 Demo 导出 bin，再填到这里；留 undefined 时 Bin 用例记 SKIP。
   */
  BIN_PATH: '/storage/emulated/0/Documents/sensorsdklog/multi_1794826218381_0.bin' as string | undefined,

  /**
   * 多设备同步回放用例（MULTI-FUNC-003）使用的预录 bin，两台设备各一个（设备上绝对路径）。
   * 由 MULTI-FUNC-003-REC 录制后把打印出的路径填到这里；
   * 注意：回放必须在「全新 session」执行（本 session 若已连过真机，原生 replay 会返回 null）。
   */
  MULTI_BIN_PATHS: [
    '/storage/emulated/0/Documents/sensorsdklog/multi_1794826218381_0.bin',
    '/storage/emulated/0/Documents/sensorsdklog/multi_1794826218381_1.bin',
  ] as string[],

  /** 目标设备匹配：MAC 精确 > 广播名后四位 identity。 */
  matchesTarget(device: BLEDevice): boolean {
    const mac = (device.Address || '').trim().toLowerCase();
    if (TestConfig.TARGET_MAC && mac === TestConfig.TARGET_MAC.toLowerCase()) {
      return true;
    }
    const name = (device.Name || '').trim().toUpperCase();
    const identity = (TestConfig.TARGET_IDENTITY || '').toUpperCase();
    return identity.length > 0 ? name.endsWith(identity) : true;
  },

  /** 多设备匹配：命中 DEVICES 中任一设备（MAC 精确 > 广播名后四位 identity）。 */
  matchesKnownDevice(device: BLEDevice): boolean {
    const mac = (device.Address || '').trim().toLowerCase();
    const name = (device.Name || '').trim().toUpperCase();
    return TestConfig.DEVICES.some((d) => {
      if (d.mac && mac === d.mac.toLowerCase()) {
        return true;
      }
      return d.identity ? name.endsWith(d.identity.toUpperCase()) : false;
    });
  },
};
