// Morse Code Trainer Application

// localStorage key for saving progress
const STORAGE_KEY = 'morseCodeTrainerProgress';

// Save progress to localStorage
function saveProgress() {
    const dataToSave = {
        kochLevel: state.kochLevel,
        charSpeed: state.charSpeed,
        effectiveSpeed: state.effectiveSpeed,
        farnsworthLocked: state.farnsworthLocked,
        frequency: state.frequency,
        stats: state.stats
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
        console.warn('Could not save progress to localStorage:', e);
    }
}

// Load progress from localStorage
function loadProgress() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            if (data.kochLevel !== undefined) state.kochLevel = data.kochLevel;
            if (data.charSpeed !== undefined) state.charSpeed = data.charSpeed;
            if (data.effectiveSpeed !== undefined) state.effectiveSpeed = data.effectiveSpeed;
            if (data.farnsworthLocked !== undefined) state.farnsworthLocked = data.farnsworthLocked;
            if (data.frequency !== undefined) state.frequency = data.frequency;
            if (data.stats !== undefined) state.stats = data.stats;
            return true;
        }
    } catch (e) {
        console.warn('Could not load progress from localStorage:', e);
    }
    return false;
}

// Morse code mapping
const MORSE_CODE = {
    'A': '.-',    'B': '-...',  'C': '-.-.',  'D': '-..',   'E': '.',
    'F': '..-.',  'G': '--.',   'H': '....',  'I': '..',    'J': '.---',
    'K': '-.-',   'L': '.-..',  'M': '--',    'N': '-.',    'O': '---',
    'P': '.--.',  'Q': '--.-',  'R': '.-.',   'S': '...',   'T': '-',
    'U': '..-',   'V': '...-',  'W': '.--',   'X': '-..-',  'Y': '-.--',
    'Z': '--..',
    '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
    '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.',
    ' ': ' '
};

// Koch method character progression (most distinct sounds first)
const KOCH_SEQUENCE = ['K', 'M', 'R', 'S', 'U', 'A', 'P', 'T', 'L', 'O',
                       'W', 'I', 'N', 'J', 'E', 'F', '0', 'Y', 'V', 'G',
                       '5', 'Q', '9', 'Z', 'H', '3', '8', 'B', '?', '4',
                       '2', '7', 'C', '1', 'D', '6', 'X'];

// Common words for practice
const COMMON_WORDS = [
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER',
    'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW',
    'MAN', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY', 'ITS',
    'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'CAR', 'RUN', 'TOP', 'BIG'
];

// Q-codes
const Q_CODES = [
    'QTH', 'QSL', 'QRM', 'QRN', 'QRP', 'QRQ', 'QRS', 'QRZ', 'QSB', 'QSO',
    'QSY', 'QRX', 'QRT', 'QRV', 'QRK', 'QRL', 'QTR', 'QSP'
];

// Callsign patterns
const generateCallsign = () => {
    const prefixes = ['W', 'K', 'N', 'AA', 'AB', 'AC', 'AD', 'AE', 'KA', 'KB', 'KC', 'KD'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const number = Math.floor(Math.random() * 10);
    const suffix = String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
                   String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
                   String.fromCharCode(65 + Math.floor(Math.random() * 26));
    return prefix + number + suffix;
};

// Application state
let state = {
    mode: 'koch',
    charSpeed: 20,
    effectiveSpeed: 20,
    frequency: 600,
    kochLevel: 1,
    currentMessage: '',
    isPlaying: false,
    audioContext: null,
    farnsworthLocked: true,
    currentPlayer: null,
    cleanupTimeout: null,
    stats: {
        correct: 0,
        incorrect: 0,
        kochAccuracy: {}
    }
};

// Audio timing calculations
function calculateTiming(charWPM, effectiveWPM) {
    // PARIS standard: 50 dot units per word
    const dotDuration = 1200 / charWPM; // milliseconds

    // Farnsworth timing calculation
    let extraGapUnit = 0;
    if (effectiveWPM < charWPM) {
        const charTime = 50 * dotDuration;
        const effectiveTime = 50 * (1200 / effectiveWPM);
        extraGapUnit = (effectiveTime - charTime) / 19; // 19 adjustable dot units in PARIS spacing
    }

    return {
        dot: dotDuration,
        dash: dotDuration * 3,
        intraCharGap: dotDuration,
        charGap: dotDuration * 3 + extraGapUnit * 3,
        wordGap: dotDuration * 7 + extraGapUnit * 7
    };
}

// Audio generation using Web Audio API
class MorsePlayer {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.scheduledStops = [];
        this.scheduledTimeouts = [];
        this.isCancelled = false;
    }

    async playMorse(text, frequency, timing, onProgress) {
        const dotSeconds = timing.dot / 1000;
        const dashSeconds = timing.dash / 1000;
        const intraSeconds = timing.intraCharGap / 1000;
        const charGapSeconds = timing.charGap / 1000;
        const wordGapSeconds = timing.wordGap / 1000;

        let currentTime = this.audioContext.currentTime;
        let display = '';

        const queueDisplayUpdate = () => {
            if (!onProgress) return;
            const delay = Math.max(0, (currentTime - this.audioContext.currentTime) * 1000);
            const timeoutId = setTimeout(() => onProgress(display), delay);
            this.scheduledTimeouts.push(timeoutId);
        };

        const words = text.toUpperCase().split(' ');

        for (let w = 0; w < words.length; w++) {
            if (this.isCancelled) break;
            const word = words[w];

            for (let c = 0; c < word.length; c++) {
                if (this.isCancelled) break;
                const char = word[c];
                const pattern = MORSE_CODE[char];
                if (!pattern) continue;

                // Start span for this letter's morse pattern
                display += '<span class="morse-letter">';

                for (let i = 0; i < pattern.length; i++) {
                    if (this.isCancelled) break;
                    const symbol = pattern[i];
                    const duration = symbol === '.' ? dotSeconds : dashSeconds;

                    this.playTone(frequency, currentTime, duration);
                    currentTime += duration;
                    display += symbol;
                    queueDisplayUpdate();

                    if (i < pattern.length - 1) {
                        currentTime += intraSeconds;
                    }
                }

                // Close span for this letter
                display += '</span>';

                if (c < word.length - 1) {
                    currentTime += charGapSeconds;
                    display += ' ';
                    queueDisplayUpdate();
                }
            }

            if (w < words.length - 1) {
                currentTime += wordGapSeconds;
                display += '   ';
                queueDisplayUpdate();
            }
        }

        return Math.max(0, (currentTime - this.audioContext.currentTime) * 1000);
    }

    playTone(frequency, startTime, duration) {
        const oscillator = this.audioContext.createOscillator();
        const toneGain = this.audioContext.createGain();

        oscillator.frequency.value = frequency;
        oscillator.connect(toneGain);
        toneGain.connect(this.gainNode);

        // Envelope for click reduction
        toneGain.gain.setValueAtTime(0, startTime);
        toneGain.gain.linearRampToValueAtTime(0.3, startTime + 0.005);
        toneGain.gain.setValueAtTime(0.3, startTime + duration - 0.005);
        toneGain.gain.linearRampToValueAtTime(0, startTime + duration);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
    }

    stop() {
        // Set cancellation flag to stop scheduling new tones
        this.isCancelled = true;

        // Immediately mute all audio
        this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);

        // Clear all scheduled display update timeouts
        this.scheduledTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        this.scheduledTimeouts = [];
    }
}

// Message generation based on mode
function generateMessage() {
    const mode = state.mode;

    switch (mode) {
        case 'koch':
            return generateKochMessage();
        case 'letters':
            return generateRandomLetters(10);
        case 'words':
            return generateCommonWords(5);
        case 'callsigns':
            return generateCallsign();
        case 'qcodes':
            return Q_CODES[Math.floor(Math.random() * Q_CODES.length)];
        case 'custom':
            return document.getElementById('customText').value.toUpperCase() || 'HELLO';
        default:
            return 'HELLO';
    }
}

function generateKochMessage() {
    const chars = KOCH_SEQUENCE.slice(0, state.kochLevel + 1);
    const length = Math.floor(Math.random() * 3) + 8; // 8-10 characters
    let message = '';
    for (let i = 0; i < length; i++) {
        message += chars[Math.floor(Math.random() * chars.length)];
    }
    return message;
}

function generateRandomLetters(count) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < count; i++) {
        result += letters[Math.floor(Math.random() * letters.length)];
    }
    return result;
}

function generateCommonWords(count) {
    let words = [];
    for (let i = 0; i < count; i++) {
        words.push(COMMON_WORDS[Math.floor(Math.random() * COMMON_WORDS.length)]);
    }
    return words.join(' ');
}

// UI Updates
function updateKochDisplay() {
    document.getElementById('kochLevel').textContent = state.kochLevel;
    const chars = KOCH_SEQUENCE.slice(0, state.kochLevel + 1).join(' ');
    document.getElementById('kochChars').textContent = chars;

    // Calculate accuracy for current level
    const accuracy = calculateKochAccuracy();
    document.getElementById('accuracy').textContent = accuracy >= 0 ? `${accuracy}%` : '--';

    // Enable/disable next level button
    const nextBtn = document.getElementById('nextLevel');
    if (accuracy >= 90 && state.kochLevel < KOCH_SEQUENCE.length - 1) {
        nextBtn.disabled = false;
    } else {
        nextBtn.disabled = true;
    }
}

function calculateKochAccuracy() {
    const levelKey = `level_${state.kochLevel}`;
    const data = state.stats.kochAccuracy[levelKey];

    if (!data || data.total === 0) return -1;
    return Math.round((data.correct / data.total) * 100);
}

function updateStats() {
    document.getElementById('correctCount').textContent = state.stats.correct;
    document.getElementById('incorrectCount').textContent = state.stats.incorrect;

    const total = state.stats.correct + state.stats.incorrect;
    const rate = total > 0 ? Math.round((state.stats.correct / total) * 100) : 0;
    document.getElementById('successRate').textContent = `${rate}%`;
}

function updateSpeedStatus() {
    const statusEl = document.getElementById('speedStatus');
    if (!statusEl) return;

    if (state.farnsworthLocked) {
        statusEl.textContent = `Actual WPM: ${state.charSpeed}`;
    } else {
        statusEl.textContent = `Actual WPM: ${state.effectiveSpeed} (Farnsworth spacing)`;
    }
}

function recordKochAccuracy(isCorrect) {
    const levelKey = `level_${state.kochLevel}`;
    if (!state.stats.kochAccuracy[levelKey]) {
        state.stats.kochAccuracy[levelKey] = { correct: 0, total: 0 };
    }

    state.stats.kochAccuracy[levelKey].total++;
    if (isCorrect) {
        state.stats.kochAccuracy[levelKey].correct++;
    }
}

// Event Handlers
async function playNewMessage() {
    if (state.isPlaying) return;

    // Clean up any previous playback
    if (state.currentPlayer) {
        state.currentPlayer.stop();
    }
    if (state.cleanupTimeout) {
        clearTimeout(state.cleanupTimeout);
    }

    state.currentMessage = generateMessage();
    const timing = calculateTiming(state.charSpeed, state.effectiveSpeed);

    // Reset UI
    document.getElementById('morseDisplay').textContent = '';
    document.getElementById('morseDisplay').classList.add('playing');
    document.getElementById('answerInput').value = '';
    document.getElementById('answerInput').disabled = false;
    document.getElementById('feedback').className = 'feedback';
    document.getElementById('actualMessage').className = 'actual-message';
    document.getElementById('messageLength').textContent = state.currentMessage.replace(/ /g, '').length;

    // Update button states
    document.getElementById('playBtn').disabled = true;
    document.getElementById('repeatBtn').disabled = false;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('checkBtn').disabled = false;
    document.getElementById('revealBtn').disabled = false;

    state.isPlaying = true;

    // Create and save player instance
    state.currentPlayer = new MorsePlayer();
    const duration = await state.currentPlayer.playMorse(
        state.currentMessage,
        state.frequency,
        timing,
        (display) => {
            document.getElementById('morseDisplay').innerHTML = display;
        }
    );

    // Save cleanup timeout ID
    state.cleanupTimeout = setTimeout(() => {
        state.isPlaying = false;
        document.getElementById('playBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('morseDisplay').classList.remove('playing');
        document.getElementById('answerInput').focus();
        state.currentPlayer = null;
        state.cleanupTimeout = null;
    }, duration);
}

async function repeatMessage() {
    if (!state.currentMessage || state.isPlaying) return;

    // Clean up any previous playback
    if (state.currentPlayer) {
        state.currentPlayer.stop();
    }
    if (state.cleanupTimeout) {
        clearTimeout(state.cleanupTimeout);
    }

    const timing = calculateTiming(state.charSpeed, state.effectiveSpeed);

    document.getElementById('morseDisplay').textContent = '';
    document.getElementById('morseDisplay').classList.add('playing');
    document.getElementById('repeatBtn').disabled = true;
    document.getElementById('playBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;

    state.isPlaying = true;

    // Create and save player instance
    state.currentPlayer = new MorsePlayer();
    const duration = await state.currentPlayer.playMorse(
        state.currentMessage,
        state.frequency,
        timing,
        (display) => {
            document.getElementById('morseDisplay').innerHTML = display;
        }
    );

    // Save cleanup timeout ID
    state.cleanupTimeout = setTimeout(() => {
        state.isPlaying = false;
        document.getElementById('playBtn').disabled = false;
        document.getElementById('repeatBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('morseDisplay').classList.remove('playing');
        document.getElementById('answerInput').focus();
        state.currentPlayer = null;
        state.cleanupTimeout = null;
    }, duration);
}

function checkAnswer() {
    const userAnswer = document.getElementById('answerInput').value.toUpperCase().trim();
    const correct = userAnswer === state.currentMessage;

    const feedback = document.getElementById('feedback');
    const inputEl = document.getElementById('answerInput');
    const checkBtn = document.getElementById('checkBtn');
    const revealBtn = document.getElementById('revealBtn');

    if (correct) {
        feedback.textContent = '✓ Correct! Well done!';
        feedback.className = 'feedback correct';
        state.stats.correct++;
        if (state.mode === 'koch') {
            recordKochAccuracy(true);
        }
        inputEl.disabled = true;
        checkBtn.disabled = true;
        revealBtn.disabled = true;
    } else {
        feedback.textContent = '✗ Incorrect. Try again or reveal the answer.';
        feedback.className = 'feedback incorrect';
        state.stats.incorrect++;
        if (state.mode === 'koch') {
            recordKochAccuracy(false);
        }
        inputEl.disabled = false;
        checkBtn.disabled = false;
        revealBtn.disabled = false;
        inputEl.focus();
        inputEl.select();
    }

    updateStats();
    if (state.mode === 'koch') {
        updateKochDisplay();
    }
    saveProgress();
}

function revealAnswer() {
    const actualMsg = document.getElementById('actualMessage');
    actualMsg.textContent = `The message was: ${state.currentMessage}`;
    actualMsg.className = 'actual-message show';

    document.getElementById('answerInput').disabled = true;
    document.getElementById('checkBtn').disabled = true;
    document.getElementById('revealBtn').disabled = true;
}

function advanceKochLevel() {
    if (state.kochLevel < KOCH_SEQUENCE.length - 1) {
        state.kochLevel++;
        updateKochDisplay();

        // Reset accuracy for new level
        const levelKey = `level_${state.kochLevel}`;
        state.stats.kochAccuracy[levelKey] = { correct: 0, total: 0 };
        saveProgress();
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Load saved progress first
    loadProgress();

    const charSlider = document.getElementById('charSpeed');
    const effectiveSlider = document.getElementById('effectiveSpeed');
    const charSpeedValue = document.getElementById('charSpeedValue');
    const effectiveSpeedValue = document.getElementById('effectiveSpeedValue');
    const frequencySlider = document.getElementById('frequency');

    const syncEffectiveToChar = () => {
        state.effectiveSpeed = state.charSpeed;
        effectiveSlider.value = state.charSpeed;
        effectiveSpeedValue.textContent = state.charSpeed;
    };

    // Apply loaded state to UI controls
    charSlider.value = state.charSpeed;
    charSpeedValue.textContent = state.charSpeed;
    effectiveSlider.value = state.effectiveSpeed;
    effectiveSpeedValue.textContent = state.effectiveSpeed;
    frequencySlider.value = state.frequency;
    document.getElementById('frequencyValue').textContent = state.frequency;

    // Mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.mode = e.target.dataset.mode;

            // Show/hide sections based on mode
            document.querySelector('.koch-section').style.display =
                state.mode === 'koch' ? 'block' : 'none';
            document.querySelector('.custom-section').style.display =
                state.mode === 'custom' ? 'block' : 'none';
        });
    });

    // Speed controls
    charSlider.addEventListener('input', (e) => {
        state.charSpeed = parseInt(e.target.value);
        charSpeedValue.textContent = state.charSpeed;

        if (state.farnsworthLocked) {
            syncEffectiveToChar();
        } else if (state.effectiveSpeed > state.charSpeed) {
            state.effectiveSpeed = state.charSpeed;
            effectiveSlider.value = state.charSpeed;
            effectiveSpeedValue.textContent = state.charSpeed;
        }

        updateSpeedStatus();
        saveProgress();
    });

    effectiveSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);

        if (value >= state.charSpeed) {
            state.farnsworthLocked = true;
            syncEffectiveToChar();
        } else {
            state.farnsworthLocked = false;
            state.effectiveSpeed = value;
            effectiveSlider.value = state.effectiveSpeed;
            effectiveSpeedValue.textContent = state.effectiveSpeed;
        }

        updateSpeedStatus();
        saveProgress();
    });

    document.getElementById('frequency').addEventListener('input', (e) => {
        state.frequency = parseInt(e.target.value);
        document.getElementById('frequencyValue').textContent = state.frequency;
        saveProgress();
    });

    // Play controls
    document.getElementById('playBtn').addEventListener('click', playNewMessage);
    document.getElementById('repeatBtn').addEventListener('click', repeatMessage);
    document.getElementById('stopBtn').addEventListener('click', () => {
        // Stop the current player if it exists
        if (state.currentPlayer) {
            state.currentPlayer.stop();
            state.currentPlayer = null;
        }

        // Clear the cleanup timeout
        if (state.cleanupTimeout) {
            clearTimeout(state.cleanupTimeout);
            state.cleanupTimeout = null;
        }

        // Reset state and UI
        state.isPlaying = false;
        document.getElementById('playBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('repeatBtn').disabled = false;
        document.getElementById('morseDisplay').classList.remove('playing');
        document.getElementById('morseDisplay').textContent = '';
    });

    // Answer controls
    document.getElementById('answerInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !document.getElementById('checkBtn').disabled) {
            checkAnswer();
        }
    });
    document.getElementById('answerInput').addEventListener('input', () => {
        const feedback = document.getElementById('feedback');
        if (feedback.className === 'feedback incorrect') {
            feedback.className = 'feedback';
        }
    });
    document.getElementById('checkBtn').addEventListener('click', checkAnswer);
    document.getElementById('revealBtn').addEventListener('click', revealAnswer);

    // Koch controls
    document.getElementById('nextLevel').addEventListener('click', advanceKochLevel);

    // Stats controls
    document.getElementById('resetStats').addEventListener('click', () => {
        state.stats = { correct: 0, incorrect: 0, kochAccuracy: {} };
        state.kochLevel = 1;
        updateStats();
        updateKochDisplay();
        saveProgress();
    });

    // Initialize displays
    syncEffectiveToChar();
    charSpeedValue.textContent = state.charSpeed;
    updateSpeedStatus();
    updateKochDisplay();
    updateStats();
});
