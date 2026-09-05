import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  DEFAULT_THEME,
  applyTheme,
  loadTheme,
  saveTheme,
  type ThemeSettings,
} from '../lib/theme';

interface ThemeContextValue {
  theme: ThemeSettings;
  setTheme: (patch: Partial<ThemeSettings>) => void;
  reset: () => void;
  isDefault: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Holds the look of the app. Changes are applied to the document immediately
 * (so a dragged slider paints live) and persisted per device.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeSettings>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const setTheme = useCallback((patch: Partial<ThemeSettings>) => {
    setThemeState((current) => ({ ...current, ...patch }));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      reset: () => setThemeState(DEFAULT_THEME),
      isDefault: (Object.keys(DEFAULT_THEME) as (keyof ThemeSettings)[]).every(
        (key) => theme[key] === DEFAULT_THEME[key],
      ),
    }),
    [setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
