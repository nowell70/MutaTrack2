import React, { useEffect, useState } from 'react';
import { Analysis, Variant } from './types';
import {
  getAnalysisById,
  getStoredAnalyses,
  getVariantsForAnalysis,
  saveAnalysis,
  deleteAnalysis,
} from './services/storage';
import { executePipeline } from './services/pipelineRunner';
import { Header } from './components/Header';
import { Sidebar, ViewTab } from './components/Sidebar';
import { LandingView } from './components/LandingView';
import { AuthView } from './components/AuthView';
import { DashboardView } from './components/DashboardView';
import { NewAnalysisView } from './components/NewAnalysisView';
import { HistoryView } from './components/HistoryView';
import { ExampleAnalysisView } from './components/ExampleAnalysisView';
import { ResultsDetailView } from './components/ResultsDetailView';
import { useAuth } from './context/AuthContext';

export const App: React.FC = () => {
  const { user, loading, logout } = useAuth();
  const [currentView, setCurrentView] = useState<ViewTab>('landing');
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);

  const [isExecuting, setIsExecuting] = useState(false);
  const [liveLog, setLiveLog] = useState('');

  // Muat data setiap kali pengguna berganti (login, logout, sesi berakhir).
  // Tanpa login, tidak ada data yang ditampilkan.
  useEffect(() => {
    if (!user) {
      setAnalyses([]);
      setSelectedAnalysis(null);
      setVariants([]);
      return;
    }
    refreshAnalyses();
  }, [user?.id]);

  // Pengaman: tanpa login, halaman dalam aplikasi tidak boleh tampil (mis. sesi berakhir).
  useEffect(() => {
    if (!loading && !user && currentView !== 'landing' && currentView !== 'auth') {
      setCurrentView('auth');
    }
  }, [user, loading, currentView]);

  // Navigasi bergerbang: halaman dalam aplikasi hanya untuk pengguna yang sudah login.
  const goTo = (view: ViewTab) => {
    if (!user && view !== 'landing' && view !== 'auth') {
      setCurrentView('auth');
      return;
    }
    setCurrentView(view);
  };

  const refreshAnalyses = (targetId?: string) => {
    const list = getStoredAnalyses();
    setAnalyses(list);

    let active = null;
    if (targetId) {
      active = list.find((a) => a.id === targetId) || null;
    } else if (selectedAnalysis) {
      active = list.find((a) => a.id === selectedAnalysis.id) || null;
    }
    if (!active && list.length > 0) {
      active = list[0];
    }

    setSelectedAnalysis(active);
    if (active) {
      setVariants(getVariantsForAnalysis(active.id));
    }
  };

  const handleSelectAnalysis = (analysis: Analysis) => {
    setSelectedAnalysis(analysis);
    setVariants(getVariantsForAnalysis(analysis.id));
    goTo('results');
  };

  const handleRunPipeline = async (target: Analysis) => {
    if (isExecuting) return;

    setIsExecuting(true);
    setLiveLog('');

    const runningAnalysis: Analysis = {
      ...target,
      status: 'berjalan',
      stage: 'qc',
      updated_at: new Date().toISOString(),
    };
    saveAnalysis(runningAnalysis);
    setSelectedAnalysis(runningAnalysis);
    refreshAnalyses(runningAnalysis.id);

    try {
      const completed = await executePipeline(runningAnalysis, {
        onStageChange: (stage) => {
          setSelectedAnalysis((prev) => (prev ? { ...prev, stage } : prev));
        },
        onLog: (line) => {
          setLiveLog((prev) => prev + line + '\n');
        },
      });

      setSelectedAnalysis(completed);
      refreshAnalyses(completed.id);
      setVariants(getVariantsForAnalysis(completed.id));
    } catch (err: any) {
      const failed = getAnalysisById(target.id);
      if (failed) {
        setSelectedAnalysis(failed);
        refreshAnalyses(failed.id);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const handleStartNewAnalysis = (newAnalysis: Analysis) => {
    refreshAnalyses(newAnalysis.id);
    setSelectedAnalysis(newAnalysis);
    goTo('results');
    handleRunPipeline(newAnalysis);
  };

  const handleDeleteAnalysis = (id: string) => {
    deleteAnalysis(id);
    fetch(`/api/analyses/${id}`, { method: 'DELETE' }).catch(() => {});
    const updated = getStoredAnalyses();
    setAnalyses(updated);
    if (selectedAnalysis?.id === id) {
      const nextActive = updated[0] || null;
      setSelectedAnalysis(nextActive);
      if (nextActive) {
        setVariants(getVariantsForAnalysis(nextActive.id));
      } else {
        setVariants([]);
      }
    }
  };

  const handleLogout = () => {
    logout();
    goTo('landing');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-slate-500 text-sm flex items-center justify-center">
        Memeriksa sesi login...
      </div>
    );
  }

  const benchmarkAnalysis =
    analyses.find((a) => a.id === 'string' || a.nama === 'string') || analyses[0];

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col">
      {/* 1. If in Landing mode */}
      {currentView === 'landing' && (
        <div className="min-h-screen flex flex-col bg-white">
          <Header
            isLanding={true}
            onGoHome={() => goTo('landing')}
            onOpenLogin={() => goTo(user ? 'dashboard' : 'auth')}
            onNewAnalysis={() => goTo('new-analysis')}
          />
          <main className="flex-1">
            <LandingView
              onNewAnalysis={() => goTo('new-analysis')}
              onOpenExample={() => goTo('example')}
              onSelectRun={(id) => {
                const found = analyses.find((a) => a.id === id);
                if (found) handleSelectAnalysis(found);
              }}
            />
          </main>
        </div>
      )}

      {/* 2. If in Auth mode */}
      {currentView === 'auth' && (
        <AuthView
          onGoHome={() => goTo('landing')}
          onSuccess={() => setCurrentView('dashboard')}
        />
      )}

      {/* 3. In-App Views with Sidebar & Top Bar */}
      {currentView !== 'landing' && currentView !== 'auth' && (
        <div className="min-h-screen flex flex-col bg-white">
          <Header
            isLanding={false}
            onGoHome={() => goTo('landing')}
            onNewAnalysis={() => goTo('new-analysis')}
          />

          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            <Sidebar
              currentView={currentView}
              onSelectView={(v) => goTo(v)}
              onLogout={handleLogout}
              onGoHome={() => goTo('landing')}
            />

            {/* Main Stage View */}
            <main className="flex-1 overflow-y-auto bg-white">
              {currentView === 'dashboard' && (
                <DashboardView
                  analyses={analyses}
                  onNewAnalysis={() => goTo('new-analysis')}
                  onOpenExample={() => goTo('example')}
                  onViewHistory={() => goTo('history')}
                  onSelectAnalysis={handleSelectAnalysis}
                  onDeleteAnalysis={handleDeleteAnalysis}
                  runningAnalysis={isExecuting ? selectedAnalysis : null}
                />
              )}

              {currentView === 'new-analysis' && (
                <NewAnalysisView onStartAnalysis={handleStartNewAnalysis} />
              )}

              {currentView === 'history' && (
                <HistoryView
                  analyses={analyses}
                  onSelectAnalysis={handleSelectAnalysis}
                  onDeleteAnalysis={handleDeleteAnalysis}
                />
              )}

              {currentView === 'example' && benchmarkAnalysis && (
                <ExampleAnalysisView
                  analysis={benchmarkAnalysis}
                  onOpenResults={handleSelectAnalysis}
                />
              )}

              {currentView === 'results' && selectedAnalysis && (
                <ResultsDetailView
                  analysis={selectedAnalysis}
                  variants={variants}
                  onBack={() => goTo('dashboard')}
                  onRerun={handleRunPipeline}
                  isExecuting={isExecuting}
                  liveLog={liveLog}
                />
              )}
            </main>
          </div>
        </div>
      )}
    </div>
  );
};
