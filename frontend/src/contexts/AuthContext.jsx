import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { authAPI, WebSocketClient, clearAuthStorage, getStoredToken } from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wsClient, setWsClient] = useState(null);
  const wsClientRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    const bootstrapAuth = async () => {
      const storedToken = getStoredToken();
      if (!storedToken) {
        if (isMounted) {
          setLoading(false);
        }
        return;
      }

      try {
        const response = await authAPI.getCurrentUser();
        const userData = response.data;

        if (!isMounted) {
          return;
        }

        setToken(storedToken);
        setUser(userData);
        initializeWebSocket(storedToken, isMounted);
      } catch (error) {
        clearAuthStorage();

        if (isMounted) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    bootstrapAuth();

    return () => {
      isMounted = false;
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
    };
  }, []);

  const initializeWebSocket = (authToken, isMounted = true) => {
    if (!authToken) {
      return;
    }

    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
    }

    const client = new WebSocketClient(authToken);
    wsClientRef.current = client;

    client.connect()
      .then(() => {
        if (!isMounted || wsClientRef.current !== client) {
          client.disconnect();
          return;
        }
        setWsClient(client);
      })
      .catch((error) => {
        console.error('Failed to connect WebSocket:', error);
      });
  };

  const login = async (username, password, rememberMe = false) => {
    try {
      const response = await authAPI.login({ username, password, remember_me: rememberMe });
      const { access_token, user: userData } = response.data;

      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem('token', access_token);
      storage.setItem('user', JSON.stringify(userData));

      setToken(access_token);
      setUser(userData);

      if (rememberMe) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
      } else {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }

      initializeWebSocket(access_token);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || 'Login failed',
      };
    }
  };

  const register = async (username, password, email) => {
    try {
      const response = await authAPI.register({ username, password, email });
      const { access_token, user: userData } = response.data;

      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(userData));
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');

      setToken(access_token);
      setUser(userData);

      initializeWebSocket(access_token);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || 'Registration failed',
      };
    }
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuthStorage();
      setToken(null);
      setUser(null);

      if (wsClient) {
        wsClient.disconnect();
        setWsClient(null);
      }

      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
    }
  };

  const value = {
    user,
    token,
    loading,
    wsClient,
    login,
    register,
    logout,
    isAuthenticated: !!token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};