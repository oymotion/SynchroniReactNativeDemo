import React, { useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DataType } from '@synchroni/synchroni_sdk_react_native';
import { useDemoVersion } from '../components/common';
import CubeView from '../components/CubeView';
import SpectrumView from '../components/SpectrumView';
import WaveformView from '../components/WaveformView';
import {
  DemoController,
  SPECTRUM_UPDATE_INTERVAL_MS,
} from '../demo/DemoController';
import { computeSpectrum } from '../dsp/SpectrumCompute';
import type { SpectrumResult } from '../dsp/SpectrumCompute';

const OPTIONS = [
  {
    label: 'Acceleration',
    type: DataType.NTF_ACC,
    yRange: [-8, 8] as [number, number],
    channels: ['ACC-X', 'ACC-Y', 'ACC-Z'],
  },
  {
    label: 'Gyroscope',
    type: DataType.NTF_GYRO,
    yRange: [-2000, 2000] as [number, number],
    channels: ['GYRO-X', 'GYRO-Y', 'GYRO-Z'],
  },
  {
    label: 'Quaternion',
    type: DataType.NTF_QUAT,
    yRange: [-1, 1] as [number, number],
    channels: ['W', 'X', 'Y', 'Z'],
  },
  {
    label: 'Euler Angle',
    type: DataType.NTF_EULER,
    yRange: [-180, 180] as [number, number],
    channels: ['Pitch(Y)', 'Roll(X)', 'Yaw(Z)'],
  },
];

function formatSigned(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(4);
}

export default function WaveformScreen({ visible }: { visible: boolean }) {
  const controller = DemoController.Instance;
  useDemoVersion(visible);
  const [selected, setSelected] = useState(0);

  const option = OPTIONS[selected] ?? OPTIONS[0]!;
  const active = controller.getActiveState();
  // Replay profiles never reach Ready; isDisplayReady also accepts a replay
  // state once its bin info is loaded.
  const ready = controller.isDisplayReady(active);
  // Data source depends on the active pipeline (worklets DSP vs JS path);
  // the accessors hide the difference.
  const channels =
    ready && active ? controller.getDisplayChannels(active, option.type) : [];

  // FFT spectrum of the displayed data type. With the off-thread (worklets)
  // DSP the spectrum arrives precomputed; otherwise it is computed here on
  // the JS thread — the buffers are small enough (<= 5s at IMU rates) for
  // that to be cheap.
  const [spectrum, setSpectrum] = useState<SpectrumResult | null>(null);
  useEffect(() => {
    if (!visible) {
      return;
    }
    const tick = () => {
      const st = controller.getActiveState();
      if (!controller.isDisplayReady(st)) {
        setSpectrum(null);
        return;
      }
      if (controller.isWorkletsBound(st)) {
        setSpectrum(controller.getSpectrumFor(st, option.type));
        return;
      }
      const buf = st.buffers.get(option.type);
      const rate = st.expectedRates.get(option.type) ?? 0;
      if (!buf || buf.length < 16 || rate <= 0) {
        setSpectrum(null);
        return;
      }
      setSpectrum(computeSpectrum(buf.getAllChannels(), rate));
    };
    tick();
    const timer = setInterval(tick, SPECTRUM_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, controller, option.type]);

  const quaternion: [number, number, number, number] | null =
    ready &&
    active &&
    controller.getDisplayChannelCount(active, DataType.NTF_QUAT) >= 4
      ? [
          controller.getDisplayLatest(active, DataType.NTF_QUAT, 0),
          controller.getDisplayLatest(active, DataType.NTF_QUAT, 1),
          controller.getDisplayLatest(active, DataType.NTF_QUAT, 2),
          controller.getDisplayLatest(active, DataType.NTF_QUAT, 3),
        ]
      : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.groupTitle}>3D Quaternion Visualization</Text>
      <CubeView
        quaternion={quaternion}
        placeholder={ready ? 'No quaternion data' : 'Not connected'}
        height={220}
      />
      <View style={styles.selector}>
        {OPTIONS.map((o, idx) => (
          <TouchableOpacity
            key={o.label}
            style={[styles.segment, idx === selected && styles.segmentActive]}
            onPress={() => {
              setSelected(idx);
              controller.appLog(`User: display data type -> ${o.label}`);
            }}
          >
            <Text
              style={[
                styles.segmentText,
                idx === selected && styles.segmentTextActive,
              ]}
            >
              {o.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Spectrum on the left, waveform on the right, 50/50 split. */}
      <View style={styles.waveRow}>
        <View style={styles.waveRowHalf}>
          <SpectrumView
            freqs={spectrum?.freqs ?? []}
            mags={spectrum?.mags ?? []}
            labels={option.channels}
            height={280}
            title={`${option.label} Spectrum`}
            placeholder={ready ? 'Waiting for data ...' : 'Not connected'}
          />
        </View>
        <View style={styles.waveRowHalf}>
          <WaveformView
            channels={channels}
            yRange={option.yRange}
            height={280}
            title={option.label}
          />
        </View>
      </View>

      <Text style={styles.groupTitle}>Real-time Values</Text>
      <View style={styles.valuesBox}>
        {channels.length === 0 || !active ? (
          <Text style={styles.valueText}>--</Text>
        ) : (
          channels.map((_, ch) => (
            <Text key={ch} style={styles.valueText}>
              {`${option.channels[ch] ?? `ch${ch}`}: ${formatSigned(
                controller.getDisplayLatest(active, option.type, ch)
              )}`}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  content: {
    padding: 8,
  },
  groupTitle: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  segment: {
    backgroundColor: '#2c2c2e',
    borderRadius: 4,
    margin: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  segmentActive: {
    backgroundColor: '#0a84ff',
  },
  segmentText: {
    color: '#e5e5ea',
    fontSize: 12,
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  selector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  valueText: {
    color: '#e5e5ea',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
    paddingVertical: 1,
  },
  valuesBox: {
    backgroundColor: '#1c1c1e',
    borderRadius: 4,
    padding: 8,
  },
  waveRow: {
    flexDirection: 'row',
  },
  waveRowHalf: {
    flex: 1,
    paddingHorizontal: 2,
  },
});
