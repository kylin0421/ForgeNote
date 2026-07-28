'use client'

import { Toaster } from '@/components/ui/sonner'
import { ConnectionGuard } from '@/components/common/ConnectionGuard'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { I18nProvider } from '@/components/providers/I18nProvider'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { ThemeProvider } from '@/components/providers/ThemeProvider'

export function AppRuntimeProviders({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryProvider>
          <I18nProvider>
            <ConnectionGuard>
              {children}
              <Toaster />
            </ConnectionGuard>
          </I18nProvider>
        </QueryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
