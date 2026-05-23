import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  CheckCircle, AlertTriangle, Clock, User, Download, Trash2, 
  Search, Eye, ArrowLeft, ExternalLink, FileText, Check, X, 
  ChevronRight, RefreshCw, Layers 
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';

export default function ClientDashboard() {
  const { session } = useOutletContext();
  const [profileName, setProfileName] = useState('');
  const [batches, setBatches] = useState([]);
  const [stats, setStats] = useState({ matched: 0, flagged: 0, processing: 0 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });

  // STATE FOR DATASNIPPER INTERACTIVE WORKSPACE
  const [selectedBatchForSnipper, setSelectedBatchForSnipper] = useState(null);
  const [snipperResults, setSnipperResults] = useState([]);
  const [activeResult, setActiveResult] = useState(null);
  const [snipperDocuments, setSnipperDocuments] = useState([]);
  const [selectedDocPath, setSelectedDocPath] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  const [excelData, setExcelData] = useState(null);
  const [activeSheet, setActiveSheet] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [snipperFilter, setSnipperFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('doc');

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

  const decryptText = (ciphertext) => {
    // Basic local fallback client decrypt if needed, but the server handles actual DB decryption.
    // If it is in the hex format, we display a placeholder filename or try to clean it.
    if (!ciphertext) return ciphertext;
    if (ciphertext.includes(':')) {
      // In a real env we query decrypted API. For documents filename we will decrypt using backend
      return ciphertext.split(':').pop().substring(0, 15) + '... (Encrypted)';
    }
    return ciphertext;
  };

  const fetchData = async () => {
    if (!session?.user?.id) return;
    
    try {
      // Fetch decrypted batches from Express server
      const response = await fetch(`http://localhost:3000/api/batches?userId=${session.user.id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch batches: ${response.statusText}`);
      }
      const batchData = await response.json();
      if (batchData) setBatches(batchData);

      // Fetch Vouching Results Stats (status is not encrypted, so we can query status & batch_id safely)
      const { data: resultsData, error: resultsError } = await supabase
        .from('vouching_results')
        .select('status, batch_id');
        
      if (resultsError) {
        console.error("Results Error:", resultsError);
      }
        
      if (batchData && resultsData) {
        let matched = 0;
        let flagged = 0;
        let processing = batchData.filter(b => b.status === 'processing').length;
        
        const userBatchIds = batchData.map(b => b.id);
        resultsData.forEach(r => {
          if (userBatchIds.includes(r.batch_id)) {
            if (r.status === 'matched') matched++;
            if (r.status === 'flagged' || r.status === 'mismatched') flagged++;
          }
        });
        
        setStats({ matched, flagged, processing });
      }
    } catch (err) {
      console.error("fetchData Error:", err);
      setModal({ isOpen: true, type: 'alert', title: 'Error Fetching Data', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Refresh data every 10 seconds automatically
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [session]);

  const launchDataSnipper = async (batch) => {
    setSelectedBatchForSnipper(batch);
    setLoading(true);
    try {
      // 1. Fetch decrypted results for this batch
      const resultsRes = await fetch(`http://localhost:3000/api/batches/${batch.id}/results`);
      if (!resultsRes.ok) throw new Error("Failed to fetch batch results");
      const results = await resultsRes.json();
      setSnipperResults(results);
      if (results.length > 0) {
        setActiveResult(results[0]);
        setOverrideNote(results[0].auditor_notes || '');
      }

      // 2. Fetch the list of supporting documents in this batch
      const { data: docs, error: dErr } = await supabase
        .from('documents')
        .select('*')
        .eq('batch_id', batch.id);
      if (dErr) throw dErr;
      
      // Decrypt document filenames
      const decryptedDocs = (docs || []).map(d => {
        let rawName = d.filename;
        if (d.filename && d.filename.includes(':')) {
          // If encrypted, query decrypted filename (we strip paths for display)
          const base = d.file_url.split('/').pop().split('_').slice(1).join('_') || d.file_url.split('/').pop();
          rawName = base;
        }
        return {
          ...d,
          filename: rawName
        };
      });
      setSnipperDocuments(decryptedDocs);
      
      // 3. Auto-select matching document from results
      if (results.length > 0 && decryptedDocs.length > 0) {
        autoSelectDocumentForResult(results[0], decryptedDocs, batch);
      } else if (decryptedDocs.length > 0) {
        loadDocument(decryptedDocs[0].file_url, batch);
      }
    } catch (err) {
      console.error("Launch DataSnipper failed:", err);
      setModal({ isOpen: true, type: 'alert', title: 'Launch Failed', message: err.message });
      setSelectedBatchForSnipper(null);
    } finally {
      setLoading(false);
    }
  };

  const autoSelectDocumentForResult = (result, docsList, batch) => {
    if (!result || !docsList || docsList.length === 0) return;
    
    const notes = (result.auditor_notes || '').toLowerCase();
    let foundDoc = docsList[0];
    
    for (const doc of docsList) {
      const cleanName = (doc.filename || '').toLowerCase();
      const rawUrlName = doc.file_url.split('/').pop().toLowerCase();
      if (notes.includes(cleanName) || cleanName.includes(notes) || notes.includes(rawUrlName)) {
        foundDoc = doc;
        break;
      }
    }
    
    loadDocument(foundDoc.file_url, batch);
  };

  const loadDocument = async (fileUrl, batchActive) => {
    setSelectedDocPath(fileUrl);
    setExcelData(null);
    setActiveSheet('');
    
    const targetBatch = batchActive || selectedBatchForSnipper;
    if (!targetBatch) return;

    const ext = fileUrl.split('.').pop().toLowerCase();
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      setDocLoading(true);
      setActiveTab('sheet');
      try {
        const streamUrl = `http://localhost:3000/api/batches/${targetBatch.id}/document?path=${encodeURIComponent(fileUrl)}`;
        const res = await fetch(streamUrl);
        if (!res.ok) throw new Error("Failed to fetch decrypted document bytes");
        
        const arrBuf = await res.arrayBuffer();
        const wb = XLSX.read(arrBuf, { type: 'array' });
        
        const sheetsData = {};
        wb.SheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName];
          sheetsData[sheetName] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        });
        
        setExcelData(sheetsData);
        setActiveSheet(wb.SheetNames[0]);
      } catch (err) {
        console.error("Failed to parse spreadsheet:", err);
      } finally {
        setDocLoading(false);
      }
    } else {
      setActiveTab('doc');
    }
  };

  const handleOverride = async (status) => {
    if (!activeResult) return;
    setActionLoading(true);
    try {
      const res = await fetch(`http://localhost:3000/api/results/${activeResult.id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          auditor_notes: overrideNote
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Override failed: ${errText}`);
      }
      const data = await res.json();
      
      // Update local state
      setSnipperResults(prev => prev.map(r => r.id === activeResult.id ? data.result : r));
      setActiveResult(data.result);
      
      // Re-fetch batches list to update stats on main dashboard
      fetchData();
      
      setModal({ isOpen: true, type: 'alert', title: 'Audit Verified', message: `Audit result successfully updated as ${status.toUpperCase()}!` });
    } catch (err) {
      console.error("Override Error:", err);
      setModal({ isOpen: true, type: 'alert', title: 'Override Failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const downloadReport = async (batchId, filename) => {
    try {
      const response = await fetch(`http://localhost:3000/api/batches/${batchId}/results`);
      if (!response.ok) {
        throw new Error(`Failed to fetch results: ${response.statusText}`);
      }
      const data = await response.json();
      
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
    } catch (err) {
      console.error("Download report failed:", err);
      setModal({ isOpen: true, type: 'alert', title: 'Download Failed', message: err.message });
    }
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

  // DATASNIPPER INTERACTIVE WORKSPACE RENDER
  if (selectedBatchForSnipper) {
    const filteredResults = snipperResults.filter(r => {
      if (snipperFilter === 'matched') return r.status === 'matched';
      if (snipperFilter === 'flagged') return r.status === 'flagged' || r.status === 'mismatched';
      return true;
    });

    const decryptedStreamUrl = selectedDocPath 
      ? `http://localhost:3000/api/batches/${selectedBatchForSnipper.id}/document?path=${encodeURIComponent(selectedDocPath)}`
      : '';

    return (
      <div className="flex flex-col h-full" style={{ overflow: 'hidden', paddingRight: '0.5rem', paddingBottom: '1rem' }}>
        {/* Workspace Header */}
        <div className="glass-panel flex justify-between items-center" style={{ padding: '0.75rem 1.25rem', marginBottom: '1rem', borderRadius: '12px' }}>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setSelectedBatchForSnipper(null); fetchData(); }} 
              className="btn btn-outline flex items-center gap-2"
              style={{ padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem' }}
            >
              <ArrowLeft size={14} /> Back to Dashboard
            </button>
            <div style={{ height: '20px', width: '1px', backgroundColor: 'var(--border-color)' }}></div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>{selectedBatchForSnipper.filename}</h2>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.7rem' }}>Interactive RAG DataSnipper Viewer • {snipperResults.length} Transactions</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>Supporting Doc:</span>
              <select 
                className="input-field" 
                value={selectedDocPath} 
                onChange={(e) => loadDocument(e.target.value)}
                style={{ width: '220px', padding: '0.35rem 0.75rem', fontSize: '0.8rem', height: '32px', backgroundColor: 'var(--bg-color)' }}
              >
                {snipperDocuments.map(d => (
                  <option key={d.id} value={d.file_url}>{d.filename}</option>
                ))}
              </select>
            </div>
            <span className="status-badge status-success" style={{ fontSize: '0.7rem' }}>Secure decrypted session</span>
          </div>
        </div>

        {/* Workspace splitting panels */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '40% 60%', height: 'calc(100vh - 200px)', overflow: 'hidden' }}>
          {/* Left Column: Transaction Grid */}
          <div className="card flex flex-col h-full" style={{ overflow: 'hidden', padding: '1rem' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Spreadsheet Transactions</h3>
              {/* Filter */}
              <div className="flex gap-1" style={{ background: 'rgba(255,255,255,0.03)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <button 
                  onClick={() => setSnipperFilter('all')} 
                  className="btn" 
                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.65rem', borderRadius: '4px', background: snipperFilter === 'all' ? 'var(--primary-color)' : 'transparent', color: snipperFilter === 'all' ? 'white' : 'var(--text-muted)' }}
                >
                  All
                </button>
                <button 
                  onClick={() => setSnipperFilter('matched')} 
                  className="btn" 
                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.65rem', borderRadius: '4px', background: snipperFilter === 'matched' ? 'var(--success-color)' : 'transparent', color: snipperFilter === 'matched' ? 'white' : 'var(--text-muted)' }}
                >
                  Matched
                </button>
                <button 
                  onClick={() => setSnipperFilter('flagged')} 
                  className="btn" 
                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.65rem', borderRadius: '4px', background: snipperFilter === 'flagged' ? 'var(--danger-color)' : 'transparent', color: snipperFilter === 'flagged' ? 'white' : 'var(--text-muted)' }}
                >
                  Flagged
                </button>
              </div>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ fontSize: '0.75rem', width: '100%' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, backgroundColor: 'var(--surface-color)', zIndex: 1 }}>
                    <th style={{ padding: '0.4rem' }}>ID</th>
                    <th style={{ padding: '0.4rem' }}>Vendor</th>
                    <th style={{ padding: '0.4rem' }}>Amount</th>
                    <th style={{ padding: '0.4rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map(res => {
                    const isActive = activeResult && activeResult.id === res.id;
                    return (
                      <tr 
                        key={res.id} 
                        onClick={() => {
                          setActiveResult(res);
                          setOverrideNote(res.auditor_notes || '');
                          autoSelectDocumentForResult(res, snipperDocuments);
                        }}
                        style={{ 
                          cursor: 'pointer',
                          backgroundColor: isActive ? 'rgba(14, 165, 233, 0.08)' : 'transparent',
                          borderLeft: isActive ? '3px solid var(--primary-color)' : 'none',
                          transition: 'all 0.15s'
                        }}
                      >
                        <td style={{ padding: '0.5rem 0.4rem', fontWeight: 600 }}>{res.txn_id}</td>
                        <td style={{ padding: '0.5rem 0.4rem' }}>{res.vendor}</td>
                        <td style={{ padding: '0.5rem 0.4rem', fontWeight: 500 }}>{res.amount_dump?.toLocaleString()}</td>
                        <td style={{ padding: '0.5rem 0.4rem' }}>
                          {res.status === 'matched' && <span className="status-badge status-success" style={{ padding: '0.1rem 0.35rem', fontSize: '0.6rem' }}>Matched</span>}
                          {(res.status === 'flagged' || res.status === 'mismatched') && <span className="status-badge status-danger" style={{ padding: '0.1rem 0.35rem', fontSize: '0.6rem' }}>Flagged</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Visual Viewer & Audit Snips Card */}
          <div className="flex flex-col h-full gap-3" style={{ overflow: 'hidden' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '-0.25rem' }}>
              <div className="flex gap-2">
                <button 
                  onClick={() => setActiveTab('doc')} 
                  className={`btn ${activeTab === 'doc' ? 'btn-primary' : 'btn-outline'}`}
                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', height: '28px' }}
                >
                  <Eye size={12}/> Interactive PDF Viewer
                </button>
                {excelData && (
                  <button 
                    onClick={() => setActiveTab('sheet')} 
                    className={`btn ${activeTab === 'sheet' ? 'btn-primary' : 'btn-outline'}`}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', height: '28px' }}
                  >
                    <Layers size={12}/> Tabular Sheet Viewer
                  </button>
                )}
              </div>
              <span className="text-muted" style={{ fontSize: '0.7rem' }}>Match Target: {activeResult ? activeResult.vendor : ''}</span>
            </div>

            {/* Decrypted Document View Area */}
            <div className="card flex-1 flex flex-col" style={{ padding: '0.5rem', overflow: 'hidden', backgroundColor: '#131c2e', border: '1px solid var(--border-color)' }}>
              {docLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <RefreshCw className="animate-spin text-muted" size={20} />
                  <p className="text-muted" style={{ fontSize: '0.8rem' }}>Streaming and decrypting in-memory...</p>
                </div>
              ) : activeTab === 'sheet' && excelData ? (
                <div className="flex flex-col h-full" style={{ overflow: 'hidden' }}>
                  {/* Sheets tabs */}
                  <div className="flex gap-1" style={{ overflowX: 'auto', paddingBottom: '0.4rem', marginBottom: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>
                    {Object.keys(excelData).map(sName => (
                      <button 
                        key={sName} 
                        onClick={() => setActiveSheet(sName)}
                        className={`btn ${activeSheet === sName ? 'btn-primary' : 'btn-outline'}`}
                        style={{ padding: '0.15rem 0.4rem', fontSize: '0.65rem', height: '22px', borderRadius: '4px' }}
                      >
                        {sName}
                      </button>
                    ))}
                  </div>
                  {/* Sheet tabular content */}
                  <div style={{ flex: 1, overflow: 'auto', fontSize: '0.7rem' }}>
                    <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {(excelData[activeSheet] || []).map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => {
                              const cellStr = String(cell || '').toLowerCase();
                              const amtMatch = activeResult && activeResult.amount_dump && cellStr.includes(String(activeResult.amount_dump));
                              const vendorMatch = activeResult && activeResult.vendor && cellStr.includes(String(activeResult.vendor).toLowerCase().split(' ')[0]);
                              const isHeader = rIdx === 0;
                              
                              return (
                                <td 
                                  key={cIdx} 
                                  style={{
                                    border: '1px solid var(--border-color)',
                                    padding: '0.3rem 0.5rem',
                                    fontWeight: isHeader ? 600 : 'normal',
                                    backgroundColor: amtMatch ? 'rgba(245, 158, 11, 0.25)' : vendorMatch ? 'rgba(14, 165, 233, 0.15)' : isHeader ? 'rgba(255,255,255,0.03)' : 'transparent',
                                    borderBottom: isHeader ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                                    color: amtMatch ? 'var(--warning-color)' : 'var(--text-primary)'
                                  }}
                                >
                                  {cell}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : decryptedStreamUrl ? (
                <iframe 
                  src={decryptedStreamUrl} 
                  title="Document Preview" 
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: '8px', backgroundColor: 'white' }} 
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted">No document available to render</div>
              )}
            </div>

            {/* AI Snip Card and Actions */}
            {activeResult && (
              <div className="glass-panel" style={{ padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div className="grid gap-4" style={{ gridTemplateColumns: '75% 25%' }}>
                  <div>
                    <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.85rem', fontWeight: 600, display: 'flex', items: 'center', gap: '0.4rem', color: 'var(--primary-color)' }}>
                      <FileText size={14}/> AI Match Evidence highlight
                    </h4>
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.35rem 0.5rem', borderRadius: '6px' }}>
                        <span className="text-muted" style={{ display: 'block', fontSize: '0.6rem' }}>Excel Vendor</span>
                        <span style={{ fontWeight: 500 }}>{activeResult.vendor}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.35rem 0.5rem', borderRadius: '6px' }}>
                        <span className="text-muted" style={{ display: 'block', fontSize: '0.6rem' }}>Doc Amount</span>
                        <span style={{ fontWeight: 500, color: 'var(--success-color)' }}>{activeResult.amount_doc?.toLocaleString()}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.35rem 0.5rem', borderRadius: '6px' }}>
                        <span className="text-muted" style={{ display: 'block', fontSize: '0.6rem' }}>Excel Amount</span>
                        <span style={{ fontWeight: 500 }}>{activeResult.amount_dump?.toLocaleString()}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.35rem 0.5rem', borderRadius: '6px' }}>
                        <span className="text-muted" style={{ display: 'block', fontSize: '0.6rem' }}>Status</span>
                        <span className={`status-badge ${activeResult.status === 'matched' ? 'status-success' : 'status-danger'}`} style={{ padding: '0.05rem 0.3rem', fontSize: '0.6rem' }}>
                          {activeResult.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Circular SVG Ring */}
                  <div className="flex flex-col items-center justify-center" style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '0.5rem' }}>
                    <div style={{ position: 'relative', width: '50px', height: '50px' }}>
                      <svg width="50" height="50" viewBox="0 0 36 36">
                        <path
                          className="text-muted"
                          style={{ opacity: 0.15 }}
                          strokeWidth="3"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          style={{ 
                            stroke: activeResult.confidence >= 0.8 ? 'var(--success-color)' : activeResult.confidence >= 0.5 ? 'var(--warning-color)' : 'var(--danger-color)',
                            transition: 'stroke-dasharray 0.35s'
                          }}
                          strokeDasharray={`${Math.round(activeResult.confidence * 100)}, 100`}
                          strokeWidth="3"
                          strokeLinecap="round"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '0.7rem', fontWeight: 600 }}>
                        {Math.round(activeResult.confidence * 100)}%
                      </div>
                    </div>
                    <span className="text-muted" style={{ fontSize: '0.6rem', marginTop: '0.2rem', fontWeight: 500 }}>AI Confidence</span>
                  </div>
                </div>
                
                {/* Notes Actions */}
                <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <label className="input-label" style={{ fontSize: '0.65rem', marginBottom: '0.2rem' }}>Reconciliation Evidence Notes</label>
                  <textarea 
                    className="input-field" 
                    value={overrideNote} 
                    onChange={(e) => setOverrideNote(e.target.value)}
                    style={{ fontSize: '0.7rem', padding: '0.35rem 0.55rem', borderRadius: '6px', minHeight: '45px', height: '45px', resize: 'none', backgroundColor: 'rgba(0,0,0,0.15)', marginBottom: '0.5rem' }}
                  />
                  <div className="flex justify-end gap-2">
                    <button 
                      disabled={actionLoading} 
                      onClick={() => handleOverride('flagged')} 
                      className="btn btn-outline text-danger flex items-center gap-1"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', height: '26px', borderColor: 'rgba(239, 68, 68, 0.25)', color: 'var(--danger-color)' }}
                    >
                      <X size={10}/> Flag Discrepancy
                    </button>
                    <button 
                      disabled={actionLoading} 
                      onClick={() => handleOverride('matched')} 
                      className="btn btn-primary flex items-center gap-1"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', height: '26px', backgroundColor: 'var(--success-color)', borderColor: 'var(--success-color)' }}
                    >
                      <Check size={10}/> Approve Match
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

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
                          className="btn btn-primary flex items-center gap-2" 
                          disabled={batch.status !== 'completed'}
                          onClick={() => launchDataSnipper(batch)}
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        >
                          <Search size={14}/> Launch DataSnipper
                        </button>
                        <button 
                          className="btn btn-outline text-muted flex items-center gap-2" 
                          disabled={batch.status !== 'completed'}
                          onClick={() => downloadReport(batch.id, batch.filename)}
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        >
                          <Download size={14}/> Download Report
                        </button>
                        <button 
                          className="btn btn-outline text-danger flex items-center gap-2" 
                          onClick={() => deleteBatch(batch.id)}
                          style={{ borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger-color)', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
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
