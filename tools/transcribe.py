#!/usr/bin/env python3
"""Word-timed transcript for lyric alignment (free, CPU). Usage: transcribe.py song.wav out_words.json ["Artist, Title, hints"]"""
import sys, json
from faster_whisper import WhisperModel
import librosa
wav, out = sys.argv[1], sys.argv[2]; hint = sys.argv[3] if len(sys.argv) > 3 else 'Song lyrics.'
m = WhisperModel('medium.en', device='cpu', compute_type='int8', cpu_threads=2)
aud, _ = librosa.load(wav, sr=16000, mono=True)          # decode with librosa (faster-whisper's av decoder chokes on some m4a)
segs, _ = m.transcribe(aud, word_timestamps=True, vad_filter=False, beam_size=5, initial_prompt=hint)
words = []
for s in segs:
    print(f'{s.start:7.2f} {s.end:7.2f} {s.text}', flush=True)
    words += [{'w': w.word, 's': w.start, 'e': w.end} for w in s.words]
json.dump(words, open(out, 'w'))
