"""
Models service layer using API.
"""

from typing import List, Optional

from loguru import logger

from api.client import api_client
from open_notebook.ai.models import DefaultModels, Model


DEFAULT_MODEL_FIELDS = [
    "default_chat_model",
    "default_transformation_model",
    "large_context_model",
    "default_text_to_speech_model",
    "default_speech_to_text_model",
    "default_embedding_model",
    "default_retrieval_model",
    "default_tools_model",
    "default_rag_model",
    "default_resource_search_model",
    "default_learning_asset_model",
    "default_study_guide_model",
    "default_quiz_model",
    "default_flashcards_model",
    "default_mind_map_model",
    "default_reading_model",
    "default_code_lab_model",
    "default_podcast_model",
    "default_image_model",
]


class ModelsService:
    """Service layer for models operations using API."""

    def __init__(self):
        logger.info("Using API for models operations")

    def get_all_models(self, model_type: Optional[str] = None) -> List[Model]:
        """Get all models with optional type filtering."""
        models_data = api_client.get_models(model_type=model_type)
        # Convert API response to Model objects
        models = []
        for model_data in models_data:
            model = Model(
                name=model_data["name"],
                provider=model_data["provider"],
                type=model_data["type"],
            )
            model.id = model_data["id"]
            model.created = model_data["created"]
            model.updated = model_data["updated"]
            models.append(model)
        return models

    def create_model(self, name: str, provider: str, model_type: str) -> Model:
        """Create a new model."""
        response = api_client.create_model(name, provider, model_type)
        model_data = response if isinstance(response, dict) else response[0]
        model = Model(
            name=model_data["name"],
            provider=model_data["provider"],
            type=model_data["type"],
        )
        model.id = model_data["id"]
        model.created = model_data["created"]
        model.updated = model_data["updated"]
        return model

    def delete_model(self, model_id: str) -> bool:
        """Delete a model."""
        api_client.delete_model(model_id)
        return True

    def get_default_models(self) -> DefaultModels:
        """Get default model assignments."""
        response = api_client.get_default_models()
        defaults_data = response if isinstance(response, dict) else response[0]
        defaults = DefaultModels()

        # Set the values from API response
        for field in DEFAULT_MODEL_FIELDS:
            setattr(defaults, field, defaults_data.get(field))

        return defaults

    def update_default_models(self, defaults: DefaultModels) -> DefaultModels:
        """Update default model assignments."""
        updates = {field: getattr(defaults, field, None) for field in DEFAULT_MODEL_FIELDS}

        response = api_client.update_default_models(**updates)
        defaults_data = response if isinstance(response, dict) else response[0]

        # Update the defaults object with the response
        for field in DEFAULT_MODEL_FIELDS:
            setattr(defaults, field, defaults_data.get(field))

        return defaults


# Global service instance
models_service = ModelsService()
