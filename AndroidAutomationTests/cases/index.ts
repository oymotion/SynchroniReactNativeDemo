import type { TestCase } from '../types';
import { controlCases } from './01_control';
import { connectionCases } from './02_connection';
import { dataflowCases } from './03_dataflow';
import { paramCases } from './04_params';
import { multiCases } from './05_multi';
import { binCases } from './06_bin';
import { batteryLogCases } from './07_battery_log';
import { systemCases } from './08_system';
import { asyncCases } from './09_async';
import { miscCases } from './10_misc';

/** 按用例 id 排序（编号 3 位补零，字符串序即数字序）。 */
const byId = (a: TestCase, b: TestCase) => a.id.localeCompare(b.id);

/** 全量用例（按章节顺序，章内按 id 排序），供自动化标签页展示与执行。 */
export const allCases: TestCase[] = [
  ...[...controlCases].sort(byId),
  ...[...connectionCases].sort(byId),
  ...[...dataflowCases].sort(byId),
  ...[...paramCases].sort(byId),
  ...[...multiCases].sort(byId),
  ...[...binCases].sort(byId),
  ...[...batteryLogCases].sort(byId),
  ...[...systemCases].sort(byId),
  ...[...asyncCases].sort(byId),
  ...[...miscCases].sort(byId),
];
