(function () {
  const config = {
    apiBaseUrl: 'https://wedsceneai.com',
  };
  const apiBase = String(config.apiBaseUrl || '').replace(/\/+$/, '');
  let apiOrigin = '';
  try {
    apiOrigin = apiBase ? new URL(apiBase).origin : '';
  } catch {
    apiOrigin = '';
  }
  const isLocalHost = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i.test(location.hostname);
  const fileApiBase = location.protocol === 'file:' ? 'http://127.0.0.1:5173' : '';
  const activeApiBase = fileApiBase || (apiBase && !isLocalHost && location.origin !== apiOrigin ? apiBase : '');

  window.WEDSCENE_CONFIG = config;
  window.WEDSCENE_API_BASE = activeApiBase;

  if (typeof window.fetch !== 'function') return;

  function isApiRequest(input) {
    try {
      if (typeof input === 'string') {
        return new URL(input, window.location.href).pathname.startsWith('/api');
      }
      if (input instanceof Request) {
        return new URL(input.url).pathname.startsWith('/api');
      }
    } catch {
      return false;
    }
    return false;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedWedSceneFetch(input, init) {
    const options = init ? { ...init } : {};
    let target = input;
    const apiRequest = isApiRequest(input);

    if (activeApiBase) {
      if (typeof input === 'string' && input.startsWith('/api')) {
        target = activeApiBase + input;
      } else if (input instanceof Request) {
        const url = new URL(input.url);
        if (url.origin === location.origin && url.pathname.startsWith('/api')) {
          target = new Request(activeApiBase + url.pathname + url.search, input);
        }
      }
    }

    if (apiRequest || target !== input) {
      options.credentials = options.credentials || 'include';
    }
    return originalFetch(target, options);
  };
}());
