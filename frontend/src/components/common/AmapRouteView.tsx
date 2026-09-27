import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Space, Tag, Typography } from 'antd';
import type { LngLat, Mission } from '../../types/mission';
import type { Waypoint } from '../../types/waypoint';
import type { NoFlyZone } from '../../types/noflyzone';
import { NOFLY_SAFETY_MARGIN_M } from '../../types/noflyzone';
import { createProjector, distanceMeters, groundCoverage, METERS_PER_DEG_LAT, metersPerDegLng } from '../../utils/geoCalc';
import { loadAmap, readAmapKey, type AMapNamespace } from '../../utils/amapLoader';

export interface AmapRouteViewProps {
  mission?: Mission;
  waypoints: Waypoint[];
  /** 相对航高 m，用于绘制每航点视场矩形 */
  altitude: number;
  /** 画布高度 px */
  height?: number;
  /** 点击网格新增航点时回调（仅 SVG 视图支持） */
  onPickPoint?: (lng: number, lat: number) => void;
  /** 高亮的航点序号（例如从成果编目页「定位到图」） */
  highlightSeq?: number;
  /** 航点标注（用于单点视场预览） */
  withFov?: boolean;
  /** 任务级禁飞区（圆形：核心区 + 边界外安全余量圈） */
  noFlyZones?: NoFlyZone[];
  /** 冲突航段序号对 [起点序号, 终点序号]，地图上红色加粗高亮 */
  conflictPairs?: [number, number][];
}

const GRID_W = 760;

/** 稳定引用的空集合，避免默认参数导致地图 effect 反复重建 */
const EMPTY_ZONES: NoFlyZone[] = [];
const EMPTY_PAIRS: [number, number][] = [];

/**
 * 高德地图封装：绘制测区多边形、航点折线、每航点视场矩形。
 * 读取 `VITE_AMAP_KEY`；未配置 key 时自动退化为本地 SVG 网格视图（等比投影，功能不依赖网络）。
 * 被航线规划页、成果编目页消费。
 */
export default function AmapRouteView({
  mission,
  waypoints,
  altitude,
  height = 420,
  onPickPoint,
  highlightSeq,
  withFov = true,
  noFlyZones = EMPTY_ZONES,
  conflictPairs = EMPTY_PAIRS,
}: AmapRouteViewProps) {
  const [amap, setAmap] = useState<AMapNamespace | null>(null);
  const [mode, setMode] = useState<'loading' | 'amap' | 'grid'>('loading');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ destroy: () => void } | null>(null);
  const keyPresent = readAmapKey().length > 0;

  useEffect(() => {
    let alive = true;
    if (!keyPresent) {
      setMode('grid');
      return () => {
        alive = false;
      };
    }
    loadAmap().then((ns) => {
      if (!alive) return;
      if (ns) {
        setAmap(ns);
        setMode('amap');
      } else {
        // key 配置了但脚本加载失败 → 依然退化为本地网格视图，不阻塞功能
        setMode('grid');
      }
    });
    return () => {
      alive = false;
    };
  }, [keyPresent]);

  // 高德地图分支：绘制多边形 / 折线 / 航点 / 视场矩形
  useEffect(() => {
    if (mode !== 'amap' || !amap || !containerRef.current || !mission) return;
    const container = containerRef.current;
    const map = new amap.Map(container, {
      zoom: 15,
      center: mission.areaPolygon[0] ?? [116.39, 39.9],
      mapStyle: 'amap://styles/normal',
    });
    mapRef.current = map;
    const overlays: unknown[] = [];
    if (mission.areaPolygon.length >= 3) {
      overlays.push(
        new amap.Polygon({
          path: mission.areaPolygon,
          strokeColor: '#1d3557',
          strokeWeight: 2,
          fillColor: '#8ecae6',
          fillOpacity: 0.25,
        }),
      );
    }
    if (waypoints.length >= 2) {
      overlays.push(
        new amap.Polyline({
          path: waypoints.map((w) => [w.lng, w.lat]),
          strokeColor: '#e07a2f',
          strokeWeight: 3,
        }),
      );
    }
    waypoints.forEach((w) => {
      overlays.push(
        new amap.Marker({
          position: [w.lng, w.lat],
          title: `#${w.seq} ${w.altitude} m ${w.action}`,
        }),
      );
      if (withFov) {
        const side = groundCoverage(mission.sensorWidth, w.altitude, mission.focalLength);
        const along = groundCoverage(mission.sensorHeight, w.altitude, mission.focalLength);
        const dLat = side / 111320 / 2;
        const dLng = along / (111320 * Math.cos((w.lat * Math.PI) / 180)) / 2;
        overlays.push(
          new amap.Rectangle({
            bounds: [
              [w.lng - dLng, w.lat - dLat],
              [w.lng + dLng, w.lat + dLat],
            ],
            strokeColor: '#e07a2f',
            strokeWeight: 1,
            fillColor: '#e07a2f',
            fillOpacity: 0.12,
          }),
        );
      }
    });
    // 禁飞区：核心圆 + 边界外 50 m 安全余量虚线圆；停用区域整体灰显
    noFlyZones.forEach((z) => {
      const activeColor = z.enabled ? '#d93025' : '#9aa3ad';
      overlays.push(
        new amap.Circle({
          center: [z.lng, z.lat],
          radius: z.radius,
          strokeColor: activeColor,
          strokeWeight: 2,
          fillColor: activeColor,
          fillOpacity: z.enabled ? 0.18 : 0.06,
        }),
      );
      if (z.enabled) {
        overlays.push(
          new amap.Circle({
            center: [z.lng, z.lat],
            radius: z.radius + NOFLY_SAFETY_MARGIN_M,
            strokeColor: '#d93025',
            strokeWeight: 1.5,
            strokeStyle: 'dashed',
            fillOpacity: 0,
          }),
        );
      }
      overlays.push(
        new amap.Marker({
          position: [z.lng, z.lat],
          anchor: 'bottom-center',
          offset: new amap.Pixel(0, -8),
          content: `<div style="font-size:12px;color:${activeColor};background:rgba(255,255,255,.78);padding:0 4px;border-radius:3px;white-space:nowrap">⛔ ${z.name}${z.enabled ? '' : '（已停用）'}</div>`,
        }),
      );
    });
    // 冲突航段：在原折线上叠加红色加粗线段
    const wpBySeq = new Map(waypoints.map((w) => [w.seq, w]));
    conflictPairs.forEach(([fromSeq, toSeq]) => {
      const a = wpBySeq.get(fromSeq);
      const b = wpBySeq.get(toSeq);
      if (!a || !b) return;
      overlays.push(
        new amap.Polyline({
          path: [
            [a.lng, a.lat],
            [b.lng, b.lat],
          ],
          strokeColor: '#d93025',
          strokeWeight: 5,
          strokeStyle: 'dashed',
        }),
      );
    });
    overlays.forEach((o) => map.add(o));
    map.setFitView();
    return () => {
      try {
        map.destroy();
      } catch {
        /* 忽略销毁异常 */
      }
      mapRef.current = null;
    };
  }, [mode, amap, mission, waypoints, withFov, noFlyZones, conflictPairs]);

  // 本地 SVG 网格视图：等比投影，完全离线
  const projection = useMemo(() => {
    const poly: LngLat[] = mission && mission.areaPolygon.length >= 3 ? mission.areaPolygon : [[116.391, 39.907], [116.398, 39.907], [116.398, 39.903], [116.391, 39.903]];
    const zoneCorners: LngLat[] = [];
    noFlyZones.forEach((z) => {
      const eff = z.radius + (z.enabled ? NOFLY_SAFETY_MARGIN_M : 0);
      const dLat = eff / METERS_PER_DEG_LAT;
      const dLng = eff / metersPerDegLng(z.lat);
      zoneCorners.push([z.lng - dLng, z.lat - dLat], [z.lng + dLng, z.lat + dLat]);
    });
    const all: LngLat[] = [...poly, ...waypoints.map((w) => [w.lng, w.lat] as LngLat), ...zoneCorners];
    const lngs = all.map((p) => p[0]);
    const lats = all.map((p) => p[1]);
    const box: LngLat[] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
      [Math.min(...lngs), Math.max(...lats)],
    ];
    return { poly, box, projector: createProjector(box, GRID_W, height) };
  }, [mission, waypoints, height, noFlyZones]);

  const pxPerMeter = useMemo(() => {
    const { box, projector } = projection;
    const dMeters = distanceMeters(box[0], box[1]) || 1;
    const a = projector.toXY(box[0]);
    const b = projector.toXY(box[1]);
    return Math.hypot(b.x - a.x, b.y - a.y) / dMeters;
  }, [projection]);

  const fovRects = useMemo(() => {
    if (!withFov || !mission) return [];
    return waypoints.map((w) => {
      const sideM = groundCoverage(mission.sensorWidth, w.altitude, mission.focalLength);
      const alongM = groundCoverage(mission.sensorHeight, w.altitude, mission.focalLength);
      const p = projection.projector.toXY([w.lng, w.lat]);
      return {
        id: w.id,
        seq: w.seq,
        x: p.x - (alongM * pxPerMeter) / 2,
        y: p.y - (sideM * pxPerMeter) / 2,
        w: alongM * pxPerMeter,
        h: sideM * pxPerMeter,
      };
    });
  }, [withFov, mission, waypoints, projection, pxPerMeter]);

  // 禁飞区在等经纬度等比投影下为椭圆：rx 对应经度方向、ry 对应纬度方向
  const zoneEllipses = useMemo(() => {
    // 投影为线性等比变换，单位经纬度的像素跨度处处相同
    const perDegX = projection.projector.toXY([projection.box[0][0] + 1, projection.box[0][1]]).x - projection.projector.toXY(projection.box[0]).x;
    const perDegY = projection.projector.toXY([projection.box[0][0], projection.box[0][1] + 1]).y - projection.projector.toXY(projection.box[0]).y;
    return noFlyZones.map((z) => {
      const p = projection.projector.toXY([z.lng, z.lat]);
      const rx = (z.radius / metersPerDegLng(z.lat)) * perDegX;
      // 纬度增大 y 减小，ry 取绝对值用于椭圆半径
      const ry = Math.abs((z.radius / METERS_PER_DEG_LAT) * perDegY);
      const marginScale = z.enabled ? (z.radius + NOFLY_SAFETY_MARGIN_M) / z.radius : 0;
      return {
        id: z.id,
        name: z.name,
        enabled: z.enabled,
        cx: p.x,
        cy: p.y,
        rx,
        ry,
        marginRx: z.enabled ? rx * marginScale : 0,
        marginRy: z.enabled ? ry * marginScale : 0,
      };
    });
  }, [noFlyZones, projection]);

  // 冲突航段折线（SVG 坐标）
  const conflictLines = useMemo(() => {
    const bySeq = new Map(waypoints.map((w) => [w.seq, w]));
    return conflictPairs
      .map(([fromSeq, toSeq]) => {
        const a = bySeq.get(fromSeq);
        const b = bySeq.get(toSeq);
        if (!a || !b) return null;
        return {
          key: `${fromSeq}-${toSeq}`,
          from: projection.projector.toXY([a.lng, a.lat]),
          to: projection.projector.toXY([b.lng, b.lat]),
        };
      })
      .filter((x): x is { key: string; from: { x: number; y: number }; to: { x: number; y: number } } => x !== null);
  }, [conflictPairs, waypoints, projection]);

  if (mode === 'loading') {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <Typography.Text type="secondary">正在加载地图视图…</Typography.Text>
      </div>
    );
  }

  if (mode === 'amap') {
    return (
      <div>
        <Alert
          style={{ marginBottom: 8 }}
          type="success"
          showIcon
          message="已启用高德地图 JS API（VITE_AMAP_KEY 已配置）"
        />
        <div ref={containerRef} style={{ width: '100%', height, borderRadius: 6, overflow: 'hidden' }} data-testid="amap-container" />
      </div>
    );
  }

  const polygonPath = projection.poly.map((p) => projection.projector.toXY(p)).map((p) => `${p.x},${p.y}`).join(' ');
  const linePath = waypoints.map((w) => projection.projector.toXY([w.lng, w.lat]));

  return (
    <div data-testid="amap-fallback-grid">
      <Alert
        style={{ marginBottom: 8 }}
        type="info"
        showIcon
        message="未配置 VITE_AMAP_KEY，已自动退化为本地 SVG 网格视图（等比投影，航线与视场仍可绘制交互，功能不依赖网络）"
      />
      <svg
        viewBox={`0 0 ${GRID_W} ${height}`}
        width="100%"
        height={height}
        style={{ border: '1px solid #dbe1e8', borderRadius: 6, background: '#fbfdfe', cursor: onPickPoint ? 'crosshair' : 'default' }}
        onClick={(e) => {
          if (!onPickPoint) return;
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * GRID_W;
          const y = ((e.clientY - rect.top) / rect.height) * height;
          const [lng, lat] = projection.projector.toLngLat(x, y);
          onPickPoint(lng, lat);
        }}
      >
        <defs>
          <pattern id="grid-10" width="38" height="38" patternUnits="userSpaceOnUse">
            <path d="M38 0 L0 0 0 38" fill="none" stroke="#e8eef4" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={GRID_W} height={height} fill="url(#grid-10)" />

        {fovRects.map((r) => (
          <rect
            key={`fov-${r.id}`}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            fill="#e07a2f"
            fillOpacity={r.seq === highlightSeq ? 0.3 : 0.12}
            stroke="#e07a2f"
            strokeWidth={r.seq === highlightSeq ? 2 : 1}
          />
        ))}

        {polygonPath ? (
          <polygon points={polygonPath} fill="#8ecae6" fillOpacity="0.25" stroke="#1d3557" strokeWidth="2" />
        ) : null}

        {zoneEllipses.map((z) => (
          <g key={`nfz-${z.id}`}>
            {z.enabled ? (
              <ellipse
                cx={z.cx}
                cy={z.cy}
                rx={z.marginRx}
                ry={z.marginRy}
                fill="none"
                stroke="#d93025"
                strokeWidth="1.2"
                strokeDasharray="6 4"
              />
            ) : null}
            <ellipse
              cx={z.cx}
              cy={z.cy}
              rx={z.rx}
              ry={z.ry}
              fill={z.enabled ? '#d93025' : '#9aa3ad'}
              fillOpacity={z.enabled ? 0.16 : 0.06}
              stroke={z.enabled ? '#d93025' : '#9aa3ad'}
              strokeWidth="1.8"
            />
            <text x={z.cx} y={z.cy - z.ry - 6} fontSize="12" fill={z.enabled ? '#d93025' : '#7b8492'} textAnchor="middle">
              ⛔ {z.name}
              {z.enabled ? '' : '（已停用）'}
            </text>
          </g>
        ))}

        {conflictLines.map((l) => (
          <line
            key={`conflict-${l.key}`}
            x1={l.from.x}
            y1={l.from.y}
            x2={l.to.x}
            y2={l.to.y}
            stroke="#d93025"
            strokeWidth="5"
            strokeDasharray="8 5"
            strokeLinecap="round"
            opacity={0.9}
          />
        ))}

        {linePath.length >= 2 ? (
          <polyline
            points={linePath.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#e07a2f"
            strokeWidth="2.5"
          />
        ) : null}

        {waypoints.map((w) => {
          const p = projection.projector.toXY([w.lng, w.lat]);
          const active = w.seq === highlightSeq;
          return (
            <g key={w.id}>
              <circle cx={p.x} cy={p.y} r={active ? 8 : 5} fill={active ? '#d93025' : '#1d3557'} />
              <text x={p.x + 9} y={p.y - 6} fontSize="11" fill="#3c4652">
                #{w.seq} {w.altitude}m {w.action}
              </text>
            </g>
          );
        })}

        <g>
          <line x1="24" y1={height - 22} x2="124" y2={height - 22} stroke="#333" strokeWidth="2" />
          <text x="30" y={height - 28} fontSize="11" fill="#333">
            比例尺 100 m
          </text>
        </g>
      </svg>
      <Space size={6} style={{ marginTop: 8 }} wrap>
        <Tag color="blue">测区边界</Tag>
        <Tag color="orange">航点折线（{waypoints.length} 点）</Tag>
        <Tag>每航点视场矩形</Tag>
        <Tag color="gold">1 px ≈ {pxPerMeter > 0 ? (1 / pxPerMeter).toFixed(1) : '—'} m</Tag>
        {noFlyZones.some((z) => z.enabled) ? <Tag color="red">禁飞区 + {NOFLY_SAFETY_MARGIN_M} m 安全余量</Tag> : null}
        {noFlyZones.some((z) => !z.enabled) ? <Tag>已停用禁飞区</Tag> : null}
        {conflictPairs.length > 0 ? <Tag color="red">冲突航段 {conflictPairs.length} 段</Tag> : null}
        {onPickPoint ? <Tag color="green">点击网格可新增航点</Tag> : null}
      </Space>
    </div>
  );
}
