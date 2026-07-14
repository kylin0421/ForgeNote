class ForgeNoteError(Exception):
    """Base exception class for ForgeNote errors."""

    pass


class DatabaseOperationError(ForgeNoteError):
    """Raised when a database operation fails."""

    pass


class UnsupportedTypeException(ForgeNoteError):
    """Raised when an unsupported type is provided."""

    pass


class InvalidInputError(ForgeNoteError):
    """Raised when invalid input is provided."""

    pass


class NotFoundError(ForgeNoteError):
    """Raised when a requested resource is not found."""

    pass


class AuthenticationError(ForgeNoteError):
    """Raised when there's an authentication problem."""

    pass


class ConfigurationError(ForgeNoteError):
    """Raised when there's a configuration problem."""

    pass


class ExternalServiceError(ForgeNoteError):
    """Raised when an external service (e.g., AI model) fails."""

    pass


class RateLimitError(ForgeNoteError):
    """Raised when a rate limit is exceeded."""

    pass


class FileOperationError(ForgeNoteError):
    """Raised when a file operation fails."""

    pass


class NetworkError(ForgeNoteError):
    """Raised when a network operation fails."""

    pass


class NoTranscriptFound(ForgeNoteError):
    """Raised when no transcript is found for a video."""

    pass
