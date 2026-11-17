import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GROUP_ORDER, TEST_CASES } from '../test/TestCases';
import { TestSession } from '../test/TestRunner';
import type { CaseResult, ResultStatus, TestCase } from '../test/TestRunner';

const session = new TestSession();

const STATUS_LABEL: Record<ResultStatus, string> = {
  pending: '—',
  running: '…',
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
};

const STATUS_COLOR: Record<ResultStatus, string> = {
  pending: '#8e8e93',
  running: '#0a84ff',
  pass: '#30d158',
  fail: '#ff453a',
  skip: '#ffd60a',
};

function Badge({ status }: { status: ResultStatus }) {
  return (
    <Text style={[styles.badge, { color: STATUS_COLOR[status] }]}>
      {STATUS_LABEL[status]}
    </Text>
  );
}

function priorityColor(p: string): string {
  return p === 'P0' ? '#ff453a' : p === 'P1' ? '#ff9f0a' : '#0a84ff';
}

export default function TestScreen({ visible }: { visible: boolean }) {
  const [, setTick] = useState(0);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');

  useEffect(() => {
    if (!visible) return;
    const unsub = session.subscribe(() => setTick((v) => v + 1));
    return unsub;
  }, [visible]);

  const results = session.all();
  const byStatus: Record<ResultStatus, number> = {
    pending: 0,
    running: 0,
    pass: 0,
    fail: 0,
    skip: 0,
  };
  const byPriority: Record<string, { pass: number; total: number }> = {};
  for (const tc of TEST_CASES) {
    const r = results[tc.id];
    const s: ResultStatus = r?.status ?? 'pending';
    byStatus[s] += 1;
    const p = (byPriority[tc.priority] ??= { pass: 0, total: 0 });
    p.total += 1;
    if (s === 'pass') p.pass += 1;
  }
  const stats = { total: TEST_CASES.length, byStatus, byPriority };

  const runAllAuto = async () => {
    setRunning(true);
    setProgress('0 / 0');
    const autoCases = TEST_CASES.filter((tc) => tc.automation === 'auto');
    await session.runMany(autoCases, (done, total) => {
      setProgress(`${done} / ${total}`);
    });
    setRunning(false);
    setProgress('');
  };

  const runSingle = async (tc: TestCase) => {
    if (running) return;
    setRunning(true);
    try {
      await session.runCase(tc);
    } finally {
      setRunning(false);
    }
  };

  const resetAll = () => {
    session.reset();
    setExpanded(undefined);
  };

  const renderCase = (tc: TestCase) => {
    const r: CaseResult = session.get(tc.id) ?? {
      id: tc.id,
      status: 'pending',
      detail: '',
      at: 0,
    };
    const isOpen = expanded === tc.id;
    return (
      <View key={tc.id} style={styles.caseRow}>
        <TouchableOpacity
          style={styles.caseHeader}
          onPress={() => setExpanded(isOpen ? undefined : tc.id)}
        >
          <View style={styles.caseTitleWrap}>
            <Text style={styles.caseId}>{tc.id}</Text>
            <Text style={styles.caseTitle}>{tc.title}</Text>
          </View>
          <View style={styles.caseMeta}>
            <Text style={[styles.priority, { color: priorityColor(tc.priority) }]}>
              {tc.priority}
            </Text>
            <Text style={styles.automation}>{tc.automation}</Text>
            <Badge status={r.status} />
          </View>
        </TouchableOpacity>

        {isOpen && (
          <View style={styles.caseDetail}>
            <Text style={styles.detailLine}>
              <Text style={styles.detailLabel}>预期: </Text>
              {tc.expected || '—'}
            </Text>
            <Text style={styles.detailLine}>
              <Text style={styles.detailLabel}>设备相关: </Text>
              {tc.deviceRelated || '—'}
            </Text>
            <Text style={styles.detailLine}>
              <Text style={styles.detailLabel}>平台: </Text>
              {tc.platform || '—'}
            </Text>

            {tc.automation !== 'auto' ? (
              <>
                <Text style={styles.detailLine}>
                  <Text style={styles.detailLabel}>人工步骤: </Text>
                  {tc.manualSteps || '—'}
                </Text>
                <View style={styles.actionRow}>
                  {(['pass', 'fail', 'skip'] as const).map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={styles.manualButton}
                      onPress={() => session.markManual(tc.id, s)}
                    >
                      <Text style={styles.manualButtonText}>
                        {STATUS_LABEL[s]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.manualButton}
                  disabled={running}
                  onPress={() => runSingle(tc)}
                >
                  <Text style={styles.manualButtonText}>
                    {r.status === 'running' ? 'Running…' : 'Run'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {r.detail ? (
              <Text style={styles.resultDetail}>{r.detail}</Text>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {`共 ${stats.total}  P0 ${stats.byPriority.P0?.pass ?? 0}/${stats.byPriority.P0?.total ?? 0}  `}
          {`P1 ${stats.byPriority.P1?.pass ?? 0}/${stats.byPriority.P1?.total ?? 0}  `}
          {`P2 ${stats.byPriority.P2?.pass ?? 0}/${stats.byPriority.P2?.total ?? 0}`}
        </Text>
        <Text style={styles.summarySub}>
          {`PASS ${stats.byStatus.pass}  FAIL ${stats.byStatus.fail}  SKIP ${stats.byStatus.skip}  未执行 ${stats.byStatus.pending}`}
        </Text>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.manualButton, running && styles.disabled]}
            disabled={running}
            onPress={runAllAuto}
          >
            <Text style={styles.manualButtonText}>
              {running ? `Running ${progress}` : 'Run All Auto'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.manualButton} onPress={resetAll}>
            <Text style={styles.manualButtonText}>Reset</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          提示：auto 用例自动执行；semi-auto 用例按提示人工操作后点 PASS/FAIL/SKIP；
          terminate 类用例会重置 SDK（已自动重绑回调，若界面异常请重启 App）。
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {GROUP_ORDER.map((g) => {
          const cases = TEST_CASES.filter((tc) => tc.group === g.key);
          if (cases.length === 0) return null;
          return (
            <View key={g.key} style={styles.group}>
              <Text style={styles.groupTitle}>{g.label}</Text>
              {cases.map(renderCase)}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  automation: {
    color: '#8e8e93',
    fontSize: 11,
    marginRight: 6,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    minWidth: 34,
    textAlign: 'right',
  },
  caseDetail: {
    borderTopColor: '#2c2c2e',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  caseHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  caseId: {
    color: '#8e8e93',
    fontFamily: 'monospace',
    fontSize: 12,
    marginRight: 8,
  },
  caseMeta: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  caseRow: {
    backgroundColor: '#1c1c1e',
    borderRadius: 6,
    marginBottom: 4,
  },
  caseTitle: {
    color: '#e5e5ea',
    flex: 1,
    fontSize: 13,
  },
  caseTitleWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    marginRight: 8,
  },
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  content: {
    padding: 8,
  },
  detailLabel: {
    color: '#0a84ff',
    fontSize: 12,
    fontWeight: '600',
  },
  detailLine: {
    color: '#e5e5ea',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  disabled: {
    opacity: 0.5,
  },
  group: {
    marginBottom: 12,
  },
  groupTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 4,
  },
  hint: {
    color: '#8e8e93',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
  },
  manualButton: {
    backgroundColor: '#2c2c2e',
    borderColor: '#48484a',
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  manualButtonText: {
    color: '#e5e5ea',
    fontSize: 12,
  },
  priority: {
    fontSize: 11,
    fontWeight: '700',
    marginRight: 6,
  },
  resultDetail: {
    color: '#ffd60a',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  summary: {
    backgroundColor: '#1c1c1e',
    borderBottomColor: '#38383a',
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  summarySub: {
    color: '#e5e5ea',
    fontSize: 12,
    marginTop: 2,
  },
  summaryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
