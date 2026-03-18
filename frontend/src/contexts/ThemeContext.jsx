import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('zchat-theme');
    // If it's old boolean or invalid, default to 'hacker'
    return ['hacker', 'dark', 'light'].includes(saved) ? saved : 'hacker';
  });

  useEffect(() => {
    localStorage.setItem('zchat-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const cycleTheme = () => {
    setTheme(prev => {
      if (prev === 'hacker') return 'dark';
      if (prev === 'dark') return 'light';
      return 'hacker';
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
