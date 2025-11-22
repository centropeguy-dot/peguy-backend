import express from "express";
import { createClient } from "@supabase/supabase-js";
import { pipeline } from "@xenova/transformers";

const app = express();
app.use(express.json());
app.use(express.static("."));

const CLAUDE_KEY = process.env.CLAUDE_KEY; 
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Inizializza il modello per gli embeddings (stesso usato in upload.js)
let embedder = null;

async function initEmbedder() {
  if (!embedder) {
    console.log("📦 Caricamento modello embedding...");
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("✅ Modello pronto!");
  }
  return embedder;
}

async function generateEmbedding(text) {
  try {
    const model = await initEmbedder();
    const output = await model(text, { pooling: "mean", normalize: true });
    const embeddingArray = Array.from(output.data);
    
    // Padda a 1536 dimensioni (come in upload.js)
    const paddedEmbedding = [
      ...embeddingArray,
      ...Array(Math.max(0, 1536 - embeddingArray.length)).fill(0),
    ];
    
    return paddedEmbedding.slice(0, 1536);
  } catch (error) {
    console.error("❌ Errore embedding:", error.message);
    throw error;
  }
}

app.post("/api/chat", async (req, res) => {
  try {
    const { question } = req.body;

    console.log("🔍 Domanda:", question);

    // Genera embedding della domanda
    console.log("⚙️ Generazione embedding...");
    const questionEmbedding = await generateEmbedding(question);

    // Ricerca vettoriale con pgvector (similarità coseno)
    const { data: chunks, error } = await supabase.rpc('match_chunks', {
      query_embedding: questionEmbedding,
      match_threshold: 0.3,  // Soglia di similarità (0-1)
      match_count: 15        // Top 15 risultati più rilevanti
    });

    console.log("📊 Chunks trovati:", chunks?.length || 0);

    if (error) {
      console.error("❌ Errore ricerca:", error);
      // Fallback: prendi chunks casuali se la ricerca vettoriale fallisce
      const { data: fallbackChunks } = await supabase
        .from("peguy_chunks")
        .select(`
          chunk_text,
          peguy_documents!inner (title)
        `)
        .limit(10);
      
      chunks = fallbackChunks || [];
    }

    if (!chunks || chunks.length === 0) {
      return res.json({ 
        answer: "Non ho trovato informazioni rilevanti sui testi di Péguy per rispondere a questa domanda." 
      });
    }

    // Prepara il contesto per Claude
    const context = chunks
      .map((c, i) => 
        `[${i + 1}] Da "${c.title || 'Documento'}":\n${c.chunk_text}`
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
        max_tokens: 1024,
        system:
          "Sei un esperto di Charles Péguy. Rispondi SOLO a domande sui suoi testi e opere. Se la domanda non riguarda Péguy, rispondi gentilmente: 'Mi dispiace, posso rispondere solo a domande su Charles Péguy e le sue opere.' Quando citi passaggi dai testi, traducili sempre in italiano se sono in francese. Mantieni il significato originale ma rendi il testo fluido e comprensibile. Metti sempre le citazioni tra virgolette.",
        messages: [
          {
            role: "user",
            content: `Testi rilevanti da Péguy:\n\n${context}\n\nDomanda dell'utente: ${question}\n\nRispondi basandoti SOLO sui testi forniti sopra. Se l'informazione non è nei testi, dillo chiaramente.`,
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
