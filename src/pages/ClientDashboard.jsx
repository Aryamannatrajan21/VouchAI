import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Clock, User, Download, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';

export default function ClientDashboard() {
  const { session } = useOutletContext();
  const [profileName, setProfileName] = useState('');
  const [batches, setBatches] = useState([]);
  const [stats, setStats] = useState({ matched: 0, flagged: 0, processing: 0 });
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });

  useEffect(() => {
    const fetchProfile = async () => {
      if (session?.user?.id) {
        const { data } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', session.user.id)
          .single();
        if (data && data.name) {
          setProfileName(data.name);
        } else {
          setProfileName(session.user.user_metadata?.full_name || session.user.email);
        }
      }
    };
    fetchProfile();
  }, [session]);

  const fetchData = async () => {
    if (!session?.user?.id) return;
    
    // Fetch Batches
    const { data: batchData, error: batchError } = await supabase
      .from('batches')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (batchError) {
      console.error("Batch Error:", batchError);
      setModal({ isOpen: true, type: 'alert', title: 'Error Fetching Batches', message: batchError.message });
    }
    
    if (batchData) setBatches(batchData);

    // Fetch Vouching Results Stats
    const { data: resultsData, error: resultsError } = await supabase
      .from('vouching_results')
      .select('status, batch_id');
      
    if (resultsError) {
      console.error("Results Error:", resultsError);
      setModal({ isOpen: true, type: 'alert', title: 'Error Fetching Results', message: resultsError.message });
    }
      
    if (batchData && resultsData) {
      let matched = 0;
      let flagged = 0;
      let processing = batchData.filter(b => b.status === 'processing').length;
      
      // Filter results for ONLY this user's batches (Supabase RLS should do this anyway, but just to be safe)
      const userBatchIds = batchData.map(b => b.id);
      resultsData.forEach(r => {
        if (userBatchIds.includes(r.batch_id)) {
          if (r.status === 'matched') matched++;
          if (r.status === 'flagged' || r.status === 'mismatched') flagged++;
        }
      });
      
      setStats({ matched, flagged, processing });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // Refresh data every 10 seconds automatically
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [session]);

  const downloadReport = async (batchId, filename) => {
    const { data } = await supabase
      .from('vouching_results')
      .select('txn_id, vendor, amount_dump, amount_doc, confidence, status, auditor_notes')
      .eq('batch_id', batchId);
      
    if (!data || data.length === 0) {
      setModal({ isOpen: true, type: 'alert', title: 'No Results Found', message: "No results found for this batch." });
      return;
    }

    // Build Excel workbook
    const headers = ['Transaction ID', 'Vendor', 'Excel Amount', 'Doc Amount', 'Confidence (%)', 'Status', 'Auditor Notes'];

    const rows = data.map(row => ([
      row.txn_id || '',
      row.vendor || '',
      row.amount_dump || 0,
      row.amount_doc || 0,
      Math.round((row.confidence || 0) * 100),
      (row.status || '').toUpperCase(),
      row.auditor_notes || ''
    ]));

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 16 },  // Transaction ID
      { wch: 35 },  // Vendor
      { wch: 16 },  // Excel Amount
      { wch: 16 },  // Doc Amount
      { wch: 16 },  // Confidence
      { wch: 14 },  // Status
      { wch: 55 },  // Auditor Notes
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Vouching Report');

    const safeFilename = (filename || 'report').replace(/[^a-zA-Z0-9_\- .]/g, '_');
    XLSX.writeFile(workbook, `Vouching_Report_${safeFilename}.xlsx`);
  };

  const deleteBatch = (batchId) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirm Deletion',
      message: 'Are you sure you want to delete this batch and all its results? This action cannot be undone.',
      onConfirm: async () => {
        try {
          const { error } = await supabase
            .from('batches')
            .delete()
            .eq('id', batchId);
            
          if (error) throw error;
          
          // Update state locally
          setBatches(prev => prev.filter(b => b.id !== batchId));
          
          // Re-fetch data to update stats
          fetchData();
        } catch (error) {
          console.error("Delete Error:", error);
          setModal({ isOpen: true, type: 'alert', title: 'Delete Failed', message: "Failed to delete batch: " + error.message });
        }
      }
    });
  };

  return (
    <div>
      <div className="page-header flex justify-between items-center" style={{ marginBottom: '2rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.5rem' }}>Welcome, {profileName || 'User'}</h1>
          <p className="text-muted" style={{ margin: 0 }}>Overview of your data vouching progress.</p>
        </div>
        <div className="flex items-center gap-2" style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '20px' }}>
           <User size={16} className="text-muted"/>
           <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{session?.user?.email}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6" style={{ marginBottom: '2rem' }}>
        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', color: 'var(--success-color)' }}>
            <CheckCircle size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Total Matched</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{stats.matched}</h3>
          </div>
        </div>
        
        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', color: 'var(--danger-color)' }}>
            <AlertTriangle size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Flagged / Mismatched</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{stats.flagged}</h3>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div style={{ padding: '1rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px', color: 'var(--warning-color)' }}>
            <Clock size={28} />
          </div>
          <div>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Processing Batches</p>
            <h3 style={{ fontSize: '1.5rem', margin: 0 }}>{stats.processing}</h3>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0 }}>Recent Uploads</h3>
          <button onClick={fetchData} className="btn btn-outline text-muted" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>Refresh</button>
        </div>
        <div className="table-container">
          {loading ? (
            <p className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>Loading batches...</p>
          ) : batches.length === 0 ? (
             <p className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>No uploads found. Head over to the Upload Documents tab to get started!</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Batch Name</th>
                  <th>Date Uploaded</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(batch => (
                  <tr key={batch.id}>
                    <td>{batch.filename || 'Unknown File'}</td>
                    <td>{new Date(batch.created_at).toLocaleDateString()}</td>
                    <td>
                      {batch.status === 'completed' && <span className="status-badge status-success">Completed</span>}
                      {batch.status === 'processing' && <span className="status-badge status-warning">Processing (AI)</span>}
                      {batch.status === 'failed' && <span className="status-badge status-danger">Failed</span>}
                      {batch.status === 'uploaded' && <span className="status-badge status-warning">Uploaded</span>}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button 
                          className="btn btn-outline text-muted flex items-center gap-2" 
                          disabled={batch.status !== 'completed'}
                          onClick={() => downloadReport(batch.id, batch.filename)}
                        >
                          <Download size={14}/> Download Report
                        </button>
                        <button 
                          className="btn btn-outline text-danger flex items-center gap-2" 
                          onClick={() => deleteBatch(batch.id)}
                          style={{ borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger-color)' }}
                        >
                          <Trash2 size={14}/> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* CUSTOM APP MODAL DIALOG */}
      {modal.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999
        }}>
          <div className="card glass-panel" style={{
            maxWidth: '450px',
            width: '90%',
            padding: '2rem',
            border: '1px solid var(--border-color)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            textAlign: 'center'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: modal.type === 'confirm' ? 'var(--danger-color)' : 'var(--primary-color)', fontSize: '1.25rem' }}>
              {modal.title}
            </h3>
            <p className="text-muted" style={{ marginBottom: '2rem', lineHeight: 1.6, fontSize: '0.95rem' }}>
              {modal.message}
            </p>
            <div className="flex justify-center gap-4">
              {modal.type === 'confirm' && (
                <button 
                  className="btn btn-outline text-muted" 
                  onClick={() => setModal({ ...modal, isOpen: false })}
                  style={{ padding: '0.75rem 1.5rem', minWidth: '100px' }}
                >
                  Cancel
                </button>
              )}
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  if (modal.onConfirm) modal.onConfirm();
                  setModal({ ...modal, isOpen: false });
                }}
                style={{
                  padding: '0.75rem 1.5rem',
                  minWidth: '100px',
                  backgroundColor: modal.type === 'confirm' ? 'var(--danger-color)' : 'var(--primary-color)',
                  borderColor: modal.type === 'confirm' ? 'var(--danger-color)' : 'var(--primary-color)'
                }}
              >
                {modal.type === 'confirm' ? 'Delete' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
