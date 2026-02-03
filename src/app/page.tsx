'use client';

import { useState, useEffect, useCallback } from 'react';
import { Candidate, ScreeningSession, Tier } from '@/lib/types';
import {
  mockRubric,
  mockIdealPatterns,
  mockCandidates,
  generateMockCandidates,
  sampleJD,
  sampleIntakeNotes,
} from '@/lib/mockData';
import { StepIndicator } from '@/components/StepIndicator';
import { RubricDisplay } from '@/components/RubricDisplay';
import { IdealPatternsDisplay } from '@/components/IdealPatternsDisplay';
import { ScoringProgress } from '@/components/ScoringProgress';
import { ResultsSummary } from '@/components/ResultsSummary';
import { TierSection } from '@/components/TierSection';

const steps = [
  { label: 'Setup', description: 'Configure requirements' },
  { label: 'Calibrate', description: 'Define ideal candidates' },
  { label: 'Score', description: 'AI evaluation' },
  { label: 'Results', description: 'Review & act' },
];

export default function Home() {
  const [session, setSession] = useState<ScreeningSession>({
    jobTitle: 'Senior Machine Learning Engineer',
    jobDescription: sampleJD,
    intakeNotes: sampleIntakeNotes,
    rubric: null,
    idealPatterns: null,
    candidates: [],
    status: 'setup',
  });

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [scoringProgress, setScoringProgress] = useState({ completed: 0, total: 0, current: '' });
  const [showRubric, setShowRubric] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Simulate rubric generation
  const handleGenerateRubric = useCallback(() => {
    setSession((prev) => ({
      ...prev,
      rubric: mockRubric,
      status: 'calibrating',
    }));
    setCurrentStep(2);
  }, []);

  // Simulate pattern extraction
  const handleExtractPatterns = useCallback(() => {
    setSession((prev) => ({
      ...prev,
      idealPatterns: mockIdealPatterns,
    }));
  }, []);

  // Skip calibration
  const handleSkipCalibration = useCallback(() => {
    setCurrentStep(3);
    setSession((prev) => ({ ...prev, status: 'scoring' }));
  }, []);

  // Start scoring
  const handleStartScoring = useCallback(() => {
    setCurrentStep(3);
    setSession((prev) => ({ ...prev, status: 'scoring' }));

    // Simulate scoring with progress
    const candidates = generateMockCandidates(47);
    setScoringProgress({ completed: 0, total: candidates.length, current: candidates[0]?.name || '' });

    let index = 0;
    const interval = setInterval(() => {
      index++;
      if (index >= candidates.length) {
        clearInterval(interval);
        setSession((prev) => ({
          ...prev,
          candidates: candidates.sort((a, b) => b.overallScore - a.overallScore),
          status: 'results',
        }));
        setCurrentStep(4);
      } else {
        setScoringProgress({
          completed: index,
          total: candidates.length,
          current: candidates[index]?.name || '',
        });
      }
    }, 80);
  }, []);

  // Toggle candidate selection
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedCandidates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Select/deselect all in tier
  const handleSelectAll = useCallback((ids: string[]) => {
    setSelectedCandidates((prev) => {
      const next = new Set(prev);
      if (ids.length === 0) {
        // Deselect all
        return new Set();
      }
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  // Handle tier actions
  const handleTierAction = useCallback((action: 'advance' | 'reject', ids: string[]) => {
    const actionText = action === 'advance' ? 'advanced to screen' : 'rejected';
    setActionMessage({
      type: 'success',
      text: `${ids.length} candidate${ids.length === 1 ? '' : 's'} ${actionText} in Greenhouse`,
    });
    setTimeout(() => setActionMessage(null), 3000);
  }, []);

  // Group candidates by tier
  const candidatesByTier = session.candidates.reduce(
    (acc, candidate) => {
      acc[candidate.tier].push(candidate);
      return acc;
    },
    { top: [], strong: [], moderate: [], below: [] } as Record<Tier, Candidate[]>
  );

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <header className="border-b border-border-primary bg-bg-secondary">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center">
                <span className="text-white font-bold text-lg">R</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-text-primary">Rosie</h1>
                <p className="text-xs text-text-muted">AI Resume Screening</p>
              </div>
            </div>
            <StepIndicator currentStep={currentStep} steps={steps} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Action Message Toast */}
        {actionMessage && (
          <div
            className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 ${
              actionMessage.type === 'success'
                ? 'bg-accent-green text-white'
                : 'bg-accent-red text-white'
            }`}
          >
            {actionMessage.text}
          </div>
        )}

        {/* Step 1: Setup */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-text-primary">Setup Requirements</h2>
              <p className="text-text-secondary mt-1">
                Paste your job description and intake notes to generate a scoring rubric.
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Job Description */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">Job Description</label>
                <textarea
                  value={session.jobDescription}
                  onChange={(e) =>
                    setSession((prev) => ({ ...prev, jobDescription: e.target.value }))
                  }
                  className="w-full h-64 p-4 bg-bg-secondary border border-border-primary rounded-lg text-text-primary text-sm resize-none focus:outline-none focus:border-accent-blue"
                  placeholder="Paste the job description..."
                />
              </div>

              {/* Intake Notes */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  Intake Notes{' '}
                  <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <textarea
                  value={session.intakeNotes}
                  onChange={(e) =>
                    setSession((prev) => ({ ...prev, intakeNotes: e.target.value }))
                  }
                  className="w-full h-64 p-4 bg-bg-secondary border border-border-primary rounded-lg text-text-primary text-sm resize-none focus:outline-none focus:border-accent-blue"
                  placeholder="Paste notes from your HM intake call..."
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleGenerateRubric}
                disabled={!session.jobDescription.trim()}
                className="px-6 py-3 bg-accent-blue text-white font-medium rounded-lg hover:bg-accent-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate Scoring Rubric
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Calibration */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-text-primary">Calibrate Scoring</h2>
              <p className="text-text-secondary mt-1">
                Review the AI-generated rubric and optionally upload ideal candidate resumes.
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Generated Rubric */}
              <div className="bg-bg-secondary border border-border-primary rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-text-primary">Scoring Rubric</h3>
                  <button
                    onClick={() => setShowRubric(!showRubric)}
                    className="text-sm text-accent-blue hover:underline"
                  >
                    {showRubric ? 'Hide Details' : 'Show Details'}
                  </button>
                </div>
                {session.rubric && (showRubric ? (
                  <RubricDisplay rubric={session.rubric} />
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-text-secondary">
                      <span className="font-medium text-text-primary">{session.rubric.mustHaves.length}</span> must-have requirements
                    </p>
                    <p className="text-sm text-text-secondary">
                      <span className="font-medium text-text-primary">{session.rubric.niceToHaves.length}</span> nice-to-have requirements
                    </p>
                    <p className="text-sm text-text-secondary">
                      <span className="font-medium text-text-primary">{session.rubric.hiddenPreferences.length}</span> hidden preferences from intake
                    </p>
                    <p className="text-sm text-text-secondary">
                      Target: <span className="font-medium text-text-primary">{session.rubric.seniorityTarget}</span>
                    </p>
                  </div>
                ))}
              </div>

              {/* Ideal Candidates */}
              <div className="bg-bg-secondary border border-border-primary rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-text-primary">
                    Ideal Candidate Patterns{' '}
                    <span className="text-text-muted font-normal">(optional)</span>
                  </h3>
                  {session.idealPatterns && (
                    <button
                      onClick={() => setShowPatterns(!showPatterns)}
                      className="text-sm text-accent-blue hover:underline"
                    >
                      {showPatterns ? 'Hide Details' : 'Show Details'}
                    </button>
                  )}
                </div>

                {session.idealPatterns ? (
                  showPatterns ? (
                    <IdealPatternsDisplay patterns={session.idealPatterns} />
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-text-secondary">
                        Extracted from <span className="font-medium text-text-primary">3 ideal resumes</span>
                      </p>
                      <p className="text-sm text-text-secondary">
                        <span className="font-medium text-text-primary">{session.idealPatterns.commonSkills.length}</span> common skills identified
                      </p>
                      <p className="text-sm text-text-secondary">
                        <span className="font-medium text-text-primary">{session.idealPatterns.careerPatterns.length}</span> career patterns
                      </p>
                    </div>
                  )
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-text-secondary">
                      Upload 2-5 resumes of your best hires in similar roles to teach the AI what
                      &ldquo;good&rdquo; looks like.
                    </p>
                    <button
                      onClick={handleExtractPatterns}
                      className="w-full p-4 border-2 border-dashed border-border-secondary rounded-lg text-text-muted hover:border-accent-blue hover:text-accent-blue transition-colors"
                    >
                      <svg
                        className="w-8 h-8 mx-auto mb-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      Upload Ideal Resumes (Demo: Click to simulate)
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={handleSkipCalibration}
                className="px-6 py-3 text-text-secondary hover:text-text-primary transition-colors"
              >
                Skip Calibration
              </button>
              <button
                onClick={handleStartScoring}
                className="px-6 py-3 bg-accent-blue text-white font-medium rounded-lg hover:bg-accent-blue/90 transition-colors"
              >
                Start Scoring Candidates
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Scoring */}
        {currentStep === 3 && session.status === 'scoring' && (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-text-primary mb-2">Scoring Candidates</h2>
                <p className="text-text-secondary">
                  AI is analyzing resumes against your rubric
                </p>
              </div>
              <ScoringProgress
                total={scoringProgress.total}
                completed={scoringProgress.completed}
                currentCandidate={scoringProgress.current}
              />
            </div>
          </div>
        )}

        {/* Step 4: Results */}
        {currentStep === 4 && (
          <div className="space-y-8">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-text-primary">Screening Results</h2>
                <p className="text-text-secondary mt-1">
                  {session.jobTitle} &bull; {session.candidates.length} candidates scored
                </p>
              </div>
              <button
                className="px-4 py-2 bg-bg-secondary border border-border-primary rounded-lg text-text-secondary hover:text-text-primary transition-colors"
                onClick={() => {
                  setActionMessage({ type: 'success', text: 'Exported to CSV' });
                  setTimeout(() => setActionMessage(null), 3000);
                }}
              >
                Export CSV
              </button>
            </div>

            <ResultsSummary candidates={session.candidates} />

            <div className="space-y-6">
              {(['top', 'strong', 'moderate', 'below'] as Tier[]).map((tier) => (
                <TierSection
                  key={tier}
                  tier={tier}
                  candidates={candidatesByTier[tier]}
                  selectedIds={selectedCandidates}
                  onToggleSelect={handleToggleSelect}
                  onSelectAll={handleSelectAll}
                  onAction={handleTierAction}
                />
              ))}
            </div>

            {/* Start Over */}
            <div className="border-t border-border-primary pt-8 flex justify-center">
              <button
                onClick={() => {
                  setSession({
                    jobTitle: '',
                    jobDescription: '',
                    intakeNotes: '',
                    rubric: null,
                    idealPatterns: null,
                    candidates: [],
                    status: 'setup',
                  });
                  setCurrentStep(1);
                  setSelectedCandidates(new Set());
                }}
                className="text-text-muted hover:text-text-secondary transition-colors"
              >
                Start New Screening Session
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
