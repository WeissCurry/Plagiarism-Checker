const stopwords = new Set([
  "yang", "di", "dan", "itu", "dengan", "untuk", "tidak", "ini", "dari",
  "dalam", "akan", "pada", "juga", "saya", "ke", "karena", "ia", "ada",
  "mereka", "kita", "kamu", "dia", "atau", "saat", "oleh", "sudah", "bisa",
  "kami", "adalah", "sebagai", "jika", "namun", "maka", "tentang", "seperti",
  "serta", "bagi", "hal", "pun", "agar", "setelah", "belum", "bukan",
  
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it",
  "for", "not", "on", "with", "he", "as", "you", "do", "at", "this", "but",
  "his", "by", "from", "they", "we", "say", "her", "she", "or", "an", "will",
  "my", "one", "all", "would", "there", "their", "what", "so", "up", "out",
  "if", "about", "who", "get", "which", "go", "me", "when", "make", "can",
  "like", "time", "no", "just", "him", "know", "take", "people", "into",
  "year", "your", "good", "some", "could", "them", "see", "other", "than",
  "then", "now", "look", "only", "come", "its", "over", "think", "also"
]);

function cleanAndFilter(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopwords.has(word));
}

export function calculateSimilarity(text1, text2) {
  const words1 = cleanAndFilter(text1);
  const words2 = cleanAndFilter(text2);

  const allWords = [...new Set([...words1, ...words2])];

  if (words1.length === 0 || words2.length === 0) return 0;

  const vector1 = allWords.map((word) => words1.filter((w) => w === word).length);
  const vector2 = allWords.map((word) => words2.filter((w) => w === word).length);

  const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
  const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));

  if (magnitude1 === 0 || magnitude2 === 0) return 0;

  return dotProduct / (magnitude1 * magnitude2);
}

export async function searchWeb(query) {
  const urls = [];
  try {
    const searchQuery = encodeURIComponent(query.slice(0, 200));
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${searchQuery}`;
    
    const response = await fetch(ddgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    
    const html = await response.text();
    const resultMatches = html.match(/uddg=([^"&]+)/g) || [];

    const ddgUrls = resultMatches
      .map((match) => {
        const encoded = match.replace("uddg=", "");
        try {
          return decodeURIComponent(encoded);
        } catch {
          return null;
        }
      })
      .filter(
        (url) => url && url.startsWith("http") && !url.includes("duckduckgo.com")
      )
      .slice(0, 8);

    urls.push(...ddgUrls.filter(url => url !== null));
  } catch (error) {
    console.error("DuckDuckGo search error:", error);
  }

  try {
    const searchQuery = encodeURIComponent(query.slice(0, 150));
    const crossrefUrl = `https://api.crossref.org/works?query=${searchQuery}&rows=5`;
    const response = await fetch(crossrefUrl);
    const data = await response.json();

    if (data.message?.items) {
      for (const item of data.message.items) {
        if (item.URL) {
          urls.push(item.URL);
        }
      }
    }
  } catch (error) {
    console.error("CrossRef search error:", error);
  }

  return [...new Set(urls)].slice(0, 10);
}

export async function fetchPageContent(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return "";
    }

    const html = await response.text();

    let text = html
      .replace(/<script[^>]*>.*?<\/script>/gis, "")
      .replace(/<style[^>]*>.*?<\/style>/gis, "")
      .replace(/<nav[^>]*>.*?<\/nav>/gis, "")
      .replace(/<header[^>]*>.*?<\/header>/gis, "")
      .replace(/<footer[^>]*>.*?<\/footer>/gis, "")
      .replace(/<aside[^>]*>.*?<\/aside>/gis, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 5000);
  } catch (error) {
    return "";
  }
}

// Fungsi untuk menghitung kemiripan n-gram
export function nGramSimilarity(text1, text2, n = 5) {
  const createNGrams = (text) => {
    const words = cleanAndFilter(text);

    const ngrams = new Set();

    if (words.length < n) return ngrams;

    for (let i = 0; i <= words.length - n; i++) {
      ngrams.add(words.slice(i, i + n).join(" "));
    }
    return ngrams;
  };

  const ngrams1 = createNGrams(text1);
  const ngrams2 = createNGrams(text2);

  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;

  let matches = 0;
  for (const gram of ngrams1) {
    if (ngrams2.has(gram)) matches++;
  }

  return matches / Math.max(ngrams1.size, ngrams2.size);
}