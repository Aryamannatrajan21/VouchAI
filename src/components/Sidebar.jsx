import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Upload, FileText, Settings, Users, LogOut, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function Sidebar({ role = 'user' }) {
  const links = {
    user: [
      { to: '/app/user/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
      { to: '/app/user/upload', icon: <Upload size={20} />, label: 'Upload' },
      { to: '/app/user/reports', icon: <FileText size={20} />, label: 'Reports' },
    ],
    auditor: [
      { to: '/app/auditor/dashboard', icon: <CheckCircle size={20} />, label: 'Review Queue' },
      { to: '/app/auditor/reports', icon: <FileText size={20} />, label: 'Reports' },
    ],
    admin: [
      { to: '/app/admin/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
      { to: '/app/admin/users', icon: <Users size={20} />, label: 'User Management' },
      { to: '/app/admin/logs', icon: <Settings size={20} />, label: 'System Logs' },
    ]
  };

  const navLinks = links[role] || links.user;

  return (
    <aside className="sidebar glass-panel">
      <div className="logo-container">
        <div className="logo-icon"></div>
        <h2>VouchAI</h2>
      </div>
      
      <nav className="nav-menu">
        {navLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            {link.icon}
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/login" className="nav-link text-muted" onClick={async () => {
          await supabase.auth.signOut();
        }}>
          <LogOut size={20} />
          <span>Logout</span>
        </NavLink>
      </div>
    </aside>
  );
}
