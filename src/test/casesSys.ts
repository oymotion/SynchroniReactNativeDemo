import { SEMI } from './TestRunner';
import type { TestCase } from './TestRunner';

const G = 'SYS';

function semi(
  id: string,
  title: string,
  priority: TestCase['priority'],
  platform: string,
  expected: string,
  manualSteps: string
): TestCase {
  return {
    id,
    group: G,
    title,
    priority,
    platform,
    deviceRelated: '通用',
    automation: SEMI,
    manualSteps,
    expected,
  };
}

export const SYS_CASES: TestCase[] = [
  semi('SYS-ROB-001', '扫描/连接中关闭蓝牙', 'P0',
    'Android(程序化)+iOS(人工)',
    'isEnable===false 且收到使能回调；扫描停止/连接失败，无崩溃；重开可恢复',
    '扫描或连接过程中关闭蓝牙，观察 isEnable、onEnableChanged、扫描/连接状态。'),

  semi('SYS-ROB-002', '起流中关闭蓝牙', 'P0',
    'Android(程序化)+iOS(人工)',
    '数据停止；onDataTransferStateChange 收到 false；状态掉到非 Ready，无崩溃',
    '起流数据正常后关闭蓝牙，观察数据、onDataTransferStateChange、onStateChange。'),

  semi('SYS-ROB-003', '蓝牙重开后自动恢复', 'P0',
    'Android(程序化)+iOS(人工)',
    'autoReconnect===true 时自动重连回到 Ready 并恢复数据；false 时不自动恢复',
    '起流中关蓝牙再开蓝牙，观察是否自动回到 Ready 并恢复数据。'),

  semi('SYS-ROB-004', '飞行模式开关', 'P1',
    'Android(程序化)+iOS(人工)',
    '飞行模式开启走 SYS-ROB-002 路径，退出后按 SYS-ROB-003 恢复，无崩溃',
    '连接/起流中开关飞行模式，退出飞行模式后观察恢复。'),

  semi('SYS-ROB-005', 'WiFi 开关不影响已起 BLE 数据', 'P1',
    'Android(程序化)+iOS(人工)',
    'BLE 数据不中断、无异常',
    '起流稳定后开关 WiFi，观察数据连续性。'),

  semi('SYS-ROB-006', '扫描中开关 WiFi', 'P1',
    'Android(程序化)+iOS(人工)',
    '扫描不中断、不崩溃，仍能发现目标设备',
    'startScan 中反复开关 WiFi，观察扫描回调与设备发现。'),

  semi('SYS-ROB-007', '通知/横幅弹窗打断不中断起流', 'P1',
    'Android(程序化)+iOS(人工)',
    '数据不中断，App 前台无崩溃',
    '起流稳定后触发系统通知横幅/弹窗，观察数据连续性。'),

  semi('SYS-ROB-008', '来电打断后恢复', 'P1',
    'Android(程序化)+iOS(人工)',
    '来电期间可能走后台/挂起路径；回前台后数据恢复，无崩溃',
    '起流中来电（或模拟通话），通话结束后回到 App 观察数据。'),

  semi('SYS-ROB-009', 'App 切后台再回前台（onSuspend）', 'P0',
    '通用',
    'onSuspend() 同步写入挂起标记并 flush 日志/捕获文件；数据流不被主动停止，回前台后继续',
    '起流中调 onSuspend()（或切后台），再回前台，观察数据与 bin 挂起标记。'),

  semi('SYS-ROB-010', '锁屏/解锁', 'P1',
    'Android(程序化)+iOS(人工)',
    '锁屏期间数据按系统策略可能继续或暂停，解锁后恢复，无崩溃',
    '起流中锁屏，数秒后解锁，观察数据连续性。'),

  semi('SYS-ROB-011', '屏幕旋转（横竖屏）', 'P1',
    '通用',
    '无崩溃、无数据中断；UI 正常重绘',
    '起流中旋转屏幕（横竖屏切换），观察 App 与数据。'),

  semi('SYS-ROB-012', '分屏/多窗口', 'P2',
    'Android(程序化)+iOS(人工)',
    '数据持续，无崩溃；切回全屏正常',
    '起流中进入分屏/多窗口，观察数据与 UI。'),

  semi('SYS-ROB-013', '权限授予/撤销（Android 定位/蓝牙）', 'P0',
    'Android',
    '权限缺失时 startScan 引导授权，拒绝返回 false 不崩溃；授予后正常扫描/连接',
    '撤销定位/蓝牙权限后调 startScan/connect；再授予后重试。'),

  semi('SYS-ROB-014', '系统弹窗（低电量提示等）打断', 'P2',
    'Android(程序化)+iOS(人工)',
    '数据不中断，无崩溃',
    '起流中触发低电量/系统提示弹窗，观察数据。'),
];
