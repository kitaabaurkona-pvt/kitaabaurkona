import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Convenience hook to consume AuthContext.
 * @returns {{ user, token, loading, login, register, logout }}
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
