#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ai_service.py

Audio/Video mode:
  python ai_service.py [--en_script EN.txt] [--zh_script ZH.txt] <inputPath> <srtPath>

SRT re-translate mode:
  python ai_service.py --input_srt <inputSrtPath> [--en_script EN.txt] [--zh_script ZH.txt] <outputSrtPath>

Transcription cache:
  Writes <outputSrt_dir>/transcription.json (complete=true)
  On rerun, if cache matches input mtime + model/backend, it resumes from cache.

Environment knobs:
  # Transcription
  TRANSCRIBE_BACKEND=auto|openai|faster        (default auto)
  TRANSCRIBE_DEVICE=auto|mps|cpu               (default auto; openai backend only)
  TRANSCRIBE_CACHE=1|0                         (default 1)
  TRANSCRIBE_CACHE_IGNORE=1|0                  (default 0)
  WHISPER_MODEL=small                          (default small)
  WHISPER_LANGUAGE=                             (default auto)
  WHISPER_DEVICE=cpu                           (faster-whisper only; default cpu)
  WHISPER_COMPUTE_TYPE=int8                    (faster-whisper only; default int8)

  # Translation
  TRANSLATE_BACKEND=auto|nllb|argos
  ALLOW_HF_DOWNLOAD=0|1
  TRANSLATE_BATCH_SIZE=16
  TRANSLATE_BEAMS=1
  TRANSLATE_MAX_NEW_TOKENS=128
  TRANSLATE_TORCH_DTYPE=auto|float16|float32

Emits JSONL progress to stdout:
  {"stage":"...","progress":...,"message":"..."}
"""

from __future__ import annotations

import argparse
import difflib
import json
import math
import os
import re
import sys
import time
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple


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


def _run_with_heartbeat(fn, label: str):
    """
    Runs fn() while emitting a heartbeat every TRANSLATE_HEARTBEAT_SEC seconds.
    Also enforces TRANSLATE_TIMEOUT_SEC (if > 0) to avoid infinite hangs.
    """
    hb_sec = float(os.getenv("TRANSLATE_HEARTBEAT_SEC", "5"))
    timeout_sec = float(os.getenv("TRANSLATE_TIMEOUT_SEC", "0"))  # 0 = no timeout

    stop = threading.Event()
    started = time.time()

    def heartbeat():
        k = 0
        while not stop.wait(hb_sec):
            k += 1
            elapsed = time.time() - started
            emit("translate", 56, f"[heartbeat {k}] still translating {label}… ({elapsed:.1f}s elapsed)")

    t = threading.Thread(target=heartbeat, daemon=True)
    t.start()

    try:
        if timeout_sec and timeout_sec > 0:
            result_box = {}
            err_box = {}

            def worker():
                try:
                    result_box["v"] = fn()
                except Exception as e:
                    err_box["e"] = e

            w = threading.Thread(target=worker, daemon=True)
            w.start()
            w.join(timeout=timeout_sec)

            if w.is_alive():
                raise TimeoutError(f"Translation timed out after {timeout_sec}s for {label}")
            if "e" in err_box:
                raise err_box["e"]
            return result_box.get("v")
        else:
            return fn()
    finally:
        stop.set()


# -------------------------
# Core data
# -------------------------
@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Cue:
    start: float
    end: float
    en: str
    zh: str


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
        0x4E00 <= o <= 0x9FFF
        or 0x3400 <= o <= 0x4DBF
        or 0x3000 <= o <= 0x303F
        or 0xFF00 <= o <= 0xFFEF
    )


def _looks_like_zh(text: str) -> bool:
    t = text or ""
    return any(_is_cjk_char(ch) for ch in t)


# -------------------------
# Chinese punctuation normalization
# -------------------------
def _normalize_zh_punctuation(text: str) -> str:
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
# Script loading
# -------------------------
def _read_text_file(p: Optional[str]) -> str:
    if not p:
        return ""
    pp = Path(p).expanduser().resolve()
    if not pp.exists():
        return ""
    return pp.read_text(encoding="utf-8", errors="ignore").strip()


# -------------------------
# Tokenization / detokenization for matching
# -------------------------
_en_tok_re = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?|[^\sA-Za-z0-9]")


def _tokenize_en(text: str) -> List[str]:
    t = clean_one_line(text)
    if not t:
        return []
    return _en_tok_re.findall(t)


def _detokenize_en(tokens: List[str]) -> str:
    if not tokens:
        return ""
    out: List[str] = []
    no_space_before = {",", ".", "!", "?", ":", ";", ")", "]", "}", "”", "’"}
    no_space_after = {"(", "[", "{", "“", "‘"}
    for i, tok in enumerate(tokens):
        if i == 0:
            out.append(tok)
            continue
        prev = out[-1] if out else ""
        if tok in no_space_before:
            out.append(tok)
        elif prev and prev[-1] in no_space_after:
            out.append(tok)
        else:
            out.append(" " + tok)
    return "".join(out).strip()


def _tokenize_zh(text: str) -> List[str]:
    t = clean_one_line(text)
    if not t:
        return []
    t = t.replace(" ", "")
    return list(t)


def _detokenize_zh(tokens: List[str]) -> str:
    return _normalize_zh_punctuation("".join(tokens).strip())


def _tokenize(text: str, lang: str) -> List[str]:
    return _tokenize_zh(text) if lang == "zh" else _tokenize_en(text)


def _detokenize(tokens: List[str], lang: str) -> str:
    return _detokenize_zh(tokens) if lang == "zh" else _detokenize_en(tokens)


def _apply_script_to_lines(lines: List[str], script_text: str, lang: str, label: str = "") -> List[str]:
    if not script_text.strip():
        return lines

    hyp_tokens: List[str] = []
    hyp_ranges: List[Tuple[int, int]] = []

    for ln in lines:
        st = len(hyp_tokens)
        toks = _tokenize(ln, lang)
        hyp_tokens.extend(toks)
        ed = len(hyp_tokens)
        hyp_ranges.append((st, ed))

    script_tokens = _tokenize(script_text, lang)
    if not hyp_tokens or not script_tokens:
        return lines

    sm = difflib.SequenceMatcher(a=hyp_tokens, b=script_tokens, autojunk=False)
    mapping: Dict[int, int] = {}
    for a0, b0, size in sm.get_matching_blocks():
        for k in range(size):
            mapping[a0 + k] = b0 + k

    out_lines: List[str] = []
    prev_end = -1

    for i, (a_st, a_ed) in enumerate(hyp_ranges):
        mapped = [mapping.get(ai) for ai in range(a_st, a_ed) if mapping.get(ai) is not None]
        mapped = [m for m in mapped if m is not None]
        if not mapped:
            out_lines.append(lines[i])
            continue

        mapped.sort()
        mapped = [m for m in mapped if m > prev_end]
        if not mapped:
            out_lines.append(lines[i])
            continue

        s = max(prev_end + 1, mapped[0])
        e = max(s, mapped[-1])

        s = max(0, min(s, len(script_tokens) - 1))
        e = max(0, min(e, len(script_tokens) - 1))

        new_ln = _detokenize(script_tokens[s : e + 1], lang)
        if not new_ln:
            out_lines.append(lines[i])
            continue

        out_lines.append(new_ln)
        prev_end = e

    if label:
        emit("translate", 55, f"Script matching applied for {label} ({lang}), {len(lines)} cues.")
    return out_lines


def _align_segments_to_script(segments: List[Segment], script_text: str, lang: str, label: str) -> List[Segment]:
    if not script_text.strip() or not segments:
        return segments
    lines = [s.text for s in segments]
    new_lines = _apply_script_to_lines(lines, script_text, lang, label=label)
    return [Segment(seg.start, seg.end, ln) for seg, ln in zip(segments, new_lines)]


# -------------------------
# Chunk splitting
# -------------------------
def split_text_chunks(text: str, max_chars: int) -> List[str]:
    t = clean_one_line(text)
    if not t:
        return []

    has_cjk = any(_is_cjk_char(ch) for ch in t)
    space_count = t.count(" ")
    cjk_mode = has_cjk and space_count <= max(1, len(t) // 30)

    if len(t) <= max_chars:
        return [t]

    if not cjk_mode:
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

        final: List[str] = []
        for c in out:
            if len(c) <= max_chars:
                final.append(c)
            else:
                for i in range(0, len(c), max_chars):
                    final.append(c[i : i + max_chars])
        return final

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


def expand_segments(segments: List[Segment], max_chars_src: int) -> List[Segment]:
    out: List[Segment] = []
    for seg in segments:
        src = clean_one_line(seg.text)
        if not src:
            continue
        chunks = split_text_chunks(src, max_chars=max_chars_src)
        out.extend(split_segment_by_chunks(seg, chunks))
    return out


# -------------------------
# Transcription cache
# -------------------------
def _transcription_cache_path(out_srt: Path) -> Path:
    return out_srt.parent / "transcription.json"


def _save_transcription_cache(
    cache_path: Path,
    input_path: Path,
    segments: List[Segment],
    detected: str,
    model_name: str,
    backend: str,
    complete: bool,
) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 2,
        "complete": bool(complete),
        "created_at": time.time(),
        "input_path": str(input_path),
        "input_mtime": float(input_path.stat().st_mtime),
        "model": model_name,
        "backend": backend,  # include device/fp16 in this string
        "detected_language": detected,
        "segments": [{"start": s.start, "end": s.end, "text": s.text} for s in segments],
    }
    cache_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _load_transcription_cache(
    cache_path: Path,
    input_path: Path,
    model_name: str,
    backend: str,
) -> Optional[Tuple[List[Segment], str]]:
    if not cache_path.exists():
        return None
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        if not payload.get("complete"):
            return None
        if int(payload.get("version", 0)) not in (1, 2):
            return None
        if str(payload.get("input_path", "")) != str(input_path):
            return None
        if float(payload.get("input_mtime", -1.0)) != float(input_path.stat().st_mtime):
            return None
        if str(payload.get("model", "")) != str(model_name):
            return None
        if int(payload.get("version", 0)) == 2:
            if str(payload.get("backend", "")) != str(backend):
                return None

        segs = [
            Segment(float(x["start"]), float(x["end"]), str(x["text"]))
            for x in payload.get("segments", [])
            if "start" in x and "end" in x and "text" in x
        ]
        detected = str(payload.get("detected_language", "auto"))
        if not segs:
            return None
        return segs, detected
    except Exception:
        return None


# -------------------------
# Whisper transcription backends
# -------------------------
def _can_use_openai_whisper_mps() -> bool:
    try:
        import torch  # noqa
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            import whisper  # noqa
            return True
    except Exception:
        return False
    return False


def _transcribe_openai_whisper_mps(
    input_path: Path,
    model_name: str,
    language: Optional[str],
) -> Tuple[List[Segment], str]:
    """
    Uses openai-whisper + PyTorch MPS (Metal) on Apple Silicon.

    IMPORTANT:
    - fp16 on MPS can produce NaNs during decoding for some setups.
      Default to fp16=False even on MPS for stability.
    """
    import torch
    import whisper

    device_env = os.getenv("TRANSCRIBE_DEVICE", "auto").strip().lower()
    if device_env in ("mps", "cpu"):
        device = device_env
    else:
        device = "mps" if (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()) else "cpu"

    # Default: fp16 OFF on MPS to prevent NaNs
    fp16_env = os.getenv("OPENAI_WHISPER_FP16", "").strip().lower()
    if fp16_env in ("1", "true", "yes"):
        fp16 = True
    elif fp16_env in ("0", "false", "no"):
        fp16 = False
    else:
        fp16 = False  # safest default on MPS

    # If device is CPU, fp16 should be False
    if device != "mps":
        fp16 = False

    emit("transcribe", 10, f"Loading OpenAI Whisper '{model_name}' on {device} (fp16={fp16})...")
    model = whisper.load_model(model_name, device=device)

    emit("transcribe", 18, "Transcribing with OpenAI Whisper...")
    lang = language.strip() if (language or "").strip() else None

    # Force fp16=False on MPS unless user explicitly turned it on.
    # This avoids NaN logits in decoder.
    result = model.transcribe(
        str(input_path),
        language=lang,
        fp16=fp16,
        verbose=False,
    )

    detected = (result.get("language") or (lang or "auto")).lower()
    segs_raw = result.get("segments") or []
    segments: List[Segment] = []
    for i, s in enumerate(segs_raw):
        segments.append(Segment(float(s["start"]), float(s["end"]), str(s.get("text", ""))))
        if i and i % 50 == 0:
            emit("transcribe", 30, f"Transcribed {i} segments...")

    emit("transcribe", 40, f"Transcription complete. Detected language: {detected}")
    return segments, detected


def _transcribe_faster_whisper(
    input_path: Path,
    model_name: str,
    device: str,
    compute_type: str,
    language: Optional[str],
    cache_path_for_partial: Optional[Path] = None,
) -> Tuple[List[Segment], str]:
    """
    Uses faster-whisper (CTranslate2). Device documented as cpu/cuda. :contentReference[oaicite:2]{index=2}
    """
    from faster_whisper import WhisperModel

    emit("transcribe", 10, f"Loading faster-whisper '{model_name}' ({device}/{compute_type})...")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    emit("transcribe", 18, "Transcribing with faster-whisper...")
    lang = language.strip() if (language or "").strip() else None
    seg_iter, info = model.transcribe(str(input_path), vad_filter=True, language=lang)

    detected = (info.language or (lang or "auto")).lower()
    segments: List[Segment] = []

    for i, s in enumerate(seg_iter):
        segments.append(Segment(float(s.start), float(s.end), str(s.text)))
        if i == 0:
            emit("transcribe", 28, "Receiving segments...")
        elif i % 50 == 0:
            emit("transcribe", 33, f"Transcribed {i} segments...")
            # Partial cache write (not resumable mid-way, but helpful for debugging/crash visibility)
            if cache_path_for_partial is not None:
                try:
                    _save_transcription_cache(
                        cache_path_for_partial,
                        input_path=input_path,
                        segments=segments,
                        detected=detected,
                        model_name=model_name,
                        backend="faster",
                        complete=False,
                    )
                except Exception:
                    pass

    emit("transcribe", 40, f"Transcription complete. Detected language: {detected}")
    return segments, detected


def transcribe_with_cache(
    input_path: Path,
    out_srt: Path,
    model_name: str,
    language: Optional[str],
    faster_device: str,
    faster_compute_type: str,
) -> Tuple[List[Segment], str]:
    cache_enabled = os.getenv("TRANSCRIBE_CACHE", "1").strip() != "0"
    cache_ignore = os.getenv("TRANSCRIBE_CACHE_IGNORE", "0").strip() == "1"

    backend = os.getenv("TRANSCRIBE_BACKEND", "auto").strip().lower()
    if backend not in ("auto", "openai", "faster"):
        backend = "auto"

    cache_path = _transcription_cache_path(out_srt)

    # Decide backend
    chosen = backend
    if backend == "auto":
        chosen = "openai" if _can_use_openai_whisper_mps() else "faster"

    # Build a backend key that includes device/fp16 for cache consistency
    # (OpenAI whisper may run on mps/cpu and fp16 on/off)
    if chosen == "openai":
        device_env = os.getenv("TRANSCRIBE_DEVICE", "auto").strip().lower()
        # resolve device the same way as _transcribe_openai_whisper_mps
        try:
            import torch
            if device_env in ("mps", "cpu"):
                device = device_env
            else:
                device = "mps" if (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()) else "cpu"
        except Exception:
            device = "cpu"

        fp16_env = os.getenv("OPENAI_WHISPER_FP16", "").strip().lower()
        if fp16_env in ("1", "true", "yes"):
            fp16 = True
        elif fp16_env in ("0", "false", "no"):
            fp16 = False
        else:
            fp16 = False
        if device != "mps":
            fp16 = False

        backend_key = f"openai:{device}:fp16={int(fp16)}"
    else:
        backend_key = f"faster:{faster_device}:{faster_compute_type}"

    emit("transcribe", 6, f"Transcription backend selected: {backend_key}")

    # Try cache
    if cache_enabled and (not cache_ignore):
        cached = _load_transcription_cache(cache_path, input_path, model_name, backend_key)
        if cached is not None:
            segs, detected = cached
            emit("transcribe", 45, f"Loaded transcription cache: {cache_path} ({len(segs)} segments).")
            return segs, detected

    # Transcribe with retries/fallbacks
    if chosen == "openai":
        try:
            segs, detected = _transcribe_openai_whisper_mps(input_path, model_name=model_name, language=language)
        except Exception as ex:
            # If MPS decoding produced NaNs or similar, retry on CPU fp32 automatically
            emit("transcribe", 14, f"OpenAI Whisper on MPS failed ({ex}). Retrying on CPU fp32...")

            os.environ["TRANSCRIBE_DEVICE"] = "cpu"
            os.environ["OPENAI_WHISPER_FP16"] = "0"

            # Update backend_key for cache save
            backend_key = "openai:cpu:fp16=0"

            segs, detected = _transcribe_openai_whisper_mps(input_path, model_name=model_name, language=language)
    else:
        segs, detected = _transcribe_faster_whisper(
            input_path,
            model_name=model_name,
            device=faster_device,
            compute_type=faster_compute_type,
            language=language,
            cache_path_for_partial=cache_path if cache_enabled else None,
        )

    # Save cache (complete)
    if cache_enabled:
        emit("transcribe", 47, f"Saving transcription cache to {cache_path}...")
        _save_transcription_cache(
            cache_path,
            input_path=input_path,
            segments=segs,
            detected=detected,
            model_name=model_name,
            backend=backend_key,
            complete=True,
        )
        emit("transcribe", 49, "Transcription cache saved.")

    return segs, detected


# -------------------------
# Load segments from SRT for re-translate
# -------------------------
def load_segments_from_srt(input_srt: Path) -> Tuple[List[Segment], str]:
    content = input_srt.read_text(encoding="utf-8", errors="ignore")
    blocks = re.split(r"\n\s*\n", content.strip())
    candidates: List[Tuple[float, float, str, str]] = []
    zh_votes = 0
    en_votes = 0

    for b in blocks:
        lines = [ln.strip("\ufeff").rstrip() for ln in b.splitlines() if ln.strip()]
        if not lines:
            continue

        if re.match(r"^\d+$", lines[0]):
            lines = lines[1:]
            if not lines:
                continue

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
            l1, l2 = text_lines[0], text_lines[1]
            if _looks_like_zh(l1) and (not _looks_like_zh(l2)):
                en_line, zh_line = l2, _normalize_zh_punctuation(l1)
            else:
                en_line, zh_line = l1, _normalize_zh_punctuation(l2)
            en_votes += 1

        candidates.append((start, end, en_line, zh_line))

    detected = "zh" if zh_votes > en_votes else "en"

    segments: List[Segment] = []
    for s, e, en_line, zh_line in candidates:
        src = (zh_line or en_line) if detected == "zh" else (en_line or zh_line)
        segments.append(Segment(s, e, src))

    return segments, detected


# -------------------------
# Translator (NLLB best-free local) + Argos fallback
# -------------------------
class Translator:
    def __init__(self, preferred_model: str) -> None:
        self._preferred_model = preferred_model
        self._mode = "none"

        backend = os.getenv("TRANSLATE_BACKEND", "auto").strip().lower()
        allow_download = os.getenv("ALLOW_HF_DOWNLOAD", "0").strip() == "1"

        self._num_beams = int(os.getenv("TRANSLATE_BEAMS", "1"))
        self._max_new_tokens = int(os.getenv("TRANSLATE_MAX_NEW_TOKENS", "128"))

        if backend not in ("auto", "nllb", "argos"):
            backend = "auto"

        if backend in ("auto", "nllb"):
            try:
                import torch  # noqa: F401
                from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # noqa: F401

                self._torch = __import__("torch")
                self._AutoTokenizer = __import__("transformers", fromlist=["AutoTokenizer"]).AutoTokenizer
                self._AutoModel = __import__("transformers", fromlist=["AutoModelForSeq2SeqLM"]).AutoModelForSeq2SeqLM

                if self._torch.cuda.is_available():
                    self._device = "cuda"
                elif hasattr(self._torch.backends, "mps") and self._torch.backends.mps.is_available():
                    self._device = "mps"
                else:
                    self._device = "cpu"

                dtype_env = os.getenv("TRANSLATE_TORCH_DTYPE", "auto").strip().lower()
                if dtype_env == "float16":
                    torch_dtype = self._torch.float16
                elif dtype_env == "float32":
                    torch_dtype = self._torch.float32
                else:
                    torch_dtype = self._torch.float16 if self._device in ("cuda", "mps") else self._torch.float32

                emit("translate", 41, f"PyTorch device selected: {self._device} | torch_dtype={str(torch_dtype).replace('torch.', '')}")
                emit("translate", 42, f"Preparing NLLB translator (beams={self._num_beams}, max_new_tokens={self._max_new_tokens}, allow_download={allow_download}).")

                load_kwargs = {"dtype": torch_dtype}
                if not allow_download:
                    load_kwargs["local_files_only"] = True

                if not allow_download:
                    self._tokenizer = self._AutoTokenizer.from_pretrained(preferred_model, local_files_only=True)
                else:
                    self._tokenizer = self._AutoTokenizer.from_pretrained(preferred_model)

                self._model = self._AutoModel.from_pretrained(preferred_model, **load_kwargs)
                self._model.to(self._device)
                self._model.eval()

                self._NLLB_EN = "eng_Latn"
                self._NLLB_ZH = "zho_Hans"

                self._mode = "nllb"
                emit("translate", 46, "Translation backend: NLLB (Transformers).")
                return
            except Exception as ex:
                if backend == "nllb":
                    raise
                emit("translate", 43, f"NLLB init failed; falling back to Argos. Details: {ex}")

        self._init_argos()
        self._mode = "argos"
        emit("translate", 46, "Translation backend: Argos (fallback/selected).")

    def _get_lang_id(self, lang_code: str) -> int:
        tok = self._tokenizer

        if hasattr(tok, "lang_code_to_id"):
            d = getattr(tok, "lang_code_to_id", None)
            if isinstance(d, dict) and lang_code in d:
                return int(d[lang_code])

        if hasattr(tok, "get_lang_id"):
            try:
                return int(tok.get_lang_id(lang_code))
            except Exception:
                pass

        if hasattr(tok, "convert_tokens_to_ids"):
            unk = getattr(tok, "unk_token_id", None)

            i = tok.convert_tokens_to_ids(lang_code)
            if isinstance(i, int) and (unk is None or i != unk) and i >= 0:
                return int(i)

            i2 = tok.convert_tokens_to_ids(f"<<{lang_code}>>")
            if isinstance(i2, int) and (unk is None or i2 != unk) and i2 >= 0:
                return int(i2)

        if hasattr(tok, "get_vocab"):
            vocab = tok.get_vocab() or {}
            if lang_code in vocab:
                return int(vocab[lang_code])
            if f"<<{lang_code}>>" in vocab:
                return int(vocab[f"<<{lang_code}>>"])

        raise RuntimeError(f"Could not resolve language token id for '{lang_code}'. Tokenizer={type(tok).__name__}.")

    def _nllb_translate_batch(self, texts: List[str], src_lang: str, tgt_lang: str) -> List[str]:
        cleaned = [clean_one_line(t) for t in texts]
        if hasattr(self._tokenizer, "src_lang"):
            self._tokenizer.src_lang = src_lang

        inputs = self._tokenizer(cleaned, return_tensors="pt", padding=True, truncation=True)
        inputs = {k: v.to(self._device) for k, v in inputs.items()}

        forced_bos = self._get_lang_id(tgt_lang)

        with self._torch.no_grad():
            out_ids = self._model.generate(
                **inputs,
                forced_bos_token_id=forced_bos,
                max_new_tokens=self._max_new_tokens,
                num_beams=self._num_beams,
                do_sample=False,
            )

        outs = self._tokenizer.batch_decode(out_ids, skip_special_tokens=True)
        return [clean_one_line(o) for o in outs]

    def en2zh_batch(self, texts: List[str]) -> List[str]:
        if self._mode == "nllb":
            outs = self._nllb_translate_batch(texts, self._NLLB_EN, self._NLLB_ZH)
        else:
            outs = [clean_one_line(self._argos_en2zh(t)) for t in texts]
        return [_normalize_zh_punctuation(o) for o in outs]

    def zh2en_batch(self, texts: List[str]) -> List[str]:
        if self._mode == "nllb":
            return self._nllb_translate_batch(texts, self._NLLB_ZH, self._NLLB_EN)
        return [clean_one_line(self._argos_zh2en(t)) for t in texts]

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


# -------------------------
# Write SRT
# -------------------------
def _write_srt(cues: List[Cue], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lines: List[str] = []
    for idx, c in enumerate(cues, start=1):
        lines.append(str(idx))
        lines.append(f"{srt_ts(c.start)} --> {srt_ts(c.end)}")
        lines.append(clean_one_line(c.en))
        lines.append(clean_one_line(c.zh))
        lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")


# -------------------------
# Main
# -------------------------
def main() -> int:
    ap = argparse.ArgumentParser()

    ap.add_argument("input_path", nargs="?", help="Audio/video input (omit when using --input_srt)")
    ap.add_argument("output_srt_path", help="Output bilingual SRT path")
    ap.add_argument("--input_srt", default="", help="Re-translate from an existing SRT instead of transcribing")

    ap.add_argument("--en_script", default="", help="Path to English transcript/script text")
    ap.add_argument("--zh_script", default="", help="Path to Chinese transcript/script text")

    ap.add_argument("--model", default=os.getenv("WHISPER_MODEL", "small"))
    ap.add_argument("--device", default=os.getenv("WHISPER_DEVICE", "cpu"))  # faster-whisper only
    ap.add_argument("--compute_type", default=os.getenv("WHISPER_COMPUTE_TYPE", "int8"))  # faster-whisper only
    ap.add_argument("--language", default=os.getenv("WHISPER_LANGUAGE", ""))  # empty => auto
    ap.add_argument("--max_chars_en", type=int, default=int(os.getenv("SRT_MAX_CHARS_EN", "45")))
    ap.add_argument("--max_chars_zh", type=int, default=int(os.getenv("SRT_MAX_CHARS_ZH", "22")))
    ap.add_argument("--translate_model", default=os.getenv("TRANSLATE_MODEL", "facebook/nllb-200-distilled-600M"))

    args = ap.parse_args()
    out_srt = Path(args.output_srt_path).expanduser().resolve()

    try:
        emit("init", 5, "Starting AI service...")

        batch_size = int(os.getenv("TRANSLATE_BATCH_SIZE", "16"))
        emit("translate", 7, f"Translation batch size: {batch_size}")

        en_script = _read_text_file(args.en_script)
        zh_script = _read_text_file(args.zh_script)

        if en_script:
            emit("translate", 8, "English script provided. Will match EN subtitles to script.")
        if zh_script:
            emit("translate", 9, "Chinese script provided. Will match ZH subtitles to script.")

        # Input
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

            # Transcribe (with cache + Apple GPU via OpenAI Whisper MPS when available)
            segments, detected = transcribe_with_cache(
                input_path=in_path,
                out_srt=out_srt,
                model_name=args.model,
                language=args.language,
                faster_device=args.device,
                faster_compute_type=args.compute_type,
            )

        detected_is_zh = detected.startswith("zh") or detected.startswith("yue")
        detected_is_en = not detected_is_zh

        # If a script exists for the SOURCE language, align segments first
        if detected_is_en and en_script:
            emit("translate", 25, "Matching English transcription to English script...")
            segments = _align_segments_to_script(segments, en_script, "en", label="source-en")
        if detected_is_zh and zh_script:
            emit("translate", 25, "Matching Chinese transcription to Chinese script...")
            segments = _align_segments_to_script(segments, zh_script, "zh", label="source-zh")

        emit("translate", 40, "Initializing translator...")
        tr = Translator(args.translate_model)

        # Expand into cue-sized segments
        max_chars_src = args.max_chars_zh if detected_is_zh else args.max_chars_en

        emit("srt", 58, "Splitting segments into subtitle-sized chunks...")
        pieces = expand_segments(segments, max_chars_src=max_chars_src)
        total = len(pieces)
        if total == 0:
            raise RuntimeError("No subtitle chunks produced.")

        emit("srt", 60, f"Generating bilingual SRT (batch translating {total} cues)...")

        cues: List[Cue] = []
        start_time = time.time()

        if detected_is_en:
            en_lines = [clean_one_line(p.text) for p in pieces]
            zh_lines: List[str] = [""] * total

            batches = (total + batch_size - 1) // batch_size
            for bi in range(batches):
                b0 = bi * batch_size
                b1 = min(total, b0 + batch_size)
                t0 = time.time()

                emit("srt", 60 + int(19 * (b0 / total)), f"Translating batch {bi+1}/{batches} ({b0+1}-{b1}/{total})")

                out = _run_with_heartbeat(
                    lambda: tr.en2zh_batch(en_lines[b0:b1]),
                    label=f"EN→ZH batch {bi+1}/{batches} ({b0+1}-{b1}/{total}) backend={tr._mode}",
                )
                zh_lines[b0:b1] = out

                dt = time.time() - t0
                emit("translate", 57, f"Batch {bi+1}/{batches} done in {dt:.2f}s (avg {(dt/max(1,(b1-b0))):.2f}s/cue)")

            for p, en, zh in zip(pieces, en_lines, zh_lines):
                cues.append(Cue(start=p.start, end=p.end, en=en, zh=_normalize_zh_punctuation(zh)))

        else:
            zh_lines = [_normalize_zh_punctuation(clean_one_line(p.text)) for p in pieces]
            en_lines: List[str] = [""] * total

            batches = (total + batch_size - 1) // batch_size
            for bi in range(batches):
                b0 = bi * batch_size
                b1 = min(total, b0 + batch_size)
                t0 = time.time()

                emit("srt", 60 + int(19 * (b0 / total)), f"Translating batch {bi+1}/{batches} ({b0+1}-{b1}/{total})")

                out = _run_with_heartbeat(
                    lambda: tr.zh2en_batch(zh_lines[b0:b1]),
                    label=f"ZH→EN batch {bi+1}/{batches} ({b0+1}-{b1}/{total}) backend={tr._mode}",
                )
                en_lines[b0:b1] = out

                dt = time.time() - t0
                emit("translate", 57, f"Batch {bi+1}/{batches} done in {dt:.2f}s (avg {(dt/max(1,(b1-b0))):.2f}s/cue)")

            for p, en, zh in zip(pieces, en_lines, zh_lines):
                cues.append(Cue(start=p.start, end=p.end, en=en, zh=zh))

        elapsed = time.time() - start_time
        emit("translate", 58, f"Translation complete: {total} cues in {elapsed:.1f}s (~{elapsed/max(1,total):.2f}s/cue).")

        # Apply script matching for target language too
        if en_script and not detected_is_en:
            emit("translate", 59, "Matching EN subtitle lines to English script...")
            new_en = _apply_script_to_lines([c.en for c in cues], en_script, "en", label="target-en")
            for c, nl in zip(cues, new_en):
                c.en = nl

        if zh_script and not detected_is_zh:
            emit("translate", 59, "Matching ZH subtitle lines to Chinese script...")
            new_zh = _apply_script_to_lines([c.zh for c in cues], zh_script, "zh", label="target-zh")
            for c, nl in zip(cues, new_zh):
                c.zh = _normalize_zh_punctuation(nl)

        _write_srt(cues, out_srt)

        emit("srt", 80, f"Wrote SRT: {out_srt}")
        emit("srt", 84, "SRT generation finished.")
        return 0

    except Exception as ex:
        eprint(f"ai_service.py failed: {ex}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
