'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Book,
  Bot,
  FileText,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react'

import { JobsFloatingPanel } from '@/components/common/JobsFloatingPanel'
import { LanguageToggle } from '@/components/common/LanguageToggle'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SetupBanner } from './SetupBanner'
import { useCreateDialogs } from '@/lib/hooks/use-create-dialogs'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

interface AppShellProps {
  children: React.ReactNode
  title?: React.ReactNode
}

const NAV_ITEMS = [
  { href: '/notebooks', label: '学习记录', icon: Book },
  { href: '/sources', label: '来源', icon: FileText },
  { href: '/search', label: '问询与搜索', icon: Search },
  { href: '/settings/api-keys', label: '模型', icon: Bot },
  { href: '/settings', label: '设置', icon: Settings },
  { href: '/advanced', label: '高级', icon: Wrench },
]

export function AppShell({ children, title }: AppShellProps) {
  const pathname = usePathname()
  const { t } = useTranslation()
  const { openNotebookDialog, openSourceDialog } = useCreateDialogs()
  const showHeaderCreate = pathname !== '/sources'

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-16 shrink-0 items-center border-b px-5">
        <Link href="/notebooks" className="flex shrink-0 items-center">
          <Image src="/logo.svg" alt="智学工坊" width={32} height={32} />
        </Link>
        <div className="ml-2 min-w-0 flex-1 max-w-[min(42vw,36rem)]">
          {title ? (
            title
          ) : (
            <span className="block truncate text-xl font-semibold tracking-tight">
              智学工坊
            </span>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/settings' && pathname?.startsWith(`${item.href}/`))
              const Icon = item.icon
              return (
                <Button
                  key={item.href}
                  asChild
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  className="gap-2"
                >
                  <Link href={item.href}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              )
            })}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="导航">
                <SlidersHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href} className="gap-2">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {showHeaderCreate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                {t('common.create')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={openNotebookDialog} className="gap-2">
                <Book className="h-4 w-4" />
                新建学习记录
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openSourceDialog} className="gap-2">
                <FileText className="h-4 w-4" />
                添加来源
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}

          <div className={cn('hidden items-center gap-1 sm:flex')}>
            <ThemeToggle iconOnly />
            <LanguageToggle iconOnly />
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SetupBanner />
        {children}
      </main>
      <JobsFloatingPanel />
    </div>
  )
}
