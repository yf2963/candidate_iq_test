import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [questionTimes, setQuestionTimes] = useState<Record<string, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const activeQuestionRef = useRef<string | null>(null);
  const activeSinceRef = useRef<number | null>(null);

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
    mutationFn: () => {
      flushActiveQuestionTime();
      return api<{ score: number; percent: number; flagged: boolean }>(`/test/${token}/submit`, { method: 'POST', body: JSON.stringify({ answers, questionTimes }) });
    },
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

  function flushActiveQuestionTime() {
    if (!activeQuestionRef.current || activeSinceRef.current === null) return;
    const elapsed = Math.max(0, Date.now() - activeSinceRef.current);
    const questionId = activeQuestionRef.current;
    setQuestionTimes((current) => ({ ...current, [questionId]: (current[questionId] ?? 0) + elapsed }));
    activeSinceRef.current = Date.now();
  }

  function setActiveQuestion(questionId: string) {
    if (activeQuestionRef.current === questionId) return;
    flushActiveQuestionTime();
    activeQuestionRef.current = questionId;
    activeSinceRef.current = Date.now();
  }

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        flushActiveQuestionTime();
        void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'tab_switch' }) });
      }
    };
    const handleCopy = (event: ClipboardEvent) => { event.preventDefault(); void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'copy_attempt' }) }); };
    const handlePaste = (event: ClipboardEvent) => { event.preventDefault(); void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'paste_attempt' }) }); };
    const handleContext = (event: MouseEvent) => { event.preventDefault(); void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'right_click' }) }); };
    const handleFullscreen = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreenOk(active);
      if (started && !active) void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'fullscreen_exit' }) });
      if (started && active) void api(`/test/${token}/event`, { method: 'POST', body: JSON.stringify({ type: 'fullscreen_return' }) });
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
    setCurrentIndex(0);
    startMutation.mutate();
  }

  const questions = testQuery.data?.questions ?? [];
  const currentQuestion = questions[currentIndex] ?? null;
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const isLastQuestion = currentIndex === questions.length - 1;

  const minutes = useMemo(() => {
    if (timeLeft === null) return '--:--';
    const mm = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const ss = (timeLeft % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }, [timeLeft]);

  if (testQuery.isLoading) return <main className="shell"><section className="card"><p>Loading test…</p></section></main>;
  if (testQuery.error) return <main className="shell"><section className="card"><p className="error">{(testQuery.error as Error).message}</p></section></main>;

  if (submitted && result) {
    return <main className="shell"><section className="card"><h1>Assessment submitted</h1><p>Thank you for completing the assessment. Our team will review your submission and be in touch regarding next steps.</p></section></main>;
  }

  function goToNextQuestion() {
    if (!currentQuestion || currentAnswer === undefined) return;
    flushActiveQuestionTime();
    if (isLastQuestion) {
      submitMutation.mutate();
      return;
    }
    setCurrentIndex((index) => Math.min(index + 1, questions.length - 1));
    setActiveQuestion(questions[Math.min(currentIndex + 1, questions.length - 1)]?.id || '');
  }

  return (
    <main className="shell candidate-shell">
      <section className="card sticky-header">
        <div>
          <span className="eyebrow">Candidate assessment</span>
          <h1>{testQuery.data?.candidate.name}, begin when ready.</h1>
          <p>One attempt only. Fullscreen is required. You cannot return to previous questions.</p>
        </div>
        <div className="timer">{minutes}</div>
      </section>

      {!started ? (
        <section className="card">
          <ul className="rules-list">
            <li>25-minute hard timer</li>
            <li>One attempt only</li>
            <li>No external sources or outside assistance</li>
            <li>Fullscreen is required during the test</li>
            <li>You cannot return to a previous question after moving on</li>
          </ul>
          <button className="button" onClick={beginTest} disabled={startMutation.isPending}>
            {startMutation.isPending ? 'Starting…' : 'Enter fullscreen and start test'}
          </button>
        </section>
      ) : (
        <>
          {!fullscreenOk && (
            <div className="floating-warning">
              <span>Return to fullscreen to continue the assessment.</span>
              <button className="button secondary" onClick={requestFullscreenAgain}>Return to fullscreen</button>
            </div>
          )}
        <section className="card">
          {currentQuestion && (
            <>
              <div className="question-progress">Question {currentIndex + 1} of {questions.length}</div>
              <article key={currentQuestion.id} className="question-card">
                <div className="question-meta"><span>Q{currentIndex + 1}</span><span>{currentQuestion.category}</span></div>
                <h3>{currentQuestion.prompt}</h3>
                {currentQuestion.imageUrl && <div className="question-image-wrap"><img className="question-image" src={`${ASSET_BASE}${currentQuestion.imageUrl}`} alt={`Visual for question ${currentIndex + 1}`} /></div>}
                <div className="options">
                  {currentQuestion.options.map((option, optionIndex) => (
                    <label key={`${currentQuestion.id}-${optionIndex}`} className={`option ${answers[currentQuestion.id] === optionIndex ? 'selected' : ''}`} onMouseEnter={() => setActiveQuestion(currentQuestion.id)} onFocus={() => setActiveQuestion(currentQuestion.id)}>
                      <input type="radio" name={currentQuestion.id} checked={answers[currentQuestion.id] === optionIndex} onChange={() => { setActiveQuestion(currentQuestion.id); setAnswers((current) => ({ ...current, [currentQuestion.id]: optionIndex })); }} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </article>
              <div className="action-row">
                <span className="bulk-help">You cannot return to previous questions after moving forward.</span>
                <button className="button" onClick={goToNextQuestion} disabled={currentAnswer === undefined || submitMutation.isPending}>
                  {submitMutation.isPending ? 'Submitting…' : isLastQuestion ? 'Finish and submit' : 'Next question'}
                </button>
              </div>
            </>
          )}
        </section>
        </>
      )}
    </main>
  );
}
