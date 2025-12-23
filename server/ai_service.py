#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ai_service.py

Audio/Video mode (unchanged):
  python ai_service.py <inputPath> <srtPath>

SRT re-translate mode (NEW):
  python ai_service.py --input_srt <inputSrtPath> <outputSrtPath>

Emits JSONL progress to stdout:
  {"stage":"transcribe","progress":25,"message":"..."}
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional, Tuple


# -------------------------
# IO helpers
# -------------------------
def emit(stage: str, progress: int, message: str) -> None:
    payload = {"stage": stage, "progress": int(progress), "message": str(message)}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def eprint(msg: str) -> None:
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()


# -------------------------
# SRT helpers
# -------------------------
@dataclass
class Segment:
    start: float
    end: float
    text: str


_ws_re = re.compile(r"\s+")


def clean_one_line(s: str) -> str:
    s = (s or "").replace("\r", " ").replace("\n", " ")
    s = _ws_re.sub(" ", s).strip()
    return s


def srt_ts(t: float) -> str:
    if t < 0:
        t = 0.0
    ms = int(round((t - math.floor(t)) * 1000.0))
    total = int(math.floor(t))
    sec = total % 60
    total //= 60
    minute = total % 60
    hour = total // 60
    return f"{hour:02d}:{minute:02d}:{sec:02d},{ms:03d}"


def _parse_srt_ts(ts: str) -> float:
    """
    Parse 'HH:MM:SS,mmm' or 'HH:MM:SS.mmm' -> seconds.
    """
    ts = ts.strip().replace(",", ".")
    m = re.match(r"^(\d+):(\d+):(\d+)\.(\d+)$", ts)
    if not m:
        raise ValueError(f"Invalid SRT timestamp: {ts}")
    hh = int(m.group(1))
    mm = int(m.group(2))
    ss = int(m.group(3))
    ms = int(m.group(4).ljust(3, "0")[:3])
    return hh * 3600 + mm * 60 + ss + (ms / 1000.0)


def _is_cjk_char(ch: str) -> bool:
    if not ch:
        return False
    o = ord(ch)
    return (
        0x4E00 <= o <= 0x9FFF  # CJK Unified Ideographs
        or 0x3400 <= o <= 0x4DBF  # CJK Extension A
        or 0x3000 <= o <= 0x303F  # CJK Symbols & Punctuation
        or 0xFF00 <= o <= 0xFFEF  # Halfwidth/Fullwidth
    )


def _looks_like_zh(text: str) -> bool:
    t = text or ""
    return any(_is_cjk_char(ch) for ch in t)


def split_text_chunks(text: str, max_chars: int) -> List[str]:
    """
    Greedy splitting:
    - For English-ish: split on spaces where possible.
    - For CJK-ish: split on punctuation or hard-cut.
    Keeps logic simple and deterministic.
    """
    t = clean_one_line(text)
    if not t:
        return []

    # Heuristic: treat as CJK if it contains any CJK char and has few spaces
    has_cjk = any(_is_cjk_char(ch) for ch in t)
    space_count = t.count(" ")
    cjk_mode = has_cjk and space_count <= max(1, len(t) // 30)

    if len(t) <= max_chars:
        return [t]

    if not cjk_mode:
        # Word-based greedy split
        words = t.split(" ")
        out: List[str] = []
        cur: List[str] = []
        cur_len = 0
        for w in words:
            if not w:
                continue
            add_len = (1 if cur else 0) + len(w)
            if cur and cur_len + add_len > max_chars:
                out.append(" ".join(cur))
                cur = [w]
                cur_len = len(w)
            else:
                cur.append(w)
                cur_len += add_len
        if cur:
            out.append(" ".join(cur))
        # If any chunk still too long (very long tokens), hard cut
        final: List[str] = []
        for c in out:
            if len(c) <= max_chars:
                final.append(c)
            else:
                for i in range(0, len(c), max_chars):
                    final.append(c[i : i + max_chars])
        return final

    # CJK-ish: split at punctuation first, otherwise hard cut
    # Prefer split points near the end of the window.
    split_punct = set("，。！？；：、,.!?;:")
    out: List[str] = []
    i = 0
    n = len(t)
    while i < n:
        j = min(i + max_chars, n)
        if j == n:
            out.append(t[i:j])
            break

        best = -1
        for k in range(j - 1, i, -1):
            if t[k] in split_punct:
                best = k + 1
                break

        if best != -1 and best > i:
            out.append(t[i:best].strip())
            i = best
        else:
            out.append(t[i:j].strip())
            i = j

    return [c for c in out if c]


def split_segment_by_chunks(seg: Segment, chunks: List[str]) -> List[Segment]:
    if not chunks:
        return []
    if len(chunks) == 1:
        return [Segment(seg.start, seg.end, chunks[0])]

    total_chars = sum(max(1, len(c)) for c in chunks)
    dur = max(0.0, seg.end - seg.start)
    out: List[Segment] = []
    start = seg.start
    acc = 0.0
    for i, c in enumerate(chunks):
        w = max(1, len(c))
        piece = dur * (w / total_chars)
        s = start + acc
        e = start + acc + piece
        acc += piece
        if i == len(chunks) - 1:
            e = seg.end
        out.append(Segment(s, e, c))
    return out


def write_bilingual_srt(
    segments: List[Segment],
    out_path: Path,
    make_pair: Callable[[str], Tuple[str, str]],
    max_chars_src: int,
) -> None:
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

            lines.append(str(idx))
            lines.append(f"{srt_ts(sseg.start)} --> {srt_ts(sseg.end)}")
            lines.append(en)
            lines.append(zh)
            lines.append("")
            idx += 1

    out_path.write_text("\n".join(lines), encoding="utf-8")


# -------------------------
# Chinese punctuation normalization
# -------------------------
def _normalize_zh_punctuation(text: str) -> str:
    """
    Convert ASCII punctuation into Chinese punctuation where appropriate.
    - "," -> "，" unless between digits (1,000)
    - "." -> "。" unless between digits (3.14)
    Also converts ?, !, :, ;, parentheses to Chinese forms.
    """
    s = text or ""
    out: List[str] = []
    n = len(s)

    for i, ch in enumerate(s):
        prev = s[i - 1] if i > 0 else ""
        nxt = s[i + 1] if i + 1 < n else ""

        if ch == ",":
            if prev.isdigit() and nxt.isdigit():
                out.append(",")
            else:
                out.append("，")
        elif ch == ".":
            if prev.isdigit() and nxt.isdigit():
                out.append(".")
            else:
                out.append("。")
        elif ch == "?":
            out.append("？")
        elif ch == "!":
            out.append("！")
        elif ch == ":":
            out.append("：")
        elif ch == ";":
            out.append("；")
        elif ch == "(":
            out.append("（")
        elif ch == ")":
            out.append("）")
        else:
            out.append(ch)

    s2 = "".join(out)
    s2 = re.sub(r"\s+([，。！？；：])", r"\1", s2)
    return s2


# -------------------------
# Best-free translation backend (Transformers/NLLB) + Argos fallback
# -------------------------
class Translator:
    def __init__(self, preferred_model: str) -> None:
        self._mode = "none"
        self._preferred_model = preferred_model

        try:
            import torch  # noqa: F401
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # noqa: F401

            self._mode = "nllb"
            self._torch = __import__("torch")
            self._AutoTokenizer = __import__("transformers", fromlist=["AutoTokenizer"]).AutoTokenizer
            self._AutoModel = __import__("transformers", fromlist=["AutoModelForSeq2SeqLM"]).AutoModelForSeq2SeqLM

            self._device = "cuda" if self._torch.cuda.is_available() else "cpu"
            emit("translate", 42, f"Loading translation model '{preferred_model}' on {self._device}...")

            self._tokenizer = self._AutoTokenizer.from_pretrained(preferred_model)
            self._model = self._AutoModel.from_pretrained(preferred_model)
            self._model.to(self._device)
            self._model.eval()

            self._NLLB_EN = "eng_Latn"
            self._NLLB_ZH = "zho_Hans"  # Simplified Chinese

            emit("translate", 46, "Translation model ready (Transformers/NLLB).")
            return
        except Exception as ex:
            self._mode = "argos"
            emit("translate", 42, f"Transformers not available ({ex}). Falling back to Argos Translate...")

        self._init_argos()

    def _init_argos(self) -> None:
        import glob
        import tempfile
        import argostranslate.package
        import argostranslate.translate

        def has_translation(from_code: str, to_code: str) -> bool:
            langs = argostranslate.translate.get_installed_languages()
            fr = next((l for l in langs if l.code == from_code), None)
            to = next((l for l in langs if l.code == to_code), None)
            if not fr or not to:
                return False
            tr = fr.get_translation(to)
            return tr is not None

        def ensure_argos(from_code: str, to_code: str) -> None:
            if has_translation(from_code, to_code):
                return

            emit("translate", 44, f"Argos model missing for {from_code}->{to_code}. Downloading...")
            argostranslate.package.update_package_index()
            available = argostranslate.package.get_available_packages()
            pkgs = [
                p
                for p in available
                if getattr(p, "from_code", None) == from_code and getattr(p, "to_code", None) == to_code
            ]
            if not pkgs:
                raise RuntimeError(f"No Argos package available for {from_code}->{to_code}")

            def _pkg_version(p) -> str:
                return getattr(p, "package_version", None) or getattr(p, "version", None) or "0"

            pkgs.sort(key=_pkg_version, reverse=True)
            pkg = pkgs[0]

            with tempfile.TemporaryDirectory() as td:
                td_path = Path(td)
                downloaded_path = None

                try:
                    target = td_path / f"{from_code}_{to_code}.argosmodel"
                    ret = pkg.download(str(target))
                    downloaded_path = str(target) if ret is None else str(ret)
                except TypeError:
                    ret = pkg.download()
                    downloaded_path = str(ret) if ret else None

                if not downloaded_path or not Path(downloaded_path).exists():
                    matches = sorted(glob.glob(str(td_path / "*.argosmodel")))
                    if not matches:
                        raise RuntimeError("Argos package download completed but no .argosmodel file was found.")
                    downloaded_path = matches[0]

                argostranslate.package.install_from_path(downloaded_path)

            if not has_translation(from_code, to_code):
                raise RuntimeError(f"Failed to install Argos model for {from_code}->{to_code}")

        def make_argos_translator(from_code: str, to_code: str) -> Callable[[str], str]:
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

        ensure_argos("en", "zh")
        ensure_argos("zh", "en")
        self._argos_en2zh = make_argos_translator("en", "zh")
        self._argos_zh2en = make_argos_translator("zh", "en")
        emit("translate", 46, "Translation model ready (Argos fallback).")

    def _nllb_translate(self, text: str, src_lang: str, tgt_lang: str) -> str:
        t = clean_one_line(text)
        if not t:
            return ""

        self._tokenizer.src_lang = src_lang
        inputs = self._tokenizer(t, return_tensors="pt", truncation=True)
        inputs = {k: v.to(self._device) for k, v in inputs.items()}

        forced_bos = self._tokenizer.lang_code_to_id[tgt_lang]
        with self._torch.no_grad():
            out_ids = self._model.generate(
                **inputs,
                forced_bos_token_id=forced_bos,
                max_new_tokens=256,
                num_beams=4,
            )
        out = self._tokenizer.batch_decode(out_ids, skip_special_tokens=True)[0]
        return clean_one_line(out)

    def en2zh(self, text: str) -> str:
        if self._mode == "nllb":
            zh = self._nllb_translate(text, self._NLLB_EN, self._NLLB_ZH)
        else:
            zh = clean_one_line(self._argos_en2zh(text))
        return _normalize_zh_punctuation(zh)

    def zh2en(self, text: str) -> str:
        if self._mode == "nllb":
            return self._nllb_translate(text, self._NLLB_ZH, self._NLLB_EN)
        return clean_one_line(self._argos_zh2en(text))


# -------------------------
# Whisper transcription
# -------------------------
def transcribe(
    input_path: Path,
    model_name: str,
    device: str,
    compute_type: str,
    language: Optional[str],
) -> Tuple[List[Segment], str]:
    from faster_whisper import WhisperModel

    emit("transcribe", 10, f"Loading Whisper model '{model_name}' ({device}/{compute_type})...")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    emit("transcribe", 18, "Transcribing...")
    lang = language.strip() if (language or "").strip() else None
    seg_iter, info = model.transcribe(str(input_path), vad_filter=True, language=lang)

    detected = (info.language or (lang or "auto")).lower()
    segments: List[Segment] = []

    for i, s in enumerate(seg_iter):
        segments.append(Segment(float(s.start), float(s.end), str(s.text)))
        if i == 0:
            emit("transcribe", 28, "Receiving segments...")
        elif i % 25 == 0:
            emit("transcribe", 33, f"Transcribed {i} segments...")

    emit("transcribe", 40, f"Transcription complete. Detected language: {detected}")
    return segments, detected


# -------------------------
# NEW: Load segments from SRT for re-translate
# -------------------------
def load_segments_from_srt(input_srt: Path) -> Tuple[List[Segment], str]:
    """
    Reads an SRT and returns segments whose text is the "source" line.
    Heuristic:
      - If cue has 2+ text lines: treat line1 as EN and use it as source (default)
        unless line1 looks like ZH and line2 doesn't, then swap.
      - If cue has 1 text line: detect by CJK heuristic.
    Returns (segments, detected_lang) where detected_lang is 'zh' or 'en' (best-effort).
    """
    content = input_srt.read_text(encoding="utf-8", errors="ignore")
    blocks = re.split(r"\n\s*\n", content.strip())
    candidates: List[Tuple[float, float, str, str]] = []  # start, end, en, zh
    zh_votes = 0
    en_votes = 0

    for b in blocks:
        lines = [ln.strip("\ufeff").rstrip() for ln in b.splitlines() if ln.strip()]
        if not lines:
            continue

        # Optional numeric index
        if re.match(r"^\d+$", lines[0]):
            lines = lines[1:]
            if not lines:
                continue

        # Time line
        time_line_idx = next((i for i, ln in enumerate(lines) if "-->" in ln), -1)
        if time_line_idx < 0:
            continue
        time_line = lines[time_line_idx]
        m = re.match(r"^\s*(.*?)\s*-->\s*(.*?)\s*$", time_line)
        if not m:
            continue

        try:
            start = _parse_srt_ts(m.group(1))
            end = _parse_srt_ts(m.group(2))
        except Exception:
            continue

        text_lines = [clean_one_line(x) for x in lines[time_line_idx + 1 :] if clean_one_line(x)]
        if not text_lines:
            continue

        if len(text_lines) == 1:
            t0 = text_lines[0]
            if _looks_like_zh(t0):
                zh_votes += 1
                en_line = ""
                zh_line = _normalize_zh_punctuation(t0)
            else:
                en_votes += 1
                en_line = t0
                zh_line = ""
        else:
            l1 = text_lines[0]
            l2 = text_lines[1]
            # If clearly swapped, fix:
            if _looks_like_zh(l1) and (not _looks_like_zh(l2)):
                en_line, zh_line = l2, _normalize_zh_punctuation(l1)
            else:
                en_line, zh_line = l1, _normalize_zh_punctuation(l2)

            # Vote based on which line is "more present"
            if en_line and not zh_line:
                en_votes += 1
            elif zh_line and not en_line:
                zh_votes += 1
            else:
                # If bilingual, vote for EN as the usual source.
                en_votes += 1

        candidates.append((start, end, en_line, zh_line))

    detected = "zh" if zh_votes > en_votes else "en"

    # Build segments with chosen source text based on detected
    segments: List[Segment] = []
    for s, e, en_line, zh_line in candidates:
        if detected == "zh":
            src = zh_line or en_line
        else:
            src = en_line or zh_line
        segments.append(Segment(s, e, src))

    return segments, detected


# -------------------------
# Main
# -------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    # NOTE: input_path is now optional so we can support:
    #   ai_service.py --input_srt <inputSrt> <outputSrt>
    ap.add_argument("input_path", nargs="?", help="Audio/video input (omit when using --input_srt)")
    ap.add_argument("output_srt_path", help="Output bilingual SRT path")
    ap.add_argument("--input_srt", default="", help="If set, re-translate from an existing SRT instead of transcribing")

    ap.add_argument("--model", default=os.getenv("WHISPER_MODEL", "small"))
    ap.add_argument("--device", default=os.getenv("WHISPER_DEVICE", "cpu"))
    ap.add_argument("--compute_type", default=os.getenv("WHISPER_COMPUTE_TYPE", "int8"))
    ap.add_argument("--language", default=os.getenv("WHISPER_LANGUAGE", ""))  # empty => auto
    ap.add_argument("--max_chars_en", type=int, default=int(os.getenv("SRT_MAX_CHARS_EN", "45")))
    ap.add_argument("--max_chars_zh", type=int, default=int(os.getenv("SRT_MAX_CHARS_ZH", "22")))
    ap.add_argument("--translate_model", default=os.getenv("TRANSLATE_MODEL", "facebook/nllb-200-distilled-600M"))
    args = ap.parse_args()

    out_srt = Path(args.output_srt_path).expanduser().resolve()

    try:
        emit("init", 5, "Starting AI service...")

        # Decide input mode
        if args.input_srt and args.input_srt.strip():
            in_srt = Path(args.input_srt).expanduser().resolve()
            if not in_srt.exists():
                raise FileNotFoundError(f"Input SRT not found: {in_srt}")

            emit("translate", 10, f"Loading input SRT: {in_srt}")
            segments, detected = load_segments_from_srt(in_srt)
            if not segments:
                raise RuntimeError("No valid cues found in input SRT.")
            emit("translate", 18, f"SRT loaded. Heuristic detected language: {detected}")
        else:
            if not args.input_path:
                raise ValueError("Missing input_path. Provide audio/video input or use --input_srt <path>.")
            in_path = Path(args.input_path).expanduser().resolve()
            if not in_path.exists():
                raise FileNotFoundError(f"Input file not found: {in_path}")

            segments, detected = transcribe(
                in_path,
                model_name=args.model,
                device=args.device,
                compute_type=args.compute_type,
                language=args.language,
            )

        detected_is_zh = detected.startswith("zh") or detected.startswith("yue")

        emit("translate", 40, "Initializing translator...")
        tr = Translator(args.translate_model)

        if detected_is_zh:
            emit("translate", 50, "Chinese source. Producing EN (top) + ZH (bottom).")

            def make_pair(src_zh: str) -> Tuple[str, str]:
                zh_line = _normalize_zh_punctuation(src_zh)
                en_line = tr.zh2en(src_zh)
                return en_line, zh_line

            max_chars_src = args.max_chars_zh
        else:
            emit("translate", 50, "English source. Producing EN (top) + ZH (bottom).")

            def make_pair(src_en: str) -> Tuple[str, str]:
                en_line = src_en
                zh_line = tr.en2zh(src_en)
                return en_line, zh_line

            max_chars_src = args.max_chars_en

        emit("srt", 60, "Generating bilingual SRT (EN on top, ZH below)...")
        write_bilingual_srt(segments, out_srt, make_pair=make_pair, max_chars_src=max_chars_src)

        emit("srt", 80, f"Wrote SRT: {out_srt}")
        emit("srt", 84, "SRT generation finished.")
        return 0

    except Exception as ex:
        eprint(f"ai_service.py failed: {ex}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
