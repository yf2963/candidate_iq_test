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

const TEST_DURATION_SECONDS = 30 * 60;
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

async function maybeSendInviteEmail(name: string, email: string, link: string) {
  if (!resend) return { sent: false, reason: 'resend-not-configured' };

  await resend.emails.send({
    from: EMAIL_FROM,
    to: [email],
    subject: 'Your NeoDym IQ assessment link',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
        <h2>NeoDym Candidate Assessment</h2>
        <p>Hi ${name},</p>
        <p>You have been invited to complete a timed reasoning assessment.</p>
        <p><strong>Rules:</strong> one attempt, 30-minute hard timer, no outside help, no tab switching, no copy/paste.</p>
        <p><a href="${link}">Start your assessment</a></p>
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
      `SELECT candidate_name, candidate_email, status, score, percent, completed_at, tab_switches, copy_events, fullscreen_exits, flagged
       FROM candidate_sessions
       ORDER BY COALESCE(score, -1) DESC, completed_at DESC`
    )
    .all();

  const events = db
    .prepare(
      `SELECT session_id, event_type, payload, created_at FROM session_events ORDER BY created_at DESC LIMIT 200`
    )
    .all();

  res.json({ config: { durationSeconds: TEST_DURATION_SECONDS, questionCount: QUESTION_COUNT }, sessions, events });
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
  if (type === 'fullscreen_exit') db.prepare(`UPDATE candidate_sessions SET fullscreen_exits = fullscreen_exits + 1, flagged = 1, updated_at = ? WHERE id = ?`).run(createdAt, session.id);

  res.json({ ok: true });
});

app.post('/api/test/:token/submit', (req, res) => {
  const session = getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'Invalid link' });
  if (!session.test_started_at) return res.status(400).json({ error: 'Test has not started.' });
  if (session.completed_at || session.consumed_at) return res.status(410).json({ error: 'Test already submitted.' });

  const deadline = new Date(session.test_started_at).getTime() + TEST_DURATION_SECONDS * 1000;
  const answers = (req.body?.answers ?? {}) as Record<string, number>;
  const questionRows = db.prepare(`SELECT id, question_id FROM session_questions WHERE session_id = ?`).all(session.id) as { id: string; question_id: string }[];
  const updateQuestion = db.prepare(`UPDATE session_questions SET selected_index = ?, is_correct = ? WHERE id = ?`);

  let rawScore = 0;
  const transaction = db.transaction(() => {
    for (const row of questionRows) {
      const question = questionBank.find((entry) => entry.id === row.question_id);
      if (!question) continue;
      const selected = Number.isInteger(answers[row.question_id]) ? answers[row.question_id] : null;
      const isCorrect = selected === question.answerIndex ? 1 : 0;
      if (isCorrect) rawScore += 1;
      updateQuestion.run(selected, isCorrect, row.id);
    }
  });
  transaction();

  const score = rawScore;
  const percent = Number(((rawScore / QUESTION_COUNT) * 100).toFixed(1));
  const completedAt = nowIso();
  const consumedAt = completedAt;
  const late = Date.now() > deadline;
  const finalFlagged = late ? 1 : 0;

  db.prepare(
    `UPDATE candidate_sessions SET status = 'completed', score = ?, raw_score = ?, percent = ?, completed_at = ?, consumed_at = ?, flagged = CASE WHEN flagged = 1 OR ? = 1 THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?`
  ).run(score, rawScore, percent, completedAt, consumedAt, finalFlagged, completedAt, session.id);

  db.prepare(`INSERT INTO session_events (id, session_id, event_type, payload, created_at) VALUES (?, ?, 'submitted', ?, ?)`).run(nanoid(), session.id, JSON.stringify({ late, rawScore, percent }), completedAt);
  res.json({ score, rawScore, percent, late, flagged: Boolean((session.tab_switches || session.copy_events || session.fullscreen_exits || finalFlagged) > 0) });
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
