import { getStoredToken } from './api';

const API_BASE_URL = import.meta.env.VITE_API_URL;

/**
 * Convert a base64url-encoded string to a Uint8Array for applicationServerKey.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Get the VAPID public key — from build-time env var, or fall back to the API endpoint.
 */
async function getVAPIDPublicKey() {
  const envKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (envKey) return envKey;

  try {
    const res = await fetch(`${API_BASE_URL}/push/vapid-key`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.public_key || null;
  } catch {
    return null;
  }
}

/**
 * Register the service worker, request notification permission,
 * subscribe to Web Push, and send the subscription to the backend.
 */
export async function registerPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }

  const vapidPublicKey = await getVAPIDPublicKey();
  if (!vapidPublicKey) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return;
    }

    // Check for existing subscription first
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const token = getStoredToken();
    if (!token) return;

    await fetch(`${API_BASE_URL}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(subscription.toJSON()),
    });
  } catch (error) {
    console.error('Push registration failed:', error);
  }
}

/**
 * Unsubscribe from Web Push and notify the backend to remove the subscription.
 */
export async function unregisterPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const token = getStoredToken();

      if (token) {
        await fetch(`${API_BASE_URL}/push/unsubscribe`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }

      await subscription.unsubscribe();
    }
  } catch (error) {
    console.error('Push unregistration failed:', error);
  }
}
