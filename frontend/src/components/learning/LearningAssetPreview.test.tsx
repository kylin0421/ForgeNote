import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  LearningAssetPreview,
  MarkdownLikeAsset,
  normalizeMarkdownContent,
  serializeLearningAssetNote,
} from './LearningAssetPreview'
import type { LearningResource } from '@/lib/types/learning'

describe('normalizeMarkdownContent', () => {
  it('repairs table rows where bold markers were split across lines', () => {
    const input = [
      '# Section',
      '',
      '| Concept | Difference |',
      '|----------|------------|',
      '| **Self-supervised vs unsupervised*',
      '* | Uses pretext labels instead of direct human labels. |',
    ].join('\n')

    const normalized = normalizeMarkdownContent(input)

    expect(normalized).toContain(
      '| **Self-supervised vs unsupervised** | Uses pretext labels instead of direct human labels. |'
    )
    expect(normalized).not.toContain('*\n* |')
  })

  it('renders repaired malformed table content as a table', () => {
    const input = [
      '| Concept | Difference |',
      '|----------|------------|',
      '| **Self-supervised vs unsupervised*',
      '* | Uses pretext labels instead of direct human labels. |',
    ].join('\n')

    render(<MarkdownLikeAsset content={input} />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Self-supervised vs unsupervised')).toBeInTheDocument()
  })

  it('does not split list-like text inside table cells', () => {
    const input = [
      '| Concept | Difference |',
      '| --- | --- |',
      '| generation - contrast | Keep this on one table row. |',
    ].join('\n')

    expect(normalizeMarkdownContent(input)).toContain(
      '| generation - contrast | Keep this on one table row. |'
    )
  })

  it('normalizes common malformed table syntax', () => {
    const input = [
      '｜ Concept ｜ Difference ｜',
      '｜ A ｜ B ｜',
      '',
      '#',
      '# Next',
    ].join('\n')

    const normalized = normalizeMarkdownContent(input)

    expect(normalized).toContain('| Concept | Difference |')
    expect(normalized).toContain('| --- | --- |')
    expect(normalized).not.toMatch(/^#$/m)
  })
})

describe('serializeLearningAssetNote', () => {
  it('uses the asset kind label instead of the LLM-provided type', () => {
    const resource: LearningResource = {
      kind: 'quiz',
      type: 'Diagnostic',
      title: 'SSL quiz',
      agent: 'resource-agent',
      format: 'interactive',
      summary: 'Check understanding.',
      content: 'Question content',
      tags: [],
      payload: {},
    }

    const serialized = serializeLearningAssetNote(resource)

    expect(serialized).toContain('Type: Quiz')
    expect(serialized).not.toContain('Diagnostic')
  })
})

describe('LearningAssetPreview mind maps', () => {
  it('renders Mermaid mindmap content as a visual node tree', () => {
    const resource: LearningResource = {
      kind: 'mind_map',
      type: 'Mind map',
      title: 'SSL mind map',
      agent: 'resource-agent',
      format: 'Mermaid mindmap',
      summary: 'summary',
      content: [
        'mindmap',
        '  root((SSL))',
        '    Contrastive learning',
        '      SimCLR',
        '    Generative learning',
        '      Masked language modeling',
      ].join('\n'),
      tags: [],
      payload: {},
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.getByText('SSL')).toBeInTheDocument()
    expect(screen.getByText('Contrastive learning')).toBeInTheDocument()
    expect(screen.getByText('Generative learning')).toBeInTheDocument()
    expect(screen.queryByText('SimCLR')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Contrastive learning/ }))
    expect(screen.getByText('SimCLR')).toBeInTheDocument()
  })

  it('switches the same mind map content between tree, table, and outline views', () => {
    const resource: LearningResource = {
      kind: 'mind_map',
      type: 'Mind map',
      title: 'SSL mind map',
      agent: 'resource-agent',
      format: 'Mermaid mindmap',
      summary: 'summary',
      content: [
        'mindmap',
        '  root((SSL))',
        '    Contrastive learning',
        '      SimCLR',
      ].join('\n'),
      tags: [],
      payload: {},
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.queryByText('SimCLR')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Contrastive learning/ }))
    expect(screen.getByText('SimCLR')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '表格视图' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Contrastive learning')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '大纲视图' }))
    expect(screen.getByText(/SimCLR/)).toBeInTheDocument()
  })

  it('limits mind maps to three displayed levels', () => {
    const resource: LearningResource = {
      kind: 'mind_map',
      type: 'Mind map',
      title: 'Deep mind map',
      agent: 'resource-agent',
      format: 'Mermaid mindmap',
      summary: 'summary',
      content: [
        'mindmap',
        '  root((Root))',
        '    Level one',
        '      Level two',
        '        Level three',
      ].join('\n'),
      tags: [],
      payload: {},
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.getByText('Root')).toBeInTheDocument()
    expect(screen.getByText('Level one')).toBeInTheDocument()
    expect(screen.queryByText('Level two')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Level one/ }))
    expect(screen.getByText('Level two')).toBeInTheDocument()
    expect(screen.queryByText('Level three')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Level two/ }))
    expect(screen.getByText('Level three')).toBeInTheDocument()
  })

  it('renders horizontal flowchart LR Mermaid content', () => {
    const resource: LearningResource = {
      kind: 'mind_map',
      type: 'Mind map',
      title: 'AI mind map',
      agent: 'resource-agent',
      format: 'Mermaid flowchart LR',
      summary: 'summary',
      content: [
        '```mermaid',
        'flowchart LR',
        '  root["人工智能"] --> m1["问题建模"] --> p1["状态空间"]',
        '  root --> m2["学习方法"] --> p2["监督学习"]',
        '```',
      ].join('\n'),
      tags: [],
      payload: {},
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.getByText('人工智能')).toBeInTheDocument()
    expect(screen.getByText('问题建模')).toBeInTheDocument()
    expect(screen.queryByText('状态空间')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /问题建模/ }))
    expect(screen.getByText('状态空间')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /学习方法/ }))
    expect(screen.getByText('监督学习')).toBeInTheDocument()
  })

  it('repairs inline Mermaid fences before rendering a mind map', () => {
    const resource: LearningResource = {
      kind: 'mind_map',
      type: 'Mind map',
      title: 'Knowledge map',
      agent: 'resource-agent',
      format: 'markdown',
      summary: 'summary',
      content: [
        '```mermaid flowchart LR A[知识表示] --> B[知识表示概述]',
        'A --> C[一阶谓词逻辑]',
        'B --> B1[知识的概念]',
        '## 树状分层文本',
        '- 这部分不应该进入 Mermaid 解析',
      ].join('\n'),
      tags: [],
      payload: {},
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.getByText('知识表示')).toBeInTheDocument()
    expect(screen.getByText('知识表示概述')).toBeInTheDocument()
    expect(screen.getByText('一阶谓词逻辑')).toBeInTheDocument()
    expect(screen.queryByText('这部分不应该进入 Mermaid 解析')).not.toBeInTheDocument()
  })

  it('does not render learning-profile metadata as a mind map', () => {
    const resource: LearningResource = {
      kind: 'mind_map',
      type: 'Mind map',
      title: 'SSL mind map',
      agent: 'resource-agent',
      format: 'markdown',
      summary: 'summary',
      content: [
        '- ID: source:dvvmpud5wlcoy4v5o9jk',
        '- Topics: learning_profile',
        '- # 学习画像 这个来源由系统维护',
      ].join('\n'),
      tags: [],
      payload: {},
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.getByText(/不适合作为知识导图渲染/)).toBeInTheDocument()
    expect(screen.queryByText(/source:dvvmpud5wlcoy4v5o9jk/)).not.toBeInTheDocument()
  })
})

describe('LearningAssetPreview flashcards', () => {
  it('renders markdown in flashcard front, hint, and back content', () => {
    const resource: LearningResource = {
      kind: 'flashcards',
      type: 'Flashcards',
      title: 'Markdown cards',
      agent: 'resource-agent',
      format: 'Interactive Flashcards',
      summary: 'summary',
      content: '',
      tags: [],
      payload: {
        cards: [
          {
            front: '**Term**\n\n- one',
            back: 'Use `code` here',
            hint: '**Look** at the source',
          },
        ],
      },
    }

    render(<LearningAssetPreview resource={resource} />)

    expect(screen.getByText('Term')).toBeInTheDocument()
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(screen.getByText('Look')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    expect(screen.getByText('code')).toBeInTheDocument()
  })
})
