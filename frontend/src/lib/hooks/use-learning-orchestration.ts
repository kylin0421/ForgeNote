'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { learningApi } from '@/lib/api/learning'
import {
  LearningAgentStage,
  LearningOrchestrationRequest,
  LearningOrchestrationResponse,
  LearningStreamEvent,
} from '@/lib/types/learning'

interface LearningState {
  isStreaming: boolean
  stages: LearningAgentStage[]
  result: LearningOrchestrationResponse | null
  error: string | null
}

const initialState: LearningState = {
  isStreaming: false,
  stages: [],
  result: null,
  error: null,
}

function upsertStage(
  stages: LearningAgentStage[],
  nextStage: LearningAgentStage
) {
  const index = stages.findIndex((stage) => stage.id === nextStage.id)
  if (index === -1) {
    return [...stages, nextStage]
  }

  const updated = [...stages]
  updated[index] = nextStage
  return updated
}

export function useLearningOrchestration() {
  const [state, setState] = useState<LearningState>(initialState)

  const run = useCallback(async (params: LearningOrchestrationRequest) => {
    if (!params.message.trim()) {
      toast.error('请输入学习需求')
      return null
    }

    setState({
      isStreaming: true,
      stages: [],
      result: null,
      error: null,
    })

    try {
      const response = await learningApi.orchestrateStream(params)
      const reader = response.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: LearningOrchestrationResponse | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue
          }

          const jsonStr = line.slice(6).trim()
          if (!jsonStr) {
            continue
          }

          const event = JSON.parse(jsonStr) as LearningStreamEvent

          if (event.type === 'stage') {
            setState((previous) => ({
              ...previous,
              stages: upsertStage(previous.stages, event.stage),
            }))
          } else if (event.type === 'complete') {
            finalResult = event.result
            setState((previous) => ({
              ...previous,
              isStreaming: false,
              result: event.result,
              stages: event.result.trace,
            }))
          } else if (event.type === 'error') {
            throw new Error(event.message)
          }
        }
      }

      setState((previous) => ({
        ...previous,
        isStreaming: false,
      }))
      return finalResult
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '学习智能体编排失败'
      setState((previous) => ({
        ...previous,
        isStreaming: false,
        error: message,
      }))
      toast.error('学习智能体编排失败', {
        description: message,
      })
      return null
    }
  }, [])

  const reset = useCallback(() => {
    setState(initialState)
  }, [])

  return {
    ...state,
    run,
    reset,
  }
}
