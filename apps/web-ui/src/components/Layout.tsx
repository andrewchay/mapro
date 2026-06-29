import { Link, useLocation } from 'react-router-dom'
import { useAtom } from 'jotai'
import { MessageSquare, LayoutGrid, Bot, Settings } from 'lucide-react'
import { userProfileAtom } from '../store/user-profile-atoms.ts'

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [profile] = useAtom(userProfileAtom)

  const navItems = [
    { to: '/', icon: LayoutGrid, label: 'Campaign' },
    { to: '/agent', icon: Bot, label: 'Agent' },
    { to: '/chat', icon: MessageSquare, label: 'Chat' },
    { to: '/settings', icon: Settings, label: '设置' },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="text-lg font-semibold text-slate-900">
            MAPro Web
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === item.to
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
            <Link
              to="/settings"
              className="ml-2 flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
              title="用户档案"
            >
              <span className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-sm">
                {profile.avatar.startsWith('data:image') ? (
                  <img src={profile.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  profile.avatar
                )}
              </span>
              <span className="hidden sm:inline max-w-[80px] truncate">{profile.userName}</span>
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
