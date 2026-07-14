"""ZhiXue wrapper around podcast-creator with transcript JSON repair.

The upstream podcast-creator graph parses each transcript segment strictly as
JSON. Some OpenAI-compatible models occasionally add a preface or produce a
partial object. This module keeps the upstream graph shape but replaces the
transcript node with a repair-aware version.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Union

from esperanto import AIFactory
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from loguru import logger
from podcast_creator.core import (
    Dialogue,
    clean_thinking_content,
    create_validated_transcript_parser,
    extract_text_content,
    get_outline_prompter,
    get_transcript_prompter,
    outline_parser,
)
from podcast_creator.episodes import load_episode_config
from podcast_creator.language import resolve_language_name
from podcast_creator.nodes import (
    combine_audio_node,
    generate_all_audio_node,
    route_audio_generation,
)
from podcast_creator.retry import create_retry_decorator, get_retry_config
from podcast_creator.speakers import load_speaker_config
from podcast_creator.state import PodcastState

THINKING_BLOCK_PATTERN = re.compile(
    r"<(?:think|thinking)>(.*?)</(?:think|thinking)>",
    re.DOTALL | re.IGNORECASE,
)
THINKING_NO_OPEN_PATTERN = re.compile(
    r"^(.*?)</(?:think|thinking)>",
    re.DOTALL | re.IGNORECASE,
)


def _truncate_for_repair(text: str, limit: int = 6000) -> str:
    if len(text) <= limit:
        return text
    return f"{text[: limit // 2]}\n\n...[truncated]...\n\n{text[-limit // 2:]}"


def _extract_first_json_object(text: str) -> str:
    """Return the first balanced JSON object in text, or the original text."""
    start = text.find("{")
    if start < 0:
        return text

    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1].strip()

    return text


def clean_transcript_json_output(content: str) -> str:
    """Clean model wrappers before strict transcript JSON parsing.

    Some OpenAI-compatible models emit hidden reasoning as <thinking>...</thinking>
    instead of <think>...</think>, or append troubleshooting text after the JSON.
    The upstream parser expects a bare JSON object, so normalize that here.
    """
    if not isinstance(content, str):
        content = str(content) if content is not None else ""

    cleaned = clean_thinking_content(content)
    cleaned = THINKING_BLOCK_PATTERN.sub("", cleaned)
    malformed_match = THINKING_NO_OPEN_PATTERN.match(cleaned)
    if malformed_match:
        cleaned = cleaned[malformed_match.end() :]

    cleaned = cleaned.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    return _extract_first_json_object(cleaned)


def limit_transcript_turns(dialogue: List[Dialogue], turns: int) -> List[Dialogue]:
    """Honor the requested segment length when compatible models over-generate."""
    return dialogue[: max(0, turns)]


def _build_transcript_repair_prompt(
    *,
    original_prompt: str,
    invalid_output: str,
    speaker_names: List[str],
) -> str:
    speakers = ", ".join(speaker_names)
    return f"""
The previous answer failed JSON parsing. Produce a corrected replacement.

Rules:
- Return only one JSON object, with no markdown fence, no explanation, and no prefix.
- The JSON object must have exactly one top-level key: "transcript".
- "transcript" must be an array of objects.
- Every object must contain both string fields: "speaker" and "dialogue".
- speaker must be one of: {speakers}
- Remove or regenerate any incomplete turn. Do not leave partial objects.

Original task:
<original_task>
{_truncate_for_repair(original_prompt, 9000)}
</original_task>

Invalid output:
<invalid_output>
{_truncate_for_repair(invalid_output)}
</invalid_output>
""".strip()


def _build_outline_repair_prompt(
    *,
    original_prompt: str,
    invalid_output: str,
    num_segments: int,
) -> str:
    return f"""
The previous answer failed JSON parsing. Produce a corrected replacement.

Rules:
- Return only one JSON object, with no XML tags, markdown fence, explanation, or prefix.
- The JSON object must have exactly one top-level key: "segments".
- "segments" must contain exactly {num_segments} objects.
- Every segment must contain string fields "name", "description", and "size".
- "size" must be one of: "short", "medium", "long".

Original task:
<original_task>
{_truncate_for_repair(original_prompt, 9000)}
</original_task>

Invalid output:
<invalid_output>
{_truncate_for_repair(invalid_output)}
</invalid_output>
""".strip()


async def generate_outline_node_with_repair(
    state: PodcastState,
    config: RunnableConfig,
) -> Dict:
    """Generate an outline while tolerating common model response wrappers."""
    logger.info("Starting outline generation with JSON repair")

    configurable = config.get("configurable", {})
    outline_provider: str = configurable.get("outline_provider", "openai")
    outline_model_name: str = configurable.get("outline_model", "gpt-4o-mini")
    outline_config = configurable.get("outline_config") or {}
    merged_config = {
        "max_tokens": 3000,
        "structured": {"type": "json"},
        **outline_config,
    }
    outline_model = AIFactory.create_language(
        outline_provider,
        outline_model_name,
        config=merged_config,
    ).to_langchain()

    retry_cfg = get_retry_config(configurable)
    llm_retry = create_retry_decorator(**retry_cfg)

    @llm_retry
    async def _invoke_and_parse(prompt_text: str):
        result = await outline_model.ainvoke(prompt_text)
        content = clean_transcript_json_output(extract_text_content(result.content))
        try:
            return outline_parser.invoke(content)
        except Exception as parse_error:
            logger.warning(
                "Outline JSON parse failed; asking model to repair output: {}",
                parse_error,
            )
            repair_prompt = _build_outline_repair_prompt(
                original_prompt=prompt_text,
                invalid_output=content,
                num_segments=state["num_segments"],
            )
            repair_result = await outline_model.ainvoke(repair_prompt)
            repair_content = clean_transcript_json_output(
                extract_text_content(repair_result.content)
            )
            return outline_parser.invoke(repair_content)

    outline_prompt = get_outline_prompter()
    outline_prompt_text = outline_prompt.render(
        {
            "briefing": state["briefing"],
            "num_segments": state["num_segments"],
            "context": state["content"],
            "speakers": state["speaker_profile"].speakers
            if state["speaker_profile"]
            else [],
            "language": state.get("language"),
        }
    )
    outline_result = await _invoke_and_parse(outline_prompt_text)
    logger.info("Generated outline with {} segments", len(outline_result.segments))
    return {"outline": outline_result}


async def generate_transcript_node_with_repair(
    state: PodcastState,
    config: RunnableConfig,
) -> Dict:
    """Generate conversational transcript with one repair pass per LLM call."""
    logger.info("Starting transcript generation with JSON repair")

    assert state.get("outline") is not None, "outline must be provided"
    assert state.get("speaker_profile") is not None, "speaker_profile must be provided"

    configurable = config.get("configurable", {})
    transcript_provider: str = configurable.get("transcript_provider", "openai")
    transcript_model_name: str = configurable.get("transcript_model", "gpt-4o-mini")
    transcript_config = configurable.get("transcript_config") or {}

    merged_config = {
        "max_tokens": 5000,
        "structured": {"type": "json"},
        **transcript_config,
    }
    transcript_model = AIFactory.create_language(
        transcript_provider,
        transcript_model_name,
        config=merged_config,
    ).to_langchain()

    speaker_profile = state["speaker_profile"]
    assert speaker_profile is not None, "speaker_profile must be provided"
    speaker_names = speaker_profile.get_speaker_names()
    validated_transcript_parser = create_validated_transcript_parser(speaker_names)

    retry_cfg = get_retry_config(configurable)
    llm_retry = create_retry_decorator(**retry_cfg)

    @llm_retry
    async def _invoke_and_parse(prompt_text: str, segment_name: str):
        result = await transcript_model.ainvoke(prompt_text)
        content = clean_transcript_json_output(extract_text_content(result.content))
        try:
            return validated_transcript_parser.invoke(content)
        except Exception as parse_error:
            logger.warning(
                "Transcript JSON parse failed for segment '{}'; asking model to repair output: {}",
                segment_name,
                parse_error,
            )
            repair_prompt = _build_transcript_repair_prompt(
                original_prompt=prompt_text,
                invalid_output=content,
                speaker_names=speaker_names,
            )
            repair_result = await transcript_model.ainvoke(repair_prompt)
            repair_content = clean_transcript_json_output(
                extract_text_content(repair_result.content)
            )
            return validated_transcript_parser.invoke(repair_content)

    outline = state["outline"]
    assert outline is not None, "outline must be provided"

    transcript: List[Dialogue] = []
    for i, segment in enumerate(outline.segments):
        logger.info(
            f"Generating transcript for segment {i + 1}/{len(outline.segments)}: {segment.name}"
        )

        is_final = i == len(outline.segments) - 1
        turns = 3 if segment.size == "short" else 6 if segment.size == "medium" else 10

        transcript_prompt = get_transcript_prompter()
        transcript_prompt_rendered = transcript_prompt.render(
            {
                "briefing": state["briefing"],
                "outline": outline,
                "context": state["content"],
                "segment": segment,
                "is_final": is_final,
                "turns": turns,
                "speakers": speaker_profile.speakers,
                "speaker_names": speaker_names,
                "transcript": transcript,
                "language": state.get("language"),
            }
        )
        result = await _invoke_and_parse(transcript_prompt_rendered, segment.name)
        limited_dialogue = limit_transcript_turns(result.transcript, turns)
        if len(result.transcript) > turns:
            logger.warning(
                "Transcript segment '{}' returned {} turns; keeping the requested {}",
                segment.name,
                len(result.transcript),
                turns,
            )
        transcript.extend(limited_dialogue)

    logger.info(f"Generated transcript with {len(transcript)} dialogue segments")
    return {"transcript": transcript}


def _build_graph():
    workflow = StateGraph(PodcastState)
    workflow.add_node("generate_outline", generate_outline_node_with_repair)
    workflow.add_node("generate_transcript", generate_transcript_node_with_repair)
    workflow.add_node("generate_all_audio", generate_all_audio_node)
    workflow.add_node("combine_audio", combine_audio_node)
    workflow.add_edge(START, "generate_outline")
    workflow.add_edge("generate_outline", "generate_transcript")
    workflow.add_conditional_edges(
        "generate_transcript",
        route_audio_generation,
        ["generate_all_audio"],
    )
    workflow.add_edge("generate_all_audio", "combine_audio")
    workflow.add_edge("combine_audio", END)
    return workflow.compile()


robust_podcast_graph = _build_graph()


async def create_podcast_with_repair(
    content: Union[str, List[str]],
    briefing: Optional[str] = None,
    episode_name: Optional[str] = None,
    output_dir: Optional[str] = None,
    speaker_config: Optional[str] = None,
    outline_provider: Optional[str] = None,
    outline_model: Optional[str] = None,
    transcript_provider: Optional[str] = None,
    transcript_model: Optional[str] = None,
    num_segments: Optional[int] = None,
    episode_profile: Optional[str] = None,
    briefing_suffix: Optional[str] = None,
    outline_config: Optional[Dict] = None,
    transcript_config: Optional[Dict] = None,
    retry_max_attempts: Optional[int] = None,
    retry_wait_multiplier: Optional[int] = None,
    language: Optional[str] = None,
) -> Dict:
    """Create a podcast using the robust ZhiXue graph."""
    if episode_profile:
        episode_config = load_episode_config(episode_profile)
        speaker_config = speaker_config or episode_config.speaker_config
        outline_provider = outline_provider or episode_config.outline_provider
        outline_model = outline_model or episode_config.outline_model
        transcript_provider = transcript_provider or episode_config.transcript_provider
        transcript_model = transcript_model or episode_config.transcript_model
        num_segments = num_segments or episode_config.num_segments
        outline_config = (
            outline_config
            if outline_config is not None
            else episode_config.outline_config
        )
        transcript_config = (
            transcript_config
            if transcript_config is not None
            else episode_config.transcript_config
        )
        language = language or episode_config.language

        if briefing:
            resolved_briefing = briefing
        elif briefing_suffix:
            resolved_briefing = (
                f"{episode_config.default_briefing}\n\nAdditional focus: {briefing_suffix}"
            )
        else:
            resolved_briefing = episode_config.default_briefing
    else:
        speaker_config = speaker_config or "ai_researchers"
        outline_provider = outline_provider or "openai"
        outline_model = outline_model or "gpt-4o-mini"
        transcript_provider = transcript_provider or "anthropic"
        transcript_model = transcript_model or "claude-3-5-sonnet-latest"
        num_segments = num_segments or 3
        resolved_briefing = briefing or ""

    if not episode_name:
        raise ValueError("episode_name is required")
    if not output_dir:
        raise ValueError("output_dir is required")
    if not speaker_config:
        raise ValueError("speaker_config is required")
    if not resolved_briefing:
        raise ValueError("briefing is required")

    resolved_language = resolve_language_name(language) if language else None
    speaker_profile = load_speaker_config(speaker_config)

    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True, parents=True)

    initial_state = PodcastState(
        content=content,
        briefing=resolved_briefing,
        num_segments=num_segments,
        language=resolved_language,
        outline=None,
        transcript=[],
        audio_clips=[],
        final_output_file_path=None,
        output_dir=output_path,
        episode_name=episode_name,
        speaker_profile=speaker_profile,
    )

    configurable: Dict = {
        "outline_provider": outline_provider,
        "outline_model": outline_model,
        "transcript_provider": transcript_provider,
        "transcript_model": transcript_model,
        "outline_config": outline_config,
        "transcript_config": transcript_config,
    }
    if retry_max_attempts is not None:
        configurable["retry_max_attempts"] = retry_max_attempts
    if retry_wait_multiplier is not None:
        configurable["retry_wait_multiplier"] = retry_wait_multiplier

    result = await robust_podcast_graph.ainvoke(
        initial_state,
        config={"configurable": configurable},
    )

    if result["outline"]:
        outline_path = output_path / "outline.json"
        outline_path.write_text(
            result["outline"].model_dump_json(),
            encoding="utf-8",
        )

    if result["transcript"]:
        transcript_path = output_path / "transcript.json"
        transcript_path.write_text(
            json.dumps(
                [d.model_dump() for d in result["transcript"]],
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    return {
        "outline": result["outline"],
        "transcript": result["transcript"],
        "final_output_file_path": result["final_output_file_path"],
        "audio_clips": result["audio_clips"],
        "audio_clips_count": len(result["audio_clips"]),
        "output_dir": output_path,
    }
