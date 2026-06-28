import apiClient from './client'
import {
  LearningProfileEventRequest,
  LearningProfileSourceResponse,
  LearningOrchestrationRequest,
  LearningOrchestrationResponse,
  LearningOutputKind,
} from '@/lib/types/learning'

function getAuthToken() {
  if (typeof window === 'undefined') {
    return null
  }

  const authStorage = localStorage.getItem('auth-storage')
  if (!authStorage) {
    return null
  }

  try {
    const { state } = JSON.parse(authStorage)
    return state?.token || null
  } catch (error) {
    console.error('Error parsing auth storage:', error)
    return null
  }
}

export const learningApi = {
  orchestrate: async (params: LearningOrchestrationRequest) => {
    const response = await apiClient.post<LearningOrchestrationResponse>(
      '/learning/orchestrate',
      params
    )
    return response.data
  },

  submitResourceSearchJob: async (params: LearningOrchestrationRequest) => {
    const response = await apiClient.post<{
      job_id: string
      status: string
      message: string
    }>('/learning/resource-search/jobs', params)
    return response.data
  },

  submitAssetJobs: async (params: LearningOrchestrationRequest) => {
    const response = await apiClient.post<{
      jobs: Array<{
        job_id: string
        output_kind: LearningOutputKind
      }>
    }>('/learning/assets/jobs', params)
    return response.data
  },

  ensureProfileSource: async (notebookId: string) => {
    const response = await apiClient.get<LearningProfileSourceResponse>(
      `/learning/profile-source/${encodeURIComponent(notebookId)}`
    )
    return response.data
  },

  recordProfileEvent: async (params: LearningProfileEventRequest) => {
    const response = await apiClient.post<LearningProfileSourceResponse>(
      '/learning/profile-event',
      params
    )
    return response.data
  },

  orchestrateStream: async (params: LearningOrchestrationRequest) => {
    const token = getAuthToken()

    const response = await fetch('/api/learning/orchestrate/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.detail || errorData.message || errorMessage
      } catch {
        errorMessage = response.statusText || errorMessage
      }
      throw new Error(errorMessage)
    }

    if (!response.body) {
      throw new Error('No response body received')
    }

    return response.body
  },
}
