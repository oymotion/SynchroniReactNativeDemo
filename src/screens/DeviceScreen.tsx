import React from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {
  BLEDevice,
  DeviceInfo,
} from '@synchroni/synchroni_sdk_react_native';
import { DeviceStateEx } from '@synchroni/synchroni_sdk_react_native';
import { Checkbox, DemoButton, useDemoVersion } from '../components/common';
import {
  DemoController,
  FILTER_OPTIONS,
  NTF_OPTIONS,
  SAMPLE_RATE_CONTROLS,
} from '../demo/DemoController';

/** Channel count backing each NTF toggle (GESTURE shares EMG's). */
function ntfChannelCount(key: string, info: DeviceInfo): number {
  switch (key) {
    case 'NTF_EEG':
      return info.EegChannelCount;
    case 'NTF_IMPEDANCE':
      return info.ImpeChannelCount;
    case 'NTF_EMG':
    case 'NTF_GEST':
      return info.EmgChannelCount;
    case 'NTF_PPG':
      return info.PpgChannelCount;
    case 'NTF_SPO2':
      return info.Spo2ChannelCount;
    case 'NTF_IMU':
      return info.AccChannelCount + info.GyroChannelCount;
    case 'NTF_ANGLE':
      return info.AngleChannelCount;
    default:
      return 0;
  }
}

export default function DeviceScreen({ visible }: { visible: boolean }) {
  const controller = DemoController.Instance;
  useDemoVersion(visible);

  const active = controller.getActiveState();
  const info = active?.info;
  const ready = active?.profile.isReady ?? false;
  const realConnected = controller.hasRealDeviceConnected();
  const selectedState = controller.selectedMac
    ? controller.deviceStates.get(controller.selectedMac)
    : undefined;
  const selectedReady = selectedState?.profile.isReady ?? false;
  const canDisconnect =
    selectedState !== undefined &&
    selectedState.profile.deviceState !== DeviceStateEx.Disconnected;

  const renderDevice = ({ item }: { item: BLEDevice }) => {
    const st = controller.deviceStates.get(item.Address);
    const connected = st?.profile.isReady ?? false;
    const selected = controller.selectedMac === item.Address;
    return (
      <TouchableOpacity onPress={() => controller.selectDevice(item.Address)}>
        <Text style={[styles.listRow, selected && styles.listRowSelected]}>
          {/* [Streaming] marks a device whose data stream is currently on */}
          {st?.streaming ? '[Streaming] ' : connected ? '[Connected] ' : ''}
          {`RSSI: ${item.RSSI}, Name: ${item.Name}, Address: ${item.Address}`}
        </Text>
      </TouchableOpacity>
    );
  };

  const gesture = active?.gesture;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.status}>{controller.status}</Text>
      <Text style={styles.rate}>{controller.rateText}</Text>
      <Text style={styles.rate}>SDK: {controller.sdkVersion || '--'}</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>Model: {info?.ModelName ?? '--'}</Text>
        <Text style={styles.infoText}>
          HW Version: {info?.HardwareVersion ?? '--'}
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>
          FW Version: {info?.FirmwareVersion ?? '--'}
        </Text>
        <Text style={styles.infoText}>
          Power: {active?.power !== undefined ? `${active.power}%` : '--%'}
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>
          Link:{' '}
          {info && info.PeripheralLatency >= 0 && info.ConnectionIntervalMs > 0
            ? `${info.ConnectionIntervalMs}ms / latency ${info.PeripheralLatency} / timeout ${info.SupervisionTimeoutMs}ms`
            : '--'}
        </Text>
        <Text style={styles.infoText}>
          MTU: {info && info.MTUSize > 0 ? info.MTUSize : '--'}
        </Text>
      </View>

      <Checkbox
        label="Auto Reconnect"
        checked={controller.autoReconnect}
        onToggle={(enabled) => {
          controller.autoReconnect = enabled;
        }}
      />
      <Checkbox
        label="Use Worklets (off-thread DSP)"
        checked={controller.useWorklets}
        onToggle={controller.setUseWorklets}
      />
      <Checkbox
        label="Clone Data (worklets DSP)"
        checked={controller.cloneData}
        onToggle={controller.setCloneData}
      />

      <FlatList
        style={styles.deviceList}
        data={controller.devices}
        keyExtractor={(item) => item.Address}
        renderItem={renderDevice}
        scrollEnabled={false}
        ListEmptyComponent={<Text style={styles.listRow}>No devices</Text>}
      />

      <View style={styles.buttonRow}>
        <DemoButton
          title="Start Scan"
          onPress={() => controller.startScanning()}
          disabled={controller.scanning}
        />
        <DemoButton
          title="Stop Scan"
          onPress={() => controller.stopScanning()}
          disabled={!controller.scanning}
        />
        <DemoButton
          title="Connect"
          onPress={() => controller.connectSelected()}
          disabled={!controller.selectedMac || selectedReady}
        />
        <DemoButton
          title="Disconnect"
          onPress={() => controller.disconnectSelected()}
          disabled={!canDisconnect}
        />
        <DemoButton
          title="Multi Start"
          onPress={() => controller.multiStart()}
        />
        <DemoButton title="Multi Stop" onPress={() => controller.multiStop()} />
      </View>

      <Text style={styles.groupTitle}>Bin Replay</Text>
      <View style={styles.buttonRow}>
        <DemoButton
          title="Replay Bin…"
          onPress={() => controller.pickAndReplayBin()}
          disabled={realConnected || controller.replayActive()}
        />
        <DemoButton
          title="Multi Replay Bin…"
          onPress={() => controller.pickAndMultiReplayBins()}
          disabled={realConnected || controller.replayActive()}
        />
        <DemoButton
          title="Analyze Bin…"
          onPress={() => controller.pickAndAnalyzeBin()}
          disabled={realConnected}
        />
        <DemoButton
          title={controller.replayPaused ? 'Resume Replay' : 'Pause Replay'}
          onPress={() => controller.pauseResumeReplay()}
          disabled={!controller.replayActive()}
        />
        <DemoButton
          title="Stop Replay"
          onPress={() => controller.stopReplay()}
          disabled={!controller.replayActive()}
        />
        {__DEV__ && (
          <>
            {/* DEV ONLY: memory-soak helpers (direct bin replay,
                auto-restart loop). */}
            <DemoButton
              title="DBG Replay Latest"
              onPress={() => controller.debugReplayLatestBin()}
              disabled={realConnected || controller.replayActive()}
            />
            <DemoButton
              title={
                controller.debugReplayLoop ? '[x] DBG Loop' : '[ ] DBG Loop'
              }
              onPress={() => controller.toggleDebugReplayLoop()}
            />
          </>
        )}
      </View>

      <Text style={styles.groupTitle}>Debug Log</Text>
      <View style={styles.buttonRow}>
        <Checkbox
          label="Enable SDK Debug Log"
          checked={controller.debugLogEnabled}
          onToggle={controller.setDebugLogEnabled}
        />
        <Checkbox
          label="Enable Debug Bin Data"
          checked={controller.binDataEnabled}
          onToggle={controller.setBinDataEnabled}
        />
        <Checkbox
          label="Translate IMU (split ACC/GYRO/EULER/QUAT)"
          checked={controller.translateImu}
          onToggle={controller.setTranslateImu}
        />
      </View>

      <Text style={styles.groupTitle}>Data Notification</Text>
      <View style={styles.buttonRow}>
        {NTF_OPTIONS.filter(
          (o) => !info || ntfChannelCount(o.key, info) > 0
        ).map((o) => (
          <Checkbox
            key={o.key}
            label={o.label}
            checked={controller.ntfStates[o.key] ?? false}
            disabled={!ready}
            onToggle={(on) => controller.setNtfEnabled(o.key, on)}
          />
        ))}
      </View>

      <Text style={styles.groupTitle}>Filter</Text>
      <View style={styles.buttonRow}>
        {FILTER_OPTIONS.map((o) => (
          <Checkbox
            key={o.key}
            label={o.label}
            checked={controller.filterStates[o.key] ?? false}
            disabled={!ready}
            onToggle={(on) => controller.setFilterEnabled(o.key, on)}
          />
        ))}
      </View>

      {SAMPLE_RATE_CONTROLS.map((control) => {
        const options = controller.sampleRateOptions[control.key] ?? [];
        // Hidden until the device reports its candidates.
        const usable = control.candidates.filter((rate) =>
          options.includes(rate)
        );
        if (usable.length === 0) {
          return null;
        }
        return (
          <View key={control.key}>
            <Text style={styles.groupTitle}>{control.label}</Text>
            <View style={styles.buttonRow}>
              {usable.map((rate) => (
                <Checkbox
                  key={rate}
                  label={`${rate}Hz`}
                  checked={
                    (controller.sampleRateCurrent[control.key] ?? 0) === rate
                  }
                  disabled={!ready}
                  onToggle={(on) => {
                    if (on) {
                      controller.setSampleRate(control.key, rate);
                    }
                  }}
                />
              ))}
            </View>
          </View>
        );
      })}

      <Text style={styles.groupTitle}>Packet Loss Stats</Text>
      <Text style={styles.rate}>{controller.lostText}</Text>

      <Text style={styles.groupTitle}>Gesture</Text>
      <View style={styles.gestureBox}>
        <Text style={styles.gestureText}>
          gesture (0-8): {gesture ? String(gesture.gesture) : '-'}
        </Text>
        <Text style={styles.gestureText}>
          raw gesture (0-8): {gesture ? gesture.rawGesture : '-'}
        </Text>
        <Text style={styles.gestureText}>
          possiblity (0-100): {gesture ? String(gesture.possibility) : '-'}
        </Text>
        <Text style={styles.gestureText}>
          strength (0-100): {gesture ? String(gesture.strength) : '-'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: 4,
  },
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  content: {
    padding: 8,
    paddingBottom: 32,
  },
  deviceList: {
    backgroundColor: '#1c1c1e',
    borderRadius: 4,
    flexGrow: 0,
    marginVertical: 4,
    maxHeight: 160,
  },
  gestureBox: {
    backgroundColor: '#1c1c1e',
    borderRadius: 4,
    padding: 8,
  },
  gestureText: {
    color: '#e5e5ea',
    fontFamily: 'monospace',
    fontSize: 12,
    paddingVertical: 1,
  },
  groupTitle: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoText: {
    color: '#c8c8cc',
    fontSize: 12,
    paddingVertical: 1,
  },
  listRow: {
    color: '#e5e5ea',
    fontFamily: 'monospace',
    fontSize: 11,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  listRowSelected: {
    backgroundColor: '#0a84ff',
    color: '#ffffff',
  },
  rate: {
    color: '#8e8e93',
    fontFamily: 'monospace',
    fontSize: 11,
    paddingVertical: 2,
  },
  status: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 2,
  },
});
