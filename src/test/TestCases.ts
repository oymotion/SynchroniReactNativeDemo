import type { TestCase } from './TestRunner';
import { CTRL_CASES } from './casesCtrl';
import { DEVSM_CASES } from './casesDevSm';
import { DATA_CASES } from './casesData';
import { PARAM_CASES } from './casesParam';
import { MULTI_CASES, BIN_CASES } from './casesMultiBin';
import { BATTL_CASES, ASYNC_CASES, MISC_CASES } from './casesMisc';
import { SYS_CASES } from './casesSys';

export const TEST_CASES: TestCase[] = [
  ...CTRL_CASES,
  ...DEVSM_CASES,
  ...DATA_CASES,
  ...PARAM_CASES,
  ...MULTI_CASES,
  ...BIN_CASES,
  ...BATTL_CASES,
  ...ASYNC_CASES,
  ...SYS_CASES,
  ...MISC_CASES,
];

export const GROUP_ORDER: Array<{ key: string; label: string }> = [
  { key: 'CTRL', label: '01 控制器与扫描' },
  { key: 'DEV-SM', label: '02 连接与状态机' },
  { key: 'DATA', label: '03 数据流' },
  { key: 'PARAM', label: '04 参数' },
  { key: 'MULTI', label: '05 多设备同步' },
  { key: 'BIN', label: '06 Bin录制回放解析' },
  { key: 'BATT/LOG', label: '07 电量日志调试' },
  { key: 'SYS', label: '08 系统异常' },
  { key: 'ASYNC', label: '09 异步接口' },
  { key: 'MISC', label: '10 底层接口与边界补充' },
];

export const ALL_CASES = TEST_CASES;
