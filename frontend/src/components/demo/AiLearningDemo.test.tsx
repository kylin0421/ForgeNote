import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AiLearningDemo } from './AiLearningDemo'

describe('AiLearningDemo', () => {
  it('starts from a fresh notebook every time it mounts', () => {
    const first = render(<AiLearningDemo />)

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('1 / 9')

    first.unmount()
    render(<AiLearningDemo />)

    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('0 / 9')
    expect(screen.getByText('这是一个崭新的学习记录。按下空格，从画像访谈开始。')).toBeInTheDocument()
  })

  it('advances exactly one cached stage for each non-repeated space press', () => {
    render(<AiLearningDemo />)

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('1 / 9')
    expect(screen.getByText('画像访谈')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: ' ', code: 'Space', repeat: true })
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('1 / 9')

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('2 / 9')
    expect(screen.getByText('学习画像已建立')).toBeInTheDocument()
  })

  it('does not advance while typing a space in an input', () => {
    render(<AiLearningDemo />)

    const input = screen.getByRole('textbox', { name: '演示输入框' })
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })

    expect(screen.getByTestId('demo-step-counter')).toHaveTextContent('0 / 9')
  })
})
