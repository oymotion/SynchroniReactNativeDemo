/**
 * 设备相关用例标记，来源为 `Test Cases/*.md` 各用例的「设备相关」字段。
 * 值为所需能力说明（用于界面展示与过滤）；不在本表中的用例视为「通用」。
 */
export const DEVICE_RELATED: Record<string, string> = {
  'DATA-FUNC-007': '需对应流通道数 > 0',
  'DATA-FUNC-014': '需 ≥2 类流支持（如 EEG+IMU）',
  'DATA-FUNC-015': '需阻抗能力 ImpeChannelCount > 0',
  'DATA-PERF-001': '需对应流采样率',
  'PARAM-FUNC-003': '需对应流能力',
  'PARAM-FUNC-004': '需对应流采样率可设',
  'PARAM-FUNC-005': '需采样率参数',
  'PARAM-FUNC-006': '需滤波能力',
  'PARAM-FUNC-009': '需采样率参数',
  'PARAM-FUNC-010': '需角度能力',
  'PARAM-FUNC-011': '需 IMU 能力',
  'PARAM-BND-003': '需采样率参数',
  'PARAM-ROB-002': '需采样率参数',
  'MULTI-FUNC-001': '需 ≥2 台设备',
  'MULTI-FUNC-002': '需 ≥2 台设备',
  'MULTI-FUNC-003': '需 ≥2 个对应设备 MAC 的 bin',
  'MULTI-BND-001': '需 ≥2 台设备',
  'MULTI-ROB-001': '需 ≥2 台设备',
};

export function isDeviceRelated(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEVICE_RELATED, id);
}
