# react-native-synchronisdk
Synchroni sdk for react native

## Brief
Synchroni SDK is the software development kit for developers to access Synchroni products.

## Native layer

The native bridges are built on the SensorSDKCXX C++ SDK (flat C API,
`sen_capi`): Android ships `libsensor.so` + a C++ JNI glue
(`android/src/main/cpp/`), iOS links a static `sensor.xcframework` and
calls the C API from Objective-C++ (`ios/Synchronisdk.mm`). Prebuilt
artifacts are vendored under `third_party/sensorcxx/` — see
`AGENTS.md` ("Repository layout") for provenance and update steps.

## Migration notes (v1.1.1)

- **Breaking**: `SensorData.channelMask` now returns a **bigint** (the full
  uint64 mask, lossless for every channel bit) instead of a double. Numeric
  consumers must switch to bigint arithmetic (`mask & 1n`, `mask === 0n`);
  per-channel bit tests are unaffected — keep using `isChannelEnabled(ch)`.
- `BinFileInfo` gained the full capture metadata: `ConfigVersion`,
  `ChipType`, `IsUniversalStream`, `IsNewEmg`, `IsContainQat6`, `PpgModel`,
  `FeatureMap` / `NotifyDataFlag` (both bigint), and `SensorDatas`, one
  `BinSensorDataConfig` per recorded stream (its `channelMask` is a bigint
  too).
- `DeviceInfo` gained `EmgGain` / `EegGain` / `EcgGain` and
  `GestChannelCount` / `GestSampleRate`.

## Migration notes (v1.0.5)

- `SensorController.getParam(key)` / `SensorController.setParam(key, value)`
  are now **async** (`Promise<string>` resolving the SDK's answer string:
  `"OK"` / the value / `"Error: ..."`): the underlying capi v15 made the
  controller parameter channel asynchronous. Consecutive `setParam` calls
  keep their call order on the native side.
- `parseBinToCsv(binPath, csvPath)` no longer blocks while parsing (the
  promise contract is unchanged: resolves the CSV path, rejects on failure).

## Migration notes (v0.9.9)

Breaking changes versus v0.2.x. The public API was aligned with the
SensorSDKCXX language bindings (Python/C#/Qt demo), with no aliases kept:

- Renames on `SensorController`:
  - `onDeviceCallback` → `onScanResult`
  - `hasDeviceCallback` → `hasScanResultCallback`
  - `destroy()` → `terminate()`
  - `isScaning` → `isScanning` (spelling fix)
- Renames on `SensorProfile`:
  - `onStateChanged` → `onStateChange`
  - `onDataCallback` → `onSensorNotifyData`
  - `batteryPower()` → `getBatteryLevel()`
  - `deviceInfo()` → `fetchDeviceInfo()` (async GATT fetch; result is
    cached), plus a new synchronous `getDeviceInfo()` returning the cache
- Native `initALL` is renamed to `init` (aligned with the other language
  bindings) and resolves `true` on success / rejects on failure;
  `SensorProfile.init()` semantics are unchanged for callers. The legacy
  `doInitSensor` bridge call is gone: profiles are created lazily inside
  the native bridges, and `SensorProfile.init()` no longer retries — a
  single native `sen_profile_init` decides the result.
- `NativeSynchronisdk.getDeviceInfo(deviceMac)` dropped the `onlyMTU`
  parameter.
- `setParam` now **rejects** with the native error message on failure
  instead of always resolving.
- New APIs:
  - `SensorProfile.getParam(key)`, the `SensorProfile.autoReconnect` property
  - `SensorController.getSensors()`, `getVersion()`
  - Logging: `getParam(key)` / `setParam(key, value)` controller parameters
    (`"DEBUG_ENABLED"`, `"DATA_LOG_ENABLED"`, `"LOG_PATH"`,
    `"TRANSLATE_IMU"` — default on; when on, the IMU data of new-EMG
    devices arrives as the separate ACC/GYRO/EULER/QUAT streams, when off
    as the single aggregate NTF_IMU stream),
    `log(message, level)` (controller and profile variants)
  - Bin capture replay/parse: `getBinFileInfo(path)`, `replayBinFile(...)`,
    `pauseBinReplay(mac)`, `resumeBinReplay(mac)`, `stopBinReplay(mac)`,
    `parseBinToCsv(binPath, csvPath)`
- `DeviceInfo` grew the full C++ field set (PPG/SpO2/Quaternion/Euler/
  MagAngle/Impedance channel counts, per-stream sample rates, `IsMTUFine`).
- `SensorData` no longer marshals per-sample objects: `channelSamples` and
  `packageSampleCount` are gone, and `lostSamples` is renamed to
  `lostPackageCount` (C++ SDK parity). Views arrive as a `SensorData[]`
  list per native on_data callback (C++ `views/viewCount` parity; the
  device MAC travels once alongside the list, not per view). Each view is
  delivered over a JSI fast path
  (not the event emitter) as two **zero-copy ArrayBuffers** over the SDK's
  static per-stream storage: `samplesBuffer` views the sample arena and
  `infoBuffer` views the stream's static `sen_data_info_t`. Each
  `SensorData` in the list (aligned with the Python/C#
  bindings; the wire payload type is the internal `SensorDataPayload`) has
  the same access contract as the C++ SDK (`getData`, `getImpedance`,
  `getSaturation`, `getRawData`, `getSampleIndex`, `getTimeStampInMs`,
  `getAbsTimeStampInSec`, `isLost`, `isChannelEnabled`, `getChannelData`):
  the metadata getters (`dataType`, `lostPackageCount`, `sampleRate`,
  `channelCount`, `channelMask` (a bigint — lossless for every channel
  bit), `sampleCount`,
  `startTimeStamp`, `delay`,
  `startTimeSec`; `deviceMac`/`deviceName` are stamped once at stream
  creation and read through a cache) are LIVE reads
  through the borrowed Info (mirroring `SensorData::Info`, so
  `lostPackageCount`/`delay` updates stay visible); arena slots are
  rewritten by later batches, so `isDataValid(ch, i)` probes validity
  (batch-atomic — the no-arg `isDataValid()` decides the whole batch; a
  stream (re)start also invalidates every batch of the previous session via
  the view's `startTimeStamp` session tag),
  single-point accessors return 0 on rewritten or out-of-range slots
  (`isLost` returns false — the Android/iOS bindings' no-exception error
  model), `getChannelData` masks them with a fill value, and `clone()`
  copies both buffers into JS-owned memory that never goes stale and sees
  no later Info updates. Since the SDK's SensorData refactor the sample
  slot no longer stores an int-ms stamp: `getTimeStampInMs` is computed as
  `sampleIndex * 1000 / sampleRate` (0 when the rate is unknown), and the
  slot instead carries an LSL-style absolute timestamp read via
  `getAbsTimeStampInSec` (double seconds since the Unix epoch:
  `startTimeSec` + `delay/1000` + `sampleIndex/sampleRate`, 0 when the anchor is
  unknown). The `Sample` type is removed; `SensorData`
  (class) is exported instead.
- Android `minSdkVersion` is now 26 (required by the C++ BLE backend).

## Architecture & Protocol Reference

See [ARCHITECTURE_DIGEST.md](ARCHITECTURE_DIGEST.md) for a detailed analysis of the SDK covering:

- Layer architecture (JS → Native Bridge → closed-source BLE SDK)
- GATT service and characteristic UUIDs
- Full binary command/response packet formats for EEG, ECG, impedance, battery, and device info
- BLE connection sequence and data flow
- Known issues, architecture concerns, and React Native New Architecture alignment

## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)

## Installation

```sh
yarn add  @synchroni/synchroni_sdk_react_native
```

## 1. Permission 

Application will obtain bluetooth permission by itself.
There are builtin code in SensorController for Android. 

## 2. Import SDK

```js
import {
  SensorController,
  SensorProfile,
  SensorData,
  DeviceStateEx,
  DataType,
  type BLEDevice,
} from '@synchroni/synchroni_sdk_react_native';

```

# SensorController methods:
## 1. Initalize

```js
const SensorControllerInstance = SensorController.Instance;

//register scan listener
if (!SensorControllerInstance.hasScanResultCallback){
  SensorControllerInstance.onScanResult = (devices: BLEDevice[]) =>{
    //return all devices doesn't connected 
  };
}

//register bluetooth state listener (optional)
SensorControllerInstance.onEnableChanged = (enabled: boolean) => {
  //bluetooth adapter turned on/off; set undefined to unsubscribe
};

```

## 2. Start scan

Use `public async startScan(periodInMs: number): Promise<boolean>` to start scan
```js
const success = await SensorControllerInstance.startScan(6000)
```
returns true if start scan success, periodInMS means onScanResult will be called every periodInMS, the SDK clamps the period to [2000, 30000] ms (on Android a period below 6000 ms only logs a warning)

## 3. Stop scan

Use `public async stopScan(): Promise<void>` to stop scan
```js
await SensorControllerInstance.stopScan();
```
## 4. Check scanning

Use `public get isScanning(): boolean` to check scanning status
```js
const isScanning = SensorControllerInstance.isScanning;
```

## 5. Check if bluetooth is enabled

Use `public get isEnable(): boolean` to check if bluetooth is enabled
```js
const isEnable = SensorControllerInstance.isEnable;
```
## 6. Create SensorProfile

Use `public requireSensor(device: BLEDevice): SensorProfile | undefined` to create sensorProfile

If bleDevice is invalid, result is undefined
```js
const sensorProfile = SensorControllerInstance.requireSensor(bleDevice);
```

## 7. Get SensorProfile

Use `public getSensor(deviceMac: string): SensorProfile | undefined` to get sensorProfile

If SensorProfile didn't created, result is undefined
```js
const sensorProfile = SensorControllerInstance.getSensor(bleDevice.mac);
```

## 8. Get Connected SensorProfiles

Use `public getConnectedSensors(): SensorProfile[]` to get the ready (connected and inited) SensorProfiles
```js
const sensorProfiles = SensorControllerInstance.getConnectedSensors();
```

## 9. Get Connected BLE Devices

Use `public getConnectedDevices(): BLEDevice[]` to get connected BLE Devices
```js
const bleDevices = SensorControllerInstance.getConnectedDevices();
```

## 10. Terminate the controller

Use `public async terminate(): Promise<void>` to tear down the native BLE controller.

All sensor handles are invalidated; the singleton resets, so the next
`SensorController.Instance` access creates a fresh controller. Disconnect
sensors first if a clean shutdown matters.
```js
await SensorControllerInstance.terminate();
```

To shut down the **whole SDK** at application exit (all scans and
connections stop, SDK-wide resources are released, every handle — including
any created outside this instance — becomes invalid), use the synchronous
`terminateSdk()` (sen_capi v2+). The JS singleton resets the same way, and
the native SDK singleton is recreated lazily on the next use.

```js
SensorControllerInstance.terminateSdk();
```

`SensorControllerInstance.capiVersion` (sync getter, sen_capi v2+) returns
the loaded native library's `SEN_CAPI_VERSION`, so an app can detect a stale
vendored binary at runtime (both bridges also log a header/library mismatch
when the native controller is created).

## 11. Get all SensorProfiles

Use `public getSensors(): SensorProfile[]` to get every created SensorProfile
(connected or not).
```js
const allProfiles = SensorControllerInstance.getSensors();
```

## 12. Get SDK version

Use `public async getVersion(): Promise<string>` to get the native C++ SDK version.
```js
const version = await SensorControllerInstance.getVersion();
```

## 13. Logging controls

```js
await SensorControllerInstance.setParam('DEBUG_ENABLED', 'True');   // native debug log on/off
await SensorControllerInstance.setParam('DATA_LOG_ENABLED', 'True'); // raw BLE data log on/off
await SensorControllerInstance.setParam('LOG_PATH', '/abs/path/sensorsdklog_xxx');
// redirect the native log output; 'True' restores the default directory,
// 'False' (or '') disables file output. getParam(key) reads a value back:
await SensorControllerInstance.getParam('DEBUG_ENABLED'); // -> "True" / "False"
// both are async and resolve the SDK's answer string ("OK" / value /
// "Error: ..."); consecutive calls keep their call order.

SensorControllerInstance.log('started capture', 'I'); // app line in the SDK log
sensorProfile.log('marker', 'W'); // routed to the device's log channel
// level: 'D'/'I'/'W'/'E' (default 'I'); 'D' needs DEBUG_ENABLED=True
```

## 14. Bin capture replay / parse

The native SDK records raw BLE traffic to `.bin` files (see
`setParam("DEBUG_BLE_DATA_PATH", "True")`). A capture can be replayed
through the normal data pipeline or parsed offline to CSV.

```js
const info = await SensorControllerInstance.getBinFileInfo(binPath);
// info: { Mac, DeviceName, DurationSec, Valid, DeviceInfo, ConfigVersion,
//         ChipType, IsUniversalStream, IsNewEmg, IsContainQat6, PpgModel,
//         FeatureMap, NotifyDataFlag, SensorDatas, FirstDataTsMs,
//         LastDataTsMs }
// (DeviceInfo comes from the capture's first CONFIG record; zeroed when
// the file has no decodable config. FeatureMap/NotifyDataFlag and each
// SensorDatas entry's channelMask are bigint; every SensorDatas entry is
// { sampleRate, k, channelMask, dataType, typeIndex, channelCount,
//   packageIndexLength, resolutionBits, resolutionSigned, rawDataBias,
//   packageSampleCount, minPackageSampleCount }; FirstDataTsMs/LastDataTsMs
// are the wall-clock ms timestamps of the capture's first/last DATA
// record, 0 when the file has no DATA records)

// replay: the file behaves like a real device — a SensorProfile registered
// for info.Mac receives the usual state/data callbacks
const ok = await SensorControllerInstance.replayBinFile(
  binPath, info.Mac, /*realtime*/ true, /*timeoutMs*/ 30000
);
await SensorControllerInstance.pauseBinReplay(info.Mac);
await SensorControllerInstance.resumeBinReplay(info.Mac);
await SensorControllerInstance.stopBinReplay(info.Mac);

// offline full-speed parse to CSV
const csvPath = await SensorControllerInstance.parseBinToCsv(binPath, csvOutPath);
```

The CSV has a header row
`timestamp,mac,type,raw_hex,data_type,sample_rate,channel_count,lost_count,samples_info,first_sample`
and one row per record: `raw` (one captured packet), `cmd_send` /
`cmd_recv` (commands), `event` (connect / disconnect / stream_start /
stream_stop) and `parsed` (one decoded batch, with its data type, sample
rate, channel count, lost-package count and per-channel sample counts).

### Replay multiple bin files in sync (shared clock)

Use `multiReplayBinFile(paths, sensors, realtime?, timeoutMs?)` to replay
several captures on one shared clock aligned by record timestamps — the
earliest first data record across the group is t=0, so concurrently recorded
captures keep their original relative offsets. The target MAC is read from
each `SensorProfile`, and each member behaves like a single replay with the
usual callbacks.

```js
const started = await SensorControllerInstance.multiReplayBinFile(
  [binPath1, binPath2],
  [sensor1, sensor2],
  /*realtime*/ true,
  /*timeoutMs*/ 30000
);
// started: one entry per requested sensor (input order); null for a member
// that failed to start
```

Pausing or resuming any member applies to the whole group, so the alignment
is preserved; stopping works per device.

## 15. Synchronized start/stop on multiple devices

Use `multiStartDataNotification(profiles, timeoutMs?, maxDelayDispersionMs?, maxAttempts?)`
to start data notification on several devices at once. Every profile must be
Ready and inited. After each start round the SDK validates the dispersion
(max − min) of the devices' first-packet delays; if it exceeds
`maxDelayDispersionMs` (pass a negative value to skip the check), any device
produces no first packet in time, or any start fails, all devices are
stopped and the round retries (up to `maxAttempts`, default 3).

`multiStopDataNotification(profiles, timeoutMs?)` is the stop counterpart;
devices that are not streaming count as successful.

Both resolve one `MultiDeviceResult` (`{ mac, ok, error }`) per requested
profile — devices that fail validation do not prevent the others.

```js
const results = await SensorControllerInstance.multiStartDataNotification(
  [profile1, profile2],
  30000, // timeoutMs
  5,     // maxDelayDispersionMs
  3      // maxAttempts
);
// [{ mac: "AA:BB:CC:DD:EE:01", ok: true, error: "" }, ...]

await SensorControllerInstance.multiStopDataNotification([profile1, profile2]);
```

## 16. App background hook

Call the synchronous `onSuspend()` when the app moves to the background; it
lets the SDK checkpoint its open bin captures and pending logs so nothing
recorded so far is lost. Scanning, streaming and connections keep running.

```js
SensorControllerInstance.onSuspend();
```

# SensorProfile methods:

## 1. Initalize
Please register callbacks for SensorProfile
```js
let sensorProfile = SensorControllerInstance.requireSensor(bledevice);
//register callbacks
sensorProfile.onStateChange = (sensor: SensorProfile, newstate: DeviceStateEx) => {
    //please do logic when device disconnected unexpected
}

sensorProfile.onErrorCallback = (sensor: SensorProfile, reason: string) => {
    //called when error occurs
}

sensorProfile.onPowerChanged = (sensor: SensorProfile, power: number) => {
    //callback for get batter level of device, power from 0 - 100 (invalid readings are filtered out and never reach this callback)
}

sensorProfile.onDeviceInfoUpdate = (sensor: SensorProfile, info: DeviceInfo) => {
    //the cached device info changed after init (e.g. the negotiated link
    //parameters were updated, or the sample rate setting changed)
}

sensorProfile.onAutoReconnect = (sensor: SensorProfile, hasLastSession: boolean, answer: (takeover: boolean) => void) => {
    //fired when the link auto-reconnects; call answer(true) to take over
    //session recovery yourself, answer(false) for the SDK default — see the
    //"Auto reconnect and resume data stream" section
}

sensorProfile.onDataTransferStateChange = (sensor: SensorProfile, isTransferring: boolean) => {
    //authoritative stream on/off push: also fires on link loss and replay
    //EOF, and keeps isDataTransfering in sync
}

sensorProfile.onSensorNotifyData = (sensor: SensorProfile, dataList: SensorData[]) => {
    //called after start data transfer; each invocation delivers the whole
    //batch of SensorData objects parsed together (loop over it)
}
```

## 2. Connect device
Use `public async connect(): Promise<boolean>` to connect
```js
const success = await sensorProfile.connect();
```

## 3. Disconnect
Use `public async disconnect(): Promise<boolean>` to disconnect
```js
const success = await sensorProfile.disconnect();
```


## 4. Get device status
Use `public get deviceState(): DeviceStateEx` to get device status

Please send command in 'Ready' state, should be after connect() return true

```js
const deviceStateEx = sensorProfile.deviceState;

# deviceStateEx has define:
export enum DeviceStateEx {
  Disconnected,
  Connecting,
  Connected,
  Ready,
  Disconnecting,
  Invalid,
}
```

Use `public get isReady(): boolean` as a shortcut for "device is in 'Ready'
state".

```js
if (sensorProfile.isReady) {
  // safe to send commands
}
```



## 5. Get BLE device of SensorProfile
Use `public get BLEDevice(): BLEDevice` to BLE device of SensorProfile
```js
const bleDevice = sensorProfile.BLEDevice;
```

## 6. Get device info of SensorProfile
Use `public async fetchDeviceInfo(): Promise<DeviceInfo | undefined>` to fetch
device info over GATT (async). Call after the device is in 'Ready' state;
returns undefined if not connected/inited. The result is cached — use
`public getDeviceInfo(): DeviceInfo | undefined` for the cached value with no
GATT traffic. Caveat: on a cold cache the first `getDeviceInfo()` call kicks
off a background native fetch and returns undefined; the fetched value
arrives later via `onDeviceInfoUpdate` / the next `getDeviceInfo()` call.

```js
const deviceInfo = await sensorProfile.fetchDeviceInfo();
const cached = sensorProfile.getDeviceInfo();

# deviceInfo has defines:
export type DeviceInfo = {
  DeviceName: string;
  ModelName: string;
  HardwareVersion: string;
  FirmwareVersion: string;
  MTUSize: number;
  IsMTUFine: boolean;
  EmgChannelCount: number;
  EegChannelCount: number;
  EcgChannelCount: number;
  AccChannelCount: number;
  GyroChannelCount: number;
  BrthChannelCount: number;
  PpgChannelCount: number;
  Spo2ChannelCount: number;
  QuatChannelCount: number;
  EulerChannelCount: number;
  AngleChannelCount: number;
  ImpeChannelCount: number;
  EmgSampleRate: number;
  EegSampleRate: number;
  EcgSampleRate: number;
  AccSampleRate: number;
  GyroSampleRate: number;
  BrthSampleRate: number;
  PpgSampleRate: number;
  Spo2SampleRate: number;
  QuatSampleRate: number;
  EulerSampleRate: number;
  MagAngleSampleRate: number;
  ImpeSampleRate: number;
  EmgMaxSampleRate: number; // device-reported maximum sample rates
  EegMaxSampleRate: number; // (0 = not reported)
  EcgMaxSampleRate: number;
  ConnectionIntervalMs: number;  // negotiated BLE link parameters
  PeripheralLatency: number;     // (0 / -1 / 0 = unknown)
  SupervisionTimeoutMs: number;
  EmgGain: number;
  EegGain: number;
  EcgGain: number;
  GestChannelCount: number; // gesture stream (0 = no gesture capability)
  GestSampleRate: number;
  Backend: string; // BLE backend the link runs on ("" = unknown)
};
```

Use `onDeviceInfoUpdate` to get notified when the cached DeviceInfo changes
after init — e.g. the link parameters are updated shortly after connect, or
`EEG_SAMPLE_RATE` changes the reported rates.


## 7. Init data transfer
Use `public async init(packageSampleCount: number, powerRefreshInterval: number, timeout: number = 10000): Promise<boolean>`.

Please call after device in 'Ready' state, return true if init succeed
```js
const success = await sensorProfile.init(5, 60*1000);
```
packageSampleCount:   set sample counts per channel of each SensorData batch in onSensorNotifyData()
powerRefreshInterval: callback period for onPowerChanged()

## 8. Check if init data transfer succeed
Use `public get hasInited(): boolean` to check if init data transfer succeed
```js
const hasInited = sensorProfile.hasInited;
```

## 9. DataNotify
Use `public async startDataNotification(): Promise<boolean>` to start data notification.

Please call if hasInited() return true
### 9.1 Start data transfer

```js
const success = await sensorProfile.startDataNotification();
```

Data type list：

```js
export enum DataType {
  NTF_ACC = 0x1,          //unit is g
  NTF_GYRO = 0x2,         //unit is degree/s
  NTF_MAG = 0x3,
  NTF_EULER = 0x4,        //unit is degree
  NTF_QUAT = 0x5,
  NTF_ROTA = 0x6,
  NTF_EMG_GEST = 0x7,     //gesture result
  NTF_EMG_ADC = 0x8,      //unit is uV
  NTF_HID_MOUSE = 0x9,
  NTF_HID_JOYSTICK = 0xa,
  NTF_DEV_STATUS = 0xb,
  NTF_LOG = 0xc,
  NTF_ANGLE = 0xd,
  NTF_MOT_CURRENT = 0xe,
  NTF_NEUCIR_STATUS = 0xf,
  NTF_EEG = 0x10,         //unit is uV
  NTF_ECG = 0x11,         //unit is uV
  NTF_IMPEDANCE = 0x12,
  NTF_IMU = 0x13,         //aggregate: acc 0-2, gyro 3-5, euler 6-8, quat 9-12
  NTF_ADS = 0x14,
  NTF_BRTH = 0x15,        //unit is uV
  NTF_IMPEDANCE_EXT = 0x16,
  NTF_SPO2_HR = 0x17,
  NTF_PPG = 0x18,
}
```

Process data in onSensorNotifyData. The callback receives a `SensorData[]`
— the whole view list of one native on_data callback (C++ `views/viewCount`
parity). Each `SensorData` is a zero-copy view into the SDK's static
per-stream storage (sample arena + `sen_data_info_t`), with the same access
contract as the C++ SDK. The
metadata getters are live reads through the borrowed Info
(`lostPackageCount`/`delay` keep updating); arena slots are rewritten by
later batches: probe with `isDataValid` (single-point accessors return 0
on stale/out-of-range slots, `isLost` returns false — no exceptions), or
`clone()` batches you keep (clone copies both buffers and sees no later
Info updates).

```js
    sensorProfile.onSensorNotifyData = (sensor: SensorProfile, dataList: SensorData[]) => {
      for (const data of dataList) {
        if (data.dataType === DataType.NTF_EEG) {

        } else if (data.dataType === DataType.NTF_ECG) {

        }

        // metadata: data.channelCount / data.sampleCount / data.sampleRate
        //           data.channelMask / data.startSampleIndex / data.lostPackageCount
        //           data.startTimeStamp / data.delay / data.startTimeSec
        //           data.deviceMac / data.deviceName (stamped once, cached)
        for (let ch = 0; ch < data.channelCount; ch++) {
          // whole channel at once; stale (arena-rewritten) slots read 0:
          const values = data.getChannelData(ch);
          // ...draw values

          // or single-point access:
          for (let i = 0; i < data.sampleCount; i++) {
            if (!data.isDataValid(ch, i)) {
              // slot rewritten by a later batch (or the stream restarted) — skip
            } else {
              // data.getData(ch, i), data.getSampleIndex(ch, i),
              // data.getImpedance(ch, i), data.getSaturation(ch, i),
              // data.getRawData(ch, i), data.getTimeStampInMs(ch, i),
              // data.getAbsTimeStampInSec(ch, i)
              // (these return 0 on stale or out-of-range slots — the
              // isDataValid guard above tells real zeros from stale ones)
            }
          }
        }

        // keep a batch across later callbacks (copies into JS-owned memory):
        const kept = data.clone();
      }
    };
```

### 9.2 Stop data transfer
Use `public async stopDataNotification(): Promise<boolean>` to stop data transfer
```js
const success = await sensorProfile.stopDataNotification();
```

### 9.3 Check if it's data transfering
Use `public get isDataTransfering(): boolean` to check if it's data transfering
```js
const isDataTransfering = sensorProfile.isDataTransfering; 
```

## 10. Get battery level
Use `public async getBatteryLevel(): Promise<number>` to get battery level. Please call after device in 'Ready' state

```js
const batteryLevel = await sensorProfile.getBatteryLevel();

// batteryLevel ranges from 0 to 100, 0 means out of battery, while 100 means full.
```

The promise rejects with `Error('getBatteryLevel: no battery reading
available')` when no reading arrives within the 10 s budget; during
non-Ready states it resolves the last cached reading instead.

### getParam method

Use `public async getParam(key: string): Promise<string>` to read a parameter
of the sensor profile. Please call after device in 'Ready' state.

Supported aggregate query keys:

```js
const ntf = await sensorProfile.getParam("NTF");
// all notification states, pipe-separated, e.g. "NTF_EEG|ON|NTF_EMG|OFF|..."

const filter = await sensorProfile.getParam("FILTER");
// all filter states, e.g. "FILTER_50HZ|ON|FILTER_60HZ|ON|FILTER_HPF|ON|FILTER_LPF|ON"

const rate = await sensorProfile.getParam("EEG_SAMPLE_RATE");
// current EEG/ECG sample rate in Hz, e.g. "250"

const rates = await sensorProfile.getParam("EEG_SAMPLE_RATE_LIST");
// device-reported selectable EEG/ECG rates, e.g. "250|500";
// "Error: Not supported" when the device did not report a capability

// EMG / IMU / PPG rates work the same way on devices that support them:
// getParam("EMG_SAMPLE_RATE") / getParam("EMG_SAMPLE_RATE_LIST"),
// getParam("IMU_SAMPLE_RATE") / getParam("IMU_SAMPLE_RATE_LIST"),
// getParam("PPG_SAMPLE_RATE") / getParam("PPG_SAMPLE_RATE_LIST")

const logPath = await sensorProfile.getParam("DEBUG_LOG_PATH");
// current per-profile log file path ("" when disabled)
```

If the key is not supported, the result starts with `"Error"`.

### setParam method

Use `public async setParam(key: string, value: string): Promise<string>` to set parameter of sensor profile. Please call after device in 'Ready' state.

If the device is already streaming when you change an `NTF_*`, `FILTER_*` or
sample-rate key, the SDK restarts the data notification so the new setting
takes effect immediately.

Below is available key and value:

```js
// Data stream toggles: set the stream to ON or OFF, result is "OK" if succeed
result = await sensorProfile.setParam("NTF_EMG", "ON")
result = await sensorProfile.setParam("NTF_EEG", "ON")
result = await sensorProfile.setParam("NTF_ECG", "ON")
result = await sensorProfile.setParam("NTF_IMU", "ON")   // aggregated acc/gyro/euler/quat stream
result = await sensorProfile.setParam("NTF_BRTH", "ON")
result = await sensorProfile.setParam("NTF_GEST", "ON")  // gesture result; on legacy EMG
                                                         // devices NTF_GEST and NTF_EMG are
                                                         // mutually exclusive
result = await sensorProfile.setParam("NTF_IMPEDANCE", "ON")
result = await sensorProfile.setParam("NTF_PPG", "ON")
result = await sensorProfile.setParam("NTF_SPO2", "ON")

// Firmware filter toggles
result = await sensorProfile.setParam("FILTER_50HZ", "ON")
// set 50Hz notch filter to ON or OFF, result is "OK" if succeed

result = await sensorProfile.setParam("FILTER_60HZ", "ON")
// set 60Hz notch filter to ON or OFF, result is "OK" if succeed

result = await sensorProfile.setParam("FILTER_HPF", "ON")
// set 0.5Hz hpf filter to ON or OFF, result is "OK" if succeed

result = await sensorProfile.setParam("FILTER_LPF", "ON")
// set 80Hz lpf filter to ON or OFF, result is "OK" if succeed

// EEG/ECG sample rate (bound together on devices that have both)
result = await sensorProfile.setParam("EEG_SAMPLE_RATE", "500")
// the value must be one of the device-reported selectable rates (see
// getParam("EEG_SAMPLE_RATE_LIST")); an unsupported value returns an
// "Error: ..." string

// EMG sample rate (new EMG devices only); validated against
// getParam("EMG_SAMPLE_RATE_LIST")
result = await sensorProfile.setParam("EMG_SAMPLE_RATE", "500")

// IMU sample rate (only devices answering the extended IMU capability
// query); validated against getParam("IMU_SAMPLE_RATE_LIST")
result = await sensorProfile.setParam("IMU_SAMPLE_RATE", "100")

// PPG sample rate (PPG devices only); validated against
// getParam("PPG_SAMPLE_RATE_LIST")
result = await sensorProfile.setParam("PPG_SAMPLE_RATE", "50")

// NeuCir remote control (NeuCir devices only)
result = await sensorProfile.setParam("NEUCIR_SET_MODE", "APP_REMOTE")
result = await sensorProfile.setParam("NEUCIR_APP_CONTROL", "OPEN")   // OPEN / CLOSE / STOP

result = await sensorProfile.setParam("DEBUG_BLE_DATA_PATH", "d:/temp/test.bin")
//# set the bin export path, result is "OK" if succeed;
// "True" exports to {DeviceName}_data_YYYYMMDD_HHMMSS.bin in the SDK log
// directory (see the "LOG_PATH" controller parameter), "False" or ""
// disables the export.
// please give an absolute path and make sure it is valid and writeable by yourself

result = await sensorProfile.setParam("DEBUG_LOG_PATH", "True")
// enable this profile's own log file ({DeviceName}_log_YYYYMMDD_HHMMSS.txt
// in the SDK log directory), or pass an absolute custom path instead of
// "True"; "False" or "" disables it
```

setParam rejects with the native error message when the parameter is
unknown or the write fails — wrap it in try/catch.

### Auto reconnect and resume data stream

The `sensorProfile.autoReconnect` property (enabled by default) controls
both automatic link reconnection and session recovery after an abnormal
disconnect. Assign `false` to cancel pending reconnection and recovery and to
prevent later automatic reconnection while disabled; `isReconnecting` becomes
`false` and stays false while the switch is disabled. While enabled and the
device was streaming, the SDK automatically reconnects, re-runs `init()` with
the previous arguments, re-applies the `setParam` values from the previous
streaming session (in the order they were set) and restarts the data
notification. Recovery progress is reported through `onStateChange`. Explicit
user calls (`connect()`, `disconnect()`, `stopDataNotification()`) cancel a
pending resume.

```js
sensorProfile.autoReconnect = false; // opt out
```

Reading the property resolves the current flag value
(`Promise<boolean>`; enabled by default); the promise rejects when the
device is unknown to the SDK.

```js
const enabled = await sensorProfile.autoReconnect;
```

**Custom recovery via `onAutoReconnect`**: setting this callback makes the
app take over recovery — the SDK's default flow is skipped and the callback
decides what happens.

```js
sensorProfile.onAutoReconnect = (sensor, hasLastSession, answer) => {
  // hasLastSession=true  -> a previous session exists (init args + setParam
  //                         values can be preserved and restored)
  // answer(true)  -> the app handled recovery itself; the SDK skips its
  //                  default recovery (re-run init()/startDataNotification()
  //                  on the next Ready)
  // answer(false) -> fall back to the default flow
  answer(true); // call answer exactly once; it may be called later
};
```

The answer is asynchronous: if no answer arrives within 10 seconds the SDK
falls back to its default recovery. Clearing the handler restores the
default behavior. A handler cannot override a disabled `autoReconnect`
switch. Apps that take over recovery must also stop their own connect/init/
parameter/stream recovery chain when the switch becomes false; ordinary
manual connections remain available while automatic recovery is disabled.

Filter Behavor on different devices:

For EEG devices, when power on, default filter is 50Hz notch filter ON , 60Hz notch filter ON, 0.5Hz hpf filter ON and 80Hz lpf filter ON.

For EMG devices, when power on, default filter is 50Hz notch filter ON , 60Hz notch filter ON, 10Hz hpf filter ON and 200Hz lpf filter ON.

For Breath Belt devices, when power on, default filter is 50Hz notch filter ON , 60Hz notch filter ON, 0.5Hz hpf filter OFF and 80Hz lpf filter ON.

Filter setting will be reset to default after reboot.

## Example app

The `example/` app demonstrates the full SDK workflow on three tabs
(Devices / Waveforms / Bio):

- **Devices** — scan, connect, and manage sensors. The device list keeps a
  connected device visible with its current state (connected / streaming)
  even though it no longer shows up in scan results, and a device that
  drops out of the scan is removed only after it has stayed missing for a
  few seconds — a brief dropout does not make its row flicker.
- **Waveforms** — live signal plotting with data-rate and packet-loss
  stats.
- **Bio** — per-channel signal views with gesture and impedance readouts.

The app also supports toggling the device's filters and notification
channels, recording and replaying `.bin` captures, and automatic session
recovery after an unexpected disconnect.

See `example/README.md` for how to run it.
