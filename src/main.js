const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');
const screenshot = require('screenshot-desktop');

// Disguise the application name in process lists
app.name = 'System Host Utility';
const AIService = require('./ai-service');
const DeepgramService = require('./deepgram-service');
require('dotenv').config();

let mainWindow;
let isGhostMode = false;
let deepgramService;
let voskProcess;
let aiService;
let transcriptHistory = [];
let isOnline = true;
let currentContext = { mode: 'interview' }; // Default context

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
    title: 'System Host',
    icon: null,
    focusable: true, // Allow focus for context input initially
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
    // Set to a higher level to stay above system overlays
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    
    if (mainWindow.setExcludesFromCapture) {
        mainWindow.setExcludesFromCapture(true);
    }
  } else {
    // Windows/Linux protection
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
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
    mainWindow.setIgnoreMouseEvents(isGhostMode, { forward: true });
    
    // Disable focus in ghost mode to prevent detection by window-switching monitors
    if (mainWindow.setFocusable) {
        mainWindow.setFocusable(!isGhostMode);
    }
    
    mainWindow.webContents.send('ghost-mode-toggled', isGhostMode);
  });

  // Panic Key: Immediate Exit
  globalShortcut.register('Alt+Shift+X', () => {
    if (deepgramService) deepgramService.stop();
    app.quit();
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

  // Initialize Offline Engine early so it can download models while online
  startVoskService();

  // Periodic Internet Check
  setInterval(checkConnectivity, 5000);
  checkConnectivity();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function checkConnectivity() {
    try {
        require('dns').lookup('google.com', (err) => {
            const wasOnline = isOnline;
            isOnline = !err;
            
            if (isOnline !== wasOnline) {
                console.log(`🌐 Internet Status Changed: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
            }
        });
    } catch (e) {
        isOnline = false;
    }
}

function startVoskService() {
    if (voskProcess) return;
    
    console.log('🎙️ Starting Offline Transcription (Whisper)...');
    
    // Check for virtual environment python first
    let pythonPath = process.platform === 'win32' ? 'python' : 'python3';
    const venvPath = process.platform === 'win32' 
        ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
        : path.join(__dirname, '..', '.venv', 'bin', 'python');
    
    if (fs.existsSync(venvPath)) {
        pythonPath = venvPath;
        console.log(`🐍 Using virtual environment Python: ${pythonPath}`);
    }
    
    const scriptPath = path.join(__dirname, '..', 'scripts', 'vosk_service.py');
    
    voskProcess = spawn(pythonPath, [scriptPath]);
    
    voskProcess.stdout.on('data', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'final') {
                handleFinalTranscript(msg.text);
            }
            if (mainWindow) mainWindow.webContents.send('transcription-update', msg);
        } catch (e) {
            // Not JSON
        }
    });

    voskProcess.stderr.on('data', (data) => {
        console.error(`Vosk Error: ${data}`);
    });
}

function stopVoskService() {
    if (voskProcess) {
        voskProcess.kill();
        voskProcess = null;
        console.log('🛑 Vosk Service Stopped');
    }
}

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

async function analyzeScreen() {
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
    const response = await aiService.generateSolution(transcriptHistory, currentContext, base64Img);
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
    currentContext = context;
    console.log('🚀 Context Updated:', context.mode);
    
    // If this came from a 'request-context' trigger, we should continue to AI
    // We can detect this by checking if it's a full context update or just a mode switch
    // Actually, the original code always triggered AI solution on send-context
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
    // If Deepgram is connected, use it. Otherwise, fallback to Local Whisper.
    if (deepgramService && deepgramService.isConnected()) {
        deepgramService.sendAudio(chunk);
    } else if (voskProcess) {
        try {
            voskProcess.stdin.write(Buffer.from(chunk));
        } catch (e) {
            console.error('❌ Error piping audio to Local Whisper:', e);
        }
    }
});

ipcMain.on('close-app', () => {
    if (deepgramService) deepgramService.stop();
    app.quit();
});
ipcMain.on('minimize-app', () => mainWindow.minimize());
