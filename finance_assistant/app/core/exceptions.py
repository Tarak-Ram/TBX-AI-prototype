class FinanceAssistantException(Exception):
    """Base exception for all finance assistant errors."""
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

class DatasetError(FinanceAssistantException):
    """Raised when there is an issue with dataset processing or ingestion."""
    pass

class SchemaMismatchError(FinanceAssistantException):
    """Raised when an uploaded dataset cannot be mapped to the canonical schema."""
    pass

class IncompatibleSchemaError(FinanceAssistantException):
    """Raised when required financial fields are missing."""
    pass

class UnsupportedQuestionError(FinanceAssistantException):
    """Raised when a user question cannot be answered by the available data."""
    pass

class AmbiguousEntityError(FinanceAssistantException):
    """Raised when multiple candidate entities match user input."""
    pass

class EntityNotFoundError(FinanceAssistantException):
    """Raised when a specified vendor or entity does not exist in the dataset."""
    pass

class DateResolutionError(FinanceAssistantException):
    """Raised when a date range or period expression cannot be resolved."""
    pass

class QueryExecutionError(FinanceAssistantException):
    """Raised when DuckDB execution or validation fails."""
    pass

class GuardrailViolationError(FinanceAssistantException):
    """Raised when an LLM explanation contains ungrounded/invented numbers."""
    pass

class DuplicateDataError(FinanceAssistantException):
    """Raised during Add operations when duplicate records are encountered."""
    pass
