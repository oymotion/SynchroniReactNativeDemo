import RNFS from 'react-native-fs';
import type { TestResult, Verdict } from './types';

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function summarize(results: TestResult[]): string {
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  return `total=${results.length} pass=${count('PASS')} fail=${count('FAIL')} ` +
    `skip=${count('SKIP')} pending=${count('PENDING')}`;
}

function toTxt(results: TestResult[]): string {
  const lines = results.map((r) =>
    `[${r.verdict}] ${r.id} (${r.priority}/${r.mode}) ${r.title}\n    ${r.detail}`,
  );
  return `${summarize(results)}\n\n${lines.join('\n\n')}\n`;
}

/**
 * 将结果写入应用私有文档目录，并尽力复制到公共 Downloads。
 * 返回实际可读的 JSON 报告路径。
 */
export async function writeReport(results: TestResult[]): Promise<string> {
  const json = JSON.stringify(
    { generatedAt: new Date().toISOString(), summary: summarize(results), results },
    null,
    2,
  );
  const dir = `${RNFS.DocumentDirectoryPath}/automation`;
  await RNFS.mkdir(dir);
  const base = `${dir}/report_${stamp()}`;
  const jsonPath = `${base}.json`;
  const txtPath = `${base}.txt`;
  await RNFS.writeFile(jsonPath, json, 'utf8');
  await RNFS.writeFile(txtPath, toTxt(results), 'utf8');

  // 尽力复制到公共下载目录，便于用户直接取文件；失败不影响主报告。
  try {
    const dlDir = RNFS.DownloadDirectoryPath;
    if (dlDir) {
      await RNFS.copyFile(jsonPath, `${dlDir}/sensor_automation_report.json`);
      await RNFS.copyFile(txtPath, `${dlDir}/sensor_automation_report.txt`);
    }
  } catch (e) {
    // ignore: 无存储权限时走 DocumentDirectoryPath
  }

  return jsonPath;
}
