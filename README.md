# SynchroniReactNativeDemo

由 Synchroni SDK 的 example 整理而成的独立 React Native 应用，保留设备管理、IMU、Bio、文件回放和导出功能。

- React Native 0.86.2 / React 19.2.3
- Synchroni SDK 通过 npm 包 `@synchroni/synchroni_sdk_react_native` 安装，无需原 SDK 仓库
- 使用标准 React Native 自动链接和 Metro 配置

## 环境要求

- Node.js 22.11 或更高版本
- Android：JDK 17、Android Studio、Android SDK 36；真机测试需要支持蓝牙的移动设备
- iOS：macOS、Xcode、CocoaPods；模拟器不包含蓝牙设备功能

先完成 [React Native 环境配置](https://reactnative.dev/docs/set-up-your-environment)，再安装依赖：

```bash
npm install
```

`postinstall` 会通过 `patch-package` 自动应用 `patches/` 中的文档选择器 iOS 修复，请保留该目录和脚本。

## 运行 Android

在一个终端启动 Metro：

```bash
npm start
```

在另一个终端运行：

```bash
npm run android
```

也可以直接构建 Debug APK：

```bash
cd android
./gradlew assembleDebug
```

Windows 命令提示符使用 `gradlew.bat assembleDebug`。APK 输出到 `android/app/build/outputs/apk/debug/`。

当前 Synchroni SDK 固定构建 arm64-v8a、x86、x86_64，请不要通过 `--active-arch-only` 或 `-PreactNativeArchitectures` 缩减 ABI。

## 运行 iOS

仅在 macOS 上执行：

```bash
cd ios
bundle install
bundle exec pod install
cd ..
npm run ios
```

也可在 Xcode 中打开 `ios/SynchroniReactNativeDemo.xcworkspace`，选择 `SynchroniReactNativeDemo` scheme。

## 其他命令

```bash
npm run typecheck
npm test
```

正式发布前，请在 Android 和 iOS 工程中配置自己的签名、应用图标及发布标识；仓库中的 Android debug keystore 仅用于本地调试。
