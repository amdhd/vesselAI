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
      <div className="min-h-screen bg-navy-900">
        <Sidebar />
        <Topbar />
        <main className="ml-[236px] pt-14 min-h-screen">
          <div className="pt-[30px] px-[34px] pb-[60px]">
            {children}
          </div>
        </main>
        <NetworkStatus />
      </div>
    </ToastProvider>
  )
}
