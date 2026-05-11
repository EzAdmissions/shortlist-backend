const fetch = require('node-fetch');
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const PDL_KEY  = process.env.PDL_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const PORT     = process.env.PORT || 3001;

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Shortlist backend running' });
});

// ── PDL Search ───────────────────────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const { school, firm, role, size = 25 } = req.body;

  if (!school || !firm) {
    return res.status(400).json({ error: 'School and firm are required.' });
  }

  const must = [
    { term: { 'education.school.name': school } },
    { term: { 'job_company_name': firm } }
  ];

  if (role) must.push({ term: { 'job_title': role } });

  try {
    const response = await fetch('https://api.peopledatalabs.com/v5/person/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': PDL_KEY
      },
      body: JSON.stringify({
        query: { bool: { must } },
        size,
        pretty: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'PDL error' });
    }

    res.json({ data: data.data || [], total: data.total || 0 });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Groq AI Enrichment ───────────────────────────────────────────────────────
app.post('/api/enrich', async (req, res) => {
  const { name, title, firm, school, location } = req.body;

  const prompt = `You are a finance recruiting assistant. Return ONLY a JSON object, no markdown, no explanation.

Name: ${name}
Title: ${title}
Firm: ${firm}
School: ${school}
Location: ${location}

{"email": "<best guess work email using firm convention e.g. firstname.lastname@gs.com, or 'unknown'>", "insight": "<1-2 sentence insight for a student cold-emailing this person — what they do, a hook, or tip>"}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      })
    });

    const data = await response.json();
    const raw  = data?.choices?.[0]?.message?.content || '';

    let parsed = { email: 'unknown', insight: '—' };
    try {
      const m = raw.match(/\{[\s\S]*?\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch(e) {}

    res.json(parsed);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cold email drafter ───────────────────────────────────────────────────────
app.post('/api/draft-email', async (req, res) => {
  const { senderName, senderSchool, senderYear, recipientName, recipientTitle, recipientFirm } = req.body;

  const prompt = `Write a short, genuine cold outreach email from a student to a finance professional they found through an alumni search.

Student: ${senderName}, ${senderYear} at ${senderSchool}
Recipient: ${recipientName}, ${recipientTitle} at ${recipientFirm}

Rules:
- Max 120 words
- Warm but professional tone
- Mention the shared school connection
- Ask for a 15-minute call
- No fluff, no generic phrases like "I hope this email finds you well"
- Sound like a real student, not a robot

Return only the email body, no subject line, no explanation.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7
      })
    });

    const data = await response.json();
    const email = data?.choices?.[0]?.message?.content || '';
    res.json({ email });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Shortlist backend running on port ${PORT}`);
});