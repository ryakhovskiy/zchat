import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, WebSocketClient } from '../services/api';

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

  useEffect(() => {
    // Check for stored token on mount
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      initializeWebSocket(storedToken);
    }
    setLoading(false);
  }, []);

  const initializeWebSocket = (authToken) => {
    const client = new WebSocketClient(authToken);
    client.connect()
      .then(() => {
        setWsClient(client);
      })
      .catch((error) => {
        console.error('Failed to connect WebSocket:', error);
      });
  };

  const login = async (username, password) => {
    try {
      const response = await authAPI.login({ username, password });
      const { access_token, user: userData } = response.data;

      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(userData));

      setToken(access_token);
      setUser(userData);

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
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);

      if (wsClient) {
        wsClient.disconnect();
        setWsClient(null);
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