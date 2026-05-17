import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { UploadCloud, File, Image as ImageIcon, X, Columns } from 'lucide-react';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';

export default function DocumentUpload() {
  const { session } = useOutletContext();
  const [excelFile, setExcelFile] = useState(null);
  const [excelHeaders, setExcelHeaders] = useState([]);
  const [columnMapping, setColumnMapping] = useState({ txnId: '', vendor: '', amount: '' });
  const [supportFiles, setSupportFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [processingMode, setProcessingMode] = useState('8b');

  const handleExcelChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setExcelFile(file);
      setColumnMapping({ txnId: '', vendor: '', amount: '' });

      // Parse headers client-side so user can map columns
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
          if (rows.length > 0) {
            const headers = rows[0].map(h => String(h)).filter(h => h.trim() !== '');
            setExcelHeaders(headers);
          }
        } catch (err) {
          console.error('Failed to parse Excel headers:', err);
          setExcelHeaders([]);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleSupportChange = (e) => {
    if (e.target.files) {
      setSupportFiles((prev) => [...prev, ...Array.from(e.target.files)]);
    }
  };

  const removeSupportFile = (index) => {
    setSupportFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!excelFile) {
      setMessage('Error: Please provide a Transaction Dump (Excel).');
      return;
    }
    if (!columnMapping.txnId || !columnMapping.vendor || !columnMapping.amount) {
      setMessage('Error: Please map all three columns (Transaction ID, Vendor, Amount) before uploading.');
      return;
    }

    setUploading(true);
    setMessage('');

    try {
      const clientId = session.user.id;
      const timestamp = Date.now();

      // Upload Excel
      const excelPath = `${clientId}/${timestamp}_${excelFile.name}`;
      const { error: excelError } = await supabase.storage
        .from('uploads')
        .upload(excelPath, excelFile);
      if (excelError) throw excelError;

      // Upload Support Files
      for (const file of supportFiles) {
        const supportPath = `${clientId}/${timestamp}_${file.name}`;
        const { error: supportError } = await supabase.storage
          .from('uploads')
          .upload(supportPath, file);
        if (supportError) console.error('Error uploading support file:', supportError);
      }

      const supportPaths = supportFiles.map(f => `${clientId}/${timestamp}_${f.name}`);

      const response = await fetch('http://localhost:3000/api/process-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, excelPath, supportPaths, processingMode, columnMapping })
      });

      if (!response.ok) throw new Error('Failed to trigger AI processing');

      setMessage('Success! Files securely uploaded and AI processing has started.');
      setExcelFile(null);
      setExcelHeaders([]);
      setColumnMapping({ txnId: '', vendor: '', amount: '' });
      setSupportFiles([]);
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const selectStyle = {
    width: '100%',
    padding: '0.6rem 0.75rem',
    background: 'var(--bg-color)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    fontSize: '0.875rem',
    marginTop: '0.4rem',
    cursor: 'pointer',
  };

  const mappingComplete = columnMapping.txnId && columnMapping.vendor && columnMapping.amount;

  return (
    <div>
      <div className="page-header">
        <h1>Upload Documents</h1>
        <p>Submit your transaction dump and supporting documents for AI vouching.</p>
      </div>

      {message && (
        <div style={{ padding: '1rem', marginBottom: '1.5rem', borderRadius: '8px', backgroundColor: message.startsWith('Error') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: message.startsWith('Error') ? 'var(--danger-color)' : 'var(--success-color)' }}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* EXCEL UPLOAD */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Transaction Dump (Excel)</h3>
          <div style={{ position: 'relative', border: '2px dashed var(--border-color)', borderRadius: '12px', padding: '3rem 2rem', textAlign: 'center', cursor: 'pointer', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.xlsb,.csv"
              onChange={handleExcelChange}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
            <UploadCloud size={48} color="var(--primary-color)" style={{ margin: '0 auto 1rem auto' }} />
            {excelFile ? (
              <>
                <h4 style={{ marginBottom: '0.25rem', color: 'var(--success-color)' }}>{excelFile.name}</h4>
                <p className="text-muted" style={{ fontSize: '0.75rem' }}>{excelHeaders.length} columns detected · Click to change</p>
              </>
            ) : (
              <>
                <h4 style={{ marginBottom: '0.5rem' }}>Click or drag Excel file here</h4>
                <p className="text-muted" style={{ fontSize: '0.875rem' }}>Maximum file size 50MB</p>
              </>
            )}
          </div>
        </div>

        {/* SUPPORT FILES UPLOAD */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Supporting Documents (Excel, CSV)</h3>
          <div style={{ position: 'relative', border: '2px dashed var(--border-color)', borderRadius: '12px', padding: '3rem 2rem', textAlign: 'center', cursor: 'pointer', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
            <input
              type="file"
              multiple
              accept=".xlsx,.xls,.xlsm,.xlsb,.csv"
              onChange={handleSupportChange}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
            <div className="flex justify-center gap-4" style={{ marginBottom: '1rem' }}>
              <File size={32} color="var(--primary-color)" />
              <ImageIcon size={32} color="var(--primary-color)" />
            </div>
            <h4 style={{ marginBottom: '0.5rem' }}>Click or drag support files here</h4>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Upload ledgers, bank statements, invoices (Excel/CSV)</p>
          </div>
        </div>
      </div>

      {/* COLUMN MAPPING — shown only after Excel is selected */}
      {excelFile && excelHeaders.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="flex items-center gap-3" style={{ marginBottom: '1.25rem' }}>
            <Columns size={20} color="var(--primary-color)" />
            <div>
              <h3 style={{ margin: 0 }}>Map Your Columns</h3>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.8rem' }}>Tell the AI which columns contain transaction ID, vendor, and amount.</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="input-label">Transaction ID Column</label>
              <select
                value={columnMapping.txnId}
                onChange={e => setColumnMapping(m => ({ ...m, txnId: e.target.value }))}
                style={selectStyle}
              >
                <option value="">— Select column —</option>
                {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">Vendor / Party Column</label>
              <select
                value={columnMapping.vendor}
                onChange={e => setColumnMapping(m => ({ ...m, vendor: e.target.value }))}
                style={selectStyle}
              >
                <option value="">— Select column —</option>
                {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">Amount Column</label>
              <select
                value={columnMapping.amount}
                onChange={e => setColumnMapping(m => ({ ...m, amount: e.target.value }))}
                style={selectStyle}
              >
                <option value="">— Select column —</option>
                {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>

          {mappingComplete && (
            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--success-color)' }}>
              ✓ Mapping confirmed — ID: <strong>{columnMapping.txnId}</strong> · Vendor: <strong>{columnMapping.vendor}</strong> · Amount: <strong>{columnMapping.amount}</strong>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Ready to Process</h3>

        {excelFile && (
          <div className="flex items-center justify-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '1rem', backgroundColor: 'var(--bg-color)' }}>
            <div className="flex items-center gap-4">
              <File size={24} color="var(--success-color)" />
              <div>
                <p style={{ fontWeight: 500, margin: 0, color: 'var(--text-primary)' }}>{excelFile.name}</p>
                <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>{(excelFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            <span className="status-badge status-success">Ready</span>
          </div>
        )}

        {supportFiles.map((f, i) => (
          <div key={i} className="flex items-center justify-between" style={{ padding: '0.75rem 1rem', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '0.5rem', backgroundColor: 'var(--bg-color)' }}>
            <div className="flex items-center gap-4">
              <File size={20} color="var(--primary-color)" />
              <p style={{ fontWeight: 500, margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{f.name}</p>
            </div>
            <button onClick={() => removeSupportFile(i)} className="text-muted" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
        ))}

        {!excelFile && supportFiles.length === 0 && (
          <p className="text-muted" style={{ textAlign: 'center', padding: '1rem 0' }}>No files selected yet.</p>
        )}

        {/* AI MODEL SELECTOR TOGGLE */}
        <div style={{ margin: '1.5rem 0', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
          <label className="input-label" style={{ marginBottom: '0.75rem' }}>AI Processing Engine</label>
          <div className="flex gap-4">
            <div
              onClick={() => setProcessingMode('8b')}
              style={{ flex: 1, padding: '1rem', border: '1px solid', borderColor: processingMode === '8b' ? 'var(--primary-color)' : 'var(--border-color)', borderRadius: '8px', cursor: 'pointer', backgroundColor: processingMode === '8b' ? 'rgba(79, 70, 229, 0.05)' : 'transparent', transition: 'all 0.2s' }}
            >
              <h4 style={{ margin: '0 0 0.25rem 0', color: processingMode === '8b' ? 'var(--primary-color)' : 'var(--text-primary)' }}>Turbo Match (8B)</h4>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.75rem' }}>~2–5 seconds. Lightning fast structural matching.</p>
            </div>
            <div
              onClick={() => setProcessingMode('70b')}
              style={{ flex: 1, padding: '1rem', border: '1px solid', borderColor: processingMode === '70b' ? 'var(--primary-color)' : 'var(--border-color)', borderRadius: '8px', cursor: 'pointer', backgroundColor: processingMode === '70b' ? 'rgba(79, 70, 229, 0.05)' : 'transparent', transition: 'all 0.2s' }}
            >
              <h4 style={{ margin: '0 0 0.25rem 0', color: processingMode === '70b' ? 'var(--primary-color)' : 'var(--text-primary)' }}>Deep Audit (70B)</h4>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.75rem' }}>~10–20 seconds. In-depth logical analysis & reasoning.</p>
            </div>
          </div>
        </div>

        <button
          onClick={handleUpload}
          className="btn btn-primary w-full"
          disabled={uploading || !excelFile || !mappingComplete}
          style={{ padding: '1rem', fontSize: '1rem', marginTop: '0.5rem' }}
        >
          {uploading ? 'Uploading securely...' : 'Upload & Start AI Vouching'}
        </button>

        {excelFile && !mappingComplete && (
          <p className="text-muted" style={{ textAlign: 'center', fontSize: '0.8rem', marginTop: '0.75rem' }}>
            ⚠ Please map your columns above before uploading.
          </p>
        )}
      </div>
    </div>
  );
}
