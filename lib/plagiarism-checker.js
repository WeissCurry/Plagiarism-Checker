const axios = require('axios');
const cheerio = require('cheerio');
const stringSimilarity = require('string-similarity');
const natural = require('natural');

class PlagiarismChecker {
    constructor() {
        this.chunkSize = 15;
        this.maxChunks = 20;
        this.similarityThreshold = 0.15;
        this.exactMatchThreshold = 0.85;
        this.timeout = 5000;
        this.maxWorkers = 6;
        this.minExactWords = 6;
        this.ngramSizes = [3, 4, 5];
        this.sentenceOverlapThreshold = 0.7;
        
        console.log('Enhanced Plagiarism Checker initialized');
    }

    async checkPlagiarism(text) {
        try {
            console.log(`Starting plagiarism analysis for ${text.length} characters...`);
            
            const cleanText = this.preprocessText(text);
            const chunks = this.createOptimizedChunks(cleanText);
            
            if (!chunks.length) {
                return this.createMinimalReport(text, "Text too short for analysis");
            }

            console.log(`Processing ${chunks.length} optimized chunks...`);
            
            // Process chunks with search and analysis
            const allMatches = [];
            const searchPromises = chunks.map((chunk, idx) => 
                this.searchChunk(chunk, idx).catch(err => {
                    console.error(`Chunk ${idx} error:`, err.message);
                    return [];
                })
            );
            
            const chunkResults = await Promise.all(searchPromises);
            chunkResults.forEach(matches => {
                if (matches && matches.length > 0) {
                    allMatches.push(...matches);
                }
            });

            // Calculate results
            const totalWords = cleanText.split(/\s+/).filter(w => w.length > 0).length;
            const plagiarizedWords = this.calculatePlagiarizedWords(allMatches, cleanText);
            const plagiarismPercentage = totalWords > 0 ? (plagiarizedWords / totalWords) * 100 : 0;
            
            // Group sources
            const sources = this.groupSources(allMatches);
            
            console.log(`Analysis complete: ${plagiarismPercentage.toFixed(2)}% plagiarism detected`);
            
            return {
                plagiarism_percentage: Math.round(plagiarismPercentage * 100) / 100,
                total_words: totalWords,
                plagiarized_words: plagiarizedWords,
                sources_found: sources.length,
                matches: allMatches.slice(0, 15),
                sources: sources.slice(0, 8),
                analysis_summary: this.generateSummary(plagiarismPercentage, sources.length),
                diagnostic_info: {
                    chunks_processed: chunks.length,
                    successful_matches: allMatches.length,
                    processing_time: 'optimized'
                }
            };
            
        } catch (error) {
            console.error('Analysis error:', error);
            return this.createErrorReport(error.message);
        }
    }

    preprocessText(text) {
        // Remove extra whitespace
        text = text.replace(/\s+/g, ' ').trim();
        
        // Remove citations and references
        text = text.replace(/\[[0-9]+\]/g, '');
        text = text.replace(/\([^)]*\d{4}[^)]*\)/g, '');
        text = text.replace(/https?:\/\/[^\s]+/g, '');
        
        return text;
    }

    createOptimizedChunks(text) {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const chunks = [];
        
        const chunkOverlap = 8;
        const stepSize = Math.max(1, this.chunkSize - chunkOverlap);
        
        for (let i = 0; i < words.length; i += stepSize) {
            const chunkWords = words.slice(i, i + this.chunkSize);
            if (chunkWords.length >= 6) {
                chunks.push(chunkWords.join(' '));
                if (chunks.length >= this.maxChunks) break;
            }
        }
        
        // Add sentence-based chunks
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        for (let i = 0; i < Math.min(5, sentences.length) && chunks.length < this.maxChunks; i++) {
            const sentence = sentences[i].trim();
            if (sentence.split(/\s+/).length >= 6) {
                chunks.push(sentence);
            }
        }
        
        return chunks;
    }

    async searchChunk(chunk, chunkIdx) {
        try {
            await this.delay(Math.random() * 1000 + 500); // Rate limiting
            
            console.log(`Searching chunk ${chunkIdx + 1}: ${chunk.substring(0, 50)}...`);
            
            const searchResults = [];
            
            // Try DuckDuckGo search
            try {
                const duckResults = await this.searchDuckDuckGo(chunk);
                searchResults.push(...duckResults);
            } catch (err) {
                console.log('DuckDuckGo search failed:', err.message);
            }
            
            // Process found URLs
            const matches = [];
            const urlPromises = searchResults.slice(0, 4).map(async (result) => {
                try {
                    const content = await this.fetchContent(result.url);
                    if (content) {
                        const similarity = this.calculateSimilarity(chunk, content);
                        if (similarity > this.similarityThreshold || similarity > this.exactMatchThreshold) {
                            const matchingPortion = this.findMatchingPortion(chunk, content);
                            return {
                                original_text: chunk,
                                matched_text: matchingPortion.substring(0, 200) + (matchingPortion.length > 200 ? '...' : ''),
                                full_matched_content: matchingPortion,
                                url: result.url,
                                title: result.title || 'Untitled',
                                similarity: similarity,
                                chunk_index: chunkIdx,
                                chunk_word_count: chunk.split(/\s+/).length
                            };
                        }
                    }
                } catch (err) {
                    console.log(`Error processing ${result.url}:`, err.message);
                }
                return null;
            });
            
            const results = await Promise.all(urlPromises);
            return results.filter(r => r !== null);
            
        } catch (error) {
            console.error(`Error in chunk ${chunkIdx}:`, error.message);
            return [];
        }
    }

    async searchDuckDuckGo(query) {
        try {
            const searchQuery = `"${query.substring(0, 100)}"`;
            const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
            
            const response = await axios.get(searchUrl, {
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            const $ = cheerio.load(response.data);
            const results = [];
            
            $('.result__a').each((i, element) => {
                if (i >= 6) return false;
                
                const title = $(element).text().trim();
                const url = $(element).attr('href');
                
                if (url && this.isValidUrl(url)) {
                    results.push({ title, url });
                }
            });
            
            return results;
            
        } catch (error) {
            console.log('DuckDuckGo search failed:', error.message);
            return [];
        }
    }

    async fetchContent(url) {
        try {
            const response = await axios.get(url, {
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const $ = cheerio.load(response.data);
            
            // Remove unwanted elements
            $('script, style, nav, header, footer').remove();
            
            const text = $('body').text().replace(/\s+/g, ' ').trim();
            return text.length > 100 ? text : null;
            
        } catch (error) {
            return null;
        }
    }

    calculateSimilarity(text1, text2) {
        try {
            const text1Clean = text1.toLowerCase().trim();
            const text2Clean = text2.toLowerCase().trim();
            
            // Layer 1: Exact substring matching
            const exactMatch = this.calculateExactMatch(text1Clean, text2Clean);
            if (exactMatch > 0.8) return exactMatch;
            
            // Layer 2: String similarity
            const stringSim = stringSimilarity.compareTwoStrings(text1Clean, text2Clean);
            
            // Layer 3: Word overlap
            const wordOverlap = this.calculateWordOverlap(text1Clean, text2Clean);
            
            // Layer 4: N-gram similarity
            const ngramSim = this.calculateNgramSimilarity(text1Clean, text2Clean);
            
            // Weighted combination
            const finalSimilarity = (
                exactMatch * 0.4 +
                stringSim * 0.3 +
                wordOverlap * 0.2 +
                ngramSim * 0.1
            );
            
            return Math.min(finalSimilarity, 1.0);
            
        } catch (error) {
            console.error('Similarity calculation error:', error);
            return 0;
        }
    }

    calculateExactMatch(text1, text2) {
        const words1 = text1.split(/\s+/);
        const words2 = text2.split(/\s+/);
        
        if (!words1.length || !words2.length) return 0;
        
        let totalMatches = 0;
        
        for (let i = 0; i <= words1.length - this.minExactWords; i++) {
            for (let j = 0; j <= words2.length - this.minExactWords; j++) {
                let matchLength = 0;
                while (i + matchLength < words1.length && 
                       j + matchLength < words2.length &&
                       words1[i + matchLength] === words2[j + matchLength]) {
                    matchLength++;
                }
                
                if (matchLength >= this.minExactWords) {
                    totalMatches += matchLength;
                }
            }
        }
        
        return totalMatches > 0 ? Math.min(totalMatches / words1.length, 1.0) : 0;
    }

    calculateWordOverlap(text1, text2) {
        const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2));
        const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2));
        
        if (!words1.size || !words2.size) return 0;
        
        const intersection = new Set([...words1].filter(w => words2.has(w)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    calculateNgramSimilarity(text1, text2) {
        let totalSimilarity = 0;
        let count = 0;
        
        for (const n of this.ngramSizes) {
            const ngrams1 = this.getNgrams(text1, n);
            const ngrams2 = this.getNgrams(text2, n);
            
            if (ngrams1.length && ngrams2.length) {
                const set1 = new Set(ngrams1);
                const set2 = new Set(ngrams2);
                const intersection = new Set([...set1].filter(x => set2.has(x)));
                const union = new Set([...set1, ...set2]);
                
                if (union.size > 0) {
                    totalSimilarity += intersection.size / union.size;
                    count++;
                }
            }
        }
        
        return count > 0 ? totalSimilarity / count : 0;
    }

    getNgrams(text, n) {
        const words = text.split(/\s+/);
        const ngrams = [];
        
        for (let i = 0; i <= words.length - n; i++) {
            ngrams.push(words.slice(i, i + n).join(' '));
        }
        
        return ngrams;
    }

    findMatchingPortion(chunk, content) {
        const chunkWords = chunk.toLowerCase().split(/\s+/);
        const contentWords = content.toLowerCase().split(/\s+/);
        
        if (!chunkWords.length || !contentWords.length) {
            return content.substring(0, 500);
        }
        
        let bestMatchStart = 0;
        let bestMatchScore = 0;
        
        for (let i = 0; i <= contentWords.length - chunkWords.length; i++) {
            let score = 0;
            for (let j = 0; j < Math.min(chunkWords.length, contentWords.length - i); j++) {
                if (chunkWords[j] === contentWords[i + j]) {
                    score++;
                } else {
                    break;
                }
            }
            
            if (score > bestMatchScore) {
                bestMatchScore = score;
                bestMatchStart = i;
            }
        }
        
        const start = Math.max(0, bestMatchStart - 10);
        const end = Math.min(contentWords.length, bestMatchStart + chunkWords.length + 10);
        
        return contentWords.slice(start, end).join(' ');
    }

    calculatePlagiarizedWords(matches, originalText) {
        if (!matches.length) return 0;
        
        const totalWords = originalText.split(/\s+/).filter(w => w.length > 0).length;
        
        const highConfidenceMatches = matches.filter(m => m.similarity > 0.7);
        if (highConfidenceMatches.length) {
            const plagiarizedWords = highConfidenceMatches.reduce((sum, m) => sum + (m.chunk_word_count || 0), 0);
            return Math.min(plagiarizedWords, totalWords);
        }
        
        const totalSimilarityScore = matches.reduce((sum, m) => sum + (m.similarity * (m.chunk_word_count || 0)), 0);
        const estimatedWords = Math.floor(totalSimilarityScore * 0.8);
        
        return Math.min(estimatedWords, totalWords);
    }

    groupSources(matches) {
        const sources = {};
        
        matches.forEach(match => {
            const url = match.url;
            if (!sources[url]) {
                sources[url] = {
                    url: url,
                    title: match.title,
                    matches: [],
                    avg_similarity: 0,
                    match_count: 0
                };
            }
            
            sources[url].matches.push(match);
            sources[url].match_count++;
        });
        
        // Calculate averages
        Object.values(sources).forEach(source => {
            const similarities = source.matches.map(m => m.similarity);
            source.avg_similarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
        });
        
        return Object.values(sources).sort((a, b) => b.avg_similarity - a.avg_similarity);
    }

    generateSummary(percentage, sourceCount) {
        if (percentage === 0) {
            return "No plagiarism detected. The text appears to be original.";
        } else if (percentage < 15) {
            return `Low plagiarism detected (${percentage.toFixed(1)}%). Found ${sourceCount} potential sources.`;
        } else if (percentage < 30) {
            return `Moderate plagiarism detected (${percentage.toFixed(1)}%). Review recommended. ${sourceCount} sources found.`;
        } else {
            return `High plagiarism detected (${percentage.toFixed(1)}%). Revision needed. ${sourceCount} sources found.`;
        }
    }

    isValidUrl(url) {
        if (!url || !url.startsWith('http')) return false;
        
        try {
            const domain = new URL(url).hostname.toLowerCase();
            const excluded = ['google.', 'youtube.', 'facebook.', 'twitter.', 'instagram.'];
            return !excluded.some(ex => domain.includes(ex));
        } catch {
            return false;
        }
    }

    createMinimalReport(text, message) {
        return {
            plagiarism_percentage: 0,
            total_words: text.split(/\s+/).filter(w => w.length > 0).length,
            plagiarized_words: 0,
            sources_found: 0,
            matches: [],
            sources: [],
            analysis_summary: message
        };
    }

    createErrorReport(errorMessage) {
        return {
            error: `Analysis failed: ${errorMessage}`,
            plagiarism_percentage: 0,
            total_words: 0,
            plagiarized_words: 0,
            sources_found: 0,
            matches: [],
            sources: []
        };
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = PlagiarismChecker;