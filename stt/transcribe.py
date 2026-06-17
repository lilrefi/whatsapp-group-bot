#!/usr/bin/env python3
# stt/transcribe.py

import sys
import os
from faster_whisper import WhisperModel

def transcribe(audio_path: str) -> str:
    if not os.path.exists(audio_path):
        print(f"ERROR: File not found: {audio_path}", file=sys.stderr)
        return ""

    model = WhisperModel("large-v3", device="cpu", compute_type="int8")

    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
        task="transcribe"
    )

    detected_lang = info.language
    print(f"Detected language: {detected_lang}", file=sys.stderr)

    transcript = " ".join(segment.text.strip() for segment in segments)
    return transcript.strip()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 transcribe.py <audio_path>", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    result = transcribe(audio_path)
    print(result)
