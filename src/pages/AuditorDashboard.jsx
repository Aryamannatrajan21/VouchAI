import React from 'react';
import { AlertTriangle, Check, X, Search, MessageSquare } from 'lucide-react';

export default function AuditorDashboard() {
  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1>Auditor Dashboard</h1>
          <p>Review and verify AI flagged discrepancies.</p>
        </div>
        <div className="flex gap-4">
          <select className="input-field" style={{ width: 'auto', backgroundColor: 'var(--surface-color)' }}>
            <option>All Batches</option>
            <option>Q3_Transactions.xlsx</option>
            <option>Oct_Invoices_Dump.xlsx</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
          <h3>Review Queue</h3>
          <div style={{ position: 'relative', width: '250px' }}>
            <Search size={16} style={{ position: 'absolute', top: '10px', left: '10px', color: 'var(--text-muted)' }} />
            <input type="text" className="input-field" placeholder="Search ID or vendor..." style={{ paddingLeft: '2.5rem', paddingTop: '0.5rem', paddingBottom: '0.5rem' }} />
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Txn ID</th>
                <th>Vendor</th>
                <th>Amount (Dump)</th>
                <th>Amount (Doc)</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>TX-1049</td>
                <td>Amazon Web Services</td>
                <td>$4,500.00</td>
                <td>$4,500.00</td>
                <td>99%</td>
                <td><span className="status-badge status-success">Matched</span></td>
                <td>
                  <button className="btn btn-outline text-muted" style={{ padding: '0.25rem 0.5rem' }}>View</button>
                </td>
              </tr>
              <tr style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
                <td>TX-1050</td>
                <td>Salesforce</td>
                <td>$1,200.00</td>
                <td style={{ color: 'var(--danger-color)', fontWeight: 600 }}>$1,500.00</td>
                <td>45%</td>
                <td><span className="status-badge status-danger">Mismatched</span></td>
                <td>
                  <div className="flex gap-2">
                    <button className="btn btn-success" style={{ padding: '0.25rem 0.5rem' }} title="Confirm Match"><Check size={16}/></button>
                    <button className="btn btn-danger" style={{ padding: '0.25rem 0.5rem' }} title="Reject"><X size={16}/></button>
                    <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} title="Request Info"><MessageSquare size={16}/></button>
                  </div>
                </td>
              </tr>
              <tr style={{ backgroundColor: 'rgba(245, 158, 11, 0.05)' }}>
                <td>TX-1051</td>
                <td>Unknown Vendor</td>
                <td>$350.00</td>
                <td style={{ color: 'var(--warning-color)', fontWeight: 600 }}>Not Found</td>
                <td>12%</td>
                <td><span className="status-badge status-warning">Flagged</span></td>
                <td>
                  <div className="flex gap-2">
                    <button className="btn btn-success" style={{ padding: '0.25rem 0.5rem' }} title="Confirm Match"><Check size={16}/></button>
                    <button className="btn btn-danger" style={{ padding: '0.25rem 0.5rem' }} title="Reject"><X size={16}/></button>
                    <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} title="Request Info"><MessageSquare size={16}/></button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
