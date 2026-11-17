import type {
  BLEDevice,
  DeviceInfo,
  SensorData,
  SensorProfile,
} from '@synchroni/synchroni_sdk_react_native';

/** 自动化程度。auto=程序自动执行；semi-auto=需人工制造系统/硬件动作；manual=纯人工。 */
export type RunMode = 'auto' | 'semi-auto' | 'manual';

export type Verdict = 'PENDING' | 'PASS' | 'FAIL' | 'SKIP';

/** 用例执行上下文，向各用例提供共享断言/等待/设备辅助能力。 */
export interface TestContext {
  /** 输出一条日志（会显示到 UI 与写进报告）。 */
  log(msg: string): void;
  /** 断言；失败抛 Error，由 runner 记为 FAIL。 */
  assert(cond: boolean, msg: string): void;
  /** 标记用例跳过（设备能力不支持 / 环境限制），抛 SkipError 由 runner 记为 SKIP。 */
  skip(msg: string): never;
  sleep(ms: number): Promise<void>;
  /** 轮询等待条件成立，超时抛 Error。 */
  waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void>;

  /** 单次扫描并匹配目标设备；未找到返回 undefined。 */
  scanTarget(timeoutMs?: number): Promise<BLEDevice | undefined>;
  /** 扫描目标设备并 requireSensor；未找到返回 undefined。 */
  requireTarget(): Promise<SensorProfile | undefined>;
  /** 扫描所有已登记设备（TestConfig.DEVICES）并返回匹配列表。 */
  scanKnownDevices(timeoutMs?: number): Promise<BLEDevice[]>;
  /** 扫描并连接（含 init）所有已登记设备，返回已 Ready 的 profile 列表；单个失败仅记日志。 */
  requireKnownDevices(): Promise<SensorProfile[]>;
  /** 确保连接 Ready 且已 init。 */
  prepare(profile: SensorProfile): Promise<void>;
  /** 确保已起流，捕获第一包数据并返回 clone（供访问器/边界用例）。 */
  captureBatch(profile: SensorProfile, timeoutMs?: number): Promise<SensorData>;
  /** 拉取设备能力信息。 */
  fetchDeviceInfo(profile: SensorProfile): Promise<DeviceInfo | undefined>;
}

export type CaseRun = (ctx: TestContext) => Promise<string>;

export interface TestCase {
  id: string;
  title: string;
  chapter: string;
  priority: 'P0' | 'P1' | 'P2';
  mode: RunMode;
  /** semi-auto / manual 用例的操作步骤（屏幕引导）。 */
  steps?: string[];
  /** auto 用例的执行体；返回成功详情，抛 Error 记 FAIL。 */
  run?: CaseRun;
}

export interface TestResult {
  id: string;
  title: string;
  chapter: string;
  priority: string;
  mode: RunMode;
  verdict: Verdict;
  detail: string;
}
