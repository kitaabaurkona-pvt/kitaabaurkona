import { API_BASE_URL } from '../utils/constants';

/**
 * Configured fetch wrapper.
 * Automatically prepends the base URL, sets JSON headers,
 * and attaches the auth token when available.
 */
async function apiClient(endpoint, { method = 'GET', body, headers = {} } = {}) {
  const token = localStorage.getItem('auth_token');

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Request failed with status ${response.status}`);
  }

  // Handle 204 No Content
  if (response.status === 204) return null;

  return response.json();
}

export default apiClient;
