import { AppRuntimeProviders } from '@/components/providers/AppRuntimeProviders'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppRuntimeProviders>{children}</AppRuntimeProviders>
}
