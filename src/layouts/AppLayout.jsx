import React, { useEffect, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { supabase } from '../lib/supabase';

export default function AppLayout() {
  const { session, role } = useOutletContext();
  const [profileName, setProfileName] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { data } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', session.user.id)
          .single();
        if (data && data.name) {
          setProfileName(data.name);
        } else {
          setProfileName(session.user.user_metadata?.full_name || 'User');
        }
      }
    };
    fetchProfile();
  }, []);

  return (
    <div className="app-container">
      <Sidebar role={role} />
      <main className="main-content">
        <div className="top-nav glass-panel">
          <div className="user-profile">
            <div className="avatar"></div>
            <span>{profileName || 'User'}</span>
          </div>
        </div>
        <div className="content-scroll">
          <Outlet context={{ session, role }} />
        </div>
      </main>
    </div>
  );
}
