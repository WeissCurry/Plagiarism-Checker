import { createServer } from "http";
import { checkTextSchema } from "../shared/schema.js";
import {
  calculateSimilarity,
  searchWeb,
  fetchPageContent,
  nGramSimilarity,
} from "./plagiarism.js";

export function registerRoutes(app) {
  app.post("/api/plagiarism-check", async (req, res) => {
    try {
      const { text } = checkTextSchema.parse(req.body);
      console.log("Starting plagiarism check for text length:", text.length);

      const sentences = text
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20);

      console.log("Split into", sentences.length, "sentences");

      // Batasi maksimal 20 kalimat untuk dicek
      const sentencesToCheck = sentences.slice(0, 20);
      const results = [];

      // KONFIGURASI BATCH
      // Kita proses 3 kalimat sekaligus secara paralel agar cepat
      // Jangan terlalu banyak (misal 10) nanti IP server kamu di-banned Google/DDG
      const BATCH_SIZE = 3;

      for (let i = 0; i < sentencesToCheck.length; i += BATCH_SIZE) {
        // Ambil potongan 3 kalimat (batch)
        const batch = sentencesToCheck.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${i / BATCH_SIZE + 1}...`);

        // Jalankan 3 kalimat ini SECARA BERSAMAAN (Parallel)
        const batchResults = await Promise.all(
          batch.map(async (sentence) => {
            return await processSentence(sentence);
          })
        );

        results.push(...batchResults);

        // Optional: Kasih napas sedikit antar batch biar ga dikira robot jahat
        if (i + BATCH_SIZE < sentencesToCheck.length) {
          await new Promise((r) => setTimeout(r, 500)); 
        }
      }

      // --- AGREGASI HASIL ---
      const totalSimilarity = results.reduce((sum, r) => sum + r.similarity, 0);
      const overallScore = results.length > 0 
        ? Math.round(totalSimilarity / results.length) 
        : 0;
        
      const plagiarizedCount = results.filter((r) => r.isPlagiarized).length;
      
      const plagiarismPercentage = results.length > 0
        ? Math.round((plagiarizedCount / results.length) * 100)
        : 0;

      console.log("Plagiarism check complete. Overall score:", overallScore);

      const checkResult = {
        overallScore,
        plagiarismPercentage,
        totalSentences: results.length,
        plagiarizedSentences: plagiarizedCount,
        results,
      };

      res.json(checkResult);
    } catch (error) {
      console.error("Error in plagiarism check:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "An unknown error occurred",
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// --- FUNGSI PROSES PER KALIMAT (DIPISAH BIAR RAPI) ---
async function processSentence(sentence) {
  console.log("Checking sentence:", sentence.substring(0, 30) + "...");
  
  try {
    const urls = await searchWeb(sentence);
    // console.log(`Found ${urls.length} URLs for sentence starting with "${sentence.substring(0, 10)}..."`);

    let maxSimilarity = 0;
    const matchedSources = [];

    // OPTIMASI: Fetch konten URL secara paralel juga (max 5 sekaligus)
    // Daripada loop 'for...of' yang nunggu satu-satu
    const urlChecks = urls.slice(0, 5).map(async (url) => {
      try {
        const content = await fetchPageContent(url);
        
        if (content && content.length > 100) {
          const cosineSim = calculateSimilarity(sentence, content);
          const ngramSim = nGramSimilarity(sentence, content, 5);
          const similarity = Math.max(cosineSim, ngramSim);

          if (similarity > 0.15) {
            return {
              url,
              similarity: Math.round(similarity * 100),
              rawScore: similarity
            };
          }
        }
      } catch (err) {
        // Ignore error per URL, lanjut ke URL lain
        return null;
      }
      return null;
    });

    // Tunggu semua fetch URL selesai
    const checks = await Promise.all(urlChecks);

    // Filter yang null (gagal/low score)
    checks.forEach(check => {
      if (check) {
        if (check.rawScore > maxSimilarity) {
          maxSimilarity = check.rawScore;
        }
        matchedSources.push({
          url: check.url,
          similarity: check.similarity
        });
      }
    });

    matchedSources.sort((a, b) => b.similarity - a.similarity);

    return {
      sentence,
      similarity: Math.round(maxSimilarity * 100),
      sources: matchedSources,
      isPlagiarized: maxSimilarity > 0.5,
    };

  } catch (error) {
    console.error("Error processing sentence:", error);
    // Return default kalau error, biar gak crash seluruh request
    return {
      sentence,
      similarity: 0,
      sources: [],
      isPlagiarized: false
    };
  }
}