import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ShieldCheck, Zap, Eye, ArrowRight, Lock, 
  Sparkles, Coffee, Smile, Frown 
} from 'lucide-react';

export default function LandingPage() {
  const navigate = useNavigate();
  
  // Burnout Calculator state variables
  const [invoiceCount, setInvoiceCount] = useState(500);

  // Dynamic calculations based on invoice count
  const manualHours = Math.round((invoiceCount * 3.5) / 60); // 3.5 mins per manual invoice match
  const vouchAiMins = (invoiceCount * 0.15).toFixed(1); // 9 seconds per invoice matching
  
  const getMentalHealth = () => {
    if (invoiceCount < 100) return { status: 'Relaxed & Calm', emoji: Smile, color: 'var(--success-color)', desc: 'Enjoying extra coffee breaks.' };
    if (invoiceCount < 1000) return { status: 'Highly Stressed', emoji: Coffee, color: 'var(--warning-color)', desc: 'Staring at Excel rows in sleep.' };
    return { status: 'Under Desk Crying', emoji: Frown, color: 'var(--danger-color)', desc: 'Seeking asylum in another career.' };
  };

  const health = getMentalHealth();
  const HealthEmoji = health.emoji;

  return (
    <div style={{
      backgroundColor: '#090d16',
      backgroundImage: 'radial-gradient(circle at 10% 20%, rgba(14, 165, 233, 0.08) 0%, transparent 40%), radial-gradient(circle at 90% 80%, rgba(139, 92, 246, 0.08) 0%, transparent 40%)',
      minHeight: '100vh',
      color: 'var(--text-primary)',
      fontFamily: "'Inter', sans-serif",
      padding: '2rem 1.5rem',
      overflowX: 'hidden'
    }}>
      {/* Brand Header */}
      <header className="flex justify-between items-center" style={{ maxWidth: '1200px', margin: '0 auto 4rem auto', position: 'relative', zIndex: 10 }}>
        <div className="flex items-center gap-3">
          <div style={{
            width: '36px',
            height: '36px',
            background: 'linear-gradient(135deg, var(--primary-color), #8B5CF6)',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px rgba(14, 165, 233, 0.3)'
          }}>
            <ShieldCheck size={20} color="white" />
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.5px', background: 'linear-gradient(to right, #fff, #94A3B8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            VouchAI
          </span>
        </div>
        
        <button 
          onClick={() => navigate('/login')} 
          className="btn btn-primary"
          style={{
            padding: '0.6rem 1.25rem',
            borderRadius: '20px',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(14, 165, 233, 0.25)',
            fontSize: '0.85rem'
          }}
        >
          Sign In to Portal <ArrowRight size={14} />
        </button>
      </header>

      {/* Hero Section */}
      <main style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'inline-flex', items: 'center', gap: '0.5rem', background: 'rgba(14, 165, 233, 0.1)', border: '1px solid rgba(14, 165, 233, 0.2)', padding: '0.4rem 1rem', borderRadius: '9999px', marginBottom: '2rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary-color)' }}>
          <Sparkles size={12} /> Powered by Llama 3.3 70B & PageIndex RAG
        </div>
        
        <h1 style={{
          fontSize: '3.5rem',
          lineHeight: '1.15',
          fontWeight: 800,
          letterSpacing: '-1.5px',
          marginBottom: '1.5rem',
          background: 'linear-gradient(to bottom right, #FFFFFF 30%, #94A3B8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Financial Auditing & Vouching,<br />Reimagined with <span style={{ background: 'linear-gradient(135deg, #0EA5E9, #8B5CF6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Zero-Trust AI</span>.
        </h1>
        
        <p className="text-muted" style={{
          fontSize: '1.15rem',
          maxWidth: '650px',
          margin: '0 auto 3rem auto',
          lineHeight: '1.6',
          fontWeight: 400,
          color: 'var(--text-secondary)'
        }}>
          Welcome to VouchAI – the sleek, secure audit platform that pairs zero‑trust encryption with cutting‑edge AI matching. Streamline your financial reviews with elegance, professionalism, and a hint of fun.
        </p>

        <div className="flex justify-center gap-4" style={{ marginBottom: '6rem' }}>
          <button 
            onClick={() => navigate('/login')} 
            className="btn btn-primary"
            style={{ padding: '0.9rem 2rem', borderRadius: '30px', fontSize: '0.95rem', fontWeight: 600, boxShadow: '0 8px 24px rgba(14, 165, 233, 0.3)' }}
          >
            Launch Secure Audit Portal <ArrowRight size={16} />
          </button>
        </div>

        {/* Brand Core Pillars */}
        <section className="grid gap-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '6rem', textAlign: 'left' }}>
          <div className="card glass-panel flex flex-col" style={{ padding: '2rem', border: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(30, 41, 59, 0.3)' }}>
            <div style={{ width: '42px', height: '42px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '10px', color: 'var(--success-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <ShieldCheck size={24} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Zero-Trust Upload</h3>
            <p className="text-muted" style={{ fontSize: '0.875rem', lineHeight: '1.6', margin: 0 }}>
              Files are encrypted locally in your browser (AES-GCM) and uploaded directly. Our server never sees your documents unencrypted.
            </p>
          </div>

          <div className="card glass-panel flex flex-col" style={{ padding: '2rem', border: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(30, 41, 59, 0.3)' }}>
            <div style={{ width: '42px', height: '42px', background: 'rgba(14, 165, 233, 0.1)', borderRadius: '10px', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <Zap size={24} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>PageIndex matching</h3>
            <p className="text-muted" style={{ fontSize: '0.875rem', lineHeight: '1.6', margin: 0 }}>
              Our proprietary index builds summary structures page-by-page. Pinpoint fuzzy vendor, amount, date, and reference matches instantly.
            </p>
          </div>

          <div className="card glass-panel flex flex-col" style={{ padding: '2rem', border: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(30, 41, 59, 0.3)' }}>
            <div style={{ width: '42px', height: '42px', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '10px', color: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <Eye size={24} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>DataSnipper View</h3>
            <p className="text-muted" style={{ fontSize: '0.875rem', lineHeight: '1.6', margin: 0 }}>
              Compare sheets side-by-side with original decrypted documents. View visual Snips, verify confidence rings, and override matches.
            </p>
          </div>
        </section>

        {/* Auditor Burnout Calculator (The Little Fun Element!) */}
        <section className="glass-panel" style={{
          padding: '3rem 2rem',
          borderRadius: '16px',
          border: '1px solid var(--glass-border)',
          backgroundColor: 'rgba(30, 41, 59, 0.25)',
          maxWidth: '750px',
          margin: '0 auto 6rem auto',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
          textAlign: 'left',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Glowing back orb */}
          <div style={{ position: 'absolute', top: '-50%', right: '-30%', width: '300px', height: '300px', background: 'rgba(139, 92, 246, 0.12)', filter: 'blur(80px)', borderRadius: '50%' }}></div>
          
          <div className="flex flex-col gap-6" style={{ position: 'relative', zIndex: 5 }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                📊 Auditor Mental Health Calculator
              </h2>
              <p className="text-muted" style={{ fontSize: '0.875rem', margin: 0 }}>
                Drag the slider to input your typical transaction volume per audit, and see the dynamic breakdown of manual matching vs. VouchAI's Zero-Trust AI.
              </p>
            </div>
            
            {/* Slider Widget */}
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Supporting Documents Volume:</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-color)' }}>{invoiceCount} invoices/advices</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="5000" 
                value={invoiceCount} 
                onChange={(e) => setInvoiceCount(parseInt(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: 'var(--primary-color)',
                  height: '6px',
                  borderRadius: '3px',
                  background: 'var(--surface-color-light)',
                  cursor: 'pointer'
                }}
              />
              <div className="flex justify-between text-muted" style={{ fontSize: '0.7rem', marginTop: '0.5rem' }}>
                <span>10 (Quick Audit)</span>
                <span>2,500</span>
                <span>5,000 (Bulk Audit)</span>
              </div>
            </div>

            {/* Calculations Grid */}
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)' }}>
                <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem', marginBottom: '0.25rem' }}>Manual Auditing Time</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--danger-color)' }}>{manualHours} hrs</span>
                <p className="text-muted" style={{ fontSize: '0.65rem', margin: '0.25rem 0 0 0' }}>Fuzzy eyeball scroll-matching</p>
              </div>

              <div style={{ background: 'rgba(14, 165, 233, 0.03)', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid rgba(14, 165, 233, 0.1)' }}>
                <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem', marginBottom: '0.25rem' }}>VouchAI Processing</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success-color)' }}>{vouchAiMins} mins</span>
                <p className="text-muted" style={{ fontSize: '0.65rem', margin: '0.25rem 0 0 0' }}>pinpoint RAG compilation</p>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '10px', right: '10px', color: health.color }}>
                  <HealthEmoji size={18} />
                </div>
                <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem', marginBottom: '0.25rem' }}>Auditor Mental Health</span>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: health.color }}>{health.status}</span>
                <p className="text-muted" style={{ fontSize: '0.65rem', margin: '0.25rem 0 0 0' }}>{health.desc}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '2rem', paddingBottom: '2rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <div className="flex justify-between items-center">
            <span>© 2026 VouchAI Auditing Corp. All rights secured.</span>
            <span style={{ display: 'flex', items: 'center', gap: '0.25rem' }}>
              <Lock size={12} /> Paranoid-Grade AES-256 Envelope Encryption Standard
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
