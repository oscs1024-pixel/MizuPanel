import { useEffect, useState } from 'react'
import { createAlertRule, deleteAlertRule, getAlertRules, toggleAlertRule, updateAlertRule } from '../api/client'
import type { AlertRule, Node, NotificationChannel } from '../types'

type AlertRulesTabProps = {
  nodes: Node[]
}

type FormMode = 'create' | 'edit'

const metricFieldOptions = [
  { value: 'cpu_usage', label: 'CPU 使用率 (%)' },
  { value: 'memory_usage', label: '内存使用率 (%)' },
  { value: 'disk_usage', label: '磁盘使用率 (%)' },
  { value: 'swap_usage', label: 'Swap 使用率 (%)' },
  { value: 'load_1', label: '系统负载 (1分钟)' },
  { value: 'load_5', label: '系统负载 (5分钟)' },
  { value: 'load_15', label: '系统负载 (15分钟)' }
]

const operatorOptions = [
  { value: '>', label: '大于 (>)' },
  { value: '>=', label: '大于等于 (≥)' },
  { value: '<', label: '小于 (<)' },
  { value: '<=', label: '小于等于 (≤)' },
  { value: '=', label: '等于 (=)' }
]

export function AlertRulesTab({ nodes }: AlertRulesTabProps) {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [showForm, setShowForm] = useState(false)
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [editingRuleID, setEditingRuleID] = useState<number>()
  const [formName, setFormName] = useState('')
  const [formMetricField, setFormMetricField] = useState('cpu_usage')
  const [formOperator, setFormOperator] = useState('>')
  const [formThreshold, setFormThreshold] = useState('80')
  const [formDuration, setFormDuration] = useState('300')
  const [formScopeType, setFormScopeType] = useState<'all' | 'nodes'>('all')
  const [formScopeNodeIDs, setFormScopeNodeIDs] = useState<string[]>([])
  const [formChannels, setFormChannels] = useState<NotificationChannel[]>([])
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string>()

  useEffect(() => {
    loadRules()
  }, [])

  const loadRules = () => {
    setLoading(true)
    setError(undefined)
    getAlertRules()
      .then((response) => setRules(response.rules || []))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载告警规则失败'))
      .finally(() => setLoading(false))
  }

  const openCreateForm = () => {
    setFormMode('create')
    setEditingRuleID(undefined)
    setFormName('')
    setFormMetricField('cpu_usage')
    setFormOperator('>')
    setFormThreshold('80')
    setFormDuration('300')
    setFormScopeType('all')
    setFormScopeNodeIDs([])
    setFormChannels([])
    setFormError(undefined)
    setShowForm(true)
  }

  const openEditForm = (rule: AlertRule) => {
    setFormMode('edit')
    setEditingRuleID(rule.id)
    setFormName(rule.name)
    setFormMetricField(rule.metric_field)
    setFormOperator(rule.operator)
    setFormThreshold(String(rule.threshold))
    setFormDuration(String(rule.duration_seconds))
    setFormScopeType(rule.scope_type)
    setFormScopeNodeIDs(rule.scope_node_ids || [])
    setFormChannels(rule.notification_channels)
    setFormError(undefined)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setFormError(undefined)
  }

  const saveRule = () => {
    const threshold = Number.parseFloat(formThreshold)
    const duration = Number.parseInt(formDuration, 10)
    if (!formName.trim()) {
      setFormError('规则名称不能为空')
      return
    }
    if (Number.isNaN(threshold)) {
      setFormError('阈值必须是有效数字')
      return
    }
    if (Number.isNaN(duration) || duration < 0) {
      setFormError('持续时间必须是非负整数')
      return
    }
    if (formScopeType === 'nodes' && formScopeNodeIDs.length === 0) {
      setFormError('指定节点模式下至少选择一个节点')
      return
    }

    const payload = {
      name: formName.trim(),
      enabled: true,
      metric_field: formMetricField,
      operator: formOperator,
      threshold,
      duration_seconds: duration,
      scope_type: formScopeType,
      ...(formScopeType === 'nodes' ? { scope_node_ids: formScopeNodeIDs } : {}),
      notification_channels: formChannels
    }

    setFormSaving(true)
    setFormError(undefined)
    const request = formMode === 'create'
      ? createAlertRule(payload)
      : updateAlertRule(editingRuleID!, payload)

    request
      .then(() => {
        closeForm()
        loadRules()
      })
      .catch((err: unknown) => setFormError(err instanceof Error ? err.message : '保存规则失败'))
      .finally(() => setFormSaving(false))
  }

  const handleToggle = (id: number, enabled: boolean) => {
    toggleAlertRule(id, enabled)
      .then((updated) => setRules((current) => current.map((rule) => (rule.id === id ? updated : rule))))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '切换规则状态失败'))
  }

  const handleDelete = (id: number) => {
    if (!confirm('确认删除此告警规则？')) return
    deleteAlertRule(id)
      .then(() => setRules((current) => current.filter((rule) => rule.id !== id)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '删除规则失败'))
  }

  const addChannel = (type: 'webhook' | 'dingtalk' | 'feishu') => {
    setFormChannels((current) => [...current, { type, webhook_url: '' }])
  }

  const updateChannel = (index: number, updates: Partial<NotificationChannel>) => {
    setFormChannels((current) => current.map((ch, i) => (i === index ? { ...ch, ...updates } : ch)))
  }

  const removeChannel = (index: number) => {
    setFormChannels((current) => current.filter((_, i) => i !== index))
  }

  const toggleNodeSelection = (nodeID: string) => {
    setFormScopeNodeIDs((current) =>
      current.includes(nodeID) ? current.filter((id) => id !== nodeID) : [...current, nodeID]
    )
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 shadow-glass">
        <p className="text-sm font-black text-muted-foreground">正在加载告警规则...</p>
      </section>
    )
  }

  return (
    <>
      {/* 创建按钮 */}
      <div className="flex items-center justify-end mb-4">
        <button
          type="button"
          onClick={openCreateForm}
          className="min-h-9 cursor-pointer rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground shadow-sm transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/20"
        >
          + 创建告警规则
        </button>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-glass">

        {error ? (
          <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-black text-danger">
            {error}
          </div>
        ) : null}

        {rules.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
            <p className="text-2xl font-black text-foreground">暂无告警规则</p>
            <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 text-muted-foreground">
              创建规则后，系统会自动监控指标并在触发时发送通知。
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/30"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-black text-foreground">{rule.name}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-black ${
                          rule.enabled
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {rule.enabled ? '启用' : '禁用'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-muted-foreground">
                      {metricFieldOptions.find((opt) => opt.value === rule.metric_field)?.label || rule.metric_field}{' '}
                      {operatorOptions.find((opt) => opt.value === rule.operator)?.label || rule.operator}{' '}
                      {rule.threshold}，持续 {rule.duration_seconds}秒
                    </p>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      范围：{rule.scope_type === 'all' ? '所有节点' : `指定节点 (${rule.scope_node_ids?.length || 0}个)`}
                      {' · '}
                      通知：{rule.notification_channels.length}个渠道
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(rule.id, !rule.enabled)}
                      className="min-h-9 cursor-pointer rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground transition hover:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/20"
                    >
                      {rule.enabled ? '禁用' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditForm(rule)}
                      className="min-h-9 cursor-pointer rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground transition hover:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/20"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(rule.id)}
                      className="min-h-9 cursor-pointer rounded-xl border border-danger/30 bg-card px-3 text-xs font-black text-danger transition hover:border-danger/50 focus:outline-none focus:ring-4 focus:ring-danger/20"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-code/35 px-3 py-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={formMode === 'create' ? '创建告警规则' : '编辑告警规则'}
            className="max-h-[calc(100vh-3rem)] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-border bg-card shadow-2xl"
          >
            <div className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4">
              <h3 className="text-lg font-black text-foreground">
                {formMode === 'create' ? '创建告警规则' : '编辑告警规则'}
              </h3>
            </div>

            <div className="space-y-4 p-5">
              <label className="block text-sm font-black text-foreground">
                规则名称
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="CPU 使用率过高"
                  className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm font-black text-foreground">
                  监控指标
                  <select
                    value={formMetricField}
                    onChange={(e) => setFormMetricField(e.target.value)}
                    className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
                  >
                    {metricFieldOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-black text-foreground">
                  比较运算符
                  <select
                    value={formOperator}
                    onChange={(e) => setFormOperator(e.target.value)}
                    className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
                  >
                    {operatorOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-black text-foreground">
                  阈值
                  <input
                    type="number"
                    step="0.01"
                    value={formThreshold}
                    onChange={(e) => setFormThreshold(e.target.value)}
                    className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
                  />
                </label>
              </div>

              <label className="block text-sm font-black text-foreground">
                持续时间（秒）
                <input
                  type="number"
                  value={formDuration}
                  onChange={(e) => setFormDuration(e.target.value)}
                  placeholder="300"
                  className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
                />
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  条件需要持续满足多少秒才触发告警（0 表示立即触发）
                </p>
              </label>

              <div className="space-y-2">
                <p className="text-sm font-black text-foreground">监控范围</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormScopeType('all')}
                    className={`min-h-10 cursor-pointer rounded-2xl px-4 text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${
                      formScopeType === 'all'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    所有节点
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormScopeType('nodes')}
                    className={`min-h-10 cursor-pointer rounded-2xl px-4 text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${
                      formScopeType === 'nodes'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    指定节点
                  </button>
                </div>

                {formScopeType === 'nodes' ? (
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-2xl border border-border bg-surface p-3">
                    {nodes.length === 0 ? (
                      <p className="text-xs font-semibold text-muted-foreground">暂无节点</p>
                    ) : (
                      nodes.map((node) => (
                        <label
                          key={node.id}
                          className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1 transition hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={formScopeNodeIDs.includes(node.id)}
                            onChange={() => toggleNodeSelection(node.id)}
                            className="h-4 w-4 cursor-pointer rounded border-border"
                          />
                          <span className="text-sm font-bold text-foreground">{node.name}</span>
                          <span className="text-xs font-semibold text-muted-foreground">({node.id})</span>
                        </label>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-foreground">通知渠道</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => addChannel('webhook')}
                      className="min-h-8 cursor-pointer rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground transition hover:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/20"
                    >
                      + Webhook
                    </button>
                    <button
                      type="button"
                      onClick={() => addChannel('dingtalk')}
                      className="min-h-8 cursor-pointer rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground transition hover:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/20"
                    >
                      + DingTalk
                    </button>
                    <button
                      type="button"
                      onClick={() => addChannel('feishu')}
                      className="min-h-8 cursor-pointer rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground transition hover:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/20"
                    >
                      + 飞书
                    </button>
                  </div>
                </div>

                {formChannels.length === 0 ? (
                  <p className="text-xs font-semibold text-muted-foreground">暂无通知渠道，点击上方按钮添加</p>
                ) : (
                  <div className="space-y-3">
                    {formChannels.map((channel, index) => (
                      <div key={index} className="rounded-2xl border border-border bg-surface p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-black uppercase text-primary">
                            {channel.type === 'webhook'
                              ? 'Webhook'
                              : channel.type === 'dingtalk'
                                ? 'DingTalk'
                                : '飞书'}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeChannel(index)}
                            className="text-xs font-black text-danger hover:underline"
                          >
                            删除
                          </button>
                        </div>
                        <input
                          type="text"
                          value={channel.webhook_url || ''}
                          onChange={(e) => updateChannel(index, { webhook_url: e.target.value })}
                          placeholder={
                            channel.type === 'webhook'
                              ? 'https://...'
                              : channel.type === 'dingtalk'
                              ? 'https://oapi.dingtalk.com/robot/send?access_token=...'
                              : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'
                          }
                          className="min-h-9 w-full rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
                        />
                        {channel.type === 'dingtalk' || channel.type === 'feishu' ? (
                          <input
                            type="text"
                            value={channel.secret || ''}
                            onChange={(e) => updateChannel(index, { secret: e.target.value })}
                            placeholder="Secret（可选，用于签名验证）"
                            className="mt-2 min-h-9 w-full rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {formError ? (
                <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-black text-danger">
                  {formError}
                </div>
              ) : null}
            </div>

            <div className="sticky bottom-0 border-t border-border bg-surface px-5 py-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveRule}
                  disabled={formSaving}
                  className="min-h-11 flex-1 cursor-pointer rounded-2xl bg-primary px-4 text-sm font-black text-primary-foreground shadow-sm transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {formSaving ? '保存中...' : '保存'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={formSaving}
                  className="min-h-11 cursor-pointer rounded-2xl border border-border bg-card px-4 text-sm font-black text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
