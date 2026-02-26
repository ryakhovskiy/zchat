import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL;
const WS_BASE_URL = import.meta.env.VITE_WS_URL;

let isHandlingUnauthorized = false;
export const UNAUTHORIZED_EVENT = 'zchat:unauthorized';

export const getStoredToken = () => localStorage.getItem('token') || sessionStorage.getItem('token');

export const clearAuthStorage = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
};

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = getStoredToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAuthStorage();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));

      if (!isHandlingUnauthorized) {
        isHandlingUnauthorized = true;
        setTimeout(() => {
          isHandlingUnauthorized = false;
        }, 500);

        if (window.location.pathname !== '/') {
          window.location.replace('/');
        }
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  getCurrentUser: () => api.get('/auth/me'),
};

// Users API
export const usersAPI = {
  getAll: () => api.get('/users/'),
  getById: (id) => api.get(`/users/${id}`),
};

// Conversations API
export const conversationsAPI = {
  create: (data) => api.post('/conversations/', data),
  getAll: () => api.get('/conversations/'),
  getById: (id) => api.get(`/conversations/${id}`),
  getMessages: (id, limit = 1000) => 
    api.get(`/conversations/${id}/messages?limit=${limit}`),
  sendMessage: (id, payload) => 
    api.post(`/conversations/${id}/messages`, payload),
  markAsRead: (id) => api.post(`/conversations/${id}/read`),
};

// Files API
export const filesAPI = {
  upload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/uploads/', formData, {
      headers: {
        'Content-Type': undefined,
      },
    });
  },
  getFileUrl: (filename) => {
    const token = getStoredToken();
    return `${API_BASE_URL}/uploads/${filename}?token=${token}`;
  },
};

// Browser API
export const browserAPI = {
    proxy: (url) => api.get('/browser/proxy', { params: { url } }),
};

// WebSocket connection
export class WebSocketClient {
  constructor(token) {
    this.token = token;
    this.ws = null;
    this.listeners = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.shouldReconnect = true;
    this.hasEverConnected = false;
  }

  connect() {
    if (!this.token) {
      return Promise.reject(new Error('Missing WebSocket auth token'));
    }

    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        let opened = false;
        this.ws = new WebSocket(WS_BASE_URL, ['bearer', this.token]);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          opened = true;
          this.hasEverConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.emit(data.type, data);
          } catch (parseError) {
            console.error('Invalid WebSocket message payload:', parseError);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.emit('disconnect');

          if (!this.shouldReconnect) {
            return;
          }

          if (!opened && !this.hasEverConnected) {
            return;
          }

          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect().catch(console.error);
      }, 2000 * this.reconnectAttempts);
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  markRead(conversationId) {
    this.send({
      type: 'mark_read',
      conversation_id: conversationId
    });
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default api;