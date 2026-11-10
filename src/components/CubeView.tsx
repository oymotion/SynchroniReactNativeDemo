import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Line, Polygon } from 'react-native-svg';

// Unit cube vertices
const VERTICES: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

// Faces as vertex index quads
const FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 3, 7, 4],
  [1, 2, 6, 5],
];

const FACE_COLORS = [
  '#00b4b4',
  '#c83cc8',
  '#dcc828',
  '#c83c3c',
  '#3ca03c',
  '#3c64dc',
];

// Body axes: X red, Y green, Z blue
const AXES: ReadonlyArray<readonly [number, number, number]> = [
  [1.5, 0, 0],
  [0, 1.5, 0],
  [0, 0, 1.5],
];
const AXIS_COLORS = ['#dc3c3c', '#3cc83c', '#5078ff'];

const CAMERA_DIST = 4.5;

interface CubeViewProps {
  /** [w, x, y, z]; null shows the placeholder */
  quaternion: [number, number, number, number] | null;
  placeholder?: string;
  height?: number;
}

export default function CubeView({
  quaternion,
  placeholder = 'Not connected',
  height = 220,
}: CubeViewProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(Math.floor(e.nativeEvent.layout.width));
  };

  let body: React.ReactElement | null = null;
  if (quaternion && width > 1) {
    let [w, x, y, z] = quaternion;
    const norm = Math.sqrt(w * w + x * x + y * y + z * z);
    if (norm > 0) {
      w /= norm;
      x /= norm;
      y /= norm;
      z /= norm;

      // Rotation matrix from the quaternion
      const R = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
      ];

      const scale = Math.min(width, height) * 0.28;
      const cx = width / 2;
      const cy = height / 2;

      const rotate = (v: readonly [number, number, number]) =>
        R.map(
          (row) => row[0]! * v[0] + row[1]! * v[1] + row[2]! * v[2]
        ) as number[];
      const project = (v: number[]): [number, number] => {
        const persp = CAMERA_DIST / (CAMERA_DIST + v[2]!);
        return [cx + v[0]! * scale * persp, cy - v[1]! * scale * persp];
      };

      const rotated = VERTICES.map(rotate);

      // Painter's algorithm: far faces first (larger z = farther)
      const order = FACES.map((_, i) => i).sort((a, b) => {
        const za = FACES[a]!.reduce((s, k) => s + rotated[k]![2]!, 0);
        const zb = FACES[b]!.reduce((s, k) => s + rotated[k]![2]!, 0);
        return zb - za;
      });

      const origin = project(rotate([0, 0, 0]));

      body = (
        <Svg width={width} height={height}>
          {order.map((f) => (
            <Polygon
              key={f}
              points={FACES[f]!.map((k) =>
                project(rotated[k]!)
                  .map((c) => c.toFixed(1))
                  .join(',')
              ).join(' ')}
              fill={FACE_COLORS[f]}
              stroke="#141414"
              strokeWidth="1"
            />
          ))}
          {AXES.map((axis, a) => {
            const tip = project(rotate(axis));
            return (
              <Line
                key={a}
                x1={origin[0]}
                y1={origin[1]}
                x2={tip[0]}
                y2={tip[1]}
                stroke={AXIS_COLORS[a]}
                strokeWidth="2"
              />
            );
          })}
        </Svg>
      );
    }
  }

  return (
    <View style={[styles.container, { height }]} onLayout={onLayout}>
      {body ?? <Text style={styles.placeholder}>{placeholder}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 4,
    justifyContent: 'center',
    marginVertical: 3,
    overflow: 'hidden',
  },
  placeholder: {
    color: '#969696',
    fontSize: 13,
  },
});
