import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import heuristicMap from '../scripts/heuristic_map.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'iq-test.db');
const questionBankPath = path.join(dataDir, 'questionBank.json');
const distDir = path.join(rootDir, 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const isProduction = process.env.NODE_ENV === 'production';

fs.mkdirSync(dataDir, { recursive: true });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/question-images', express.static(path.join(dataDir, 'question-images')));
if (isProduction && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const TEST_DURATION_SECONDS = 25 * 60;
const QUESTION_COUNT = 80;
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'http://localhost:5173';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@neodym.ai';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-jwt-secret';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const EMAIL_FROM = process.env.EMAIL_FROM || 'hello@neodym.ai';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || isProduction;
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

type Category =
  | 'number-sequences'
  | 'pattern-recognition'
  | 'verbal-analogies'
  | 'arithmetic-word-problems'
  | 'logical-reasoning';

type Question = {
  id: string;
  category: Category;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  imageUrl?: string | null;
};

type HeuristicEntry = {
  difficulty: string;
  expected: string;
  signal: string;
};

type CandidateSessionRow = {
  id: string;
  candidate_name: string;
  candidate_email: string;
  token: string;
  test_started_at: string | null;
  expires_at: string;
  consumed_at: string | null;
  completed_at: string | null;
  score: number | null;
  raw_score: number | null;
  tab_switches: number;
  copy_events: number;
  fullscreen_exits: number;
  last_fullscreen_exit_at?: string | null;
  total_fullscreen_away_seconds?: number;
};

function adminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const legacyToken = req.headers['x-admin-token'];
  if (legacyToken === ADMIN_TOKEN) return next();

  const cookie = req.cookies?.admin_session;
  if (!cookie) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(cookie, JWT_SECRET) as { email: string };
    if (payload.email !== ADMIN_EMAIL) throw new Error('bad email');
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidate_sessions (
      id TEXT PRIMARY KEY,
      candidate_name TEXT NOT NULL,
      candidate_email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'created',
      test_started_at TEXT,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      completed_at TEXT,
      score INTEGER,
      raw_score INTEGER,
      percent REAL,
      tab_switches INTEGER NOT NULL DEFAULT 0,
      copy_events INTEGER NOT NULL DEFAULT 0,
      fullscreen_exits INTEGER NOT NULL DEFAULT 0,
      last_fullscreen_exit_at TEXT,
      total_fullscreen_away_seconds INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_questions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      selected_index INTEGER,
      is_correct INTEGER,
      time_spent_ms INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(session_id) REFERENCES candidate_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES candidate_sessions(id)
    );
  `);

  const cols = db.prepare(`PRAGMA table_info(candidate_sessions)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('fullscreen_exits')) {
    db.exec(`ALTER TABLE candidate_sessions ADD COLUMN fullscreen_exits INTEGER NOT NULL DEFAULT 0`);
  }
  if (!names.has('last_fullscreen_exit_at')) {
    db.exec(`ALTER TABLE candidate_sessions ADD COLUMN last_fullscreen_exit_at TEXT`);
  }
  if (!names.has('total_fullscreen_away_seconds')) {
    db.exec(`ALTER TABLE candidate_sessions ADD COLUMN total_fullscreen_away_seconds INTEGER NOT NULL DEFAULT 0`);
  }

  const questionCols = db.prepare(`PRAGMA table_info(session_questions)`).all() as { name: string }[];
  const questionNames = new Set(questionCols.map((c) => c.name));
  if (!questionNames.has('time_spent_ms')) {
    db.exec(`ALTER TABLE session_questions ADD COLUMN time_spent_ms INTEGER NOT NULL DEFAULT 0`);
  }
}

function buildQuestionBank(): Question[] {
  return [];
}

function loadQuestionBank(): Question[] {
  if (!fs.existsSync(questionBankPath)) {
    return buildQuestionBank();
  }
  const parsed = JSON.parse(fs.readFileSync(questionBankPath, 'utf8')) as Question[];
  if (parsed.length > 0) return parsed;
  return buildQuestionBank();
}

const questionBank = loadQuestionBank();
initDb();

function nowIso() {
  return new Date().toISOString();
}

function pickQuestions(): Question[] {
  return questionBank.slice(0, QUESTION_COUNT);
}

function serializePublicQuestion(question: Question) {
  return {
    id: question.id,
    category: question.category,
    prompt: question.prompt,
    options: question.options,
    difficulty: question.difficulty,
    imageUrl: question.imageUrl ?? null,
  };
}

function getSessionByToken(token: string): CandidateSessionRow | undefined {
  return db.prepare('SELECT * FROM candidate_sessions WHERE token = ?').get(token) as CandidateSessionRow | undefined;
}

function getHeuristicEntry(questionId: string): HeuristicEntry | undefined {
  const num = questionId.replace('q-', '');
  return (heuristicMap as Record<string, HeuristicEntry>)[num];
}

function suspiciousFastThresholdMs(entry: HeuristicEntry | undefined): number {
  if (!entry) return 4000;
  if (entry.difficulty === 'hard') return 8000;
  if (entry.difficulty === 'medium-hard') return 10000;
  if (entry.difficulty === 'medium') return 6000;
  return 4000;
}

function buildHeuristicSummary(sessionId: string, remainingSecondsAtSubmit: number) {
  const rows = db.prepare(`SELECT question_id, is_correct, time_spent_ms FROM session_questions WHERE session_id = ?`).all(sessionId) as { question_id: string; is_correct: number | null; time_spent_ms: number }[];
  const suspicious: { questionId: string; difficulty: string; timeSpentMs: number }[] = [];
  let suspicionScore = 0;

  for (const row of rows) {
    if (row.is_correct !== 1) continue;
    const entry = getHeuristicEntry(row.question_id);
    const threshold = suspiciousFastThresholdMs(entry);
    if ((row.time_spent_ms ?? 0) > 0 && row.time_spent_ms < threshold) {
      suspicious.push({ questionId: row.question_id, difficulty: entry?.difficulty || 'unknown', timeSpentMs: row.time_spent_ms });
      if (entry?.difficulty === 'hard') suspicionScore += 3;
      else if (entry?.difficulty === 'medium-hard') suspicionScore += 2;
      else if (entry?.difficulty === 'medium') suspicionScore += 1;
      else suspicionScore += 0.5;
    }
  }

  if (remainingSecondsAtSubmit <= 90) suspicionScore *= 0.7;

  const level = suspicionScore >= 8 ? 'high' : suspicionScore >= 4 ? 'moderate' : 'low';
  return { level, suspicionScore, suspiciousQuestions: suspicious.slice(0, 10) };
}

async function maybeSendInviteEmail(name: string, email: string, link: string) {
  if (!resend) return { sent: false, reason: 'resend-not-configured' };

  await resend.emails.send({
    from: EMAIL_FROM,
    to: [email],
    subject: 'NeoDym Assessment Invitation',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; background: #f3f4f6; padding: 32px 16px;">
        <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #e5e7eb;">
          <p style="font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #6366f1; margin: 0 0 12px;">NeoDym Candidate Assessment</p>
          <h1 style="font-size: 28px; line-height: 1.2; margin: 0 0 16px; color: #111827;">You’re invited to complete the next step in the NeoDym hiring process</h1>
          <p style="margin: 0 0 16px;">Hi ${name},</p>
          <p style="margin: 0 0 16px;">Thank you for your interest in NeoDym. As part of our evaluation process, we ask selected candidates to complete a timed reasoning assessment.</p>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px;"><strong>Assessment details</strong></p>
            <ul style="padding-left: 18px; margin: 0;">
              <li>One attempt only</li>
              <li>25-minute time limit</li>
              <li>No external sources or outside assistance allowed</li>
              <li>Fullscreen is required during the test</li>
              <li>Please use a stable internet connection and complete it in one sitting</li>
            </ul>
          </div>
          <p style="margin: 0 0 24px;">When you’re ready, use the button below to begin:</p>
          <p style="margin: 0 0 28px;">
            <a href="${link}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; font-weight: 600; padding: 14px 22px; border-radius: 10px;">Start Assessment</a>
          </p>
          <p style="margin: 0 0 16px; color: #4b5563;">If you experience any technical issue, you can reply to this email.</p>
          <p style="margin: 0; color: #4b5563;">Best,<br/>NeoDym</p>
        </div>
      </div>
    `,
  });

  return { sent: true };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, publicUrl: PUBLIC_APP_URL, emailConfigured: Boolean(resend) });
});

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (String(email).toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return res.status(401).json({ error: 'Invalid credentials.' });

  const valid = await bcrypt.compare(String(password), await bcrypt.hash(ADMIN_PASSWORD, 10));
  if (!valid && password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid credentials.' });

  const token = jwt.sign({ email: ADMIN_EMAIL }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    domain: COOKIE_DOMAIN,
    path: '/',
  });
  res.json({ ok: true, email: ADMIN_EMAIL });
});

app.post('/api/admin/logout', (_req, res) => {
  res.clearCookie('admin_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    domain: COOKIE_DOMAIN,
    path: '/',
  });
  res.json({ ok: true });
});

app.get('/api/admin/me', adminAuth, (_req, res) => {
  res.json({ email: ADMIN_EMAIL });
});

app.get('/api/admin/summary', adminAuth, (_req, res) => {
  const sessions = db
    .prepare(
      `SELECT candidate_name, candidate_email, status, score, percent, completed_at, tab_switches, copy_events, fullscreen_exits, total_fullscreen_away_seconds, flagged
       FROM candidate_sessions
       ORDER BY COALESCE(score, -1) DESC, completed_at DESC`
    )
    .all();

  res.json({ config: { durationSeconds: TEST_DURATION_SECONDS, questionCount: QUESTION_COUNT }, sessions });
});

app.post('/api/admin/candidates', adminAuth, async (req, res) => {
  const { name, email, expiresInHours = 72, sendEmail = false } = req.body ?? {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

  const id = nanoid();
  const token = nanoid(32);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + Number(expiresInHours) * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO candidate_sessions (id, candidate_name, candidate_email, token, status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'created', ?, ?, ?)`
  ).run(id, name, email, token, expiresAt, createdAt, createdAt);

  const questions = pickQuestions();
  const insertQuestion = db.prepare(`INSERT INTO session_questions (id, session_id, question_id, position) VALUES (?, ?, ?, ?)`);
  const transaction = db.transaction(() => {
    questions.forEach((question, index) => insertQuestion.run(nanoid(), id, question.id, index + 1));
  });
  transaction();

  const publicLink = `${PUBLIC_APP_URL}/test/${token}`;
  let emailResult: { sent: boolean; reason?: string } | null = null;
  if (sendEmail) emailResult = await maybeSendInviteEmail(name, email, publicLink);

  res.json({ id, token, link: publicLink, expiresAt, emailResult });
});

app.get('/api/admin/export', adminAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT candidate_name, candidate_email, status, score, raw_score, percent, tab_switches, copy_events, fullscreen_exits, flagged, completed_at
       FROM candidate_sessions ORDER BY COALESCE(score, -1) DESC, completed_at DESC`
    )
    .all() as Record<string, string | number | null>[];

  const header = Object.keys(rows[0] || {
    candidate_name: '', candidate_email: '', status: '', score: '', raw_score: '', percent: '', tab_switches: '', copy_events: '', fullscreen_exits: '', flagged: '', completed_at: ''
  });
  const csv = [header.join(',')].concat(rows.map((row) => header.map((key) => JSON.stringify(row[key] ?? '')).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="iq-test-results.csv"');
  res.send(csv);
});

app.get('/api/test/:token', (req, res) => {
  const session = getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'Invalid link' });
  if (session.completed_at || session.consumed_at) return res.status(410).json({ error: 'This test link has already been used.' });
  if (new Date(session.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'This test link has expired.' });

  const questionRows = db.prepare(`SELECT question_id, position FROM session_questions WHERE session_id = ? ORDER BY position ASC`).all(session.id) as { question_id: string; position: number }[];
  const questionMap = new Map(questionBank.map((q) => [q.id, q]));
  const questions = questionRows.map((row) => questionMap.get(row.question_id)).filter((q): q is Question => Boolean(q)).map(serializePublicQuestion);

  res.json({
    candidate: { name: session.candidate_name, email: session.candidate_email },
    timerSeconds: TEST_DURATION_SECONDS,
    questionCount: QUESTION_COUNT,
    questions,
    startedAt: session.test_started_at,
    antiCheat: {
      fullscreenRequired: true,
      tabSwitchAutoFlagThreshold: 1,
      fullscreenExitAutoFlagThreshold: 1,
      copyPasteAutoFlagThreshold: 1,
    },
  });
});

app.post('/api/test/:token/start', (req, res) => {
  const session = getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'Invalid link' });
  if (session.completed_at || session.consumed_at) return res.status(410).json({ error: 'This test is no longer available.' });
  if (new Date(session.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'This test link has expired.' });

  if (!session.test_started_at) {
    const startedAt = nowIso();
    db.prepare(`UPDATE candidate_sessions SET status = 'in_progress', test_started_at = ?, updated_at = ? WHERE id = ?`).run(startedAt, startedAt, session.id);
    db.prepare(`INSERT INTO session_events (id, session_id, event_type, payload, created_at) VALUES (?, ?, 'started', ?, ?)`).run(nanoid(), session.id, JSON.stringify({ ua: req.headers['user-agent'] ?? 'unknown', ip: req.ip }), startedAt);
    return res.json({ startedAt, endsAt: new Date(Date.now() + TEST_DURATION_SECONDS * 1000).toISOString() });
  }

  const endsAt = new Date(new Date(session.test_started_at).getTime() + TEST_DURATION_SECONDS * 1000).toISOString();
  res.json({ startedAt: session.test_started_at, endsAt });
});

app.post('/api/test/:token/event', (req, res) => {
  const session = getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'Invalid link' });
  const { type, payload } = req.body ?? {};
  const createdAt = nowIso();
  db.prepare(`INSERT INTO session_events (id, session_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)`).run(nanoid(), session.id, String(type || 'unknown'), JSON.stringify(payload ?? {}), createdAt);

  if (type === 'tab_switch') db.prepare(`UPDATE candidate_sessions SET tab_switches = tab_switches + 1, flagged = 1, updated_at = ? WHERE id = ?`).run(createdAt, session.id);
  if (type === 'copy_attempt' || type === 'paste_attempt' || type === 'right_click') db.prepare(`UPDATE candidate_sessions SET copy_events = copy_events + 1, flagged = 1, updated_at = ? WHERE id = ?`).run(createdAt, session.id);
  if (type === 'fullscreen_exit') {
    db.prepare(`UPDATE candidate_sessions SET fullscreen_exits = fullscreen_exits + 1, last_fullscreen_exit_at = ?, flagged = 1, updated_at = ? WHERE id = ?`).run(createdAt, createdAt, session.id);
  }
  if (type === 'fullscreen_return') {
    const latest = getSessionByToken(req.params.token);
    if (latest?.last_fullscreen_exit_at) {
      const awaySeconds = Math.max(0, Math.round((new Date(createdAt).getTime() - new Date(latest.last_fullscreen_exit_at).getTime()) / 1000));
      db.prepare(`UPDATE candidate_sessions SET total_fullscreen_away_seconds = total_fullscreen_away_seconds + ?, last_fullscreen_exit_at = NULL, updated_at = ? WHERE id = ?`).run(awaySeconds, createdAt, session.id);
    }
  }

  res.json({ ok: true });
});

app.post('/api/test/:token/submit', (req, res) => {
  const session = getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'Invalid link' });
  if (!session.test_started_at) return res.status(400).json({ error: 'Test has not started.' });
  if (session.completed_at || session.consumed_at) return res.status(410).json({ error: 'Test already submitted.' });

  const deadline = new Date(session.test_started_at).getTime() + TEST_DURATION_SECONDS * 1000;
  const answers = (req.body?.answers ?? {}) as Record<string, number>;
  const questionTimes = (req.body?.questionTimes ?? {}) as Record<string, number>;
  const questionRows = db.prepare(`SELECT id, question_id FROM session_questions WHERE session_id = ?`).all(session.id) as { id: string; question_id: string }[];
  const updateQuestion = db.prepare(`UPDATE session_questions SET selected_index = ?, is_correct = ?, time_spent_ms = ? WHERE id = ?`);

  let rawScore = 0;
  const transaction = db.transaction(() => {
    for (const row of questionRows) {
      const question = questionBank.find((entry) => entry.id === row.question_id);
      if (!question) continue;
      const selected = Number.isInteger(answers[row.question_id]) ? answers[row.question_id] : null;
      const isCorrect = selected === question.answerIndex ? 1 : 0;
      const timeSpentMs = Math.max(0, Number(questionTimes[row.question_id] ?? 0));
      if (isCorrect) rawScore += 1;
      updateQuestion.run(selected, isCorrect, timeSpentMs, row.id);
    }
  });
  transaction();

  const score = rawScore;
  const percent = Number(((rawScore / QUESTION_COUNT) * 100).toFixed(1));
  const completedAt = nowIso();
  const consumedAt = completedAt;
  const late = Date.now() > deadline;
  const finalFlagged = late ? 1 : 0;

  let totalFullscreenAwaySeconds = session.total_fullscreen_away_seconds || 0;
  if (session.last_fullscreen_exit_at) {
    totalFullscreenAwaySeconds += Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(session.last_fullscreen_exit_at).getTime()) / 1000));
  }

  db.prepare(
    `UPDATE candidate_sessions SET status = 'completed', score = ?, raw_score = ?, percent = ?, completed_at = ?, consumed_at = ?, total_fullscreen_away_seconds = ?, last_fullscreen_exit_at = NULL, flagged = CASE WHEN flagged = 1 OR ? = 1 THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?`
  ).run(score, rawScore, percent, completedAt, consumedAt, totalFullscreenAwaySeconds, finalFlagged, completedAt, session.id);

  db.prepare(`INSERT INTO session_events (id, session_id, event_type, payload, created_at) VALUES (?, ?, 'submitted', ?, ?)`).run(nanoid(), session.id, JSON.stringify({ late, rawScore, percent, totalFullscreenAwaySeconds }), completedAt);

  const flaggedEvents = db.prepare(`SELECT event_type, created_at, payload FROM session_events WHERE session_id = ? AND event_type IN ('tab_switch', 'copy_attempt', 'paste_attempt', 'right_click', 'fullscreen_exit') ORDER BY created_at ASC`).all(session.id) as { event_type: string; created_at: string; payload: string }[];
  const remainingSecondsAtSubmit = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  const heuristicSummary = buildHeuristicSummary(session.id, remainingSecondsAtSubmit);

  if (resend) {
    const eventLines = flaggedEvents.length
      ? flaggedEvents.map((event) => `<li><strong>${event.event_type}</strong> at ${event.created_at}</li>`).join('')
      : '<li>No flagged events recorded.</li>';
    const heuristicLines = heuristicSummary.suspiciousQuestions.length
      ? heuristicSummary.suspiciousQuestions.map((row) => `<li>${row.questionId} — ${row.difficulty} — ${Math.round(row.timeSpentMs / 1000)}s</li>`).join('')
      : '<li>No unusually fast correct questions detected.</li>';

    void resend.emails.send({
      from: EMAIL_FROM,
      to: [ADMIN_EMAIL],
      subject: `IQ Test completed: ${session.candidate_name} (${percent}%)`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
          <h2>IQ Test completed</h2>
          <p><strong>Candidate:</strong> ${session.candidate_name} (${session.candidate_email})</p>
          <p><strong>Score:</strong> ${score} / ${QUESTION_COUNT} (${percent}%)</p>
          <p><strong>Flagged:</strong> ${Boolean((session.tab_switches || session.copy_events || session.fullscreen_exits || finalFlagged) > 0) ? 'Yes' : 'No'}</p>
          <p><strong>Tab switches:</strong> ${session.tab_switches}</p>
          <p><strong>Copy/paste/right-click count:</strong> ${session.copy_events}</p>
          <p><strong>Fullscreen exits:</strong> ${session.fullscreen_exits}</p>
          <p><strong>Total time outside fullscreen:</strong> ${totalFullscreenAwaySeconds} seconds</p>
          <p><strong>Heuristic review level:</strong> ${heuristicSummary.level}</p>
          <p><strong>Heuristic suspicion score:</strong> ${heuristicSummary.suspicionScore}</p>
          <h3>Flagged events</h3>
          <ul>${eventLines}</ul>
          <h3>Fast correct questions worth review</h3>
          <ul>${heuristicLines}</ul>
        </div>
      `,
    });
  }

  res.json({ score, rawScore, percent, late, flagged: Boolean((session.tab_switches || session.copy_events || session.fullscreen_exits || finalFlagged) > 0), heuristicSummary });
});

if (isProduction && fs.existsSync(indexHtmlPath)) {
  app.get(/^(?!\/api|\/question-images).*/, (_req, res) => {
    res.sendFile(indexHtmlPath);
  });
}

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`IQ Test server running on http://localhost:${port}`);
  console.log(`Public app URL: ${PUBLIC_APP_URL}`);
  console.log(`Admin email: ${ADMIN_EMAIL}`);
  console.log(`Resend configured: ${Boolean(resend)}`);
  console.log(`Production mode: ${isProduction}`);
});
