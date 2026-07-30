'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { ProfileOnboardingDialog } from '@/components/learning/ProfileOnboardingDialog'
import { CreateNotebookDialog } from '@/components/notebooks/CreateNotebookDialog'
import { NotebookDeleteDialog } from './components/NotebookDeleteDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useNotebooks, useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { QUERY_KEYS } from '@/lib/api/query-client'
import type { NotebookResponse } from '@/lib/types/api'
import { cn } from '@/lib/utils'

const CARD_STYLES = [
  'bg-blue-50 border-blue-100',
  'bg-emerald-50 border-emerald-100',
  'bg-rose-50 border-rose-100',
  'bg-violet-50 border-violet-100',
  'bg-amber-50 border-amber-100',
  'bg-cyan-50 border-cyan-100',
]

// Keep structural spacing with the page markup. In development, a route can
// receive fresh JSX before its generated utility stylesheet refreshes; these
// inline fallbacks prevent that transient state from collapsing the layout.
const NOTEBOOK_PAGE_STYLES = {
  scroll: {
    minWidth: 0,
    minHeight: 0,
    overflowX: 'hidden',
    overflowY: 'auto',
  },
  content: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 1680,
    marginInline: 'auto',
    paddingBlock: '2rem',
    paddingInline: 'clamp(1.5rem, 4vw, 2.5rem)',
  },
  header: {
    gap: '0.75rem',
    marginBottom: '1.5rem',
  },
  description: {
    marginTop: '0.25rem',
  },
  toggleGroup: {
    gap: '0.5rem',
  },
  emptyState: {
    padding: '3rem 1.5rem',
  },
  emptyDescription: {
    marginTop: '0.5rem',
  },
  emptyAction: {
    marginTop: '1.25rem',
  },
  emptyActionIcon: {
    marginRight: '0.5rem',
  },
} satisfies Record<string, CSSProperties>

function NotebookTile({
  notebook,
  index,
}: {
  notebook: NotebookResponse
  index: number
}) {
  const router = useRouter()
  const updateNotebook = useUpdateNotebook()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const style = CARD_STYLES[index % CARD_STYLES.length]

  const navigateToNotebook = () => {
    router.push(`/notebooks/${encodeURIComponent(notebook.id)}`)
  }

  const toggleArchive = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived },
    })
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={navigateToNotebook}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            navigateToNotebook()
          }
        }}
        className={cn(
          'group relative flex aspect-[1.26] min-h-56 cursor-pointer flex-col rounded-xl border p-7 text-slate-950 transition-colors hover:border-primary/50',
          style
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white/70 text-primary shadow-sm">
            <BookOpen className="h-7 w-7" />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-slate-700 opacity-80 hover:bg-white/60 hover:text-slate-950"
                onClick={(event) => event.stopPropagation()}
                aria-label="学习记录操作"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onSelect={toggleArchive} className="gap-2">
                {notebook.archived ? (
                  <>
                    <ArchiveRestore className="h-4 w-4" />
                    恢复到列表
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4" />
                    移到已归档
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  setShowDeleteDialog(true)
                }}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-auto space-y-4">
          <h2 className="line-clamp-2 text-2xl font-semibold leading-tight tracking-normal text-slate-950">
            {notebook.name}
          </h2>
          <p className="text-sm font-medium text-slate-700">
            {format(new Date(notebook.updated), 'd MMM yyyy')} · {notebook.source_count} 个来源
          </p>
        </div>
      </div>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
      />
    </>
  )
}

function CreateNotebookTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex aspect-[1.26] min-h-56 flex-col items-center justify-center rounded-xl border bg-card p-7 text-center text-card-foreground transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Plus className="h-8 w-8" />
      </span>
      <span className="mt-6 text-2xl font-semibold text-foreground">
        新建学习记录
      </span>
    </button>
  )
}

function DemoNotebookTile() {
  const router = useRouter()
  const openDemo = () => router.push('/notebooks/ai-learning-demo')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openDemo}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openDemo()
        }
      }}
      className={cn(
        'group relative flex aspect-[1.26] min-h-56 cursor-pointer flex-col rounded-xl border p-7 text-slate-950 transition-colors hover:border-primary/50',
        CARD_STYLES[0]
      )}
      aria-label="打开学习记录 ai学习"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white/70 text-primary shadow-sm">
          <BookOpen className="h-7 w-7" />
        </div>

        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-700 opacity-80"
          aria-hidden="true"
        >
          <MoreVertical className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-auto space-y-4">
        <h2 className="line-clamp-2 text-2xl font-semibold leading-tight tracking-normal text-slate-950">
          ai学习
        </h2>
        <p className="text-sm font-medium text-slate-700">
          {format(new Date(), 'd MMM yyyy')} · 0 个来源
        </p>
      </div>
    </div>
  )
}

export default function NotebooksPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [profileOnboardingOpen, setProfileOnboardingOpen] = useState(false)
  const [createdNotebook, setCreatedNotebook] = useState<NotebookResponse | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const { data: notebooks, isLoading } = useNotebooks(showArchived)

  const sortedNotebooks = useMemo(
    () => [...(notebooks ?? [])].sort((a, b) => {
      return new Date(b.updated).getTime() - new Date(a.updated).getTime()
    }),
    [notebooks]
  )

  const handleCreatedNotebook = (notebook: NotebookResponse) => {
    const notebookPath = `/notebooks/${encodeURIComponent(notebook.id)}`
    queryClient.setQueryData(QUERY_KEYS.notebook(notebook.id), notebook)
    router.prefetch(notebookPath)
    setCreatedNotebook(notebook)
    setProfileOnboardingOpen(true)
  }

  const finishProfileOnboarding = (sourceSearch: string) => {
    if (!createdNotebook) return
    const query = sourceSearch.trim()
    const destination =
      `/notebooks/${encodeURIComponent(createdNotebook.id)}` +
      `?profileReady=1&sourceSearch=${encodeURIComponent(query)}`
    setProfileOnboardingOpen(false)
    setCreatedNotebook(null)
    router.replace(destination)
  }

  return (
    <AppShell>
      <div
        className="notebooks-page-scroll flex-1"
        style={NOTEBOOK_PAGE_STYLES.scroll}
      >
        <div
          className="notebooks-page-content"
          style={NOTEBOOK_PAGE_STYLES.content}
        >
          <div
            className="notebooks-page-header flex flex-col sm:flex-row sm:items-end sm:justify-between"
            style={NOTEBOOK_PAGE_STYLES.header}
          >
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">
                {showArchived ? '已归档学习记录' : '当前学习记录'}
              </h1>
              <p
                className="notebooks-page-description text-sm text-muted-foreground"
                style={NOTEBOOK_PAGE_STYLES.description}
              >
                {showArchived
                  ? '这些记录已从当前列表隐藏，但内容没有删除，可以随时恢复。'
                  : '移到已归档会从当前列表隐藏学习记录，不会删除来源、资产或播客。'}
              </p>
            </div>
            <div
              className="notebooks-page-toggle-group flex"
              style={NOTEBOOK_PAGE_STYLES.toggleGroup}
            >
              <Button
                type="button"
                variant={showArchived ? 'outline' : 'default'}
                onClick={() => setShowArchived(false)}
              >
                当前
              </Button>
              <Button
                type="button"
                variant={showArchived ? 'default' : 'outline'}
                onClick={() => setShowArchived(true)}
              >
                已归档
              </Button>
            </div>
          </div>
          {isLoading ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <LoadingSpinner size="lg" />
            </div>
          ) : showArchived && sortedNotebooks.length === 0 ? (
            <div
              className="notebooks-empty-state rounded-xl border bg-card text-center"
              style={NOTEBOOK_PAGE_STYLES.emptyState}
            >
              <p className="text-lg font-medium">
                {showArchived ? '暂无已归档学习记录' : '暂无当前学习记录'}
              </p>
              <p
                className="notebooks-empty-description text-sm text-muted-foreground"
                style={NOTEBOOK_PAGE_STYLES.emptyDescription}
              >
                {showArchived
                  ? '当学习记录被移到已归档后，会显示在这里。'
                  : '新建一个学习记录，或添加来源开始学习。'}
              </p>
              {!showArchived && (
                <Button
                  type="button"
                  className="notebooks-empty-action"
                  style={NOTEBOOK_PAGE_STYLES.emptyAction}
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus
                    className="notebooks-empty-action-icon h-4 w-4"
                    style={NOTEBOOK_PAGE_STYLES.emptyActionIcon}
                  />
                  新建学习记录
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {!showArchived && <CreateNotebookTile onClick={() => setCreateDialogOpen(true)} />}
              {!showArchived && <DemoNotebookTile />}
              {sortedNotebooks.map((notebook, index) => (
                <NotebookTile
                  key={notebook.id}
                  notebook={notebook}
                  index={index + (!showArchived ? 1 : 0)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateNotebookDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleCreatedNotebook}
      />

      <ProfileOnboardingDialog
        open={profileOnboardingOpen}
        notebook={createdNotebook}
        onCompleted={finishProfileOnboarding}
      />
    </AppShell>
  )
}
