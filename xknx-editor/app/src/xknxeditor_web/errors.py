"""Error types mapped to HTTP responses by the API layer."""

from __future__ import annotations


class ApiError(Exception):
    """A request the caller can fix; carries the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


class NotFound(ApiError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 404)


class NoProject(ApiError):
    def __init__(self) -> None:
        super().__init__("No project is open", 409)
