'use client'

import { useState, useMemo, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SourceListResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  FileText,
  Link2,
  ChevronDown,
  Loader2,
  ListChecks,
  Search,
  CheckCircle2,
  Brain,
  ExternalLink,
  PlayCircle,
  Activity,
  Compass,
  Route,
  Target,
  BookOpenCheck,
  Gauge,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { AddExistingSourceDialog } from '@/components/sources/AddExistingSourceDialog'
import { SourceCard } from '@/components/sources/SourceCard'
import { useCreateSource, useDeleteSource, useRetrySource, useRemoveSourceFromNotebook, useUpdateSource } from '@/lib/hooks/use-sources'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { ContextMode } from '../[id]/page'
import type { SourceBulkAction } from '@/lib/utils/source-context'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { commandsApi } from '@/lib/api/commands'
import { learningApi } from '@/lib/api/learning'
import type { LearningCollectedResource } from '@/lib/types/learning'
import { toast } from 'sonner'
import type { LearningProfileSourceResponse } from '@/lib/types/learning'
import { cn } from '@/lib/utils'

const LEARNING_PROFILE_TOPIC = 'learning_profile'
const LEARNING_PROFILE_TITLE = '学习画像'
const RESOURCE_CONTENT_LABELS: Record<string, string> = {
  video: '视频',
  article: '文章',
  webpage: '网页',
  paper: '论文',
  course: '课程',
  practice: '练习',
  code: '代码',
}

const ACTIVE_JOB_STATUSES = new Set(['new', 'queued', 'running'])

function extractCollectedResources(result: Record<string, unknown> | null | undefined) {
  const direct = result?.collected_resources
  if (Array.isArray(direct)) {
    return direct as LearningCollectedResource[]
  }

  const response = result?.response
  if (
    response &&
    typeof response === 'object' &&
    Array.isArray((response as Record<string, unknown>).collected_resources)
  ) {
    return (response as Record<string, unknown>).collected_resources as LearningCollectedResource[]
  }

  return []
}

type PersistedResourceSearch = {
  goal: string
  jobId: string | null
  resources: LearningCollectedResource[]
}

function resourceSearchStorageKey(notebookId: string) {
  return `forgenote:resource-search:${notebookId}`
}

function readPersistedResourceSearch(notebookId: string): PersistedResourceSearch | null {
  if (typeof window === 'undefined' || !notebookId) return null
  try {
    const raw = window.sessionStorage.getItem(resourceSearchStorageKey(notebookId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedResourceSearch>
    return {
      goal: typeof parsed.goal === 'string' ? parsed.goal : '',
      jobId: typeof parsed.jobId === 'string' ? parsed.jobId : null,
      resources: Array.isArray(parsed.resources) ? parsed.resources : [],
    }
  } catch {
    return null
  }
}

function persistResourceSearch(
  notebookId: string,
  state: PersistedResourceSearch
) {
  if (typeof window === 'undefined' || !notebookId) return
  try {
    window.sessionStorage.setItem(resourceSearchStorageKey(notebookId), JSON.stringify(state))
  } catch {
    // Browsing can continue even when storage is unavailable or full.
  }
}

function isLearningProfileSource(source: SourceListResponse) {
  return source.title === LEARNING_PROFILE_TITLE || source.topics?.includes(LEARNING_PROFILE_TOPIC)
}

type LearningProfileForm = {
  major: string
  knowledge: string
  goal: string
  cognitiveStyle: string
  pace: string
  risks: string
  preference: string
  motivation: string
  eventsText: string
}

const DEFAULT_LEARNING_PROFILE_FORM: LearningProfileForm = {
  major: '尚未明确。',
  knowledge: '尚未明确。',
  goal: '尚未明确。',
  cognitiveStyle: '尚未明确。',
  pace: '尚未明确。',
  risks: '等待 Quiz、对话、资料采纳和生成资产后的学习信号更新。',
  preference: '优先使用已采纳来源和用户上传资料。',
  motivation: '尚未明确。',
  eventsText: '',
}

const PROFILE_DIMENSIONS: Array<{
  key: keyof Omit<LearningProfileForm, 'eventsText'>
  label: string
  accent: string
  icon: ReactNode
  placeholder: string
}> = [
  {
    key: 'major',
    label: '专业背景',
    accent: 'border-sky-200 bg-sky-50/80 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
    icon: <BookOpenCheck className="h-4 w-4" />,
    placeholder: '例如：计算机大二，学过高数和 Python。',
  },
  {
    key: 'knowledge',
    label: '知识基础',
    accent: 'border-cyan-200 bg-cyan-50/80 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-300',
    icon: <Gauge className="h-4 w-4" />,
    placeholder: '例如：理解基本概念，但公式推导和独立应用不稳。',
  },
  {
    key: 'goal',
    label: '学习目标',
    accent: 'border-violet-200 bg-violet-50/80 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300',
    icon: <Target className="h-4 w-4" />,
    placeholder: '例如：读完 D2L 并能独立复现核心模型。',
  },
  {
    key: 'cognitiveStyle',
    label: '认知风格',
    accent: 'border-fuchsia-200 bg-fuchsia-50/80 text-fuchsia-700 dark:border-fuchsia-900/60 dark:bg-fuchsia-950/30 dark:text-fuchsia-300',
    icon: <Brain className="h-4 w-4" />,
    placeholder: '例如：先看结构图，再用例题和代码验证理解。',
  },
  {
    key: 'pace',
    label: '学习节奏',
    accent: 'border-amber-200 bg-amber-50/80 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
    icon: <Activity className="h-4 w-4" />,
    placeholder: '例如：工作日每天 30 分钟，周末集中复盘。',
  },
  {
    key: 'risks',
    label: '易错点',
    accent: 'border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
    icon: <AlertTriangle className="h-4 w-4" />,
    placeholder: '例如：容易混淆损失函数、优化器和评价指标。',
  },
  {
    key: 'preference',
    label: '资源偏好',
    accent: 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
    icon: <Compass className="h-4 w-4" />,
    placeholder: '例如：优先使用已采纳来源和用户上传资料。',
  },
  {
    key: 'motivation',
    label: '学习动机',
    accent: 'border-orange-200 bg-orange-50/80 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300',
    icon: <Sparkles className="h-4 w-4" />,
    placeholder: '例如：三周后通过期末考试，并能完成课程项目。',
  },
]

function extractLearningProfileEvents(content?: string | null) {
  return (content || '')
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s*/, ''))
    .filter((line) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}Z\s+\[/.test(line))
}

type FriendlyLearningProfileEvent = {
  key: string
  label: string
  summary: string
  timeLabel: string
}

function parseLearningProfileEventParams(rawParams: string) {
  return rawParams
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, part) => {
      const separator = part.indexOf('=')
      if (separator === -1) {
        return accumulator
      }
      const key = part.slice(0, separator).trim()
      const value = part.slice(separator + 1).trim()
      if (key && value && value !== 'none') {
        accumulator[key] = value
      }
      return accumulator
    }, {})
}

function shortLearningGoal(value?: string) {
  if (!value) {
    return ''
  }
  const assetType = value.match(/资产类型[:：]\s*([^。\n;；]+)/)?.[1]
  const format = value.match(/具体格式[:：]\s*([^。\n;；]+)/)?.[1]
  if (assetType || format) {
    return [assetType, format].filter(Boolean).join(' · ')
  }
  return value.replace(/\s+/g, ' ').slice(0, 64)
}

function formatLearningProfileEvent(line: string): FriendlyLearningProfileEvent | null {
  const eventMatch = line.match(
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}Z)\s+\[([^\]]+)\]\s*(.*)$/
  )
  if (!eventMatch) {
    return null
  }

  const [, rawTime, eventType, rawParams] = eventMatch
  const params = parseLearningProfileEventParams(rawParams)
  const fallback = shortLearningGoal(params.summary || params.goal || params.message || rawParams)
  let label = '学习记录'
  let summary = fallback || '记录了一次学习行为'

  if (eventType === 'collect_request') {
    label = '收集资料'
    summary = shortLearningGoal(params.goal || params.message) || '添加或搜索了学习资料'
  } else if (eventType === 'generate_request') {
    label = '生成资产'
    summary = shortLearningGoal(params.goal || params.message) || '生成了学习资产'
  } else if (eventType === 'quiz_answer') {
    label = '测验练习'
    summary = shortLearningGoal(params.summary || params.message) || '完成了一道测验题'
  } else if (eventType.includes('chat')) {
    label = '模型问答'
    summary = shortLearningGoal(params.summary || params.message) || '进行了一次问答'
  }

  const parsedDate = new Date(rawTime.replace(' ', 'T'))
  const timeLabel = Number.isNaN(parsedDate.getTime())
    ? rawTime
    : parsedDate.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })

  return {
    key: `${rawTime}-${eventType}-${summary}`,
    label,
    summary,
    timeLabel,
  }
}

function formatLearningProfileEvents(events: string[]) {
  const seen = new Set<string>()
  const friendlyEvents: FriendlyLearningProfileEvent[] = []

  for (const event of [...events].reverse()) {
    const formatted = formatLearningProfileEvent(event)
    if (!formatted) {
      continue
    }
    const signature = `${formatted.label}:${formatted.summary}`
    if (seen.has(signature)) {
      continue
    }
    seen.add(signature)
    friendlyEvents.push(formatted)
    if (friendlyEvents.length >= 5) {
      break
    }
  }

  return friendlyEvents
}

function parseLearningProfile(content?: string | null) {
  const lines = (content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const fields: Record<string, string> = {}
  const events: string[] = []

  for (const line of lines) {
    const clean = line.replace(/^[-*]\s*/, '')
    const fieldMatch = clean.match(
      /^(专业背景|知识基础|学习目标|认知风格|学习节奏|易错点|资源偏好|学习动机|背景|当前目标)[:：]\s*(.+)$/
    )
    if (fieldMatch) {
      fields[fieldMatch[1]] = fieldMatch[2]
      continue
    }
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}Z\s+\[/.test(clean)) {
      events.push(clean)
    }
  }

  return {
    major: fields['专业背景'] || fields['背景'] || '尚未明确',
    knowledge: fields['知识基础'] || '尚未明确',
    goal: fields['学习目标'] || fields['当前目标'] || '尚未明确',
    cognitiveStyle: fields['认知风格'] || '尚未明确',
    pace: fields['学习节奏'] || '尚未明确',
    risks: fields['易错点'] || '等待学习信号更新',
    preference: fields['资源偏好'] || '优先使用已采纳来源和用户上传资料',
    motivation: fields['学习动机'] || '尚未明确',
    events: formatLearningProfileEvents(events),
  }
}

const PROFILE_TOPIC_KEYWORDS = [
  '一阶谓词逻辑',
  '谓词逻辑',
  '产生式表示法',
  '产生式',
  '框架表示法',
  '框架',
  '知识表示',
  '量词',
  '辖域',
  '槽',
  '侧面',
  '规则库',
  '综合数据库',
  '控制系统',
  '蕴含',
  '不确定知识',
]

function uniqueCompactItems(items: string[], limit = 5) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const clean = item.trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
    if (result.length >= limit) break
  }
  return result
}

function stripProfileLogPrefix(value: string) {
  return value
    .replace(/^Prompt[:：]\s*/i, '')
    .replace(/^错题暴露[:：]\s*/i, '')
    .replace(/^需要澄清[:：]\s*/i, '')
    .replace(/^弄清[「"]?/, '')
    .replace(/[」"]$/g, '')
    .trim()
}

function extractProfileTopics(value: string) {
  const hits = PROFILE_TOPIC_KEYWORDS.filter((keyword) => value.includes(keyword))
  if (hits.length > 0) {
    return uniqueCompactItems(hits, 5)
  }
  return uniqueCompactItems(
    value
      .split(/[；;。.\n]/)
      .map(stripProfileLogPrefix)
      .map((item) => item.replace(/[？?].*$/, '').slice(0, 18))
      .filter(Boolean),
    4
  )
}

function simplifyProfileBackground(value: string, goalValue: string) {
  const combined = `${value} ${goalValue}`
  const parts: string[] = []
  if (/人工智能|AI/i.test(combined)) parts.push('人工智能相关课程学习者')
  if (/大一|一年级/.test(combined)) parts.push('大一阶段')
  if (/期末|考试|复习/.test(combined)) parts.push('正在准备期末复习')
  const topics = extractProfileTopics(combined).filter((topic) => !['人工智能'].includes(topic))
  if (topics.length > 0) parts.push(`近期重点：${topics.slice(0, 3).join('、')}`)
  if (parts.length > 0) return parts.join('；')
  return value.replace(/\s+/g, ' ').slice(0, 90)
}

function simplifyProfileGoal(value: string) {
  const topics = extractProfileTopics(value)
  if (topics.length > 0) {
    return `围绕 ${topics.slice(0, 4).join('、')} 做期末复习，重点把概念、表示方法和典型题型讲清楚。`
  }
  return value.replace(/\s+/g, ' ').slice(0, 100)
}

function simplifyProfileRisks(value: string) {
  const topics = extractProfileTopics(value)
  if (topics.length > 0) {
    return `薄弱点集中在：${topics.slice(0, 5).join('、')}。建议优先用错题解析和相似题巩固。`
  }
  return value.replace(/\s+/g, ' ').slice(0, 110)
}

function simplifyProfilePreference(value: string) {
  if (/来源|资料|上传|笔记|字幕|采纳/.test(value)) {
    return '优先使用已采纳来源、上传资料、课堂笔记和生成字幕；推荐内容需要能直接服务复习和练习。'
  }
  return value.replace(/\s+/g, ' ').slice(0, 100)
}

function simplifyLearningProfileForm(form: LearningProfileForm): LearningProfileForm {
  return {
    ...form,
    major: simplifyProfileBackground(form.major, form.goal),
    goal: simplifyProfileGoal(form.goal),
    risks: simplifyProfileRisks(form.risks),
    preference: simplifyProfilePreference(form.preference),
  }
}

function learningProfileFormFromContent(content?: string | null): LearningProfileForm {
  const parsed = parseLearningProfile(content)
  return simplifyLearningProfileForm({
    major: parsed.major,
    knowledge: parsed.knowledge,
    goal: parsed.goal,
    cognitiveStyle: parsed.cognitiveStyle,
    pace: parsed.pace,
    risks: parsed.risks,
    preference: parsed.preference,
    motivation: parsed.motivation,
    eventsText: extractLearningProfileEvents(content).join('\n'),
  })
}

function serializeLearningProfileForm(form: LearningProfileForm) {
  const events = form.eventsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return [
    '稳定画像',
    `专业背景：${form.major.trim() || DEFAULT_LEARNING_PROFILE_FORM.major}`,
    `知识基础：${form.knowledge.trim() || DEFAULT_LEARNING_PROFILE_FORM.knowledge}`,
    `学习目标：${form.goal.trim() || DEFAULT_LEARNING_PROFILE_FORM.goal}`,
    `认知风格：${form.cognitiveStyle.trim() || DEFAULT_LEARNING_PROFILE_FORM.cognitiveStyle}`,
    `学习节奏：${form.pace.trim() || DEFAULT_LEARNING_PROFILE_FORM.pace}`,
    `易错点：${form.risks.trim() || DEFAULT_LEARNING_PROFILE_FORM.risks}`,
    `资源偏好：${form.preference.trim() || DEFAULT_LEARNING_PROFILE_FORM.preference}`,
    `学习动机：${form.motivation.trim() || DEFAULT_LEARNING_PROFILE_FORM.motivation}`,
    '',
    '最近学习信号',
    ...(events.length > 0 ? events : ['等待新的学习行为。']),
  ].join('\n')
}

function buildAdaptiveLearningSummary(form: LearningProfileForm, sourceCount: number) {
  const events = form.eventsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const quizEvents = events.filter((line) => line.includes('[quiz_answer]'))
  const incorrectQuizEvents = quizEvents.filter((line) => /\bincorrect\b/i.test(line))
  const correctQuizEvents = quizEvents.filter((line) => /\bcorrect\b/i.test(line) && !/\bincorrect\b/i.test(line))
  const chatEvents = events.filter((line) => line.includes('[chat_message]'))
  const generatedEvents = events.filter((line) => line.includes('[generate_request]'))
  const collectedEvents = events.filter(
    (line) => line.includes('[collect_request]') || line.includes('[source_accept]')
  )
  const attemptedQuizCount = correctQuizEvents.length + incorrectQuizEvents.length
  const accuracy = attemptedQuizCount > 0 ? Math.round((correctQuizEvents.length / attemptedQuizCount) * 100) : null
  const weakSignal =
    incorrectQuizEvents.length > 0 || /错|混淆|不懂|失败|报错|incorrect/i.test(form.risks)

  const evaluation = accuracy === null
    ? '测验数据还不够，先通过 Quiz 和相似题练习建立评估基线。'
    : weakSignal
      ? `当前正确率约 ${accuracy}%，需要优先处理错题暴露的概念边界和易混点。`
      : `当前正确率约 ${accuracy}%，基础掌握较稳，可以进入迁移应用和综合练习。`

  const strategy = weakSignal
    ? '资源推送优先选择已有来源中的解释、例题、错题解析和短视频讲解；暂缓扩展过深论文。'
    : collectedEvents.length > 0 || sourceCount > 0
      ? '资源推送以已采纳资料为主，补充经典论文、官方教程和高相关拓展阅读。'
      : '先补充核心来源资料，再生成测验、闪卡和导图，避免缺少依据。'

  const plan = [
    weakSignal ? '先复盘错题和易混点' : '继续巩固核心概念',
    generatedEvents.length > 0 ? '用已生成资产做二轮复习' : '生成测验和闪卡建立练习闭环',
    chatEvents.length > 0 ? '把对话中的疑问转成复习卡片' : '在问答区追问不清楚的概念边界',
  ].join(' → ')

  return {
    evaluation,
    strategy,
    plan,
    metrics: [
      `练习 ${attemptedQuizCount || 0} 题`,
      accuracy === null ? '正确率待评估' : `正确率 ${accuracy}%`,
      `资料 ${Math.max(sourceCount, collectedEvents.length)} 份`,
      `问答 ${chatEvents.length} 次`,
    ],
  }
}

function LearningProfileAvatar({
  profile,
  isLoading,
  onEdit,
}: {
  profile?: LearningProfileSourceResponse
  isLoading: boolean
  onEdit: () => void
}) {
  const parsed = parseLearningProfile(profile?.content)
  const hasEvents = parsed.events.length > 0

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="relative h-9 w-9 shrink-0 rounded-full text-primary"
      onClick={onEdit}
      disabled={isLoading || !profile?.source_id}
      title="学习画像"
      aria-label="学习画像"
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
      {hasEvents && (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
      )}
    </Button>
  )
}

interface SourcesColumnProps {
  sources?: SourceListResponse[]
  isLoading: boolean
  notebookId: string
  notebookName?: string
  onRefresh?: () => void
  contextSelections?: Record<string, ContextMode>
  onContextModeChange?: (sourceId: string, mode: ContextMode) => void
  onBulkContextModeChange?: (action: SourceBulkAction) => void
  // Pagination props
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
  initialResourceSearchGoal?: string
  autoCollectInitialResourceSearch?: boolean
  profileOpenSignal?: number
}

export function SourcesColumn({
  sources,
  isLoading,
  notebookId,
  notebookName,
  onRefresh,
  contextSelections,
  onContextModeChange,
  onBulkContextModeChange,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  initialResourceSearchGoal = '',
  autoCollectInitialResourceSearch = false,
  profileOpenSignal = 0,
}: SourcesColumnProps) {
  const { t } = useTranslation()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addExistingDialogOpen, setAddExistingDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sourceToDelete, setSourceToDelete] = useState<string | null>(null)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [sourceToRemove, setSourceToRemove] = useState<string | null>(null)
  const [resourceSearchGoal, setResourceSearchGoal] = useState(initialResourceSearchGoal)
  const [resourceSearchExpanded, setResourceSearchExpanded] = useState(
    Boolean(initialResourceSearchGoal.trim())
  )
  const [collectedResources, setCollectedResources] = useState<LearningCollectedResource[]>([])
  const [acceptedResourceUrls, setAcceptedResourceUrls] = useState<Record<string, boolean>>({})
  const [acceptingResourceIds, setAcceptingResourceIds] = useState<Record<string, boolean>>({})
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [profileForm, setProfileForm] = useState<LearningProfileForm>(DEFAULT_LEARNING_PROFILE_FORM)
  const [isCollectingResources, setIsCollectingResources] = useState(false)
  const [resourceSearchJobId, setResourceSearchJobId] = useState<string | null>(null)
  const [handledResourceSearchJobId, setHandledResourceSearchJobId] = useState<string | null>(null)

  const { openModal } = useModalManager()
  const createSource = useCreateSource()
  const deleteSource = useDeleteSource()
  const retrySource = useRetrySource()
  const removeFromNotebook = useRemoveSourceFromNotebook()
  const updateSource = useUpdateSource()
  const { data: resourceSearchJob } = useQuery({
    queryKey: ['commands', 'job', resourceSearchJobId],
    queryFn: () => commandsApi.getJob(resourceSearchJobId as string),
    enabled: Boolean(resourceSearchJobId),
    refetchInterval: resourceSearchJobId ? 1500 : false,
  })
  const profileSourceQuery = useQuery({
    queryKey: ['learning', 'profile-source', notebookId],
    queryFn: () => learningApi.ensureProfileSource(notebookId),
    enabled: Boolean(notebookId),
    staleTime: 0,
    refetchInterval: 15_000,
  })

  // Collapsible column state
  const { sourcesCollapsed, toggleSources } = useNotebookColumnsStore()
  const sourcesTitle = '学习资料'
  const collapseButton = useMemo(
    () => createCollapseButton(toggleSources, sourcesTitle),
    [toggleSources, sourcesTitle]
  )

  // Scroll container ref for infinite scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const ensuringProfileRef = useRef<string | null>(null)
  const initialResourceSearchHandledRef = useRef<string | null>(null)
  const profileOpenHandledRef = useRef(0)
  const hasProfileSource = useMemo(
    () => Boolean(sources?.some(isLearningProfileSource)),
    [sources]
  )
  const displaySources = useMemo(
    () => sources?.filter((source) => !isLearningProfileSource(source)) ?? [],
    [sources]
  )
  const adaptiveLearningSummary = useMemo(
    () => buildAdaptiveLearningSummary(profileForm, displaySources.length),
    [displaySources.length, profileForm]
  )
  const profileInsightCards = useMemo(
    () => [
      {
        title: '学习效果评估',
        body: adaptiveLearningSummary.evaluation,
        icon: <Activity className="h-5 w-5" />,
        tone: 'border-sky-200 bg-sky-50/80 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
        bar: 'bg-sky-500',
      },
      {
        title: '资源推送策略',
        body: adaptiveLearningSummary.strategy,
        icon: <Compass className="h-5 w-5" />,
        tone: 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
        bar: 'bg-emerald-500',
      },
      {
        title: '下一步学习计划',
        body: adaptiveLearningSummary.plan,
        icon: <Route className="h-5 w-5" />,
        tone: 'border-violet-200 bg-violet-50/80 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300',
        bar: 'bg-violet-500',
      },
    ],
    [adaptiveLearningSummary]
  )

  useEffect(() => {
    const persisted = readPersistedResourceSearch(notebookId)
    if (!persisted) return
    if (!initialResourceSearchGoal.trim() && persisted.goal) {
      setResourceSearchGoal(persisted.goal)
    }
    setCollectedResources(persisted.resources)
    setResourceSearchJobId(persisted.jobId)
    setHandledResourceSearchJobId(null)
    setIsCollectingResources(Boolean(persisted.jobId))
    if (persisted.jobId || persisted.resources.length) {
      setResourceSearchExpanded(true)
    }
  }, [initialResourceSearchGoal, notebookId])

  useEffect(() => {
    if (profileSourceQuery.data?.content && !profileDialogOpen) {
      setProfileForm(learningProfileFormFromContent(profileSourceQuery.data.content))
    }
  }, [profileDialogOpen, profileSourceQuery.data?.content])

  useEffect(() => {
    if (profileOpenSignal <= 0 || profileOpenHandledRef.current === profileOpenSignal) return
    profileOpenHandledRef.current = profileOpenSignal
    setProfileForm(learningProfileFormFromContent(profileSourceQuery.data?.content))
    setProfileDialogOpen(true)
  }, [profileOpenSignal, profileSourceQuery.data?.content])

  useEffect(() => {
    if (!notebookId || isLoading || hasProfileSource || ensuringProfileRef.current === notebookId) {
      return
    }
    ensuringProfileRef.current = notebookId

    void learningApi.ensureProfileSource(notebookId)
      .then(() => onRefresh?.())
      .catch((error) => {
        console.debug('Failed to ensure learning profile source:', error)
      })
      .finally(() => {
        ensuringProfileRef.current = null
      })
  }, [notebookId, isLoading, hasProfileSource, onRefresh])

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !hasNextPage || isFetchingNextPage || !fetchNextPage) return

    const { scrollTop, scrollHeight, clientHeight } = container
    // Load more when user scrolls within 200px of the bottom
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Attach scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  useEffect(() => {
    if (
      !resourceSearchJobId ||
      !resourceSearchJob ||
      handledResourceSearchJobId === resourceSearchJobId
    ) {
      return
    }

    if (ACTIVE_JOB_STATUSES.has(resourceSearchJob.status)) {
      return
    }

    if (resourceSearchJob.status === 'completed') {
      const webResources = extractCollectedResources(resourceSearchJob.result).filter((resource) => resource.url)
      setCollectedResources(webResources)
      persistResourceSearch(notebookId, {
        goal: resourceSearchGoal,
        jobId: null,
        resources: webResources,
      })
      setHandledResourceSearchJobId(resourceSearchJobId)
      setResourceSearchJobId(null)
      setIsCollectingResources(false)
      if (webResources.length === 0) {
        toast.error('\u6ca1\u6709\u627e\u5230\u53ef\u91c7\u7eb3\u7684\u5916\u90e8\u8d44\u6599')
      } else {
        toast.success(`\u5df2\u627e\u5230 ${webResources.length} \u6761\u5019\u9009\u8d44\u6599`)
      }
      return
    }

    if (resourceSearchJob.status === 'failed' || resourceSearchJob.status === 'canceled') {
      persistResourceSearch(notebookId, {
        goal: resourceSearchGoal,
        jobId: null,
        resources: collectedResources,
      })
      setHandledResourceSearchJobId(resourceSearchJobId)
      setResourceSearchJobId(null)
      setIsCollectingResources(false)
      toast.error(
        resourceSearchJob.status === 'canceled'
          ? '\u8d44\u6599\u641c\u96c6\u4efb\u52a1\u5df2\u53d6\u6d88'
          : resourceSearchJob.error_message || '\u641c\u96c6\u8d44\u6599\u5931\u8d25'
      )
    }
  }, [
    collectedResources,
    handledResourceSearchJobId,
    notebookId,
    resourceSearchGoal,
    resourceSearchJob,
    resourceSearchJobId,
  ])

  const handleCollectResources = useCallback(async (goalOverride?: string) => {
    const normalizedGoal = (goalOverride ?? resourceSearchGoal).trim()
    if (!normalizedGoal) {
      toast.error('请先输入学习目标或资料主题')
      return
    }

    setIsCollectingResources(true)
    let submitted = false
    try {
      const response = await learningApi.submitResourceSearchJob({
        message: normalizedGoal,
        mode: 'collect',
        course: notebookName || '当前学习记录',
        major: profileForm.major,
        goal: normalizedGoal,
        learning_history: [
          `知识基础：${profileForm.knowledge}`,
          `认知风格：${profileForm.cognitiveStyle}`,
          `易错点：${profileForm.risks}`,
          `资源偏好：${profileForm.preference}`,
          ...(sources ?? []).map((source) => source.title || source.asset?.url || source.id),
        ],
        requested_outputs: [],
        learning_record_id: notebookId,
      })

      setCollectedResources([])
      setHandledResourceSearchJobId(null)
      setResourceSearchJobId(response.job_id)
      persistResourceSearch(notebookId, {
        goal: normalizedGoal,
        jobId: response.job_id,
        resources: [],
      })
      submitted = true
      toast.success('资料搜集已加入任务队列')
    } catch (error) {
      console.error('Failed to collect resources:', error)
      toast.error('搜集资料失败')
    } finally {
      if (!submitted) {
        setIsCollectingResources(false)
      }
    }
  }, [notebookId, notebookName, profileForm, resourceSearchGoal, sources])

  useEffect(() => {
    const normalizedInitialGoal = initialResourceSearchGoal.trim()
    if (!normalizedInitialGoal) {
      return
    }

    setResourceSearchGoal(normalizedInitialGoal)
    setResourceSearchExpanded(true)
    if (
      !autoCollectInitialResourceSearch ||
      initialResourceSearchHandledRef.current === normalizedInitialGoal
    ) {
      return
    }

    initialResourceSearchHandledRef.current = normalizedInitialGoal
    void handleCollectResources(normalizedInitialGoal)
  }, [
    autoCollectInitialResourceSearch,
    handleCollectResources,
    initialResourceSearchGoal,
  ])

  const handleAcceptResource = async (resource: LearningCollectedResource) => {
    if (!resource.url) {
      return
    }

    setAcceptingResourceIds((previous) => ({
      ...previous,
      [resource.id]: true,
    }))
    try {
      await createSource.mutateAsync({
        type: 'link',
        title: resource.title,
        url: resource.url,
        notebooks: [notebookId],
        async_processing: true,
        embed: false,
      })
      await learningApi.recordProfileEvent({
        learning_record_id: notebookId,
        event_type: 'source_accept',
        summary: [
          `title=${resource.title}`,
          resource.resource_kind ? `kind=${resource.resource_kind}` : '',
          resource.search_intent ? `intent=${resource.search_intent}` : '',
          resource.url ? `url=${resource.url}` : '',
        ].filter(Boolean).join('; '),
        auto_update_profile: true,
      }).catch((error) => {
        console.debug('Failed to record accepted source in learning profile:', error)
      })
      await profileSourceQuery.refetch()
      setAcceptedResourceUrls((previous) => ({
        ...previous,
        [resource.url as string]: true,
      }))
      onRefresh?.()
    } catch (error) {
      console.error('Failed to accept collected resource:', error)
    } finally {
      setAcceptingResourceIds((previous) => ({
        ...previous,
        [resource.id]: false,
      }))
    }
  }

  const handleDeleteClick = (sourceId: string) => {
    setSourceToDelete(sourceId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!sourceToDelete) return

    try {
      await deleteSource.mutateAsync(sourceToDelete)
      setDeleteDialogOpen(false)
      setSourceToDelete(null)
      onRefresh?.()
    } catch (error) {
      console.error('Failed to delete source:', error)
    }
  }

  const handleRemoveFromNotebook = (sourceId: string) => {
    setSourceToRemove(sourceId)
    setRemoveDialogOpen(true)
  }

  const handleRemoveConfirm = async () => {
    if (!sourceToRemove) return

    try {
      await removeFromNotebook.mutateAsync({
        notebookId,
        sourceId: sourceToRemove
      })
      setRemoveDialogOpen(false)
      setSourceToRemove(null)
    } catch (error) {
      console.error('Failed to remove source from notebook:', error)
      // Error toast is handled by the hook
    }
  }

  const handleRetry = async (sourceId: string) => {
    try {
      await retrySource.mutateAsync(sourceId)
    } catch (error) {
      console.error('Failed to retry source:', error)
    }
  }

  const handleSourceClick = (sourceId: string) => {
    openModal('source', sourceId)
  }

  const handleSaveProfile = async () => {
    const sourceId = profileSourceQuery.data?.source_id
    if (!sourceId) {
      toast.error('学习画像来源还没有准备好')
      return
    }

    try {
      await updateSource.mutateAsync({
        id: sourceId,
        data: {
          title: LEARNING_PROFILE_TITLE,
          content: serializeLearningProfileForm(profileForm),
          topics: [LEARNING_PROFILE_TOPIC],
          embed: false,
        },
      })
      await profileSourceQuery.refetch()
      onRefresh?.()
      setProfileDialogOpen(false)
    } catch (error) {
      console.error('Failed to save learning profile:', error)
    }
  }

  return (
    <>
      <CollapsibleColumn
        isCollapsed={sourcesCollapsed}
        onToggle={toggleSources}
        collapsedIcon={FileText}
        collapsedLabel={sourcesTitle}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="px-4 pb-3 pt-4 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <CardTitle className="text-lg">{sourcesTitle}</CardTitle>
                <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary sm:inline-flex">
                  主学习区
                </span>
              </div>
              <div className="flex items-center gap-2">
                <LearningProfileAvatar
                  profile={profileSourceQuery.data}
                  isLoading={profileSourceQuery.isLoading}
                  onEdit={() => {
                    setProfileForm(learningProfileFormFromContent(profileSourceQuery.data?.content))
                    setProfileDialogOpen(true)
                  }}
                />
                {onBulkContextModeChange && displaySources.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" title={t('sources.bulkContext')}>
                        <ListChecks className="h-4 w-4" />
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('insights')}>
                        {t('sources.includeAllInsights')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('full')}>
                        {t('sources.includeAllFull')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('exclude')}>
                        {t('sources.excludeAllFromContext')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {collapseButton}
              </div>
            </div>
          </CardHeader>

          <CardContent ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 space-y-3 px-4 pb-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <Button className="h-12 justify-center rounded-xl text-base font-semibold">
                    <Plus className="h-5 w-5 mr-2" />
                    {t('sources.addSource')}
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem onClick={() => { setDropdownOpen(false); setAddDialogOpen(true); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t('sources.addSource')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setDropdownOpen(false); setAddExistingDialogOpen(true); }}>
                    <Link2 className="h-4 w-4 mr-2" />
                    {t('sources.addExistingTitle')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="outline"
                className="h-12 justify-center rounded-xl text-base font-semibold"
                onClick={() => setResourceSearchExpanded((current) => !current)}
              >
                <Search className="h-5 w-5 mr-2 text-primary" />
                搜集资料
                {collectedResources.length ? (
                  <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {collectedResources.length}
                  </span>
                ) : null}
                <ChevronDown className={cn('h-4 w-4 ml-2 transition-transform', resourceSearchExpanded && 'rotate-180')} />
              </Button>
            </div>
            {resourceSearchExpanded && (
            <section className="overflow-hidden rounded-lg border bg-muted/30">
              <button
                type="button"
                className="hidden"
                onClick={() => setResourceSearchExpanded((current) => !current)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Search className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium">按目标搜集资料</h3>
                </div>
                <div className="flex items-center gap-2">
                  <BadgeText>{collectedResources.length ? `${collectedResources.length} 条结果` : 'Web Search'}</BadgeText>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', resourceSearchExpanded && 'rotate-180')} />
                </div>
              </button>
              {resourceSearchExpanded && (
                <div className="p-3">
              <Textarea
                value={resourceSearchGoal}
                onChange={(event) => setResourceSearchGoal(event.target.value)}
                placeholder="输入学习目标或资料主题，例如：监督学习入门公开课讲义"
                className="min-h-20 resize-none bg-background text-sm"
                disabled={isCollectingResources}
              />
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full"
                onClick={() => {
                  void handleCollectResources()
                }}
                disabled={isCollectingResources || !resourceSearchGoal.trim()}
              >
                {isCollectingResources ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                搜集外部资料
              </Button>
              {collectedResources.length > 0 && (
                <div className="mt-3 grid gap-3 2xl:grid-cols-2">
                  {collectedResources.map((resource) => {
                    const accepted = Boolean(resource.url && acceptedResourceUrls[resource.url])
                    const isAccepting = Boolean(acceptingResourceIds[resource.id])
                    const isVideo =
                      resource.content_type === 'video' ||
                      resource.resource_kind === 'video_lecture'
                    return (
                      <div key={resource.id} className="overflow-hidden rounded-xl border bg-background">
                        {isVideo && (
                          <a
                            href={resource.url || undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="group relative block aspect-video overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-primary/70"
                            style={
                              resource.thumbnail_url
                                ? {
                                    backgroundImage: `linear-gradient(to top, rgba(15,23,42,.58), rgba(15,23,42,.06)), url("${resource.thumbnail_url}")`,
                                    backgroundPosition: 'center',
                                    backgroundSize: 'cover',
                                  }
                                : undefined
                            }
                          >
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow-lg transition-transform group-hover:scale-105">
                                <PlayCircle className="h-7 w-7" />
                              </span>
                            </span>
                            <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white">
                              视频课程
                            </span>
                          </a>
                        )}
                        <div className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {resource.url ? (
                              <a
                                href={resource.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex break-words text-sm font-medium hover:text-primary hover:underline"
                              >
                                {resource.title}
                                <ExternalLink className="ml-1 mt-0.5 h-3.5 w-3.5 shrink-0" />
                              </a>
                            ) : (
                              <p className="break-words text-sm font-medium">{resource.title}</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {resource.content_type && (
                                <BadgeText>
                                  {RESOURCE_CONTENT_LABELS[resource.content_type] || resource.content_type}
                                </BadgeText>
                              )}
                              {typeof resource.quality_score === 'number' && (
                                <BadgeText>
                                  质量 {Math.round(resource.quality_score * 100)}
                                </BadgeText>
                              )}
                              {resource.resource_kind && (
                                <BadgeText>{resource.resource_kind}</BadgeText>
                              )}
                              {resource.search_intent && (
                                <BadgeText>{resource.search_intent}</BadgeText>
                              )}
                              {(resource.tags || []).map((tag) => (
                                <BadgeText key={`${resource.id}-${tag}`}>{tag}</BadgeText>
                              ))}
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={accepted ? 'secondary' : 'outline'}
                            className="shrink-0"
                            onClick={() => handleAcceptResource(resource)}
                            disabled={accepted || isAccepting || !resource.url}
                          >
                            {isAccepting ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : accepted ? (
                              <CheckCircle2 className="h-4 w-4 mr-2" />
                            ) : (
                              <Plus className="h-4 w-4 mr-2" />
                            )}
                            {accepted ? '已采纳' : '采纳'}
                          </Button>
                        </div>
                        {resource.snippet && (
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {resource.snippet}
                          </p>
                        )}
                        {resource.learning_value && (
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {resource.learning_value}
                          </p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                          {resource.provider || 'Web Search'} · {resource.reason}
                        </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
                </div>
              )}
            </section>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : displaySources.length === 0 ? (
              <EmptyState
                icon={FileText}
                title={t('sources.noSourcesYet')}
                description="点击右上角「添加来源」导入网页、文件、音频或文本。音频文件会使用语音识别模型转写后参与学习。"
              />
            ) : (
              <div className="grid gap-3 2xl:grid-cols-2">
                {displaySources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onClick={handleSourceClick}
                    onDelete={handleDeleteClick}
                    onRetry={handleRetry}
                    onRefreshContent={handleRetry}
                    onRemoveFromNotebook={handleRemoveFromNotebook}
                    onRefresh={onRefresh}
                    showRemoveFromNotebook={true}
                    contextMode={contextSelections?.[source.id]}
                    onContextModeChange={onContextModeChange
                      ? (mode) => onContextModeChange(source.id, mode)
                      : undefined
                    }
                  />
                ))}
                {/* Loading indicator for infinite scroll */}
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleColumn>

      <AddSourceDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        defaultNotebookId={notebookId}
      />

      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="max-h-[90vh] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>编辑学习画像</DialogTitle>
          </DialogHeader>
          <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
            <div className="overflow-hidden rounded-2xl border bg-gradient-to-br from-sky-50 via-background to-violet-50 p-4 dark:from-sky-950/20 dark:via-background dark:to-violet-950/20">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold">智能评估与动态调整</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    根据学习行为、测验结果、资料使用和对话信号，自动更新学习策略。
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {adaptiveLearningSummary.metrics.map((metric) => (
                    <span
                      key={metric}
                      className="rounded-full border bg-background/85 px-2.5 py-1 text-xs text-muted-foreground shadow-sm"
                    >
                      {metric}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {profileInsightCards.map((card) => (
                  <div key={card.title} className={cn('relative overflow-hidden rounded-xl border p-4 shadow-sm', card.tone)}>
                    <div className={cn('absolute inset-x-0 top-0 h-1', card.bar)} />
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 shadow-sm">
                        {card.icon}
                      </span>
                      <p className="text-sm font-semibold">{card.title}</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-foreground/80">
                      {card.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {PROFILE_DIMENSIONS.map((dimension) => (
                <label
                  key={dimension.key}
                  className="space-y-2 rounded-xl border bg-background p-3 shadow-sm transition-colors focus-within:border-primary/50"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{dimension.label}</span>
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', dimension.accent)}>
                      {dimension.icon}
                      画像维度
                    </span>
                  </span>
                  <Textarea
                    value={profileForm[dimension.key]}
                    onChange={(event) =>
                      setProfileForm((previous) => ({ ...previous, [dimension.key]: event.target.value }))
                    }
                    className="min-h-24 resize-y border-0 bg-muted/30 p-3 text-sm leading-6 shadow-none focus-visible:ring-1"
                    placeholder={dimension.placeholder}
                  />
                </label>
              ))}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              最近学习信号只用于后台更新上面的画像字段，不在这里单独展示。
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProfileDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={handleSaveProfile} disabled={updateSource.isPending}>
              {updateSource.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存画像
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddExistingSourceDialog
        open={addExistingDialogOpen}
        onOpenChange={setAddExistingDialogOpen}
        notebookId={notebookId}
        onSuccess={onRefresh}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('sources.delete')}
        description={t('sources.deleteConfirm')}
        confirmText={t('common.delete')}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteSource.isPending}
        confirmVariant="destructive"
      />

      <ConfirmDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title={t('sources.removeFromNotebook')}
        description={t('sources.removeConfirm')}
        confirmText={t('common.remove')}
        onConfirm={handleRemoveConfirm}
        isLoading={removeFromNotebook.isPending}
        confirmVariant="default"
      />
    </>
  )
}

function BadgeText({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  )
}
