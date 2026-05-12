import os
import sys
import json
import queue
import sounddevice as sd
from vosk import Model, KaldiRecognizer

# Configuration
MODEL_PATH = "model"  # Small model for speed
SAMPLE_RATE = 16000

# Queue for audio data
q = queue.Queue()

def callback(indata, frames, time, status):
    if status:
        print(status, file=sys.stderr)
    q.put(bytes(indata))

def main():
    if not os.path.exists(MODEL_PATH):
        print(json.dumps({"type": "error", "message": f"Model not found at {MODEL_PATH}"}))
        return

    try:
        model = Model(MODEL_PATH)
        rec = KaldiRecognizer(model, SAMPLE_RATE)
        
        print(json.dumps({"type": "status", "message": "Vosk initialized successfully"}))
        sys.stdout.flush()

        # Smaller blocksize for more frequent updates
        with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=4000, dtype='int16',
                               channels=1, callback=callback):
            while True:
                data = q.get()
                if rec.AcceptWaveform(data):
                    result = json.loads(rec.Result())
                    if result.get("text"):
                        print(json.dumps({"type": "final", "text": result["text"]}))
                        sys.stdout.flush()
                        # Reset for clean slate after each sentence
                        rec.Reset()
                else:
                    partial = json.loads(rec.PartialResult())
                    if partial.get("partial"):
                        print(json.dumps({"type": "partial", "text": partial["partial"]}))
                        sys.stdout.flush()

    except Exception as e:
        print(json.dumps({"type": "error", "message": str(e)}))
        sys.stdout.flush()

if __name__ == "__main__":
    main()
