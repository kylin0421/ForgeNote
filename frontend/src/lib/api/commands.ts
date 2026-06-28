import apiClient from './client'

export type CommandJobStatus = 'new' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'unknown'

export interface CommandJob {
  job_id: string
  app?: string | null
  command?: string | null
  status: CommandJobStatus
  target?: Record<string, unknown>
  result_summary?: Record<string, unknown>
  error_message?: string | null
  created?: string | null
  updated?: string | null
}

export interface CancelCommandJobResponse {
  job_id: string
  cancelled: boolean
}

export interface DismissCommandJobResponse {
  job_id: string
  dismissed: boolean
}

export interface CommandJobStatusResponse {
  job_id: string
  status: CommandJobStatus
  result?: Record<string, unknown> | null
  error_message?: string | null
  created?: string | null
  updated?: string | null
  progress?: Record<string, unknown> | null
}

export interface CommandJobLogResponse {
  job_id: string
  status: CommandJobStatus
  app?: string | null
  command?: string | null
  args?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  error_message?: string | null
  created?: string | null
  updated?: string | null
  log?: string[] | null
}

export const commandsApi = {
  listJobs: async (params?: {
    command_filter?: string
    status_filter?: string
    limit?: number
    include_dismissed?: boolean
  }) => {
    const response = await apiClient.get<CommandJob[]>('/commands/jobs', {
      params,
    })
    return response.data
  },

  getJob: async (jobId: string) => {
    const response = await apiClient.get<CommandJobStatusResponse>(
      `/commands/jobs/${encodeURIComponent(jobId)}`
    )
    return response.data
  },

  getJobLog: async (jobId: string) => {
    const response = await apiClient.get<CommandJobLogResponse>(
      `/commands/jobs/${encodeURIComponent(jobId)}/log`
    )
    return response.data
  },

  cancelJob: async (jobId: string) => {
    const response = await apiClient.delete<CancelCommandJobResponse>(
      `/commands/jobs/${encodeURIComponent(jobId)}`
    )
    return response.data
  },

  dismissJob: async (jobId: string) => {
    const response = await apiClient.delete<DismissCommandJobResponse>(
      `/commands/jobs/${encodeURIComponent(jobId)}/dismiss`
    )
    return response.data
  },
}
