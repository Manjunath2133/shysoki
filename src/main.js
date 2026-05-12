const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');
const screenshot = require('screenshot-desktop');
const AIService = require('./ai-service');
const DeepgramService = require('./deepgram-service');
require('dotenv').config();

let mainWindow;
let isGhostMode = false;
let deepgramService;
let aiService;
let transcriptHistory = [];

function createStealthWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    x: Math.floor((width - 1000) / 2),
    y: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // CRITICAL STEALTH FEATURE: Hide from screenshots and screen sharing
  mainWindow.setContentProtection(true);
  
  if (process.platform === 'darwin') {
    // macOS specific: hide from dock and exclude from capture
    app.dock.hide();
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Additional macOS protection if available
    if (mainWindow.setExcludesFromCapture) {
        mainWindow.setExcludesFromCapture(true);
    }
  }

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Initialize AI Service with failover and backup keys
  aiService = new AIService({
    openai: [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2],
    gemini: [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2],
    groq: [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2]
  });

  // Initialize Deepgram if key exists
  if (process.env.DEEPGRAM_API_KEY) {
    deepgramService = new DeepgramService(process.env.DEEPGRAM_API_KEY, (msg) => {
        if (msg.type === 'final') {
            handleFinalTranscript(msg.text);
        }
        mainWindow.webContents.send('transcription-update', msg);
    });
    deepgramService.start();
  }

  // Ghost Mode Toggle
  globalShortcut.register('Alt+Shift+G', () => {
    isGhostMode = !isGhostMode;
    mainWindow.setOpacity(isGhostMode ? 0.05 : 1.0);
    mainWindow.setIgnoreMouseEvents(isGhostMode);
    mainWindow.webContents.send('ghost-mode-toggled', isGhostMode);
  });

  // Emergency Hide
  globalShortcut.register('Alt+Shift+H', () => {
    mainWindow.setOpacity(0.01);
    setTimeout(() => {
        mainWindow.setOpacity(isGhostMode ? 0.05 : 1.0);
    }, 2000);
  });

  // Manual Screenshot & Analyze
  globalShortcut.register('Alt+Shift+S', async () => {
    await analyzeScreen();
  });

  if (isDev) {
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createStealthWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createStealthWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Transcription Logic (Now handled via Deepgram)

async function handleFinalTranscript(text) {
  if (!text || text.trim().length < 5) return;
  
  transcriptHistory.push(text);
  if (transcriptHistory.length > 15) transcriptHistory.shift();

  if (aiService && aiService.isQuestion(text)) {
    console.log('🤖 AI Triggered by Question:', text);
    mainWindow.webContents.send('ai-status', 'thinking');
    
    // Auto-trigger analysis with context
    mainWindow.webContents.send('request-context');
  }
}

async function analyzeScreen(context = {}) {
  try {
    console.log('📸 Analyzing Screen...');
    mainWindow.webContents.send('ai-status', 'thinking');
    
    // Stealth: Temporarily hide window for screenshot
    const currentOpacity = mainWindow.getOpacity();
    mainWindow.setOpacity(0);
    
    await new Promise(r => setTimeout(r, 100));
    const imgBuffer = await screenshot();
    mainWindow.setOpacity(currentOpacity);

    const base64Img = imgBuffer.toString('base64');
    
    console.log('🚀 Sending to AI Pilot (Multimodal)...');
    const response = await aiService.generateSolution(transcriptHistory, context, base64Img);
    console.log(`✅ ${response.provider} Response Received`);
    mainWindow.webContents.send('ai-solution', response.text);
  } catch (error) {
    console.error('❌ Analysis Error:', error);
    mainWindow.webContents.send('ai-error', error.message);
  }
}

// IPC Handlers
ipcMain.handle('get-env', (event, key) => process.env[key]);
ipcMain.on('send-context', async (event, context) => {
    console.log('🚀 Sending to AI Pilot (Text-only)...');
    try {
        const response = await aiService.generateSolution(transcriptHistory, context);
        console.log(`✅ ${response.provider} Response Received`);
        mainWindow.webContents.send('ai-solution', response.text);
    } catch (e) {
        console.error('❌ AI Error:', e);
        mainWindow.webContents.send('ai-error', e.message);
    }
});
ipcMain.on('audio-data', (event, chunk) => {
    if (deepgramService) {
        deepgramService.sendAudio(chunk);
    }
});

ipcMain.on('close-app', () => {
    if (deepgramService) deepgramService.stop();
    app.quit();
});
ipcMain.on('minimize-app', () => mainWindow.minimize());
