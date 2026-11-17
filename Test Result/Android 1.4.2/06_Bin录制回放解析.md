# Bin 录制回放解析用例（BIN-*）

> 目标对象：`SensorController.getBinFileInfo/replayBinFile/pauseBinReplay/resumeBinReplay/stopBinReplay/parseBinToCsv`。
> 回放需 fresh profile（复用已连接/已起流 profile 回放不泵数据）；`BinFileInfo` 的 64 位字段（`FeatureMap`/`NotifyDataFlag`/
> `channelMask`）为 `bigint`。

### BIN-FUNC-001 getBinFileInfo 解析 bin
- **优先级**：P0
- **测试目的**：验证 bin 信息解析。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：`await getBinFileInfo(binPath)`，检查返回结构。
- **预期结果**：返回 `BinFileInfo`，含 `Mac/DeviceName/DurationSec/Valid/DeviceInfo/SensorDatas/FirstDataTsMs/LastDataTsMs` 等；
  `FeatureMap/NotifyDataFlag` 为 `bigint`，`SensorDatas[].channelMask` 为 `bigint`。
- **有效性说明**：bin 元数据解析正确性。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过

### BIN-FUNC-002 replayBinFile 回放起流
- **优先级**：P0
- **测试目的**：验证回放泵数据。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：fresh controller + `requireSensor({Name,Address,RSSI})` + `await replayBinFile(path, mac, realtime)`，观察数据回调。
- **预期结果**：返回 `true`；数据经 `onSensorNotifyData` 正常到达（`dataType`/样本有效）。
- **有效性说明**：回放数据通路。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过

### BIN-FUNC-003 pauseBinReplay 暂停
- **优先级**：P0
- **测试目的**：验证回放暂停。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：回放中 `await pauseBinReplay(mac)`，观察数据停止。
- **预期结果**：返回 `"OK"`；暂停后无新数据回调。
- **有效性说明**：回放控制。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过

### BIN-FUNC-004 resumeBinReplay 恢复
- **优先级**：P0
- **测试目的**：验证回放恢复。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：暂停后 `await resumeBinReplay(mac)`，观察数据恢复。
- **预期结果**：返回 `"OK"`；数据恢复到达。
- **有效性说明**：回放恢复。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过

### BIN-FUNC-005 stopBinReplay 停止
- **优先级**：P0
- **测试目的**：验证回放停止。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：回放中 `await stopBinReplay(mac)`，观察数据停止与状态推送。
- **预期结果**：返回 `"OK"`；数据停止，`onDataTransferStateChange` 收到 `false`（回放 EOF 也算停）。
- **有效性说明**：回放停止释放。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过

### BIN-FUNC-006 parseBinToCsv 生成 CSV
- **优先级**：P0
- **测试目的**：验证 bin 转 CSV。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：`await parseBinToCsv(binPath)`（不指定 csvPath），检查输出路径与首行表头。
- **预期结果**：返回目标 csv 路径（默认 `binPath 去 .bin + .csv`）；文件存在，首行为 `timestamp,mac,type,...` 表头。
- **有效性说明**：离线解析链路。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过

### BIN-FUNC-007 parseBinToCsv 指定 csvPath
- **优先级**：P1
- **测试目的**：验证指定输出路径。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：`await parseBinToCsv(binPath, customCsvPath)`。
- **预期结果**：返回 `customCsvPath`，文件生成于指定位置。
- **有效性说明**：自定义输出。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过

### BIN-BND-001 getBinFileInfo 空路径/不存在路径
- **优先级**：P1
- **测试目的**：验证路径校验。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：`getBinFileInfo("")`、`getBinFileInfo(不存在路径)`。
- **预期结果**：空路径抛 `Error('invalid arguments')`；不存在路径 reject/返回异常结构，不崩溃。
- **有效性说明**：路径校验。
- **可自动化**：auto
- **人工介入**：无
- **测试结果**：通过

### BIN-BND-002 replayBinFile 非法 MAC
- **优先级**：P1
- **测试目的**：验证回放 MAC 校验。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：`replayBinFile(path, "850B")`、`replayBinFile(path, "")`。
- **预期结果**：抛 `Error('invalid device address: ...')`，不崩溃。
- **有效性说明**：MAC 格式校验。
- **可自动化**：auto
- **人工介入**：无
- **测试结果**：通过

### BIN-BND-003 pause/resume/stopBinReplay 非法 MAC
- **优先级**：P1
- **测试目的**：验证控制接口 MAC 校验。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：`pauseBinReplay("850B")`、`resumeBinReplay("")`、`stopBinReplay(null)`。
- **预期结果**：均抛 `Error('invalid device address: ...')`，不崩溃。
- **有效性说明**：控制接口参数校验。
- **可自动化**：auto
- **人工介入**：无
- **测试结果**：通过

### BIN-BND-004 parseBinToCsv 空路径
- **优先级**：P1
- **测试目的**：验证解析路径校验。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：`parseBinToCsv("")`。
- **预期结果**：抛 `Error('invalid arguments')`，不崩溃。
- **有效性说明**：路径校验。
- **可自动化**：auto
- **人工介入**：无
- **测试结果**：通过

### BIN-ROB-001 回放期间重复 pause/resume
- **优先级**：P1
- **测试目的**：验证回放控制健壮性。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：回放中快速交替 `pause/resume` 多次。
- **预期结果**：无死锁无异常，最终数据流状态与最后一次操作一致。
- **有效性说明**：回放控制并发安全。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过

### BIN-ROB-002 回放未开始时 pause/stop
- **优先级**：P1
- **测试目的**：验证未回放时控制操作。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：未 `replayBinFile` 时 `pauseBinReplay(mac)`/`stopBinReplay(mac)`。
- **预期结果**：返回 `"Error: ..."` 或 `"OK"`（以实测为准），不崩溃。
- **有效性说明**：控制操作容错。
- **可自动化**：auto
- **人工介入**：无
- **测试结果**：通过

### BIN-ROB-003 回放中 terminate
- **优先级**：P1
- **测试目的**：验证回放中销毁控制器。
- **平台**：通用
- **设备相关**：通用
- **流程与逻辑**：回放中 `await terminate()`，观察无异常，回放停止。
- **预期结果**：不崩溃，数据停止，控制器单例重置。
- **有效性说明**：销毁清理。
- **可自动化**：auto
- **人工介入**：无（需有效 bin）
- **测试结果**：通过
