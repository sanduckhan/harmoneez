import { Routes, Route, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { HomePage } from './pages/HomePage';
import { SongPage } from './pages/SongPage';
import { PracticePage } from './pages/PracticePage';

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[var(--bg-deep)]">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[var(--amber)] opacity-[0.02] blur-[100px] pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-4 py-10 space-y-6">
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-end justify-between mb-4"
        >
          <div className="cursor-pointer" onClick={() => navigate('/')}>
            <h1 className="text-3xl tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
              <span className="text-[var(--text-primary)]">Harmon</span>
              <span className="text-[var(--amber)]">eez</span>
            </h1>
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[var(--text-muted)] mt-1">
              Vocal Harmony Generator
            </p>
          </div>
        </motion.header>

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-highlight)] to-transparent" />

        {children}

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent mt-8" />
        <p className="text-center text-[10px] font-mono text-[var(--text-muted)] tracking-wider pb-4">HARMONEEZ v0.5</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/song/:id" element={<SongPage />} />
        <Route path="/song/:id/practice" element={<PracticePage />} />
      </Routes>
    </Layout>
  );
}

export default App;
