// UI Element References
const closeBtn = document.getElementById('close-btn');
const minBtn = document.getElementById('min-btn');
const contextTrigger = document.getElementById('context-trigger');
const contextModal = document.getElementById('context-modal');
const saveContextBtn = document.getElementById('save-context');
const resumeInput = document.getElementById('resume-input');
const jdInput = document.getElementById('jd-input');
const transcriptContainer = document.getElementById('transcript-container');
const solutionsContainer = document.getElementById('solutions-container');
const thinkingIndicator = document.getElementById('thinking-indicator');
const toggleTranscriptionBtn = document.getElementById('toggle-transcription');
const toggleText = document.getElementById('toggle-text');
const toggleIcon = toggleTranscriptionBtn.querySelector('.icon');
const btnMode = document.getElementById('btn-mode');

// Application State
let isTranscriptionActive = true;
let context = {
    resume: localStorage.getItem('invisible_resume') || '',
    jd: localStorage.getItem('invisible_jd') || '',
    mode: localStorage.getItem('invisible_mode') || 'interview'
};

// Initialize Inputs
resumeInput.value = context.resume;
jdInput.value = context.jd;

// Event Listeners
closeBtn.onclick = () => window.electronAPI.closeApp();
minBtn.onclick = () => window.electronAPI.minimizeApp();

contextTrigger.onclick = () => {
    contextModal.classList.toggle('active');
};

function updateModeUI() {
    if (context.mode === 'mcq') {
        btnMode.innerText = 'Mode: MCQ/Exam';
        btnMode.classList.add('exam-mode');
    } else {
        btnMode.innerText = 'Mode: Interview';
        btnMode.classList.remove('exam-mode');
    }
}

btnMode.onclick = () => {
    context.mode = context.mode === 'interview' ? 'mcq' : 'interview';
    localStorage.setItem('invisible_mode', context.mode);
    updateModeUI();
    window.electronAPI.sendContext(context);
    addTranscriptLine(`System: Mode switched to ${context.mode === 'mcq' ? 'MCQ/Exam' : 'Interview'}.`, true);
};

// Initialize Mode UI
updateModeUI();

saveContextBtn.onclick = () => {
    context.resume = resumeInput.value;
    context.jd = jdInput.value;
    localStorage.setItem('invisible_resume', context.resume);
    localStorage.setItem('invisible_jd', context.jd);
    contextModal.classList.remove('active');
    
    addSolutionCard('Context Updated', 'AI Pilot will now use your updated resume and job description for all suggestions.');
};

window.electronAPI.onGhostModeToggled((isGhost) => {
    if (isGhost) {
        document.body.classList.add('ghost-active');
        contextModal.classList.remove('active');
    } else {
        document.body.classList.remove('ghost-active');
    }
});

// Transcription Handling
let currentPartialText = '';
const partialElement = document.createElement('div');
partialElement.className = 'transcript-text highlight';
transcriptContainer.appendChild(partialElement);

// Transcription Handlers
toggleTranscriptionBtn.addEventListener('click', () => {
    isTranscriptionActive = !isTranscriptionActive;
    if (isTranscriptionActive) {
        toggleTranscriptionBtn.classList.replace('btn-secondary', 'btn-primary');
        toggleText.innerText = 'Listening';
        toggleIcon.innerText = '🟢';
        addTranscriptLine('System: Transcription resumed.', true);
    } else {
        toggleTranscriptionBtn.classList.replace('btn-primary', 'btn-secondary');
        toggleText.innerText = 'Paused';
        toggleIcon.innerText = '🔴';
        addTranscriptLine('System: Transcription paused.', true);
    }
});

window.electronAPI.onTranscriptionUpdate((msg) => {
    if (!isTranscriptionActive) return;

    if (msg.type === 'partial') {
        partialElement.textContent = msg.text + '...';
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    } else if (msg.type === 'final') {
        addTranscriptLine(msg.text, true);
        partialElement.textContent = ''; // Clear partial
    } else if (msg.type === 'error') {
        addTranscriptLine(`Error: ${msg.message}`, false);
    }
});

// AI Handling
window.electronAPI.onAiStatus((status) => {
    setThinking(status === 'thinking');
});

window.electronAPI.onAiSolution((solution) => {
    setThinking(false);
    
    // Parse solution (Assuming Markdown-ish or specific format)
    // For now, just display it as a card
    // In a real app, you'd parse Title, Content, and Code
    const lines = solution.split('\n');
    let title = 'AI Insight';
    let content = solution;
    let code = null;

    if (solution.includes('Title:')) {
        title = solution.match(/Title:\s*(.*)/)?.[1] || title;
    }
    
    if (solution.includes('```')) {
        const codeMatch = solution.match(/```(?:\w+)?\n([\s\S]*?)```/);
        if (codeMatch) code = codeMatch[1];
    }

    addSolutionCard(title, content, code);
});

window.electronAPI.onAiError((error) => {
    setThinking(false);
    addSolutionCard('AI Error', error);
});

window.electronAPI.onRequestContext(() => {
    window.electronAPI.sendContext(context);
});

// Audio Capture Setup (Deepgram)
async function setupAudioCapture() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (e) => {
            if (!isTranscriptionActive) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = convertFloat32ToInt16(inputData);
            window.electronAPI.sendAudio(pcmData);
        };
        
        console.log('🎤 Microphone capture started');
        addTranscriptLine('Microphone active. Streaming to AI...', true);
    } catch (err) {
        console.error('Failed to capture audio:', err);
        addTranscriptLine('Error: Could not access microphone.', false);
    }
}

function convertFloat32ToInt16(buffer) {
    let l = buffer.length;
    let buf = new Int16Array(l);
    while (l--) {
        buf[l] = Math.min(1, buffer[l]) * 0x7FFF;
    }
    return buf.buffer;
}

// Initialize
setupAudioCapture();

// Utility Functions
function addTranscriptLine(text, isHighlight = false) {
    const div = document.createElement('div');
    div.className = `transcript-text ${isHighlight ? 'highlight' : ''}`;
    div.textContent = text;
    transcriptContainer.appendChild(div);
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

function addSolutionCard(title, content, code = null) {
    const card = document.createElement('div');
    card.className = 'solution-card';
    
    let html = `
        <div class="solution-title">${title}</div>
        <div class="solution-content">${content}</div>
    `;
    
    if (code) {
        html += `<pre class="code-block"><code>${code}</code></pre>`;
    }
    
    card.innerHTML = html;
    solutionsContainer.prepend(card);
}

// Handle thinking state
function setThinking(isThinking) {
    thinkingIndicator.style.display = isThinking ? 'inline' : 'none';
}

// Initial Greeting
setTimeout(() => {
    addTranscriptLine('System ready. Listening for audio...', true);
}, 1000);
