#!/usr/bin/env python3
# stt/transcribe.py

import sys
import os
import argparse
from faster_whisper import WhisperModel

def transcribe(audio_path: str, language: str | None = None) -> tuple[str, str]:
    if not os.path.exists(audio_path):
        print(f"ERROR: File not found: {audio_path}", file=sys.stderr)
        return "", ""

    model = WhisperModel("large-v3", device="cpu", compute_type="int8")

    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        language=language,
        # vad_filter omitted: Silero VAD misclassifies Mandarin phonemes as
        # silence and strips the audio before transcription, producing no output.
        condition_on_previous_text=False,
        task="transcribe"
    )

    detected_lang = info.language
    print(f"Detected language: {detected_lang}", file=sys.stderr)

    transcript = " ".join(segment.text.strip() for segment in segments)
    return transcript.strip(), detected_lang

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--language", default=None,
                        help="Force language (e.g. zh, en). Omit for auto-detect.")
    args = parser.parse_args()

    result, detected = transcribe(args.audio_path, args.language)
    # First line: detected language (read by Node.js for retry logic)
    # Second line: transcript
    print(detected)
    print(result)
