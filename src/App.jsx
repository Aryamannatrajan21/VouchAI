import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useOutletContext } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import AuthPage from './pages/AuthPage';
import LandingPage from './pages/LandingPage';
import ClientDashboard from './pages/ClientDashboard';
import DocumentUpload from './pages/DocumentUpload';
import ClientReports from './pages/ClientReports';
import AuditorDashboard from './pages/AuditorDashboard';
import AdminDashboard from './pages/AdminDashboard';

function RoleRedirect() {
  const { role } = useOutletContext();
  if (role === 'admin') return <Navigate to="admin/dashboard" replace />;
  if (role === 'auditor') return <Navigate to="auditor/dashboard" replace />;
  return <Navigate to="user/dashboard" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<RoleRedirect />} />

            {/* User Routes */}
            <Route element={<ProtectedRoute allowedRoles={['user', 'admin']} />}>
              <Route path="user/dashboard" element={<ClientDashboard />} />
              <Route path="user/upload" element={<DocumentUpload />} />
              <Route path="user/reports" element={<ClientReports />} />
            </Route>

            {/* Auditor Routes */}
            <Route element={<ProtectedRoute allowedRoles={['auditor', 'admin']} />}>
              <Route path="auditor/dashboard" element={<AuditorDashboard />} />
              <Route path="auditor/reports" element={<ClientReports />} />
            </Route>

            {/* Admin Routes */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              <Route path="admin/dashboard" element={<AdminDashboard />} />
              <Route path="admin/users" element={<div><div className="page-header"><h1>User Management</h1></div></div>} />
              <Route path="admin/logs" element={<div><div className="page-header"><h1>System Logs</h1></div></div>} />
            </Route>

            <Route path="*" element={<Navigate to="/app" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
