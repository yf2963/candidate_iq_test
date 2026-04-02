import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('hello@neodym.ai');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const login = useMutation({
    mutationFn: () => api('/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    onSuccess: () => navigate('/admin'),
  });

  return (
    <main className="shell auth-shell">
      <section className="card auth-card">
        <span className="eyebrow">Admin login</span>
        <h1>Sign in to the IQ Test dashboard</h1>
        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="button" onClick={() => login.mutate()} disabled={login.isPending}>Login</button>
        {login.error && <div className="error">{(login.error as Error).message}</div>}
      </section>
    </main>
  );
}
