#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ai_service.py
Invoked as:
  python ai_service.py <inputPath> <srtPath>

Emits JSONL progress to stdout:
  {"stage":"transcribe","progress":25,"message":"..."}

Generates bilingual SRT with strict 2-line cues:
  English (single line)
  Chinese (single line)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional, Tuple


# -------------------------
# JSON progress (stdout)
# -------------------------
def emit(stage: str, progress: int, message: str) -> None:
    # Node expects JSON per line on stdout
    print(json.dumps({"stage": stage, "progress": int(progress), "message": message}, ensure_ascii=False), flush=True)


def eprint(*args) -> None:
    # send debug/info to stderr so it won't confuse the Node JSON parser
    print(*args, file=sys.stderr, flush=True)


# -------------------------
# SRT helpers
# -------------------------
_WS = re.compile(r"\s+")


def clean_one_line(text: str) -> str:
    text = (text or "").replace("\r", " ").replace("\n", " ")
    text = _WS.sub(" ", text).strip()
    return text


def srt_ts(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    ms = int(round(seconds * 1000.0))
    hh = ms // 3_600_000
    ms -= hh * 3_600_000
    mm = ms // 60_000
    ms -= mm * 60_000
    ss = ms // 1_000
    ms -= ss * 1_000
    return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"


def split_text_chunks(text: str, max_chars: int) -> List[str]:
    """
    Split into single-line chunks (no wrapping) with <= max_chars when possible.
    Prefers punctuation boundaries.
    """
    t = clean_one_line(text)
    if not t:
        return []
    if len(t) <= max_chars:
        return [t]

    # Punctuation-based split (keep punctuation)
    parts = re.split(r"([,，。.!?！？；;:])", t)
    chunks: List[str] = []
    cur = ""
    for i in range(0, len(parts), 2):
        piece = parts[i]
        punct = parts[i + 1] if i + 1 < len(parts) else ""
        cand = (cur + " " + piece + punct).strip() if cur else (piece + punct).strip()
        if len(cand) <= max_chars:
            cur = cand
        else:
            if cur:
                chunks.append(cur)
            cur = (piece + punct).strip()
    if cur:
        chunks.append(cur)

    # If still too long (e.g., no punctuation), split by spaces
    final: List[str] = []
    for c in chunks:
        if len(c) <= max_chars:
            final.append(c)
            continue
        words = c.split(" ")
        buf = ""
        for w in words:
            cand = (buf + " " + w).strip() if buf else w
            if len(cand) <= max_chars:
                buf = cand
            else:
                if buf:
                    final.append(buf)
                buf = w
        if buf:
            final.append(buf)

    # Worst-case: hard slice (e.g., long Chinese with no punctuation)
    out: List[str] = []
    for c in final:
        if len(c) <= max_chars:
            out.append(c)
        else:
            for i in range(0, len(c), max_chars):
                out.append(c[i : i + max_chars].strip())
    return [x for x in out if x]


@dataclass
class Segment:
    start: float
    end: float
    text: str


def split_segment_by_chunks(seg: Segment, chunks: List[str], min_piece_dur: float = 0.20) -> List[Segment]:
    if not chunks:
        return []
    start = float(seg.start)
    end = float(seg.end)
    dur = max(end - start, min_piece_dur * len(chunks))
    piece = max(dur / len(chunks), min_piece_dur)

    out: List[Segment] = []
    for i, chunk in enumerate(chunks):
        s = start + i * piece
        e = start + (i + 1) * piece
        if i == len(chunks) - 1:
            e = max(e, end)
        out.append(Segment(s, e, chunk))
    return out


def write_bilingual_srt(
    segments: List[Segment],
    out_path: Path,
    make_pair: Callable[[str], Tuple[str, str]],
    max_chars_src: int,
) -> None:
    """
    make_pair(src_text) -> (english, chinese), both single-line.
    Splits the *source* text into chunks first to keep cues short and single-line.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines: List[str] = []
    idx = 1

    for seg in segments:
        src = clean_one_line(seg.text)
        if not src:
            continue

        src_chunks = split_text_chunks(src, max_chars=max_chars_src)
        sub_segments = split_segment_by_chunks(seg, src_chunks)

        for sseg in sub_segments:
            src_piece = clean_one_line(sseg.text)
            if not src_piece:
                continue

            en, zh = make_pair(src_piece)
            en = clean_one_line(en)
            zh = clean_one_line(zh)

            # Enforce exactly two lines per cue
            lines.append(str(idx))
            lines.append(f"{srt_ts(sseg.start)} --> {srt_ts(sseg.end)}")
            lines.append(en)
            lines.append(zh)
            lines.append("")
            idx += 1

    out_path.write_text("\n".join(lines), encoding="utf-8")


# -------------------------
# Argos Translate
# -------------------------
def ensure_argos(from_code: str, to_code: str) -> None:
    import argostranslate.package
    import argostranslate.translate

    def has_translation() -> bool:
        langs = argostranslate.translate.get_installed_languages()
        fr = next((l for l in langs if l.code == from_code), None)
        to = next((l for l in langs if l.code == to_code), None)
        return bool(fr and to and fr.get_translation(to) is not None)

    if has_translation():
        return

    emit("translate", 42, f"Argos model missing for {from_code}->{to_code}. Downloading...")

    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    pkgs = [p for p in available if p.from_code == from_code and p.to_code == to_code]
    if not pkgs:
        raise RuntimeError(f"No Argos package available for {from_code}->{to_code}")

    pkg = pkgs[0]

    # Download into a temp directory, handling both download() signatures:
    import glob
    import os
    from pathlib import Path
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        old_cwd = os.getcwd()
        try:
            os.chdir(td)

            downloaded_path = None

            # Signature A: download(dest_path)
            try:
                target = td_path / f"{from_code}_{to_code}.argosmodel"
                ret = pkg.download(str(target))
                downloaded_path = str(target) if ret is None else str(ret)
            except TypeError:
                # Signature B: download()
                ret = pkg.download()
                downloaded_path = str(ret) if ret else None

            # If we still don't have a path, locate the downloaded .argosmodel in temp dir
            if not downloaded_path or not Path(downloaded_path).exists():
                matches = sorted(glob.glob(str(td_path / "*.argosmodel")))
                if not matches:
                    raise RuntimeError("Argos package download completed but no .argosmodel file was found.")
                downloaded_path = matches[0]

        finally:
            os.chdir(old_cwd)

        argostranslate.package.install_from_path(downloaded_path)

    if not has_translation():
        raise RuntimeError(f"Failed to install Argos model for {from_code}->{to_code}")


def make_argos_translator(from_code: str, to_code: str) -> Callable[[str], str]:
    import argostranslate.translate

    langs = argostranslate.translate.get_installed_languages()
    fr = next((l for l in langs if l.code == from_code), None)
    to = next((l for l in langs if l.code == to_code), None)
    if not fr or not to:
        raise RuntimeError(f"Argos languages not installed: {from_code}, {to_code}")

    tr = fr.get_translation(to)
    if tr is None:
        raise RuntimeError(f"Argos translation not available: {from_code}->{to_code}")

    def _t(text: str) -> str:
        return tr.translate(text)

    return _t


# -------------------------
# faster-whisper transcription
# -------------------------
def transcribe(input_path: Path, model_name: str, device: str, compute_type: str, language: Optional[str]) -> Tuple[List[Segment], str]:
    from faster_whisper import WhisperModel

    emit("transcribe", 10, f"Loading Whisper model '{model_name}' ({device}/{compute_type})...")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    emit("transcribe", 18, "Transcribing...")
    seg_iter, info = model.transcribe(str(input_path), vad_filter=True, language=language)

    detected = (info.language or (language or "auto")).lower()
    segments: List[Segment] = []

    for i, s in enumerate(seg_iter):
        segments.append(Segment(float(s.start), float(s.end), str(s.text)))
        if i == 0:
            emit("transcribe", 28, "Receiving segments...")
        elif i % 25 == 0:
            emit("transcribe", 33, f"Transcribed {i} segments...")

    emit("transcribe", 40, f"Transcription complete. Detected language: {detected}")
    return segments, detected


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input_path")
    ap.add_argument("output_srt_path")
    ap.add_argument("--model", default=os.getenv("WHISPER_MODEL", "small"))
    ap.add_argument("--device", default=os.getenv("WHISPER_DEVICE", "cpu"))
    ap.add_argument("--compute_type", default=os.getenv("WHISPER_COMPUTE_TYPE", "int8"))
    ap.add_argument("--language", default=os.getenv("WHISPER_LANGUAGE", ""))  # empty => auto
    ap.add_argument("--max_chars_en", type=int, default=int(os.getenv("SRT_MAX_CHARS_EN", "45")))
    ap.add_argument("--max_chars_zh", type=int, default=int(os.getenv("SRT_MAX_CHARS_ZH", "22")))
    args = ap.parse_args()

    in_path = Path(args.input_path).expanduser().resolve()
    out_srt = Path(args.output_srt_path).expanduser().resolve()

    try:
        if not in_path.exists():
            raise FileNotFoundError(f"Input file not found: {in_path}")

        emit("extract_audio", 5, "Preparing media for transcription (ffmpeg required)...")

        forced_lang = args.language.strip() or None
        segments, detected = transcribe(in_path, args.model, args.device, args.compute_type, forced_lang)

        # Always output EN on top, ZH on bottom.
        # If audio is English-ish: EN source, translate EN->ZH
        # If audio is Chinese-ish: ZH source, translate ZH->EN (but still output EN then ZH)
        detected_is_zh = detected.startswith("zh")

        emit("translate", 45, "Ensuring Argos translation model is installed...")
        if detected_is_zh:
            ensure_argos("zh", "en")
            zh2en = make_argos_translator("zh", "en")

            def make_pair(src_zh: str) -> Tuple[str, str]:
                zh_line = src_zh
                en_line = zh2en(src_zh)
                return en_line, zh_line

            max_chars_src = args.max_chars_zh
        else:
            ensure_argos("en", "zh")
            en2zh = make_argos_translator("en", "zh")

            def make_pair(src_en: str) -> Tuple[str, str]:
                en_line = src_en
                zh_line = en2zh(src_en)
                return en_line, zh_line

            max_chars_src = args.max_chars_en

        emit("srt", 60, "Generating bilingual SRT (EN on top, ZH below)...")
        write_bilingual_srt(segments, out_srt, make_pair=make_pair, max_chars_src=max_chars_src)

        emit("srt", 80, f"Wrote SRT: {out_srt}")
        emit("srt", 84, "SRT generation finished.")
        return 0

    except Exception as ex:
        # Node captures stderr into errorOutput; keep message helpful.
        eprint(f"ai_service.py failed: {ex}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
