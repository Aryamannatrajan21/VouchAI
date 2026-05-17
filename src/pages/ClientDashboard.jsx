import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Clock, User, Download } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function ClientDashboard() {
  const { session } = useOutletContext();
  const [profileName, setProfileName] = useState('');
  const [batches, setBatches] = useState([]);
  const [stats, setStats] = useState({ matched: 0, flagged: 0, processing: 0 });
  const [loading, setLoading] = useState(true);

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
      alert("Error fetching batches: " + batchError.message);
    }
    
    if (batchData) setBatches(batchData);

    // Fetch Vouching Results Stats
    const { data: resultsData, error: resultsError } = await supabase
      .from('vouching_results')
      .select('status, batch_id');
      
    if (resultsError) {
      console.error("Results Error:", resultsError);
      alert("Error fetching results: " + resultsError.message);
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
      alert("No results found for this batch.");
      return;
    }

    // Convert to CSV
    const headers = ['Transaction ID', 'Vendor', 'Excel Amount', 'Doc Amount', 'Confidence', 'Status', 'Notes'];
    const csvRows = [headers.join(',')];
    
    data.forEach(row => {
      const values = [
        `"${row.txn_id || ''}"`,
        `"${row.vendor || ''}"`,
        row.amount_dump || 0,
        row.amount_doc || 0,
        row.confidence || 0,
        `"${row.status || ''}"`,
        `"${row.auditor_notes || ''}"`
      ];
      csvRows.push(values.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `Vouching_Report_${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
                      <button 
                        className="btn btn-outline text-muted flex items-center gap-2" 
                        disabled={batch.status !== 'completed'}
                        onClick={() => downloadReport(batch.id, batch.filename)}
                      >
                        <Download size={14}/> Download Report
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
