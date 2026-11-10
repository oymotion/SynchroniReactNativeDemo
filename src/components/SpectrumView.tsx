import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Rect, Text as SvgText } from 'react-native-svg';

// Same channel palette as WaveformView, so a spectrum curve matches its
// waveform trace.
const CHANNEL_COLORS = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
];

const TITLE_HEIGHT = 18;
// Bottom strip reserved for the frequency axis text.
const AXIS_HEIGHT = 14;
const INSET = 2;

interface SpectrumViewProps {
  /** one-sided frequency axis; fewer than 2 bins => placeholder */
  freqs: Float32Array | number[];
  /** one magnitude row per channel, aligned with freqs */
  mags: Array<Float32Array | number[]>;
  /** per-channel labels drawn top-left in the channel colors */
  labels?: string[];
  /** >= 0 pins the curve color (single-channel rows); -1 colors each curve
   * by its row index */
  colorIndex?: number;
  height: number;
  title?: string;
  /** centered text shown when there is no spectrum to draw */
  placeholder?: string;
}

export default function SpectrumView({
  freqs,
  mags,
  labels,
  colorIndex = -1,
  height,
  title,
  placeholder,
}: SpectrumViewProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(Math.floor(e.nativeEvent.layout.width));
  };

  const plotHeight = Math.max(1, height - (title ? TITLE_HEIGHT : 0));
  const plotL = INSET;
  const plotT = INSET;
  const plotR = Math.max(plotL + 1, width - INSET);
  const plotB = Math.max(plotT + 1, plotHeight - AXIS_HEIGHT);
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  const hasData = freqs.length >= 2 && mags.length > 0;
  const fMax = hasData ? (freqs[freqs.length - 1] ?? 0) : 0;

  const polylines: React.ReactElement[] = [];
  const curveLabels: React.ReactElement[] = [];
  if (width > 1 && hasData && fMax > 0) {
    // Auto Y range across all channels, with 10% headroom above the peak.
    let peak = 0;
    for (const row of mags) {
      for (let i = 0; i < row.length; i++) {
        const v = row[i] ?? 0;
        if (v > peak) {
          peak = v;
        }
      }
    }
    const yMax = peak > 0 ? peak * 1.1 : 1;

    mags.forEach((row, ch) => {
      const count = Math.min(row.length, freqs.length);
      const pts: string[] = [];
      for (let i = 0; i < count; i++) {
        const x = plotL + ((freqs[i] ?? 0) / fMax) * (plotW - 1);
        const y = plotB - 1 - ((row[i] ?? 0) / yMax) * (plotH - 2);
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      const colorIdx = colorIndex >= 0 ? colorIndex : ch;
      const color = CHANNEL_COLORS[colorIdx % CHANNEL_COLORS.length]!;
      polylines.push(
        <Polyline
          key={ch}
          points={pts.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="1"
        />
      );
      curveLabels.push(
        <SvgText
          key={ch}
          x={plotL + 4}
          y={plotT + 12 + ch * 13}
          fill={color}
          fontSize="10"
        >
          {labels?.[ch] ?? `ch${ch}`}
        </SvgText>
      );
    });
  }

  return (
    <View style={[styles.container, { height }]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.plot} onLayout={onLayout}>
        {width > 1 ? (
          <Svg width={width} height={plotHeight}>
            <Rect
              x={plotL}
              y={plotT}
              width={plotW - 1}
              height={plotH - 1}
              fill="none"
              stroke="#5a5a5a"
              strokeWidth="1"
            />
            {hasData && fMax > 0 ? (
              <>
                {polylines}
                {curveLabels}
                <SvgText
                  x={plotL + 2}
                  y={plotHeight - 3}
                  fill="#969696"
                  fontSize="10"
                >
                  0
                </SvgText>
                <SvgText
                  x={plotR - 2}
                  y={plotHeight - 3}
                  fill="#969696"
                  fontSize="10"
                  textAnchor="end"
                >
                  {`${fMax.toFixed(1)} Hz`}
                </SvgText>
              </>
            ) : (
              <SvgText
                x={width / 2}
                y={(plotT + plotB) / 2 + 3}
                fill="#969696"
                fontSize="11"
                textAnchor="middle"
              >
                {placeholder ?? 'Waiting for data ...'}
              </SvgText>
            )}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1c1c1e',
    borderRadius: 4,
    marginVertical: 3,
    overflow: 'hidden',
  },
  plot: {
    flex: 1,
  },
  title: {
    color: '#c8c8cc',
    fontSize: 11,
    height: TITLE_HEIGHT,
    lineHeight: TITLE_HEIGHT,
    paddingHorizontal: 6,
  },
});
