// Lapisan API: menyimpan token login dan menyisipkannya otomatis ke semua pemanggilan /api/...
// Dengan begitu pipelineRunner, exportService, ReportViewerModal, dan komponen lain
// tidak perlu diubah satu per satu.

const TOKEN_KEY = 'mutatrack_token';

/** Dikirim ke window ketika server menjawab 401 padahal token sudah dikirim (sesi berakhir/ditolak). */
export const UNAUTHORIZED_EVENT = 'mutatrack:unauthorized';

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage diblokir: login hanya berlaku sampai halaman dimuat ulang */
  }
};

export const clearToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* abaikan */
  }
};

// Login dan registrasi tidak membawa token, dan 401 di sana berarti "kata sandi salah",
// bukan "sesi berakhir".
const PUBLIC_AUTH_PATHS = ['/api/auth/login', '/api/auth/register'];

const toApiPath = (input: RequestInfo | URL): string | null => {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null; // hanya panggilan ke server sendiri
    return url.pathname.startsWith('/api/') ? url.pathname : null;
  } catch {
    return null;
  }
};

export const installAuthFetch = (): void => {
  if (typeof window === 'undefined') return;
  const w = window as any;
  if (w.__mutatrackFetchInstalled) return; // aman terhadap hot-reload
  w.__mutatrackFetchInstalled = true;

  const original = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = toApiPath(input);
    if (!path) return original(input, init);

    const isPublicAuth = PUBLIC_AUTH_PATHS.includes(path);
    const token = isPublicAuth ? null : getToken();

    let response: Response;
    if (token) {
      const baseHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
      const headers = new Headers(baseHeaders);
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      response =
        input instanceof Request
          ? await original(new Request(input, { ...init, headers }))
          : await original(input, { ...init, headers });
    } else {
      response = await original(input, init);
    }

    if (response.status === 401 && token && !isPublicAuth) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return response;
  }) as typeof window.fetch;
};