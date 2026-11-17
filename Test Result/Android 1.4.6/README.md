# Synchroni React Native SDK 测试用例（总览）

本目录针对 **Synchroni React Native SDK**（npm 包 `@synchroni/synchroni_sdk_react_native@1.4.6`，
Demo 工程 `SynchroniReactNativeDemo`，React Native 0.86.2 / React 19.2.3），按模块拆分用例文件，
覆盖 SDK 全部对外接口，覆盖正向 / 反向 / 边界 / 异常，并额外覆盖**平板系统异常**（蓝牙开关、WiFi 开关、
消息/来电打断、前后台切换、锁屏、旋转、分屏、权限等）。

用例格式对齐 Python `Test Cases/Manual Cases/` 风格，统一标注：优先级、测试目的、平台、设备相关、
流程与逻辑、预期结果、有效性说明、可自动化、人工介入、测试结果。

## 一、目标与范围

- **接口全覆盖**：`SensorController`（单例）、`SensorProfile`、`SensorData`、`DeviceStateEx`/`DataType` 枚举、
  `BLEDevice`/`DeviceInfo`/`BinFileInfo`/`MultiDeviceResult` 等类型。每个接口至少「1 正向 + 1 边界/异常」。
- **双端通用，不强求**：所有用例默认「通用」；与平台强相关的（系统异常、权限、后端）显式标注
  `Android` / `iOS`，其中 iOS 无法程序化切换蓝牙/WiFi 的用例标注 `Android(程序化) + iOS(人工)`。
- **设备能力不硬编码**：能力一律运行时用 `fetchDeviceInfo()/getDeviceInfo()` 判定（`ChannelCount > 0` 才测，
  否则记「设备不支持，跳过」）。设备相关用例在「设备相关」字段显式标注所需能力。

## 二、SDK 版本与接口快照

- SDK：`@synchroni/synchroni_sdk_react_native@1.4.6`（底层原生 `capiVersion` 与 `getVersion()` 以实测为准）。
- 与 Python 侧语义一致，但有以下 **RN 特有/命名差异**，写用例时注意：

| 项 | Python | React Native |
|----|--------|--------------|
| 控制器 | 单例 `SensorControllerInstance` | 单例 `SensorController.Instance` |
| 扫描 | `scan/asyncScan/startScan/stopScan` | `startScan/stopScan/scanOnce` |
| 扫描回调 | `onDeviceFoundCallback` | `onScanResult`（推送整表） |
| 扫描状态回调 | 无 | `onScanStateChange(isScanning, errorMsg)` |
| 蓝牙使能回调 | `onEnableCallback` | `onEnableChanged(enabled)` |
| 后端 | `getBLEBackendName()` | 控制器 `getParam("BACK_END")` |
| 状态机 | `DeviceState` | `DeviceStateEx`（Disconnected/Connecting/Connected/Ready/Disconnecting/Invalid） |
| 手势流 | `NTF_GEST` | `NTF_EMG_GEST`（0x7） |
| 肌电流 | `NTF_EMG` | `NTF_EMG_ADC`（0x8） |
| 角度流 | `NTF_MAG_ANGLE_DATA` | `NTF_ANGLE`（0xd） |
| 磁力计 | 无独立枚举 | `NTF_MAG`（0x3，无独立开关） |
| SpO2 流 | `NTF_SPO2` | `NTF_SPO2_HR`（0x17） |
| 数据访问 | `getData/getRawData/getChannelSample/as_numpy` | `getData/getRawData/getChannelData/getChannelIndex/...` |
| 采样率/丢包等 | 同语义 | 同语义（`sampleRate/lostPackageCount/sampleCount/...`） |
| 回放暂停/恢复 | `pauseBinReplay/resumeBinReplay` | 同名 |
| 控制器参数 | 无 | `getParam/setParam`（DEBUG_ENABLED/DATA_LOG_ENABLED/LOG_PATH/BACK_END） |
| App 挂起 | 无 | `onSuspend()` |
| 整体销毁 | `terminate()` | `terminate()` + `terminateSdk()` |
| 多设备同步 | `multiStart/multiStop/multiReplayBinFile` | 同名（`MultiDeviceResult[]` / `(SensorProfile|null)[]`） |

## 三、接口覆盖矩阵（覆盖率追踪）

| 类 | 接口 | 正向用例 | 边界/异常用例 |
|----|------|----------|---------------|
| SensorController | `Instance` / `isScanning` / `hasScanResultCallback` | CTRL-FUNC-001/004/015 | — |
| SensorController | `isEnable` / `onEnableChanged` | CTRL-FUNC-002/003 | SYS-ROB-001 |
| SensorController | `startScan` / `stopScan` / `scanOnce` | CTRL-FUNC-004/005/006 | CTRL-BND-001/004、CTRL-ROB-001/002 |
| SensorController | `onScanResult` | CTRL-FUNC-007/008 | CTRL-ROB-002 |
| SensorController | `onScanStateChange` | CTRL-FUNC-021 | CTRL-ROB-004 |
| SensorController | `requireSensor` / `getSensor` / `getSensors` | CTRL-FUNC-009/010/011 | CTRL-BND-002/003、MISC-BND-003 |
| SensorController | `getConnectedSensors` / `getConnectedDevices` | CTRL-FUNC-012 | — |
| SensorController | `getVersion` / `capiVersion` | CTRL-FUNC-013/014 | MISC-FUNC-004 |
| SensorController | `getParam` / `setParam`（控制器） | CTRL-FUNC-016/017 | CTRL-BND-005/006、PARAM-FUNC-007/008 |
| SensorController | `log` | LOG-FUNC-001 | LOG-ROB-001/002 |
| SensorController | `getBinFileInfo` / `replayBinFile` / `pause` / `resume` / `stop` / `parseBinToCsv` | BIN-FUNC-001~007 | BIN-BND-001~004、BIN-ROB-001~003 |
| SensorController | `multiStartDataNotification` / `multiStopDataNotification` | MULTI-FUNC-001/002 | MULTI-BND-001/002、MULTI-ROB-001 |
| SensorController | `multiReplayBinFile` | MULTI-FUNC-003 | MULTI-BND-003、MISC-BND-005 |
| SensorController | `onSuspend` | MISC-FUNC-005、SYS-ROB-009 | — |
| SensorController | `terminate` / `terminateSdk` | CTRL-FUNC-019/020 | MISC-BND-006 |
| SensorProfile | `connect` / `disconnect` | DEV-SM-001/004 | DEV-SM-002/005/006、SYS-ROB-002 |
| SensorProfile | 状态属性 `deviceState/isReady/hasInited/isAutoReconnecting/isDataTransfering` | DEV-SM-003/008 | DEV-SM-002 |
| SensorProfile | `init` | DATA-FUNC-001 | DATA-FUNC-002、DATA-BND-001/002/003、MISC-BND-001 |
| SensorProfile | `startDataNotification` / `stopDataNotification` | DATA-FUNC-003/004 | DATA-ROB-*、SYS-ROB-002 |
| SensorProfile | `getBatteryLevel` / `onPowerChanged` | BATT-FUNC-001/002/004 | BATT-FUNC-003 |
| SensorProfile | `fetchDeviceInfo` / `getDeviceInfo` | MISC-FUNC-001/002/003 | MISC-BND-002 |
| SensorProfile | `setParam` / `getParam` | PARAM-FUNC-001~011 | PARAM-BND-001~005、PARAM-ROB-001/002 |
| SensorProfile | `autoReconnect`（get/set）/ `onAutoReconnect` | DEV-SM-009/010/011/013/014 | DEV-SM-012/015、ASYNC-ROB-002 |
| SensorProfile | `onDataTransferStateChange` | DEV-SM-016 | SYS-ROB-002 |
| SensorProfile | `onStateChange` / `onErrorCallback` | DEV-SM-007/017 | DEV-SM-017 |
| SensorProfile | `useWorkletRuntime` | ASYNC-FUNC-004 | ASYNC-ROB-003 |
| SensorProfile | `log` | LOG-FUNC-002 | LOG-ROB-001/002 |
| SensorData | 元数据 getter（`dataType/sampleRate/channelCount/sampleCount/channelMask/startTimeStamp/delay/startTimeSec/deviceMac/deviceName/startSampleIndex/ownsSamples/lostPackageCount`） | DATA-FUNC-005/006/007/016 | MISC-BND-004 |
| SensorData | `getData/getRawData/getImpedance/getSaturation/isLost` | DATA-FUNC-008/015 | DATA-BND-004/005 |
| SensorData | `getChannelData` | DATA-FUNC-009 | DATA-BND-006 |
| SensorData | `isDataValid` / `isChannelEnabled` | DATA-FUNC-011/013 | DATA-BND-007 |
| SensorData | `getTimeStampInMs` / `getAbsTimeStampInSec` / `getChannelIndex` / `getSampleIndex` | DATA-FUNC-012/016 | — |
| SensorData | `clone` | DATA-FUNC-010 | — |

## 四、文件索引

| 文件 | 内容 |
|------|------|
| [01_控制器与扫描.md](./01_控制器与扫描.md) | `CTRL-*`：单例、扫描、requireSensor、getSensor、版本、后端、terminate |
| [02_连接与状态机.md](./02_连接与状态机.md) | `DEV-SM-*`：连接、断连、重连、状态迁移、autoReconnect |
| [03_数据流.md](./03_数据流.md) | `DATA-*`：init、起/停流、SensorData 访问器 |
| [04_参数.md](./04_参数.md) | `PARAM-*`：profile/controller 的 setParam/getParam |
| [05_多设备同步.md](./05_多设备同步.md) | `MULTI-*`：同步起流/停流、多 bin 回放 |
| [06_Bin录制回放解析.md](./06_Bin录制回放解析.md) | `BIN-*`：getBinFileInfo、回放、暂停/恢复/停止、CSV |
| [07_电量日志调试.md](./07_电量日志调试.md) | `BATT-*` / `LOG-*`：电量、日志 |
| [08_系统异常.md](./08_系统异常.md) | `SYS-*`：蓝牙/WiFi 开关、飞行模式、消息/来电打断、前后台、锁屏、旋转、分屏、权限 |
| [09_异步接口.md](./09_异步接口.md) | `ASYNC-*`：异步语义、并发、worklet、重连 answer |
| [10_底层接口与边界补充.md](./10_底层接口与边界补充.md) | `MISC-*`：DeviceInfo、枚举、terminateSdk、onSuspend、SensorData 边界 |

## 五、约定

### 5.1 用例字段

每个用例统一字段：`优先级`（P0/P1/P2）、`测试目的`、`平台`、`设备相关`、`流程与逻辑`、`预期结果`、
`有效性说明`、`可自动化`（auto / semi-auto / manual）、`人工介入`、`测试结果`（待测试）。

### 5.2 平台标记

| 标记 | 含义 |
|------|------|
| `通用` | Android / iOS 均可执行，无平台差异 |
| `Android` | 仅 Android 可程序化执行 |
| `iOS` | 仅 iOS 可执行 |
| `Android(程序化)+iOS(人工)` | Android 用系统设置/程序触发；iOS 需人工在控制中心/设置手动操作 |

### 5.3 设备相关标记

- `通用`：不依赖具体设备能力，任何被扫描到的设备都可执行。
- `设备相关（需 XXX 能力）`：依赖 `DeviceInfo` 中某通道数 > 0 或某采样率，运行时判定，不支持则记「跳过」。
- 当前 Demo 的流开关面板覆盖：EEG、IMPEDANCE、EMG、GEST、PPG、SpO2、IMU、Angle（见 `DemoController.NTF_OPTIONS`），
  因此设备相关用例优先按这些能力标注，但**不做硬编码**。

### 5.4 三态判定（成功/失败/跳过）

- 成功只认返回值满足预期（布尔 `true`、字符串 `"OK"`、非空版本号、合法枚举等）。
- 失败：返回值不满足预期、抛异常、状态机不一致。
- 跳过：设备能力不支持（`ChannelCount == 0`）、缺硬件（多设备同步需 ≥2 台）等环境限制，整体记「跳过」不判失败。

### 5.5 错误判定口径（RN 特有）

- JS 层参数校验（`startScan`/`scanOnce` 的 `checkScanPeriod`、`requireSensor` 的 MAC 格式、`controllerSetParam` 空参、
  `getBinFileInfo`/`parseBinToCsv`/`replayBinFile` 空参等）会**抛 `Error`**，属预期「拒绝」而非崩溃。
- 原生返回的 `setParam/getParam` 结果：成功 `"OK"`，失败 `"Error: ..."` 字符串（或 promise reject，以实测为准）。
- `init` 在未 Ready 时 `console.warn` 并返回 `false`；`packageSampleCount` 越界 `console.warn` 返回 `false`（不抛异常）。

### 5.6 环境与前置条件

- Node 22.11+；Android：JDK 17、Android SDK 36、支持 BLE 的真机/平板；iOS：macOS + Xcode（模拟器无蓝牙）。
- Android 权限：定位（`ACCESS_FINE_LOCATION`）、Android 12+ 的 `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`。
- 设备上电、在扫描范围内；多设备用例需 ≥2 台。
- 每次用例结束调用 `SensorController.Instance.terminate()`（或 `terminateSdk()`）释放资源。
- 连接/起流/停流之间留 ≥100ms 间隔。
- 目标设备 MAC/identity 写入独立配置，不硬编码。

## 六、判定标准

- P0 用例 100% 通过；P1 ≥95%；P2 ≥90%。
- 失败保留 SDK 日志与 `.bin` 用于复现。
- 能力字段（`ChannelCount`/`SampleRate`）以 `getDeviceInfo()` 运行时结果为准，不硬编码假设。

## 七、缺陷归因与上报

- 报 bug 前自检：蓝牙开关、权限、设备电量、配对状态、SDK/RN 版本、后端（`getParam("BACK_END")`）。
- 设备型号/能力优先排查：先确认是否设备不支持，避免把「设备不支持」误报「SDK 缺陷」。
- 上报至少含：用例 ID、环境矩阵（SDK 版本/OS/设备/固件/配对）、断言输出、完整报错栈、最小复现步骤。
