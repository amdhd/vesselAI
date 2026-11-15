import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { ToastProvider } from '@/components/ui/Toast'
import NetworkStatus from '@/components/NetworkStatus'

interface MainLayoutProps {
  children: React.ReactNode
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-paper">
        <Sidebar />
        <Topbar />
        <main className="ml-[248px] pt-16 min-h-screen">
          <div className="max-w-[1600px] mx-auto pt-8 px-10 pb-16">
            {children}
          </div>
        </main>
        <NetworkStatus />
      </div>
    </ToastProvider>
  )
}
