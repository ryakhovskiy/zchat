import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  THEMES,
  readStoredTheme,
  writeStoredTheme,
  systemTheme,
  syncThemeColorMeta,
} from '../utils/theme';

const ThemeContext = createContext(null);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  // null = the user never chose: follow the OS preference
  const [chosen, setChosen] = useState(readStoredTheme);
  const [system, setSystem] = useState(systemTheme);
  const theme = chosen || system;

  // Follow OS changes only while there is no explicit choice
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    syncThemeColorMeta();
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setChosen(next);
    writeStoredTheme(next);
  }, []);

  // 'light' | 'dark': for third-party widgets (emoji picker) that only understand a scheme
  const colorScheme = theme === 'light' ? 'light' : 'dark';
  const value = useMemo(() => ({ theme, setTheme, themes: THEMES, colorScheme }), [theme, setTheme, colorScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
