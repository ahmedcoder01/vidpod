import { Sidebar } from '@/components/sidebar';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[#f5f5f7] overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
