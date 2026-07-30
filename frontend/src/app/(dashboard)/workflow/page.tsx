'use client'

import { useQuery } from '@tanstack/react-query'

import { AppShell } from '@/components/layout/AppShell'
import { WorkflowSupervisorSurface } from '@/components/workflow/WorkflowSupervisorSurface'
import { commandsApi } from '@/lib/api/commands'

export default function WorkflowSupervisorPage() {
  const { data: jobs = [], isFetching } = useQuery({
    queryKey: ['commands', 'workflow-supervisor'],
    queryFn: () => commandsApi.listJobs({ limit: 100, include_dismissed: true }),
    refetchInterval: 2000,
  })

  return (
    <AppShell>
      <WorkflowSupervisorSurface jobs={jobs} isFetching={isFetching} />
    </AppShell>
  )
}
