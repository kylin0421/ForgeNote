import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AI_LEARNING_DEMO,
  AI_LEARNING_DEMO_RESOURCES,
} from '@/lib/demo/ai-learning-demo'
import { AiLearningDemo } from './AiLearningDemo'

const navigation = vi.hoisted(() => ({
  pathname: '/notebooks/ai-learning-demo',
  search: '',
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: navigation.push }),
}))

function pressSpace(repeat = false) {
  fireEvent.keyDown(window, { key: ' ', code: 'Space', repeat })
}

function renderDemo() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AiLearningDemo />
    </QueryClientProvider>
  )
}

describe('AiLearningDemo', () => {
  beforeEach(() => {
    navigation.pathname = '/notebooks/ai-learning-demo'
    navigation.search = ''
    navigation.push.mockReset()
  })

  it('starts from a fresh notebook every time the entry page mounts', () => {
    const first = renderDemo()

    pressSpace()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '1')

    first.unmount()
    renderDemo()

    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '0')
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'notebook')
    expect(screen.getByRole('dialog', { name: 'notebooks.createNew' })).toBeInTheDocument()
    expect(screen.getByDisplayValue(AI_LEARNING_DEMO.notebookName)).toBeInTheDocument()
    expect(screen.queryByTestId('demo-production-chat')).not.toBeInTheDocument()
    expect(screen.queryByText('空格')).not.toBeInTheDocument()
    expect(screen.queryByTestId('demo-step-counter')).not.toBeInTheDocument()
  })

  it('uses the real onboarding surface before entering the empty notebook workspace', async () => {
    renderDemo()

    expect(screen.getByRole('dialog', { name: 'notebooks.createNew' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'notebooks.createNew' }))
    expect(
      await screen.findByRole('dialog', { name: '先认识你，再开始找资料' })
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '学习画像回答输入框' })).toBeInTheDocument()
    expect(screen.getByText('平均置信')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    pressSpace()
    expect(screen.getByText('画像已就绪')).toBeInTheDocument()
    expect(screen.getByText(AI_LEARNING_DEMO.profileAnswer)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存画像并进入学习空间' }))

    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '3')
    expect(screen.getByTestId('demo-production-chat')).toBeInTheDocument()
    expect(screen.getByText('8 维动态学生画像')).toBeInTheDocument()
    expect(screen.getByText('待检索')).toBeInTheDocument()
    expect(screen.getByText('生成内容会保存在这里')).toBeInTheDocument()
    expect(screen.getByText('chat.chatWithNotebook')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chat.sessions' })).toBeInTheDocument()
    expect(screen.getByText('chat.model')).toBeInTheDocument()
  }, 60_000)

  it('returns to the notebook list when the formal creation dialog is canceled', () => {
    renderDemo()

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(navigation.push).toHaveBeenCalledWith('/notebooks')
  })

  it('advances through the cached cross-page scenes and routes', () => {
    renderDemo()

    for (let step = 1; step <= 5; step += 1) pressSpace()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '5')
    expect(screen.getByText(/可以把它想成一次“带着问题查索引”/)).toBeInTheDocument()

    pressSpace()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'search')
    expect(navigation.push).toHaveBeenLastCalledWith('/notebooks/ai-learning-demo?step=6')
    expect(screen.getByDisplayValue(AI_LEARNING_DEMO.searchQuery)).toBeInTheDocument()

    pressSpace()
    expect(screen.getByRole('button', { name: '搜集外部资料' })).toBeDisabled()
    pressSpace()
    expect(
      screen.getByRole('button', { name: '已采纳资料：Attention Is All You Need' })
    ).toBeDisabled()
    expect(screen.getAllByText('4 项')[0]).toBeInTheDocument()

    pressSpace()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'workflow')
    expect(navigation.push).toHaveBeenLastCalledWith('/workflow/ai-learning-demo?step=9')

    pressSpace()
    pressSpace()
    expect(screen.getAllByText('总耗时 13 秒')).not.toHaveLength(0)

    pressSpace()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'studio')
    expect(navigation.push).toHaveBeenLastCalledWith('/notebooks/ai-learning-demo?step=12')
    expect(screen.queryByText('5 / 6 已完成')).not.toBeInTheDocument()

    pressSpace()
    expect(screen.getAllByText(AI_LEARNING_DEMO_RESOURCES.blog.title)).not.toHaveLength(0)

    pressSpace()
    const correctAnswer = screen.getByRole('button', { name: /对应 Value 在输出中的占比提高/ })
    fireEvent.click(correctAnswer)
    expect(screen.getByText('回答正确')).toBeInTheDocument()

    pressSpace()
    expect(screen.getByRole('dialog', { name: '编辑学习画像' })).toBeInTheDocument()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '15')
  }, 60_000)

  it('ignores key repeat and spaces used by editable or interactive controls', () => {
    renderDemo()

    pressSpace(true)
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '0')

    const createInput = screen.getByDisplayValue(AI_LEARNING_DEMO.notebookName)
    fireEvent.keyDown(createInput, { key: ' ', code: 'Space' })

    const createButton = screen.getByRole('button', { name: 'notebooks.createNew' })
    fireEvent.keyDown(createButton, { key: ' ', code: 'Space' })

    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '0')
    expect(navigation.push).not.toHaveBeenCalled()

    pressSpace()
    navigation.push.mockClear()

    const input = screen.getByRole('textbox', { name: '学习画像回答输入框' })
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })

    const button = screen.getByRole('button', { name: '会 Python' })
    fireEvent.keyDown(button, { key: ' ', code: 'Space' })

    const link = document.createElement('a')
    link.href = '#demo'
    document.body.appendChild(link)
    fireEvent.keyDown(link, { key: ' ', code: 'Space' })
    link.remove()

    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    document.body.appendChild(roleButton)
    fireEvent.keyDown(roleButton, { key: ' ', code: 'Space' })
    roleButton.remove()

    const media = document.createElement('video')
    document.body.appendChild(media)
    fireEvent.keyDown(media, { key: ' ', code: 'Space' })
    media.remove()

    const ownedControl = document.createElement('div')
    ownedControl.setAttribute('data-demo-space-owner', 'true')
    document.body.appendChild(ownedControl)
    fireEvent.keyDown(ownedControl, { key: ' ', code: 'Space' })
    ownedControl.remove()

    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '1')
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('uses the first stage for a directly opened cross-page scene', () => {
    navigation.pathname = '/workflow/ai-learning-demo'
    renderDemo()

    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'workflow')
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-step', '9')
  })

  it('uses the production chat composer and local note action with no backend call', async () => {
    navigation.search = 'step=5'
    renderDemo()

    const input = screen.getByRole('textbox', { name: '学习记录输入框' })
    fireEvent.change(input, { target: { value: '再给我一个张量形状例子' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true })

    expect(screen.getByText('再给我一个张量形状例子')).toBeInTheDocument()
    expect(screen.getByTestId('demo-production-chat')).toHaveTextContent(
      '我会继续沿用当前学习画像'
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'common.saveToNote' })[0])
    expect(await screen.findByText('来自对话的笔记')).toBeInTheDocument()
  })

  it('uses the production resource collector and keeps adoption causally consistent', () => {
    navigation.pathname = '/notebooks/ai-learning-demo'
    navigation.search = 'step=8'
    renderDemo()

    expect(
      screen.getByRole('button', { name: '已采纳资料：Attention Is All You Need' })
    ).toBeDisabled()
    expect(screen.getAllByText('4 项')[0]).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Attention Is All You Need' })).toHaveAttribute(
      'href',
      'https://arxiv.org/abs/1706.03762'
    )
  })

  it('returns the scene to the top after advancing', () => {
    renderDemo()

    const demo = screen.getByTestId('ai-learning-demo')
    demo.scrollTop = 480
    pressSpace()

    expect(demo.scrollTop).toBe(0)
  })

  it('uses the formal asset previews and exposes playable cached media', async () => {
    navigation.pathname = '/notebooks/ai-learning-demo'
    navigation.search = 'step=13'
    renderDemo()

    fireEvent.click(screen.getAllByText(AI_LEARNING_DEMO_RESOURCES.blog.title)[0])
    expect(
      screen.getAllByText(AI_LEARNING_DEMO_RESOURCES.blog.title, { selector: 'h1' })
    ).not.toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Attention Is All You Need' })).toHaveAttribute(
      'href',
      'https://arxiv.org/abs/1706.03762'
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    const audio = await waitFor(() => {
      const element = document.querySelector<HTMLAudioElement>(
        'audio[src*="/demo/ai-learning/qkv-podcast.mp3"]'
      )
      expect(element).not.toBeNull()
      return element as HTMLAudioElement
    })
    expect(audio.getAttribute('src')).toMatch(/\/demo\/ai-learning\/qkv-podcast\.mp3$/)
    expect(screen.getByRole('button', { name: '播放播客' })).toBeInTheDocument()

    const video = await screen.findByLabelText('1 分钟看懂一次注意力计算 讲解视频')
    expect(video.getAttribute('src')).toMatch(/\/demo\/ai-learning\/qkv-explainer\.mp4$/)
    await waitFor(() => {
      const captions = video.querySelector('track[kind="captions"]')
      expect(captions?.getAttribute('src')).toMatch(
        /\/demo\/ai-learning\/qkv-explainer\.vtt$/
      )
      expect(captions).not.toHaveAttribute('default')
    })

    pressSpace()
    fireEvent.click(screen.getByRole('button', { name: /对应 Value 在输出中的占比提高/ }))
    expect(screen.getByText('回答正确')).toBeInTheDocument()
    expect(screen.getByText(/Section 3.2.1/)).toBeInTheDocument()
  }, 60_000)
})
