'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Clipboard,
  Globe2,
  Link2,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { CreateNotebookDialog } from '@/components/notebooks/CreateNotebookDialog'
import { NotebookDeleteDialog } from './components/NotebookDeleteDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useNotebooks, useUpdateNotebook } from '@/lib/hooks/use-notebooks'
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

export default function NotebooksPage() {
  const router = useRouter()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [sourcePromptOpen, setSourcePromptOpen] = useState(false)
  const [addSourceDialogOpen, setAddSourceDialogOpen] = useState(false)
  const [createdNotebook, setCreatedNotebook] = useState<NotebookResponse | null>(null)
  const [sourceSearchQuery, setSourceSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const { data: notebooks, isLoading } = useNotebooks(showArchived)

  const sortedNotebooks = useMemo(
    () => [...(notebooks ?? [])].sort((a, b) => {
      return new Date(b.updated).getTime() - new Date(a.updated).getTime()
    }),
    [notebooks]
  )

  const createdNotebookUrl = createdNotebook
    ? `/notebooks/${encodeURIComponent(createdNotebook.id)}`
    : '/notebooks'

  const handleCreatedNotebook = (notebook: NotebookResponse) => {
    setCreatedNotebook(notebook)
    setSourceSearchQuery('')
    setSourcePromptOpen(true)
  }

  const openCreatedNotebook = (sourceSearch?: string) => {
    if (!createdNotebook) return
    const query = sourceSearch?.trim()
    const suffix = query ? `?sourceSearch=${encodeURIComponent(query)}` : ''
    setSourcePromptOpen(false)
    router.push(`${createdNotebookUrl}${suffix}`)
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1680px] px-6 py-8 lg:px-10">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">
                {showArchived ? '已归档学习记录' : '当前学习记录'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {showArchived
                  ? '这些记录已从当前列表隐藏，但内容没有删除，可以随时恢复。'
                  : '移到已归档会从当前列表隐藏学习记录，不会删除来源、资产或播客。'}
              </p>
            </div>
            <div className="flex gap-2">
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
          ) : sortedNotebooks.length === 0 ? (
            <div className="rounded-xl border bg-card px-6 py-12 text-center">
              <p className="text-lg font-medium">
                {showArchived ? '暂无已归档学习记录' : '暂无当前学习记录'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {showArchived
                  ? '当学习记录被移到已归档后，会显示在这里。'
                  : '新建一个学习记录，或添加来源开始学习。'}
              </p>
              {!showArchived && (
                <Button
                  type="button"
                  className="mt-5"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  新建学习记录
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {!showArchived && <CreateNotebookTile onClick={() => setCreateDialogOpen(true)} />}
              {sortedNotebooks.map((notebook, index) => (
                <NotebookTile
                  key={notebook.id}
                  notebook={notebook}
                  index={index}
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

      <Dialog open={sourcePromptOpen} onOpenChange={setSourcePromptOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader className="text-center">
            <DialogTitle className="text-2xl font-semibold">
              为学习记录添加来源
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="rounded-xl border border-primary/60 p-3">
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Globe2 className="h-5 w-5 text-muted-foreground" />
                  <Input
                    value={sourceSearchQuery}
                    onChange={(event) => setSourceSearchQuery(event.target.value)}
                    placeholder="搜索网页资料作为新来源"
                    className="border-0 px-0 shadow-none focus-visible:ring-0"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && sourceSearchQuery.trim()) {
                        openCreatedNotebook(sourceSearchQuery)
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="rounded-full"
                  disabled={!sourceSearchQuery.trim()}
                  onClick={() => openCreatedNotebook(sourceSearchQuery)}
                  aria-label="搜索来源"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-dashed p-8">
              <div className="text-center">
                <p className="text-lg font-medium">也可以先手动添加来源</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  这一步不是必须的，可以关闭窗口之后再添加。
                </p>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-full"
                  onClick={() => {
                    setSourcePromptOpen(false)
                    setAddSourceDialogOpen(true)
                  }}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  上传文件
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-full"
                  onClick={() => {
                    setSourcePromptOpen(false)
                    setAddSourceDialogOpen(true)
                  }}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  网站链接
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-full"
                  onClick={() => {
                    setSourcePromptOpen(false)
                    setAddSourceDialogOpen(true)
                  }}
                >
                  <Clipboard className="mr-2 h-4 w-4" />
                  粘贴文本
                </Button>
                <Button
                  type="button"
                  className="h-12 rounded-full"
                  onClick={() => openCreatedNotebook()}
                >
                  进入记录
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AddSourceDialog
        open={addSourceDialogOpen}
        onOpenChange={setAddSourceDialogOpen}
        defaultNotebookId={createdNotebook?.id}
      />
    </AppShell>
  )
}
