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

    console.log("🔍 Domanda:", question);

    // Prendi TUTTI i chunks (fino a 500)
    // Con poche conversazioni, il costo è accettabile
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
      .limit(500);  // ← Aumentato a 500 per coprire più testi

    console.log("📊 Chunks caricati:", chunks?.length || 0);

    if (error || !chunks || chunks.length === 0) {
      return res.json({ answer: "Nessun documento trovato nel database." });
    }

    // Prepara il contesto
    const context = chunks
      .map(
        (c, i) =>
          `[${i + 1}] "${c.peguy_documents.title}":\n${c.chunk_text}`,
      )
      .join("\n\n");

    console.log("🤖 Chiamo Claude con", chunks.length, "chunks...");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,  // ← Aumentato per risposte più complete
      system: "Sei un esperto biografo di Charles Péguy. Rispondi in italiano a domande sulla vita, la personalità e il contesto storico di Péguy. REGOLA FONDAMENTALE: Non usare MAI blockquote (>). Non riportare MAI brani letterali dai testi. Rispondi SEMPRE rielaborando le informazioni con parole tue, in modo narrativo e fluido. Se la domanda non riguarda la vita di Péguy, rispondi gentilmente: 'Mi dispiace, posso rispondere solo a domande sulla vita di Charles Péguy.'",
        messages: [
          {
            role: "user",
            content: `Ecco TUTTI i testi disponibili di Péguy:\n\n${context}\n\n---\n\nDomanda dell'utente: ${question}\n\nCerca attentamente nei testi sopra e rispondi. Se trovi informazioni rilevanti, citale usando il blockquote (>). Se proprio non trovi nulla di pertinente dopo aver cercato bene, dillo chiaramente.`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("❌ Errore Claude:", data.error);
      return res.json({ answer: "Errore nell'API di Claude: " + data.error.message });
    }

    res.json({ answer: data.content[0].text });
  } catch (error) {
    console.error("❌ Errore server:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server avviato su porta ${PORT}`));
