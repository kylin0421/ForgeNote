from forgenote.ai.models import Model, _apply_provider_runtime_defaults


def _deepseek_flash() -> Model:
    return Model(
        name="deepseek-v4-flash",
        provider="deepseek",
        type="language",
    )


def test_deepseek_flash_disables_thinking_by_default():
    configured = _apply_provider_runtime_defaults(_deepseek_flash(), {})

    assert configured["extra_body"] == {"thinking": {"type": "disabled"}}


def test_deepseek_flash_preserves_explicit_thinking_choice():
    configured = _apply_provider_runtime_defaults(
        _deepseek_flash(),
        {"extra_body": {"thinking": {"type": "enabled"}}},
    )

    assert configured["extra_body"] == {"thinking": {"type": "enabled"}}


def test_other_models_are_unchanged():
    config = {"temperature": 0.2}
    model = Model(name="mimo-v2.5", provider="openai", type="language")

    assert _apply_provider_runtime_defaults(model, config) is config
