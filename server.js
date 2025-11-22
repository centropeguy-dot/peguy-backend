import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());
app.use(express.static("."));

const CLAUDE_KEY = process.env.CLAUDE_KEY; 
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.post("/api/chat", async (req, res) => {
  try {
    const { question } = req.body;

    // Cerca chunks rilevanti per parole chiave
const keywords = question.toLowerCase().split(' ').filter(w => w.length > 3);
let chunks = [];

for (const keyword of keywords.slice(0, 3)) { // Prendi max 3 parole chiave
  const { data } = await supabase
    .from("peguy_chunks")
    .select(`
      chunk_text,
      document_id,
      peguy_documents!inner (title)
    `)
    .ilike('chunk_text', `%${keyword}%`)
    .limit(30);
  
  if (data) chunks.push(...data);
}

// Rimuovi duplicati
chunks = [...new Map(chunks.map(c => [c.chunk_text, c])).values()];

// Se non trova nulla, prendi i primi 100
if (chunks.length === 0) {
  const { data, error } = await supabase
    .from("peguy_chunks")
    .select(`
      chunk_text,
      document_id,
      peguy_documents!inner (title)
    `)
    .limit(100);
  chunks = data || [];
}

    console.log("Chunks trovati:", chunks?.length || 0);

    if (error || !chunks || chunks.length === 0) {
      return res.json({ answer: "Nessun documento trovato." });
    }

    const context = chunks
      .map(
        (c, i) =>
          `[${i + 1}] Da "${c.peguy_documents.title}":\n${c.chunk_text}`,
      )
      .join("\n\n");

    console.log("Chiamo Claude...");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system:
          "Sei un esperto di Charles Péguy. Rispondi SOLO a domande sui suoi testi e opere. Se la domanda non riguarda Péguy, rispondi gentilmente: 'Mi dispiace, posso rispondere solo a domande su Charles Péguy e le sue opere.' Quando citi passaggi dai testi, traducili sempre in italiano se sono in francese. Mantieni il significato originale ma rendi il testo fluido e comprensibile. Aggiungi alla fine della risposta: 'Nota: Le citazioni sono tradotte dal francese originale.' Metti sempre le citazioni tra virgolette.",
        messages: [
          {
            role: "user",
            content: `Testi:\n\n${context}\n\nDomanda: ${question}`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.json({ answer: "Errore: " + data.error.message });
    }

    res.json({ answer: data.content[0].text });
  } catch (error) {
    console.error("Errore:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));
