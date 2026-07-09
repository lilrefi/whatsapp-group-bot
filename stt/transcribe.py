#!/usr/bin/env python3
# stt/transcribe.py

import sys
import os
import io
import argparse
from faster_whisper import WhisperModel

# Force UTF-8 stdout so Chinese/CJK transcripts don't crash on Windows cp1252
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Languages expected in this context (Singapore/Malaysia food ordering).
# Hokkien has no Whisper code — the zh retry below handles it partially by
# transcribing Hokkien phonetics as Chinese characters.
EXPECTED_LANGUAGES = {'en', 'zh', 'yue'}

def transcribe(audio_path: str, force_language: str | None = None) -> tuple[str, str]:
    if not os.path.exists(audio_path):
        print(f"ERROR: File not found: {audio_path}", file=sys.stderr)
        return "", ""

    model = WhisperModel("large-v3", device="cpu", compute_type="int8")

    def run(lang):
        segs, info = model.transcribe(
            audio_path,
            beam_size=5,
            language=lang,
            # vad_filter omitted: Silero VAD misclassifies Mandarin/Hokkien/Cantonese
            # phonemes as silence and strips audio before transcription.
            condition_on_previous_text=False,
            task="transcribe"
        )
        text = " ".join(s.text.strip() for s in segs).strip()
        return info.language, text

    detected, text = run(force_language)
    print(f"Detected language: {detected}", file=sys.stderr)

    if force_language is None and detected not in EXPECTED_LANGUAGES:
        # Auto-detect landed outside the expected set (e.g. 'id' for Malaysian-
        # accented English, or 'ms' for Malay). Retry as zh first — covers
        # Mandarin, Cantonese, and gives the best chance for Hokkien.
        print(f"'{detected}' outside expected set — retrying as zh", file=sys.stderr)
        detected, text = run('zh')

        if not text:
            # zh produced nothing; fall back to English.
            print("zh gave empty result — retrying as en", file=sys.stderr)
            detected, text = run('en')

    return text, detected


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--language", default=None,
                        help="Force language (e.g. zh, en, yue). Omit for auto-detect.")
    args = parser.parse_args()

    result, detected = transcribe(args.audio_path, args.language)
    # Line 1: detected language (read by Node.js)
    # Line 2+: transcript
    print(detected)
    print(result)
