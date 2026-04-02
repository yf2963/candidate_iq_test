import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type Session = {
  candidate_name: string;
  candidate_email: string;
  status: string;
  score: number | null;
  percent: number | null;
  completed_at: string | null;
  tab_switches: number;
  copy_events: number;
  fullscreen_exits: number;
  total_fullscreen_away_seconds?: number;
  flagged: number;
};

export default function AdminPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ['admin-me'],
    queryFn: () => api<{ email: string }>('/admin/me'),
    retry: false,
  });

  useEffect(() => {
    if (me.error) navigate('/login');
  }, [me.error, navigate]);

  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api<{ sessions: Session[]; config: { durationSeconds: number; questionCount: number } }>('/admin/summary'),
    enabled: !!me.data,
  });

  const createMutation = useMutation({
    mutationFn: () => api<{ link: string; emailResult?: { sent: boolean; reason?: string } }>('/admin/candidates', {
      method: 'POST',
      body: JSON.stringify({ name, email, sendEmail }),
    }),
    onSuccess: (data) => {
      setLink(data.link);
      setName('');
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  const logout = useMutation({
    mutationFn: () => api('/admin/logout', { method: 'POST' }),
    onSuccess: () => navigate('/login'),
  });

  if (me.isLoading) return <main className="shell"><section className="card"><p>Loading admin…</p></section></main>;

  return (
    <main className="shell grid">
      <section className="card">
        <div className="toolbar">
          <div>
            <span className="eyebrow">Admin dashboard</span>
            <h1>NeoDym IQ Test</h1>
            <p>Logged in as {me.data?.email}</p>
          </div>
          <button className="button secondary" onClick={() => logout.mutate()}>Logout</button>
        </div>
        <div className="inline-fields">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
        <div className="action-row">
          <label className="checkbox-row">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            <span>Send candidate invite email</span>
          </label>
          <button className="button" onClick={() => createMutation.mutate()} disabled={!name || !email || createMutation.isPending}>
            {createMutation.isPending ? 'Generating…' : 'Generate one-time link'}
          </button>
        </div>
        {createMutation.error && <div className="error">{(createMutation.error as Error).message}</div>}
        {link && <div className="result-block"><strong>Candidate link</strong><code>{link}</code></div>}
      </section>

      <section className="card">
        <h2>Ranked candidates</h2>
        {summary.isLoading && <p>Loading…</p>}
        {summary.error && <p className="error">{(summary.error as Error).message}</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Status</th>
                <th>Score</th>
                <th>Percent</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {summary.data?.sessions.map((session) => (
                <tr key={`${session.candidate_email}-${session.completed_at}-${session.status}`}>
                  <td><strong>{session.candidate_name}</strong><div>{session.candidate_email}</div></td>
                  <td>{session.status}</td>
                  <td>{session.score ?? '—'}</td>
                  <td>{session.percent ?? '—'}</td>
                  <td>{session.flagged ? `tab:${session.tab_switches} copy:${session.copy_events} full:${session.fullscreen_exits} away:${session.total_fullscreen_away_seconds ?? 0}s` : 'clean'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </section>
    </main>
  );
}
