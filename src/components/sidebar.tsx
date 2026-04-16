'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, BarChart2, Radio, Layers, Download, Settings,
  ChevronDown, Users, MessageSquare, HelpCircle, ToggleLeft,
} from 'lucide-react';

const mainNav = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Analytics', href: '/analytics', icon: BarChart2 },
  { label: 'Ads', href: '/ads', icon: Radio },
  { label: 'Channels', href: '/channels', icon: Layers },
  { label: 'Import', href: '/import', icon: Download },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[175px] min-w-[175px] h-screen flex flex-col bg-white border-r border-gray-100 overflow-hidden">
      {/* Logo */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          {/* Geometric logo matching Figma */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2L18 16H2L10 2Z" fill="#111827" />
          </svg>
          <span className="text-gray-900 font-semibold text-[15px] tracking-tight">Vidpod</span>
        </div>
      </div>

      {/* Create episode */}
      <div className="px-3 pb-2">
        <button className="w-full bg-gray-900 hover:bg-gray-800 text-white text-[11px] font-medium rounded-lg py-2 px-3 transition flex items-center justify-center gap-1">
          Create an episode
        </button>
      </div>

      {/* Podcast selector */}
      <div className="px-3 pb-3">
        <button className="w-full flex items-center gap-2 hover:bg-gray-50 transition rounded-lg px-2 py-1.5 text-left group">
          <div className="w-5 h-5 rounded-md bg-linear-to-br from-orange-400 to-red-500 shrink-0 flex items-center justify-center">
            <span className="text-white text-[8px] font-bold">DC</span>
          </div>
          <span className="text-gray-700 text-[11px] font-medium truncate flex-1">The Diary Of A CEO</span>
          <ChevronDown size={11} className="text-gray-400 shrink-0" />
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {mainNav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[12px] transition-all group',
                active
                  ? 'text-gray-900 font-semibold'
                  : 'text-gray-500 font-medium hover:text-gray-800 hover:bg-gray-50'
              )}
            >
              <Icon
                size={14}
                className={cn('shrink-0 transition', active ? 'text-gray-900' : 'text-gray-400 group-hover:text-gray-600')}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Weekly plays widget */}
      <div className="mx-3 mb-3 bg-gray-50 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-gray-500 text-[10px] font-medium">Weekly plays</span>
          <span className="text-emerald-500 text-[10px] font-semibold">▲ 17%</span>
        </div>
        <p className="text-gray-900 text-[15px] font-bold">738,849</p>
        <svg viewBox="0 0 80 24" className="w-full mt-1.5">
          <polyline
            points="0,20 10,18 20,13 30,15 40,7 50,10 60,5 70,8 80,3"
            fill="none"
            stroke="#22c55e"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/* Pagination dots */}
        <div className="flex items-center justify-center gap-1 mt-2">
          <div className="w-4 h-1 rounded-full bg-gray-400" />
          <div className="w-1 h-1 rounded-full bg-gray-200" />
          <div className="w-1 h-1 rounded-full bg-gray-200" />
        </div>
      </div>

      {/* Bottom nav */}
      <div className="px-2 pb-3 space-y-0.5 border-t border-gray-100 pt-2">
        <button className="w-full flex items-center justify-between px-3 py-[7px] rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition">
          <div className="flex items-center gap-2">
            <ToggleLeft size={13} className="text-gray-400" />
            Demo mode
          </div>
          <div className="w-7 h-4 bg-gray-200 rounded-full relative">
            <div className="w-3 h-3 bg-white rounded-full absolute top-0.5 left-0.5 shadow-sm" />
          </div>
        </button>
        {[
          { label: 'Invite your team', icon: Users },
          { label: 'Give feedback', icon: MessageSquare },
          { label: 'Help & support', icon: HelpCircle },
        ].map(({ label, icon: Icon }) => (
          <Link
            key={label}
            href="#"
            className="flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-all"
          >
            <Icon size={13} className="text-gray-400 shrink-0" />
            {label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
