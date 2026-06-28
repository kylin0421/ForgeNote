'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code2,
  FileText,
  Headphones,
  ListChecks,
  MoreVertical,
  Network,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  User,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ContextToggle } from '@/components/common/ContextToggle'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import {
  LearningAssetPreview,
  getLearningAssetKindLabel,
  getVisibleLearningAssetContent,
  parseLearningAssetNote,
} from '@/components/learning/LearningAssetPreview'
import { chatApi } from '@/lib/api/chat'
import { commandsApi } from '@/lib/api/commands'
import { learningApi } from '@/lib/api/learning'
import { resolvePodcastAssetUrl } from '@/lib/api/podcasts'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useDeleteNote } from '@/lib/hooks/use-notes'
import {
  useEpisodeProfiles,
  useGeneratePodcast,
  usePodcastEpisodes,
  useSpeakerProfiles,
} from '@/lib/hooks/use-podcasts'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { cn } from '@/lib/utils'
import { getDateLocale } from '@/lib/utils/date-locale'
import type { NoteResponse, SourceListResponse } from '@/lib/types/api'
import type { LearningOutputKind } from '@/lib/types/learning'
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
  type LearningProfileOptions,
} from './LearningAssetGenerateDialog'
import { NoteEditorDialog } from './NoteEditorDialog'

const LEARNING_PROFILE_TOPIC = 'learning_profile'
const LEARNING_PROFILE_TITLE = '学习画像'

const ACTIVE_JOB_STATUSES = new Set(['new', 'queued', 'running'])

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
  podcast: Headphones,
}

const STUDIO_ASSET_STYLES: Record<StudioAssetKind, string> = {
  study_guide: 'bg-blue-50 text-blue-800 border-blue-100 dark:bg-blue-950/30 dark:text-blue-200',
  quiz: 'bg-cyan-50 text-cyan-800 border-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-200',
  flashcards: 'bg-rose-50 text-rose-800 border-rose-100 dark:bg-rose-950/30 dark:text-rose-200',
  mind_map: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-100 dark:bg-fuchsia-950/30 dark:text-fuchsia-200',
  reading: 'bg-amber-50 text-amber-800 border-amber-100 dark:bg-amber-950/30 dark:text-amber-200',
  code_lab: 'bg-violet-50 text-violet-800 border-violet-100 dark:bg-violet-950/30 dark:text-violet-200',
  podcast: 'bg-indigo-50 text-indigo-800 border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-200',
}

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

function NotebookPodcastAssetCard({ episode }: { episode: PodcastEpisode }) {
  const { language } = useTranslation()
  const [audioSrc, setAudioSrc] = useState<string | undefined>()
  const [audioError, setAudioError] = useState<string | null>(null)
  const status = episode.job_status ?? 'unknown'
  const isActive = ACTIVE_EPISODE_STATUSES.includes(status)
  const isFailed = FAILED_EPISODE_STATUSES.includes(status)

  useEffect(() => {
    let revokeUrl: string | undefined
    setAudioError(null)
    setAudioSrc(undefined)

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
  }, [episode.audio_file, episode.audio_url])

  const createdLabel = episode.created
    ? formatDistanceToNow(new Date(episode.created), {
        addSuffix: true,
        locale: getDateLocale(language),
      })
    : null

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Headphones className="h-4 w-4 shrink-0 text-indigo-700 dark:text-indigo-300" />
            <Badge variant="outline" className="text-xs">
              播客
            </Badge>
            <Badge variant="outline" className={cn('text-xs', getPodcastStatusClassName(status))}>
              {getPodcastStatusLabel(status)}
            </Badge>
          </div>
          <h4 className="break-all text-sm font-medium">{episode.name}</h4>
        </div>
        {createdLabel ? (
          <span className="shrink-0 text-xs text-muted-foreground">{createdLabel}</span>
        ) : null}
      </div>

      {audioSrc ? (
        <audio controls preload="none" src={audioSrc} className="w-full" />
      ) : audioError ? (
        <p className="text-sm text-destructive">{audioError}</p>
      ) : isActive ? (
        <p className="text-sm text-muted-foreground">播客正在生成，完成后这里会出现播放器。</p>
      ) : isFailed ? (
        <p className="text-sm text-destructive">
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
  const queryClient = useQueryClient()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [detailAssetKind, setDetailAssetKind] = useState<LearningOutputKind | null>(null)
  const [editingNote, setEditingNote] = useState<NoteResponse | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)
  const [assetDetails, setAssetDetails] =
    useState<Record<LearningOutputKind, LearningAssetDetailConfig>>(DEFAULT_ASSET_DETAILS)
  const [isSubmittingAssets, setIsSubmittingAssets] = useState(false)
  const [assetJobs, setAssetJobs] = useState<AssetJobTracker[]>([])
  const [handledAssetJobIds, setHandledAssetJobIds] = useState<string[]>([])
  const [podcastJobs, setPodcastJobs] = useState<PodcastJobTracker[]>([])
  const [handledPodcastJobIds, setHandledPodcastJobIds] = useState<string[]>([])
  const deleteNote = useDeleteNote()
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
  const podcastEpisodesQuery = usePodcastEpisodes()
  const notebookPodcastEpisodes = useMemo(() => {
    const legacyEpisodeName = `${notebookName || '学习记录'} 播客`
    return podcastEpisodesQuery.episodes.filter((episode) => {
      if (episode.notebook_id === notebookId) {
        return true
      }
      return (
        !episode.notebook_id &&
        episode.name === legacyEpisodeName &&
        (episode.job_status === 'completed' || Boolean(episode.audio_url))
      )
    })
  }, [notebookId, notebookName, podcastEpisodesQuery.episodes])
  const isAssetListLoading = isLoading || podcastEpisodesQuery.isLoading
  const [isBuildingPodcast, setIsBuildingPodcast] = useState(false)

  const { notesCollapsed, toggleNotes } = useNotebookColumnsStore()
  const notesLabel = '学习资产'
  const collapseButton = useMemo(
    () => createCollapseButton(toggleNotes, notesLabel),
    [toggleNotes, notesLabel]
  )

  const contentSources = useMemo(
    () => sources.filter((source) => !isLearningProfileSource(source)),
    [sources]
  )
  const profileSources = useMemo(
    () => sources.filter(isLearningProfileSource),
    [sources]
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
    } catch (error) {
      console.debug('Failed to record learning profile event:', error)
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
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
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
    if (!contentSources.length) {
      toast.error('请先添加内容来源，再基于来源生成学习资产')
      return
    }

    setIsSubmittingAssets(true)
    try {
      const sourceHistory = contentSources.map((source, index) => {
        const sourceTitle = source.title || source.asset?.url || source.id
        return `来源 ${index + 1}: ${sourceTitle}`
      })
      const acceptedResourceIds = contentSources.map((source) => source.id)
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
        learning_record_id: notebookId,
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

  const buildPodcastContent = useCallback(async () => {
    const sourcesConfig = [...contentSources, ...(profileOptions.useProfileSource ? profileSources : [])]
      .reduce<Record<string, string>>((accumulator, source) => {
        const sourceId = source.id.replace(/^source:/, '')
        accumulator[sourceId] = source.insights_count && source.insights_count > 0
          ? 'insights'
          : 'full content'
        return accumulator
      }, {})

    const response = await chatApi.buildContext({
      notebook_id: notebookId,
      context_config: {
        sources: sourcesConfig,
        notes: {},
      },
    })

    if (response.char_count <= 0) {
      return ''
    }

    return JSON.stringify(response.context, null, 2)
  }, [contentSources, notebookId, profileOptions.useProfileSource, profileSources])

  const handleGeneratePodcast = useCallback(async () => {
    if (!contentSources.length) {
      toast.error('请先添加内容来源，再基于来源生成播客')
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
      const content = await buildPodcastContent()
      if (!content.trim()) {
        toast.error('当前来源还没有可用于生成播客的文本内容')
        return
      }

      const response = await generatePodcast.mutateAsync({
        episode_profile: selectedEpisodeProfile.name,
        speaker_profile: selectedEpisodeProfile.speaker_config,
        episode_name: `${notebookName || '学习记录'} 播客`,
        content,
        notebook_id: notebookId,
        briefing_suffix:
          '请基于当前学习记录来源生成面向学习复盘的音频播客，聚焦核心概念、易错点、概念边界和下一步学习行动；不要把内容写成提纲。',
      })
      setPodcastJobs((previous) => {
        if (previous.some((job) => job.jobId === response.job_id)) {
          return previous
        }
        return [...previous, { jobId: response.job_id }]
      })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
    } catch (error) {
      console.error('Failed to generate podcast:', error)
      toast.error('播客生成任务提交失败')
    } finally {
      setIsBuildingPodcast(false)
    }
  }, [
    buildPodcastContent,
    contentSources.length,
    episodeProfiles,
    episodeProfilesQuery.isLoading,
    generatePodcast,
    notebookId,
    notebookName,
    queryClient,
    speakerProfiles,
    speakerProfilesQuery.isLoading,
  ])

  const handleQuickGenerateAsset = (kind: StudioAssetKind) => {
    if (kind === 'podcast') {
      void handleGeneratePodcast()
      return
    }

    const detail = assetDetails[kind] ?? getDefaultLearningAssetDetail(kind)
    void handleGenerateAssets({
      goal: buildLearningAssetGoal(kind, detail),
      outputs: [kind],
      autoUpdateProfile: profileOptions.autoUpdateProfile,
      useProfileSource: profileOptions.useProfileSource,
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

          <CardContent className="flex-1 overflow-y-auto min-h-0 space-y-4">
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
                      'flex min-h-16 items-center gap-2 rounded-lg border p-3',
                      STUDIO_ASSET_STYLES[option.kind]
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => handleQuickGenerateAsset(option.kind)}
                      disabled={isGeneratingStudioAsset}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
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
                          void handleGeneratePodcast()
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

            <div className="space-y-3">
              {isAssetListLoading ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : (!notes || notes.length === 0) && notebookPodcastEpisodes.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="Studio output will be saved here."
                  description="添加来源后，点击上方按钮生成讲解文档、Quiz、知识闪卡等资产。"
                />
              ) : (
                <>
                  {notebookPodcastEpisodes.map((episode) => (
                    <NotebookPodcastAssetCard key={episode.id} episode={episode} />
                  ))}
                  {notes?.map((note) => {
                  const asset = parseLearningAssetNote(note.content)
                  const visibleContent = getVisibleLearningAssetContent(note.content)
                  const assetKind = asset?.kind ?? inferLearningAssetKind(note.content, note.title)
                  const assetKindLabel =
                    assetKind ? getLearningAssetKindLabel(assetKind, t) : asset?.type || null
                  return (
                    <div
                      key={note.id}
                      className="p-3 border rounded-lg card-hover group relative cursor-pointer"
                      onClick={() => setEditingNote(note)}
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
      />

      <NoteEditorDialog
        open={showAddDialog || Boolean(editingNote)}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false)
            setEditingNote(null)
          } else {
            setShowAddDialog(true)
          }
        }}
        notebookId={notebookId}
        note={editingNote ?? undefined}
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
