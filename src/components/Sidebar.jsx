import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Upload, FileText, Settings, Users, LogOut, CheckCircle } from 'lucide-react';

export default function Sidebar() {
  const location = useLocation();
  const path = location.pathname;

  // Basic role determination
  const role = path.includes('admin') ? 'admin' : path.includes('auditor') ? 'auditor' : 'user';

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
        <NavLink to="/login" className="nav-link text-muted" onClick={() => {
          // Add logout logic here later
        }}>
          <LogOut size={20} />
          <span>Logout</span>
        </NavLink>
      </div>
    </aside>
  );
}
