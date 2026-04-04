import { useEffect, useMemo, useState } from 'react';
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

type InviteResponse = {
  link: string;
  expiresAt: string;
  deadlineLabel: string;
  emailResult?: { sent: boolean; reason?: string };
};

type BulkInviteResponse = {
  createdCount: number;
  sentCount: number;
  candidates: { id: string; name: string; email: string; link: string; expiresAt: string; deadlineLabel: string }[];
};

type BulkPreview = {
  pairs: { name: string; email: string }[];
  errors: string[];
};

function parseBulkFields(namesRaw: string, emailsRaw: string): BulkPreview {
  const splitValues = (value: string) =>
    value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  const names = splitValues(namesRaw);
  const emails = splitValues(emailsRaw).map((email) => email.toLowerCase());
  const errors: string[] = [];

  if (names.length && emails.length && names.length !== emails.length) {
    errors.push(`Name/email count mismatch: ${names.length} names and ${emails.length} emails.`);
  }

  const seenEmails = new Set<string>();
  const pairs = names.slice(0, Math.min(names.length, emails.length)).flatMap((name, index) => {
    const email = emails[index];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Row ${index + 1}: invalid email (${email}).`);
      return [];
    }
    if (seenEmails.has(email)) {
      errors.push(`Row ${index + 1}: duplicate email in this batch (${email}).`);
      return [];
    }
    seenEmails.add(email);
    return [{ name, email }];
  });

  return { pairs, errors };
}

export default function AdminPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [singleDeadlineLabel, setSingleDeadlineLabel] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [bulkNames, setBulkNames] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [bulkResult, setBulkResult] = useState<{ createdCount: number; sentCount: number; deadlineLabel: string } | null>(null);
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

  const bulkPreview = useMemo(() => parseBulkFields(bulkNames, bulkEmails), [bulkNames, bulkEmails]);

  const createMutation = useMutation({
    mutationFn: () => api<InviteResponse>('/admin/candidates', {
      method: 'POST',
      body: JSON.stringify({ name, email, sendEmail }),
    }),
    onSuccess: (data) => {
      setLink(data.link);
      setSingleDeadlineLabel(data.deadlineLabel);
      setName('');
      setEmail('');
      setBulkResult(null);
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  const bulkCreateMutation = useMutation({
    mutationFn: () => api<BulkInviteResponse>('/admin/candidates/bulk', {
      method: 'POST',
      body: JSON.stringify({ names: bulkNames, emails: bulkEmails, sendEmail }),
    }),
    onSuccess: (data) => {
      setBulkResult({ createdCount: data.createdCount, sentCount: data.sentCount, deadlineLabel: data.candidates[0]?.deadlineLabel || '' });
      setBulkNames('');
      setBulkEmails('');
      setLink('');
      setSingleDeadlineLabel('');
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

        <div className="admin-form-grid">
          <div className="admin-form-panel">
            <h2>Single invite</h2>
            <label className="checkbox-row">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              <span>Send candidate invite email</span>
            </label>
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
              <button className="button" onClick={() => createMutation.mutate()} disabled={!name || !email || createMutation.isPending}>
                {createMutation.isPending ? 'Generating…' : 'Generate one-time link'}
              </button>
            </div>
            {createMutation.error && <div className="error">{(createMutation.error as Error).message}</div>}
            {link && <div className="result-block"><strong>Candidate link</strong><code>{link}</code><div>Deadline: {singleDeadlineLabel}</div></div>}
          </div>

          <div className="admin-form-panel">
            <h2>Bulk invite</h2>
            <p className="bulk-help">Paste one per line if you can. Commas also work, but lines are less cursed.</p>
            <div className="bulk-grid">
              <label className="field">
                <span>Names</span>
                <textarea value={bulkNames} onChange={(e) => setBulkNames(e.target.value)} rows={8} placeholder={'Alice Smith\nBob Khan\nCharlie Noor'} />
              </label>
              <label className="field">
                <span>Emails</span>
                <textarea value={bulkEmails} onChange={(e) => setBulkEmails(e.target.value)} rows={8} placeholder={'alice@gmail.com\nbob@gmail.com\ncharlie@gmail.com'} />
              </label>
            </div>
            <div className="action-row">
              <label className="checkbox-row">
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                <span>Send candidate invite email</span>
              </label>
              <button
                className="button"
                onClick={() => bulkCreateMutation.mutate()}
                disabled={!bulkPreview.pairs.length || bulkPreview.errors.length > 0 || bulkCreateMutation.isPending}
              >
                {bulkCreateMutation.isPending ? 'Sending batch…' : `Create ${bulkPreview.pairs.length || ''} candidates`}
              </button>
            </div>
            <div className="bulk-preview">
              <strong>Preview:</strong> {bulkPreview.pairs.length} valid pair{bulkPreview.pairs.length === 1 ? '' : 's'}
              {!!bulkPreview.errors.length && (
                <ul>
                  {bulkPreview.errors.map((error) => <li key={error}>{error}</li>)}
                </ul>
              )}
            </div>
            {bulkCreateMutation.error && <div className="error">{(bulkCreateMutation.error as Error).message}</div>}
            {bulkResult && (
              <div className="result-block">
                <strong>Batch complete</strong>
                <div>Created: {bulkResult.createdCount}</div>
                <div>Emails sent: {bulkResult.sentCount}</div>
                <div>Deadline: {bulkResult.deadlineLabel}</div>
              </div>
            )}
          </div>
        </div>
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
