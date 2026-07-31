import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type NotebookDesktopLayoutProps = {
  chat: ReactNode
  sources: ReactNode
  notes: ReactNode
  sourcesCollapsed: boolean
  notesCollapsed: boolean
  className?: string
}

const FLEXIBLE_COLUMN_STYLE = {
  flexBasis: 0,
  flexShrink: 1,
}

function flexibleColumnStyle(weight: number) {
  return {
    ...FLEXIBLE_COLUMN_STYLE,
    flexGrow: weight,
  }
}

export function NotebookDesktopLayout({
  chat,
  sources,
  notes,
  sourcesCollapsed,
  notesCollapsed,
  className,
}: NotebookDesktopLayoutProps) {
  return (
    <div
      className={cn(
        'hidden min-h-0 min-w-0 flex-1 gap-3 overflow-hidden xl:flex 2xl:gap-4',
        className
      )}
      data-testid="notebook-desktop-layout"
    >
      <div
        className="flex min-h-0 min-w-0 overflow-hidden transition-[flex-grow,width] duration-150"
        style={flexibleColumnStyle(24)}
        data-testid="notebook-chat-column"
      >
        {chat}
      </div>

      <div
        className={cn(
          'flex min-h-0 overflow-hidden transition-[flex-grow,width] duration-150',
          sourcesCollapsed ? 'w-12 shrink-0 grow-0' : 'min-w-0'
        )}
        style={sourcesCollapsed ? undefined : flexibleColumnStyle(50)}
        data-collapsed={sourcesCollapsed}
        data-testid="notebook-sources-column"
      >
        {sources}
      </div>

      <div
        className={cn(
          'flex min-h-0 overflow-hidden transition-[flex-grow,width] duration-150',
          notesCollapsed ? 'w-12 shrink-0 grow-0' : 'min-w-0'
        )}
        style={notesCollapsed ? undefined : flexibleColumnStyle(26)}
        data-collapsed={notesCollapsed}
        data-testid="notebook-notes-column"
      >
        {notes}
      </div>
    </div>
  )
}
