import { useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag, Typography, type TableProps } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useNoFlyZoneStore } from '../../stores/noflyzoneStore';
import { NOFLY_SAFETY_MARGIN_M, type NoFlyZone } from '../../types/noflyzone';
import type { NoFlyConflict } from '../../utils/geoCalc';

export interface NoFlyZonePanelProps {
  missionId: string;
  /** 当前任务的禁飞区 */
  zones: NoFlyZone[];
  /** 逐段冲突检查结果（已按 50 m 安全余量） */
  conflicts: NoFlyConflict[];
}

interface ZoneFormValues {
  name: string;
  lng: number;
  lat: number;
  radius: number;
}

/** 航线页的任务级禁飞区（临时管制）录入与冲突清单面板 */
export default function NoFlyZonePanel({ missionId, zones, conflicts }: NoFlyZonePanelProps) {
  const add = useNoFlyZoneStore((s) => s.add);
  const update = useNoFlyZoneStore((s) => s.update);
  const remove = useNoFlyZoneStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NoFlyZone | null>(null);
  const [form] = Form.useForm<ZoneFormValues>();

  const enabledCount = zones.filter((z) => z.enabled).length;
  const conflictByZone = new Map(conflicts.map((c) => [c.zone.id, c]));

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ radius: 100 });
    setOpen(true);
  };

  const openEdit = (zone: NoFlyZone) => {
    setEditing(zone);
    form.setFieldsValue({ name: zone.name, lng: zone.lng, lat: zone.lat, radius: zone.radius });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name.trim(),
      lng: Number(values.lng.toFixed(6)),
      lat: Number(values.lat.toFixed(6)),
      radius: Number(values.radius),
    };
    if (editing) {
      await update(editing.id, payload);
    } else {
      await add({ missionId, ...payload, enabled: true });
    }
    setOpen(false);
  };

  const columns: NonNullable<TableProps<NoFlyZone>['columns']> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 64,
      render: (enabled: boolean, row) => (
        <Switch
          size="small"
          checked={enabled}
          checkedChildren="拦"
          unCheckedChildren="关"
          onChange={(checked) => update(row.id, { enabled: checked })}
        />
      ),
    },
    {
      title: '名称 / 中心 / 半径',
      render: (_: unknown, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.lng.toFixed(6)}, {row.lat.toFixed(6)} · 半径 {row.radius} m（检查含 +{NOFLY_SAFETY_MARGIN_M} m 余量）
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      width: 180,
      render: (_: unknown, row) => {
        if (!row.enabled) return <Tag>已停用，不拦截保存</Tag>;
        const hit = conflictByZone.get(row.id);
        if (hit) return <Tag color="error">冲突 {hit.segments.length} 段</Tag>;
        return <Tag color="success">航线已避让</Tag>;
      },
    },
    {
      title: '操作',
      width: 110,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title={`删除禁飞区「${row.name}」？`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove(row.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space wrap size={6}>
          任务禁飞区（临时管制）
          <Tag color={enabledCount > 0 ? 'red' : 'default'}>启用 {enabledCount} 个</Tag>
          {conflicts.length > 0 ? <Tag color="error">{conflicts.reduce((n, c) => n + c.segments.length, 0)} 个航段受影响</Tag> : null}
        </Space>
      }
      extra={
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
          新增禁飞区
        </Button>
      }
    >
      {conflicts.length > 0 ? (
        <Alert
          style={{ marginBottom: 10 }}
          type="error"
          showIcon
          message="存在穿越禁飞区（含边界外 50 m 安全余量）的航段，航线参数不能保存；挪开航点或停用区域后自动恢复。"
          description={
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {conflicts.map((c) => (
                <div key={c.zone.id}>
                  <Typography.Text strong style={{ color: '#d93025' }}>
                    ⛔ {c.zone.name}（半径 {c.zone.radius} m，检查半径 {c.effectiveRadius} m）
                  </Typography.Text>
                  <div>
                    {c.segments.map((s) => (
                      <Tag key={`${s.fromSeq}-${s.toSeq}`} color="error" style={{ marginTop: 4 }}>
                        #{s.fromSeq} → #{s.toSeq}（最近距圆心 {s.minDistance} m，侵入 {s.intrusion} m）
                      </Tag>
                    ))}
                  </div>
                </div>
              ))}
            </Space>
          }
        />
      ) : enabledCount > 0 ? (
        <Alert style={{ marginBottom: 10 }} type="success" showIcon message="各启用中的禁飞区均无航段穿入（已含边界外 50 m 余量），可正常保存。" />
      ) : null}

      <Table<NoFlyZone>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={zones}
        pagination={false}
        locale={{ emptyText: '暂无禁飞区：临时管制通知可在此录入名称、中心经纬度与半径，地图会标出范围并逐段检查航线。' }}
      />

      <Modal
        title={editing ? `编辑禁飞区：${editing.name}` : '新增禁飞区'}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        okText={editing ? '保存修改' : '新增'}
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label="管制区名称"
            rules={[
              { required: true, message: '请输入名称' },
              { max: 30, message: '名称不超过 30 个字' },
            ]}
          >
            <Input placeholder="例如：xx 广场临时管制" maxLength={30} />
          </Form.Item>
          <Space size={8} style={{ display: 'flex' }} align="start">
            <Form.Item
              name="lng"
              label="中心经度"
              style={{ flex: 1, marginBottom: 8 }}
              rules={[{ required: true, message: '必填' }]}
            >
              <InputNumber style={{ width: '100%' }} min={-180} max={180} step={0.000001} placeholder="116.394000" controls={false} />
            </Form.Item>
            <Form.Item
              name="lat"
              label="中心纬度"
              style={{ flex: 1, marginBottom: 8 }}
              rules={[{ required: true, message: '必填' }]}
            >
              <InputNumber style={{ width: '100%' }} min={-90} max={90} step={0.000001} placeholder="39.910500" controls={false} />
            </Form.Item>
          </Space>
          <Form.Item
            name="radius"
            label={`禁飞半径（m）；冲突检查在边界外再留 ${NOFLY_SAFETY_MARGIN_M} m 安全余量`}
            rules={[{ required: true, message: '必填' }]}
          >
            <InputNumber style={{ width: '100%' }} min={10} max={20000} step={10} addonAfter="m" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
