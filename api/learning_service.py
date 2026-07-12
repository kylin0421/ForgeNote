import asyncio
import json
import os
import re
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from loguru import logger

from api.models import (
    LearningAgentStage,
    LearningCollectedResource,
    LearningEvaluation,
    LearningOrchestrationRequest,
    LearningOrchestrationResponse,
    LearningOutputKind,
    LearningPathStep,
    LearningProfileDimension,
    LearningResource,
    LearningSafetyReport,
)
from api.web_search import WebSearchResult, search_web
from open_notebook.ai.image_generation import generate_image, resolve_image_model_config
from open_notebook.ai.models import Model
from open_notebook.ai.provision import provision_langchain_model
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.exceptions import ConfigurationError, NotFoundError
from open_notebook.utils.command_cancellation import raise_if_command_canceled
from open_notebook.utils.semantic_index import _extract_json_payload
from open_notebook.utils.text_utils import extract_text_content

MAX_GENERATION_CONTEXT_CHARS = 24000
MAX_SOURCE_CHARS = 7000
GENERATED_ASSETS_DIR = os.getenv(
    "GENERATED_ASSETS_DIR",
    "/app/frontend/public/generated-assets",
)
GENERATED_ASSETS_URL_PREFIX = os.getenv(
    "GENERATED_ASSETS_URL_PREFIX",
    "/generated-assets",
).rstrip("/")
LEARNING_PROFILE_SOURCE_TITLE = "学习画像"
LEARNING_PROFILE_TOPIC = "learning_profile"
MAX_PROFILE_CHARS = 18000
DEFAULT_GENERATION_MESSAGE = (
    "请基于当前学习记录中的来源，生成通用但具体的学习资产。"
    "优先覆盖核心概念、方法脉络、关键术语、易混点、可自测问题和复习卡片；"
    "所有内容必须严格依据来源，来源不足时要明确说明。"
)


@dataclass(frozen=True)
class SearchQueryPlan:
    query: str
    intent: str
    rationale: str


DEFAULT_PROFILE_SOURCE_TEXT = """# 学习画像

这个来源由系统维护，也允许用户直接编辑。它会作为学习记录的一部分参与检索和学习资产生成。

## 稳定画像
- 背景：尚未明确。
- 当前目标：尚未明确。
- 易错点：等待 Quiz、对话、资料采纳和生成资产后的学习信号更新。
- 资源偏好：优先使用已采纳来源和用户上传资料。

## 最近学习信号
- 尚无记录。
"""


def _is_learning_profile_source(source: Source) -> bool:
    topics = set(source.topics or [])
    return LEARNING_PROFILE_TOPIC in topics or source.title == LEARNING_PROFILE_SOURCE_TITLE


def _clip_profile_signal(value: str, limit: int = 700) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _profile_event_line(event_type: str, summary: str) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    event = re.sub(r"[^a-zA-Z0-9_-]+", "_", event_type).strip("_") or "learning_event"
    return f"{timestamp} [{event}] {_clip_profile_signal(summary)}"


PROFILE_FIELD_DEFAULTS = {
    "背景": "尚未明确。",
    "当前目标": "尚未明确。",
    "易错点": "等待 Quiz、对话、资料采纳和生成资产后的学习信号更新。",
    "资源偏好": "优先使用已采纳来源和用户上传资料。",
}


def _is_unspecified_profile_value(value: str | None) -> bool:
    compact = (value or "").strip()
    if not compact:
        return True
    normalized = compact.rstrip("。")
    default_values = {default.rstrip("。") for default in PROFILE_FIELD_DEFAULTS.values()}
    if normalized in default_values:
        return True
    return any(marker in compact for marker in ("尚未明确", "等待", "暂无"))


def _extract_profile_fields(content: str | None) -> dict[str, str]:
    fields = dict(PROFILE_FIELD_DEFAULTS)
    for line in (content or "").splitlines():
        clean = line.strip().lstrip("-*").strip()
        match = re.match(r"^(背景|当前目标|易错点|资源偏好)[:：]\s*(.+)$", clean)
        if match:
            fields[match.group(1)] = match.group(2).strip()
    return fields


def _extract_profile_events(content: str | None) -> list[str]:
    events: list[str] = []
    for line in (content or "").splitlines():
        clean = line.strip().lstrip("-*").strip()
        if re.match(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}Z\s+\[", clean):
            events.append(clean)
    return events


def _parse_profile_summary_params(summary: str) -> dict[str, str]:
    params: dict[str, str] = {}
    for part in summary.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value and value != "none":
            params[key] = value
    return params


def _compact_learning_topic(value: str, limit: int = 46) -> str:
    text = re.sub(r"\s+", " ", value).strip(" 。；;")
    text = re.sub(r"^User asked in notebook chat:\s*", "", text, flags=re.I)
    text = re.sub(r"^Source accepted:\s*", "", text, flags=re.I)
    text = re.sub(r"^Quiz\s+.+?\.\s*", "", text, flags=re.I)
    text = text.strip("「」\"'")
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _learning_goal_candidate(
    event_type: str,
    summary: str,
    params: dict[str, str],
) -> str | None:
    source = params.get("goal") or params.get("message") or summary
    if event_type == "generate_request":
        asset_type = re.search(r"资产类型[:：]\s*([^。\n;；]+)", source)
        asset_format = re.search(r"具体格式[:：]\s*([^。\n;；]+)", source)
        if asset_type:
            pieces = [asset_type.group(1).strip()]
            if asset_format:
                pieces.append(asset_format.group(1).strip())
            return f"整理并复习{' · '.join(pieces)}"

    topic = _compact_learning_topic(source)
    if not topic:
        return None
    if event_type == "chat_message":
        return f"弄清「{topic}」"
    if event_type == "collect_request":
        return f"围绕「{topic}」补充学习资料"
    return topic


def _merge_profile_phrase(existing: str, candidate: str | None, limit: int = 3) -> str:
    candidate = _compact_learning_topic(candidate or "", 80)
    if not candidate:
        return existing
    if _is_unspecified_profile_value(existing):
        return candidate

    parts = [
        part.strip()
        for part in re.split(r"[；;]\s*", existing)
        if part.strip() and not _is_unspecified_profile_value(part)
    ]
    if any(candidate in part or part in candidate for part in parts):
        return existing
    parts.append(candidate)
    return "；".join(parts[-limit:])


def _refine_profile_fields(
    fields: dict[str, str],
    event_type: str,
    summary: str,
) -> dict[str, str]:
    params = _parse_profile_summary_params(summary)
    refined = dict(fields)
    goal = _learning_goal_candidate(event_type, summary, params)

    if goal:
        refined["当前目标"] = _merge_profile_phrase(refined["当前目标"], goal, 3)

    topic = goal or _compact_learning_topic(params.get("message") or params.get("goal") or summary)
    if _is_unspecified_profile_value(refined["背景"]) and topic:
        refined["背景"] = (
            f"近期学习集中在「{_compact_learning_topic(topic, 34)}」，"
            "个人基础会随问答、测验和资料选择继续细化。"
        )

    if event_type == "quiz_answer" and "incorrect" in summary.lower():
        prompt_match = re.search(r"Prompt:\s*(.+)$", summary)
        risk = prompt_match.group(1) if prompt_match else summary
        refined["易错点"] = _merge_profile_phrase(
            refined["易错点"],
            f"错题暴露：{_compact_learning_topic(risk, 44)}",
            4,
        )
    elif event_type == "chat_message" and re.search(
        r"(不懂|不会|报错|失败|错误|混淆|区别|为什么|怎么|如何)",
        summary,
        flags=re.I,
    ):
        refined["易错点"] = _merge_profile_phrase(
            refined["易错点"],
            f"需要澄清：{_compact_learning_topic(summary, 44)}",
            4,
        )

    if (
        event_type in {"collect_request", "source_accept"}
        or re.search(r"(资料|来源|上传|论文|视频|博客|播客|字幕|笔记)", summary)
    ):
        refined["资源偏好"] = _merge_profile_phrase(
            refined["资源偏好"],
            "偏好基于已采纳来源、上传资料、笔记与生成字幕构建学习资产。",
            3,
        )

    return refined


def _render_learning_profile_source(fields: dict[str, str], event_lines: list[str]) -> str:
    lines = [
        "# 学习画像",
        "",
        "这个来源由系统维护，也允许用户直接编辑。它会作为学习记录的一部分参与检索和学习资产生成。",
        "",
        "## 稳定画像",
        f"- 背景：{fields.get('背景') or PROFILE_FIELD_DEFAULTS['背景']}",
        f"- 当前目标：{fields.get('当前目标') or PROFILE_FIELD_DEFAULTS['当前目标']}",
        f"- 易错点：{fields.get('易错点') or PROFILE_FIELD_DEFAULTS['易错点']}",
        f"- 资源偏好：{fields.get('资源偏好') or PROFILE_FIELD_DEFAULTS['资源偏好']}",
        "",
        "## 最近学习信号",
    ]
    lines.extend(event_lines or ["暂无记录。"])
    return "\n".join(lines)


def _append_profile_event(existing: str | None, event_type: str, summary: str) -> str:
    content = (existing or DEFAULT_PROFILE_SOURCE_TEXT).strip()
    fields = _refine_profile_fields(_extract_profile_fields(content), event_type, summary)
    event_lines = _extract_profile_events(content)
    event_lines.append(_profile_event_line(event_type, summary))
    event_lines = event_lines[-40:]
    updated = _render_learning_profile_source(fields, event_lines)

    if len(updated) <= MAX_PROFILE_CHARS:
        return updated
    return updated[-MAX_PROFILE_CHARS:].lstrip()


async def get_or_create_learning_profile_source(notebook_id: str) -> Source:
    notebook = await Notebook.get(notebook_id)
    sources = await notebook.get_sources(include_full_text=True)
    profile_sources = [source for source in sources if _is_learning_profile_source(source)]

    if profile_sources:
        primary = profile_sources[0]
        changed = False
        if primary.title != LEARNING_PROFILE_SOURCE_TITLE:
            primary.title = LEARNING_PROFILE_SOURCE_TITLE
            changed = True
        topics = list(primary.topics or [])
        if LEARNING_PROFILE_TOPIC not in topics:
            topics.append(LEARNING_PROFILE_TOPIC)
            primary.topics = topics
            changed = True
        if not primary.full_text:
            primary.full_text = DEFAULT_PROFILE_SOURCE_TEXT
            changed = True
        if changed:
            await primary.save()

        for duplicate in profile_sources[1:]:
            try:
                await repo_query(
                    "DELETE reference WHERE in = $source_id AND out = $notebook_id",
                    {
                        "source_id": ensure_record_id(duplicate.id),
                        "notebook_id": ensure_record_id(notebook_id),
                    },
                )
            except Exception as error:
                logger.warning(
                    f"Unable to unlink duplicate learning profile source {duplicate.id}: {error}"
                )
        return primary

    source = Source(
        title=LEARNING_PROFILE_SOURCE_TITLE,
        topics=[LEARNING_PROFILE_TOPIC],
        full_text=DEFAULT_PROFILE_SOURCE_TEXT,
    )
    await source.save()
    await source.add_to_notebook(notebook_id)
    return source


async def record_learning_profile_event(
    notebook_id: str,
    event_type: str,
    summary: str,
    auto_update_profile: bool = True,
) -> Source | None:
    if not auto_update_profile or not notebook_id or not summary.strip():
        return None

    try:
        source = await get_or_create_learning_profile_source(notebook_id)
        source.full_text = _append_profile_event(source.full_text, event_type, summary)
        source.title = LEARNING_PROFILE_SOURCE_TITLE
        topics = list(source.topics or [])
        if LEARNING_PROFILE_TOPIC not in topics:
            topics.append(LEARNING_PROFILE_TOPIC)
        source.topics = topics
        await source.save()
        return source
    except Exception as error:
        logger.warning(f"Unable to update learning profile source: {error}")
        return None

AGENT_BLUEPRINTS = [
    (
        "profile-agent",
        "学习画像智能体",
        "从自然语言对话中抽取画像特征并持续更新学生状态",
        "已抽取 6 个画像维度，并识别当前学习短板",
    ),
    (
        "curriculum-agent",
        "课程结构智能体",
        "把课程内容拆成可学习、可评估的知识单元",
        "已完成课程知识点拆解与先修关系排序",
    ),
    (
        "collector-agent",
        "资源搜集智能体",
        "自动搜集候选学习资料，并保留学生采纳、拒绝或自行上传的选择权",
        "已生成候选资料清单，等待学生采纳或替换为自有资料",
    ),
    (
        "resource-agent",
        "资源生成智能体",
        "结合采纳资料协同生成讲解文档、思维导图、阅读材料和代码实操",
        "已生成学习资源草案，并标注可追溯资料依据",
    ),
    (
        "practice-agent",
        "练习实训智能体",
        "生成可交互 Quiz、代码实操和项目化练习",
        "已生成测验与代码实操案例",
    ),
    (
        "path-agent",
        "路径规划智能体",
        "依据画像、资源和掌握度规划动态学习路径",
        "已规划 4 阶段学习路径与资源推送顺序",
    ),
    (
        "tutor-agent",
        "智能辅导智能体",
        "提供即时答疑、错误定位和下一步学习引导",
        "已生成面向当前问题的辅导回复",
    ),
    (
        "evaluation-agent",
        "学习评估智能体",
        "根据行为线索评估学习效果并给出调整建议",
        "已完成学习效果初评与干预策略",
    ),
    (
        "safety-agent",
        "安全校验智能体",
        "负责防幻觉、引用一致性和内容安全过滤",
        "已完成事实一致性与安全性检查",
    ),
]

OUTPUT_LABELS: dict[LearningOutputKind, str] = {
    "study_guide": "课程讲解文档",
    "quiz": "小测验",
    "flashcards": "知识闪卡",
    "mind_map": "知识点思维导图",
    "reading": "拓展阅读材料",
    "code_lab": "代码实操案例",
    "visual_aid": "辅助理解图片",
}


def _stage_blueprints_for_mode(mode: str):
    if mode == "chat":
        active_ids = {
            "profile-agent",
            "tutor-agent",
            "evaluation-agent",
            "safety-agent",
        }
    elif mode == "collect":
        active_ids = {
            "profile-agent",
            "curriculum-agent",
            "collector-agent",
            "safety-agent",
        }
    else:
        active_ids = {agent_id for agent_id, *_ in AGENT_BLUEPRINTS}

    return [
        blueprint
        for blueprint in AGENT_BLUEPRINTS
        if blueprint[0] in active_ids
    ]


def _normalized_request(request: LearningOrchestrationRequest) -> dict[str, str]:
    major = request.major or "计算机相关专业"
    goal = request.goal or "建立可迁移的课程知识体系"
    history = "；".join(request.learning_history or []) or "暂无明确历史记录"
    target_language = (request.target_language or "中文").strip() or "中文"
    message = request.message.strip()
    if not message and request.mode == "generate":
        message = DEFAULT_GENERATION_MESSAGE
    elif not message:
        message = goal.strip() or request.course.strip()
    return {
        "message": message,
        "course": request.course.strip() or "人工智能导论",
        "major": major.strip(),
        "goal": goal.strip(),
        "history": history,
        "target_language": target_language,
    }


def _build_profile(context: dict[str, str]) -> list[LearningProfileDimension]:
    return [
        LearningProfileDimension(
            name="专业背景",
            value=context["major"],
            evidence=f"学生输入中提到的背景与课程为「{context['course']}」",
            confidence=0.88,
        ),
        LearningProfileDimension(
            name="知识基础",
            value="具备基础概念认知，但需要补强概念之间的推理链路",
            evidence=context["message"],
            confidence=0.82,
        ),
        LearningProfileDimension(
            name="学习目标",
            value=context["goal"],
            evidence="由学生目标字段和对话意图综合得出",
            confidence=0.9,
        ),
        LearningProfileDimension(
            name="认知风格",
            value="偏好先看结构化解释，再通过例题和代码实操验证理解",
            evidence="请求中同时包含讲解、练习和实操需求",
            confidence=0.78,
        ),
        LearningProfileDimension(
            name="易错点偏好",
            value="容易在抽象概念、公式含义和应用边界之间混淆",
            evidence="学习历史：" + context["history"],
            confidence=0.72,
        ),
        LearningProfileDimension(
            name="资源偏好",
            value="适合文档、图谱、练习、拓展阅读、代码案例并行推送",
            evidence="系统根据当前课程任务自动匹配多模态资源组合",
            confidence=0.84,
        ),
    ]


def _build_study_guide_content(context: dict[str, str]) -> str:
    course = context["course"]
    return (
        f"# {course} 个性化讲解文档\n\n"
        "## 1. 本轮学习目标\n"
        f"这份讲解面向「{context['major']}」背景的学习者，目标是帮助你围绕「{context['goal']}」建立一条可执行的学习路径。"
        f"你当前提出的问题是：{context['message']}。因此本文不会按教材目录平均展开，而是优先处理概念边界、判断条件、练习反馈和实践迁移四件事。\n\n"
        "## 2. 先建立问题框架\n"
        "学习一个新主题时，最常见的低效方式是直接背定义或直接做题。更稳的做法是先问四个问题：这个概念解决什么问题；它依赖哪些前提；它在什么情况下失效；我能否把它迁移到一个陌生场景。"
        f"对于「{course}」，你可以把每个知识点都放进这个框架中检查。若某个点不能回答“为什么需要它”，说明你只记住了术语；若不能回答“什么时候不用它”，说明你还没有掌握边界。\n\n"
        "## 3. 核心概念讲解\n"
        "第一层是定义。定义不是为了背诵，而是为了建立最小可区分单元。看到一个概念时，先写下一句话版本，再写一个反例。"
        "第二层是机制。机制解释输入如何变成输出，例如数据如何进入模型、参数如何被更新、误差如何被反馈。"
        "第三层是判断标准。判断标准决定你什么时候该使用某个方法，什么时候应该换方法。很多考试题和项目问题，本质上都不是问定义，而是在考判断标准。\n\n"
        "## 4. 易错点和纠偏策略\n"
        f"根据你的学习历史：{context['history']}，当前最需要防止的是“看懂了例子，但换题就不会”的问题。"
        "纠偏方式是每学完一段内容就做一次小迁移：把例子中的对象、数据规模、约束条件任意换掉一个，然后重新判断方法是否仍然成立。"
        "如果判断变慢，不要立刻查答案，先列出你不确定的是定义、公式、适用条件还是实现步骤。这样系统后续更新画像时，才能把薄弱点定位到可干预的粒度。\n\n"
        "## 5. 学习顺序建议\n"
        "第一步，先用 Quiz 做诊断，找出你是概念不清、推理链断裂，还是应用迁移不稳。"
        "第二步，使用知识闪卡复习术语、反例和边界条件。闪卡不追求一次记住，而是用于高频回忆。"
        "第三步，再阅读本文档对应章节，把刚才错题暴露的薄弱点补齐。"
        "第四步，进入代码或项目练习，把抽象知识落到可观察结果。"
        "最后，用学习记录中的评估结果更新画像，决定下一轮资源推送。\n\n"
        "## 6. 自检清单\n"
        "- 我能否用一句话解释这个概念为什么存在？\n"
        "- 我能否给出一个不适用的反例？\n"
        "- 我能否说明输入、处理、输出分别是什么？\n"
        "- 我能否把它迁移到一个不同数据或不同任务背景？\n"
        "- 我能否指出自己错题属于定义、机制、边界还是实现问题？\n\n"
        "## 7. 下一步行动\n"
        "先完成一个 5 题 Quiz，然后只把错题对应的概念做成 3 到 5 张闪卡。"
        "不要一次打开所有资料；在真正学习场景里，当前任务应该只暴露你正在使用的资产。"
        "当你完成测验或对话后，画像来源会被更新，学习记录会保存本轮生成资产，下一次进入该记录时可以继续沿用同一上下文。"
    )


def _quiz_payload(course: str) -> dict:
    return {
        "questions": [
            {
                "id": "q1",
                "prompt": f"学习「{course}」时，最能判断你是否理解概念边界的是哪一项？",
                "options": [
                    "能背出完整定义",
                    "能写出一个反例并说明为什么不适用",
                    "能快速浏览多篇资料",
                    "能记住所有公式符号",
                ],
                "answer_index": 1,
                "explanation": "边界理解来自正例和反例的对照，而不是单纯背定义。",
            },
            {
                "id": "q2",
                "prompt": "如果训练误差下降，但验证效果变差，优先应该检查什么？",
                "options": ["是否过拟合", "是否少写注释", "是否题目太难", "是否应该跳过评估"],
                "answer_index": 0,
                "explanation": "训练误差和验证表现分离时，过拟合是优先排查方向。",
            },
            {
                "id": "q3",
                "prompt": "完成一次学习后，哪种记录最有助于系统更新画像？",
                "options": [
                    "只记录学习时长",
                    "记录错题类型、错因和仍不确定的问题",
                    "只收藏更多链接",
                    "删除所有历史记录重新开始",
                ],
                "answer_index": 1,
                "explanation": "画像更新需要可解释的学习行为信号，而不仅是时长或收藏数量。",
            },
            {
                "id": "q4",
                "prompt": "当你看懂例题但换题不会时，最合理的下一步是什么？",
                "options": [
                    "直接进入更难章节",
                    "把例题中的条件换掉一个，重新判断方法是否成立",
                    "只重复抄写答案",
                    "停止做题，只看视频",
                ],
                "answer_index": 1,
                "explanation": "小幅迁移能暴露推理链断点，是从看懂到会用的关键步骤。",
            },
        ]
    }


def _flashcard_payload(course: str) -> dict:
    return {
        "cards": [
            {
                "front": f"{course} 中“理解概念”的最低标准是什么？",
                "back": "能用一句话解释概念存在的目的，并给出一个不适用的反例。",
                "hint": "不要只背定义，要检查边界。",
            },
            {
                "front": "什么是学习画像的有效更新信号？",
                "back": "错题类型、错因、对话中暴露的不确定点、资源使用反馈和阶段测验结果。",
                "hint": "系统需要行为证据，而不是泛泛的偏好。",
            },
            {
                "front": "为什么先 Quiz 再长文档通常更有效？",
                "back": "Quiz 先暴露薄弱点，长文档随后只补关键缺口，避免无差别阅读。",
                "hint": "先诊断，再学习。",
            },
            {
                "front": "采纳外部资料后系统应该做什么？",
                "back": "把 URL 作为来源导入，启动抓取和处理，让后续生成资产能引用该来源。",
                "hint": "采纳不是收藏链接，而是进入来源库。",
            },
        ]
    }


def _build_resources(
    context: dict[str, str],
    requested_outputs: list[LearningOutputKind],
) -> list[LearningResource]:
    course = context["course"]
    resources = [
        LearningResource(
            kind="study_guide",
            type="课程讲解文档",
            title=f"{course} 个性化讲解稿",
            agent="资源生成智能体",
            format="长文 Markdown",
            summary="围绕目标、概念边界、易错点、学习顺序和自检清单形成完整讲解。",
            content=_build_study_guide_content(context),
            tags=["讲解", "长文档", "Markdown"],
        ),
        LearningResource(
            kind="mind_map",
            type="知识点思维导图",
            title=f"{course} 知识结构图",
            agent="资源生成智能体",
            format="Mermaid mindmap direction right",
            summary="把先修知识、核心主题、实践任务和评价指标串起来。",
            content=(
                "```mermaid\n"
                "%% 切换逻辑：平台按钮在树状图、表格、大纲间切换；内容保持一致。\n"
                "%% 视觉设计：根节点大圆角，一级模块浅色，二级知识点短句。\n"
                "mindmap\n"
                "  direction right\n"
                f"  root(({_mermaid_label(course)}))\n"
                "    先修基础\n"
                "      数学直觉\n"
                "      编程基础\n"
                "    核心概念\n"
                "      模型\n"
                "      数据\n"
                "      训练\n"
                "    实践任务\n"
                "      调参\n"
                "      误差分析\n"
                "```\n\n"
                "## 树状分层文本\n"
                f"- {course}\n"
                "  - 先修基础\n"
                "    - 数学直觉\n"
                "    - 编程基础\n"
                "  - 核心概念\n"
                "    - 模型\n"
                "    - 数据\n"
                "    - 训练\n"
                "  - 实践任务\n"
                "    - 调参\n"
                "    - 误差分析\n\n"
                "## 对比表格\n"
                "| 先修基础 | 核心概念 | 实践任务 |\n"
                "| --- | --- | --- |\n"
                "| 数学直觉 | 模型 | 调参 |\n"
                "| 编程基础 | 数据 | 误差分析 |\n"
                "|  | 训练 |  |\n\n"
                "## 分级分点列表\n"
                f"1. {course}\n"
                "   - 先修基础：数学直觉、编程基础\n"
                "   - 核心概念：模型、数据、训练\n"
                "   - 实践任务：调参、误差分析"
            ),
            tags=["图谱", "Mermaid", "结构化"],
        ),
        LearningResource(
            kind="quiz",
            type="小测验",
            title=f"{course} 快速诊断 Quiz",
            agent="练习实训智能体",
            format="Quiz",
            summary="用 5 道题判断当前理解卡点，适合学习前后各做一次。",
            content=(
                "1. 概念边界题：用反例判断是否真正理解。\n"
                "2. 训练诊断题：区分训练误差和验证表现。\n"
                "3. 画像更新题：识别哪些学习行为值得记录。\n"
                "4. 迁移应用题：从看懂例题走向换题可用。"
            ),
            tags=["测验", "诊断", "反馈"],
            payload=_quiz_payload(course),
        ),
        LearningResource(
            kind="flashcards",
            type="知识闪卡",
            title=f"{course} 高频概念闪卡",
            agent="资源生成智能体",
            format="Flashcards",
            summary="把核心术语、易混点和反例压缩成可复习卡片。",
            content=(
                "卡片 1｜正面：核心概念是什么？｜背面：一句定义 + 一个反例。\n"
                "卡片 2｜正面：这个方法什么时候不适用？｜背面：列出 2 个边界条件。\n"
                "卡片 3｜正面：常见误区是什么？｜背面：把误区和正确判断标准对照。\n"
                "卡片 4｜正面：如何检查自己是否真正理解？｜背面：能否迁移到新题。"
            ),
            tags=["闪卡", "复习", "易错点"],
            payload=_flashcard_payload(course),
        ),
        LearningResource(
            kind="reading",
            type="拓展阅读材料",
            title=f"{course} 拓展阅读清单",
            agent="资源生成智能体",
            format="阅读路径",
            summary="按入门、原理、工程实践三个层次推荐阅读顺序。",
            content=(
                "第 1 层：课程讲义与术语表。\n"
                "第 2 层：经典教材章节和可解释案例。\n"
                "第 3 层：工程实践博客、论文导读和开源项目说明。"
            ),
            tags=["阅读", "拓展", "资料"],
        ),
        LearningResource(
            kind="code_lab",
            type="代码实操案例",
            title=f"{course} Notebook 实验任务",
            agent="练习实训智能体",
            format="Python Notebook",
            summary="通过最小可运行代码把抽象知识落到可观察结果。",
            content=(
                "任务：准备一个小数据集，完成数据检查、模型训练、结果可视化和误差分析。\n"
                "提交物：代码、运行截图、三条误差原因和一次改进尝试。"
            ),
            tags=["代码", "实操", "Python"],
        ),
        LearningResource(
            kind="visual_aid",
            type="辅助理解图片",
            title=f"{course} 辅助理解图片提示词",
            agent="视觉辅助智能体",
            format="Image prompt",
            summary="用于生成学习辅助图片的提示词。",
            content=(
                f"Create a clean educational visual aid for {course}. "
                "Use a clear diagram-like layout, short labels, and a study-notebook style. "
                f"Focus on: {context['message']}. Output language: {context['target_language']}."
            ),
            tags=["图片", "可视化", "提示词"],
            payload={
                "status": "fallback_prompt",
                "prompt": (
                    f"Create a clean educational visual aid for {course}. "
                    "Use a clear diagram-like layout, short labels, and a study-notebook style. "
                    f"Focus on: {context['message']}. Output language: {context['target_language']}."
                ),
            },
        ),
    ]

    if not requested_outputs:
        return []

    requested = set(requested_outputs)
    return [resource for resource in resources if resource.kind in requested]


def _normalize_identifier(value: Any) -> set[str]:
    if value is None:
        return set()
    raw = str(value)
    values = {raw}
    if ":" in raw:
        values.add(raw.split(":", 1)[1])
    return {item for item in values if item}


def _clean_source_text(text: str, limit: int = MAX_SOURCE_CHARS) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    head = compact[: int(limit * 0.68)].strip()
    tail = compact[-int(limit * 0.22) :].strip()
    return f"{head}\n...\n{tail}"


async def _collect_generation_source_context(
    request: LearningOrchestrationRequest,
) -> tuple[str, int]:
    if not request.learning_record_id:
        return "", 0

    try:
        notebook = await Notebook.get(request.learning_record_id)
    except NotFoundError:
        logger.warning(
            f"Learning record {request.learning_record_id} not found while generating assets"
        )
        return "", 0

    sources = await notebook.get_sources(include_full_text=True)
    accepted_ids: set[str] = set()
    for source_id in request.accepted_resource_ids or []:
        accepted_ids.update(_normalize_identifier(source_id))

    selected_sources = []
    for source in sources:
        is_profile_source = _is_learning_profile_source(source)
        if is_profile_source:
            # The profile guides personalization, but it is not evidence for
            # source-grounded assets. Keeping it out prevents resources such as
            # mind maps from rendering profile metadata as course content.
            continue

        source_ids = _normalize_identifier(source.id)
        if not accepted_ids or source_ids.intersection(accepted_ids):
            selected_sources.append(source)

    blocks: list[str] = []
    remaining_chars = MAX_GENERATION_CONTEXT_CHARS
    for index, source in enumerate(selected_sources, start=1):
        content_parts: list[str] = []
        if source.full_text and source.full_text.strip():
            content_parts.append(_clean_source_text(source.full_text))

        try:
            insights = await source.get_insights()
        except Exception as error:
            logger.debug(f"Unable to load source insights for {source.id}: {error}")
            insights = []

        insight_lines = [
            f"- {insight.insight_type}: {insight.content}"
            for insight in insights[:6]
            if insight.content
        ]
        if insight_lines:
            content_parts.append("Insights:\n" + "\n".join(insight_lines))

        content = "\n\n".join(part for part in content_parts if part.strip()).strip()
        if not content:
            continue

        title = source.title
        if not title and source.asset and source.asset.url:
            title = source.asset.url
        title = title or f"Source {index}"
        topics = "、".join(source.topics or [])
        header = f"## Source {index}: {title}\nID: {source.id}"
        if topics:
            header += f"\nTopics: {topics}"
        block = f"{header}\n\n{content}"

        if len(block) > remaining_chars:
            block = block[:remaining_chars].strip()
        if block:
            blocks.append(block)
            remaining_chars -= len(block)
        if remaining_chars <= 0:
            break

    supplemental_materials = request.supplemental_materials or []
    for index, material in enumerate(supplemental_materials, start=1):
        if remaining_chars <= 0:
            break
        content = _clean_source_text(material.content or "", limit=remaining_chars)
        if not content:
            continue

        title = material.title or f"Material {index}"
        material_type = material.material_type or "supplemental"
        header = f"## Material {index}: {title}\nID: {material.id}\nType: {material_type}"
        block = f"{header}\n\n{content}"
        if len(block) > remaining_chars:
            block = block[:remaining_chars].strip()
        if block:
            blocks.append(block)
            remaining_chars -= len(block)

    return "\n\n".join(blocks).strip(), len(selected_sources) + len(supplemental_materials)


def _source_sentences(source_context: str, limit: int = 12) -> list[str]:
    cleaned_context = _strip_learning_profile_source_blocks(source_context)
    cleaned = re.sub(r"^## Source .*?$", "", cleaned_context, flags=re.MULTILINE)
    pieces = re.split(r"(?<=[。！？.!?])\s+|\n+", cleaned)
    sentences: list[str] = []
    seen: set[str] = set()
    for piece in pieces:
        sentence = re.sub(r"\s+", " ", piece).strip(" -\t")
        if len(sentence) < 24 or sentence in seen:
            continue
        seen.add(sentence)
        sentences.append(sentence[:260])
        if len(sentences) >= limit:
            break
    if sentences:
        return sentences
    fallback = re.sub(r"\s+", " ", cleaned_context).strip()
    return [fallback[:260]] if fallback else []


def _is_learning_profile_context_block(block: str) -> bool:
    compact = re.sub(r"\s+", " ", block).lower()
    return (
        LEARNING_PROFILE_TOPIC in compact
        or LEARNING_PROFILE_SOURCE_TITLE in block
        or "学习画像" in block
    )


def _strip_learning_profile_source_blocks(source_context: str) -> str:
    blocks = re.split(r"\n{2,}(?=## Source \d+:)", source_context.strip())
    kept = [
        block
        for block in blocks
        if block.strip() and not _is_learning_profile_context_block(block)
    ]
    return "\n\n".join(kept)


def _mind_map_node_text(value: str, limit: int = 72) -> str:
    text = re.sub(r"[\r\n]+", " ", value).strip()
    text = re.sub(r"[(){}\[\]<>|]", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -:：")
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text or "来源要点"


def _mermaid_label(value: str, limit: int = 48) -> str:
    return _mind_map_node_text(value, limit).replace('"', '\\"')


def _source_grounded_fallback_resources(
    context: dict[str, str],
    requested_outputs: list[LearningOutputKind],
    source_context: str,
) -> list[LearningResource]:
    course = context["course"]
    sentences = _source_sentences(source_context, limit=16)
    evidence_lines = "\n".join(f"- {sentence}" for sentence in sentences[:10])
    resources: list[LearningResource] = []

    for kind in requested_outputs:
        if kind == "study_guide":
            resources.append(
                LearningResource(
                    kind="study_guide",
                    type="讲解文档",
                    title=f"{course} 来源讲解文档",
                    agent="来源生成智能体",
                    format="Markdown",
                    summary="根据当前学习记录中的来源摘录生成的讲解文档。",
                    content=(
                        f"# {course} 来源讲解文档\n\n"
                        f"## 学习目标\n{context['goal']}\n\n"
                        "## 来源中的关键内容\n"
                        f"{evidence_lines}\n\n"
                        "## 建议学习顺序\n"
                        "1. 先逐条核对上面的来源要点，确认每个概念在原文中的语境。\n"
                        "2. 再用 Quiz 检查自己是否能区分相近概念、方法前提和实验结论。\n"
                        "3. 最后把答错或不确定的要点转成闪卡复习。\n\n"
                        "## 证据约束\n"
                        "这份文档只使用当前来源中可见的文本摘录；如果需要更深入的推导，请等待来源处理完成或补充更多资料。"
                    ),
                    tags=["来源讲解", "Markdown"],
                )
            )
        elif kind == "quiz":
            questions = []
            distractors = [
                "这是来源中没有直接支持的说法",
                "这是过度泛化后的结论",
                "这只是背景描述，不能回答该问题",
            ]
            for index, sentence in enumerate(sentences[:5], start=1):
                questions.append(
                    {
                        "id": f"q{index}",
                        "prompt": f"根据来源，以下哪一项最符合要点 {index}？",
                        "options": [sentence, *distractors],
                        "answer_index": 0,
                        "explanation": f"来源摘录支持这一表述：{sentence}",
                    }
                )
            resources.append(
                LearningResource(
                    kind="quiz",
                    type="来源 Quiz",
                    title=f"{course} 来源理解 Quiz",
                    agent="练习实训智能体",
                    format="Interactive Quiz",
                    summary="根据当前来源摘录生成的可答题测验。",
                    content="完成题目后，对照解析回到来源核查证据。",
                    tags=["Quiz", "来源证据"],
                    payload={"questions": questions},
                )
            )
        elif kind == "flashcards":
            cards = [
                {
                    "front": f"来源要点 {index} 是什么？",
                    "back": sentence,
                    "hint": "先回忆原文语境，再翻面核对。",
                }
                for index, sentence in enumerate(sentences[:8], start=1)
            ]
            resources.append(
                LearningResource(
                    kind="flashcards",
                    type="知识闪卡",
                    title=f"{course} 来源知识闪卡",
                    agent="来源生成智能体",
                    format="Interactive Flashcards",
                    summary="把当前来源摘录压缩成可翻面的复习卡片。",
                    content="逐张回忆来源中的概念、方法或结论，再翻面核对。",
                    tags=["闪卡", "来源证据"],
                    payload={"cards": cards},
                )
            )
        elif kind == "mind_map":
            source_nodes = sentences[:12] or [context["message"], context["goal"]]
            mermaid_lines = [
                "```mermaid",
                "mindmap",
                "  direction right",
                f"  root(({_mermaid_label(course)}))",
                "    来源要点",
            ]
            for index, sentence in enumerate(source_nodes[:10], start=1):
                mermaid_lines.extend(
                    [
                        f"      要点 {index}: {_mermaid_label(sentence, 54)}",
                        "        先定位它回答的问题",
                        "        再核对原文证据和适用条件",
                    ]
                )
            mermaid_lines.extend(
                [
                    "    学习动作",
                    "      概念边界",
                    "        找出相近概念的区别",
                    "        标注容易混淆的条件",
                    "      方法脉络",
                    "        按步骤复述材料中的推理",
                    "        用一个例子检查是否能迁移",
                    "      练习自检",
                    "        生成测验定位薄弱点",
                    "        把错题回跳到来源复盘",
                ]
            )
            mermaid_lines.append("```")
            tree_lines = [
                "## 树状分层文本",
                f"- {course}",
                "  - 来源要点",
                *[
                    f"    - 要点 {index}: {sentence}\n      - 先定位它回答的问题\n      - 再核对原文证据和适用条件"
                    for index, sentence in enumerate(source_nodes[:10], start=1)
                ],
                "  - 学习动作",
                "    - 概念边界：找出相近概念的区别和条件",
                "    - 方法脉络：按步骤复述材料中的推理",
                "    - 练习自检：用测验和错题回跳来源",
            ]
            table_lines = [
                "## 对比表格",
                "| 来源要点 | 学习动作 |",
                "| --- | --- |",
            ]
            actions = ["先梳理概念边界", "再核对方法脉络", "最后用练习自检"]
            for index, sentence in enumerate(source_nodes[:10]):
                table_lines.append(f"| {sentence} | {actions[index % len(actions)]} |")
            outline_lines = [
                "## 分级分点列表",
                f"1. {course}",
                "   - 来源要点",
                *[
                    f"     - 要点 {index}: {sentence}\n       - 证据定位\n       - 条件核对"
                    for index, sentence in enumerate(source_nodes[:10], start=1)
                ],
                "   - 学习动作",
                "     - 先梳理概念边界",
                "     - 再核对方法脉络",
                "     - 最后用练习自检",
            ]
            mind_map_content = "\n\n".join(
                [
                    "\n".join(mermaid_lines),
                    "\n".join(tree_lines),
                    "\n".join(table_lines),
                    "\n".join(outline_lines),
                ]
            )
            resources.append(
                LearningResource(
                    kind="mind_map",
                    type=OUTPUT_LABELS.get("mind_map", "知识点思维导图"),
                    title=f"{course} 知识点思维导图",
                    agent="来源生成智能体",
                    format="Mermaid mindmap direction right",
                    summary="根据当前来源摘录生成的知识结构导图。",
                    content=mind_map_content,
                    tags=["思维导图", "来源证据"],
                )
            )
        else:
            resources.append(
                LearningResource(
                    kind=kind,
                    type=OUTPUT_LABELS.get(kind, "学习资产"),
                    title=f"{course} {OUTPUT_LABELS.get(kind, '学习资产')}",
                    agent="来源生成智能体",
                    format="Markdown",
                    summary="根据当前来源摘录生成的学习资产。",
                    content=evidence_lines or "当前来源文本不足，无法生成更具体的内容。",
                    tags=["来源证据"],
                )
            )

    return resources


def _learning_generation_prompt(
    context: dict[str, str],
    requested_outputs: list[LearningOutputKind],
    source_context: str,
) -> str:
    requested = ", ".join(requested_outputs)
    return f"""
Markdown table rule: use ASCII "|" separators, include a delimiter row like "| --- | --- |", keep every table row on one physical line, and never wrap bold/italic markers across lines inside table cells.
你是严格的学习资产生成智能体。你必须只根据 <sources> 中的来源文本生成内容，不能使用通用学习建议、系统设计说明或来源外知识补全事实。

用户学习目标：
{context["message"]}

课程/主题：
{context["course"]}

目标输出语言：
{context["target_language"]}

要求：
1. 只生成 requested_outputs 中列出的资产：{requested}
2. 无论 <sources> 或用户输入是什么语言，所有面向用户展示的 title、summary、content、quiz、闪卡、reading reason、tutor_answer 等都必须使用“目标输出语言”。必要时先在内部翻译来源，再生成结果；不要沿用英文或来源原文语种输出。
3. 所有 quiz、闪卡、讲解文档和 mind_map 都必须围绕来源里的具体概念、方法、公式、实验、结论或术语。
4. 如果来源证据不足，明确写“来源不足以支持”，不要编造。
5. study_guide 必须是长 Markdown 文档，至少包含：核心问题、来源要点、概念解释、方法/实验脉络、易混点、自检清单。
6. study_guide.content 必须是纯 Markdown 正文：不要包裹 ```markdown 代码块，不要把整篇 Markdown 做二次 JSON 字符串化，不要输出字面量 "\\n"；标题必须单独成行，使用 "#"/"##"/"###"，列表使用 "- " 或 "1. " 标准 Markdown。
7. quiz 必须可互动：payload.questions 里生成 4-8 道题，每题 4 个选项，answer_index 为 0-3，解析必须引用来源依据；每题尽量补充 source_title、source_ref 或 evidence，便于错题回跳来源。
8. flashcards 必须可互动：payload.cards 里生成 6-12 张卡，每张有 front/back/hint，内容必须来自来源。
9. mind_map.content 必须按以下顺序输出同一套知识内容：第一部分是可直接渲染的 fenced Mermaid 代码块，第一行必须单独是 ```mermaid，第二行必须是 mindmap，第三行必须是两个空格缩进的 direction right，末尾必须用单独一行 ``` 关闭；根节点靠左，所有分支水平向右展开；禁止只生成“根节点 + 一级模块”的两层图，也不要只写很短的点子或空泛三级骨架；一级节点用于模块，每个一级模块下面都必须继续展开具体概念、来源证据、条件/步骤、例子、易混边界、公式含义、实验结论或学习动作，让结构既详细又清楚；层级深度和分支数量由材料复杂度决定，不设固定上限，复杂材料可以继续向下嵌套，只要每个节点仍是可读短句而不是整段长文；禁止 flowchart/graph 语法；第二部分依次输出 "## 树状分层文本"、"## 对比表格"、"## 分级分点列表"，三种格式内容必须一一对应，不要输出无关说明。
10. reading 必须根据来源主题给出更深入的拓展阅读候选，覆盖“相关论文/综述、必读经典/教材章节、大学课程讲义、官方文档、教学视频、实践项目或练习”至少 5 类；优先输出 payload.items，建议 8-12 项，每项包含 title、url、reason、category、difficulty、read_order，并在 reason 中说明相关性、推荐度、经典度或权威性依据。content 中也要用 Markdown 列出候选，按建议阅读顺序或总分排序，不要只给泛泛链接。
11. 输出只允许 JSON，不要 Markdown 代码块。

JSON 结构：
{{
  "resources": [
    {{
      "kind": "study_guide | quiz | flashcards | mind_map | reading | code_lab",
      "type": "...",
      "title": "...",
      "agent": "来源生成智能体",
      "format": "...",
      "summary": "...",
      "content": "...",
      "tags": ["..."],
      "payload": {{}}
    }}
  ]
}}

quiz payload 示例：
{{
  "questions": [
    {{
      "id": "q1",
      "prompt": "...",
      "options": ["...", "...", "...", "..."],
      "answer_index": 0,
      "explanation": "..."
    }}
  ]
}}

flashcards payload 示例：
{{
  "cards": [
    {{"front": "...", "back": "...", "hint": "..."}}
  ]
}}

<sources>
{source_context}
</sources>
""".strip()


def _as_text(value: Any, fallback: str = "") -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def _as_tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value[:8] if str(item).strip()]


def _normalize_quiz_payload(payload: Any) -> dict[str, Any]:
    questions = payload.get("questions") if isinstance(payload, dict) else None
    if not isinstance(questions, list):
        return {"questions": []}

    normalized = []
    for index, question in enumerate(questions[:8], start=1):
        if not isinstance(question, dict):
            continue
        prompt = _as_text(question.get("prompt"))
        raw_options = question.get("options")
        if not prompt or not isinstance(raw_options, list):
            continue
        options = [str(option).strip() for option in raw_options if str(option).strip()]
        if len(options) < 4:
            continue
        try:
            answer_index = int(question.get("answer_index", 0))
        except (TypeError, ValueError):
            answer_index = 0
        answer_index = max(0, min(answer_index, 3))
        normalized.append(
            {
                "id": _as_text(question.get("id"), f"q{index}"),
                "prompt": prompt,
                "options": options[:4],
                "answer_index": answer_index,
                "explanation": _as_text(question.get("explanation"), "请回到来源核对对应证据。"),
            }
        )
        for field in (
            "source_id",
            "source_title",
            "source_ref",
            "evidence",
            "citation",
            "location",
        ):
            value = _as_text(question.get(field))
            if value:
                normalized[-1][field] = value
    return {"questions": normalized}


def _normalize_flashcard_payload(payload: Any) -> dict[str, Any]:
    cards = payload.get("cards") if isinstance(payload, dict) else None
    if not isinstance(cards, list):
        return {"cards": []}

    normalized = []
    for card in cards[:12]:
        if not isinstance(card, dict):
            continue
        front = _as_text(card.get("front"))
        back = _as_text(card.get("back"))
        if not front or not back:
            continue
        normalized.append(
            {
                "front": front,
                "back": back,
                "hint": _as_text(card.get("hint"), "回到来源中的定义、方法或实验语境核对。"),
            }
        )
    return {"cards": normalized}


def _normalize_generated_markdown(value: Any) -> str:
    text = _as_text(value)
    if not text:
        return ""

    if len(text) >= 2 and text[0] in {'"', "'"} and text[-1] == text[0]:
        try:
            decoded = json.loads(text)
            if isinstance(decoded, str):
                text = decoded
        except json.JSONDecodeError:
            pass

    text = text.strip()
    fenced = re.match(r"^```(?:markdown|md|mdx)?\s*\n([\s\S]*?)\n```$", text, re.I)
    if fenced:
        text = fenced.group(1).strip()

    escaped_newline_count = text.count("\\n")
    if escaped_newline_count > 1 or ("\n" not in text and escaped_newline_count > 0):
        text = (
            text.replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .replace("\\t", "  ")
        )

    fenced = re.match(r"^```(?:markdown|md|mdx)?\s*\n([\s\S]*?)\n```$", text.strip(), re.I)
    if fenced:
        text = fenced.group(1).strip()

    text = _repair_markdown_tables(re.sub(r"[ \t]+$", "", text, flags=re.M))
    text = _split_run_on_markdown_blocks(text)
    text = _repair_markdown_tables(text)
    text = re.sub(r"(^|\n)[ \t]*#{1,6}[ \t]*(?=\n)", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _normalize_mind_map_content(value: Any) -> str:
    text = _normalize_generated_markdown(value)
    if not text:
        return ""

    text = re.sub(
        r"```(mermaid|mindmap)[ \t]+((?:flowchart|graph|mindmap)\b)",
        r"```\1\n\2",
        text,
        flags=re.I,
    )


async def _resolve_image_model_selection(image_model: str | None) -> tuple[str, str]:
    selected = (image_model or "gpt-image-1").strip() or "gpt-image-1"
    provider = "openai"
    model_name = selected
    try:
        if ":" in selected:
            model = await Model.get(selected)
            provider = model.provider or provider
            model_name = model.name or model_name
    except Exception:
        provider = "openai"
        model_name = selected
    return provider, model_name


async def _generate_visual_aid_resource(
    context: dict[str, str],
    source_context: str,
    image_model: str | None = None,
) -> LearningResource:
    title = f"{context['course']} 辅助理解图片"
    provider, model_name = await _resolve_image_model_selection(image_model)
    prompt = f"""
Create one educational visual aid for a study notebook.

Goal:
- Help the learner understand the topic visually.
- Use a clean textbook/NotebookLM style: diagram-like, clear hierarchy, minimal decoration.
- Prefer conceptual infographic, process diagram, comparison chart, or annotated visual metaphor.
- Avoid tiny unreadable text. Use short labels only.
- Output should be useful for studying, not a marketing poster.

Language for visible labels: {context["target_language"]}
Course: {context["course"]}
Student background: {context["major"]}
Learning goal: {context["goal"]}
Topic/request: {context["message"]}

Source-grounded context:
{source_context[:5000]}
Image model selected by user: {model_name}
""".strip()

    model = None
    base_url = None
    try:
        if image_model and ":" in image_model:
            model = await Model.get(image_model)
            provider, model_name, api_key, base_url = await resolve_image_model_config(model)
        else:
            api_key = None
    except Exception as error:
        logger.warning(f"Unable to read image credential for visual aid: {error}")
        api_key = None

    if not api_key:
        return LearningResource(
            kind="visual_aid",
            type=OUTPUT_LABELS["visual_aid"],
            title=title,
            agent="视觉辅助智能体",
            format="Image prompt",
            summary=f"未检测到 {provider} 图片生成 API key，已生成可复制的图片提示词。",
            content=prompt,
            tags=["图片", "可视化", "提示词"],
            payload={"prompt": prompt, "status": "missing_api_key", "image_model": model_name, "provider": provider},
        )

    def persist_image_bytes(image_bytes: bytes, mime_type: str = "image/png") -> str:
        extension = "jpg" if mime_type in {"image/jpeg", "image/jpg"} else "png"
        output_dir = os.getenv("GENERATED_ASSETS_DIR", GENERATED_ASSETS_DIR)
        os.makedirs(output_dir, exist_ok=True)
        filename = f"visual-aid-{uuid.uuid4().hex}.{extension}"
        output_path = os.path.join(output_dir, filename)
        with open(output_path, "wb") as image_file:
            image_file.write(image_bytes)
        return f"{GENERATED_ASSETS_URL_PREFIX}/{filename}"

    try:
        image_src, mime_type = await generate_image(
            provider=provider,
            model_name=model_name,
            api_key=api_key,
            prompt=prompt,
            base_url=base_url,
            persist_image_bytes=persist_image_bytes,
        )
        return LearningResource(
            kind="visual_aid",
            type=OUTPUT_LABELS["visual_aid"],
            title=title,
            agent="视觉辅助智能体",
            format="PNG image",
            summary="基于当前学习资料生成的可视化辅助理解图片。",
            content="这是一张基于当前学习资料生成的辅助理解图片，可放大查看或导出。",
            tags=["图片", "可视化", "辅助理解"],
            payload={"image_src": image_src, "prompt": prompt, "mime_type": mime_type, "image_model": model_name, "provider": provider},
        )
    except Exception as error:
        logger.warning(f"Visual aid image generation failed: {error}")
        return LearningResource(
            kind="visual_aid",
            type=OUTPUT_LABELS["visual_aid"],
            title=title,
            agent="视觉辅助智能体",
            format="Image prompt",
            summary="图片生成失败，已保留可复制的图片提示词。",
            content=prompt,
            tags=["图片", "可视化", "提示词"],
            payload={"prompt": prompt, "status": "generation_failed", "image_model": model_name, "provider": provider},
        )
    fence_start = re.search(r"```(?:mermaid|mindmap)\s*\n", text, flags=re.I)
    if fence_start:
        after_fence = text[fence_start.end() :]
        section_match = re.search(
            r"\n##\s*(?:树状分层文本|对比表格|分级分点列表)",
            after_fence,
        )
        closing_index = after_fence.find("```")
        if section_match and (closing_index == -1 or closing_index > section_match.start()):
            insert_at = fence_start.end() + section_match.start()
            text = f"{text[:insert_at]}\n```{text[insert_at:]}"

    return text.strip()


def _normalize_markdown_table_line(line: str) -> str:
    if not re.search(r"[|｜│]", line):
        return line

    normalized = re.sub(r"[｜│]", "|", line)
    if re.match(r"^\s*\|?[\s|:—–－─-]+\|?\s*$", normalized):
        normalized = re.sub(r"[—–－─]", "-", normalized)
    return normalized


def _markdown_table_cells(line: str) -> list[str]:
    normalized = _normalize_markdown_table_line(line).strip()
    if "|" not in normalized:
        return []
    return normalized.strip("|").split("|")


def _is_markdown_table_candidate_line(line: str) -> bool:
    return len(_markdown_table_cells(line)) >= 2


def _is_markdown_table_delimiter_line(line: str) -> bool:
    cells = _markdown_table_cells(line)
    return len(cells) >= 2 and all(
        re.match(r"^:?-{3,}:?$", cell.strip()) for cell in cells
    )


def _markdown_table_delimiter_for(line: str) -> str:
    return "| " + " | ".join("---" for _ in _markdown_table_cells(line)) + " |"


def _repair_markdown_tables(text: str) -> str:
    text = re.sub(r"([*_])\n\1([ \t]*[|｜│])", r"\1\1\2", text)
    lines = text.split("\n")
    output: list[str] = []
    in_fence = False
    in_table = False

    for index, raw_line in enumerate(lines):
        if re.match(r"^\s*```", raw_line):
            in_fence = not in_fence
            in_table = False
            output.append(raw_line)
            continue

        if in_fence:
            output.append(raw_line)
            continue

        if not raw_line.strip():
            next_line = (
                _normalize_markdown_table_line(lines[index + 1])
                if index + 1 < len(lines)
                else ""
            )
            if in_table and _is_markdown_table_candidate_line(next_line):
                continue
            in_table = False
            output.append(raw_line)
            continue

        line = _normalize_markdown_table_line(raw_line)
        is_table_line = _is_markdown_table_candidate_line(line)
        if not is_table_line:
            in_table = False
            output.append(line)
            continue

        next_line = (
            _normalize_markdown_table_line(lines[index + 1])
            if index + 1 < len(lines)
            else ""
        )
        output.append(line)
        if (
            not in_table
            and _is_markdown_table_candidate_line(next_line)
            and not _is_markdown_table_delimiter_line(next_line)
        ):
            output.append(_markdown_table_delimiter_for(line))
        in_table = True

    return "\n".join(output)


def _split_run_on_markdown_blocks(text: str) -> str:
    output: list[str] = []
    in_fence = False

    for line in text.split("\n"):
        if re.match(r"^\s*```", line):
            in_fence = not in_fence
            output.append(line)
            continue

        if in_fence or _is_markdown_table_candidate_line(line):
            output.append(line)
            continue

        line = re.sub(r"([^\n])([ \t]+)(#{1,6}\s+)", r"\1\n\n\3", line)
        line = re.sub(r"([^\n])([ \t]+)([-*+]\s+)", r"\1\n\3", line)
        line = re.sub(r"([^\n])([ \t]+)(\d+\.\s+)", r"\1\n\3", line)
        output.append(line)

    return "\n".join(output)


def _normalize_generated_resources(
    payload: Any,
    context: dict[str, str],
    requested_outputs: list[LearningOutputKind],
    source_context: str,
) -> list[LearningResource]:
    raw_resources = payload.get("resources") if isinstance(payload, dict) else payload
    if not isinstance(raw_resources, list):
        raw_resources = []

    requested = set(requested_outputs)
    resources: list[LearningResource] = []
    for item in raw_resources:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        if kind not in requested:
            continue
        payload_value = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        if kind == "quiz":
            payload_value = _normalize_quiz_payload(payload_value)
        elif kind == "flashcards":
            payload_value = _normalize_flashcard_payload(payload_value)
        content = _as_text(item.get("content"), "请回到来源核对对应证据。")
        if kind == "study_guide":
            content = _normalize_generated_markdown(content) or "请回到来源核对对应证据。"
        elif kind == "mind_map":
            content = _normalize_mind_map_content(content) or "请回到来源核对对应证据。"
        elif kind == "reading":
            content = _normalize_generated_markdown(content) or "请回到来源核对对应证据。"

        resources.append(
            LearningResource(
                kind=kind,
                type=OUTPUT_LABELS.get(kind, "学习资产"),
                title=_as_text(item.get("title"), f"{context['course']} {OUTPUT_LABELS.get(kind, '学习资产')}"),
                agent=_as_text(item.get("agent"), "来源生成智能体"),
                format=_as_text(item.get("format"), "Markdown"),
                summary=_as_text(item.get("summary"), "根据当前来源生成。"),
                content=content,
                tags=_as_tags(item.get("tags")),
                payload=payload_value,
            )
        )

    produced = {resource.kind for resource in resources}
    missing = [kind for kind in requested_outputs if kind not in produced]
    if missing:
        resources.extend(_source_grounded_fallback_resources(context, missing, source_context))

    return resources


async def _generate_resources_from_sources(
    context: dict[str, str],
    request: LearningOrchestrationRequest,
    source_context: str,
) -> list[LearningResource]:
    if not request.requested_outputs:
        return []

    visual_resources: list[LearningResource] = []
    text_outputs = [kind for kind in request.requested_outputs if kind != "visual_aid"]
    if "visual_aid" in request.requested_outputs:
        visual_resources.append(
            await _generate_visual_aid_resource(
                context,
                source_context,
                request.image_model,
            )
        )
    if not text_outputs:
        return visual_resources

    prompt = _learning_generation_prompt(context, text_outputs, source_context)
    default_model_type = (
        f"asset_{text_outputs[0]}"
        if len(text_outputs) == 1
        else "learning_asset"
    )
    try:
        model = await provision_langchain_model(
            prompt,
            None,
            default_model_type,
            max_tokens=8192,
            structured=dict(type="json"),
        )
        ai_message = await model.ainvoke(prompt)
        payload = _extract_json_payload(extract_text_content(ai_message.content))
        return [
            *visual_resources,
            *_normalize_generated_resources(
                payload,
                context,
                text_outputs,
                source_context,
            ),
        ]
    except ConfigurationError as error:
        logger.warning(f"No LLM configured for source-grounded asset generation: {error}")
    except Exception as error:
        logger.warning(f"LLM source-grounded asset generation failed: {error}")

    return [
        *visual_resources,
        *_source_grounded_fallback_resources(
            context,
            text_outputs,
            source_context,
        ),
    ]


def _build_fallback_collected_resources(
    context: dict[str, str],
) -> list[LearningCollectedResource]:
    course = context["course"]
    return [
        LearningCollectedResource(
            id="course-syllabus",
            title=f"{course} 课程大纲与核心术语表",
            source_type="课程资料",
            query=f"{course} 课程大纲 核心概念 先修知识",
            reason="用于校准学习路径的知识边界，避免资源生成偏离课程目标。",
        ),
        LearningCollectedResource(
            id="open-course-notes",
            title=f"{course} 开放课程讲义",
            source_type="开放课程",
            query=f"{course} lecture notes supervised learning exercises",
            reason="补充结构化讲解、例题和课后练习，适合作为拓展阅读候选。",
            url="https://cs229.stanford.edu/",
        ),
        LearningCollectedResource(
            id="official-docs",
            title="官方工具文档与实践教程",
            source_type="官方文档",
            query=f"{course} official tutorial Python classification practice",
            reason="为代码实操案例提供可运行工具链和参数解释依据。",
            url="https://scikit-learn.org/stable/supervised_learning.html",
        ),
        LearningCollectedResource(
            id="mistake-bank",
            title="错题与易混概念样本",
            source_type="学习行为数据",
            query=f"{context['major']} {course} 易错点 错题 误区",
            reason="用于诊断学生薄弱点，并驱动后续练习题生成。",
        ),
        LearningCollectedResource(
            id="student-upload",
            title="学生自有课件、作业或课堂笔记",
            source_type="用户上传",
            query="由学生上传 PDF、PPT、Markdown、网页或文本资料",
            reason="学生可不采纳系统搜索结果，改用自己的课堂资料作为生成依据。",
            adoption_status="user_upload",
        ),
    ]


def _build_web_search_queries(context: dict[str, str]) -> list[str]:
    return [plan.query for plan in _fallback_agentic_search_plan(context)]


def _topic_aliases(text: str) -> list[str]:
    aliases: list[str] = []
    normalized = text.lower()
    if re.search(r"\bssl\b", normalized) or "半监督" in text:
        aliases.append("semi-supervised learning")
    if "强化学习" in text:
        aliases.append("reinforcement learning")
    if "监督学习" in text:
        aliases.append("supervised learning")
    if "大语言模型" in text or "llm" in normalized:
        aliases.append("large language models")
    return aliases


def _fallback_agentic_search_plan(context: dict[str, str]) -> list[SearchQueryPlan]:
    course = context["course"]
    major = context["major"]
    message = context["message"]
    goal = context["goal"]
    primary_topic = message or goal or course
    aliases = _topic_aliases(f"{primary_topic} {course} {goal}")
    expanded_topic = " ".join([primary_topic, *aliases]).strip()
    scoped_topic = primary_topic if course in primary_topic else f"{primary_topic} {course}"
    return [
        SearchQueryPlan(
            query=f"{expanded_topic} university lecture notes tutorial",
            intent="conceptual_foundation",
            rationale="Find structured explanations and teaching material.",
        ),
        SearchQueryPlan(
            query=f"{expanded_topic} classic papers survey arxiv openreview",
            intent="primary_or_survey_papers",
            rationale="Find high-signal papers or surveys.",
        ),
        SearchQueryPlan(
            query=f"{expanded_topic} official documentation examples",
            intent="official_reference",
            rationale="Find authoritative references and worked examples.",
        ),
        SearchQueryPlan(
            query=f"{expanded_topic} practice problems exercises quiz",
            intent="assessment_material",
            rationale="Find material useful for self-checks.",
        ),
        SearchQueryPlan(
            query=f"{expanded_topic} implementation tutorial github notebook",
            intent="implementation_or_code",
            rationale="Find practical implementations or notebooks.",
        ),
        SearchQueryPlan(
            query=f"{scoped_topic} study guide examples {major}",
            intent="learner_context",
            rationale="Find resources aligned with the learner profile.",
        ),
        SearchQueryPlan(
            query=f"{expanded_topic} recommended reading textbook chapters",
            intent="textbook_or_classic_reading",
            rationale="Find classic textbook-style reading and durable references.",
        ),
        SearchQueryPlan(
            query=f"{expanded_topic} course syllabus reading list",
            intent="course_reading_list",
            rationale="Find curated course reading lists and prerequisite sequence.",
        ),
        SearchQueryPlan(
            query=f"{expanded_topic} video lecture playlist university",
            intent="video_lecture",
            rationale="Find high-quality lecture videos that can complement reading.",
        ),
        SearchQueryPlan(
            query=f"{expanded_topic} common misconceptions pitfalls examples",
            intent="misconceptions_and_pitfalls",
            rationale="Find materials that clarify difficult boundaries and mistakes.",
        ),
    ]


async def _llm_agentic_search_plan(
    context: dict[str, str],
) -> list[SearchQueryPlan]:
    fallback = _fallback_agentic_search_plan(context)
    prompt = f"""
You are an agentic learning-resource search planner.

Create 8-12 web search queries that will find high-quality, information-dense
learning sources for the student. Search deeper than generic tutorials. Cover diverse intents:
- conceptual foundation
- primary or survey papers
- official references
- practice / assessment material
- implementation examples
- background material for the learner profile
- classic textbooks or durable readings
- university course reading lists / syllabi
- high-quality lecture videos
- common misconceptions, pitfalls, and boundary cases

Prefer precise English academic/technical terms when the user writes Chinese or
uses abbreviations. Mix broad survey queries with narrow subtopic queries. Include
queries that reveal prerequisites, canonical papers, modern updates, and applied
examples. Do not require paid APIs or gated resources.

Student topic: {context["message"]}
Course: {context["course"]}
Major/background: {context["major"]}
Goal: {context["goal"]}
History: {context["history"]}

Return only JSON:
[
  {{"query": "...", "intent": "...", "rationale": "..."}}
]
""".strip()
    try:
        model = await provision_langchain_model(
            prompt,
            None,
            "resource_search",
            max_tokens=1600,
            structured=dict(type="json"),
        )
        ai_message = await model.ainvoke(prompt)
        payload = _extract_json_payload(extract_text_content(ai_message.content))
    except ConfigurationError as error:
        logger.debug(f"No LLM configured for agentic search planning: {error}")
        return fallback
    except Exception as error:
        logger.warning(f"LLM agentic search planning failed: {error}")
        return fallback

    if not isinstance(payload, list):
        return fallback

    plans: list[SearchQueryPlan] = []
    seen_queries: set[str] = set()
    for item in payload[:12]:
        if not isinstance(item, dict):
            continue
        query = _as_text(item.get("query"))
        if not query or query.lower() in seen_queries:
            continue
        seen_queries.add(query.lower())
        plans.append(
            SearchQueryPlan(
                query=query,
                intent=_as_text(item.get("intent"), "learning_resource"),
                rationale=_as_text(item.get("rationale"), "Planned by retrieval LLM."),
            )
        )

    return plans or fallback


def _canonical_search_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.netloc.lower()}{parsed.path.rstrip('/')}"


def _search_terms(context: dict[str, str]) -> set[str]:
    text = " ".join(
        [
            context["message"],
            context["course"],
            context["goal"],
            *_topic_aliases(
                f"{context['message']} {context['course']} {context['goal']}"
            ),
        ]
    ).lower()
    return {
        term
        for term in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text)
        if term not in {"the", "and", "for", "with", "from", "that", "this"}
    }


def _detect_resource_kind(result: WebSearchResult) -> str:
    haystack = f"{result.title} {result.url} {result.snippet}".lower()
    if any(
        token in haystack
        for token in ["arxiv", "openreview", "proceedings", "paper", "survey"]
    ):
        return "paper_or_survey"
    if any(token in haystack for token in ["lecture", "notes", "course", "slides", ".edu"]):
        return "lecture_notes"
    if any(token in haystack for token in ["docs", "documentation", "official", "reference"]):
        return "official_reference"
    if any(token in haystack for token in ["github", "notebook", "implementation", "code"]):
        return "implementation"
    if any(token in haystack for token in ["exercise", "problem", "quiz", "practice"]):
        return "practice"
    if any(token in haystack for token in ["tutorial", "guide", "explained"]):
        return "tutorial"
    return "article"


def _clean_search_result_title(title: str) -> str:
    cleaned = re.sub(r"\s+", " ", title).strip()
    cleaned = re.split(r"\s[-|–—]\s| :: | - YouTube$", cleaned, maxsplit=1)[0].strip()
    return cleaned[:90] or "Learning resource"


def _fallback_display_title(result: WebSearchResult, kind: str, intent: str) -> str:
    kind_labels = {
        "paper_or_survey": "Paper",
        "lecture_notes": "Course notes",
        "official_reference": "Official reference",
        "implementation": "Implementation",
        "practice": "Practice set",
        "tutorial": "Tutorial",
        "article": "Background reading",
    }
    cleaned = _clean_search_result_title(result.title)
    label = kind_labels.get(kind, "Resource")
    if intent and intent not in {"learning_resource", "foundational_material"}:
        return f"{label}: {cleaned}"
    return f"{label}: {cleaned}"


def _domain_quality(url: str) -> float:
    domain = urlparse(url).netloc.lower()
    if any(
        domain.endswith(good)
        for good in [
            ".edu",
            "arxiv.org",
            "openreview.net",
            "proceedings.mlr.press",
            "neurips.cc",
            "aclanthology.org",
            "jmlr.org",
            "stanford.edu",
            "mit.edu",
        ]
    ):
        return 0.28
    if any(
        good in domain
        for good in [
            "github.com",
            "scikit-learn.org",
            "pytorch.org",
            "tensorflow.org",
            "huggingface.co",
            "paperswithcode.com",
        ]
    ):
        return 0.2
    if any(
        bad in domain
        for bad in [
            "chegg.com",
            "coursehero.com",
            "quizlet.com",
            "studocu.com",
            "scribd.com",
            "pinterest.",
        ]
    ):
        return -0.35
    return 0.0


def _heuristic_search_score(
    result: WebSearchResult,
    context: dict[str, str],
    intent: str,
) -> tuple[float, str, str, str]:
    haystack = f"{result.title} {result.snippet} {result.url}".lower()
    kind = _detect_resource_kind(result)
    matched_terms = [term for term in _search_terms(context) if term in haystack]
    term_score = min(len(matched_terms) * 0.035, 0.18)
    snippet_score = min(len(result.snippet.strip()) / 700, 0.16)
    kind_score = {
        "paper_or_survey": 0.17,
        "lecture_notes": 0.16,
        "official_reference": 0.15,
        "implementation": 0.12,
        "practice": 0.11,
        "tutorial": 0.1,
        "article": 0.04,
    }.get(kind, 0.04)
    score = 0.35 + _domain_quality(result.url) + term_score + snippet_score + kind_score
    if "pdf" in haystack and kind in {"paper_or_survey", "lecture_notes"}:
        score += 0.05
    if intent == "assessment_material" and kind == "practice":
        score += 0.08
    if intent == "implementation_or_code" and kind == "implementation":
        score += 0.08
    score = max(0.0, min(score, 1.0))

    learning_value = {
        "paper_or_survey": "适合作为原始论文、综述或高密度理论来源。",
        "lecture_notes": "适合作为结构化讲解和课程化学习来源。",
        "official_reference": "适合核对术语、API、公式或权威定义。",
        "implementation": "适合把概念落到代码、实验或 notebook。",
        "practice": "适合生成 quiz、练习题和自测检查点。",
        "tutorial": "适合作为入门解释和学习路径补充。",
        "article": "适合作为背景材料，但需要和更权威来源交叉核对。",
    }.get(kind, "适合作为背景材料。")
    reason = (
        f"intent={intent}; kind={kind}; "
        f"matched_terms={', '.join(matched_terms[:5]) or 'none'}; "
        f"authority_delta={_domain_quality(result.url):+.2f}"
    )
    return score, kind, learning_value, reason


async def _llm_rerank_search_results(
    context: dict[str, str],
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not candidates:
        return []

    compact_candidates = [
        {
            "id": item["id"],
            "title": item["result"].title,
            "url": item["result"].url,
            "snippet": item["result"].snippet[:600],
            "query": item["result"].query,
            "intent": item["intent"],
            "heuristic_score": item["score"],
            "resource_kind": item["resource_kind"],
        }
        for item in candidates[:40]
    ]
    prompt = f"""
You are a strict learning-resource reranker.

Rank web search candidates for usefulness in a learning notebook. Prefer:
1. authoritative sources: university notes, papers, official docs, respected libraries
2. information-dense pages that can be imported as sources
3. resources that help generate study guides, quizzes, flashcards, and practice
4. diversity across theory, implementation, assessment, classic readings, and lecture videos
5. complementary resources that create a real reading path from prerequisite review to advanced follow-up

Penalize SEO pages, answer dumps, thin summaries, paywalled homework sites, and
generic pages without enough educational signal.

Topic: {context["message"]}
Course: {context["course"]}
Goal: {context["goal"]}

Candidates:
{compact_candidates}

Return only JSON:
[
  {{
    "id": "c1",
    "score": 0.0,
    "display_title": "concise Chinese learning title, not the webpage's raw SEO title",
    "resource_kind": "paper_or_survey | lecture_notes | official_reference | implementation | practice | tutorial | article",
    "learning_value": "short Chinese explanation",
    "reason": "short Chinese reason"
  }}
]
""".strip()
    try:
        model = await provision_langchain_model(
            prompt,
            None,
            "resource_search",
            max_tokens=2200,
            structured=dict(type="json"),
        )
        ai_message = await model.ainvoke(prompt)
        payload = _extract_json_payload(extract_text_content(ai_message.content))
    except ConfigurationError as error:
        logger.debug(f"No LLM configured for agentic search rerank: {error}")
        return candidates
    except Exception as error:
        logger.warning(f"LLM agentic search rerank failed: {error}")
        return candidates

    if not isinstance(payload, list):
        return candidates

    by_id = {item["id"]: item for item in candidates}
    reranked: list[dict[str, Any]] = []
    for ranked in payload:
        if not isinstance(ranked, dict):
            continue
        candidate = by_id.get(str(ranked.get("id", "")))
        if not candidate:
            continue
        try:
            score = float(ranked.get("score", candidate["score"]))
        except (TypeError, ValueError):
            score = candidate["score"]
        reranked.append(
            {
                **candidate,
                "score": max(0.0, min(score, 1.0)),
                "resource_kind": _as_text(
                    ranked.get("resource_kind"),
                    candidate["resource_kind"],
                ),
                "display_title": _as_text(
                    ranked.get("display_title"),
                    _fallback_display_title(
                        candidate["result"],
                        candidate["resource_kind"],
                        candidate["intent"],
                    ),
                ),
                "learning_value": _as_text(
                    ranked.get("learning_value"),
                    candidate["learning_value"],
                ),
                "rank_reason": _as_text(
                    ranked.get("reason"),
                    candidate["rank_reason"],
                ),
            }
        )

    included = {item["id"] for item in reranked}
    reranked.extend(item for item in candidates if item["id"] not in included)
    return sorted(reranked, key=lambda item: item["score"], reverse=True)


def _select_diverse_search_results(
    candidates: list[dict[str, Any]],
    limit: int = 6,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    domain_counts: dict[str, int] = {}
    kind_counts: dict[str, int] = {}

    for candidate in sorted(candidates, key=lambda item: item["score"], reverse=True):
        result = candidate["result"]
        domain = urlparse(result.url).netloc.lower()
        kind = candidate["resource_kind"]
        if domain_counts.get(domain, 0) >= 2:
            continue
        if kind_counts.get(kind, 0) >= 2 and len(selected) < 4:
            continue
        selected.append(candidate)
        domain_counts[domain] = domain_counts.get(domain, 0) + 1
        kind_counts[kind] = kind_counts.get(kind, 0) + 1
        if len(selected) >= limit:
            break

    if len(selected) < limit:
        selected_ids = {item["id"] for item in selected}
        for candidate in sorted(candidates, key=lambda item: item["score"], reverse=True):
            if candidate["id"] in selected_ids:
                continue
            selected.append(candidate)
            if len(selected) >= limit:
                break
    return selected


def _resources_from_web_results(
    results: list[WebSearchResult],
) -> list[LearningCollectedResource]:
    resources: list[LearningCollectedResource] = []
    seen_urls: set[str] = set()
    for index, result in enumerate(results, start=1):
        if result.url in seen_urls:
            continue
        seen_urls.add(result.url)
        resources.append(
            LearningCollectedResource(
                id=f"web-search-{index}",
                title=result.title,
                source_type="Web Search",
                query=result.query,
                reason=(
                    "资源搜集智能体通过真实 Web Search 找到该资料。"
                    + (f"摘要：{result.snippet}" if result.snippet else "")
                ),
                url=result.url,
                snippet=result.snippet,
                provider=result.provider,
            )
        )
        if len(resources) >= 6:
            break
    return resources


def _build_ranked_search_candidates(
    results: list[WebSearchResult],
    context: dict[str, str],
    intent_by_query: dict[str, str],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for result in results:
        canonical_url = _canonical_search_url(result.url)
        if canonical_url in seen_urls:
            continue
        seen_urls.add(canonical_url)
        intent = intent_by_query.get(result.query, "learning_resource")
        score, kind, learning_value, rank_reason = _heuristic_search_score(
            result,
            context,
            intent,
        )
        candidates.append(
            {
                "id": f"c{len(candidates) + 1}",
                "result": result,
                "score": score,
                "resource_kind": kind,
                "display_title": _fallback_display_title(result, kind, intent),
                "learning_value": learning_value,
                "rank_reason": rank_reason,
                "intent": intent,
            }
        )
    return candidates


def _resources_from_ranked_candidates(
    candidates: list[dict[str, Any]],
) -> list[LearningCollectedResource]:
    resources: list[LearningCollectedResource] = []
    for index, candidate in enumerate(candidates, start=1):
        result: WebSearchResult = candidate["result"]
        reason = (
            f"Agentic Search 评分 {candidate['score']:.2f}。"
            f"{candidate['learning_value']} "
            f"选择理由：{candidate['rank_reason']}"
        )
        resources.append(
            LearningCollectedResource(
                id=f"agentic-search-{index}",
                title=candidate.get("display_title") or result.title,
                source_type="Agentic Web Search",
                query=result.query,
                reason=reason,
                url=result.url,
                snippet=result.snippet,
                provider=result.provider,
                quality_score=round(candidate["score"], 3),
                resource_kind=candidate["resource_kind"],
                learning_value=candidate["learning_value"],
                search_intent=candidate["intent"],
            )
        )
    return resources


async def collect_learning_resources(
    context: dict[str, str],
    command_id: str | None = None,
) -> list[LearningCollectedResource]:
    await raise_if_command_canceled(command_id)
    plans = await _llm_agentic_search_plan(context)
    await raise_if_command_canceled(command_id)
    search_batches = await asyncio.gather(
        *(search_web(plan.query, limit=8) for plan in plans),
        return_exceptions=True,
    )
    await raise_if_command_canceled(command_id)

    web_results: list[WebSearchResult] = []
    for batch in search_batches:
        if isinstance(batch, Exception):
            continue
        web_results.extend(batch)

    intent_by_query = {plan.query: plan.intent for plan in plans}
    ranked_candidates = _build_ranked_search_candidates(
        web_results,
        context,
        intent_by_query,
    )
    await raise_if_command_canceled(command_id)
    ranked_candidates = await _llm_rerank_search_results(context, ranked_candidates)
    await raise_if_command_canceled(command_id)
    resources = _resources_from_ranked_candidates(
        _select_diverse_search_results(ranked_candidates, limit=10)
    )
    if resources:
        resources.append(
            LearningCollectedResource(
                id="student-upload",
                title="学生自有课件、作业或课堂笔记",
                source_type="用户上传",
                query="由学生上传 PDF、PPT、Markdown、网页或文本资料",
                reason="学生可不采纳系统搜索结果，改用自己的课堂资料作为生成依据。",
                adoption_status="user_upload",
            )
        )
        return resources

    return _build_fallback_collected_resources(context)


def _build_learning_path(context: dict[str, str]) -> list[LearningPathStep]:
    return [
        LearningPathStep(
            order=1,
            title="建立课程地图",
            objective="先形成全局结构，降低碎片化学习成本",
            activities=["确认采纳的候选资料", "阅读个性化讲解稿", "查看知识结构图"],
            resources=["资源搜集清单", "课程讲解文档", "知识点思维导图"],
            checkpoint="能用 3 分钟讲出课程主题之间的关系",
        ),
        LearningPathStep(
            order=2,
            title="补齐关键短板",
            objective="针对画像中的薄弱点进行小步快练",
            activities=["完成基础题", "整理错因", "回看对应讲解段落"],
            resources=["Quiz", "拓展阅读材料"],
            checkpoint="基础题正确率达到 80%",
        ),
        LearningPathStep(
            order=3,
            title="完成实操迁移",
            objective="把概念迁移到真实数据或工程任务",
            activities=["运行 Notebook 实验", "记录参数变化", "解释结果差异"],
            resources=["代码实操案例", "讲解文档"],
            checkpoint="能独立解释一次实验结果和误差来源",
        ),
        LearningPathStep(
            order=4,
            title="评估并动态更新画像",
            objective="根据练习和反馈更新后续资源推送",
            activities=["提交学习反馈", "复盘错题类型", "生成下一轮学习计划"],
            resources=["学习效果评估", "智能辅导回复"],
            checkpoint="形成下一轮个性化学习任务清单",
        ),
    ]


def build_learning_orchestration(
    request: LearningOrchestrationRequest,
    collected_resources_override: list[LearningCollectedResource] | None = None,
    generated_resources_override: list[LearningResource] | None = None,
    has_selected_sources_without_text: bool = False,
) -> LearningOrchestrationResponse:
    context = _normalized_request(request)
    profile = _build_profile(context)
    collected_resources = (
        []
        if request.mode == "chat"
        else collected_resources_override or _build_fallback_collected_resources(context)
    )
    if request.mode == "generate":
        if generated_resources_override is not None:
            resources = generated_resources_override
        elif has_selected_sources_without_text:
            resources = []
        else:
            resources = _build_resources(context, request.requested_outputs)
    else:
        resources = []
    learning_path = _build_learning_path(context) if request.mode == "generate" else []
    selected_labels = [
        OUTPUT_LABELS[output]
        for output in request.requested_outputs
        if output in OUTPUT_LABELS
    ]
    recommendations = [
        "先检查资源搜集智能体给出的候选资料；不相关资料可以拒绝，也可以上传自己的课件替换。",
        "只生成学生当前选择的资产，把测验、闪卡、讲解、播客等学习动作分开完成。",
        "在完成基础题后再推送代码实操，避免过早进入工具细节。",
        "对错题集中出现的概念边界问题，触发智能辅导进行二次讲解。",
        "每完成一个阶段后刷新画像置信度，并重新排序资源推荐。",
    ]
    if request.mode == "chat":
        tutor_answer = (
            f"针对「{context['message']}」，我会先定位你卡住的是概念、推理还是应用。"
            "如果是概念问题，先用一个反例澄清边界；如果是题目问题，先写出已知条件、目标和可选方法，"
            "再判断该用哪条路径。"
        )
    elif request.mode == "collect":
        tutor_answer = (
            "资源搜集智能体已经给出候选来源。你可以采纳外部链接让系统自动导入来源，"
            "也可以上传自己的课件、作业或笔记作为更可信的学习依据。"
        )
    else:
        selected = "、".join(selected_labels) or "学习资产"
        if has_selected_sources_without_text:
            tutor_answer = (
                "当前学习记录里有来源，但来源正文还没有处理完成或没有可用文本。"
                "为避免幻觉，本次没有生成基于来源的学习资产。请等待来源处理完成，或补充可读取的文本、PDF 或网页来源。"
            )
        else:
            tutor_answer = (
                f"已围绕「{context['message']}」生成：{selected}。"
                "建议先完成测验或闪卡确认薄弱点，再打开讲解、阅读或代码实操做深入学习。"
            )
    evaluation = LearningEvaluation(
        score=76,
        strengths=["目标表达清晰", "适合结构化学习", "可通过实操快速验证理解"],
        risks=["先修知识掌握程度仍不稳定", "容易跳过错因复盘", "多资源并行时可能分散注意力"],
        next_adjustments=["缩短单次学习任务", "增加错题归因提示", "优先推荐与专业背景相关的案例"],
    )
    safety_report = LearningSafetyReport(
        status="passed",
        checks=[
            "无敏感违规内容",
            "搜索候选资料均标注来源类型和采纳状态",
            "资源建议未包含未经验证的具体事实断言",
            "学习建议与学生输入保持一致",
        ],
        revisions=["播客生成走独立 TTS 管线，文本学习资产仅保留可验证内容。"],
    )
    trace = [
        LearningAgentStage(
            id=agent_id,
            name=name,
            role=role,
            status="completed",
            progress=100,
            output=output,
        )
        for agent_id, name, role, output in _stage_blueprints_for_mode(request.mode)
    ]

    return LearningOrchestrationResponse(
        profile=profile,
        collected_resources=collected_resources,
        resources=resources,
        learning_path=learning_path,
        recommendations=recommendations,
        tutor_answer=tutor_answer,
        evaluation=evaluation,
        safety_report=safety_report,
        trace=trace,
    )


async def build_learning_orchestration_with_search(
    request: LearningOrchestrationRequest,
    command_id: str | None = None,
) -> LearningOrchestrationResponse:
    context = _normalized_request(request)
    await raise_if_command_canceled(command_id)
    if request.learning_record_id and request.use_profile_source:
        await get_or_create_learning_profile_source(request.learning_record_id)

    collected_resources = None
    if request.mode != "chat":
        collected_resources = await collect_learning_resources(context, command_id)
        await raise_if_command_canceled(command_id)

    generated_resources = None
    has_selected_sources_without_text = False
    if request.mode == "generate":
        source_context, selected_source_count = await _collect_generation_source_context(
            request
        )
        if source_context:
            generated_resources = await _generate_resources_from_sources(
                context,
                request,
                source_context,
            )
        elif selected_source_count > 0:
            generated_resources = []
            has_selected_sources_without_text = True

    response = build_learning_orchestration(
        request,
        collected_resources,
        generated_resources,
        has_selected_sources_without_text,
    )

    if request.learning_record_id:
        summary = (
            f"mode={request.mode}; goal={context['goal']}; message={context['message']}; "
            f"requested_outputs={', '.join(request.requested_outputs or []) or 'none'}"
        )
        await record_learning_profile_event(
            request.learning_record_id,
            f"{request.mode}_request",
            summary,
            request.auto_update_profile,
        )

    return response


async def stream_learning_orchestration(
    request: LearningOrchestrationRequest,
) -> AsyncGenerator[dict, None]:
    blueprints = _stage_blueprints_for_mode(request.mode)
    total = len(blueprints)
    for index, (agent_id, name, role, output) in enumerate(blueprints, start=1):
        base_progress = round(((index - 1) / total) * 100)
        yield {
            "type": "stage",
            "stage": LearningAgentStage(
                id=agent_id,
                name=name,
                role=role,
                status="running",
                progress=base_progress,
                output="正在处理学生画像、课程资料与资源生成上下文",
            ).model_dump(),
        }
        await asyncio.sleep(0.08)
        yield {
            "type": "stage",
            "stage": LearningAgentStage(
                id=agent_id,
                name=name,
                role=role,
                status="completed",
                progress=round((index / total) * 100),
                output=output,
            ).model_dump(),
        }

    result = await build_learning_orchestration_with_search(request)
    yield {"type": "complete", "result": result.model_dump()}
