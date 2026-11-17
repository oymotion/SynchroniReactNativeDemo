import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DataType } from '@synchroni/synchroni_sdk_react_native';
import { DemoButton, useDemoVersion } from '../components/common';
import SpectrumView from '../components/SpectrumView';
import WaveformView from '../components/WaveformView';
import {
  DemoController,
  SPECTRUM_UPDATE_INTERVAL_MS,
} from '../demo/DemoController';
import { LiveFilter } from '../dsp/LiveFilter';
import { computeSpectrum } from '../dsp/SpectrumCompute';
import type { SpectrumResult } from '../dsp/SpectrumCompute';

// Live Filter band labels; index 0 = Off.
const FILTER_BANDS = LiveFilter.bandLabels();

interface BioPlot {
  title: string;
  type: DataType;
  channel: number;
  /** Whether the row shows a per-channel spectrum on its left half. */
  spectrum: boolean;
  /** Fixed Y range for the row (auto-ranged when unset). */
  yRange?: [number, number];
}

function impedanceSide(
  impedance: number[],
  channel: number
): { text: string; color: string } | undefined {
  const raw = impedance[channel];
  if (raw === undefined) {
    return undefined;
  }
  const kohm = raw / 1000;
  const color = kohm <= 500 ? '#4caf50' : kohm <= 999 ? '#ff9800' : '#f44336';
  return { text: `${kohm.toFixed(2)} KOhm`, color };
}

export default function BioScreen({ visible }: { visible: boolean }) {
  const controller = DemoController.Instance;
  useDemoVersion(visible);
  const [page, setPage] = useState(0);

  const active = controller.getActiveState();
  const info = active?.info;
  // Impedance side texts show only while the device supports the
  // impedance stream and its NTF switch is on.
  const impedanceOn =
    (info?.ImpeChannelCount ?? 0) > 0 &&
    (controller.ntfStates.NTF_IMPEDANCE ?? false);
  // Replay profiles never reach Ready; isDisplayReady also accepts a
  // loaded replay.
  const ready = controller.isDisplayReady(active);

  let plots: BioPlot[] = [];
  let pages = 1;

  if (ready && active) {
    // Mag angle shows as an extra "Angle" row.
    const hasMag =
      (info?.AngleChannelCount ?? 0) > 0 ||
      controller.getDisplayChannelCount(active, DataType.NTF_ANGLE) > 0;
    const anglePlot: BioPlot = {
      title: 'Angle',
      type: DataType.NTF_ANGLE,
      channel: 0,
      spectrum: true,
      yRange: [0, 180],
    };
    if (info && info.PpgChannelCount > 0) {
      // PPG-capable: fixed 6 plots; SpO2/heart_rate get no spectrum
      // (low-rate derived quantities).
      plots = [
        { title: 'fp1', type: DataType.NTF_EEG, channel: 0, spectrum: true },
        { title: 'fp2', type: DataType.NTF_EEG, channel: 1, spectrum: true },
        {
          title: 'red_led',
          type: DataType.NTF_PPG,
          channel: 0,
          spectrum: true,
        },
        {
          title: 'ir_led',
          type: DataType.NTF_PPG,
          channel: 1,
          spectrum: true,
        },
        {
          title: 'spo2',
          type: DataType.NTF_SPO2_HR,
          channel: 0,
          spectrum: false,
        },
        {
          title: 'heart_rate',
          type: DataType.NTF_SPO2_HR,
          channel: 1,
          spectrum: false,
        },
      ];
    } else if (info && info.EegChannelCount > 0) {
      // EEG-capable: paged EEG channels; Angle/ECG/BRTH extras show on
      // the last page only.
      const hasECG = info.EcgChannelCount > 0;
      const hasBRTH = info.BrthChannelCount > 0;
      const perPage =
        8 - (hasECG ? 1 : 0) - (hasBRTH ? 1 : 0) - (hasMag ? 1 : 0);
      pages = Math.max(1, Math.ceil(info.EegChannelCount / perPage));
      const currentPage = Math.min(page, pages - 1);
      const start = currentPage * perPage;
      for (
        let i = start;
        i < Math.min(start + perPage, info.EegChannelCount);
        i++
      ) {
        plots.push({
          title: `EEG-${i + 1}`,
          type: DataType.NTF_EEG,
          channel: i,
          spectrum: true,
        });
      }
      if (currentPage === pages - 1) {
        if (hasMag) {
          plots.push(anglePlot);
        }
        if (hasECG) {
          plots.push({
            title: 'ECG',
            type: DataType.NTF_ECG,
            channel: 0,
            spectrum: true,
          });
        }
        if (hasBRTH) {
          plots.push({
            title: 'BRTH',
            type: DataType.NTF_BRTH,
            channel: 0,
            spectrum: false,
          });
        }
      }
    } else {
      // Fallback: EMG up to 8 channels, no paging; a mag-only device
      // lands here too.
      const count =
        info?.EmgChannelCount ??
        controller.getDisplayChannelCount(active, DataType.NTF_EMG_ADC);
      for (let i = 0; i < Math.min(hasMag ? 7 : 8, count); i++) {
        plots.push({
          title: `EMG-${i + 1}`,
          type: DataType.NTF_EMG_ADC,
          channel: i,
          spectrum: true,
        });
      }
      if (hasMag) {
        plots.push(anglePlot);
      }
    }
  }

  const currentPage = Math.min(page, pages - 1);

  // Per-row spectra: precomputed when the worklets DSP is active,
  // computed here otherwise.
  const spectrumKey = plots
    .filter((p) => p.spectrum)
    .map((p) => `${p.type}:${p.channel}`)
    .join('|');
  const [spectra, setSpectra] = useState<Record<string, SpectrumResult | null>>(
    {}
  );
  useEffect(() => {
    if (!visible || spectrumKey.length === 0) {
      setSpectra({});
      return;
    }
    const bindings = spectrumKey
      .split('|')
      .map((entry) => entry.split(':').map(Number) as [number, number]);
    const tick = () => {
      const st = controller.getActiveState();
      if (!controller.isDisplayReady(st)) {
        setSpectra({});
        return;
      }
      const next: Record<string, SpectrumResult | null> = {};
      for (const [type, channel] of bindings) {
        const key = `${type}:${channel}`;
        if (controller.isWorkletsBound(st)) {
          const s = controller.getSpectrumFor(st, type);
          const row = s?.mags[channel];
          next[key] = s && row ? { freqs: s.freqs, mags: [row] } : null;
          continue;
        }
        const buf = st.buffers.get(type);
        const rate = st.expectedRates.get(type) ?? 0;
        if (
          !buf ||
          buf.length < 16 ||
          rate <= 0 ||
          channel >= buf.channelCount
        ) {
          next[key] = null;
          continue;
        }
        next[key] = computeSpectrum([buf.getChannel(channel)], rate);
      }
      setSpectra(next);
    };
    tick();
    const timer = setInterval(tick, SPECTRUM_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, controller, spectrumKey]);

  return (
    <View style={styles.container}>
      <Text style={styles.groupTitle}>
        Live Filter (EMG/EEG/ECG/BRTH/PPG/SpO2)
      </Text>
      <View style={styles.selector}>
        {FILTER_BANDS.map((label, idx) => (
          <TouchableOpacity
            key={label}
            style={[
              styles.segment,
              idx === controller.liveFilterBand && styles.segmentActive,
            ]}
            onPress={() => controller.setLiveFilterBand(idx)}
          >
            <Text
              style={[
                styles.segmentText,
                idx === controller.liveFilterBand && styles.segmentTextActive,
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {pages > 1 ? (
        <View style={styles.pager}>
          <DemoButton
            title="Prev"
            onPress={() => {
              const next = Math.max(0, currentPage - 1);
              setPage(next);
              controller.appLog(`User: prev page -> ${next}`, 'D');
            }}
            disabled={currentPage <= 0}
          />
          <Text
            style={styles.pagerText}
          >{`${currentPage + 1} / ${pages}`}</Text>
          <DemoButton
            title="Next"
            onPress={() => {
              const next = Math.min(pages - 1, currentPage + 1);
              setPage(next);
              controller.appLog(`User: next page -> ${next}`, 'D');
            }}
            disabled={currentPage >= pages - 1}
          />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        {plots.length === 0 ? (
          <Text style={styles.empty}>
            No bio stream (connect a device first)
          </Text>
        ) : (
          plots.map((plot) => {
            const all = active
              ? controller.getDisplayChannels(active, plot.type)
              : [];
            const channels =
              plot.channel < all.length
                ? [all[plot.channel]!]
                : [new Float32Array(0)];
            // No impedance side text on the Angle row, and none anywhere
            // while the impedance stream is off.
            const side =
              active && impedanceOn && plot.type !== DataType.NTF_ANGLE
                ? impedanceSide(active.impedance, plot.channel)
                : undefined;
            const waveform = (
              <WaveformView
                channels={channels}
                height={110}
                title={plot.title}
                yRange={plot.yRange}
                sideText={side?.text}
                sideTextColor={side?.color}
              />
            );
            if (!plot.spectrum) {
              return (
                <View key={`${plot.title}-${plot.channel}`}>{waveform}</View>
              );
            }
            // Row split: spectrum on the left, waveform on the right.
            const rowSpectrum = spectra[`${plot.type}:${plot.channel}`] ?? null;
            return (
              <View key={`${plot.title}-${plot.channel}`} style={styles.bioRow}>
                <View style={styles.bioRowHalf}>
                  <SpectrumView
                    freqs={rowSpectrum?.freqs ?? []}
                    mags={rowSpectrum?.mags ?? []}
                    labels={[plot.title]}
                    colorIndex={plot.channel}
                    height={110}
                    placeholder={
                      ready ? 'Waiting for data ...' : 'Not connected'
                    }
                  />
                </View>
                <View style={styles.bioRowHalf}>{waveform}</View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bioRow: {
    flexDirection: 'row',
  },
  bioRowHalf: {
    flex: 1,
    paddingHorizontal: 2,
  },
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  content: {
    padding: 8,
  },
  empty: {
    color: '#8e8e93',
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
  },
  groupTitle: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    paddingHorizontal: 8,
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
    marginBottom: 4,
    paddingHorizontal: 6,
  },
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  pagerText: {
    color: '#e5e5ea',
    fontSize: 12,
    marginHorizontal: 12,
  },
});
