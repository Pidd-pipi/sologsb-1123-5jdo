/** 航拍用途 */
export type MissionPurpose = '正射' | '倾斜' | '带状';

export const MISSION_PURPOSES: MissionPurpose[] = ['正射', '倾斜', '带状'];

export type MissionStatus = '规划中' | '待飞行' | '已飞行' | '已归档';

export const MISSION_STATUSES: MissionStatus[] = ['规划中', '待飞行', '已飞行', '已归档'];

/** 经纬度点 */
export type LngLat = [number, number];

/** 任务级临时禁飞区（圆形） */
export interface NoFlyZone {
  id: string;
  /** 管制通知上的名称，如「朝阳公园临时管制」 */
  name: string;
  /** 中心经度 */
  lng: number;
  /** 中心纬度 */
  lat: number;
  /** 半径 m */
  radius: number;
  /** 关闭后不参与冲突检查、不拦截保存 */
  enabled: boolean;
}

/** 航拍任务 */
export interface Mission {
  id: string;
  /** 任务编号 */
  missionNo: string;
  name: string;
  /** 测区名称 */
  areaName: string;
  /** 测区边界经纬度数组 */
  areaPolygon: LngLat[];
  purpose: MissionPurpose;
  droneModel: string;
  cameraModel: string;
  /** 传感器宽度 mm */
  sensorWidth: number;
  /** 传感器高度 mm */
  sensorHeight: number;
  /** 焦距 mm */
  focalLength: number;
  /** 像元尺寸 μm */
  pixelSize: number;
  flightDate: string;
  pilot: string;
  status: MissionStatus;
  /** 任务级临时禁飞区（旧任务可能缺省，读取时按空数组处理） */
  noFlyZones?: NoFlyZone[];
  createdAt: number;
}

export type MissionDraft = Omit<Mission, 'id' | 'createdAt'>;

/** 相机预设 */
export interface CameraPreset {
  id: string;
  name: string;
  cameraModel: string;
  sensorWidth: number;
  sensorHeight: number;
  focalLength: number;
  pixelSize: number;
}
