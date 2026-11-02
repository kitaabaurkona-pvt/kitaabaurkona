import apiClient from './apiClient';
import { API_ROUTES } from '../utils/constants';

/**
 * Authenticate a user.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{token: string, user: object}>}
 */
export async function login(email, password) {
  return apiClient(API_ROUTES.LOGIN, {
    method: 'POST',
    body: { email, password },
  });
}

/**
 * Register a new user.
 * @param {object} userData - { name, email, password }
 */
export async function register(userData) {
  return apiClient(API_ROUTES.REGISTER, {
    method: 'POST',
    body: userData,
  });
}

/**
 * Log out the current user.
 */
export async function logout() {
  return apiClient(API_ROUTES.LOGOUT, { method: 'POST' });
}
