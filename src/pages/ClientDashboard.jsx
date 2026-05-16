import React from 'react';
import { CheckCircle, AlertTriangle, Clock } from 'lucide-react';

export default function ClientDashboard() {
  return (
    <div>
      <div className="page-header">
        <h1>Client Dashboard</h1>
        <p>Overview of your data vouching progress.</p>
      </div>

      <div className="grid grid-cols-3 gap-6" style={{ marginBottom: '2rem' }}>
        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', color: 'var(--success-color)' }}>
            <CheckCircle size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Total Matched</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>1,245</h3>
          </div>
        </div>
        
        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', color: 'var(--danger-color)' }}>
            <AlertTriangle size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Flagged / Mismatched</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>23</h3>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px', color: 'var(--warning-color)' }}>
            <Clock size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Processing Batches</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>1</h3>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '1.5rem' }}>Recent Uploads</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Batch Name</th>
                <th>Date Uploaded</th>
                <th>Records</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Q3_Transactions.xlsx</td>
                <td>Oct 15, 2023</td>
                <td>850</td>
                <td><span className="status-badge status-success">Completed</span></td>
                <td><button className="btn btn-outline text-muted">Download Report</button></td>
              </tr>
              <tr>
                <td>Oct_Invoices_Dump.xlsx</td>
                <td>Oct 18, 2023</td>
                <td>418</td>
                <td><span className="status-badge status-warning">Processing (AI)</span></td>
                <td><button className="btn btn-outline text-muted" disabled>Pending</button></td>
              </tr>
              <tr>
                <td>Sep_Receipts.zip</td>
                <td>Sep 02, 2023</td>
                <td>120</td>
                <td><span className="status-badge status-success">Completed</span></td>
                <td><button className="btn btn-outline text-muted">Download Report</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
