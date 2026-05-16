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

  const handleExcelChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setExcelFile(e.target.files[0]);
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
    
    setUploading(true);
    setMessage('');
    
    try {
      const clientId = session.user.id;
      const timestamp = Date.now();
      
      // Upload Excel
      const excelPath = `${clientId}/${timestamp}_${excelFile.name}`;
      const { data: excelData, error: excelError } = await supabase.storage
        .from('uploads')
        .upload(excelPath, excelFile);
        
      if (excelError) throw excelError;

      // TODO: Create batch record in DB here

      // Upload Support Files
      for (const file of supportFiles) {
        const supportPath = `${clientId}/${timestamp}_${file.name}`;
        const { error: supportError } = await supabase.storage
          .from('uploads')
          .upload(supportPath, file);
          
        if (supportError) console.error("Error uploading support file:", supportError);
      }

      setMessage('Success! Files have been uploaded securely.');
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
              accept=".xlsx,.xls,.csv" 
              onChange={handleExcelChange} 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
            <UploadCloud size={48} color="var(--primary-color)" style={{ margin: '0 auto 1rem auto' }} />
            <h4 style={{ marginBottom: '0.5rem' }}>Click or drag .xlsx file here</h4>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Maximum file size 50MB</p>
          </div>
        </div>

        {/* SUPPORT FILES UPLOAD */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Supporting Documents (PDF, Images)</h3>
          <div style={{ position: 'relative', border: '2px dashed var(--border-color)', borderRadius: '12px', padding: '3rem 2rem', textAlign: 'center', cursor: 'pointer', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
            <input 
              type="file" 
              multiple 
              accept=".pdf,image/*" 
              onChange={handleSupportChange} 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
            <div className="flex justify-center gap-4" style={{ marginBottom: '1rem' }}>
              <File size={32} color="var(--primary-color)" />
              <ImageIcon size={32} color="var(--primary-color)" />
            </div>
            <h4 style={{ marginBottom: '0.5rem' }}>Click or drag multiple files here</h4>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Upload invoices, receipts, and proofs</p>
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
               <div>
                 <p style={{ fontWeight: 500, margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{f.name}</p>
               </div>
             </div>
             <button onClick={() => removeSupportFile(i)} className="text-muted" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
               <X size={16} />
             </button>
          </div>
        ))}
        
        {!excelFile && supportFiles.length === 0 && (
           <p className="text-muted" style={{ textAlign: 'center', padding: '1rem 0' }}>No files selected yet.</p>
        )}

        <button 
          onClick={handleUpload}
          className="btn btn-primary w-full" 
          disabled={uploading || !excelFile}
          style={{ padding: '1rem', fontSize: '1rem', marginTop: '1rem' }}
        >
          {uploading ? 'Uploading securely...' : 'Upload & Start AI Vouching'}
        </button>
      </div>
    </div>
  );
}
