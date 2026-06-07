(function () {
  const config = {
    apiBaseUrl: '',
  };
  const apiBase = String(config.apiBaseUrl || '').replace(/\/+$/, '');
  let apiOrigin = '';
  try {
    apiOrigin = apiBase ? new URL(apiBase).origin : '';
  } catch {
    apiOrigin = '';
  }
  const isLocalHost = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i.test(location.hostname);
  const isGithubPages = /\.github\.io$/i.test(location.hostname);
  const fileApiBase = location.protocol === 'file:' ? 'http://127.0.0.1:5173' : '';
  const activeApiBase = fileApiBase || (apiBase && isGithubPages && !isLocalHost && location.origin !== apiOrigin ? apiBase : '');

  window.WEDSCENE_CONFIG = config;
  window.WEDSCENE_API_BASE = activeApiBase;

  if (typeof window.fetch !== 'function') return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedWedSceneFetch(input, init) {
    const options = init ? { ...init } : {};
    let target = input;

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

    if (target !== input) {
      options.credentials = options.credentials || 'include';
    }
    return originalFetch(target, options);
  };
}());
