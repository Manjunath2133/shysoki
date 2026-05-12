const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Groq = require('groq-sdk');
const Tesseract = require('tesseract.js');

class AIService {
  constructor(keySets) {
    this.keySets = keySets;
    this.currentIndices = { openai: 0, gemini: 0, groq: 0 };
    this.history = [];
    
    this._initializeClients();
  }

  _initializeClients() {
    this.clients = {
      openai: (this.keySets.openai || []).map(key => this._isValidKey(key, 'sk-') ? new OpenAI({ apiKey: key.trim() }) : null).filter(Boolean),
      gemini: (this.keySets.gemini || []).map(key => this._isValidKey(key, 'AIza') ? new GoogleGenerativeAI(key.trim()) : null).filter(Boolean),
      groq: (this.keySets.groq || []).map(key => this._isValidKey(key, 'gsk_') ? new Groq({ apiKey: key.trim() }) : null).filter(Boolean)
    };

    console.log(`📡 AI Service Initialized: OpenAI(${this.clients.openai.length}), Gemini(${this.clients.gemini.length}), Groq(${this.clients.groq.length})`);
  }

  _isValidKey(key, prefix) {
    if (!key) return false;
    if (key.includes('your_') || key.includes('your-')) return false; // Filter placeholders
    if (key.length < 10) return false;
    return key.startsWith(prefix);
  }

  async generateSolution(transcriptHistory, context, screenshotBase64 = null) {
    const transcript = transcriptHistory.join('\n');
    const lastQuestion = transcriptHistory[transcriptHistory.length - 1] || '';
    
    let ocrText = null;
    if (screenshotBase64) {
      console.log('🔍 Processing OCR Fallback...');
      try {
        const { data: { text } } = await Tesseract.recognize(
          Buffer.from(screenshotBase64, 'base64'),
          'eng'
        );
        ocrText = text;
        console.log('✅ OCR Complete');
      } catch (e) {
        console.error('❌ OCR Failed:', e.message);
      }
    }

    const prompt = this._buildPrompt(transcript, lastQuestion, context, screenshotBase64, ocrText);
    
    const providers = ['openai', 'gemini', 'groq'];

    for (const providerName of providers) {
      const clients = this.clients[providerName];
      if (!clients || clients.length === 0) continue;

      for (let i = 0; i < clients.length; i++) {
        const currentIndex = (this.currentIndices[providerName] + i) % clients.length;
        const client = clients[currentIndex];

        try {
          console.log(`🚀 Attempting with ${providerName} (Key #${currentIndex + 1})...`);
          const response = await this._callProvider(providerName, client, prompt, screenshotBase64);
          
          this.currentIndices[providerName] = currentIndex;
          console.log(`✅ Success with ${providerName}`);
          return { provider: providerName, text: response };
        } catch (error) {
          const errMsg = error.message || String(error);
          console.error(`❌ ${providerName} Key #${currentIndex + 1} failed:`, errMsg);
          
          if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many Requests')) {
             console.log(`🔄 Quota exceeded for ${providerName} Key #${currentIndex + 1}, rotating...`);
             continue; 
          }
          
          if (errMsg.includes('401') || errMsg.includes('API key not valid') || errMsg.includes('Invalid API Key')) {
            console.log(`⚠️ Invalid Key detected for ${providerName} Key #${currentIndex + 1}, trying next...`);
            continue;
          }

          continue;
        }
      }
    }

    throw new Error('All AI providers and backup keys failed. Please check your .env file and ensure keys are valid.');
  }

  async _callProvider(name, client, prompt, screenshotBase64) {
    if (name === 'openai') return await this._callOpenAI(client, prompt, screenshotBase64);
    if (name === 'gemini') return await this._callGemini(client, prompt, screenshotBase64);
    if (name === 'groq') return await this._callGroq(client, prompt);
  }

  async _callGemini(client, prompt, screenshotBase64) {
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const parts = [{ text: prompt }];
    if (screenshotBase64) {
      parts.push({
        inlineData: {
          data: screenshotBase64,
          mimeType: 'image/png',
        },
      });
    }
    const result = await model.generateContent(parts);
    const response = await result.response;
    return response.text();
  }

  async _callGroq(client, prompt) {
    const chatCompletion = await client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
    });
    return chatCompletion.choices[0].message.content;
  }

  async _callOpenAI(client, prompt, screenshotBase64) {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ];

    if (screenshotBase64) {
      messages[0].content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${screenshotBase64}` },
      });
    }

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
    });
    return response.choices[0].message.content;
  }

  _buildPrompt(transcript, lastQuestion, context, screenshotBase64, ocrText) {
    let mode = screenshotBase64 ? 'MULTIMODAL ANALYSIS' : 'CONVERSATIONAL ANALYSIS';
    return `
You are invisibleAI, an elite Interview Pilot. 

MODE: ${mode}

CRITICAL RULE: Focus ONLY on answering the "CURRENT TARGET QUESTION" or solving the "SCREENSHOT PROBLEM" below.

${screenshotBase64 ? `
SCREENSHOT ANALYSIS:
OCR EXTRACTED TEXT: 
"${ocrText || 'N/A'}"
` : ''}

USER CONTEXT:
Resume: ${context.resume || 'Not provided'}
Job Description: ${context.jd || 'Not provided'}

CONVERSATION HISTORY:
${transcript}

CURRENT TARGET QUESTION:
"${lastQuestion}"

GOALS:
1. If a screenshot is provided, solve the coding problem IMMEDIATELY.
2. Provide the MOST OPTIMIZED code (time/space complexity).
3. Explain the logic in 3-4 quick bullet points.
4. If no screenshot, answer the target question precisely.

OUTPUT FORMAT:
- Title: Problem Name / Question Title.
- Content: Strategy and talking points.
- Code: Full solution.

Be ultra-fast.`;
  }

  isQuestion(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    if (lowerText.includes('?')) return true;
    const questionStarters = ['what', 'how', 'why', 'when', 'where', 'describe', 'tell', 'explain', 'could', 'would', 'can', 'will', 'do', 'does', 'is', 'are', 'was', 'were', 'give', 'share', 'walk'];
    const words = lowerText.split(' ');
    if (words.length > 0 && questionStarters.includes(words[0])) return text.length > 8;
    const interviewPhrases = ['tell me about', 'experience with', 'background in', 'your approach to', 'how do you', 'what is your', 'can you explain', 'beloved yourself', 'tell about yourself', 'tell us about yourself', 'what are your strengths', 'what are your string', 'where do you see', 'why should we hire', 'react experience'];
    return interviewPhrases.some(phrase => lowerText.includes(phrase));
  }
}

module.exports = AIService;
