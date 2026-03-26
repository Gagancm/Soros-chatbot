import asyncio
import os
from typing import Optional

from transformers import pipeline

POPULAR_LOCAL_MODELS = {
    "Qwen/Qwen2.5-3B-Instruct": "Qwen2.5 3B Instruct",
    "microsoft/Phi-3.5-mini-instruct": "Phi-3.5 Mini Instruct (3.8B)",
}

LOCAL_PIPELINE_TASKS = ["text-generation", "any-to-any", "text2text-generation"]
LOCAL_MAX_NEW_TOKENS = 256
LOCAL_PROMPT_HEADROOM = 128
LOCAL_SNIPPET_LIMIT = 2
LOCAL_MODEL_TIMEOUT_SEC = int(os.getenv("LOCAL_MODEL_TIMEOUT_SEC", "180"))

_local_generators: dict[str, tuple[object, str]] = {}
_local_model_errs: dict[str, str] = {}
_local_generation_lock = asyncio.Semaphore(1)


class LocalModelBusyError(RuntimeError):
    pass


class LocalModelTimeoutError(RuntimeError):
    pass


def normalize_model_provider(provider: Optional[str]) -> str:
    value = (provider or "gemini").strip().lower()
    return value if value in {"gemini", "local"} else "gemini"


def _resolve_local_model_name(model_name: Optional[str]) -> str:
    env_default = os.getenv("LOCAL_MODEL_NAME", "Qwen/Qwen2.5-3B-Instruct")
    chosen = (model_name or env_default).strip()
    if chosen in POPULAR_LOCAL_MODELS:
        return chosen
    raise RuntimeError(
        f"Unsupported local model '{chosen}'. "
        f"Choose one of: {', '.join(POPULAR_LOCAL_MODELS)}"
    )


def _local_model(model_name: str):
    if model_name in _local_generators:
        return _local_generators[model_name]
    if model_name in _local_model_errs:
        raise RuntimeError(_local_model_errs[model_name])

    last_exc = None
    for task in LOCAL_PIPELINE_TASKS:
        try:
            generator = pipeline(task, model=model_name)
            cfg = getattr(getattr(generator, "model", None), "generation_config", None)
            if cfg is not None:
                cfg.max_new_tokens = LOCAL_MAX_NEW_TOKENS
                try:
                    cfg.max_length = None
                except Exception:
                    pass
                if task == "text-generation":
                    cfg.do_sample = True
                    cfg.temperature = 0.3
            _local_generators[model_name] = (generator, task)
            return _local_generators[model_name]
        except Exception as exc:
            last_exc = exc

    _local_model_errs[model_name] = (
        f"Local model unavailable: {last_exc}. "
        "Try another local model option."
    )
    raise RuntimeError(_local_model_errs[model_name])


def _truncate_prompt_for_local(generator, prompt: str) -> str:
    tokenizer = getattr(generator, "tokenizer", None)
    if tokenizer is None:
        return prompt
    model_max = getattr(tokenizer, "model_max_length", None)
    if not isinstance(model_max, int) or model_max <= 0 or model_max > 100000:
        return prompt
    max_input = max(64, model_max - LOCAL_PROMPT_HEADROOM)
    ids = tokenizer.encode(prompt, add_special_tokens=False)
    if len(ids) <= max_input:
        return prompt
    clipped = ids[-max_input:]
    return tokenizer.decode(clipped, skip_special_tokens=True)


def _extract_local_text(item) -> str:
    if isinstance(item, str):
        return item.strip()
    if not isinstance(item, dict):
        return ""

    direct = item.get("generated_text") or item.get("text") or item.get("answer")
    if isinstance(direct, str):
        return direct.strip()
    if isinstance(direct, list):
        parts = []
        for part in direct:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                content = part.get("content")
                if isinstance(content, str):
                    parts.append(content)
        return "\n".join(p for p in parts if p).strip()
    return ""


def _clip_text(text: Optional[str], max_chars: int) -> str:
    s = (text or "").strip()
    if len(s) <= max_chars:
        return s
    return s[:max_chars].rstrip() + "..."


def build_local_prompt(
    message: str,
    file_context: Optional[str],
    mode: Optional[str],
    ticker: Optional[str],
    retrieved: list[dict],
    enabled_modes: set[str],
) -> str:
    snippets = []
    for i, item in enumerate(retrieved[:LOCAL_SNIPPET_LIMIT], start=1):
        q = _clip_text(item.get("question"), 200)
        a = _clip_text(item.get("answer"), 360)
        snippets.append(f"{i}. Q: {q}\n   A: {a}")
    context_block = "\n".join(snippets) if snippets else "No matched Soros snippets."

    file_block = ""
    if file_context:
        file_block = f"\n[FILE SUMMARY]\n{_clip_text(file_context, 500)}\n"

    mode_line = f"\n[MODE]\n{mode}\n" if mode in enabled_modes else ""
    ticker_line = f"\n[TICKER]\n{ticker}\n" if ticker else ""

    question = _clip_text(message, 400)
    return (
        "You are an educational Soros-style assistant. "
        "Never provide buy/sell recommendations or financial advice.\n\n"
        "[TASK]\n"
        "Answer the user question in 5-8 concise sentences. "
        "Focus on reflexivity, narrative, risk, and uncertainty.\n\n"
        "[Soros snippets]\n"
        f"{context_block}\n"
        f"{file_block}"
        f"{mode_line}"
        f"{ticker_line}"
        "[USER QUESTION]\n"
        f"{question}\n"
    ).strip()


def generate_local_reply(prompt: str, local_model_name: Optional[str]) -> str:
    model_name = _resolve_local_model_name(local_model_name)
    generator, task = _local_model(model_name)
    local_prompt = _truncate_prompt_for_local(generator, prompt)
    result = generator(local_prompt)
    if isinstance(result, list) and result:
        text = _extract_local_text(result[0])
        if task == "text-generation" and text.startswith(local_prompt):
            text = text[len(local_prompt):].strip()
        if text:
            return text
    raise RuntimeError("Local model returned empty response.")


async def generate_local_with_limits(prompt: str, local_model_name: Optional[str]) -> str:
    if _local_generation_lock.locked():
        raise LocalModelBusyError("Local model is busy with another request. Please retry shortly.")
    async with _local_generation_lock:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(generate_local_reply, prompt, local_model_name),
                timeout=LOCAL_MODEL_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError as exc:
            raise LocalModelTimeoutError(
                f"Local model generation timed out after {LOCAL_MODEL_TIMEOUT_SEC}s."
            ) from exc
