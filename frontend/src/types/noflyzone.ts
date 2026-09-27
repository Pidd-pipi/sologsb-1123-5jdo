/** 任务级禁飞区（临时管制空域，圆形） */
export interface NoFlyZone {
  id: string;
  missionId: string;
  /** 管制区名称，例如「xx 广场临时管制」 */
  name: string;
  /** 中心经度 */
  lng: number;
  /** 中心纬度 */
  lat: number;
  /** 半径 m */
  radius: number;
  /** 是否启用；关掉后只在地图上灰显，不再参与冲突检查、不拦截保存 */
  enabled: boolean;
  createdAt: number;
}

export type NoFlyZoneDraft = Omit<NoFlyZone, 'id' | 'createdAt'>;

/** 禁飞区边界外的安全余量 m：航段距边界不足该值即视为冲突 */
export const NOFLY_SAFETY_MARGIN_M = 50;
