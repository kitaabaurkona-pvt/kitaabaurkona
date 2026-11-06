import { createContext, useState, useEffect, useMemo } from 'react';
import { supabase } from '../clients/supabase';
import * as authService from '../services/authService';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let latest = 0;

    async function applySession(session) {
      const current = ++latest;
      const nextUser = session?.user ?? null;
      const nextRole = nextUser ? await authService.getUserRole(nextUser.id) : null;
      if (!active || current !== latest) return;
      setUser(nextUser);
      setRole(nextRole);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session));

    // Supabase calls made inside this callback can deadlock the auth lock,
    // so the work is deferred until the callback has returned.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => applySession(session), 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      role,
      loading,
      isAuthenticated: !!user,
      signIn: authService.signIn,
      signUp: authService.signUp,
      signInWithGoogle: authService.signInWithGoogle,
      signOut: authService.signOut,
      requestPasswordReset: authService.requestPasswordReset,
      updatePassword: authService.updatePassword,
    }),
    [user, role, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
