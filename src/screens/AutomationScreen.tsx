import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { allCases } from '../../AndroidAutomationTests/cases';
import { writeReport } from '../../AndroidAutomationTests/report';
import {
  runAutoCases,
  runCase,
  runVerification,
} from '../../AndroidAutomationTests/runner';
import { TestConfig } from '../../AndroidAutomationTests/TestConfig';
import type { TestCase, TestResult, Verdict } from '../../AndroidAutomationTests/types';

type ListItem =
  | { kind: 'header'; chapter: string }
  | { kind: 'case'; tc: TestCase };

const VERDICT_COLOR: Record<Verdict, string> = {
  PENDING: '#8e8e93',
  PASS: '#30d158',
  FAIL: '#ff453a',
  SKIP: '#ffd60a',
};

const MODE_LABEL: Record<string, string> = {
  auto: '自动',
  'semi-auto': '半自动',
  manual: '人工',
};

export default function AutomationScreen({ visible }: { visible: boolean }) {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<TestCase | null>(null);
  const [reportPath, setReportPath] = useState<string>('');

  const scrollRef = useRef<ScrollView>(null);

  const appendLog = (msg: string) => {
    setLogs((prev) => [...prev, msg]);
  };

  const logFn = (msg: string) => appendLog(msg);

  const setResult = (r: TestResult) => {
    setResults((prev) => ({ ...prev, [r.id]: r }));
  };

  const items: ListItem[] = useMemo(() => {
    const out: ListItem[] = [];
    let currentChapter = '';
    for (const tc of allCases) {
      if (tc.chapter !== currentChapter) {
        out.push({ kind: 'header', chapter: tc.chapter });
        currentChapter = tc.chapter;
      }
      out.push({ kind: 'case', tc });
    }
    return out;
  }, []);

  const runSingle = async (tc: TestCase) => {
    setBusy(true);
    appendLog(`>>> ${tc.id} ${tc.title}`);
    const r = await runCase(tc, logFn);
    setResult(r);
    appendLog(`<<< ${tc.id} -> ${r.verdict}: ${r.detail}`);
    setBusy(false);
  };

  const runAllAuto = async () => {
    setBusy(true);
    const autos = allCases.filter((c) => c.mode === 'auto');
    appendLog(`=== 开始执行 ${autos.length} 条自动用例 ===`);
    await runAutoCases(allCases, logFn, (done, total) => {
      appendLog(`进度 ${done}/${total}`);
    });
    // 重新执行一次以收集结果（runAutoCases 返回结果，但为简单这里重跑收集）。
    // 说明：runAutoCases 已返回结果列表，但为保持单次语义，这里直接读取其返回。
    appendLog('=== 自动用例执行完成 ===');
    setBusy(false);
  };

  // runAutoCases 返回结果，但 runAllAuto 目前丢弃了返回值；这里改为收集并落盘。
  const runAllAutoAndCollect = async () => {
    setBusy(true);
    const autos = allCases.filter((c) => c.mode === 'auto');
    appendLog(`=== 开始执行 ${autos.length} 条自动用例 ===`);
    const rs = await runAutoCases(allCases, logFn, (done, total) => {
      appendLog(`进度 ${done}/${total}`);
    });
    const map: Record<string, TestResult> = {};
    rs.forEach((r) => {
      map[r.id] = r;
    });
    setResults((prev) => ({ ...prev, ...map }));
    appendLog('=== 自动用例执行完成 ===');
    setBusy(false);
  };

  const exportReport = async () => {
    const rs = Object.values(results);
    if (rs.length === 0) {
      appendLog('尚无结果，先执行用例再导出');
      return;
    }
    const path = await writeReport(rs);
    setReportPath(path);
    appendLog(`报告已写入: ${path}`);
  };

  const verifyActive = async () => {
    if (!active) {
      return;
    }
    setBusy(true);
    appendLog(`>>> 验证 ${active.id} ${active.title}`);
    const r = await runVerification(active, logFn);
    setResult(r);
    appendLog(`<<< ${active.id} -> ${r.verdict}: ${r.detail}`);
    setBusy(false);
  };

  const manualVerdict = (verdict: Verdict) => {
    if (!active) {
      return;
    }
    const r: TestResult = {
      id: active.id,
      title: active.title,
      chapter: active.chapter,
      priority: active.priority,
      mode: active.mode,
      verdict,
      detail: verdict === 'PASS' ? '人工判定通过' : verdict === 'FAIL' ? '人工判定失败' : '人工跳过',
    };
    setResult(r);
    setActive(null);
  };

  const renderRow = ({ item }: { item: ListItem }) => {
    if (item.kind === 'header') {
      return (
        <View style={styles.header}>
          <Text style={styles.headerText}>{item.chapter}</Text>
        </View>
      );
    }
    const tc = item.tc;
    const r = results[tc.id];
    const verdict = r?.verdict ?? 'PENDING';
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => {
          if (tc.mode === 'auto') {
            void runSingle(tc);
          } else {
            setActive(tc);
          }
        }}
        disabled={busy}
      >
        <View style={styles.rowLeft}>
          <Text style={styles.rowId}>{tc.id}</Text>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {tc.title}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.badge}>
            {tc.priority}/{MODE_LABEL[tc.mode]}
          </Text>
          <Text style={[styles.verdict, { color: VERDICT_COLOR[verdict] }]}>
            {verdict}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.btn, busy && styles.btnDisabled]}
          onPress={() => void runAllAutoAndCollect()}
          disabled={busy}
        >
          <Text style={styles.btnText}>Run All Auto</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => void exportReport()}>
          <Text style={styles.btnText}>导出报告</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>
        目标 identity={TestConfig.TARGET_IDENTITY} | 自动用例可直接跑，半自动/人工点条目看步骤
      </Text>

      <FlatList
        data={items}
        keyExtractor={(item) => (item.kind === 'header' ? `h-${item.chapter}` : `c-${item.tc.id}`)}
        renderItem={renderRow}
        style={styles.list}
      />

      <View style={styles.logPanel}>
        <Text style={styles.logTitle}>日志{reportPath ? ` | 报告: ${reportPath}` : ''}</Text>
        <ScrollView
          ref={scrollRef}
          style={styles.logScroll}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {logs.map((l, i) => (
            <Text key={i} style={styles.logLine}>
              {l}
            </Text>
          ))}
        </ScrollView>
      </View>

      <Modal
        visible={!!active}
        transparent
        animationType="slide"
        onRequestClose={() => setActive(null)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalId}>
              {active?.id} ({active?.priority}/{MODE_LABEL[active?.mode ?? 'manual']})
            </Text>
            <Text style={styles.modalTitle}>{active?.title}</Text>
            <Text style={styles.modalSection}>操作步骤</Text>
            {(active?.steps ?? []).length > 0 ? (
              (active!.steps ?? []).map((s, i) => (
                <Text key={i} style={styles.step}>
                  {i + 1}. {s}
                </Text>
              ))
            ) : (
              <Text style={styles.step}>（无自动化步骤，请按预期结果人工核对）</Text>
            )}
            <View style={styles.modalBtns}>
              {active?.mode === 'semi-auto' && active.run ? (
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={() => void verifyActive()}
                  disabled={busy}
                >
                  <Text style={styles.btnText}>我已执行，验证</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.btn} onPress={() => manualVerdict('PASS')}>
                <Text style={styles.btnText}>通过</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => manualVerdict('FAIL')}>
                <Text style={styles.btnText}>失败</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => manualVerdict('SKIP')}>
                <Text style={styles.btnText}>跳过</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => setActive(null)}>
                <Text style={styles.btnText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  toolbar: { flexDirection: 'row', padding: 8, gap: 8 },
  btn: {
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderColor: '#38383a',
    borderWidth: 1,
  },
  btnPrimary: { backgroundColor: '#0a84ff' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  hint: { color: '#8e8e93', fontSize: 11, paddingHorizontal: 12, paddingBottom: 6 },
  list: { flex: 1 },
  header: {
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#38383a',
  },
  headerText: { color: '#0a84ff', fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2e',
  },
  rowLeft: { flex: 1, marginRight: 8 },
  rowId: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  rowTitle: { color: '#a1a1a6', fontSize: 12, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  badge: { color: '#8e8e93', fontSize: 10 },
  verdict: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  logPanel: { height: 160, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#38383a' },
  logTitle: { color: '#0a84ff', fontSize: 12, padding: 8 },
  logScroll: { paddingHorizontal: 8 },
  logLine: { color: '#d1d1d6', fontSize: 11, paddingVertical: 1 },
  modalWrap: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: { backgroundColor: '#1c1c1e', margin: 24, borderRadius: 12, padding: 16 },
  modalId: { color: '#0a84ff', fontSize: 13, fontWeight: '700' },
  modalTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700', marginTop: 4 },
  modalSection: { color: '#8e8e93', fontSize: 12, marginTop: 12, marginBottom: 4 },
  step: { color: '#d1d1d6', fontSize: 13, lineHeight: 20 },
  modalBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
});
