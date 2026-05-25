import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ProtectedRoute({ allowedRoles }) {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isMounted) return;
      setSession(session);

      if (session) {
        // Fetch user role from profiles table
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single();
        if (!isMounted) return;
        setRole(profile?.role || 'user');
      }
      if (isMounted) setLoading(false);
    };

    fetchSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // We could re-fetch role here if needed, but usually redirect happens
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    // If user is logged in but doesn't have the right role, send to their respective dashboard
    return <Navigate to={`/app/${role}/dashboard`} replace />;
  }

  return <Outlet context={{ session, role }} />;
}
