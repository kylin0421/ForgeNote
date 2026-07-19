#!/usr/bin/env python3
"""Build the self-contained ForgeNote competition demo video."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SUBMISSION_DIR = ROOT / "to_be_submitted_docs"
SCREEN_SOURCE_DIR = (
    Path(os.environ.get("LOCALAPPDATA", ""))
    / "Temp"
    / "forgenote-competition-demo"
    / "screens"
)
ASSET_DIR = SUBMISSION_DIR / "assets" / "competition-demo"
WORK_DIR = ASSET_DIR / "_build"
OUTPUT_VIDEO = SUBMISSION_DIR / "ForgeNote七分钟实机演示.mp4"
OUTPUT_SCRIPT = SUBMISSION_DIR / "ForgeNote七分钟实机演示-旁白.txt"
OUTPUT_SRT = SUBMISSION_DIR / "ForgeNote七分钟实机演示.srt"
OUTPUT_NOTE = SUBMISSION_DIR / "ForgeNote七分钟实机演示-生成说明.txt"
NARRATION_AUDIO = ASSET_DIR / "ForgeNote七分钟实机演示-配音.wav"
EXPLAINER_VIDEO = SUBMISSION_DIR / "人工智能与Python课程讲解视频.mp4"


@dataclass(frozen=True)
class Scene:
    chapter: str
    source: str
    narration: str
    source_kind: str = "image"
    video_start: float = 0.0
    wait_edited: bool = False


SCENES = [
    Scene(
        "开场",
        "title.png",
        "大家好，这是 ForgeNote，一套面向高校课程学习的多智能体、多模态个性化学习系统。本次演示使用人工智能与 Python 高校课程知识点测试数据，完整展示从资料入库、学习画像，到资源生成、练习反馈和持续自适应的闭环。",
    ),
    Scene(
        "课程工作区",
        "01-home.png",
        "进入首页，每门课程对应一个独立学习工作区。这里已经建立人工智能与 Python 专业课知识库。学习记录、来源、问询、模型和设置入口保持统一，学生不需要在多个工具之间搬运资料与学习结果。",
    ),
    Scene(
        "可信来源",
        "19-sources.png",
        "来源页显示课程知识点文档已经完成检索索引。ForgeNote 将文档解析、分段、向量检索与来源追踪连接起来，后续回答和生成资源均可约束在选定课程材料内，降低脱离教材的幻觉风险。",
    ),
    Scene(
        "知识库问询",
        "21-question-entered.png",
        "在问询页输入 A 星搜索中启发式函数需要满足什么条件，并明确要求依据课程资料回答。系统把问题交给策略、检索、回答和最终整理链路；模型与检索配置都可见，便于复核生成依据。",
    ),
    Scene(
        "动态学习画像",
        "03-learning-profile.png",
        "进入课程工作室，学习画像不是静态标签，而是由画像智能体持续维护。它覆盖知识掌握、学习目标、学习历史、认知与表达偏好、错题风险、资源偏好、学习进度和下一步计划等多个维度，并保留证据与置信度。",
    ),
    Scene(
        "多智能体生成",
        "05-asset-generation.png",
        "现在从指定课程来源发起学习指南生成。用户可以选择内容形式、语言、篇幅和来源范围。画像智能体、检索智能体、规划智能体、资源生成智能体与评估流程协作完成任务；生成过程在后台运行，不阻塞继续学习。本演示已剪去接口等待时间。",
        wait_edited=True,
    ),
    Scene(
        "资源矩阵",
        "02-course-studio.png",
        "任务完成后，同一份课程材料已经形成学习指南、思维导图、测验、闪卡、延伸阅读、代码实验、播客和讲解视频等资源。不同资源共享来源上下文和个人画像，而不是彼此孤立地重复生成。",
    ),
    Scene(
        "个性化测验",
        "06-quiz.png",
        "先打开测验。题目围绕课程中的人工智能三大流派生成，并给出作答进度。测验既是学习资源，也是画像更新事件：系统记录知识点、作答结果和困难程度，为下一轮资源推荐提供依据。",
    ),
    Scene(
        "即时反馈",
        "07-quiz-feedback.png",
        "这里故意选择一个错误答案。系统立即给出正确选项、解释和来源位置，同时把错误写入错题本。这种有依据的即时反馈，把一次作答转化为可追踪的诊断数据，而不是只显示一个分数。",
    ),
    Scene(
        "结构化理解",
        "09-mind-map-expanded.png",
        "思维导图把知识组织为可交互层级。展开监督学习算法节点，可以继续查看概念关系。它适合建立全局结构，也能与学习指南和测验互相补充，帮助学生从记忆单点转向理解知识网络。",
    ),
    Scene(
        "证据闪卡",
        "12-flashcard-answer.png",
        "闪卡用于短时复习。翻面后不仅展示答案，还附带来源证据。学生可以根据掌握程度快速自评；这些轻量交互同样进入学习记录，使后续推送更贴合真实掌握情况。",
    ),
    Scene(
        "代码实践",
        "10-code-lab.png",
        "对于 Python 与算法课程，ForgeNote 生成可执行导向的代码实验，包含目标、步骤、示例代码和思考任务。资源规划会把概念学习、实现练习与测试验证连接起来，避免只生成一篇泛化说明。",
    ),
    Scene(
        "延伸阅读",
        "13-reading.png",
        "延伸阅读按相关性、推荐度和经典程度排序，并说明推荐理由。资源不是简单罗列链接，而是根据当前课程主题和学习阶段组织，形成从核心材料到拓展内容的可解释路径。",
    ),
    Scene(
        "生成式播客",
        "14-podcast-playing.png",
        "播客把课程知识转为适合通勤和复习的双人讲解音频。脚本由语言模型根据来源与画像规划，再由语音模型合成。界面支持直接播放，让听觉型学习者可以在同一工作区继续学习。",
    ),
    Scene(
        "轻量讲解视频",
        "人工智能与Python课程讲解视频.mp4",
        "讲解视频采用轻量多模态方案：语言模型一次返回旁白脚本、关键帧时间索引和图片提示词；系统并行生成关键帧，结合语音、转场和单层字幕合成视频。这样不依赖昂贵的视频生成接口，也保留可控的教学节奏与画面依据。",
        source_kind="video",
        video_start=18.0,
    ),
    Scene(
        "错题闭环",
        "15-mistake-book.png",
        "回到错题本，刚才的错误已经按课程和知识点沉淀。学生可以直接回看题目、正确答案和解释；系统则把它识别为需要复习的风险信号，用于调整下一步练习与资源优先级。",
    ),
    Scene(
        "画像更新",
        "16-profile-updated.png",
        "再次查看学习画像，可以看到练习数量、正确率、当前评估、风险和下一步计划已经更新。画像以事件驱动方式演进，资源生成和学习行为形成反馈回路，实现真正的持续个性化。",
    ),
    Scene(
        "学习轨迹",
        "04-learning-curve.png",
        "学习曲线汇总阶段性变化，帮助学生和教师观察趋势。系统据此生成个性化学习路径，并把适合的测验、复习卡、阅读或代码练习推送到当前课程工作区，形成可执行的下一步。",
    ),
    Scene(
        "模型编排",
        "18-models-assigned.png",
        "模型设置页展示不同任务的模型编排。通用文本使用更快模型，播客等复杂任务使用更强模型，嵌入、图像与语音分别调用对应能力。来源上下文并行读取、资源任务并发执行，并按资源类型控制输出预算；剩余等待主要来自外部模型接口。",
    ),
    Scene(
        "总结",
        "02-course-studio.png",
        "以上是 ForgeNote 的完整学习闭环：可信课程资料进入知识库，多智能体结合动态画像规划任务，生成八类个性化资源，再由练习、错题和学习曲线持续反馈。项目开发使用 AI Coding 辅助，核心功能通过自动化测试与真实界面验证。感谢观看。",
    ),
]


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def ffprobe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def ffmpeg_filter_path(path: Path) -> str:
    escaped = path.resolve().as_posix().replace("'", "\\'")
    if len(escaped) >= 2 and escaped[1] == ":":
        escaped = f"{escaped[0]}\\:{escaped[2:]}"
    return escaped


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def make_title(source: Path, output: Path) -> None:
    image = Image.open(source).convert("RGB").resize((1280, 720))
    image = image.filter(ImageFilter.GaussianBlur(radius=4))
    image = ImageEnhance.Brightness(image).enhance(0.36)
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle((90, 150, 1190, 570), radius=38, fill=(5, 18, 37, 220))
    draw.text((640, 230), "ForgeNote", font=load_font(72, True), fill="#FFFFFF", anchor="mm")
    draw.text(
        (640, 330),
        "多智能体 · 多模态个性化学习系统",
        font=load_font(36, True),
        fill="#72E1C1",
        anchor="mm",
    )
    draw.text(
        (640, 420),
        "七分钟实机演示｜人工智能与 Python 高校课程测试数据",
        font=load_font(25),
        fill="#E5EDF7",
        anchor="mm",
    )
    draw.text(
        (640, 488),
        "资料入库 → 动态画像 → 资源生成 → 练习反馈 → 持续自适应",
        font=load_font(21),
        fill="#A9B8CA",
        anchor="mm",
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, quality=96)


def decorate_screen(source: Path, output: Path, chapter: str, wait_edited: bool) -> None:
    image = Image.open(source).convert("RGB").resize((1280, 720))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle((24, 18, 278, 64), radius=14, fill=(7, 21, 40, 215))
    draw.text((43, 41), chapter, font=load_font(20, True), fill="#FFFFFF", anchor="lm")
    if wait_edited:
        draw.rounded_rectangle((930, 18, 1255, 64), radius=14, fill=(18, 123, 102, 230))
        draw.text(
            (1092, 41),
            "后台生成｜等待片段已剪辑",
            font=load_font(17, True),
            fill="#FFFFFF",
            anchor="mm",
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, quality=96)


def load_local_configuration() -> None:
    config_file = Path(os.environ.get("LOCALAPPDATA", "")) / "ZhiXue" / "config.env"
    if not config_file.exists():
        raise FileNotFoundError(f"Local ForgeNote configuration not found: {config_file}")
    values: dict[str, str] = {}
    for raw_line in config_file.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    for key in (
        "SURREAL_URL",
        "SURREAL_USER",
        "SURREAL_PASSWORD",
        "SURREAL_NAMESPACE",
        "SURREAL_DATABASE",
    ):
        if values.get(key):
            os.environ[key] = values[key]
    encryption_key = values.get("FORGENOTE_ENCRYPTION_KEY") or values.get(
        "OPEN_NOTEBOOK_ENCRYPTION_KEY"
    )
    if encryption_key:
        os.environ["FORGENOTE_ENCRYPTION_KEY"] = encryption_key
    os.environ.setdefault(
        "FORGENOTE_DATA_DIR",
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "ZhiXue" / "data"),
    )


async def synthesize_chunks(chunks: list[str], outputs: list[Path]) -> None:
    load_local_configuration()
    sys.path.insert(0, str(ROOT))
    from forgenote.ai.models import model_manager

    model = await model_manager.get_text_to_speech()
    if model is None:
        raise RuntimeError("No default text-to-speech model is configured")

    semaphore = asyncio.Semaphore(3)

    async def synthesize(text: str, output: Path) -> None:
        async with semaphore:
            await model.agenerate_speech(
                text=text,
                voice="mimo_default",
                output_file=output,
                response_format="wav",
                speed=1.0,
            )

    await asyncio.gather(*(synthesize(text, path) for text, path in zip(chunks, outputs)))


def generate_narration(force: bool) -> float:
    narration_raw = WORK_DIR / "narration-raw.wav"
    if NARRATION_AUDIO.exists() and not force:
        return ffprobe_duration(NARRATION_AUDIO)

    groups = [SCENES[index : index + 5] for index in range(0, len(SCENES), 5)]
    texts = ["\n\n".join(scene.narration for scene in group) for group in groups]
    chunk_paths = [WORK_DIR / f"voice-{index:02d}.wav" for index in range(len(groups))]
    asyncio.run(synthesize_chunks(texts, chunk_paths))

    concat_file = WORK_DIR / "audio-concat.txt"
    concat_file.write_text(
        "\n".join(f"file '{path.as_posix()}'" for path in chunk_paths) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    run(
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_file),
        "-c:a",
        "pcm_s16le",
        str(narration_raw),
    )

    raw_duration = ffprobe_duration(narration_raw)
    target_minimum = 360.0
    target_maximum = 405.0
    if raw_duration < target_minimum:
        tempo = max(0.82, raw_duration / target_minimum)
    elif raw_duration > target_maximum:
        tempo = raw_duration / target_maximum
    else:
        tempo = 1.0
    run(
        "ffmpeg",
        "-y",
        "-i",
        str(narration_raw),
        "-af",
        f"atempo={tempo:.6f},loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        str(NARRATION_AUDIO),
    )
    return ffprobe_duration(NARRATION_AUDIO)


def scene_weights() -> list[int]:
    return [max(1, len(scene.narration.replace(" ", ""))) for scene in SCENES]


def scene_durations(total_duration: float) -> list[float]:
    weights = scene_weights()
    total_weight = sum(weights)
    durations = [total_duration * weight / total_weight for weight in weights]
    durations[-1] += total_duration - sum(durations)
    return durations


def format_srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def split_caption(text: str, limit: int = 24) -> list[str]:
    clauses: list[str] = []
    buffer = ""
    for char in text:
        buffer += char
        if char in "。！？；":
            clauses.append(buffer.strip())
            buffer = ""
    if buffer.strip():
        clauses.append(buffer.strip())

    captions: list[str] = []
    for clause in clauses:
        remaining = clause
        while len(remaining) > limit:
            candidate = remaining[:limit]
            split_at = max(candidate.rfind(mark) for mark in "，、：") + 1
            if split_at < limit // 2:
                split_at = limit
            captions.append(remaining[:split_at].strip())
            remaining = remaining[split_at:].strip()
        if remaining:
            captions.append(remaining)
    return captions


def caption_cues(durations: list[float]) -> list[dict[str, float | str]]:
    cues: list[dict[str, float | str]] = []
    scene_start = 0.0
    for scene, duration in zip(SCENES, durations):
        captions = split_caption(scene.narration)
        weights = [max(1, len(caption)) for caption in captions]
        caption_start = scene_start
        for caption, weight in zip(captions, weights):
            caption_duration = duration * weight / sum(weights)
            caption_end = caption_start + caption_duration
            cues.append(
                {
                    "start": caption_start,
                    "end": max(caption_start, caption_end - 0.03),
                    "text": caption,
                }
            )
            caption_start = caption_end
        scene_start += duration
    return cues


def write_script_and_subtitles(durations: list[float]) -> None:
    lines = ["ForgeNote 七分钟实机演示旁白", ""]
    for scene in SCENES:
        lines.extend([f"【{scene.chapter}】", scene.narration, ""])
    srt_lines: list[str] = []
    for cue_index, cue in enumerate(caption_cues(durations), start=1):
        start = float(cue["start"])
        end = float(cue["end"])
        srt_lines.extend(
            [
                str(cue_index),
                f"{format_srt_time(start)} --> {format_srt_time(end)}",
                str(cue["text"]),
                "",
            ]
        )
    OUTPUT_SCRIPT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8", newline="\n")
    OUTPUT_SRT.write_text("\n".join(srt_lines).rstrip() + "\n", encoding="utf-8", newline="\n")


def prepare_images() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    needed = {scene.source for scene in SCENES if scene.source_kind == "image" and scene.source != "title.png"}
    for name in sorted(needed):
        source = SCREEN_SOURCE_DIR / name
        if not source.exists():
            raise FileNotFoundError(f"Recorded screen not found: {source}")
        shutil.copy2(source, ASSET_DIR / name)
    make_title(ASSET_DIR / "01-home.png", ASSET_DIR / "title.png")
    for index, scene in enumerate(SCENES):
        if scene.source_kind != "image":
            continue
        decorate_screen(
            ASSET_DIR / scene.source,
            WORK_DIR / f"screen-{index:02d}.jpg",
            scene.chapter,
            scene.wait_edited,
        )


def render_scene(index: int, scene: Scene, duration: float) -> Path:
    output = WORK_DIR / f"scene-{index:02d}.mp4"
    if output.exists() and abs(ffprobe_duration(output) - duration) < 0.12:
        return output
    frames = max(1, math.ceil(duration * 30))
    common_output = [
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "19",
        "-profile:v",
        "high",
        "-level:v",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-video_track_timescale",
        "90000",
        str(output),
    ]
    if scene.source_kind == "video":
        run(
            "ffmpeg",
            "-y",
            "-ss",
            f"{scene.video_start:.3f}",
            "-i",
            str(EXPLAINER_VIDEO),
            "-t",
            f"{duration:.3f}",
            "-vf",
            "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x061225,drawbox=x=0:y=540:w=iw:h=180:color=0x061225@0.98:t=fill,setsar=1,fps=30,format=yuv420p",
            *common_output,
        )
    else:
        run(
            "ffmpeg",
            "-y",
            "-loop",
            "1",
            "-i",
            str(WORK_DIR / f"screen-{index:02d}.jpg"),
            "-t",
            f"{duration:.3f}",
            "-vf",
            f"zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1280x720:fps=30,format=yuv420p",
            *common_output,
        )
    return output


def build_video(durations: list[float]) -> None:
    scene_files = [render_scene(index, scene, duration) for index, (scene, duration) in enumerate(zip(SCENES, durations))]
    concat_file = WORK_DIR / "video-concat.txt"
    concat_file.write_text(
        "\n".join(f"file '{path.as_posix()}'" for path in scene_files) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    silent_video = WORK_DIR / "silent-video.mp4"
    run(
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_file),
        "-c",
        "copy",
        str(silent_video),
    )

    caption_dir = WORK_DIR / "caption-text"
    caption_dir.mkdir(parents=True, exist_ok=True)
    font_path = Path("C:/Windows/Fonts/msyhbd.ttc")
    filters: list[str] = []
    video_input = "[0:v]"
    for cue_index, cue in enumerate(caption_cues(durations)):
        text_path = caption_dir / f"cue-{cue_index:03d}.txt"
        text_path.write_text(str(cue["text"]), encoding="utf-8", newline="\n")
        output_label = f"[caption{cue_index}]"
        options = [
            f"textfile='{ffmpeg_filter_path(text_path)}'",
            "reload=0",
            f"fontfile='{ffmpeg_filter_path(font_path)}'",
            "fontsize=30",
            "fontcolor=white",
            "borderw=2",
            "bordercolor=black@0.90",
            "box=1",
            "boxcolor=black@0.58",
            "boxborderw=14",
            "line_spacing=6",
            "x=(w-text_w)/2",
            "y=h-text_h-30",
            (
                "enable='gte(t,"
                f"{float(cue['start']):.3f})*lt(t,{float(cue['end']):.3f})'"
            ),
        ]
        filters.append(f"{video_input}drawtext={':'.join(options)}{output_label}")
        video_input = output_label
    filters.append(f"{video_input}setparams=range=tv,format=yuv420p[finalvideo]")
    video_input = "[finalvideo]"
    filter_script = WORK_DIR / "caption-filter.txt"
    filter_script.write_text(";".join(filters), encoding="utf-8", newline="\n")
    run(
        "ffmpeg",
        "-y",
        "-i",
        str(silent_video),
        "-i",
        str(NARRATION_AUDIO),
        "-filter_complex_script",
        str(filter_script),
        "-map",
        video_input,
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-profile:v",
        "high",
        "-level:v",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "avc1",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-profile:a",
        "aac_low",
        "-b:a",
        "160k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-shortest",
        str(OUTPUT_VIDEO),
    )


def write_note(duration: float) -> None:
    note = f"""ForgeNote 七分钟实机演示生成说明

数据来源：人工智能与 Python 高校课程知识点测试数据。
画面来源：ForgeNote 本地实机界面录制；资产生成等待片段已剪辑，保留发起任务和生成结果。
配音：ForgeNote 已配置的 MiMo 文本转语音模型。
字幕：单层烧录字幕，字幕时间段之间保留 30 毫秒间隔，避免重叠。
视频编码：H.264 High@4.0（avc1）、1280×720、30 fps、yuv420p。
音频编码：AAC-LC、48 kHz、双声道、160 kbps。
总时长：{duration:.3f} 秒（比赛要求不超过 420 秒）。

性能说明：多来源上下文改为并行读取；资源生成按类型控制最大输出长度；后台命令支持并发执行。历史任务耗时波动主要来自外部模型 API。
"""
    OUTPUT_NOTE.write_text(note, encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-tts", action="store_true", help="Regenerate the narration audio")
    args = parser.parse_args()
    prepare_images()
    duration = generate_narration(force=args.force_tts)
    if duration > 410:
        raise RuntimeError(f"Narration is too long for the competition limit: {duration:.3f}s")
    durations = scene_durations(duration)
    write_script_and_subtitles(durations)
    build_video(durations)
    output_duration = ffprobe_duration(OUTPUT_VIDEO)
    if output_duration > 420:
        raise RuntimeError(f"Output exceeds seven minutes: {output_duration:.3f}s")
    write_note(output_duration)
    print(json.dumps({"video": str(OUTPUT_VIDEO), "duration": output_duration}, ensure_ascii=False))


if __name__ == "__main__":
    main()
