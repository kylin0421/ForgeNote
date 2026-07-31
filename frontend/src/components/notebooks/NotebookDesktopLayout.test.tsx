import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NotebookDesktopLayout } from './NotebookDesktopLayout'

describe('NotebookDesktopLayout', () => {
  it('keeps every expanded column inside the fixed canvas', () => {
    render(
      <NotebookDesktopLayout
        chat={<div>Chat</div>}
        sources={<div>Sources</div>}
        notes={<div>Studio</div>}
        sourcesCollapsed={false}
        notesCollapsed={false}
      />
    )

    expect(screen.getByTestId('notebook-desktop-layout')).toHaveClass(
      'min-w-0',
      'overflow-hidden'
    )
    expect(screen.getByTestId('notebook-chat-column')).toHaveClass(
      'min-w-0',
      'overflow-hidden'
    )
    expect(screen.getByTestId('notebook-sources-column')).toHaveClass(
      'min-w-0',
      'overflow-hidden'
    )
    expect(screen.getByTestId('notebook-notes-column')).toHaveClass(
      'min-w-0',
      'overflow-hidden'
    )
    expect(screen.getByTestId('notebook-chat-column')).toHaveStyle({ flexGrow: 24 })
    expect(screen.getByTestId('notebook-sources-column')).toHaveStyle({ flexGrow: 50 })
    expect(screen.getByTestId('notebook-notes-column')).toHaveStyle({ flexGrow: 26 })
  })

  it('turns collapsed columns into fixed rails so the remaining columns reclaim the space', () => {
    const { rerender } = render(
      <NotebookDesktopLayout
        chat={<div>Chat</div>}
        sources={<div>Sources</div>}
        notes={<div>Studio</div>}
        sourcesCollapsed
        notesCollapsed={false}
      />
    )

    const sources = screen.getByTestId('notebook-sources-column')
    expect(sources).toHaveAttribute('data-collapsed', 'true')
    expect(sources).toHaveClass('w-12', 'shrink-0', 'grow-0')
    expect(sources).not.toHaveStyle({ flexGrow: 50 })

    rerender(
      <NotebookDesktopLayout
        chat={<div>Chat</div>}
        sources={<div>Sources</div>}
        notes={<div>Studio</div>}
        sourcesCollapsed={false}
        notesCollapsed
      />
    )

    const notes = screen.getByTestId('notebook-notes-column')
    expect(notes).toHaveAttribute('data-collapsed', 'true')
    expect(notes).toHaveClass('w-12', 'shrink-0', 'grow-0')
    expect(notes).not.toHaveStyle({ flexGrow: 26 })
    expect(screen.getByTestId('notebook-sources-column')).toHaveStyle({ flexGrow: 50 })
  })
})
