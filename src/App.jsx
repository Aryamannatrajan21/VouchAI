import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import AuthPage from './pages/AuthPage';
import ClientDashboard from './pages/ClientDashboard';
import DocumentUpload from './pages/DocumentUpload';
import ClientReports from './pages/ClientReports';
import AuditorDashboard from './pages/AuditorDashboard';
import AdminDashboard from './pages/AdminDashboard';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        
        <Route path="/" element={<AppLayout />}>
          {/* User Routes - Protected */}
          <Route element={<ProtectedRoute allowedRoles={['user', 'admin']} />}>
            <Route path="user/dashboard" element={<ClientDashboard />} />
            <Route path="user/upload" element={<DocumentUpload />} />
            <Route path="user/reports" element={<ClientReports />} />
          </Route>
          
          {/* Auditor Routes - Protected */}
          <Route element={<ProtectedRoute allowedRoles={['auditor', 'admin']} />}>
            <Route path="auditor/dashboard" element={<AuditorDashboard />} />
            <Route path="auditor/reports" element={<div><div className="page-header"><h1>Auditor Reports</h1></div></div>} />
          </Route>
          
          {/* Admin Routes - Protected */}
          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="admin/dashboard" element={<AdminDashboard />} />
            <Route path="admin/users" element={<div><div className="page-header"><h1>User Management</h1></div></div>} />
          </Route>

          {/* Default Route */}
          <Route path="" element={<Navigate to="/login" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
