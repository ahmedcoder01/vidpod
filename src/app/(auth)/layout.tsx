export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f0f13] via-[#1a1a2e] to-[#16213e] flex items-center justify-center p-4">
      {children}
    </div>
  );
}
