export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f5f5f7] flex items-center justify-center p-4">
      {/* Ambient gradient blobs. Two low-opacity blurred orbs give the page
          a bit of atmosphere without stealing attention from the card. */}
      <div
        aria-hidden
        className="auth-blob pointer-events-none absolute -top-40 -left-40 w-[460px] h-[460px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle at 30% 30%, #a5b4fc 0%, transparent 70%)' }}
      />
      <div
        aria-hidden
        className="auth-blob pointer-events-none absolute -bottom-40 -right-40 w-[520px] h-[520px] rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle at 70% 70%, #f0abfc 0%, transparent 70%)' }}
      />
      {/* Faint grid overlay — barely visible, adds structure. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(17,24,39,0.045) 1px, transparent 0)',
          backgroundSize: '22px 22px',
        }}
      />
      <div className="relative z-10 w-full max-w-sm">
        {children}
      </div>
    </div>
  );
}
