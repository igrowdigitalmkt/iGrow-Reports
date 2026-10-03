import { META_LOGIN_APP_ID } from "./login-config";

export type FacebookSdk = {
  __buffer?: unknown;
  init(options: { appId: string; version: string; xfbml: boolean; fedCM: false }): void;
  login(callback: (response: { authResponse?: { accessToken?: string } }) => void, options: { config_id: string; response_type: "token"; override_default_response_type: true }): void;
};
declare global { interface Window { FB?: FacebookSdk; fbAsyncInit?: () => void } }

let sdkPromise: Promise<FacebookSdk> | undefined;
export function loadFacebookSdk(version: string) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error("O login da Meta não carregou. Atualize a página e tente novamente. Verifique também se uma extensão está bloqueando o Facebook."));
    };
    const initialize = () => {
      // sdk.js first installs a buffering facade. Only fbAsyncInit signals the real SDK.
      if (settled || !window.FB || window.FB.__buffer) return;
      try {
        window.FB.init({ appId: META_LOGIN_APP_ID, version, xfbml: false, fedCM: false });
        settled = true;
        clearTimeout(timeout);
        resolve(window.FB);
      } catch { fail(); }
    };
    const timeout = setTimeout(fail, 20000);
    if (window.FB && !window.FB.__buffer) { initialize(); return; }
    window.fbAsyncInit = initialize;
    if (!document.querySelector('script[src="https://connect.facebook.net/pt_BR/sdk.js"]')) {
      const script = document.createElement("script");
      script.src = "https://connect.facebook.net/pt_BR/sdk.js";
      script.async = true;
      script.onerror = fail;
      document.head.appendChild(script);
    }
  });
  return sdkPromise;
}
