import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "build_competition_demo.py"
SPEC = importlib.util.spec_from_file_location("competition_demo_builder", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)


def test_spoken_weight_does_not_count_latin_words_letter_by_letter():
    assert BUILDER.spoken_weight("人工智能") == 4
    assert BUILDER.spoken_weight("ForgeNote") < len("ForgeNote") / 2


def test_caption_cues_follow_real_pause_boundaries_without_overlap():
    pauses = [
        (2.006, 2.300),
        (7.326, 7.804),
        (12.618, 12.892),
        (15.959, 16.314),
    ]

    cues = BUILDER.caption_cues([20.158], pauses)

    assert cues[0]["end"] == pytest.approx(1.976)
    assert cues[1]["start"] == pytest.approx(2.006)
    assert cues[1]["end"] == pytest.approx(7.296)
    assert all(
        float(next_cue["start"]) >= float(cue["end"])
        for cue, next_cue in zip(cues, cues[1:])
    )


def test_scene_durations_snap_to_long_paragraph_pause():
    durations = BUILDER.align_scene_durations(
        [20.0, 20.0],
        [(18.5, 19.1)],
    )

    assert durations == [18.5, 21.5]
