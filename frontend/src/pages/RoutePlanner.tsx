import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useMissionStore } from '../stores/missionStore';
import { useWaypointStore } from '../stores/waypointStore';
import { useRouteMetrics, DEFAULT_ROUTE_PARAMS, type RouteParams } from '../hooks/useRouteMetrics';
import AmapRouteView from '../components/common/AmapRouteView';
import OverlapCalcPanel from '../components/common/OverlapCalcPanel';
import { loadFlightLine, saveFlightLine, splitSorties } from '../utils/db';
import { newId } from '../utils/id';
import {
  findNoFlyConflicts,
  NO_FLY_SAFETY_MARGIN_M,
  polygonCentroid,
  type NoFlyConflict,
} from '../utils/geoCalc';
import type { FlightLine } from '../types/flightline';
import type { NoFlyZone } from '../types/mission';
import type { Waypoint } from '../types/waypoint';

type LineRow = { key: string; label: string; value: string };

const lineColumns: NonNullable<TableProps<LineRow>['columns']> = [
  { title: '项', dataIndex: 'label', width: 160 },
  { title: '值', dataIndex: 'value' },
];

/** /missions/:id/route 航线规划主视图：地图 + 参数面板实时回算 + 任务级禁飞区冲突检查 */
export default function RoutePlanner() {
  const { id = '' } = useParams();
  const missions = useMissionStore((s) => s.items);
  const waypoints = useWaypointStore((s) => s.items);
  const addWaypoint = useWaypointStore((s) => s.add);
  const updateMission = useMissionStore((s) => s.update);
  const mission = missions.find((m) => m.id === id);
  const missionWaypoints = useMemo(
    () => waypoints.filter((w) => w.missionId === id).sort((a, b) => a.seq - b.seq),
    [waypoints, id],
  );
  // 旧任务没有禁飞区字段时按空数组处理，照常打开
  const noFlyZones: NoFlyZone[] = useMemo(() => mission?.noFlyZones ?? [], [mission]);

  const [params, setParams] = useState<RouteParams>({ ...DEFAULT_ROUTE_PARAMS });
  const [savedText, setSavedText] = useState('');
  const [error, setError] = useState('');
  const [zoneError, setZoneError] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [zoneLng, setZoneLng] = useState<number | null>(null);
  const [zoneLat, setZoneLat] = useState<number | null>(null);
  const [zoneRadius, setZoneRadius] = useState<number | null>(200);
  const metrics = useRouteMetrics(id, params);

  useEffect(() => {
    if (!id) return;
    void loadFlightLine(id).then((line) => {
      if (!line) return;
      setParams((prev) => ({
        ...prev,
        altitude: missionWaypoints[0]?.altitude ?? prev.altitude,
        overlapForward: line.overlapForward,
        overlapSide: line.overlapSide,
        heading: line.heading,
      }));
      setSavedText(`上次保存：${new Date(line.updatedAt).toLocaleString('zh-CN')}`);
    });
  }, [id, missionWaypoints.length]);

  useEffect(() => {
    if (missionWaypoints.length > 0) {
      setParams((prev) => ({ ...prev, altitude: missionWaypoints[0].altitude }));
    }
  }, [missionWaypoints.length]);

  /** 逐段检查：每个航段按 点-航段最近距离 < 半径 + 50 m 安全余量 判定 */
  const conflicts = useMemo<NoFlyConflict[]>(() => {
    if (missionWaypoints.length < 2) return [];
    const segments = missionWaypoints.slice(1).map((w, i) => ({
      fromSeq: missionWaypoints[i].seq,
      toSeq: w.seq,
      from: [missionWaypoints[i].lng, missionWaypoints[i].lat] as [number, number],
      to: [w.lng, w.lat] as [number, number],
    }));
    return findNoFlyConflicts(segments, noFlyZones);
  }, [missionWaypoints, noFlyZones]);

  const conflictSegments = useMemo(
    () => Array.from(new Map(conflicts.map((c) => [`${c.fromSeq}-${c.toSeq}`, { fromSeq: c.fromSeq, toSeq: c.toSeq }])).values()),
    [conflicts],
  );

  const conflictZoneIds = useMemo(() => new Set(conflicts.map((c) => c.zoneId)), [conflicts]);
  const hasConflict = conflicts.length > 0;
  const saveBlockReason = hasConflict
    ? `航线与启用中的禁飞区存在 ${conflictSegments.length} 段冲突（已含边界外 ${NO_FLY_SAFETY_MARGIN_M} m 安全余量），挪开航点或关闭相关区域后才能保存`
    : undefined;

  const persistZones = async (next: NoFlyZone[]) => {
    await updateMission(id, { noFlyZones: next });
  };

  const addZone = async () => {
    const name = zoneName.trim();
    if (!name) {
      setZoneError('请填写禁飞区名称（如管制通知上的区域名）');
      return;
    }
    const lng = Number(zoneLng);
    const lat = Number(zoneLat);
    const radius = Number(zoneRadius);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setZoneError('中心经度需在 -180~180 之间');
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setZoneError('中心纬度需在 -90~90 之间');
      return;
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      setZoneError('半径需为大于 0 的米数');
      return;
    }
    const zone: NoFlyZone = {
      id: newId('nfz'),
      name,
      lng: Number(lng.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      radius: Math.round(radius),
      enabled: true,
    };
    await persistZones([...noFlyZones, zone]);
    setZoneName('');
    setZoneError('');
  };

  const toggleZone = async (zoneId: string, enabled: boolean) => {
    await persistZones(noFlyZones.map((z) => (z.id === zoneId ? { ...z, enabled } : z)));
  };

  const removeZone = async (zoneId: string) => {
    await persistZones(noFlyZones.filter((z) => z.id !== zoneId));
  };

  const fillAreaCenter = () => {
    if (!mission || mission.areaPolygon.length === 0) return;
    const [lng, lat] = polygonCentroid(mission.areaPolygon);
    setZoneLng(Number(lng.toFixed(6)));
    setZoneLat(Number(lat.toFixed(6)));
  };

  const onSave = async () => {
    if (!mission) return;
    // 最后一道防线：即使按钮状态异常也不允许带冲突落库
    if (hasConflict) {
      setError(saveBlockReason ?? '航线存在禁飞区冲突，无法保存');
      return;
    }
    const line: FlightLine = {
      id: newId('line'),
      missionId: mission.id,
      lineNo: 1,
      spacing: metrics.spacing,
      photoInterval: metrics.photoInterval,
      overlapForward: params.overlapForward,
      overlapSide: params.overlapSide,
      gsd: metrics.gsd,
      estPhotos: metrics.estPhotos,
      estDuration: metrics.estDuration,
      batteryCount: metrics.batteryCount,
      heading: params.heading,
      updatedAt: Date.now(),
    };
    await saveFlightLine(line);
    setSavedText(`已保存 ${new Date(line.updatedAt).toLocaleString('zh-CN')}`);
    setError('');
  };

  const pickPoint = async (lng: number, lat: number) => {
    if (!mission) return;
    if (missionWaypoints.length >= 60) {
      setError('单任务航点上限为 60 个，请拆分架次');
      return;
    }
    const seq = missionWaypoints.length === 0 ? 1 : Math.max(...missionWaypoints.map((w) => w.seq)) + 1;
    await addWaypoint({
      missionId: mission.id,
      seq,
      lng: Number(lng.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      altitude: params.altitude,
      speed: params.speed,
      heading: params.heading,
      gimbalPitch: -90,
      action: '拍照',
      hoverSec: 0,
    });
    setError('');
  };

  const lineRows: LineRow[] = [
    { key: 'gsd', label: '地面分辨率 GSD', value: `${metrics.gsd} cm/px` },
    { key: 'spacing', label: '航线间距', value: `${metrics.spacing} m` },
    { key: 'interval', label: '拍照间隔', value: `${metrics.photoInterval} m` },
    { key: 'photos', label: '预计张数', value: `${metrics.estPhotos} 张` },
    { key: 'duration', label: '预计耗时', value: `${metrics.estDuration} min` },
    { key: 'battery', label: '预计电池组数', value: `${metrics.batteryCount} 组` },
    { key: 'area', label: '测区面积', value: `${metrics.area.toFixed(0)} m²` },
    { key: 'length', label: '航带路径长度', value: `${metrics.pathLength.toFixed(1)} m` },
    { key: 'lines', label: '预计航带数', value: `${metrics.lineCount} 条` },
  ];

  const waypointById = useMemo(() => new Map(missionWaypoints.map((w) => [w.seq, w])), [missionWaypoints]);

  const zoneColumns: NonNullable<TableProps<NoFlyZone>['columns']> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 64,
      render: (_: boolean, row) => <Switch size="small" checked={row.enabled} onChange={(v) => void toggleZone(row.id, v)} />,
    },
    {
      title: '禁飞区',
      render: (_, row) => (
        <Space size={6} wrap>
          <Typography.Text strong={row.enabled} type={row.enabled ? undefined : 'secondary'}>
            {row.name}
          </Typography.Text>
          {row.enabled ? <Tag color="red">生效中</Tag> : <Tag>已关闭</Tag>}
          {conflictZoneIds.has(row.id) ? <Tag color="red">有冲突</Tag> : null}
          <Typography.Text type="secondary">
            ({row.lng.toFixed(5)}, {row.lat.toFixed(5)}) · 半径 {row.radius} m · 含余量判定 {row.radius + NO_FLY_SAFETY_MARGIN_M} m
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '操作',
      dataIndex: 'actions',
      width: 72,
      render: (_, row) => (
        <Popconfirm title="删除该禁飞区？" onConfirm={() => void removeZone(row.id)}>
          <Button size="small" type="text" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const conflictColumns: NonNullable<TableProps<NoFlyConflict>['columns']> = [
    {
      title: '受影响航段',
      dataIndex: 'segment',
      width: 150,
      render: (_: unknown, row) => (
        <Typography.Text strong>
          #{row.fromSeq} → #{row.toSeq}
        </Typography.Text>
      ),
    },
    {
      title: '从哪一点到哪一点',
      render: (_, row) => {
        const from = waypointById.get(row.fromSeq);
        const to = waypointById.get(row.toSeq);
        return (
          <Typography.Text type="secondary">
            {from ? `(${from.lng.toFixed(5)}, ${from.lat.toFixed(5)})` : '—'} →{' '}
            {to ? `(${to.lng.toFixed(5)}, ${to.lat.toFixed(5)})` : '—'}
          </Typography.Text>
        );
      },
    },
    { title: '禁飞区', dataIndex: 'zoneName', width: 170, render: (v: string) => <Tag color="red">{v}</Tag> },
    {
      title: '最近距离 / 判定阈值',
      dataIndex: 'distance',
      width: 190,
      render: (_: unknown, row) => `${row.distance} m ＜ ${row.limit} m（半径 + 余量 ${NO_FLY_SAFETY_MARGIN_M} m）`,
    },
  ];

  if (!mission) {
    return (
      <Space direction="vertical">
        <Alert type="warning" showIcon message="未找到该任务（可能已被删除）" />
        <Link to="/missions">返回任务台账</Link>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          航线规划 · {mission.missionNo}
        </Typography.Title>
        <Tag color="cyan">{mission.purpose}</Tag>
        <Tag>{mission.areaName}</Tag>
        <Tag color={missionWaypoints.length > 0 ? 'green' : 'default'}>航点 {missionWaypoints.length} 个</Tag>
        <Tag color={noFlyZones.some((z) => z.enabled) ? 'red' : 'default'}>
          禁飞区 {noFlyZones.filter((z) => z.enabled).length} 处生效
        </Tag>
        <div style={{ flex: 1 }} />
        <Button type="link">
          <Link to={`/missions/${mission.id}/waypoints`}>航点明细</Link>
        </Button>
        <Button type="link">
          <Link to={`/missions/${mission.id}/assets`}>成果编目</Link>
        </Button>
        <Button type="link">
          <Link to="/settings/camera">相机预设</Link>
        </Button>
        <Button type="link">
          <Link to="/missions">返回台账</Link>
        </Button>
      </Space>

      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError('')} /> : null}

      <Row gutter={14}>
        <Col span={15}>
          <Card size="small" title="测区与航线">
            <AmapRouteView
              mission={mission}
              waypoints={missionWaypoints}
              altitude={params.altitude}
              height={440}
              onPickPoint={pickPoint}
              noFlyZones={noFlyZones}
              conflictSegments={conflictSegments}
            />
          </Card>

          <Card
            size="small"
            title="任务级禁飞区（临时管制）"
            style={{ marginTop: 14 }}
            extra={<Typography.Text type="secondary">按边界外 {NO_FLY_SAFETY_MARGIN_M} m 安全余量逐段检查</Typography.Text>}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Space wrap size={8}>
                <Input
                  style={{ width: 200 }}
                  placeholder="禁飞区名称，如「朝阳公园临时管制」"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                />
                <span>
                  <Typography.Text type="secondary">中心经度</Typography.Text>{' '}
                  <InputNumber
                    style={{ width: 130 }}
                    min={-180}
                    max={180}
                    step={0.0001}
                    placeholder="116.3945"
                    value={zoneLng}
                    onChange={(v) => setZoneLng(v === null ? null : Number(v))}
                  />
                </span>
                <span>
                  <Typography.Text type="secondary">中心纬度</Typography.Text>{' '}
                  <InputNumber
                    style={{ width: 130 }}
                    min={-90}
                    max={90}
                    step={0.0001}
                    placeholder="39.9054"
                    value={zoneLat}
                    onChange={(v) => setZoneLat(v === null ? null : Number(v))}
                  />
                </span>
                <span>
                  <Typography.Text type="secondary">半径 m</Typography.Text>{' '}
                  <InputNumber style={{ width: 100 }} min={1} max={10000} step={10} value={zoneRadius} onChange={(v) => setZoneRadius(v)} />
                </span>
                <Button type="primary" onClick={() => void addZone()}>
                  录入禁飞区
                </Button>
                <Button onClick={fillAreaCenter} disabled={mission.areaPolygon.length === 0}>
                  取测区中心
                </Button>
              </Space>
              {zoneError ? <Alert type="error" showIcon message={zoneError} closable onClose={() => setZoneError('')} /> : null}

              {noFlyZones.length === 0 ? (
                <Typography.Text type="secondary">
                  暂无禁飞区：收到临时管制通知后，在此录入名称、中心经纬度与半径，地图会标出范围并逐段检查航线。
                </Typography.Text>
              ) : (
                <Table<NoFlyZone>
                  rowKey="id"
                  size="small"
                  columns={zoneColumns}
                  dataSource={noFlyZones}
                  pagination={false}
                />
              )}

              {hasConflict ? (
                <Alert
                  type="error"
                  showIcon
                  message={`航线与启用中的禁飞区冲突：${conflictSegments.length} 个航段受影响，航线参数已禁止保存`}
                  description={
                    <Table<NoFlyConflict>
                      style={{ marginTop: 6 }}
                      rowKey={(c) => `${c.zoneId}-${c.fromSeq}-${c.toSeq}`}
                      size="small"
                      columns={conflictColumns}
                      dataSource={conflicts}
                      pagination={false}
                    />
                  }
                />
              ) : (
                <Alert type="success" showIcon message="所有启用中的禁飞区检查通过（或暂未录入），航线可以保存" />
              )}
            </Space>
          </Card>

          <Card size="small" title="航线参数明细" style={{ marginTop: 14 }}>
            <Table<LineRow> rowKey="key" size="small" columns={lineColumns} dataSource={lineRows} pagination={false} />
          </Card>
          <Card size="small" title="多架次拆分" style={{ marginTop: 14 }}>
            <Space wrap size={6}>
              {splitSorties({
                id: 'preview',
                missionId: mission.id,
                lineNo: 1,
                spacing: metrics.spacing,
                photoInterval: metrics.photoInterval,
                overlapForward: params.overlapForward,
                overlapSide: params.overlapSide,
                gsd: metrics.gsd,
                estPhotos: metrics.estPhotos,
                estDuration: metrics.estDuration,
                batteryCount: metrics.batteryCount,
                heading: params.heading,
                updatedAt: Date.now(),
              }).map((s) => (
                <Tag key={s.sortie} color="blue">
                  第 {s.sortie} 架次 · {s.photos} 张 · {s.durationMin} min
                </Tag>
              ))}
            </Space>
          </Card>
        </Col>
        <Col span={9}>
          <OverlapCalcPanel
            params={params}
            onChange={(patch) => setParams((prev) => ({ ...prev, ...patch }))}
            metrics={metrics}
            onSave={onSave}
            savedText={savedText}
            saveDisabled={hasConflict}
            saveDisabledReason={saveBlockReason}
          />
        </Col>
      </Row>

      <Card size="small" title="点击网格新增的航点">
        {missionWaypoints.length === 0 ? (
          <Typography.Text type="secondary">
            暂无航点：在地图/网格上单击即可按当前航高新增航点，或到「航点明细」页批量粘贴导入。
          </Typography.Text>
        ) : (
          <Space wrap size={6}>
            {missionWaypoints.map((w: Waypoint) => (
              <Tag key={w.id} color={w.action === '悬停' ? 'gold' : 'blue'}>
                #{w.seq} {w.lng.toFixed(5)}, {w.lat.toFixed(5)} · {w.altitude} m · {w.action}
              </Tag>
            ))}
          </Space>
        )}
      </Card>
    </Space>
  );
}
