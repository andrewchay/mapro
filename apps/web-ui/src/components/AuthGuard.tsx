import * as React from 'react'
import { useAtom } from 'jotai'
import { authStateAtom, authInitializeAtom } from '../store/auth-atoms.ts'
import { LoginPage } from '../pages/LoginPage.tsx'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [authState] = useAtom(authStateAtom)
  const [, initialize] = useAtom(authInitializeAtom)

  React.useEffect(() => {
    initialize()
  }, [initialize])

  if (authState.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-500">加载中…</div>
      </div>
    )
  }

  if (!authState.isAuthenticated) {
    return <LoginPage />
  }

  return <>{children}</>
}
