import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('AiLearningDemo', () => {
  beforeEach(() => {
    navigation.pathname = '/notebooks/ai-learning-demo'
    navigation.search = ''
    navigation.push.mockReset()
  })

  it('starts from a fresh notebook every time the entry page mounts', () => {
    const first = render(<AiLearningDemo />)

    pressSpace()
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('1 / 14')

    first.unmount()
    render(<AiLearningDemo />)

    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('0 / 14')
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'notebook')
    expect(screen.getByText('开始一段对话，让 AI 了解你的目标和已有基础')).toBeInTheDocument()
  })

  it('advances through the cached cross-page scenes and routes', () => {
    render(<AiLearningDemo />)

    for (let step = 1; step <= 4; step += 1) pressSpace()
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('4 / 14')
    expect(screen.getByText('DeepSearch · 权威证据检索')).toBeInTheDocument()

    pressSpace()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'search')
    expect(navigation.push).toHaveBeenLastCalledWith('/search/ai-learning-demo?step=5')

    pressSpace()
    pressSpace()
    expect(screen.getByTestId('deep-search-results')).toBeInTheDocument()

    pressSpace()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'workflow')
    expect(navigation.push).toHaveBeenLastCalledWith('/workflow/ai-learning-demo?step=8')

    pressSpace()
    pressSpace()
    expect(screen.getByText('全部智能体协作完成')).toBeInTheDocument()

    pressSpace()
    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'studio')
    expect(navigation.push).toHaveBeenLastCalledWith('/notebooks/ai-learning-demo/studio?step=11')

    pressSpace()
    expect(screen.getByTestId('multimodal-assets')).toBeInTheDocument()

    pressSpace()
    expect(screen.getByText('回答正确')).toBeInTheDocument()

    pressSpace()
    expect(screen.getByTestId('profile-writeback')).toHaveTextContent('72% → 80%')
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('14 / 14')
  })

  it('ignores key repeat and spaces used by editable or interactive controls', () => {
    render(<AiLearningDemo />)

    pressSpace(true)
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('0 / 14')

    const input = screen.getByRole('textbox', { name: '学习记录输入框' })
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })

    const button = screen.getByRole('button', { name: '生成学习资产' })
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

    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('0 / 14')
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('uses the first stage for a directly opened cross-page scene', () => {
    navigation.pathname = '/workflow/ai-learning-demo'
    render(<AiLearningDemo />)

    expect(screen.getByTestId('ai-learning-demo')).toHaveAttribute('data-scene', 'workflow')
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('8 / 14')
  })

  it('returns the scene to the top after advancing', () => {
    render(<AiLearningDemo />)

    const demo = screen.getByTestId('ai-learning-demo')
    demo.scrollTop = 480
    pressSpace()

    expect(demo.scrollTop).toBe(0)
  })
})
