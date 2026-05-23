import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { UploadCloud, File, Image as ImageIcon, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function DocumentUpload() {
  const { session } = useOutletContext();
  const [excelFile, setExcelFile] = useState(null);
  const [supportFiles, setSupportFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [processingMode, setProcessingMode] = useState('8b');

  const handleExcelChange = (e) => {
    if (e.target.files && e.target.files[0]) setExcelFile(e.target.files[0]);
  };

  const handleSupportChange = (e) => {
    if (e.target.files) setSupportFiles((prev) => [...prev, ...Array.from(e.target.files)]);
  };

  const removeSupportFile = (index) => {
    setSupportFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Helper to convert hex string to Uint8Array
  const hexToBytes = (hex) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  };

  // Encrypt file using AES-GCM via browser Web Crypto API
  const encryptFile = async (file, clearKeyHex, ivHex) => {
    const keyBytes = hexToBytes(clearKeyHex);
    const ivBytes = hexToBytes(ivHex);
    
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    
    const fileBuffer = await file.arrayBuffer();
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes,
        tagLength: 128 // 16 bytes tag appended at the end
      },
      cryptoKey,
      fileBuffer
    );
    
    return new Blob([encryptedBuffer], { type: 'application/octet-stream' });
  };

  const handleUpload = async () => {
    if (!excelFile) {
      setMessage('Error: Please provide a Transaction Dump (Excel).');
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      const clientId = session.user.id;

      // 1. Prepare and Upload Transaction Excel Dump
      setMessage('Encrypting and uploading Excel dump...');
      const excelPrepRes = await fetch('http://localhost:3000/api/prepare-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: excelFile.name,
          mimeType: excelFile.type || 'application/octet-stream',
          clientId
        })
      });
      if (!excelPrepRes.ok) {
        const errText = await excelPrepRes.text();
        throw new Error(`Failed to prepare excel upload: ${errText}`);
      }
      const { signedUrl: excelSignedUrl, fileUrl: excelPath, clearKey: excelClearKey, iv: excelIv } = await excelPrepRes.json();

      const encryptedExcelBlob = await encryptFile(excelFile, excelClearKey, excelIv);
      const excelUploadRes = await fetch(excelSignedUrl, {
        method: 'PUT',
        body: encryptedExcelBlob,
        headers: { 'Content-Type': 'application/octet-stream' }
      });
      if (!excelUploadRes.ok) {
        const errText = await excelUploadRes.text();
        throw new Error(`Failed to upload encrypted Excel dump: ${errText}`);
      }

      // 2. Prepare and Upload Supporting Documents
      const supportPaths = [];
      for (let i = 0; i < supportFiles.length; i++) {
        const file = supportFiles[i];
        setMessage(`Encrypting and uploading supporting document [${i + 1}/${supportFiles.length}]: ${file.name}...`);
        
        const filePrepRes = await fetch('http://localhost:3000/api/prepare-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            clientId
          })
        });
        if (!filePrepRes.ok) {
          console.error(`Failed to prepare support file ${file.name}`);
          continue;
        }
        const { signedUrl: fileSignedUrl, fileUrl: filePath, clearKey: fileClearKey, iv: fileIv } = await filePrepRes.json();

        const encryptedFileBlob = await encryptFile(file, fileClearKey, fileIv);
        const fileUploadRes = await fetch(fileSignedUrl, {
          method: 'PUT',
          body: encryptedFileBlob,
          headers: { 'Content-Type': 'application/octet-stream' }
        });
        if (!fileUploadRes.ok) {
          console.error(`Failed to upload encrypted support file ${file.name}`);
          continue;
        }
        supportPaths.push(filePath);
      }

      // 3. Trigger Batch Creation and Secure Processing
      setMessage('Finalizing secure batch creation...');
      const response = await fetch('http://localhost:3000/api/create-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, excelPath, supportPaths, processingMode })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to trigger secure AI processing: ${errText}`);
      }

      setMessage('Success! Files securely encrypted, uploaded, and AI processing has started.');
      setExcelFile(null);
      setSupportFiles([]);
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

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
                <p className="text-muted" style={{ fontSize: '0.75rem' }}>Click to change file</p>
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
          <h3 style={{ marginBottom: '1rem' }}>Supporting Documents (PDF, Images, Excel)</h3>
          <div style={{ position: 'relative', border: '2px dashed var(--border-color)', borderRadius: '12px', padding: '3rem 2rem', textAlign: 'center', cursor: 'pointer', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
            <input
              type="file"
              multiple
              accept=".pdf,image/*,.xlsx,.xls,.xlsm,.xlsb,.csv"
              onChange={handleSupportChange}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
            <div className="flex justify-center gap-4" style={{ marginBottom: '1rem' }}>
              <File size={32} color="var(--primary-color)" />
              <ImageIcon size={32} color="var(--primary-color)" />
            </div>
            <h4 style={{ marginBottom: '0.5rem' }}>Click or drag multiple files here</h4>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Upload invoices, receipts, spreadsheets, and proofs</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '2rem' }}>
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
              <ImageIcon size={20} color="var(--primary-color)" />
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

        {/* AI MODEL SELECTOR */}
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
          disabled={uploading || !excelFile}
          style={{ padding: '1rem', fontSize: '1rem', marginTop: '0.5rem' }}
        >
          {uploading ? 'Uploading securely...' : 'Upload & Start AI Vouching'}
        </button>
      </div>
    </div>
  );
}
