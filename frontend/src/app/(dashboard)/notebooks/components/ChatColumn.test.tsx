import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatColumn, resolveToolCallProgress } from './ChatColumn'
import { useNotes } from '@/lib/hooks/use-notes'
import { useNotebookChat } from '@/lib/hooks/useNotebookChat'

// Mock the hooks
vi.mock('@/lib/hooks/use-notes')
vi.mock('@/lib/hooks/useNotebookChat')
vi.mock('@/lib/hooks/use-models', () => ({
  useModelDefaults: () => ({ data: undefined }),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueries: () => [],
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  }
})
vi.mock('@/components/source/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />
}))

// Type-safe mock factory for useNotes hook
function createNotesMock(overrides: { isLoading?: boolean } = {}) {
  return {
    data: [],
    isLoading: overrides.isLoading ?? false,
  } as unknown as ReturnType<typeof useNotes>
}

// Type-safe mock factory for useNotebookChat hook
function createChatMock() {
  return {
    messages: [],
    isSending: false,
    tokenCount: 0,
    charCount: 0,
    sessions: [],
    currentSessionId: null,
  } as unknown as ReturnType<typeof useNotebookChat>
}

describe('ChatColumn', () => {
  const baseProps = {
    notebookId: 'test-notebook',
    contextSelections: {
      sources: {},
      notes: {}
    },
    sources: [],
  }

  it('shows loading spinner when fetching data', () => {
    vi.mocked(useNotes).mockReturnValue(createNotesMock({ isLoading: true }))
    vi.mocked(useNotebookChat).mockReturnValue(createChatMock())

    render(<ChatColumn {...baseProps} sourcesLoading={true} />)

    // Should show loading spinner
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('renders chat panel when data is loaded', () => {
    vi.mocked(useNotes).mockReturnValue(createNotesMock({ isLoading: false }))
    vi.mocked(useNotebookChat).mockReturnValue(createChatMock())

    render(<ChatColumn {...baseProps} sourcesLoading={false} />)

    // Should show chat panel
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
  })

  it('does not invent a percentage before tool progress is reported', () => {
    expect(resolveToolCallProgress('new', undefined)).toEqual({
      percent: null,
      label: '等待开始',
    })
    expect(resolveToolCallProgress('running', undefined)).toEqual({
      percent: null,
      label: '进行中',
    })
    expect(resolveToolCallProgress('running', 42.4)).toEqual({
      percent: 42.4,
      label: '42%',
    })
    expect(resolveToolCallProgress('completed', undefined)).toEqual({
      percent: 100,
      label: '100%',
    })
    expect(resolveToolCallProgress('failed', undefined)).toEqual({
      percent: null,
      label: '失败',
    })
    expect(resolveToolCallProgress('canceled', undefined)).toEqual({
      percent: null,
      label: '已取消',
    })
  })
})
