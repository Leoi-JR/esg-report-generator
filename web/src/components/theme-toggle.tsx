'use client';

import { useEffect, useState } from 'react';

const THEMES = [
  { id: 'warm', label: 'C', title: '暖白务实' },
  { id: 'crisp', label: 'D', title: '简洁利落' },
] as const;

type ThemeId = typeof THEMES[number]['id'];

const STORAGE_KEY = 'esg-theme';

export function ThemeToggle() {
  const [current, setCurrent] = useState<ThemeId>('warm');

  // 初始化：从 localStorage 读取
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    const theme = saved && THEMES.some(t => t.id === saved) ? saved : 'warm';
    applyTheme(theme);
    setCurrent(theme);
  }, []);

  function applyTheme(id: ThemeId) {
    if (id === 'warm') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', id);
    }
    localStorage.setItem(STORAGE_KEY, id);
  }

  function handleSwitch(id: ThemeId) {
    setCurrent(id);
    applyTheme(id);
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      padding: '2px',
      background: 'var(--bg-warm)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
    }}>
      {THEMES.map(t => (
        <button
          key={t.id}
          onClick={() => handleSwitch(t.id)}
          title={`切换到${t.title}主题`}
          style={{
            height: '22px',
            padding: '0 8px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: current === t.id ? 'var(--bg-card)' : 'transparent',
            color: current === t.id ? 'var(--text-1)' : 'var(--text-4)',
            fontSize: '11px',
            fontWeight: current === t.id ? 600 : 400,
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
            boxShadow: current === t.id ? 'var(--shadow-sm)' : 'none',
            transition: 'all 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
