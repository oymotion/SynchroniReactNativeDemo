import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

// Channel color palette (shared with SpectrumView)
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

interface WaveformViewProps {
  /** one series per channel */
  channels: Array<Float32Array | number[]>;
  /** fixed Y range; omitted => auto (min/max + 10% margin) */
  yRange?: [number, number];
  height: number;
  title?: string;
  /** optional right-side text (e.g. impedance) */
  sideText?: string;
  sideTextColor?: string;
}

export default function WaveformView({
  channels,
  yRange,
  height,
  title,
  sideText,
  sideTextColor,
}: WaveformViewProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(Math.floor(e.nativeEvent.layout.width));
  };

  const plotHeight = Math.max(1, height - (title ? TITLE_HEIGHT : 0));

  let min: number;
  let max: number;
  if (yRange) {
    [min, max] = yRange;
  } else {
    min = Infinity;
    max = -Infinity;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i] ?? 0;
        if (v < min) {
          min = v;
        }
        if (v > max) {
          max = v;
        }
      }
    }
    if (!isFinite(min) || !isFinite(max)) {
      min = -1;
      max = 1;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const margin = (max - min) * 0.1;
    min -= margin;
    max += margin;
  }

  const toY = (v: number): number =>
    plotHeight - 1 - ((v - min) / (max - min)) * (plotHeight - 2);

  const polylines: React.ReactElement[] = [];
  if (width > 1) {
    channels.forEach((data, chIdx) => {
      const len = data.length;
      if (len === 0) {
        return;
      }
      // Decimate to pixel width without averaging.
      const pts: string[] = [];
      for (let x = 0; x < width; x++) {
        const idx = Math.min(len - 1, Math.floor((x * len) / width));
        pts.push(`${x},${toY(data[idx] ?? 0).toFixed(1)}`);
      }
      polylines.push(
        <Polyline
          key={chIdx}
          points={pts.join(' ')}
          fill="none"
          stroke={CHANNEL_COLORS[chIdx % CHANNEL_COLORS.length]}
          strokeWidth="1"
        />
      );
    });
  }

  const centerY = Math.min(plotHeight - 1, Math.max(1, toY(0)));

  return (
    <View style={[styles.container, { height }]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.row}>
        <View style={styles.plot} onLayout={onLayout}>
          {width > 1 ? (
            <Svg width={width} height={plotHeight}>
              <Line
                x1={0}
                y1={centerY}
                x2={width}
                y2={centerY}
                stroke="#444444"
                strokeWidth="1"
              />
              {polylines}
            </Svg>
          ) : null}
        </View>
        {sideText ? (
          <Text
            style={[styles.sideText, { color: sideTextColor ?? '#9e9e9e' }]}
          >
            {sideText}
          </Text>
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
  title: {
    color: '#c8c8cc',
    fontSize: 11,
    height: TITLE_HEIGHT,
    lineHeight: TITLE_HEIGHT,
    paddingHorizontal: 6,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  plot: {
    flex: 1,
  },
  sideText: {
    fontFamily: 'monospace',
    fontSize: 10,
    paddingHorizontal: 4,
    textAlignVertical: 'center',
    width: 76,
  },
});
