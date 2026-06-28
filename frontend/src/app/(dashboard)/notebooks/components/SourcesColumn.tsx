'use client'

import { useState, useMemo, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SourceListResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, FileText, Link2, ChevronDown, Loader2, ListChecks, Search, CheckCircle2 } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { AddExistingSourceDialog } from '@/components/sources/AddExistingSourceDialog'
import { SourceCard } from '@/components/sources/SourceCard'
import { useCreateSource, useDeleteSource, useRetrySource, useRemoveSourceFromNotebook } from '@/lib/hooks/use-sources'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { ContextMode } from '../[id]/page'
import type { SourceBulkAction } from '@/lib/utils/source-context'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { commandsApi } from '@/lib/api/commands'
import { learningApi } from '@/lib/api/learning'
import { embeddingApi } from '@/lib/api/embedding'
import type { LearningCollectedResource } from '@/lib/types/learning'
import { toast } from 'sonner'

const LEARNING_PROFILE_TOPIC = 'learning_profile'
const LEARNING_PROFILE_TITLE = '学习画像'

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

function isLearningProfileSource(source: SourceListResponse) {
  return source.title === LEARNING_PROFILE_TITLE || source.topics?.includes(LEARNING_PROFILE_TOPIC)
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
  const [collectedResources, setCollectedResources] = useState<LearningCollectedResource[]>([])
  const [acceptedResourceUrls, setAcceptedResourceUrls] = useState<Record<string, boolean>>({})
  const [acceptingResourceIds, setAcceptingResourceIds] = useState<Record<string, boolean>>({})
  const [embeddingSourceIds, setEmbeddingSourceIds] = useState<Record<string, boolean>>({})
  const [isCollectingResources, setIsCollectingResources] = useState(false)
  const [resourceSearchJobId, setResourceSearchJobId] = useState<string | null>(null)
  const [handledResourceSearchJobId, setHandledResourceSearchJobId] = useState<string | null>(null)

  const { openModal } = useModalManager()
  const createSource = useCreateSource()
  const deleteSource = useDeleteSource()
  const retrySource = useRetrySource()
  const removeFromNotebook = useRemoveSourceFromNotebook()
  const { data: resourceSearchJob } = useQuery({
    queryKey: ['commands', 'job', resourceSearchJobId],
    queryFn: () => commandsApi.getJob(resourceSearchJobId as string),
    enabled: Boolean(resourceSearchJobId),
    refetchInterval: resourceSearchJobId ? 1500 : false,
  })

  // Collapsible column state
  const { sourcesCollapsed, toggleSources } = useNotebookColumnsStore()
  const sourcesTitle = t('navigation.sources')
  const collapseButton = useMemo(
    () => createCollapseButton(toggleSources, sourcesTitle),
    [toggleSources, sourcesTitle]
  )

  // Scroll container ref for infinite scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const ensuringProfileRef = useRef<string | null>(null)
  const initialResourceSearchHandledRef = useRef<string | null>(null)
  const hasProfileSource = useMemo(
    () => Boolean(sources?.some(isLearningProfileSource)),
    [sources]
  )

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
      setHandledResourceSearchJobId(resourceSearchJobId)
      setResourceSearchJobId(null)
      setIsCollectingResources(false)
      toast.error(
        resourceSearchJob.status === 'canceled'
          ? '\u8d44\u6599\u641c\u96c6\u4efb\u52a1\u5df2\u53d6\u6d88'
          : resourceSearchJob.error_message || '\u641c\u96c6\u8d44\u6599\u5931\u8d25'
      )
    }
  }, [handledResourceSearchJobId, resourceSearchJob, resourceSearchJobId])

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
        goal: normalizedGoal,
        learning_history: (sources ?? []).map((source) => source.title || source.asset?.url || source.id),
        requested_outputs: [],
        learning_record_id: notebookId,
      })

      setCollectedResources([])
      setHandledResourceSearchJobId(null)
      setResourceSearchJobId(response.job_id)
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
  }, [notebookId, notebookName, resourceSearchGoal, sources])

  useEffect(() => {
    const normalizedInitialGoal = initialResourceSearchGoal.trim()
    if (!normalizedInitialGoal) {
      return
    }

    setResourceSearchGoal(normalizedInitialGoal)
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

  const handleEmbedSource = async (sourceId: string) => {
    setEmbeddingSourceIds((previous) => ({
      ...previous,
      [sourceId]: true,
    }))
    try {
      const response = await embeddingApi.embedContent(sourceId, 'source', true)
      toast.success(response.message || '已开始创建嵌入')
      onRefresh?.()
    } catch (error) {
      console.error('Failed to embed source:', error)
      toast.error('创建嵌入失败')
    } finally {
      setEmbeddingSourceIds((previous) => ({
        ...previous,
        [sourceId]: false,
      }))
    }
  }

  const handleSourceClick = (sourceId: string) => {
    openModal('source', sourceId)
  }

  return (
    <>
      <CollapsibleColumn
        isCollapsed={sourcesCollapsed}
        onToggle={toggleSources}
        collapsedIcon={FileText}
        collapsedLabel={t('navigation.sources')}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">{t('navigation.sources')}</CardTitle>
              <div className="flex items-center gap-2">
                {onBulkContextModeChange && sources && sources.length > 0 && (
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
                <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      {t('sources.addSource')}
                      <ChevronDown className="h-4 w-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
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
                {collapseButton}
              </div>
            </div>
          </CardHeader>

          <CardContent ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 space-y-4">
            <section className="rounded-lg border bg-muted/30 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Search className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium">按目标搜集资料</h3>
                </div>
                <BadgeText>{collectedResources.length ? `${collectedResources.length} 条结果` : 'Web Search'}</BadgeText>
              </div>
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
                <div className="mt-3 space-y-2">
                  {collectedResources.map((resource) => {
                    const accepted = Boolean(resource.url && acceptedResourceUrls[resource.url])
                    const isAccepting = Boolean(acceptingResourceIds[resource.id])
                    return (
                      <div key={resource.id} className="rounded-md border bg-background p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-medium">{resource.title}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
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
                            </div>
                            {resource.url && (
                              <p className="mt-1 break-all text-xs text-muted-foreground">
                                {resource.url}
                              </p>
                            )}
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
                    )
                  })}
                </div>
              )}
            </section>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : !sources || sources.length === 0 ? (
              <EmptyState
                icon={FileText}
                title={t('sources.noSourcesYet')}
                description={t('sources.createFirstSource')}
              />
            ) : (
              <div className="space-y-3">
                {sources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onClick={handleSourceClick}
                    onDelete={handleDeleteClick}
                    onRetry={handleRetry}
                    onRefreshContent={handleRetry}
                    onEmbed={handleEmbedSource}
                    isEmbedding={Boolean(embeddingSourceIds[source.id])}
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
