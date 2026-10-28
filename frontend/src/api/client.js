async function request(method, url, body, isForm = false) {
  const headers = {};
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  const resp = await fetch(`/api${url}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  let data = null;
  const text = await resp.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (!resp.ok) {
    const error = new Error(data?.error || `Erreur (${resp.status})`);
    error.status = resp.status;
    throw error;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  delete: (url) => request('DELETE', url),
  postForm: (url, formData) => request('POST', url, formData, true),
};
