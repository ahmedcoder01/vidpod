import { Sidebar } from '@/components/sidebar';
import { AppProvider } from '@/context/app-context';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  // Podcasts are fetched from /api/me/podcasts inside the provider so they
  // stay in sync with the signed-in user.
  return (
    <AppProvider>
      <div className="flex h-screen bg-[#f5f5f7] overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          {children}
        </main>
      </div>
    </AppProvider>
  );
}
