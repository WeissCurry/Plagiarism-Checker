const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

class TextExtractor {
    constructor() {
        console.log('Text Extractor initialized');
    }

    async extractText(filePath) {
        try {
            const ext = path.extname(filePath).toLowerCase();
            let text = '';

            switch (ext) {
                case '.txt':
                    text = await this.extractFromTxt(filePath);
                    break;
                case '.pdf':
                    text = await this.extractFromPdf(filePath);
                    break;
                case '.docx':
                    text = await this.extractFromDocx(filePath);
                    break;
                default:
                    throw new Error(`Unsupported file type: ${ext}`);
            }

            // Clean and normalize text
            text = text.replace(/\r\n/g, '\n');
            text = text.replace(/\s+/g, ' ');
            text = text.trim();

            console.log(`Extracted ${text.length} characters from ${path.basename(filePath)}`);
            return text;

        } catch (error) {
            console.error('Text extraction error:', error);
            throw new Error(`Failed to extract text: ${error.message}`);
        }
    }

    async extractFromTxt(filePath) {
        try {
            // Try different encodings
            const encodings = ['utf8', 'utf16le', 'latin1'];
            
            for (const encoding of encodings) {
                try {
                    const content = fs.readFileSync(filePath, encoding);
                    if (content && content.length > 0) {
                        return content;
                    }
                } catch (err) {
                    continue;
                }
            }
            
            throw new Error('Could not read text file with any supported encoding');
        } catch (error) {
            throw new Error(`TXT extraction failed: ${error.message}`);
        }
    }

    async extractFromPdf(filePath) {
        try {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);
            
            if (!data.text || data.text.trim().length === 0) {
                throw new Error('No text content found in PDF');
            }
            
            return data.text;
        } catch (error) {
            throw new Error(`PDF extraction failed: ${error.message}`);
        }
    }

    async extractFromDocx(filePath) {
        try {
            const result = await mammoth.extractRawText({ path: filePath });
            
            if (!result.value || result.value.trim().length === 0) {
                throw new Error('No text content found in DOCX');
            }
            
            if (result.messages && result.messages.length > 0) {
                console.log('DOCX extraction warnings:', result.messages);
            }
            
            return result.value;
        } catch (error) {
            throw new Error(`DOCX extraction failed: ${error.message}`);
        }
    }
}

module.exports = TextExtractor;