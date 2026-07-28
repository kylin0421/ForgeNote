'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useNotebookChat } from '@/lib/hooks/useNotebookChat'
import { useNotes } from '@/lib/hooks/use-notes'
import { useModelDefaults } from '@/lib/hooks/use-models'
import { ChatPanel } from '@/components/source/ChatPanel'
import { getVisibleLearningAssetContent } from '@/components/learning/LearningAssetPreview'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCircle, CheckCircle2, Hammer, Loader2, XCircle } from 'lucide-react'
import { ContextSelections } from '../[id]/page'
import { useTranslation } from '@/lib/hooks/use-translation'
import { SourceListResponse } from '@/lib/types/api'
import type { LearningOutputKind } from '@/lib/types/learning'
import { commandsApi } from '@/lib/api/commands'
import { learningApi } from '@/lib/api/learning'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { getGenerationLanguageFromLocale } from '@/lib/utils/language'
import { toast } from 'sonner'

const LEARNING_PROFILE_TOPIC = 'learning_profile'
const ACTIVE_JOB_STATUSES = new Set(['new', 'queued', 'running'])

type AssetToolCallJob = {
  jobId: string
  outputKind: LearningOutputKind
  label: string
  reason: string
}

type AssetToolProgress = {
  percent?: number
  current_agent_name?: string | null
  current_task?: string
}

function isLearningProfileSource(source: SourceListResponse) {
  return source.title === '学习画像' || source.topics?.includes(LEARNING_PROFILE_TOPIC)
}

interface ChatColumnProps {
  notebookId: string
  contextSelections: ContextSelections
  sources: SourceListResponse[]
  sourcesLoading: boolean
  notebookName?: string
  autoUpdateProfile?: boolean
  useProfileSource?: boolean
}

export function ChatColumn({
  notebookId,
  contextSelections,
  sources,
  sourcesLoading,
  notebookName,
  autoUpdateProfile = true,
  useProfileSource = true,
}: ChatColumnProps) {
  const { t, language } = useTranslation()
  const queryClient = useQueryClient()
  const { data: modelDefaults } = useModelDefaults()
  const [assetToolJobs, setAssetToolJobs] = useState<AssetToolCallJob[]>([])
  const [handledToolJobIds, setHandledToolJobIds] = useState<string[]>([])

  // Fetch notes for this notebook
  const { data: notes = [], isLoading: notesLoading } = useNotes(notebookId)
  const assetToolJobStatuses = useQueries({
    queries: assetToolJobs.map((job) => ({
      queryKey: ['commands', 'job', job.jobId],
      queryFn: () => commandsApi.getJob(job.jobId),
      enabled: !handledToolJobIds.includes(job.jobId),
      refetchInterval: 1500,
    })),
  })

  // Initialize notebook chat hook
  const chat = useNotebookChat({
    notebookId,
    sources,
    notes,
    contextSelections,
    autoUpdateProfile,
    useProfileSource,
  })

  // Calculate context stats for indicator
  const contextStats = useMemo(() => {
    let sourcesInsights = 0
    let sourcesFull = 0
    let notesCount = 0

    // Count sources by mode
    sources.forEach(source => {
      const mode = contextSelections.sources[source.id]
      if (mode === 'insights') {
        sourcesInsights++
      } else if (mode === 'full') {
        sourcesFull++
      }
    })

    // Count notes that are included (not 'off')
    notes.forEach(note => {
      const mode = contextSelections.notes[note.id]
      if (mode === 'full') {
        notesCount++
      }
    })

    return {
      sourcesInsights,
      sourcesFull,
      notesCount,
      tokenCount: chat.tokenCount,
      charCount: chat.charCount
    }
  }, [sources, notes, contextSelections, chat.tokenCount, chat.charCount])

  useEffect(() => {
    if (assetToolJobs.length === 0) return

    const nextHandled = new Set(handledToolJobIds)
    let changed = false
    let terminalCount = 0
    let completedCount = 0

    for (const [index, query] of assetToolJobStatuses.entries()) {
      const tracker = assetToolJobs[index]
      const status = query.data?.status
      if (!tracker || !status || ACTIVE_JOB_STATUSES.has(status)) {
        continue
      }

      terminalCount += 1
      if (nextHandled.has(tracker.jobId)) {
        continue
      }
      changed = true
      nextHandled.add(tracker.jobId)
      if (status === 'completed') {
        completedCount += 1
      } else if (status === 'failed') {
        toast.error(query.data?.error_message || `${tracker.label}生成失败`)
      } else if (status === 'canceled') {
        toast.error(`${tracker.label}生成已取消`)
      }
    }

    if (changed) {
      setHandledToolJobIds(Array.from(nextHandled))
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(notebookId) })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sourcesInfinite(notebookId) })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sources(notebookId) })
      void queryClient.invalidateQueries({
        queryKey: ['learning', 'profile-source', notebookId],
      })
      if (completedCount > 0) {
        toast.success(
          completedCount === 1
            ? '对话调用的学习资产已生成'
            : `对话调用的 ${completedCount} 个学习资产已生成`
        )
      }
    }

    if (terminalCount === assetToolJobs.length && terminalCount > 0) {
      const clearTimer = window.setTimeout(() => {
        setAssetToolJobs([])
        setHandledToolJobIds([])
      }, 8000)
      return () => window.clearTimeout(clearTimer)
    }
  }, [
    assetToolJobStatuses,
    assetToolJobs,
    handledToolJobIds,
    notebookId,
    queryClient,
  ])

  const triggerAssetToolCall = async (message: string) => {
    const contentSources = sources.filter((source) => !isLearningProfileSource(source))
    const selectedSourceIds = contentSources
      .filter((source) => contextSelections.sources[source.id] !== 'off')
      .map((source) => source.id)
    const profileSourceIds = useProfileSource
      ? sources.filter(isLearningProfileSource).map((source) => source.id)
      : []
    const includedNotes = notes
      .filter((note) => contextSelections.notes[note.id] !== 'off')
      .filter((note) => Boolean(note.content?.trim()))
      .slice(0, 8)
    const supplementalMaterials = includedNotes.map((note) => ({
      id: `chat-note:${note.id}`,
      title: note.title || '学习笔记',
      material_type: note.note_type === 'ai' ? 'learning_asset' : 'note',
      content: getVisibleLearningAssetContent(note.content).slice(0, 6000),
    }))

    try {
      const response = await learningApi.submitToolCallJobs({
        message,
        mode: 'chat',
        course: notebookName || '当前学习记录',
        goal: message,
        learning_history: [
          ...contentSources.map((source) => `已选来源：${source.title || source.id}`),
          ...includedNotes.map((note) => `已选学习资产：${note.title || note.id}`),
        ],
        accepted_resource_ids: [...selectedSourceIds, ...profileSourceIds],
        supplemental_materials: supplementalMaterials,
        learning_record_id: notebookId,
        target_language: getGenerationLanguageFromLocale(language),
        image_model: modelDefaults?.default_image_model || undefined,
        auto_update_profile: autoUpdateProfile,
        use_profile_source: useProfileSource,
      })

      if (!response.recognized || response.jobs.length === 0) {
        return
      }

      setAssetToolJobs((previous) => [
        ...previous,
        ...response.jobs.map((job) => ({
          jobId: job.job_id,
          outputKind: job.output_kind,
          label: job.label,
          reason: job.reason,
        })),
      ])
      toast.success(response.message)
    } catch (error) {
      console.debug('Unable to route chat message to a learning asset tool:', error)
    }
  }

  const runningToolJobIndex = assetToolJobs.findIndex((_, index) => {
    const status = assetToolJobStatuses[index]?.data?.status
    return !status || ACTIVE_JOB_STATUSES.has(status)
  })
  const visibleToolJobIndex = runningToolJobIndex >= 0 ? runningToolJobIndex : 0
  const activeToolJob = assetToolJobs[visibleToolJobIndex]
  const activeToolStatus = assetToolJobStatuses[visibleToolJobIndex]?.data?.status
  const activeToolProgress = assetToolJobStatuses[visibleToolJobIndex]?.data?.progress as
    | AssetToolProgress
    | undefined
  const activeToolPercent =
    activeToolStatus === 'completed'
      ? 100
      : activeToolProgress?.percent ?? (activeToolStatus === 'running' ? 35 : 8)
  const toolCallActivity = activeToolJob ? (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5 text-xs">
      <div className="flex items-start gap-2">
        {activeToolStatus === 'completed' ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        ) : activeToolStatus === 'failed' || activeToolStatus === 'canceled' ? (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : activeToolStatus === 'running' ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : (
          <Hammer className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">工具调用 · {activeToolJob.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(activeToolPercent)}%
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-muted-foreground">
            {activeToolProgress?.current_task || activeToolJob.reason}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.max(4, Math.min(activeToolPercent, 100))}%` }}
            />
          </div>
          {assetToolJobs.length > 1 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              本次共调用 {assetToolJobs.length} 个学习资产工具
            </p>
          )}
        </div>
      </div>
    </div>
  ) : null

  // Show loading state while sources/notes are being fetched
  if (sourcesLoading || notesLoading) {
    return (
      <Card className="h-full flex flex-col">
        <CardContent className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </CardContent>
      </Card>
    )
  }

  // Show error state if data fetch failed (unlikely but good to handle)
  if (!sources && !notes) {
    return (
      <Card className="h-full flex flex-col">
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm">{t('chat.unableToLoadChat')}</p>
            <p className="text-xs mt-2">{t('common.refreshPage') || 'Please try refreshing the page'}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <ChatPanel
      title={t('chat.chatWithNotebook')}
      contextType="notebook"
      messages={chat.messages}
      isStreaming={chat.isSending}
      contextIndicators={null}
      modelOverride={chat.currentSession?.model_override ?? chat.pendingModelOverride ?? undefined}
      onModelChange={(model) => chat.setModelOverride(model ?? null)}
      sessions={chat.sessions}
      currentSessionId={chat.currentSessionId}
      onCreateSession={(title) => chat.createSession(title)}
      onSelectSession={chat.switchSession}
      onUpdateSession={(sessionId, title) => chat.updateSession(sessionId, { title })}
      onDeleteSession={chat.deleteSession}
      loadingSessions={chat.loadingSessions}
      notebookContextStats={contextStats}
      notebookId={notebookId}
      composerActivity={toolCallActivity}
      onSendMessage={(message, modelOverride) => {
        chat.sendMessage(message, modelOverride)
        void triggerAssetToolCall(message)
      }}
    />
  )
}
