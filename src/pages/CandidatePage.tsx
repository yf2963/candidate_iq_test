import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || '';

type Question = {
  id: string;
  category: string;
  prompt: string;
  options: string[];
  difficulty: number;
  imageUrl?: string | null;
};

export default function CandidatePage() {
  const { token = '' } = useParams();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ score: number; percent: number; flagged: boolean } | null>(null);
  const [fullscreenOk, setFullscreenOk] = useState(false);

  const testQuery = useQuery({
    queryKey: ['test', token],
    queryFn: () => api<{ candidate: { name: string }; timerSeconds: number; questions: Question[]; startedAt: string | null }>(`/test/${token}`),
  });

  const startMutation = useMutation({
    mutationFn: () => api<{ startedAt: string; endsAt: string }>(`/test/${token}/start`, { method: 'POST' }),
    onSuccess: (data) => {
      setStarted(true);
      setTimeLeft(Math.max(0, Math.floor((new Date(data.endsAt).getTime() - Date.now()) / 1000)));
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => api<{ score: number; percent: number; flagged: boolean }>(`/test/${token}/submit`, { method: 'POST', body: JSON.stringify({ answers }) }),
    onSuccess: (data) => { setSubmitted(true); setResult(data); },
  });

  useEffect(() => {
    if (!started || timeLeft === null || submitted) return;
    if (timeLeft <= 0) {
      submitMutation.mutate();
      return;
    }
    const id = window.setTimeout(() => setTimeLeft((current) => (current ?? 1) - 1), 1000);
    return () => window.clearTimeout(id);
  }, [started, timeLeft, submitted, submitMutation]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'tab_switch' }) });
    };
    const handleCopy = (event: ClipboardEvent) => { event.preventDefault(); void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'copy_attempt' }) }); };
    const handlePaste = (event: ClipboardEvent) => { event.preventDefault(); void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'paste_attempt' }) }); };
    const handleContext = (event: MouseEvent) => { event.preventDefault(); void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'right_click' }) }); };
    const handleFullscreen = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreenOk(active);
      if (started && !active) void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'fullscreen_exit' }) });
    };

    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContext);
    document.addEventListener('fullscreenchange', handleFullscreen);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContext);
      document.removeEventListener('fullscreenchange', handleFullscreen);
    };
  }, [token, started]);

  async function requestFullscreenAgain() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setFullscreenOk(true);
    }
  }

  async function beginTest() {
    await requestFullscreenAgain();
    startMutation.mutate();
  }

  const minutes = useMemo(() => {
    if (timeLeft === null) return '--:--';
    const mm = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const ss = (timeLeft % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }, [timeLeft]);

  if (testQuery.isLoading) return <main className="shell"><section className="card"><p>Loading test…</p></section></main>;
  if (testQuery.error) return <main className="shell"><section className="card"><p className="error">{(testQuery.error as Error).message}</p></section></main>;

  if (submitted && result) {
    return <main className="shell"><section className="card"><h1>Test submitted</h1><p>Your responses were recorded.</p><p><strong>Score:</strong> {result.score} / 80 ({result.percent}%)</p></section></main>;
  }

  return (
    <main className="shell candidate-shell">
      <section className="card sticky-header">
        <div>
          <span className="eyebrow">Candidate assessment</span>
          <h1>{testQuery.data?.candidate.name}, begin when ready.</h1>
          <p>One attempt only. Fullscreen is required. Tab switching, copy/paste, and right-click are logged.</p>
        </div>
        <div className="timer">{minutes}</div>
      </section>

      {!started ? (
        <section className="card">
          <ul className="rules-list">
            <li>30-minute hard timer</li>
            <li>One attempt only</li>
            <li>No outside help</li>
            <li>No tab switching, copy/paste, or right-click</li>
            <li>You must stay in fullscreen during the test</li>
          </ul>
          <button className="button" onClick={beginTest} disabled={startMutation.isPending}>
            {startMutation.isPending ? 'Starting…' : 'Enter fullscreen and start test'}
          </button>
        </section>
      ) : (
        <section className="card">
          {!fullscreenOk && <div className="warning">Return to fullscreen immediately. Exits are logged. <button className="button secondary" onClick={requestFullscreenAgain}>Return to fullscreen</button></div>}
          <div className="question-list">
            {testQuery.data?.questions.map((question, index) => (
              <article key={question.id} className="question-card">
                <div className="question-meta"><span>Q{index + 1}</span><span>{question.category}</span></div>
                <h3>{question.prompt}</h3>
                {question.imageUrl && <div className="question-image-wrap"><img className="question-image" src={`${ASSET_BASE}${question.imageUrl}`} alt={`Visual for question ${index + 1}`} /></div>}
                <div className="options">
                  {question.options.map((option, optionIndex) => (
                    <label key={`${question.id}-${optionIndex}`} className={`option ${answers[question.id] === optionIndex ? 'selected' : ''}`}>
                      <input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <button className="button" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>{submitMutation.isPending ? 'Submitting…' : 'Submit test'}</button>
        </section>
      )}
    </main>
  );
}
