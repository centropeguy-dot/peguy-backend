import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());
app.use(express.static("."));

const CLAUDE_KEY = process.env.CLAUDE_KEY; 
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const COHERE_API_KEY = process.env.COHERE_API_KEY;  // ← Nuova variabile

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Genera embedding con Cohere
async function generateEmbedding(text) {
  const response = await fetch("https://api.cohere.ai/v1/embed", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COHERE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      texts: [text],
      model: "embed-multilingual-v3.0",
      input_type: "search_query",  // ← Per query, non documenti
      truncate: "END",
    }),
  });

  const data = await response.json();
  
  if (data.message || !data.embeddings) {
    console.error("❌ Errore Cohere:", data);
    throw new Error(data.message || "Errore embedding");
  }
  
  const embedding = data.embeddings[0];
  // Padda a 1536 dimensioni come nel database
  return [...embedding, ...Array(1536 - embedding.length).fill(0)];
}

app.post("/api/chat", async (req, res) => {
  try {
    const { question } = req.body;

    console.log("🔍 Domanda:", question);

    // Genera embedding della domanda
    console.log("⚙️ Generazione embedding...");
    const questionEmbedding = await generateEmbedding(question);

    // Ricerca vettoriale con la funzione SQL
    const { data: chunks, error } = await supabase.rpc('match_chunks', {
      query_embedding: questionEmbedding,
      match_threshold: 0.2,  // Soglia più bassa per trovare più risultati
      match_count: 20        // Top 20 chunks più rilevanti
    });

    console.log("📊 Chunks trovati:", chunks?.length || 0);

    if (error) {
      console.error("❌ Errore ricerca:", error);
      return res.json({ 
        answer: "Si è verificato un errore nella ricerca. Riprova." 
      });
    }

    if (!chunks || chunks.length === 0) {
      return res.json({ 
        answer: "Non ho trovato informazioni rilevanti nei testi di Péguy per questa domanda." 
      });
    }

    // Prepara il contesto per Claude
    const context = chunks
      .map((c, i) => 
        `[${i + 1}] Da "${c.title}":\n${c.chunk_text}`
      )
      .join("\n\n");

    console.log("🤖 Chiamo Claude...");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system:
          "Sei un esperto di Charles Péguy. Rispondi SOLO a domande sui suoi testi e opere. Se la domanda non riguarda Péguy, rispondi gentilmente: 'Mi dispiace, posso rispondere solo a domande su Charles Péguy e le sue opere.' Quando citi passaggi dai testi, usa il formato blockquote Markdown (> prima della citazione) per le citazioni esatte. Non inventare mai citazioni.",
        messages: [
          {
            role: "user",
            content: `Testi rilevanti da Péguy:\n\n${context}\n\nDomanda: ${question}\n\nRispondi basandoti SOLO sui testi forniti sopra. Se l'informazione non è presente, dillo chiaramente.`,
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
    console.error("❌ Errore:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server avviato su porta ${PORT}`));
