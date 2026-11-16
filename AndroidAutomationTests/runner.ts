import { createContext, SkipError } from './context';
import type { TestCase, TestResult } from './types';

/** 执行单个 auto 用例；semi-auto/manual 由 UI 走步骤引导，runner 仅返回 PENDING 占位。 */
export async function runCase(
  tc: TestCase,
  log: (msg: string) => void,
): Promise<TestResult> {
  const base: TestResult = {
    id: tc.id,
    title: tc.title,
    chapter: tc.chapter,
    priority: tc.priority,
    mode: tc.mode,
    verdict: 'PENDING',
    detail: '',
  };

  if (tc.mode !== 'auto') {
    base.detail = tc.steps && tc.steps.length > 0 ? tc.steps.join('；') : '';
    return base;
  }
  if (!tc.run) {
    return { ...base, verdict: 'SKIP', detail: 'no run implementation' };
  }

  try {
    const detail = await tc.run(createContext(log));
    return { ...base, verdict: 'PASS', detail: detail || 'OK' };
  } catch (e) {
    if (e instanceof SkipError) {
      return { ...base, verdict: 'SKIP', detail: e.message };
    }
    const detail = e instanceof Error ? e.message : String(e);
    return { ...base, verdict: 'FAIL', detail };
  }
}

/**
 * 半自动用例的「验证」步骤：用户在屏幕执行物理操作后点击验证，
 * 这里运行该用例的 run()（若存在）产出 PASS/FAIL。
 */
export async function runVerification(
  tc: TestCase,
  log: (msg: string) => void,
): Promise<TestResult> {
  const base: TestResult = {
    id: tc.id,
    title: tc.title,
    chapter: tc.chapter,
    priority: tc.priority,
    mode: tc.mode,
    verdict: 'PENDING',
    detail: '',
  };
  if (!tc.run) {
    return { ...base, verdict: 'SKIP', detail: 'no verification implementation' };
  }
  try {
    const detail = await tc.run(createContext(log));
    return { ...base, verdict: 'PASS', detail: detail || 'OK' };
  } catch (e) {
    if (e instanceof SkipError) {
      return { ...base, verdict: 'SKIP', detail: e.message };
    }
    const detail = e instanceof Error ? e.message : String(e);
    return { ...base, verdict: 'FAIL', detail };
  }
}

/** 按顺序执行全部 auto 用例，返回结果列表。 */
export async function runAutoCases(
  cases: TestCase[],
  log: (msg: string) => void,
  onProgress?: (idx: number, total: number) => void,
): Promise<TestResult[]> {
  const autos = cases.filter((c) => c.mode === 'auto');
  const results: TestResult[] = [];
  for (let i = 0; i < autos.length; i++) {
    onProgress?.(i + 1, autos.length);
    results.push(await runCase(autos[i], log));
  }
  return results;
}
