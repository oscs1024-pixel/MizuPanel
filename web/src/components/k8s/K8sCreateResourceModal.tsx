import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, FileCode2, Plus, X } from 'lucide-react'

import { applyK8sManifest } from '../../api/k8s'
import type { K8sNamespace } from '../../types'

type ResourceType =
  | 'deployment'
  | 'pod'
  | 'statefulset'
  | 'daemonset'
  | 'job'
  | 'cronjob'
  | 'service'
  | 'ingress'
  | 'configmap'
  | 'secret'
  | 'pvc'
  | 'custom'

type K8sCreateResourceModalProps = {
  open: boolean
  clusterId: string
  currentNamespace: string
  namespaces: K8sNamespace[]
  onClose: () => void
  onCreated: () => void
  onToast: (message: string, type: 'success' | 'error') => void
}

const resourceTypeLabels: Array<{ value: ResourceType; label: string }> = [
  { value: 'deployment', label: 'Deployment' },
  { value: 'pod', label: 'Pod' },
  { value: 'statefulset', label: 'StatefulSet' },
  { value: 'daemonset', label: 'DaemonSet' },
  { value: 'job', label: 'Job' },
  { value: 'cronjob', label: 'CronJob' },
  { value: 'service', label: 'Service' },
  { value: 'ingress', label: 'Ingress' },
  { value: 'configmap', label: 'ConfigMap' },
  { value: 'secret', label: 'Secret' },
  { value: 'pvc', label: 'PVC' },
  { value: 'custom', label: '自定义 YAML' },
]

const namespacedTypes = new Set<ResourceType>(['deployment', 'pod', 'statefulset', 'daemonset', 'job', 'cronjob', 'service', 'ingress', 'configmap', 'secret', 'pvc'])
const imageTypes = new Set<ResourceType>(['deployment', 'pod', 'statefulset', 'daemonset', 'job', 'cronjob'])
const replicaTypes = new Set<ResourceType>(['deployment', 'statefulset'])
const networkableTypes = new Set<ResourceType>(['deployment', 'pod', 'statefulset', 'daemonset'])

function defaultNamespace(currentNamespace: string, namespaces: K8sNamespace[]): string {
  const current = currentNamespace.trim()
  if (current) return current
  if (namespaces.some((item) => item.name === 'default')) return 'default'
  return namespaces[0]?.name || 'default'
}

function safeName(value: string, fallback: string): string {
  return value.trim() || fallback
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function parseKeyValues(value: string): Array<{ key: string; value: string }> {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=')
      if (index === -1) return { key: line, value: '' }
      return { key: line.slice(0, index).trim(), value: line.slice(index + 1).trim() }
    })
    .filter((item) => item.key)
}

function namespaceManifest(namespace: string): string {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ${namespace}
`
}

function containerBlock(name: string, image: string, port: string, envText: string, indent = '      '): string {
  const env = parseKeyValues(envText)
  const lines = [
    `${indent}- name: ${name}`,
    `${indent}  image: ${image}`,
  ]
  if (port.trim()) {
    lines.push(`${indent}  ports:`)
    lines.push(`${indent}  - containerPort: ${Number.parseInt(port, 10) || 80}`)
  }
  if (env.length > 0) {
    lines.push(`${indent}  env:`)
    env.forEach((item) => {
      lines.push(`${indent}  - name: ${item.key}`)
      lines.push(`${indent}    value: ${yamlString(item.value)}`)
    })
  }
  return lines.join('\n')
}

function serviceManifest(namespace: string, name: string, selector: string, serviceType: string, port: string, targetPort: string): string {
  const servicePort = Number.parseInt(port, 10) || 80
  const serviceTargetPort = Number.parseInt(targetPort, 10) || servicePort
  return `apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  type: ${serviceType}
  selector:
    app: ${selector}
  ports:
  - name: http
    port: ${servicePort}
    targetPort: ${serviceTargetPort}
`
}

function ingressManifest(namespace: string, name: string, host: string, serviceName: string, servicePort: string): string {
  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  rules:
  - host: ${yamlString(host || `${serviceName}.example.com`)}
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: ${serviceName}
            port:
              number: ${Number.parseInt(servicePort, 10) || 80}
`
}

export function K8sCreateResourceModal({ open, clusterId, currentNamespace, namespaces, onClose, onCreated, onToast }: K8sCreateResourceModalProps) {
  const [resourceType, setResourceType] = useState<ResourceType>('deployment')
  const [namespaceMode, setNamespaceMode] = useState<'existing' | 'create'>('existing')
  const [selectedNamespace, setSelectedNamespace] = useState(defaultNamespace(currentNamespace, namespaces))
  const [newNamespace, setNewNamespace] = useState('')
  const [name, setName] = useState('')
  const [image, setImage] = useState('')
  const [replicas, setReplicas] = useState('1')
  const [containerPort, setContainerPort] = useState('80')
  const [envText, setEnvText] = useState('')
  const [restartPolicy, setRestartPolicy] = useState('Always')
  const [schedule, setSchedule] = useState('*/5 * * * *')
  const [includeService, setIncludeService] = useState(false)
  const [includeIngress, setIncludeIngress] = useState(false)
  const [serviceType, setServiceType] = useState('ClusterIP')
  const [servicePort, setServicePort] = useState('80')
  const [ingressHost, setIngressHost] = useState('')
  const [configData, setConfigData] = useState('APP_ENV=production')
  const [secretData, setSecretData] = useState('PASSWORD=change-me')
  const [storageSize, setStorageSize] = useState('1Gi')
  const [accessMode, setAccessMode] = useState('ReadWriteOnce')
  const [customYAML, setCustomYAML] = useState(`apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-runner
  namespace: default
`)
  const [dryRunPassed, setDryRunPassed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    setResourceType('deployment')
    setNamespaceMode('existing')
    setSelectedNamespace(defaultNamespace(currentNamespace, namespaces))
    setNewNamespace('')
    setName('')
    setImage('')
    setReplicas('1')
    setContainerPort('80')
    setEnvText('')
    setRestartPolicy('Always')
    setSchedule('*/5 * * * *')
    setIncludeService(false)
    setIncludeIngress(false)
    setServiceType('ClusterIP')
    setServicePort('80')
    setIngressHost('')
    setConfigData('APP_ENV=production')
    setSecretData('PASSWORD=change-me')
    setStorageSize('1Gi')
    setAccessMode('ReadWriteOnce')
    setDryRunPassed(false)
    setError(undefined)
  }, [currentNamespace, namespaces, open])

  const namespace = namespaceMode === 'create' ? newNamespace.trim() : selectedNamespace.trim()
  const effectiveNamespace = namespace || 'default'
  const resourceName = safeName(name, resourceType === 'custom' ? 'custom-resource' : 'sample-app')
  const imageName = safeName(image, 'nginx:latest')
  const appLabel = resourceName

  const generatedYAML = useMemo(() => {
    if (resourceType === 'custom') return customYAML

    const docs: string[] = []
    if (namespaceMode === 'create' && newNamespace.trim()) {
      docs.push(namespaceManifest(newNamespace.trim()))
    }

    if (resourceType === 'deployment' || resourceType === 'statefulset' || resourceType === 'daemonset') {
      const kind = resourceType === 'deployment' ? 'Deployment' : resourceType === 'statefulset' ? 'StatefulSet' : 'DaemonSet'
      const apiVersion = 'apps/v1'
      const replicaLine = replicaTypes.has(resourceType) ? `  replicas: ${Number.parseInt(replicas, 10) || 1}\n` : ''
      const serviceNameLine = resourceType === 'statefulset' ? `  serviceName: ${resourceName}-headless\n` : ''
      if (resourceType === 'statefulset') {
        docs.push(serviceManifest(effectiveNamespace, `${resourceName}-headless`, appLabel, 'ClusterIP', servicePort, containerPort).replace('  type: ClusterIP\n', '  clusterIP: None\n'))
      }
      docs.push(`${apiVersion === 'apps/v1' ? 'apiVersion: apps/v1' : `apiVersion: ${apiVersion}`}
kind: ${kind}
metadata:
  name: ${resourceName}
  namespace: ${effectiveNamespace}
  labels:
    app: ${appLabel}
spec:
${replicaLine}${serviceNameLine}  selector:
    matchLabels:
      app: ${appLabel}
  template:
    metadata:
      labels:
        app: ${appLabel}
    spec:
      containers:
${containerBlock(resourceName, imageName, containerPort, envText)}
`)
    } else if (resourceType === 'pod') {
      docs.push(`apiVersion: v1
kind: Pod
metadata:
  name: ${resourceName}
  namespace: ${effectiveNamespace}
  labels:
    app: ${appLabel}
spec:
  restartPolicy: ${restartPolicy}
  containers:
${containerBlock(resourceName, imageName, containerPort, envText, '  ')}
`)
    } else if (resourceType === 'job' || resourceType === 'cronjob') {
      const jobSpec = `template:
      metadata:
        labels:
          app: ${appLabel}
      spec:
        restartPolicy: OnFailure
        containers:
${containerBlock(resourceName, imageName, '', envText, '        ')}
`
      if (resourceType === 'cronjob') {
        docs.push(`apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${resourceName}
  namespace: ${effectiveNamespace}
spec:
  schedule: ${yamlString(schedule)}
  jobTemplate:
    spec:
      ${jobSpec}`)
      } else {
        docs.push(`apiVersion: batch/v1
kind: Job
metadata:
  name: ${resourceName}
  namespace: ${effectiveNamespace}
spec:
  ${jobSpec}`)
      }
    } else if (resourceType === 'service') {
      docs.push(serviceManifest(effectiveNamespace, resourceName, appLabel, serviceType, servicePort, containerPort))
    } else if (resourceType === 'ingress') {
      docs.push(ingressManifest(effectiveNamespace, resourceName, ingressHost, resourceName, servicePort))
    } else if (resourceType === 'configmap') {
      const items = parseKeyValues(configData)
      docs.push(`apiVersion: v1
kind: ConfigMap
metadata:
  name: ${resourceName}
  namespace: ${effectiveNamespace}
data:
${items.length === 0 ? '  APP_ENV: "production"' : items.map((item) => `  ${item.key}: ${yamlString(item.value)}`).join('\n')}
`)
    } else if (resourceType === 'secret') {
      const items = parseKeyValues(secretData)
      docs.push(`apiVersion: v1
kind: Secret
metadata:
  name: ${resourceName}
  namespace: ${effectiveNamespace}
type: Opaque
stringData:
${items.length === 0 ? '  PASSWORD: "change-me"' : items.map((item) => `  ${item.key}: ${yamlString(item.value)}`).join('\n')}
`)
    } else if (resourceType === 'pvc') {
      docs.push(`apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${resourceName}
  namespace: ${effectiveNamespace}
spec:
  accessModes:
  - ${accessMode}
  resources:
    requests:
      storage: ${storageSize || '1Gi'}
`)
    }

    if (networkableTypes.has(resourceType) && includeService) {
      const serviceName = `${resourceName}-svc`
      docs.push(serviceManifest(effectiveNamespace, serviceName, appLabel, serviceType, servicePort, containerPort))
      if (includeIngress) {
        docs.push(ingressManifest(effectiveNamespace, `${resourceName}-ingress`, ingressHost, serviceName, servicePort))
      }
    }

    return docs.join('---\n')
  }, [accessMode, configData, containerPort, customYAML, effectiveNamespace, envText, imageName, includeIngress, includeService, ingressHost, namespaceMode, newNamespace, replicas, resourceName, resourceType, restartPolicy, schedule, secretData, servicePort, serviceType, storageSize])

  useEffect(() => {
    setDryRunPassed(false)
  }, [generatedYAML])

  if (!open) return null

  const validate = () => {
    if (!generatedYAML.trim()) return 'YAML 不能为空'
    if (resourceType === 'custom') return undefined
    if (namespacedTypes.has(resourceType) && !effectiveNamespace) return '命名空间不能为空'
    if (!name.trim()) return '资源名称不能为空'
    if (imageTypes.has(resourceType) && !image.trim()) return '镜像不能为空'
    if (namespaceMode === 'create' && !newNamespace.trim()) return '新命名空间不能为空'
    return undefined
  }

  const runApply = async (dryRun: boolean) => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      await applyK8sManifest(clusterId, { yaml: generatedYAML, dry_run: dryRun })
      if (dryRun) {
        setDryRunPassed(true)
        onToast('资源校验成功', 'success')
        return
      }
      onToast('资源创建成功', 'success')
      onCreated()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      onToast(`${dryRun ? '资源校验' : '资源创建'}失败: ${message}`, 'error')
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const copyYAML = async () => {
    try {
      await navigator.clipboard.writeText(generatedYAML)
      onToast('YAML复制成功', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : '浏览器拒绝复制'
      onToast(`YAML复制失败: ${message}`, 'error')
    }
  }

  return (
    <div className="soft-modal-overlay fixed inset-0 z-[70] flex items-center justify-center px-3 py-5" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section role="dialog" aria-modal="true" aria-label="创建 Kubernetes 资源" className="soft-modal-shell flex max-h-[92vh] w-full max-w-7xl flex-col outline-none">
        <header className="soft-modal-header flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-base font-black text-foreground">创建 Kubernetes 资源</h2>
                <p className="mt-0.5 text-xs font-bold text-muted-foreground">Dry Run 通过后提交</p>
              </div>
            </div>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="soft-button inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-card text-muted-foreground hover:text-foreground focus:outline-none focus:ring-4 focus:ring-primary/20">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(360px,0.86fr)_minmax(420px,1.14fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/80 bg-surface/70 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-black text-muted-foreground">
                  资源类型
                  <select
                    aria-label="资源类型"
                    value={resourceType}
                    onChange={(event) => setResourceType(event.target.value as ResourceType)}
                    className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold"
                  >
                    {resourceTypeLabels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>

                {resourceType !== 'custom' && (
                  <label className="text-xs font-black text-muted-foreground">
                    目标命名空间
                    <select
                      aria-label="目标命名空间"
                      value={namespaceMode === 'create' ? '__create__' : selectedNamespace}
                      onChange={(event) => {
                        if (event.target.value === '__create__') {
                          setNamespaceMode('create')
                          return
                        }
                        setNamespaceMode('existing')
                        setSelectedNamespace(event.target.value)
                      }}
                      className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold"
                    >
                      {namespaces.length === 0 && <option value={selectedNamespace}>{selectedNamespace}</option>}
                      {namespaces.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                      <option value="__create__">创建命名空间</option>
                    </select>
                  </label>
                )}
              </div>

              {resourceType !== 'custom' && namespaceMode === 'create' && (
                <label className="mt-3 block text-xs font-black text-muted-foreground">
                  新命名空间
                  <input
                    aria-label="新命名空间"
                    type="text"
                    value={newNamespace}
                    onChange={(event) => setNewNamespace(event.target.value)}
                    placeholder="staging"
                    className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold placeholder:text-muted-foreground"
                  />
                </label>
              )}
            </div>

            {resourceType === 'custom' ? (
              <div className="rounded-2xl border border-border/80 bg-surface/70 p-4">
                <label className="text-xs font-black text-muted-foreground">
                  自定义 YAML
                  <textarea
                    value={customYAML}
                    onChange={(event) => setCustomYAML(event.target.value)}
                    className="soft-input mt-2 min-h-[360px] w-full resize-y px-3 py-3 font-mono text-xs leading-relaxed"
                    spellCheck={false}
                  />
                </label>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-border/80 bg-surface/70 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-black text-muted-foreground">
                      资源名称
                      <input aria-label="资源名称" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="web" className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold placeholder:text-muted-foreground" />
                    </label>

                    {imageTypes.has(resourceType) && (
                      <label className="text-xs font-black text-muted-foreground">
                        镜像
                        <input aria-label="镜像" type="text" value={image} onChange={(event) => setImage(event.target.value)} placeholder="nginx:1.27" className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold placeholder:text-muted-foreground" />
                      </label>
                    )}

                    {replicaTypes.has(resourceType) && (
                      <label className="text-xs font-black text-muted-foreground">
                        副本数
                        <input aria-label="副本数" inputMode="numeric" value={replicas} onChange={(event) => setReplicas(event.target.value.replace(/[^\d]/g, ''))} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold" />
                      </label>
                    )}

                    {imageTypes.has(resourceType) && resourceType !== 'job' && resourceType !== 'cronjob' && (
                      <label className="text-xs font-black text-muted-foreground">
                        容器端口
                        <input aria-label="容器端口" inputMode="numeric" value={containerPort} onChange={(event) => setContainerPort(event.target.value.replace(/[^\d]/g, ''))} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold" />
                      </label>
                    )}

                    {resourceType === 'pod' && (
                      <label className="text-xs font-black text-muted-foreground">
                        重启策略
                        <select aria-label="重启策略" value={restartPolicy} onChange={(event) => setRestartPolicy(event.target.value)} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold">
                          <option value="Always">Always</option>
                          <option value="OnFailure">OnFailure</option>
                          <option value="Never">Never</option>
                        </select>
                      </label>
                    )}

                    {resourceType === 'cronjob' && (
                      <label className="text-xs font-black text-muted-foreground">
                        调度
                        <input aria-label="调度" value={schedule} onChange={(event) => setSchedule(event.target.value)} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold" />
                      </label>
                    )}

                    {(resourceType === 'service' || resourceType === 'ingress') && (
                      <label className="text-xs font-black text-muted-foreground">
                        服务端口
                        <input aria-label="服务端口" inputMode="numeric" value={servicePort} onChange={(event) => setServicePort(event.target.value.replace(/[^\d]/g, ''))} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold" />
                      </label>
                    )}

                    {resourceType === 'service' && (
                      <label className="text-xs font-black text-muted-foreground">
                        Service 类型
                        <select aria-label="Service 类型" value={serviceType} onChange={(event) => setServiceType(event.target.value)} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold">
                          <option value="ClusterIP">ClusterIP</option>
                          <option value="NodePort">NodePort</option>
                          <option value="LoadBalancer">LoadBalancer</option>
                        </select>
                      </label>
                    )}

                    {resourceType === 'ingress' && (
                      <label className="text-xs font-black text-muted-foreground sm:col-span-2">
                        Host
                        <input aria-label="Host" value={ingressHost} onChange={(event) => setIngressHost(event.target.value)} placeholder="web.example.com" className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold placeholder:text-muted-foreground" />
                      </label>
                    )}

                    {resourceType === 'pvc' && (
                      <>
                        <label className="text-xs font-black text-muted-foreground">
                          容量
                          <input aria-label="容量" value={storageSize} onChange={(event) => setStorageSize(event.target.value)} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold" />
                        </label>
                        <label className="text-xs font-black text-muted-foreground">
                          访问模式
                          <select aria-label="访问模式" value={accessMode} onChange={(event) => setAccessMode(event.target.value)} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold">
                            <option value="ReadWriteOnce">ReadWriteOnce</option>
                            <option value="ReadOnlyMany">ReadOnlyMany</option>
                            <option value="ReadWriteMany">ReadWriteMany</option>
                          </select>
                        </label>
                      </>
                    )}
                  </div>

                  {imageTypes.has(resourceType) && (
                    <label className="mt-3 block text-xs font-black text-muted-foreground">
                      环境变量
                      <textarea value={envText} onChange={(event) => setEnvText(event.target.value)} placeholder="KEY=value" className="soft-input mt-1 min-h-[86px] w-full resize-y px-3 py-2 font-mono text-xs placeholder:text-muted-foreground" />
                    </label>
                  )}

                  {resourceType === 'configmap' && (
                    <label className="mt-3 block text-xs font-black text-muted-foreground">
                      ConfigMap 数据
                      <textarea value={configData} onChange={(event) => setConfigData(event.target.value)} className="soft-input mt-1 min-h-[120px] w-full resize-y px-3 py-2 font-mono text-xs" />
                    </label>
                  )}

                  {resourceType === 'secret' && (
                    <label className="mt-3 block text-xs font-black text-muted-foreground">
                      Secret 数据
                      <textarea value={secretData} onChange={(event) => setSecretData(event.target.value)} className="soft-input mt-1 min-h-[120px] w-full resize-y px-3 py-2 font-mono text-xs" />
                    </label>
                  )}
                </div>

                {networkableTypes.has(resourceType) && (
                  <div className="rounded-2xl border border-border/80 bg-surface/70 p-4">
                    <label className="flex items-center gap-2 text-sm font-black text-foreground">
                      <input type="checkbox" checked={includeService} onChange={(event) => setIncludeService(event.target.checked)} className="h-4 w-4 accent-primary" />
                      同时创建 Service
                    </label>
                    {includeService && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <label className="text-xs font-black text-muted-foreground">
                          Service 类型
                          <select value={serviceType} onChange={(event) => setServiceType(event.target.value)} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold">
                            <option value="ClusterIP">ClusterIP</option>
                            <option value="NodePort">NodePort</option>
                            <option value="LoadBalancer">LoadBalancer</option>
                          </select>
                        </label>
                        <label className="text-xs font-black text-muted-foreground">
                          Service 端口
                          <input inputMode="numeric" value={servicePort} onChange={(event) => setServicePort(event.target.value.replace(/[^\d]/g, ''))} className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold" />
                        </label>
                        <label className="flex items-end gap-2 pb-3 text-sm font-black text-foreground">
                          <input type="checkbox" checked={includeIngress} onChange={(event) => setIncludeIngress(event.target.checked)} className="h-4 w-4 accent-primary" />
                          创建 Ingress
                        </label>
                        {includeIngress && (
                          <label className="text-xs font-black text-muted-foreground sm:col-span-3">
                            Ingress Host
                            <input value={ingressHost} onChange={(event) => setIngressHost(event.target.value)} placeholder="web.example.com" className="soft-input mt-1 h-11 w-full px-3 text-sm font-bold placeholder:text-muted-foreground" />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
                {error}
              </div>
            )}
          </div>

          <div className="flex min-h-[520px] flex-col rounded-2xl border border-border/80 bg-code/95">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-black text-primary-foreground">
                <FileCode2 className="h-4 w-4" aria-hidden="true" />
                YAML
              </div>
              <button type="button" onClick={copyYAML} className="soft-button inline-flex h-9 items-center gap-1.5 border border-white/10 bg-white/10 px-3 text-xs font-black text-primary-foreground hover:bg-white/15">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                复制
              </button>
            </div>
            <textarea
              aria-label="YAML 预览"
              readOnly={resourceType !== 'custom'}
              value={generatedYAML}
              onChange={(event) => setCustomYAML(event.target.value)}
              className="min-h-0 flex-1 resize-none overflow-auto bg-transparent px-4 py-4 font-mono text-xs leading-relaxed text-primary-foreground outline-none"
              spellCheck={false}
            />
          </div>
        </div>

        <footer className="soft-modal-footer flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
          <div className="text-xs font-bold text-muted-foreground">
            {dryRunPassed ? (
              <span className="inline-flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Dry Run 已通过</span>
            ) : '等待 Dry Run'}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className="soft-button min-h-11 border border-border bg-card px-4 text-sm font-black text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
              取消
            </button>
            <button type="button" onClick={() => runApply(true)} disabled={submitting} className="soft-button inline-flex min-h-11 items-center gap-2 border border-primary/30 bg-primary/10 px-4 text-sm font-black text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? '校验中...' : 'Dry Run'}
            </button>
            <button type="button" onClick={() => runApply(false)} disabled={submitting || !dryRunPassed} className="soft-button min-h-11 bg-primary px-5 text-sm font-black text-primary-foreground shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
              创建资源
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
