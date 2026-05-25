import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { FileText, Download, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function ClientReports() {
  const { session } = useOutletContext();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '' });

  const fetchReports = async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/batches?userId=${session.user.id}&_t=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to fetch reports");
      const data = await res.json();
      
      // Filter only completed batches for the reports screen
      const completed = (data || []).filter(b => b.status === 'completed');
      setReports(completed);
    } catch (err) {
      console.error(err);
      setModal({ isOpen: true, title: 'Error Fetching Reports', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [session]);

  const downloadReport = async (batchId, filename) => {
    try {
      const response = await apiFetch(`/api/batches/${batchId}/results`);
      if (!response.ok) throw new Error("Failed to fetch decrypted results");
      const data = await response.json();
      
      if (!data || data.length === 0) {
        setModal({ isOpen: true, title: 'No Results Found', message: "No audit results found for this report." });
        return;
      }

      const headers = ['Transaction ID', 'Vendor', 'Excel Amount', 'Doc Amount', 'Confidence (%)', 'Status', 'Reference Numbers', 'Evidence Files', 'Parameter Matches', 'Auditor Notes'];
      const rows = data.map(row => ([
        row.txn_id || '',
        row.vendor || '',
        row.amount_dump || 0,
        row.amount_doc || 0,
        Math.round((row.confidence || 0) * 100),
        (row.status || '').toUpperCase(),
        (row.reference_numbers || []).join(', '),
        (row.evidence_files || []).join('; '),
        (row.match_details || []).map(item => `${item.parameter}: ${item.status} (dump=${item.dump_value || ''}; evidence=${item.evidence_value || ''}; source=${item.source_file || ''} ${item.source_section || ''})`).join('\n'),
        row.auditor_notes || ''
      ]));

      const worksheetData = [headers, ...rows];
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
      
      worksheet['!cols'] = [
        { wch: 16 }, { wch: 35 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 45 }, { wch: 80 }, { wch: 55 }
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit Report');
      
      const cleanFilename = (filename || 'Report').replace(/[^a-zA-Z0-9_\- .]/g, '_');
      XLSX.writeFile(workbook, `Vouching_Report_${cleanFilename}.xlsx`);
    } catch (err) {
      setModal({ isOpen: true, title: 'Download Failed', message: err.message });
    }
  };

  return (
    <div>
      <div className="page-header flex justify-between items-center" style={{ marginBottom: '2rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.5rem' }}>Audit Reports</h1>
          <p className="text-muted" style={{ margin: 0 }}>Download decrypted Excel vouching sheets and review audits.</p>
        </div>
        <button onClick={fetchReports} className="btn btn-outline text-muted flex items-center gap-2">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="card">
        {loading ? (
          <p className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>Loading completed reports...</p>
        ) : reports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <FileText size={48} className="text-muted" style={{ margin: '0 auto 1.5rem auto', opacity: 0.5 }} />
            <h3 style={{ marginBottom: '0.5rem' }}>No Completed Reports Available</h3>
            <p className="text-muted" style={{ maxWidth: '400px', margin: '0 auto 1.5rem auto', fontSize: '0.875rem' }}>
              Once your transaction batches are processed by the AI matching engine, they will appear here as downloadable reports.
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Report/Batch Name</th>
                  <th>Date Completed</th>
                  <th>Classification</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(report => (
                  <tr key={report.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div style={{ padding: '0.5rem', background: 'rgba(14, 165, 233, 0.1)', borderRadius: '6px', color: 'var(--primary-color)' }}>
                          <FileText size={18} />
                        </div>
                        <span style={{ fontWeight: 500 }}>{report.filename}</span>
                      </div>
                    </td>
                    <td>{new Date(report.created_at).toLocaleDateString()}</td>
                    <td>
                      <span className="status-badge status-success">Verified Secure</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button 
                          className="btn btn-primary flex items-center gap-2"
                          onClick={() => downloadReport(report.id, report.filename)}
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        >
                          <Download size={14}/> Download Excel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div className="card glass-panel" style={{ maxWidth: '400px', width: '95%', padding: '2rem', textAlign: 'center', margin: 'auto' }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary-color)', marginBottom: '1rem' }}>{modal.title}</h3>
            <p className="text-muted" style={{ marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.6 }}>{modal.message}</p>
            <button className="btn btn-primary" style={{ padding: '0.5rem 2rem' }} onClick={() => setModal({ ...modal, isOpen: false })}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
