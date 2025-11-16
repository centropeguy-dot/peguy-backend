// =====================================================
// BACKEND API CHATBOT PÉGUY - api/chat.js
// =====================================================
// Questo file gestisce le richieste del chatbot

import { createClient } from '@supabase/supabase-js';

// Configurazione dalle variabili d'ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// =====================================================
// HANDLER PRINCIPALE
// =====================================================
export default async function handler(req, res) {
  // CORS
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

    console.log('📝 Domanda ricevuta:', question);

    // STEP 1: Genera embedding della domanda
    const questionEmbedding = await generateEmbedding(question);

    // STEP 2: Cerca chunks rilevanti
    const { data: chunks, error: searchError } = await supabase
      .rpc('search_peguy_chunks', {
        query_embedding: questionEmbedding,
        match_threshold: 0.5,
        match_count: 3
      });

    if (searchError) {
      console.error('❌ Errore ricerca:', searchError);
      return res.status(500).json({ error: 'Errore nella ricerca' });
    }

    console.log(`🔍 Trovati ${chunks?.length || 0} chunks rilevanti`);

    if (!chunks || chunks.length === 0) {
      return res.status(200).json({
        answer: 'Non ho trovato informazioni rilevanti su questo argomento nei testi di Péguy. Prova a riformulare la domanda.',
        sources: []
      });
    }

    // STEP 3: Prepara contesto per Claude
    const context = chunks.map((chunk, idx) => 
      `[${idx + 1}] Da "${chunk.document_title}":\n${chunk.chunk_text}`
    ).join('\n\n---\n\n');

    console.log('🤖 Chiamata a Claude...');

    // STEP 4: Chiama Claude
    const startTime = Date.now();
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
        system: `Sei un esperto di Charles Péguy. Rispondi basandoti SOLO sui testi forniti.
Cita sempre i passaggi tra virgolette e indica l'opera di provenienza.
Rispondi in italiano in modo chiaro e accademico ma accessibile.`,
        messages: [{
          role: 'user',
          content: `Testi rilevanti:\n\n${context}\n\n---\n\nDomanda: ${question}`
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    const responseTime = Date.now() - startTime;

    if (claudeData.error) {
      console.error('❌ Errore Claude:', claudeData.error);
      return res.status(500).json({ error: 'Errore nel generare la risposta' });
    }

    const answer = claudeData.content[0].text;
    console.log(`✅ Risposta generata in ${responseTime}ms`);

    // STEP 5: Salva statistiche
    await supabase.from('chat_stats').insert({
      question,
      response_time_ms: responseTime,
      chunks_used: chunks.length
    });

    // STEP 6: Risposta
    return res.status(200).json({
      answer,
      sources: chunks.map(c => ({
        title: c.document_title,
        text: c.chunk_text.substring(0, 200) + '...',
        similarity: Math.round(c.similarity * 100) / 100
      }))
    });

  } catch (error) {
    console.error('❌ Errore generale:', error);
    return res.status(500).json({ 
      error: 'Errore del server',
      details: error.message 
    });
  }
}

// =====================================================
// GENERA EMBEDDING - Usa OpenAI o quello che hai
// =====================================================
async function generateEmbedding(text) {
  try {
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

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('Errore embedding:', error);
    throw error;
  }
}
