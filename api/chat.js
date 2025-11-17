import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non consentito' });
  }

  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Domanda mancante' });
    }

    const questionEmbedding = await generateEmbedding(question);

    const { data: chunks, error: searchError } = await supabase
      .rpc('search_peguy_chunks', {
        query_embedding: questionEmbedding,
        match_threshold: 0.5,
        match_count: 3
      });

    if (searchError || !chunks || chunks.length === 0) {
      return res.status(200).json({
        answer: 'Non ho trovato informazioni rilevanti su questo argomento nei testi di Péguy. Prova a riformulare la domanda.',
        sources: []
      });
    }

    const context = chunks.map((chunk, idx) => 
      `[${idx + 1}] Da "${chunk.document_title}":\n${chunk.chunk_text}`
    ).join('\n\n---\n\n');

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'Sei un esperto di Charles Péguy. Rispondi basandoti SOLO sui testi forniti. Cita sempre i passaggi tra virgolette e indica l\'opera di provenienza. Rispondi in italiano.',
        messages: [{
          role: 'user',
          content: `Testi rilevanti:\n\n${context}\n\n---\n\nDomanda: ${question}`
        }]
      })
    });

    const claudeData = await claudeResponse.json();

    if (claudeData.error) {
      return res.status(500).json({ error: 'Errore nel generare la risposta' });
    }

    return res.status(200).json({
      answer: claudeData.content[0].text,
      sources: chunks.map(c => ({
        title: c.document_title,
        text: c.chunk_text.substring(0, 200) + '...'
      }))
    });

  } catch (error) {
    console.error('Errore:', error);
    return res.status(500).json({ 
      error: 'Errore del server',
      details: error.message 
    });
  }
}

async function generateEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: text,
      model: 'text-embedding-3-small'
    })
  });

  const data = await response.json();
  return data.data[0].embedding;
}
```

4. **"Commit new file"**

---

## 🔄 PASSO 3: Aspetta l'Auto-Deploy

Vercel fa automaticamente il deploy (1-2 minuti).

---

## 🧪 PASSO 4: Testa

Vai su:
```
https://peguy-backend.vercel.app/api/chat
