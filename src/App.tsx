import React, { useEffect, useState } from 'react';
import {
  AppState,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SensorController } from '@synchroni/synchroni_sdk_react_native';
import BioScreen from './screens/BioScreen';
import DeviceScreen from './screens/DeviceScreen';
import WaveformScreen from './screens/WaveformScreen';
import { DemoController } from './demo/DemoController';

const TABS = [
  { key: 'devices', label: 'Devices' },
  // The waveform page carries the IMU widgets (3D quaternion cube +
  // ACC/GYRO/Quat/Euler 2D waveforms), so the tab is labeled accordingly.
  { key: 'waveforms', label: 'IMU' },
  { key: 'bio', label: 'Bio' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function App() {
  const [tab, setTab] = useState<TabKey>('devices');

  useEffect(() => {
    // Instantiate the shared demo data layer once. On unmount only local
    // listeners/timers are removed — native terminate() is left out on purpose.
    const controller = DemoController.Instance;
    // Swift scenePhase / Kotlin onStop parity: flush the SDK capture and log
    // files when the app moves to the background.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        SensorController.Instance.onSuspend();
      }
    });
    return () => {
      appStateSub.remove();
      controller.release();
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.body}>
        <View style={tab === 'devices' ? styles.visible : styles.hidden}>
          <DeviceScreen visible={tab === 'devices'} />
        </View>
        <View style={tab === 'waveforms' ? styles.visible : styles.hidden}>
          <WaveformScreen visible={tab === 'waveforms'} />
        </View>
        <View style={tab === 'bio' ? styles.visible : styles.hidden}>
          <BioScreen visible={tab === 'bio'} />
        </View>
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={styles.tabButton}
            onPress={() => setTab(t.key)}
          >
            <Text
              style={[styles.tabText, tab === t.key && styles.tabTextActive]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  hidden: {
    display: 'none',
    flex: 1,
  },
  tabBar: {
    backgroundColor: '#1c1c1e',
    borderTopColor: '#38383a',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  tabButton: {
    alignItems: 'center',
    flex: 1,
    paddingVertical: 12,
  },
  tabText: {
    color: '#8e8e93',
    fontSize: 14,
  },
  tabTextActive: {
    color: '#0a84ff',
    fontWeight: '600',
  },
  visible: {
    flex: 1,
  },
});
