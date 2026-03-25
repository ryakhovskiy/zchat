const ONESIGNAL_APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID || '9695aa0d-0361-4b41-aeb3-9fb165d73e0f';

let initialized = false;

const withOneSignal = (callback) => new Promise((resolve, reject) => {
  if (typeof window === 'undefined') {
    resolve(null);
    return;
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      const result = await callback(OneSignal);
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
});

export const initOneSignal = async () => {
  if (initialized) {
    return;
  }

  if (!ONESIGNAL_APP_ID) {
    return;
  }

  await withOneSignal(async (OneSignal) => {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      notifyButton: {
        enable: true,
      },
    });
  });

  initialized = true;
};

export const loginOneSignal = async (userId) => {
  if (!userId) {
    return;
  }

  await initOneSignal();

  await withOneSignal(async (OneSignal) => {
    await OneSignal.login(String(userId));
  });
};

export const logoutOneSignal = async () => {
  if (!initialized) {
    return;
  }

  await withOneSignal(async (OneSignal) => {
    await OneSignal.logout();
  });
};

export const promptOneSignalPermission = async () => {
  await initOneSignal();

  await withOneSignal(async (OneSignal) => {
    if (!OneSignal.Notifications.permission) {
      await OneSignal.Notifications.requestPermission();
    }
  });
};
