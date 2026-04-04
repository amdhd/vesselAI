import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { ToastProvider } from '@/components/ui/Toast'

interface MainLayoutProps {
  children: React.ReactNode
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-navy-900">
        <Sidebar />
        <Topbar />
        <main className="ml-60 pt-14 min-h-screen">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </ToastProvider>
  )
}
