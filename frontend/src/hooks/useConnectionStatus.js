import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * 'online' | 'offline' (browser has no network) | 'reconnecting' (network is up but the
 * WebSocket dropped after having connected once). The WebSocket client has no "connected"
 * event, so readyState is sampled; 'disconnect' makes the banner appear immediately.
 */
export const useConnectionStatus = () => {
  const { wsClient } = useAuth();
  const [networkUp, setNetworkUp] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [socketUp, setSocketUp] = useState(true);

  useEffect(() => {
    const up = () => setNetworkUp(true);
    const down = () => setNetworkUp(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!wsClient) return undefined;
    const sample = () => {
      const open = wsClient.ws?.readyState === WebSocket.OPEN;
      // Not having connected yet is "starting", not "reconnecting"
      setSocketUp(open || !wsClient.hasEverConnected);
    };
    const onDisconnect = () => setSocketUp(false);
    sample();
    wsClient.on('disconnect', onDisconnect);
    const timer = setInterval(sample, 2000);
    return () => {
      wsClient.off('disconnect', onDisconnect);
      clearInterval(timer);
    };
  }, [wsClient]);

  if (!networkUp) return 'offline';
  return socketUp ? 'online' : 'reconnecting';
};
