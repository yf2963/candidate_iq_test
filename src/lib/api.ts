const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Request failed');
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}
