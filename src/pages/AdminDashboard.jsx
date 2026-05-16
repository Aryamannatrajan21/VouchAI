import React from 'react';
import { Users, HardDrive, Cpu, MoreVertical } from 'lucide-react';

export default function AdminDashboard() {
  return (
    <div>
      <div className="page-header">
        <h1>Admin Dashboard</h1>
        <p>System overview and user management.</p>
      </div>

      <div className="grid grid-cols-3 gap-6" style={{ marginBottom: '2rem' }}>
        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(14, 165, 233, 0.1)', borderRadius: '8px', color: 'var(--primary-color)' }}>
            <Users size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Active Users</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>42</h3>
          </div>
        </div>
        
        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '8px', color: '#8B5CF6' }}>
            <HardDrive size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Storage Used</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>14.2 GB</h3>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', color: 'var(--success-color)' }}>
            <Cpu size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>AI API Calls (This Month)</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>8,492</h3>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
          <h3>User Management</h3>
          <button className="btn btn-primary">Invite User</button>
        </div>
        
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Alice Client</td>
                <td>alice@client.com</td>
                <td>Client</td>
                <td><span className="status-badge status-success">Active</span></td>
                <td><button className="btn btn-outline" style={{ border: 'none', padding: '0.25rem' }}><MoreVertical size={16}/></button></td>
              </tr>
              <tr>
                <td>Bob Auditor</td>
                <td>bob@auditfirm.com</td>
                <td>Auditor</td>
                <td><span className="status-badge status-success">Active</span></td>
                <td><button className="btn btn-outline" style={{ border: 'none', padding: '0.25rem' }}><MoreVertical size={16}/></button></td>
              </tr>
              <tr>
                <td>Charlie Admin</td>
                <td>charlie@vouchai.com</td>
                <td>Admin</td>
                <td><span className="status-badge status-success">Active</span></td>
                <td><button className="btn btn-outline" style={{ border: 'none', padding: '0.25rem' }}><MoreVertical size={16}/></button></td>
              </tr>
              <tr>
                <td>David Inactive</td>
                <td>david@client.com</td>
                <td>Client</td>
                <td><span className="status-badge status-neutral">Inactive</span></td>
                <td><button className="btn btn-outline" style={{ border: 'none', padding: '0.25rem' }}><MoreVertical size={16}/></button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
