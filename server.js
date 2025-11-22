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

    // Prendi MOLTI più chunks (200 invece di 50)
    const { data: chunks, error } = await supabase
      .from("peguy_chunks")
      .select(
        `
        chunk_text,
        document_id,
        peguy_documents!inner (
          title
        )
      `,
      )
      .limit(200);  // ← Aumentato da 50 a 200

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
        max_tokens: 2048,  // ← Aumentato per risposte più lunghe
        system: "Sei un esperto di Charles Péguy. Rispondi SOLO a domande sui suoi testi e opere. Se la domanda non riguarda Péguy, rispondi gentilmente: 'Mi dispiace, posso rispondere solo a domande su Charles Péguy e le sue opere.' Quando citi passaggi dai testi, usa il formato blockquote Markdown (> prima della citazione) per le citazioni esatte. Non inventare mai citazioni.",
        messages: [
          {
            role: "user",
            content: `Testi disponibili:\n\n${context}\n\nDomanda: ${question}\n\nRispondi basandoti SOLO sui testi forniti sopra. Cita le frasi esatte dal testo originale.`,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));
