import { AiLearningDemo } from '@/components/demo/AiLearningDemo'
import { AppShell } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/badge'

export default function AiLearningDemoPage() {
  return (
    <AppShell
      runtimeStatus={false}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xl font-semibold tracking-tight">ai学习</span>
          <Badge className="shrink-0 bg-violet-500 text-white hover:bg-violet-500">演示</Badge>
        </div>
      }
    >
      <AiLearningDemo />
    </AppShell>
  )
}
