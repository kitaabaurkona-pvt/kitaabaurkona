import { createContext, useState, useEffect, useMemo, useCallback } from 'react';
import { loadSupabase } from '../clients/supabase';
import * as authService from '../services/authService';
import { needsDetails } from '../services/profileService';
import { SITE } from '../utils/release';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  // On the store: true while a signed-in customer has not saved their delivery details,
  // so they are sent to "Your details" once (components/DetailsGate.jsx).
  const [detailsMissing, setDetailsMissing] = useState(false);

  useEffect(() => {
    let active = true;
    let latest = 0;

    async function applySession(session) {
      const current = ++latest;
      const nextUser = session?.user ?? null;
      const [nextRole, missing] = nextUser
        ? await Promise.all([authService.getUserRole(nextUser.id), SITE === 'store' ? needsDetails(nextUser.id) : false])
        : [null, false];
      if (!active || current !== latest) return;
      setUser(nextUser);
      setRole(nextRole);
      setDetailsMissing(missing);
      setLoading(false);
    }

    // The client library arrives a moment after the first screen (clients/supabase.js);
    // until then the visitor is shown as "checking" (loading), as before.
    let subscription = null;
    loadSupabase().then(
      (supabase) => {
        if (!active) return;
        supabase.auth.getSession().then(({ data }) => applySession(data.session));

        // Supabase calls made inside this callback can deadlock the auth lock,
        // so the work is deferred until the callback has returned.
        ({
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          setTimeout(() => applySession(session), 0);
        }));
      },
      () => {
        // The library could not be fetched: carry on signed out rather than waiting forever.
        if (active) setLoading(false);
      },
    );

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Called after the customer saves their details, so the store lets them carry on.
  const refreshDetails = useCallback(async () => {
    if (!user || SITE !== 'store') return;
    setDetailsMissing(await needsDetails(user.id));
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      role,
      loading,
      detailsMissing,
      refreshDetails,
      isAuthenticated: !!user,
      signIn: authService.signIn,
      signUp: authService.signUp,
      signInWithGoogle: authService.signInWithGoogle,
      signOut: authService.signOut,
      signOutEverywhere: authService.signOutEverywhere,
      requestPasswordReset: authService.requestPasswordReset,
      updatePassword: authService.updatePassword,
    }),
    [user, role, loading, detailsMissing, refreshDetails]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
