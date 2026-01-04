#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List
from faster_whisper import WhisperModel
from google import genai
from google.genai import types

# Load API key from .env file automatically
from dotenv import load_dotenv
load_dotenv()

# -------------------------
# Data Structures & Progress
# -------------------------
@dataclass
class Segment:
    start: float
    end: float
    text: str

def emit(stage: str, progress: int, message: str) -> None:
    """Sends JSON status to stdout for Node.js/Parent process."""
    print(json.dumps({
        "stage": stage, 
        "progress": int(progress), 
        "message": message
    }, ensure_ascii=False), flush=True)

# -------------------------
# SRT Formatting
# -------------------------
def srt_ts(seconds: float) -> str:
    ms = int(round(max(0, seconds) * 1000.0))
    hh, ms = divmod(ms, 3_600_000)
    mm, ms = divmod(ms, 60_000)
    ss, ms = divmod(ms, 1_000)
    return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"

def clean_one_line(text: str) -> str:
    text = (text or "").replace("\r", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", text).strip()

def generate_srt_string(segments: List[Segment]) -> str:
    """Converts internal segments into a standard SRT string."""
    lines = []
    for i, s in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{srt_ts(s.start)} --> {srt_ts(s.end)}")
        lines.append(s.text)
        lines.append("") # Empty line between cues
    return "\n".join(lines)

# -------------------------
# Gemini Translation
# -------------------------
def translate_srt_with_gemini(srt_content: str, from_lang: str, to_lang: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    
    # Using your specific, detailed instructions
    system_instruction = """
    You are an expert subtitle localizer and SRT formatting validator. You translate English subtitles into Simplified Chinese while preserving exact SRT structure and timings. You must output a valid .srt file and nothing else.

    Your priorities, in order:
    Keep timestamps and cue numbering correct and in the same order as the input.
    Produce natural, accurate translation in Simplified Chinese, using wider context than individual cues.
    Preserve meaning, tone, register, character voice, and any technical terms. All Bible references will use the ESV for English and CUVS for Chinese
    Only correct the English source if there is a very blatant error or nonsensical phrase; do not rewrite style.

    You will receive an English .srt file Create a bilingual .srt filewhere each cue contains:
    Line 1: (Corrected if needed) English subtitle
    Line 2: Simplified Chinese translation

    The output must be a valid .srt file

    Key requirement: translate using larger context
    The cue segmentation in SRT may be awkward. To improve translation quality, you must:

    First reconstruct the subtitles into larger paragraphs/sections by merging consecutive cues that belong to the same sentence or thought.
    Translate at the paragraph/section level to resolve pronouns, ellipses, continuity, and sentence boundaries.
    Then re-split the translation back into the original cue boundaries, matching each cue’s time range and maintaining readability.

    What counts as a “section” when merging
    Merge consecutive cues into the same section when most of the following are true:
    The second cue continues the sentence (e.g., previous cue ends with “and”, “to”, “that”, comma, ellipsis, or no punctuation).
    The thought is clearly continuous (same speaker/topic; no scene change implied).
    The cues are close in time (typically adjacent cues; don’t merge across obvious topic shifts).

    Start a new section when:
    There is a clear sentence ending (. ! ?), or a strong topic/speaker shift.
    The content jumps (e.g., new scene, new speaker, new idea).
    Long gaps suggest a break.

    English correction policy (strict)
    You may correct the English line in a cue only if it is very blatant (e.g., obvious typo that changes meaning, broken grammar making it nonsensical, wrong word due to transcription error) and the correction is strongly supported by nearby context.

    Keep corrections minimal (change as little as possible).
    Do not “polish” or rewrite for style.
    If uncertain, leave the English unchanged.

    Re-segmentation rules (must follow)
    When you re-split back into cues:
    Keep the original cue numbering and timestamps exactly.
    Keep each cue’s English text aligned to what that cue conveyed; same for translation.
    If a sentence spans multiple cues, distribute it naturally across those cues (don’t repeat full sentences unnecessarily).

    Prefer 1–2 lines per language if possible; keep it readable.

    Do not add or remove cues.
    Do not change timestamps.
    Do not add commentary, notes, or JSON.
    Format requirements (SRT validity)

    Each cue must be exactly:

    A number
    A timestamp line: HH:MM:SS,mmm --> HH:MM:SS,mmm
    English line(s)
    Simplified Chinese line(s)
    Blank line

    No extra headers or explanations.

    Translation conventions
    Keep proper nouns consistent; transliterate only if standard in Simplified Chinese.
    Preserve on-screen text markers like: [Music], (laughs), ♪ ... ♪—translate them appropriately if typical in Simplified Chinese.
    Keep speaker labels if present.
    If there are sound effects captions, translate them as captions (not prose).

    Now process this SRT:
    """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            # We combine your prompt with the actual SRT data
            contents=[system_instruction, f"Now process this SRT:\n\n{srt_content}"],
            config=types.GenerateContentConfig(
                temperature=0.1,
                # It is helpful to set a high max_output_tokens for long SRTs
                max_output_tokens=8192 
            )
        )
        
        # Strip potential markdown blocks
        clean_text = response.text
        if "```" in clean_text:
            clean_text = re.sub(r"```[a-z]*\n?|```", "", clean_text).strip()
            
        return clean_text
    except Exception as e:
        print(f"Gemini API Error: {e}", file=sys.stderr)
        return srt_content

# -------------------------
# Main Execution
# -------------------------
def main():
    parser = argparse.ArgumentParser(description="AI Transcription & Gemini SRT Translation")
    parser.add_argument("input", help="Source video/audio file")
    parser.add_argument("output", help="Output SRT path")
    parser.add_argument("--model", default="small", help="Whisper model: tiny, base, small, medium, large-v3")
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    args = parser.parse_args()

    # 1. Transcription
    emit("transcribe", 10, f"Loading Whisper model '{args.model}' on {args.device}...")
    model = WhisperModel(args.model, device=args.device, compute_type="int8")
    
    emit("transcribe", 20, "Analyzing audio and generating timestamps...")
    seg_iter, info = model.transcribe(args.input, vad_filter=True)
    
    raw_segments = []
    for s in seg_iter:
        raw_segments.append(Segment(s.start, s.end, clean_one_line(s.text)))
    
    if not raw_segments:
        print("No speech detected.", file=sys.stderr)
        return 1

    # 2. Setup Language Logic
    is_zh = info.language.startswith("zh")
    src_lang, tgt_lang = ("Chinese", "English") if is_zh else ("English", "Chinese")
    
    # 3. Generate Source SRT String
    emit("srt", 45, "Generating source SRT string...")
    source_srt_string = generate_srt_string(raw_segments)

    # 4. Gemini Translation
    emit("translate", 60, f"Detected language: {src_lang}. Sending SRT to Gemini...")
    final_srt = translate_srt_with_gemini(source_srt_string, src_lang, tgt_lang)

    # 5. Save Final File
    emit("srt", 90, "Writing final bilingual SRT...")
    Path(args.output).write_text(final_srt, encoding="utf-8")
    
    emit("complete", 100, f"Successfully generated {args.output}")
    return 0

if __name__ == "__main__":
    sys.exit(main())