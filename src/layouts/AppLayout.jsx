import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

export default function AppLayout() {
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <div className="top-nav glass-panel">
          <div className="user-profile">
            <div className="avatar"></div>
            <span>John Doe</span>
          </div>
        </div>
        <div className="content-scroll">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
