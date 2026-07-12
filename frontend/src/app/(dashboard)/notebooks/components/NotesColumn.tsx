'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code2,
  Download,
  FileText,
  Headphones,
  ListMusic,
  ListChecks,
  Loader2,
  Maximize2,
  MoreVertical,
  Pause,
  Play,
  Network,
  Plus,
  Repeat,
  Rewind,
  Search,
  FastForward,
  Sparkles,
  StickyNote,
  Image as ImageIcon,
  TimerReset,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ContextToggle } from '@/components/common/ContextToggle'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import {
  LearningAssetPreview,
  getLearningAssetKindLabel,
  getVisibleLearningAssetContent,
  mindMapContentToSvg,
  parseLearningAssetNote,
  type MindMapMaterial,
} from '@/components/learning/LearningAssetPreview'
import { chatApi } from '@/lib/api/chat'
import { commandsApi } from '@/lib/api/commands'
import { learningApi } from '@/lib/api/learning'
import { resolvePodcastAssetUrl } from '@/lib/api/podcasts'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useDeleteNote } from '@/lib/hooks/use-notes'
import { useModelDefaults } from '@/lib/hooks/use-models'
import {
  useEpisodeProfiles,
  useDeletePodcastEpisode,
  useGeneratePodcast,
  usePodcastEpisodes,
  useSpeakerProfiles,
} from '@/lib/hooks/use-podcasts'
import { useDeleteSource } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { cn } from '@/lib/utils'
import { getDateLocale } from '@/lib/utils/date-locale'
import { getGenerationLanguageFromLocale } from '@/lib/utils/language'
import type { NoteResponse, SourceListResponse } from '@/lib/types/api'
import type { LearningOutputKind, LearningResource } from '@/lib/types/learning'
import {
  ACTIVE_EPISODE_STATUSES,
  FAILED_EPISODE_STATUSES,
  needsModelSetup,
  type EpisodeStatus,
  type PodcastEpisode,
} from '@/lib/types/podcasts'
import type { NoteContextDefault } from '@/lib/utils/source-context'
import type { NoteContextMode } from '../[id]/page'
import {
  LearningAssetGenerateDialog,
  LEARNING_ASSET_OPTIONS,
  buildLearningAssetGoal,
  getDefaultLearningAssetDetail,
  type LearningAssetDetailConfig,
  type LearningAssetGenerationConfig,
  type LearningAssetMaterialOption,
  type LearningProfileOptions,
} from './LearningAssetGenerateDialog'
import { NoteEditorDialog } from './NoteEditorDialog'

const LEARNING_PROFILE_TOPIC = 'learning_profile'
const LEARNING_PROFILE_TITLE = '学习画像'

const ACTIVE_JOB_STATUSES = new Set(['new', 'queued', 'running'])
const DEFAULT_PODCAST_MATERIAL_LIMIT = 6
const PODCAST_CONTEXT_CHAR_LIMIT = 22000
const PODCAST_SUPPLEMENTAL_CHAR_LIMIT = 4000

type AssetJobTracker = {
  jobId: string
  outputKind: LearningOutputKind
}

type AssetJobsSubmissionResponse = {
  jobs: Array<{ job_id: string; output_kind: LearningOutputKind }>
}

type PodcastJobTracker = {
  jobId: string
}

type StudioAssetKind = LearningOutputKind | 'podcast'

type StudioAssetOption =
  | (typeof LEARNING_ASSET_OPTIONS)[number]
  | {
      kind: 'podcast'
      label: string
      description: string
    }

const PODCAST_STUDIO_OPTION: StudioAssetOption = {
  kind: 'podcast',
  label: '播客',
  description: '调用 TTS 模型生成音频播客。',
}

const stripLearningAssetTitlePrefix = (title: string | null | undefined) => {
  if (!title) {
    return ''
  }
  return title.replace(/^(?:\[[^\]]+\]\s*)+/, '')
}

const inferLearningAssetKind = (
  content: string | null | undefined,
  title: string | null | undefined
): LearningOutputKind | null => {
  const combined = `${title ?? ''}\n${content ?? ''}`
  const normalized = combined.toLowerCase()
  const metadataKind = combined.match(
    /"kind"\s*:\s*"(study_guide|quiz|flashcards|mind_map|reading|code_lab)"/
  )?.[1] as LearningOutputKind | undefined

  if (metadataKind) {
    return metadataKind
  }

  if (/课程学习讲解|课程讲解|讲解文档|study\s*guide|深度解析/i.test(combined)) {
    return 'study_guide'
  }
  if (/测验|小测验|诊断|练习题|quiz|diagnostic/i.test(combined)) {
    return 'quiz'
  }
  if (/闪卡|记忆卡|flashcards?/i.test(combined)) {
    return 'flashcards'
  }
  if (/思维导图|知识导图|知识图谱|概念图|图谱|mind\s*map|concept\s*map/i.test(combined)) {
    return 'mind_map'
  }
  if (/拓展阅读|延伸阅读|阅读指南|阅读材料|reading/i.test(combined)) {
    return 'reading'
  }
  if (
    /代码实验|代码实验室|代码实操|实操案例|编程实验|code\s*lab/i.test(combined) ||
    (normalized.includes('```') && /实验|lab|implementation|代码|code/i.test(combined))
  ) {
    return 'code_lab'
  }

  return null
}

const STUDIO_ASSET_OPTIONS: StudioAssetOption[] = [
  ...LEARNING_ASSET_OPTIONS,
  PODCAST_STUDIO_OPTION,
]

const STUDIO_ASSET_ICONS: Record<StudioAssetKind, typeof FileText> = {
  study_guide: FileText,
  quiz: ClipboardList,
  flashcards: StickyNote,
  mind_map: Network,
  reading: Search,
  code_lab: Code2,
  visual_aid: ImageIcon,
  podcast: Headphones,
}

const STUDIO_ASSET_STYLES: Record<StudioAssetKind, string> = {
  study_guide: 'border-sky-300 bg-sky-50 hover:border-sky-500 hover:bg-sky-100 dark:border-sky-500/70 dark:bg-sky-950/35 dark:hover:border-sky-400 dark:hover:bg-sky-950/50',
  quiz: 'border-emerald-300 bg-emerald-50 hover:border-emerald-500 hover:bg-emerald-100 dark:border-emerald-500/70 dark:bg-emerald-950/35 dark:hover:border-emerald-400 dark:hover:bg-emerald-950/50',
  flashcards: 'border-amber-300 bg-amber-50 hover:border-amber-500 hover:bg-amber-100 dark:border-amber-500/70 dark:bg-amber-950/35 dark:hover:border-amber-400 dark:hover:bg-amber-950/50',
  mind_map: 'border-violet-300 bg-violet-50 hover:border-violet-500 hover:bg-violet-100 dark:border-violet-500/70 dark:bg-violet-950/35 dark:hover:border-violet-400 dark:hover:bg-violet-950/50',
  reading: 'border-rose-300 bg-rose-50 hover:border-rose-500 hover:bg-rose-100 dark:border-rose-500/70 dark:bg-rose-950/35 dark:hover:border-rose-400 dark:hover:bg-rose-950/50',
  code_lab: 'border-cyan-300 bg-cyan-50 hover:border-cyan-500 hover:bg-cyan-100 dark:border-cyan-500/70 dark:bg-cyan-950/35 dark:hover:border-cyan-400 dark:hover:bg-cyan-950/50',
  visual_aid: 'border-fuchsia-300 bg-fuchsia-50 hover:border-fuchsia-500 hover:bg-fuchsia-100 dark:border-fuchsia-500/70 dark:bg-fuchsia-950/35 dark:hover:border-fuchsia-400 dark:hover:bg-fuchsia-950/50',
  podcast: 'border-indigo-300 bg-indigo-50 hover:border-indigo-500 hover:bg-indigo-100 dark:border-indigo-500/70 dark:bg-indigo-950/35 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/50',
}

type StudioCategoryFilter = StudioAssetKind | 'all'

const STUDIO_CATEGORY_OPTIONS: Array<{ id: StudioCategoryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'study_guide', label: '讲解文档' },
  { id: 'quiz', label: '测验' },
  { id: 'flashcards', label: '知识闪卡' },
  { id: 'mind_map', label: '思维导图' },
  { id: 'reading', label: '阅读材料' },
  { id: 'code_lab', label: '代码实验' },
  { id: 'visual_aid', label: '辅助图片' },
  { id: 'podcast', label: '播客' },
]

const QUIZ_MISTAKE_BOOK_STORAGE_KEY = 'learning-quiz-mistake-book:v1'

const DEFAULT_ASSET_DETAILS = LEARNING_ASSET_OPTIONS.reduce(
  (accumulator, option) => {
    accumulator[option.kind] = getDefaultLearningAssetDetail(option.kind)
    return accumulator
  },
  {} as Record<LearningOutputKind, LearningAssetDetailConfig>
)

function isLearningProfileSource(source: SourceListResponse) {
  return source.title === LEARNING_PROFILE_TITLE || source.topics?.includes(LEARNING_PROFILE_TOPIC)
}

function getPodcastStatusLabel(status?: string | null) {
  if (status === 'completed') return '已生成'
  if (status && ACTIVE_EPISODE_STATUSES.includes(status as EpisodeStatus)) {
    return '生成中'
  }
  if (status && FAILED_EPISODE_STATUSES.includes(status as EpisodeStatus)) {
    return '失败'
  }
  return '等待中'
}

function normalizeRecordId(value?: string | null) {
  if (!value) {
    return ''
  }
  return value.includes(':') ? value.split(':', 2)[1] : value
}

function sameRecordId(left?: string | null, right?: string | null) {
  return Boolean(left && right && normalizeRecordId(left) === normalizeRecordId(right))
}

type StudioExportTarget =
  | {
      type: 'learning_asset'
      note: NoteResponse
      asset: LearningResource | null
      visibleContent: string
      assetKind: LearningOutputKind | null
      assetKindLabel: string | null
    }
  | {
      type: 'podcast'
      episode: PodcastEpisode
    }

type StudioExportFormat = 'default' | 'mind_map_md' | 'mind_map_png'

type StudioExportMistakeBookItem = {
  id: string
  resourceTitle: string
  questionId: string
  prompt: string
  options: string[]
  answerIndex: number
  selectedIndex?: number
  explanation: string
  sourceTitle?: string
  sourceId?: string
  location?: string
  evidence?: string
  starred: boolean
  savedAt: string
}

function getStudioAssetTitle(target: StudioExportTarget) {
  if (target.type === 'podcast') {
    return target.episode.name || '未命名播客'
  }
  return (
    target.asset?.title ||
    stripLearningAssetTitlePrefix(target.note.title) ||
    target.note.title ||
    '未命名资料'
  )
}

function isStudioTargetExportable(target: StudioExportTarget) {
  if (target.type === 'podcast') {
    return Boolean(target.episode.audio_url || target.episode.audio_file)
  }
  if (!target.asset) {
    return false
  }
  if (target.asset.kind === 'code_lab') {
    return extractExecutableCodeBlocks(target.asset.content).length > 0
  }
  return ['study_guide', 'quiz', 'mind_map', 'visual_aid'].includes(target.asset.kind)
}

function getStudioExportLabel(target: StudioExportTarget) {
  if (target.type === 'podcast') {
    return '导出 WAV'
  }
  if (!target.asset) {
    return '导出'
  }
  if (target.asset.kind === 'study_guide') {
    return '导出 PDF'
  }
  if (target.asset.kind === 'quiz') {
    return '导出错题本'
  }
  if (target.asset.kind === 'mind_map') {
    return '导出导图'
  }
  if (target.asset.kind === 'code_lab') {
    return '导出 Notebook'
  }
  if (target.asset.kind === 'visual_aid') {
    return '导出图片'
  }
  return '导出'
}

function safeExportFilename(value: string, fallback = 'studio-export') {
  const compact = value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return compact || fallback
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function svgToPngBlob(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const width = Number(svg.match(/\bwidth="(\d+)"/)?.[1] ?? 1600)
    const height = Number(svg.match(/\bheight="(\d+)"/)?.[1] ?? 1000)
    const image = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('Canvas context is unavailable')
        }
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
        context.drawImage(image, 0, 0)
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url)
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to render mind map image'))
          }
        }, 'image/png')
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load mind map SVG'))
    }
    image.src = url
  })
}

function getAuthenticatedDownloadHeaders(): HeadersInit {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const raw = window.localStorage.getItem('auth-storage')
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    const token = parsed?.state?.token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function markdownToPrintableHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inList = false
  let inCode = false
  let codeLines: string[] = []

  const closeList = () => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      closeList()
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      closeList()
      html.push('<p class="spacer"></p>')
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = Math.min(heading[1].length, 4)
      html.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    const listItem = trimmed.match(/^[-*]\s+(.+)$/) || trimmed.match(/^\d+\.\s+(.+)$/)
    if (listItem) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${formatInlineMarkdown(listItem[1])}</li>`)
      continue
    }

    closeList()
    html.push(`<p>${formatInlineMarkdown(trimmed)}</p>`)
  }

  closeList()
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  }
  return html.join('\n')
}

function openPrintableDocument(title: string, bodyHtml: string) {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer')
  if (!printWindow) {
    toast.error('浏览器阻止了导出窗口，请允许弹窗后重试')
    return
  }
  printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; line-height: 1.65; margin: 40px; }
    h1, h2, h3, h4 { line-height: 1.3; margin: 1.2em 0 0.5em; }
    p { margin: 0.65em 0; }
    .spacer { height: 0.35rem; }
    ul { padding-left: 1.35rem; }
    li { margin: 0.3rem 0; }
    code { background: #f3f4f6; border-radius: 4px; padding: 0.1rem 0.25rem; }
    pre { background: #f3f4f6; border-radius: 8px; padding: 1rem; overflow-x: auto; white-space: pre-wrap; }
    .export-note { color: #6b7280; font-size: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 18px; }
    @page { margin: 18mm; }
  </style>
</head>
<body>
  <div class="export-note">导出自 Studio。打印时选择“另存为 PDF”即可保存 PDF。</div>
  ${bodyHtml}
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`)
  printWindow.document.close()
}

function readStudioQuizMistakeBook(): StudioExportMistakeBookItem[] {
  if (typeof window === 'undefined') {
    return []
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUIZ_MISTAKE_BOOK_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildQuizMistakeMarkdown(resource: LearningResource) {
  const mistakes = readStudioQuizMistakeBook().filter((item) => item.resourceTitle === resource.title)
  if (mistakes.length === 0) {
    return ''
  }
  return [
    `# ${resource.title} 错题本`,
    '',
    ...mistakes.flatMap((item, index) => [
      `## ${index + 1}. ${item.prompt}`,
      '',
      item.selectedIndex !== undefined ? `你的答案：${item.options[item.selectedIndex] ?? '未记录'}` : '你的答案：未记录',
      `正确答案：${item.options[item.answerIndex] ?? '未记录'}`,
      item.explanation ? `解析：${item.explanation}` : '',
      item.sourceTitle ? `来源：${item.sourceTitle}${item.location ? ` · ${item.location}` : ''}` : '',
      item.evidence ? `依据：${item.evidence}` : '',
      '',
    ]),
  ].filter(Boolean).join('\n')
}

function extractExecutableCodeBlocks(content: string) {
  const blocks: Array<{ language: string; code: string }> = []
  const pattern = /```([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const language = (match[1] || 'python').toLowerCase()
    const code = match[2].trim()
    if (code && /^(python|py|julia|r|javascript|js|typescript|ts|bash|sh|sql)$/.test(language)) {
      blocks.push({ language, code })
    }
  }
  return blocks
}

function buildNotebookFromCodeLab(resource: LearningResource) {
  const blocks = extractExecutableCodeBlocks(resource.content)
  if (blocks.length === 0) {
    return null
  }
  return {
    cells: [
      {
        cell_type: 'markdown',
        metadata: {},
        source: [`# ${resource.title}\n\n`, `${resource.summary || ''}\n`],
      },
      ...blocks.map((block) => ({
        cell_type: 'code',
        execution_count: null,
        metadata: { language: block.language },
        outputs: [],
        source: block.code.split('\n').map((line) => `${line}\n`),
      })),
    ],
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  }
}

function getPodcastStatusClassName(status?: string | null) {
  if (status === 'completed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
  }
  if (status && ACTIVE_EPISODE_STATUSES.includes(status as EpisodeStatus)) {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
  }
  if (status && FAILED_EPISODE_STATUSES.includes(status as EpisodeStatus)) {
    return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
  }
  return 'border-muted bg-muted/40 text-muted-foreground'
}

type PodcastTranscriptEntry = {
  speaker?: string
  dialogue?: string
  start?: number
  end?: number
  start_time?: number
  end_time?: number
}

function extractPodcastTranscriptEntries(transcript: unknown): PodcastTranscriptEntry[] {
  if (!transcript) {
    return []
  }
  if (Array.isArray(transcript)) {
    return transcript.filter((entry): entry is PodcastTranscriptEntry => (
      Boolean(entry) && typeof entry === 'object'
    ))
  }
  if (typeof transcript === 'object' && 'transcript' in transcript) {
    return extractPodcastTranscriptEntries(
      (transcript as { transcript?: unknown }).transcript
    )
  }
  return []
}

function formatPodcastTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0:00'
  }
  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatPodcastEpisodeDate(value?: string | null, language = 'zh-CN') {
  if (!value) {
    return '生成时间未知'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString(language.startsWith('zh') ? 'zh-CN' : language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildPodcastEpisodeName(notebookName?: string, sequence = 1) {
  return `${notebookName || '学习记录'} 播客 ${sequence}`
}

type PodcastSubtitleLine = {
  id: string
  entryIndex: number
  text: string
  start: number
  end: number
  speaker?: string
}

function getExplicitTranscriptTime(value: unknown) {
  const time = Number(value)
  return Number.isFinite(time) && time >= 0 ? time : null
}

function getSubtitleLineWeight(text: string) {
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length
  const wordCount = (text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g) || []).length
  const punctuationCount = (text.match(/[,.!?;:，。！？；：、]/g) || []).length

  return Math.max(1, cjkCount * 0.62 + wordCount + punctuationCount * 0.45 + 0.8)
}

function splitPodcastDialogueLines(dialogue?: string) {
  const text = (dialogue || '').replace(/\r\n/g, '\n').trim()
  if (!text) {
    return []
  }

  const hardLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const sourceLines = hardLines.length > 1
    ? hardLines
    : (text.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [text]).map((line) => line.trim()).filter(Boolean)

  return sourceLines.flatMap((line) => {
    const bilingualMatch = line.match(/^([A-Za-z0-9\s,'"!?;:().\-]+)([\u3400-\u9fff].*)$/)
    if (!bilingualMatch) {
      return [line]
    }
    return [bilingualMatch[1].trim(), bilingualMatch[2].trim()].filter(Boolean)
  })
}

function buildPodcastSubtitleLines(
  entries: PodcastTranscriptEntry[],
  duration: number
): PodcastSubtitleLine[] {
  const segments = entries.map((entry, entryIndex) => {
    const lines = splitPodcastDialogueLines(entry.dialogue)
    const start = getExplicitTranscriptTime(entry.start ?? entry.start_time)
    const end = getExplicitTranscriptTime(entry.end ?? entry.end_time)
    return {
      entry,
      entryIndex,
      lines,
      start,
      end,
      weight: lines.reduce((total, line) => total + getSubtitleLineWeight(line), 0),
    }
  }).filter((segment) => segment.lines.length > 0)

  const hasCompleteTiming = segments.every((segment) => (
    segment.start !== null &&
    segment.end !== null &&
    segment.end > segment.start
  ))

  if (hasCompleteTiming) {
    return segments.flatMap((segment) => {
      const segmentDuration = Math.max(0.25, (segment.end ?? 0) - (segment.start ?? 0))
      const totalWeight = Math.max(1, segment.weight)
      let cursor = segment.start ?? 0
      return segment.lines.map((text, lineIndex) => {
        const lineWeight = getSubtitleLineWeight(text)
        const lineStart = cursor
        const isLastLine = lineIndex === segment.lines.length - 1
        const lineEnd = isLastLine
          ? (segment.end ?? lineStart + 0.25)
          : Math.min((segment.end ?? lineStart + 0.25), lineStart + (segmentDuration * lineWeight) / totalWeight)
        cursor = lineEnd
        return {
          id: `${segment.entryIndex}-${lineIndex}-${text.slice(0, 16)}`,
          entryIndex: segment.entryIndex,
          text,
          start: lineStart,
          end: Math.max(lineStart + 0.1, lineEnd),
          speaker: segment.entry.speaker,
        }
      })
    })
  }

  const flattenedLines = segments.flatMap((segment) =>
    segment.lines.map((text, lineIndex) => ({
      entry: segment.entry,
      entryIndex: segment.entryIndex,
      lineIndex,
      text,
      weight: getSubtitleLineWeight(text),
    }))
  )
  const timelineDuration = duration > 0 ? duration : flattenedLines.length
  const totalWeight = Math.max(1, flattenedLines.reduce((total, line) => total + line.weight, 0))
  let cursor = 0

  return flattenedLines.map((line, index) => {
    const lineStart = cursor
    const isLastLine = index === flattenedLines.length - 1
    const lineEnd = isLastLine
      ? timelineDuration
      : Math.min(timelineDuration, lineStart + (timelineDuration * line.weight) / totalWeight)
    cursor = lineEnd
    return {
      id: `${line.entryIndex}-${line.lineIndex}-${line.text.slice(0, 16)}`,
      entryIndex: line.entryIndex,
      text: line.text,
      start: lineStart,
      end: Math.max(lineStart + 0.1, lineEnd),
      speaker: line.entry.speaker,
    }
  })
}

function getActiveSubtitleLineIndex(
  lines: PodcastSubtitleLine[],
  currentTime: number,
  duration: number
) {
  if (lines.length === 0) {
    return -1
  }
  const activeIndex = lines.findIndex((line) => currentTime >= line.start && currentTime < line.end)
  if (activeIndex !== -1) {
    return activeIndex
  }
  return Math.min(lines.length - 1, Math.max(0, Math.floor((currentTime / Math.max(duration, 1)) * lines.length)))
}

const PODCAST_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2]

type PodcastSubtitleMode = 'single_line' | 'bilingual' | 'none'

type PodcastPlaybackSnapshot = {
  currentTime?: number
  duration?: number
  playbackRate?: number
  loopPlayback?: boolean
  sleepTimerMinutes?: number
}

type NotebookPodcastAssetCardProps = {
  episode: PodcastEpisode
  displayMode?: 'card' | 'studio'
  onOpenStudio?: (episode: PodcastEpisode) => void
  onBack?: () => void
  onExport?: (episode: PodcastEpisode) => void
  onDelete?: (episode: PodcastEpisode) => void
  playbackSnapshot?: PodcastPlaybackSnapshot
  onPlaybackChange?: (patch: PodcastPlaybackSnapshot) => void
  onQueueAdd?: (episode: PodcastEpisode) => void
  onQueueRemove?: (episodeId: string) => void
  onQueueClear?: () => void
  queueEpisodes?: PodcastEpisode[]
  queuePosition?: number
}

function NotebookPodcastAssetCard({
  episode,
  displayMode = 'card',
  onOpenStudio,
  onBack,
  onExport,
  onDelete,
  playbackSnapshot,
  onPlaybackChange,
  onQueueAdd,
  onQueueRemove,
  onQueueClear,
  queueEpisodes = [],
  queuePosition,
}: NotebookPodcastAssetCardProps) {
  const { language } = useTranslation()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackSnapshotRef = useRef<PodcastPlaybackSnapshot | undefined>(playbackSnapshot)
  const pendingInitialTimeRef = useRef(playbackSnapshot?.currentTime ?? 0)
  const [audioSrc, setAudioSrc] = useState<string | undefined>()
  const [audioError, setAudioError] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(playbackSnapshot?.duration ?? 0)
  const [currentTime, setCurrentTime] = useState(playbackSnapshot?.currentTime ?? 0)
  const [playbackRate, setPlaybackRate] = useState(playbackSnapshot?.playbackRate ?? 1)
  const [loopPlayback, setLoopPlayback] = useState(playbackSnapshot?.loopPlayback ?? false)
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState(playbackSnapshot?.sleepTimerMinutes ?? 0)
  const [showSubtitles, setShowSubtitles] = useState(true)
  const subtitleLineRefs = useRef<Array<HTMLButtonElement | null>>([])
  const status = episode.job_status ?? 'unknown'
  const isActive = ACTIVE_EPISODE_STATUSES.includes(status)
  const isFailed = FAILED_EPISODE_STATUSES.includes(status)
  const transcriptEntries = useMemo(
    () => extractPodcastTranscriptEntries(episode.transcript),
    [episode.transcript]
  )
  const subtitleLines = useMemo(
    () => buildPodcastSubtitleLines(transcriptEntries, duration),
    [duration, transcriptEntries]
  )
  const activeSubtitleLineIndex = useMemo(
    () => getActiveSubtitleLineIndex(subtitleLines, currentTime, duration),
    [currentTime, duration, subtitleLines]
  )

  useEffect(() => {
    playbackSnapshotRef.current = playbackSnapshot
  }, [playbackSnapshot])

  const publishPlaybackSnapshot = useCallback((patch: PodcastPlaybackSnapshot) => {
    onPlaybackChange?.({
      currentTime,
      duration,
      playbackRate,
      loopPlayback,
      sleepTimerMinutes,
      ...patch,
    })
  }, [currentTime, duration, loopPlayback, onPlaybackChange, playbackRate, sleepTimerMinutes])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
  }, [audioSrc, playbackRate])

  useEffect(() => {
    if (displayMode !== 'studio' || !showSubtitles || activeSubtitleLineIndex < 0) {
      return
    }
    subtitleLineRefs.current[activeSubtitleLineIndex]?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }, [activeSubtitleLineIndex, displayMode, showSubtitles])

  useEffect(() => {
    if (sleepTimerMinutes <= 0) {
      return
    }
    const timer = window.setTimeout(() => {
      audioRef.current?.pause()
      setIsPlaying(false)
      setSleepTimerMinutes(0)
    }, sleepTimerMinutes * 60 * 1000)
    return () => window.clearTimeout(timer)
  }, [sleepTimerMinutes])

  useEffect(() => {
    let revokeUrl: string | undefined
    const snapshot = playbackSnapshotRef.current
    const initialCurrentTime = snapshot?.currentTime ?? 0
    const initialDuration = snapshot?.duration ?? 0
    const initialPlaybackRate = snapshot?.playbackRate ?? 1
    const initialLoopPlayback = snapshot?.loopPlayback ?? false
    const initialSleepTimerMinutes = snapshot?.sleepTimerMinutes ?? 0
    pendingInitialTimeRef.current = initialCurrentTime
    setAudioError(null)
    setAudioSrc(undefined)
    setIsPlaying(false)
    setDuration(initialDuration)
    setCurrentTime(initialCurrentTime)
    setPlaybackRate(initialPlaybackRate)
    setLoopPlayback(initialLoopPlayback)
    setSleepTimerMinutes(initialSleepTimerMinutes)

    const loadAudio = async () => {
      if (!episode.audio_url && !episode.audio_file) {
        return
      }

      const directAudioUrl = await resolvePodcastAssetUrl(episode.audio_url ?? episode.audio_file)
      if (!directAudioUrl) {
        return
      }

      if (!episode.audio_url) {
        setAudioSrc(directAudioUrl)
        return
      }

      try {
        let token: string | undefined
        if (typeof window !== 'undefined') {
          const raw = window.localStorage.getItem('auth-storage')
          if (raw) {
            const parsed = JSON.parse(raw)
            token = parsed?.state?.token
          }
        }

        const headers: HeadersInit = {}
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }

        const response = await fetch(directAudioUrl, { headers })
        if (!response.ok) {
          throw new Error(`Audio request failed with status ${response.status}`)
        }

        const blob = await response.blob()
        revokeUrl = URL.createObjectURL(blob)
        setAudioSrc(revokeUrl)
      } catch (error) {
        console.error('Unable to load notebook podcast audio', error)
        setAudioError('音频暂不可播放')
      }
    }

    void loadAudio()

    return () => {
      if (revokeUrl) {
        URL.revokeObjectURL(revokeUrl)
      }
    }
  }, [episode.audio_file, episode.audio_url, episode.id])

  const handleTogglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      try {
        await audio.play()
        setIsPlaying(true)
      } catch (error) {
        console.error('Unable to play notebook podcast audio', error)
        setAudioError('音频暂不可播放')
      }
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }

  const seekBy = (seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    const nextTime = Math.min(Math.max(0, audio.currentTime + seconds), duration || audio.duration || 0)
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
    publishPlaybackSnapshot({ currentTime: nextTime, duration: audio.duration || duration })
  }

  const handleSeek = (value: string) => {
    const audio = audioRef.current
    const nextTime = Number(value)
    setCurrentTime(nextTime)
    if (audio) {
      audio.currentTime = nextTime
    }
    publishPlaybackSnapshot({ currentTime: nextTime, duration: audio?.duration || duration })
  }

  const handlePlaybackRateChange = (value: string) => {
    const nextRate = Number(value)
    setPlaybackRate(nextRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate
    }
    publishPlaybackSnapshot({ playbackRate: nextRate })
  }

  const jumpToSubtitleLine = (index: number) => {
    const line = subtitleLines[index]
    const audio = audioRef.current
    if (!line || !audio) {
      return
    }
    audio.currentTime = line.start
    setCurrentTime(line.start)
    publishPlaybackSnapshot({ currentTime: line.start, duration: audio.duration || duration })
  }

  const handleLoopPlaybackChange = (nextLoopPlayback: boolean) => {
    setLoopPlayback(nextLoopPlayback)
    publishPlaybackSnapshot({ loopPlayback: nextLoopPlayback })
  }

  const handleSleepTimerChange = (nextSleepTimerMinutes: number) => {
    setSleepTimerMinutes(nextSleepTimerMinutes)
    publishPlaybackSnapshot({ sleepTimerMinutes: nextSleepTimerMinutes })
  }

  const audioElement = audioSrc ? (
    <audio
      ref={audioRef}
      preload="metadata"
      src={audioSrc}
      loop={loopPlayback}
      onLoadedMetadata={(event) => {
        event.currentTarget.playbackRate = playbackRate
        const nextDuration = event.currentTarget.duration || 0
        const initialTime = Math.min(
          Math.max(0, pendingInitialTimeRef.current),
          nextDuration || pendingInitialTimeRef.current
        )
        if (initialTime > 0) {
          event.currentTarget.currentTime = initialTime
        }
        setDuration(nextDuration)
        setCurrentTime(initialTime)
        publishPlaybackSnapshot({ currentTime: initialTime, duration: nextDuration })
      }}
      onTimeUpdate={(event) => {
        const nextTime = event.currentTarget.currentTime || 0
        setCurrentTime(nextTime)
        publishPlaybackSnapshot({
          currentTime: nextTime,
          duration: event.currentTarget.duration || duration,
        })
      }}
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      onEnded={() => setIsPlaying(false)}
      className="sr-only"
    />
  ) : null

  if (displayMode === 'studio') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background text-foreground">
        {audioElement}
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={onBack}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-xs tracking-wide text-muted-foreground">播客</p>
            <h3 className="truncate text-base font-semibold">{episode.name}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onExport ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => onExport(episode)}
                aria-label="导出播客音频"
                title="导出 WAV"
              >
                <Download className="mr-2 h-4 w-4" />
                导出 WAV
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:bg-muted hover:text-destructive"
                onClick={() => onDelete(episode)}
                aria-label="删除播客"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : <span className="h-9 w-9 shrink-0" />}
          </div>
        </header>

        {audioSrc ? (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <section className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 py-4">
              <div className="mb-5 flex h-20 w-20 shrink-0 items-center justify-center rounded-full border bg-muted">
                <Headphones className="h-9 w-9" />
              </div>
              {showSubtitles && subtitleLines.length > 0 ? (
                <div className="min-h-0 w-full max-w-4xl flex-1 overflow-y-auto py-10">
                  <div className="space-y-4">
                    {subtitleLines.map((line, index) => {
                      const active = index === activeSubtitleLineIndex
                      return (
                        <button
                          key={line.id}
                          ref={(element) => {
                            subtitleLineRefs.current[index] = element
                          }}
                          type="button"
                          onClick={() => jumpToSubtitleLine(index)}
                          className={cn(
                            'block w-full rounded-md px-4 py-2 text-center text-2xl font-semibold leading-relaxed transition-all',
                            active
                              ? 'scale-[1.02] text-foreground opacity-100'
                              : 'text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground'
                          )}
                        >
                          {line.text}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <p className="max-w-3xl rounded-lg px-4 py-3 text-center text-2xl font-semibold leading-relaxed text-muted-foreground">
                  {showSubtitles ? '当前播客没有可显示字幕' : '字幕已隐藏'}
                </p>
              )}
            </section>

            <footer className="shrink-0 space-y-3 border-t bg-background px-5 py-3">
              <input
                type="range"
                min={0}
                max={Math.max(duration, currentTime, 1)}
                step={0.1}
                value={Math.min(currentTime, Math.max(duration, currentTime, 1))}
                onChange={(event) => handleSeek(event.target.value)}
                className="w-full accent-primary"
                aria-label="播客播放进度"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatPodcastTime(currentTime)}</span>
                <span>{formatPodcastTime(duration)}</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  onClick={() => seekBy(-15)}
                  aria-label="后退 15 秒"
                >
                  <Rewind className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  className="h-14 w-14 rounded-full"
                  onClick={handleTogglePlay}
                  aria-label={isPlaying ? '暂停播客' : '播放播客'}
                >
                  {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 pl-1" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  onClick={() => seekBy(15)}
                  aria-label="前进 15 秒"
                >
                  <FastForward className="h-4 w-4" />
                </Button>
                <Select value={String(playbackRate)} onValueChange={handlePlaybackRateChange}>
                  <SelectTrigger className="h-10 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PODCAST_PLAYBACK_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        {rate}x
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 rounded-full"
                      aria-label="播放列表和定时"
                      title="播放列表和定时"
                    >
                      <ListMusic className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {onQueueAdd && (
                      <DropdownMenuItem onClick={() => onQueueAdd(episode)}>
                        <ListMusic className="mr-2 h-4 w-4" />
                        {queuePosition ? `队列第 ${queuePosition} 个` : '添加到播放队列'}
                      </DropdownMenuItem>
                    )}
                    {queueEpisodes.length > 0 && (
                      <>
                        <DropdownMenuItem disabled className="text-xs">
                          播放队列
                        </DropdownMenuItem>
                        {queueEpisodes.map((queuedEpisode, index) => (
                          <DropdownMenuItem
                            key={queuedEpisode.id}
                            onClick={() => onQueueRemove?.(queuedEpisode.id)}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate">
                              {index + 1}. {queuedEpisode.name}
                            </span>
                            <X className="h-3.5 w-3.5 shrink-0" />
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem onClick={onQueueClear}>
                          清空队列
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem onClick={() => handleLoopPlaybackChange(!loopPlayback)}>
                      <Repeat className="mr-2 h-4 w-4" />
                      {loopPlayback ? '取消循环' : '循环播放'}
                    </DropdownMenuItem>
                    {[15, 30, 60].map((minutes) => (
                      <DropdownMenuItem key={minutes} onClick={() => handleSleepTimerChange(minutes)}>
                        <TimerReset className="mr-2 h-4 w-4" />
                        {minutes} 分钟后停止
                      </DropdownMenuItem>
                    ))}
                    {sleepTimerMinutes > 0 && (
                      <DropdownMenuItem onClick={() => handleSleepTimerChange(0)}>
                        <TimerReset className="mr-2 h-4 w-4" />
                        取消定时
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
                  <Checkbox
                    checked={showSubtitles}
                    onCheckedChange={(checked) => setShowSubtitles(checked === true)}
                  />
                  <span>字幕</span>
                </label>
              </div>
            </footer>
          </main>
        ) : audioError ? (
          <p className="p-6 text-sm text-destructive">{audioError}</p>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {isActive ? '播客正在生成，完成后这里会出现播放器。' : episode.error_message || '播客暂不可播放'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="border-b bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-background text-primary shadow-sm">
              <Headphones className="h-6 w-6" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-background text-xs">
                  播客
                </Badge>
                <Badge variant="outline" className={cn('text-xs', getPodcastStatusClassName(status))}>
                  {getPodcastStatusLabel(status)}
                </Badge>
              </div>
              <h4 className="break-words text-sm font-semibold leading-5">{episode.name}</h4>
              <p className="text-xs text-muted-foreground">
                生成时间：{formatPodcastEpisodeDate(episode.created, language)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {audioSrc && onOpenStudio ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onOpenStudio(episode)}
                aria-label="在 Studio 中展开播放器"
                title="在 Studio 中展开播放器"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            ) : null}
            {onExport ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => onExport(episode)}
                aria-label="导出播客音频"
                title="导出 WAV"
              >
                <Download className="mr-2 h-4 w-4" />
                导出 WAV
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(episode)}
                aria-label="删除播客"
                title="删除播客"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {audioSrc ? (
        <div className="space-y-2 p-3">
          {audioElement}
          <input
            type="range"
            min={0}
            max={Math.max(duration, currentTime, 1)}
            step={0.1}
            value={Math.min(currentTime, Math.max(duration, currentTime, 1))}
            onChange={(event) => handleSeek(event.target.value)}
            className="w-full accent-indigo-600"
            aria-label="播客播放进度"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={() => seekBy(-15)}
              aria-label="后退 15 秒"
            >
              <Rewind className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={handleTogglePlay}
              aria-label={isPlaying ? '暂停播客' : '播放播客'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={() => seekBy(15)}
              aria-label="前进 15 秒"
            >
              <FastForward className="h-4 w-4" />
            </Button>
            <Select value={String(playbackRate)} onValueChange={handlePlaybackRateChange}>
              <SelectTrigger className="h-8 w-20 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PODCAST_PLAYBACK_RATES.map((rate) => (
                  <SelectItem key={rate} value={String(rate)}>
                    {rate}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="播放列表和定时"
                  title="播放列表和定时"
                >
                  <ListMusic className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onQueueAdd && (
                  <DropdownMenuItem onClick={() => onQueueAdd(episode)}>
                    <ListMusic className="mr-2 h-4 w-4" />
                    {queuePosition ? `队列第 ${queuePosition} 个` : '添加到播放队列'}
                  </DropdownMenuItem>
                )}
                {queueEpisodes.length > 0 && (
                  <>
                    <DropdownMenuItem disabled className="text-xs">
                      播放队列
                    </DropdownMenuItem>
                    {queueEpisodes.map((queuedEpisode, index) => (
                      <DropdownMenuItem
                        key={queuedEpisode.id}
                        onClick={() => onQueueRemove?.(queuedEpisode.id)}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="min-w-0 truncate">
                          {index + 1}. {queuedEpisode.name}
                        </span>
                        <X className="h-3.5 w-3.5 shrink-0" />
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onClick={onQueueClear}>
                      清空队列
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={() => handleLoopPlaybackChange(!loopPlayback)}>
                  <Repeat className="mr-2 h-4 w-4" />
                  {loopPlayback ? '取消循环' : '循环播放'}
                </DropdownMenuItem>
                {[15, 30, 60].map((minutes) => (
                  <DropdownMenuItem key={minutes} onClick={() => handleSleepTimerChange(minutes)}>
                    <TimerReset className="mr-2 h-4 w-4" />
                    {minutes} 分钟后停止
                  </DropdownMenuItem>
                ))}
                {sleepTimerMinutes > 0 && (
                  <DropdownMenuItem onClick={() => handleSleepTimerChange(0)}>
                    <TimerReset className="mr-2 h-4 w-4" />
                    取消定时
                  </DropdownMenuItem>
                )}
                {onExport && (
                  <DropdownMenuItem onClick={() => onExport(episode)}>
                    <Download className="mr-2 h-4 w-4" />
                    导出 WAV
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onDelete(episode)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除播客
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto flex min-w-16 justify-end text-[11px] tabular-nums text-muted-foreground">
              {formatPodcastTime(currentTime)}
            </div>
          </div>
        </div>
      ) : audioError ? (
        <p className="p-3 text-sm text-destructive">{audioError}</p>
      ) : isActive ? (
        <p className="p-3 text-sm text-muted-foreground">播客正在生成，完成后这里会出现播放器。</p>
      ) : isFailed ? (
        <p className="p-3 text-sm text-destructive">
          {episode.error_message || '播客生成失败'}
        </p>
      ) : null}
    </div>
  )
}

interface NotesColumnProps {
  notes?: NoteResponse[]
  isLoading: boolean
  notebookId: string
  notebookName?: string
  sources?: SourceListResponse[]
  contextSelections?: Record<string, NoteContextMode>
  onContextModeChange?: (noteId: string, mode: NoteContextMode) => void
  onBulkContextModeChange?: (action: NoteContextDefault) => void
  profileOptions?: LearningProfileOptions
  onProfileOptionsChange?: (options: LearningProfileOptions) => void
}

export function NotesColumn({
  notes,
  isLoading,
  notebookId,
  notebookName,
  sources = [],
  contextSelections,
  onContextModeChange,
  onBulkContextModeChange,
  profileOptions = { autoUpdateProfile: true, useProfileSource: true },
  onProfileOptionsChange = () => {},
}: NotesColumnProps) {
  const { t, language } = useTranslation()
  const { data: modelDefaults } = useModelDefaults()
  const queryClient = useQueryClient()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [detailAssetKind, setDetailAssetKind] = useState<LearningOutputKind | null>(null)
  const [editingNote, setEditingNote] = useState<NoteResponse | null>(null)
  const [openNoteFullscreen, setOpenNoteFullscreen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)
  const [assetDetails, setAssetDetails] =
    useState<Record<LearningOutputKind, LearningAssetDetailConfig>>(DEFAULT_ASSET_DETAILS)
  const [isSubmittingAssets, setIsSubmittingAssets] = useState(false)
  const [assetJobs, setAssetJobs] = useState<AssetJobTracker[]>([])
  const [handledAssetJobIds, setHandledAssetJobIds] = useState<string[]>([])
  const [podcastJobs, setPodcastJobs] = useState<PodcastJobTracker[]>([])
  const [handledPodcastJobIds, setHandledPodcastJobIds] = useState<string[]>([])
  const [podcastLanguage, setPodcastLanguage] = useState('中文')
  const [podcastSubtitleMode, setPodcastSubtitleMode] = useState<PodcastSubtitleMode>('single_line')
  const [podcastEpisodeName, setPodcastEpisodeName] = useState('')
  const [podcastGenerateDialogOpen, setPodcastGenerateDialogOpen] = useState(false)
  const [podcastMaterialLibraryExpanded, setPodcastMaterialLibraryExpanded] = useState(false)
  const [podcastMaterialSearch, setPodcastMaterialSearch] = useState('')
  const [selectedPodcastMaterialIds, setSelectedPodcastMaterialIds] = useState<string[]>([])
  const [studioPodcastEpisode, setStudioPodcastEpisode] = useState<PodcastEpisode | null>(null)
  const [studioCategoryFilter, setStudioCategoryFilter] = useState<StudioCategoryFilter>('all')
  const [isExportingStudioAsset, setIsExportingStudioAsset] = useState(false)
  const [podcastPlaybackById, setPodcastPlaybackById] = useState<Record<string, PodcastPlaybackSnapshot>>({})
  const [podcastQueue, setPodcastQueue] = useState<string[]>([])
  const deleteNote = useDeleteNote()
  const deleteSource = useDeleteSource()
  const deletePodcastEpisode = useDeletePodcastEpisode()
  const episodeProfilesQuery = useEpisodeProfiles()
  const episodeProfiles = useMemo(
    () => episodeProfilesQuery.data ?? [],
    [episodeProfilesQuery.data]
  )
  const speakerProfilesQuery = useSpeakerProfiles(episodeProfiles)
  const speakerProfiles = useMemo(
    () => speakerProfilesQuery.data ?? [],
    [speakerProfilesQuery.data]
  )
  const generatePodcast = useGeneratePodcast()
  useEffect(() => {
    const nextLanguage = getGenerationLanguageFromLocale(language)
    setPodcastLanguage((current) => (
      current === '中文' || current === 'English' ? nextLanguage : current
    ))
    setAssetDetails((current) => {
      let changed = false
      const next = { ...current }
      for (const kind of Object.keys(next) as LearningOutputKind[]) {
        const currentLanguage = next[kind].language
        if (currentLanguage === '中文' || currentLanguage === 'English') {
          if (currentLanguage !== nextLanguage) {
            next[kind] = { ...next[kind], language: nextLanguage }
            changed = true
          }
        }
      }
      return changed ? next : current
    })
  }, [language])
  const podcastEpisodesQuery = usePodcastEpisodes()
  const notebookPodcastEpisodes = useMemo(() => {
    const legacyEpisodeName = `${notebookName || '学习记录'} 播客`
    return podcastEpisodesQuery.episodes.filter((episode) => {
      if (sameRecordId(episode.notebook_id, notebookId)) {
        return true
      }
      const isCompletedLegacyEpisode =
        episode.job_status === 'completed' || Boolean(episode.audio_url)
      return (
        !episode.notebook_id &&
        isCompletedLegacyEpisode &&
        (episode.name === legacyEpisodeName || episode.name.startsWith(`${legacyEpisodeName} `))
      )
    })
  }, [notebookId, notebookName, podcastEpisodesQuery.episodes])
  const podcastEpisodeById = useMemo(
    () => new Map(notebookPodcastEpisodes.map((episode) => [episode.id, episode])),
    [notebookPodcastEpisodes]
  )
  const queuedPodcastEpisodes = useMemo(
    () => podcastQueue
      .map((episodeId) => podcastEpisodeById.get(episodeId))
      .filter((episode): episode is PodcastEpisode => Boolean(episode)),
    [podcastEpisodeById, podcastQueue]
  )
  const nextPodcastEpisodeName = useMemo(
    () => buildPodcastEpisodeName(notebookName, notebookPodcastEpisodes.length + 1),
    [notebookName, notebookPodcastEpisodes.length]
  )
  const contentSources = useMemo(
    () => sources.filter((source) => !isLearningProfileSource(source)),
    [sources]
  )
  const profileSources = useMemo(
    () => sources.filter(isLearningProfileSource),
    [sources]
  )
  const materialOptions = useMemo<LearningAssetMaterialOption[]>(() => {
    const sourceMaterials = contentSources.map((source) => {
      const title = source.title || source.asset?.url || source.id
      return {
        id: `source-material:${source.id}`,
        title,
        materialType: '来源',
        description: source.topics?.length ? `主题：${source.topics.join('、')}` : source.id,
        sourceId: source.id,
        deleteType: 'source' as const,
        deleteId: source.id,
      }
    })

    const noteMaterials = (notes ?? [])
      .map((note) => {
        const asset = parseLearningAssetNote(note.content)
        const content = asset?.content || getVisibleLearningAssetContent(note.content)
        if (!content?.trim()) {
          return null
        }
        return {
          id: `note-material:${note.id}`,
          title: stripLearningAssetTitlePrefix(note.title) || asset?.title || '未命名笔记',
          materialType: note.note_type === 'ai' ? '学习资产' : '笔记',
          description: content.slice(0, 180),
          content: content.slice(0, 8000),
          deleteType: 'note' as const,
          deleteId: note.id,
        }
      })
      .filter(Boolean) as LearningAssetMaterialOption[]

    const podcastMaterials = notebookPodcastEpisodes
      .map((episode) => {
        const transcriptEntries = extractPodcastTranscriptEntries(episode.transcript)
        const content = transcriptEntries
          .map((entry, index) => {
            const speaker = entry.speaker || `Speaker ${index + 1}`
            return `${speaker}: ${entry.dialogue || ''}`
          })
          .filter((line) => line.trim())
          .join('\n')
        if (!content.trim()) {
          return null
        }
        return {
          id: `podcast-material:${episode.id}`,
          title: `${episode.name} 字幕`,
          materialType: '播客字幕',
          description: content.slice(0, 180),
          content: content.slice(0, 10000),
          deleteType: 'podcast' as const,
          deleteId: episode.id,
        }
      })
      .filter(Boolean) as LearningAssetMaterialOption[]

    return [...sourceMaterials, ...noteMaterials, ...podcastMaterials]
  }, [contentSources, notebookPodcastEpisodes, notes])
  const mindMapMaterials = useMemo<MindMapMaterial[]>(
    () => materialOptions.map((material) => ({
      id: material.id,
      title: material.title,
      materialType: material.materialType,
      description: material.description,
      content: material.content,
    })),
    [materialOptions]
  )
  const filteredPodcastMaterialOptions = useMemo(() => {
    const keyword = podcastMaterialSearch.trim().toLowerCase()
    if (!keyword) {
      return materialOptions
    }
    return materialOptions.filter((material) => (
      [
        material.title,
        material.materialType,
        material.description,
        material.id,
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
        .includes(keyword)
    ))
  }, [materialOptions, podcastMaterialSearch])
  const isAssetListLoading = isLoading || podcastEpisodesQuery.isLoading
  const studioCategoryCounts = useMemo(() => {
    const counts = STUDIO_CATEGORY_OPTIONS.reduce<Record<StudioCategoryFilter, number>>(
      (accumulator, option) => {
        accumulator[option.id] = 0
        return accumulator
      },
      {} as Record<StudioCategoryFilter, number>
    )
    counts.podcast = notebookPodcastEpisodes.length
    for (const note of notes ?? []) {
      const asset = parseLearningAssetNote(note.content)
      const kind = asset?.kind ?? inferLearningAssetKind(note.content, note.title)
      if (kind && counts[kind] !== undefined) {
        counts[kind] += 1
      }
    }
    counts.all = notebookPodcastEpisodes.length + (notes?.length ?? 0)
    return counts
  }, [notebookPodcastEpisodes.length, notes])
  const visibleNotebookPodcastEpisodes = useMemo(
    () => (
      studioCategoryFilter === 'all' || studioCategoryFilter === 'podcast'
        ? notebookPodcastEpisodes
        : []
    ),
    [notebookPodcastEpisodes, studioCategoryFilter]
  )
  const visibleStudioNotes = useMemo(
    () => (notes ?? []).filter((note) => {
      if (studioCategoryFilter === 'all') {
        return true
      }
      if (studioCategoryFilter === 'podcast') {
        return false
      }
      const asset = parseLearningAssetNote(note.content)
      const kind = asset?.kind ?? inferLearningAssetKind(note.content, note.title)
      return kind === studioCategoryFilter
    }),
    [notes, studioCategoryFilter]
  )
  const [isBuildingPodcast, setIsBuildingPodcast] = useState(false)

  const { notesCollapsed, toggleNotes } = useNotebookColumnsStore()
  const notesLabel = '学习资产'
  const collapseButton = useMemo(
    () => createCollapseButton(toggleNotes, notesLabel),
    [toggleNotes, notesLabel]
  )

  const currentAssetDetail = detailAssetKind
    ? assetDetails[detailAssetKind] ?? getDefaultLearningAssetDetail(detailAssetKind)
    : getDefaultLearningAssetDetail('study_guide')
  const isGeneratingStudioAsset =
    isSubmittingAssets || isBuildingPodcast || generatePodcast.isPending
  const assetJobStatuses = useQueries({
    queries: assetJobs.map((job) => ({
      queryKey: ['commands', 'job', job.jobId],
      queryFn: () => commandsApi.getJob(job.jobId),
      enabled: !handledAssetJobIds.includes(job.jobId),
      refetchInterval: 1500,
    })),
  })
  const podcastJobStatuses = useQueries({
    queries: podcastJobs.map((job) => ({
      queryKey: ['commands', 'job', job.jobId],
      queryFn: () => commandsApi.getJob(job.jobId),
      enabled: !handledPodcastJobIds.includes(job.jobId),
      refetchInterval: 2000,
    })),
  })

  const invalidateLearningRecord = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(notebookId) })
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
  }, [notebookId, queryClient])

  const recordLearningEvent = async (eventType: string, summary: string) => {
    if (!profileOptions.autoUpdateProfile) return
    try {
      await learningApi.recordProfileEvent({
        learning_record_id: notebookId,
        event_type: eventType,
        summary,
        auto_update_profile: profileOptions.autoUpdateProfile,
      })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
      await queryClient.invalidateQueries({ queryKey: ['learning', 'profile-source', notebookId] })
    } catch (error) {
      console.debug('Failed to record learning profile event:', error)
    }
  }

  const handleExportStudioTarget = async (
    target: StudioExportTarget,
    format: StudioExportFormat = 'default'
  ) => {
    const title = getStudioAssetTitle(target)
    setIsExportingStudioAsset(true)

    try {
      if (target.type === 'podcast') {
        const exportUrl = await resolvePodcastAssetUrl(`/api/podcasts/episodes/${encodeURIComponent(target.episode.id)}/audio/wav`)
        if (!exportUrl) {
          toast.error('当前播客没有可导出的音频')
          return
        }
        const response = await fetch(exportUrl, { headers: getAuthenticatedDownloadHeaders() })
        if (!response.ok) {
          throw new Error(`Podcast export failed with status ${response.status}`)
        }
        const blob = await response.blob()
        downloadBlob(blob, `${safeExportFilename(title, 'podcast')}.wav`)
        return
      }

      const asset = target.asset
      if (!asset) {
        toast.error('当前文本资产暂不支持导出')
        return
      }

      if (asset.kind === 'study_guide') {
        openPrintableDocument(title, markdownToPrintableHtml(target.visibleContent || asset.content))
        return
      }

      if (asset.kind === 'quiz') {
        const mistakeMarkdown = buildQuizMistakeMarkdown(asset)
        if (!mistakeMarkdown) {
          toast.error('当前测验还没有错题可导出')
          return
        }
        openPrintableDocument(`${title} 错题本`, markdownToPrintableHtml(mistakeMarkdown))
        return
      }

      if (asset.kind === 'mind_map') {
        if (format === 'mind_map_png') {
          const svg = mindMapContentToSvg(asset.content, title)
          const blob = await svgToPngBlob(svg)
          downloadBlob(blob, `${safeExportFilename(title, 'mind-map')}.png`)
          return
        }

        downloadBlob(
          new Blob(
            [
              [
                `# ${title}`,
                '',
                asset.content,
              ].join('\n'),
            ],
            { type: 'text/markdown;charset=utf-8' }
          ),
          `${safeExportFilename(title, 'mind-map')}.md`
        )
        return
      }

      if (asset.kind === 'visual_aid') {
        const imageSrc = typeof asset.payload?.image_src === 'string' ? asset.payload.image_src : ''
        if (imageSrc) {
          const response = await fetch(imageSrc)
          const blob = await response.blob()
          downloadBlob(blob, `${safeExportFilename(title, 'visual-aid')}.png`)
          return
        }
        downloadBlob(
          new Blob(
            [
              [
                `# ${title}`,
                '',
                asset.content,
              ].join('\n'),
            ],
            { type: 'text/markdown;charset=utf-8' }
          ),
          `${safeExportFilename(title, 'visual-aid')}.md`
        )
        return
      }

      if (asset.kind === 'code_lab') {
        const notebook = buildNotebookFromCodeLab(asset)
        if (!notebook) {
          toast.error('当前代码实验没有可执行代码块，暂不能导出 Jupyter Notebook')
          return
        }
        downloadBlob(
          new Blob([JSON.stringify(notebook, null, 2)], { type: 'application/x-ipynb+json' }),
          `${safeExportFilename(title, 'code-lab')}.ipynb`
        )
        return
      }

      toast.info('当前资源类型不适合导出')
    } catch (error) {
      console.error('Failed to export Studio asset:', error)
      toast.error('导出失败')
    } finally {
      setIsExportingStudioAsset(false)
    }
  }

  useEffect(() => {
    if (assetJobs.length === 0) return

    let terminalCount = 0
    let completedCount = 0
    let changed = false
    const nextHandled = new Set(handledAssetJobIds)

    for (const [index, query] of assetJobStatuses.entries()) {
      const tracker = assetJobs[index]
      const status = query.data?.status
      if (!tracker || !status || ACTIVE_JOB_STATUSES.has(status)) {
        continue
      }

      terminalCount += 1
      if (!nextHandled.has(tracker.jobId)) {
        changed = true
        nextHandled.add(tracker.jobId)
        if (status === 'completed') {
          completedCount += 1
        } else if (status === 'canceled') {
          toast.error('学习资产任务已取消')
        } else if (status === 'failed') {
          toast.error(query.data?.error_message || '学习资产生成失败')
        }
      }
    }

    if (changed) {
      setHandledAssetJobIds(Array.from(nextHandled))
      void invalidateLearningRecord()
    }

    if (terminalCount === assetJobs.length && terminalCount > 0) {
      setAssetJobs([])
      setHandledAssetJobIds([])
      if (completedCount > 0) {
        toast.success(`已生成 ${completedCount} 个学习资产`)
      }
    }
  }, [assetJobStatuses, assetJobs, handledAssetJobIds, invalidateLearningRecord])

  useEffect(() => {
    if (podcastJobs.length === 0) return

    let terminalCount = 0
    let completedCount = 0
    let changed = false
    const nextHandled = new Set(handledPodcastJobIds)

    for (const [index, query] of podcastJobStatuses.entries()) {
      const tracker = podcastJobs[index]
      const status = query.data?.status
      if (!tracker || !status || ACTIVE_JOB_STATUSES.has(status)) {
        continue
      }

      terminalCount += 1
      if (!nextHandled.has(tracker.jobId)) {
        changed = true
        nextHandled.add(tracker.jobId)
        if (status === 'completed') {
          completedCount += 1
        } else if (status === 'canceled') {
          toast.error('播客生成任务已取消')
        } else if (status === 'failed') {
          toast.error(query.data?.error_message || '播客生成失败')
        }
      }
    }

    if (changed) {
      setHandledPodcastJobIds(Array.from(nextHandled))
      void queryClient.refetchQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
    }

    if (terminalCount === podcastJobs.length && terminalCount > 0) {
      setPodcastJobs([])
      setHandledPodcastJobIds([])
      if (completedCount > 0) {
        toast.success('播客已生成')
      }
    }
  }, [handledPodcastJobIds, podcastJobStatuses, podcastJobs, queryClient])

  const handleGenerateAssets = async (config: LearningAssetGenerationConfig) => {
    if (config.outputs.length === 0) {
      toast.error('请至少选择一种要生成的学习资产')
      return
    }
    const selectedMaterialIds = config.selectedMaterialIds
    const selectedMaterialSet = new Set(selectedMaterialIds ?? [])
    const selectedMaterials = selectedMaterialIds
      ? materialOptions.filter((material) => selectedMaterialSet.has(material.id))
      : []
    const selectedSourceIds = selectedMaterialIds
      ? selectedMaterials
          .map((material) => material.sourceId)
          .filter((sourceId): sourceId is string => Boolean(sourceId))
      : contentSources.map((source) => source.id)
    const supplementalMaterials = config.supplementalMaterials ?? []

    if (selectedSourceIds.length === 0 && supplementalMaterials.length === 0) {
      toast.error('请先选择至少一个素材，再生成学习资产')
      return
    }

    setIsSubmittingAssets(true)
    try {
      const sourceHistory = selectedMaterialIds
        ? selectedMaterials.map((material, index) => `素材 ${index + 1}: ${material.title} (${material.materialType})`)
        : contentSources.map((source, index) => {
            const sourceTitle = source.title || source.asset?.url || source.id
            return `来源 ${index + 1}: ${sourceTitle}`
          })
      const acceptedResourceIds = [...selectedSourceIds]
      if (config.useProfileSource) {
        acceptedResourceIds.push(...profileSources.map((source) => source.id))
      }

      const response: AssetJobsSubmissionResponse = await learningApi.submitAssetJobs({
        message: config.goal,
        mode: 'generate',
        course: notebookName || '当前学习记录',
        goal: config.goal,
        learning_history: sourceHistory,
        requested_outputs: config.outputs,
        accepted_resource_ids: acceptedResourceIds,
        supplemental_materials: supplementalMaterials,
        learning_record_id: notebookId,
        target_language: getGenerationLanguageFromLocale(language),
        image_model: config.outputs.includes('visual_aid')
          ? (modelDefaults?.default_image_model || undefined)
          : undefined,
        auto_update_profile: config.autoUpdateProfile,
        use_profile_source: config.useProfileSource,
      })

      if (Array.isArray(response.jobs)) {
        if (response.jobs.length === 0) {
          toast.error('没有提交任何学习资产任务')
          return
        }

        setAssetJobs((previous) => [
          ...previous,
          ...response.jobs.map((job) => ({
            jobId: job.job_id,
            outputKind: job.output_kind,
          })),
        ])
        toast.success(`已加入 ${response.jobs.length} 个学习资产任务`)
        setDetailAssetKind(null)
        return
      }

    } catch (error) {
      console.error('Failed to generate learning assets:', error)
      toast.error('生成学习资产失败')
    } finally {
      setIsSubmittingAssets(false)
    }
  }

  const buildPodcastContent = useCallback(async (selectedMaterialIds?: string[]) => {
    const hasExplicitSelection = Array.isArray(selectedMaterialIds)
    const selectedMaterialSet = new Set(selectedMaterialIds ?? [])
    const selectedMaterials = hasExplicitSelection
      ? materialOptions.filter((material) => selectedMaterialSet.has(material.id))
      : []
    const selectedSourceIds = hasExplicitSelection
      ? selectedMaterials
          .map((material) => material.sourceId)
          .filter((sourceId): sourceId is string => Boolean(sourceId))
      : contentSources.map((source) => source.id)
    const selectedSourceSet = new Set(selectedSourceIds)
    const selectedSources = contentSources
      .filter((source) => selectedSourceSet.has(source.id))
    const podcastSources = hasExplicitSelection
      ? selectedSources
      : selectedSources.slice(0, DEFAULT_PODCAST_MATERIAL_LIMIT)
    const supplementalMaterials = hasExplicitSelection
      ? selectedMaterials.filter((material) => !material.sourceId && material.content?.trim())
      : []
    const sourcesConfig = [...podcastSources, ...(profileOptions.useProfileSource ? profileSources : [])]
      .reduce<Record<string, string>>((accumulator, source) => {
        const sourceId = source.id.replace(/^source:/, '')
        accumulator[sourceId] = source.insights_count && source.insights_count > 0
          ? 'insights'
          : 'full content'
        return accumulator
      }, {})

    const parts: string[] = []
    if (Object.keys(sourcesConfig).length > 0) {
      const response = await chatApi.buildContext({
        notebook_id: notebookId,
        context_config: {
          sources: sourcesConfig,
          notes: {},
        },
      })

      if (response.char_count > 0) {
        parts.push(JSON.stringify(response.context, null, 2).slice(0, PODCAST_CONTEXT_CHAR_LIMIT))
      }
    }

    if (supplementalMaterials.length > 0) {
      parts.push(
        supplementalMaterials
          .map((material, index) => [
            `补充素材 ${index + 1}: ${material.title}`,
            `类型: ${material.materialType}`,
            (material.content ?? '').slice(0, PODCAST_SUPPLEMENTAL_CHAR_LIMIT),
          ].join('\n'))
          .join('\n\n')
      )
    }

    return parts.join('\n\n').slice(0, PODCAST_CONTEXT_CHAR_LIMIT)
  }, [contentSources, materialOptions, notebookId, profileOptions.useProfileSource, profileSources])

  const handleGeneratePodcast = useCallback(async (options?: {
    episodeName?: string
    language?: string
    subtitleMode?: PodcastSubtitleMode
    selectedMaterialIds?: string[]
  }) => {
    const selectedMaterialIds = options?.selectedMaterialIds
    const selectedMaterialSet = new Set(selectedMaterialIds ?? [])
    const selectedMaterials = selectedMaterialIds
      ? materialOptions.filter((material) => selectedMaterialSet.has(material.id))
      : []

    if (selectedMaterialIds ? selectedMaterials.length === 0 : materialOptions.length === 0) {
      toast.error('请先添加或选择至少一个资料，再生成播客')
      return
    }

    if (episodeProfilesQuery.isLoading || speakerProfilesQuery.isLoading) {
      toast.error('播客配置仍在加载，请稍后再试')
      return
    }

    const selectedEpisodeProfile =
      episodeProfiles.find((profile) => !needsModelSetup(profile)) ?? episodeProfiles[0]

    if (!selectedEpisodeProfile) {
      toast.error('请先在播客页面创建单集简介和说话人配置')
      return
    }

    if (needsModelSetup(selectedEpisodeProfile)) {
      toast.error('当前播客单集简介缺少 outline/transcript 模型配置')
      return
    }

    const speakerProfile = speakerProfiles.find(
      (profile) => profile.name === selectedEpisodeProfile.speaker_config
    )
    if (!speakerProfile || needsModelSetup(speakerProfile)) {
      toast.error('当前播客说话人配置缺少 TTS 模型')
      return
    }

    setIsBuildingPodcast(true)
    try {
      const episodeName = (options?.episodeName || nextPodcastEpisodeName).trim()
      const languageChoice = options?.language ?? podcastLanguage
      const subtitleMode = options?.subtitleMode ?? podcastSubtitleMode
      const content = await buildPodcastContent(selectedMaterialIds)
      if (!content.trim()) {
        toast.error('当前来源还没有可用于生成播客的文本内容')
        return
      }

      const response = await generatePodcast.mutateAsync({
        episode_profile: selectedEpisodeProfile.name,
        speaker_profile: selectedEpisodeProfile.speaker_config,
        episode_name: episodeName,
        content,
        notebook_id: notebookId,
        briefing_suffix:
          [
            '请基于当前学习记录来源生成面向学习复盘的音频播客，聚焦核心概念、易错点、概念边界和下一步学习行动；不要把内容写成提纲。',
            `语音语言：${languageChoice}。`,
            subtitleMode === 'single_line'
              ? '请生成清晰可读的逐句 transcript，每句尽量短，适合平台单行滚动字幕。'
              : subtitleMode === 'bilingual'
                ? '请生成中英双语逐句 transcript，便于平台字幕切换和学习复盘。'
                : '不需要面向播放显示的字幕，但仍需保留基础 transcript 供归档和检索。',
          ].join('\n'),
      })
      setPodcastJobs((previous) => {
        if (previous.some((job) => job.jobId === response.job_id)) {
          return previous
        }
        return [...previous, { jobId: response.job_id }]
      })
      await queryClient.refetchQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
    } catch (error) {
      console.error('Failed to generate podcast:', error)
      toast.error('播客生成任务提交失败')
    } finally {
      setIsBuildingPodcast(false)
    }
  }, [
    buildPodcastContent,
    episodeProfiles,
    episodeProfilesQuery.isLoading,
    generatePodcast,
    materialOptions,
    nextPodcastEpisodeName,
    notebookId,
    podcastLanguage,
    podcastSubtitleMode,
    queryClient,
    speakerProfiles,
    speakerProfilesQuery.isLoading,
  ])

  const handleQuickGenerateAsset = (kind: StudioAssetKind) => {
    if (kind === 'podcast') {
      setPodcastGenerateDialogOpen(true)
      return
    }

    const targetLanguage = getGenerationLanguageFromLocale(language)
    const detail = assetDetails[kind] ?? getDefaultLearningAssetDetail(kind)
    void handleGenerateAssets({
      goal: buildLearningAssetGoal(kind, { ...detail, language: targetLanguage }),
      outputs: [kind],
      autoUpdateProfile: profileOptions.autoUpdateProfile,
      useProfileSource: profileOptions.useProfileSource,
    })
  }

  const handleGenerateSimilarQuiz = (resource: LearningResource) => {
    const quizContent = [
      resource.content,
      resource.payload ? JSON.stringify(resource.payload, null, 2) : '',
    ].filter(Boolean).join('\n\n')
    void handleGenerateAssets({
      goal: [
        '请基于当前测验和已选学习资料生成一组相似题练习。',
        '要求：知识点保持一致，但题干、选项、干扰项和解析必须重新编写；难度接近原题；解析必须引用来源依据。',
        `原测验标题：${resource.title}`,
        `语言：${getGenerationLanguageFromLocale(language)}`,
        '资产类型：测验',
        '具体格式：相似题练习。',
      ].join('\n'),
      outputs: ['quiz'],
      autoUpdateProfile: profileOptions.autoUpdateProfile,
      useProfileSource: profileOptions.useProfileSource,
      supplementalMaterials: [
        {
          id: `similar-quiz-source:${resource.title}`,
          title: `${resource.title} 原测验`,
          material_type: 'quiz',
          content: quizContent || resource.content,
        },
      ],
    })
  }

  const handleDeleteClick = (noteId: string) => {
    setNoteToDelete(noteId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!noteToDelete) return

    try {
      await deleteNote.mutateAsync(noteToDelete)
      setDeleteDialogOpen(false)
      setNoteToDelete(null)
    } catch (error) {
      console.error('Failed to delete note:', error)
    }
  }

  useEffect(() => {
    if (!podcastGenerateDialogOpen) {
      return
    }
    setPodcastEpisodeName(nextPodcastEpisodeName)
    setSelectedPodcastMaterialIds(
      materialOptions.slice(0, DEFAULT_PODCAST_MATERIAL_LIMIT).map((material) => material.id)
    )
    setPodcastMaterialSearch('')
    setPodcastMaterialLibraryExpanded(false)
  }, [materialOptions, nextPodcastEpisodeName, podcastGenerateDialogOpen])

  const updatePodcastPlayback = useCallback((episodeId: string, patch: PodcastPlaybackSnapshot) => {
    setPodcastPlaybackById((current) => ({
      ...current,
      [episodeId]: {
        ...(current[episodeId] ?? {}),
        ...patch,
      },
    }))
  }, [])

  const handleAddPodcastToQueue = useCallback((episode: PodcastEpisode) => {
    setPodcastQueue((current) => (
      current.includes(episode.id) ? current : [...current, episode.id]
    ))
  }, [])

  const handleRemovePodcastFromQueue = useCallback((episodeId: string) => {
    setPodcastQueue((current) => current.filter((queuedId) => queuedId !== episodeId))
  }, [])

  const handleClearPodcastQueue = useCallback(() => {
    setPodcastQueue([])
  }, [])

  const handleDeleteMaterial = async (material: LearningAssetMaterialOption) => {
    if (!material.deleteId || !material.deleteType) return

    if (material.deleteType === 'source') {
      await deleteSource.mutateAsync(material.deleteId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
      return
    }

    if (material.deleteType === 'note') {
      await deleteNote.mutateAsync(material.deleteId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
      return
    }

    if (material.deleteType === 'podcast') {
      await deletePodcastEpisode.mutateAsync(material.deleteId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
    }
  }

  const handleDeletePodcastEpisode = async (episode: PodcastEpisode) => {
    const confirmed = window.confirm(`确定删除播客「${episode.name}」吗？`)
    if (!confirmed) return
    await deletePodcastEpisode.mutateAsync(episode.id)
    if (studioPodcastEpisode?.id === episode.id) {
      setStudioPodcastEpisode(null)
    }
    setPodcastPlaybackById((current) => {
      const next = { ...current }
      delete next[episode.id]
      return next
    })
    setPodcastQueue((current) => current.filter((episodeId) => episodeId !== episode.id))
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
  }

  return (
    <>
      <CollapsibleColumn
        isCollapsed={notesCollapsed}
        onToggle={toggleNotes}
        collapsedIcon={StickyNote}
        collapsedLabel={notesLabel}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">Studio</CardTitle>
              <div className="flex items-center gap-2">
                {onBulkContextModeChange && notes && notes.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" title={t('sources.bulkContext')}>
                        <ListChecks className="h-4 w-4" />
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('include')}>
                        {t('sources.includeAllInContext')}
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

          <CardContent
            className={cn(
              'flex-1 min-h-0 space-y-4',
              studioPodcastEpisode ? 'overflow-hidden' : 'overflow-y-auto'
            )}
          >
            {studioPodcastEpisode ? (
              <NotebookPodcastAssetCard
                episode={studioPodcastEpisode}
                displayMode="studio"
                onBack={() => setStudioPodcastEpisode(null)}
                onExport={(episode) => void handleExportStudioTarget({ type: 'podcast', episode })}
                onDelete={(episode) => {
                  void handleDeletePodcastEpisode(episode)
                }}
                playbackSnapshot={podcastPlaybackById[studioPodcastEpisode.id]}
                onPlaybackChange={(patch) => updatePodcastPlayback(studioPodcastEpisode.id, patch)}
                onQueueAdd={handleAddPodcastToQueue}
                onQueueRemove={handleRemovePodcastFromQueue}
                onQueueClear={handleClearPodcastQueue}
                queueEpisodes={queuedPodcastEpisodes}
                queuePosition={podcastQueue.indexOf(studioPodcastEpisode.id) + 1 || undefined}
              />
            ) : (
              <>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 10rem), 1fr))',
              }}
            >
              {STUDIO_ASSET_OPTIONS.map((option) => {
                const Icon = STUDIO_ASSET_ICONS[option.kind] ?? FileText
                return (
                  <div
                    key={option.kind}
                    className={cn(
                      'studio-asset-card flex min-h-16 items-center gap-2 rounded-lg border p-3',
                      STUDIO_ASSET_STYLES[option.kind]
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => handleQuickGenerateAsset(option.kind)}
                      disabled={isGeneratingStudioAsset}
                    >
                      <Icon className="h-5 w-5 shrink-0 opacity-85" />
                      <span className="min-w-0 whitespace-normal break-words text-base font-semibold leading-5">
                        {option.kind === 'podcast'
                          ? option.label
                          : getLearningAssetKindLabel(option.kind, t)}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 rounded-full bg-background/45 hover:bg-background/80"
                      onClick={() => {
                        if (option.kind === 'podcast') {
                          setPodcastGenerateDialogOpen(true)
                        } else {
                          setDetailAssetKind(option.kind)
                        }
                      }}
                      disabled={isGeneratingStudioAsset}
                      aria-label={
                        option.kind === 'podcast'
                          ? '生成播客'
                          : `自定义 ${getLearningAssetKindLabel(option.kind, t)}`
                      }
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-center border-b pb-4">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  setEditingNote(null)
                  setShowAddDialog(true)
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                添加文本资产
              </Button>
            </div>

            {studioCategoryCounts.all > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {STUDIO_CATEGORY_OPTIONS
                  .filter((option) => option.id === 'all' || studioCategoryCounts[option.id] > 0)
                  .map((option) => {
                    const active = studioCategoryFilter === option.id
                    return (
                      <Button
                        key={option.id}
                        type="button"
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 shrink-0 rounded-full"
                        onClick={() => setStudioCategoryFilter(option.id)}
                      >
                        {option.label}
                        <span className={cn(
                          'ml-2 rounded-full px-1.5 text-[11px]',
                          active ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground'
                        )}>
                          {studioCategoryCounts[option.id]}
                        </span>
                      </Button>
                    )
                  })}
              </div>
            )}

            <div className="space-y-3">
              {isAssetListLoading ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : (!notes || notes.length === 0) && notebookPodcastEpisodes.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="生成内容会保存在这里"
                  description="添加来源后，点击上方按钮生成讲解文档、测验、知识闪卡等资产。"
                />
              ) : visibleStudioNotes.length === 0 && visibleNotebookPodcastEpisodes.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="当前分类暂无内容"
                  description="切换分类，或点击上方按钮生成对应类型的学习资产。"
                />
              ) : (
                <>
                  {visibleNotebookPodcastEpisodes.map((episode) => (
                    <NotebookPodcastAssetCard
                      key={episode.id}
                      episode={episode}
                      onOpenStudio={setStudioPodcastEpisode}
                      onExport={(podcastEpisode) => void handleExportStudioTarget({ type: 'podcast', episode: podcastEpisode })}
                      onDelete={(podcastEpisode) => {
                        void handleDeletePodcastEpisode(podcastEpisode)
                      }}
                      playbackSnapshot={podcastPlaybackById[episode.id]}
                      onPlaybackChange={(patch) => updatePodcastPlayback(episode.id, patch)}
                      onQueueAdd={handleAddPodcastToQueue}
                      onQueueRemove={handleRemovePodcastFromQueue}
                      onQueueClear={handleClearPodcastQueue}
                      queueEpisodes={queuedPodcastEpisodes}
                      queuePosition={podcastQueue.indexOf(episode.id) + 1 || undefined}
                    />
                  ))}
                  {visibleStudioNotes.map((note) => {
                  const asset = parseLearningAssetNote(note.content)
                  const visibleContent = getVisibleLearningAssetContent(note.content)
                  const assetKind = asset?.kind ?? inferLearningAssetKind(note.content, note.title)
                  const assetKindLabel =
                    assetKind ? getLearningAssetKindLabel(assetKind, t) : asset?.type || null
                  const exportTarget: StudioExportTarget = {
                    type: 'learning_asset',
                    note,
                    asset,
                    visibleContent,
                    assetKind,
                    assetKindLabel,
                  }
                  const canExportAsset = isStudioTargetExportable(exportTarget)
                  const showInlineExport = canExportAsset && asset?.kind === 'study_guide'
                  return (
                    <div
                      key={note.id}
                      className="p-3 border rounded-lg card-hover group relative cursor-pointer"
                      onClick={() => {
                        setOpenNoteFullscreen(false)
                        setEditingNote(note)
                      }}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          {note.note_type === 'ai' ? (
                            <Bot className="h-4 w-4 text-primary" />
                          ) : (
                            <User className="h-4 w-4 text-muted-foreground" />
                          )}
                          <Badge variant="secondary" className="text-xs">
                            {note.note_type === 'ai' ? t('common.aiGenerated') : t('common.human')}
                          </Badge>
                          {assetKindLabel && (
                            <Badge variant="outline" className="text-xs">
                              {assetKindLabel}
                            </Badge>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {showInlineExport && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 shrink-0"
                              title={getStudioExportLabel(exportTarget)}
                              aria-label={getStudioExportLabel(exportTarget)}
                              disabled={isExportingStudioAsset}
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleExportStudioTarget(exportTarget)
                              }}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              导出 PDF
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
                            title="全屏打开"
                            aria-label="全屏打开"
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenNoteFullscreen(true)
                              setEditingNote(note)
                            }}
                          >
                            <Maximize2 className="h-4 w-4" />
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(note.updated), {
                              addSuffix: true,
                              locale: getDateLocale(language)
                            })}
                          </span>

                          {onContextModeChange && contextSelections?.[note.id] && (
                            <div onClick={(event) => event.stopPropagation()}>
                              <ContextToggle
                                mode={contextSelections[note.id]}
                                hasInsights={false}
                                onChange={(mode) => onContextModeChange(note.id, mode)}
                              />
                            </div>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {canExportAsset && asset?.kind === 'mind_map' ? (
                                <>
                                  <DropdownMenuItem
                                    disabled={isExportingStudioAsset}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void handleExportStudioTarget(exportTarget, 'mind_map_md')
                                    }}
                                  >
                                    <Download className="h-4 w-4 mr-2" />
                                    导出 MD
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={isExportingStudioAsset}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void handleExportStudioTarget(exportTarget, 'mind_map_png')
                                    }}
                                  >
                                    <Download className="h-4 w-4 mr-2" />
                                    导出图片 PNG
                                  </DropdownMenuItem>
                                </>
                              ) : canExportAsset && !showInlineExport ? (
                                <DropdownMenuItem
                                  disabled={isExportingStudioAsset}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleExportStudioTarget(exportTarget)
                                  }}
                                >
                                  <Download className="h-4 w-4 mr-2" />
                                  {getStudioExportLabel(exportTarget)}
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setOpenNoteFullscreen(true)
                                  setEditingNote(note)
                                }}
                              >
                                <Maximize2 className="h-4 w-4 mr-2" />
                                全屏打开
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleDeleteClick(note.id)
                                }}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                删除资产
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {(asset?.title || stripLearningAssetTitlePrefix(note.title)) && (
                        <h4 className="text-sm font-medium mb-2 break-all">
                          {asset?.title || stripLearningAssetTitlePrefix(note.title)}
                        </h4>
                      )}

                      {asset ? (
                        <div
                          className="mt-3 cursor-default"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <LearningAssetPreview
                            resource={asset}
                            compact
                            onLearningEvent={(event) => {
                              void recordLearningEvent(event.eventType, event.summary)
                            }}
                            onGenerateSimilarQuiz={handleGenerateSimilarQuiz}
                            mistakeContext={{
                              notebookId,
                              notebookTitle: notebookName || '当前学习记录',
                              noteId: note.id,
                              noteTitle: asset.title || stripLearningAssetTitlePrefix(note.title),
                            }}
                          />
                        </div>
                      ) : visibleContent ? (
                        <p className="text-sm text-muted-foreground line-clamp-3 break-all">
                          {visibleContent}
                        </p>
                      ) : null}
                    </div>
                  )
                  })}
                </>
              )}
            </div>
              </>
            )}
          </CardContent>
        </Card>
      </CollapsibleColumn>

      <LearningAssetGenerateDialog
        open={Boolean(detailAssetKind)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailAssetKind(null)
          }
        }}
        outputKind={detailAssetKind}
        detailConfig={currentAssetDetail}
        onDetailConfigChange={(config) => {
          if (!detailAssetKind) return
          setAssetDetails((previous) => ({
            ...previous,
            [detailAssetKind]: config,
          }))
        }}
        profileOptions={profileOptions}
        onProfileOptionsChange={onProfileOptionsChange}
        onGenerate={handleGenerateAssets}
        isGenerating={isGeneratingStudioAsset}
        sourceCount={contentSources.length}
        materialOptions={materialOptions}
        onDeleteMaterial={handleDeleteMaterial}
      />

      <Dialog open={podcastGenerateDialogOpen} onOpenChange={setPodcastGenerateDialogOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-lg" showCloseButton={false}>
          <DialogHeader className="shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogTitle className="text-lg">生成播客</DialogTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  选择这次播客的语音语言和字幕类型。
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setPodcastGenerateDialogOpen(false)}
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label htmlFor="podcast-generation-name">播客名称</Label>
              <input
                id="podcast-generation-name"
                value={podcastEpisodeName}
                onChange={(event) => setPodcastEpisodeName(event.target.value)}
                placeholder={nextPodcastEpisodeName}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:border-primary"
                disabled={isGeneratingStudioAsset}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="podcast-generation-language">语音语言</Label>
              <Select value={podcastLanguage} onValueChange={setPodcastLanguage}>
                <SelectTrigger id="podcast-generation-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="中文">中文</SelectItem>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="中英双语">中英双语</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="podcast-generation-subtitles">字幕类型</Label>
              <Select
                value={podcastSubtitleMode}
                onValueChange={(value) => setPodcastSubtitleMode(value as PodcastSubtitleMode)}
              >
                <SelectTrigger id="podcast-generation-subtitles">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_line">逐句单行字幕</SelectItem>
                  <SelectItem value="bilingual">中英双语字幕</SelectItem>
                  <SelectItem value="none">不显示字幕</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {materialOptions.length > 0 && (
              <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">资料范围</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      不手动选择时默认使用全部可用资料。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPodcastMaterialLibraryExpanded((current) => !current)}
                  >
                    {podcastMaterialLibraryExpanded ? '收起' : '选择资料'}
                    <ChevronDown className={cn('ml-2 h-4 w-4 transition-transform', podcastMaterialLibraryExpanded && 'rotate-180')} />
                  </Button>
                </div>
                {podcastMaterialLibraryExpanded ? (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={podcastMaterialSearch}
                        onChange={(event) => setPodcastMaterialSearch(event.target.value)}
                        placeholder="搜索资料标题、类型或摘要"
                        className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
                        disabled={isGeneratingStudioAsset}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isGeneratingStudioAsset || filteredPodcastMaterialOptions.length === 0}
                        onClick={() => {
                          setSelectedPodcastMaterialIds((current) =>
                            Array.from(new Set([
                              ...current,
                              ...filteredPodcastMaterialOptions.map((material) => material.id),
                            ]))
                          )
                        }}
                      >
                        全选当前
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isGeneratingStudioAsset || selectedPodcastMaterialIds.length === 0}
                        onClick={() => setSelectedPodcastMaterialIds([])}
                      >
                        清空
                      </Button>
                    </div>
                    <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border bg-background p-2">
                      {filteredPodcastMaterialOptions.length > 0 ? filteredPodcastMaterialOptions.map((material) => {
                        const checked = selectedPodcastMaterialIds.includes(material.id)
                        return (
                          <label
                            key={material.id}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm',
                              checked ? 'border-primary bg-primary/5' : 'bg-muted/20 hover:bg-muted/40'
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={isGeneratingStudioAsset}
                              onCheckedChange={(nextChecked) => {
                                setSelectedPodcastMaterialIds((current) => {
                                  if (nextChecked === true) {
                                    return current.includes(material.id) ? current : [...current, material.id]
                                  }
                                  return current.filter((id) => id !== material.id)
                                })
                              }}
                              className="mt-0.5"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="truncate font-medium">{material.title}</span>
                                <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                  {material.materialType}
                                </span>
                              </span>
                              {material.description && (
                                <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                                  {material.description}
                                </span>
                              )}
                            </span>
                          </label>
                        )
                      }) : (
                        <p className="p-3 text-sm text-muted-foreground">没有匹配的资料。</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      已选择 {selectedPodcastMaterialIds.length} / {materialOptions.length} 个资料；当前筛选 {filteredPodcastMaterialOptions.length} 个。
                    </p>
                  </>
                ) : (
                  <p className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                    当前默认使用 {selectedPodcastMaterialIds.length || materialOptions.length} 个可用资料。
                  </p>
                )}
              </section>
            )}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t bg-popover pt-4 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPodcastGenerateDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={isGeneratingStudioAsset || materialOptions.length === 0 || !podcastEpisodeName.trim()}
              onClick={() => {
                const materialIds = selectedPodcastMaterialIds.length > 0
                  ? selectedPodcastMaterialIds
                  : materialOptions.map((material) => material.id)
                setPodcastGenerateDialogOpen(false)
                void handleGeneratePodcast({
                  episodeName: podcastEpisodeName,
                  language: podcastLanguage,
                  subtitleMode: podcastSubtitleMode,
                  selectedMaterialIds: materialIds,
                })
              }}
            >
              {isGeneratingStudioAsset ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Headphones className="mr-2 h-4 w-4" />
              )}
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NoteEditorDialog
        open={showAddDialog || Boolean(editingNote)}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false)
            setEditingNote(null)
            setOpenNoteFullscreen(false)
          } else {
            setShowAddDialog(true)
          }
        }}
        notebookId={notebookId}
        note={editingNote ?? undefined}
        initialFullscreen={openNoteFullscreen}
        mindMapMaterials={mindMapMaterials}
        onLearningEvent={(event) => {
          void recordLearningEvent(event.eventType, event.summary)
        }}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="删除资产"
        description={t('notebooks.deleteNoteConfirm')}
        confirmText={t('common.delete')}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteNote.isPending}
        confirmVariant="destructive"
      />
    </>
  )
}
