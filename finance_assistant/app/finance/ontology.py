from enum import Enum
from pydantic import BaseModel, Field

class Domain(str, Enum):
    TRANSACTIONS = "transactions"
    VENDOR_PAYOUTS = "vendor_payouts"
    RECONCILIATION = "reconciliation"

class Operation(str, Enum):
    SUM = "sum"
    COUNT = "count"
    LIST = "list"
    RANKING = "ranking"
    GROUP_BY = "group_by"
    COMPARISON = "comparison"

class Metric(str, Enum):
    AMOUNT = "amount"
    TRANSACTION_COUNT = "transaction_count"

ALLOWED_DOMAINS = [d.value for d in Domain]
ALLOWED_OPERATIONS = [o.value for o in Operation]
ALLOWED_METRICS = [m.value for m in Metric]

DOMAIN_REQUIRED_FIELDS = {
    Domain.TRANSACTIONS.value: ["amount"],
    Domain.VENDOR_PAYOUTS.value: ["amount", "vendor"],
    Domain.RECONCILIATION.value: ["amount", "status"],
}

class FinancialOntology:
    """Provides validation against the controlled financial ontology."""

    @staticmethod
    def is_domain_supported(domain: str) -> bool:
        return domain in ALLOWED_DOMAINS

    @staticmethod
    def is_operation_supported(operation: str) -> bool:
        return operation in ALLOWED_OPERATIONS

    @staticmethod
    def is_metric_supported(metric: str) -> bool:
        return metric in ALLOWED_METRICS

    @staticmethod
    def validate_domain_capabilities(domain: str, available_fields: list[str]) -> tuple[bool, str | None]:
        required = DOMAIN_REQUIRED_FIELDS.get(domain, [])
        missing = [f for f in required if f not in available_fields]
        if missing:
            return False, f"Domain '{domain}' requires fields {missing}, which are missing in the dataset."
        return True, None
