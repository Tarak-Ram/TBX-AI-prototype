import math
import re
from typing import Any
from app.core.exceptions import GuardrailViolationError, QueryExecutionError
from app.core.logging import logger
from app.finance.schemas import ExecutionResult

class ResultValidator:
    """Validates query execution output before evidence generation or explanation."""

    @classmethod
    def validate_execution(cls, result: ExecutionResult, expected_dataset_version: int) -> bool:
        if not result.query_id:
            raise QueryExecutionError("Result missing valid query_id.")

        if result.dataset_version != expected_dataset_version:
            raise QueryExecutionError(
                f"Dataset version mismatch. Expected v{expected_dataset_version}, got v{result.dataset_version}."
            )

        # Validate numeric outputs if present
        for k, v in result.result.items():
            if isinstance(v, (int, float)):
                if math.isnan(v) or math.isinf(v):
                    raise QueryExecutionError(f"Result metric '{k}' evaluated to NaN or Inf.")

        # Validate calculation metadata
        if not result.calculation or "formula" not in result.calculation:
            raise QueryExecutionError("Result missing deterministic calculation metadata.")

        logger.info(f"Result validation PASSED for Query ID {result.query_id}")
        return True

class FinalResponseGuardrail:
    """Verifies that every financial number in an LLM-generated text strictly exists in the deterministic result."""

    @classmethod
    def extract_numbers_from_text(cls, text: str) -> list[float]:
        # Matches integers, decimals, numbers with commas, currency prefixes, M/K/B multipliers
        tokens = text.replace(",", "").split()
        found_nums = []

        # Regex for values like ₹12.43M, 12431882, $5,000, 842, 12.43
        pattern = re.compile(r"([₹$€£]?)([-+]?\d*\.?\d+)\s*([kmbKMB%])?")
        for match in pattern.finditer(text):
            num_str = match.group(2)
            multiplier = match.group(3)
            try:
                val = float(num_str)
                if multiplier:
                    m = multiplier.lower()
                    if m == "k":
                        val *= 1_000
                    elif m == "m":
                        val *= 1_000_000
                    elif m == "b":
                        val *= 1_000_000_000
                found_nums.append(val)
            except ValueError:
                pass

        return found_nums

    @classmethod
    def get_allowed_numbers(cls, execution: ExecutionResult) -> set[float]:
        allowed = set()
        for v in execution.result.values():
            if isinstance(v, (int, float)):
                allowed.add(round(float(v), 2))
                # Also allow scaled representations e.g. millions, thousands
                if abs(v) >= 1_000:
                    allowed.add(round(v / 1_000, 2))
                if abs(v) >= 1_000_000:
                    allowed.add(round(v / 1_000_000, 2))
                if abs(v) >= 1_000_000_000:
                    allowed.add(round(v / 1_000_000_000, 2))

        # Include row counts and breakdown numbers
        allowed.add(float(execution.row_count))
        for row in execution.breakdown:
            for v in row.values():
                if isinstance(v, (int, float)):
                    allowed.add(round(float(v), 2))
                    if abs(v) >= 1_000:
                        allowed.add(round(v / 1_000, 2))
                    if abs(v) >= 1_000_000:
                        allowed.add(round(v / 1_000_000, 2))

        return allowed

    @classmethod
    def verify_response(cls, explanation_text: str, execution: ExecutionResult) -> bool:
        """Returns True if all numbers in explanation are grounded; raises GuardrailViolationError if ungrounded numbers appear."""
        extracted = cls.extract_numbers_from_text(explanation_text)
        allowed = cls.get_allowed_numbers(execution)

        # Calendar year (e.g. 2026, 2025, 2024, 2023) or day counts (1 to 31) are common date numbers
        date_allowed = {2023.0, 2024.0, 2025.0, 2026.0, 2027.0} | {float(i) for i in range(1, 32)}

        for num in extracted:
            rounded_num = round(num, 2)
            if rounded_num in date_allowed:
                continue

            # Check if within 2% margin for rounding (e.g. 12.43M vs 12,431,882)
            is_matched = False
            for a in allowed:
                if abs(rounded_num - a) < 0.05 or (a != 0 and abs(rounded_num - a) / abs(a) < 0.02):
                    is_matched = True
                    break

            if not is_matched:
                logger.warning(
                    f"Guardrail violation: Number '{rounded_num}' in LLM response not in verified set {allowed}."
                )
                raise GuardrailViolationError(
                    f"LLM generated ungrounded financial figure: {rounded_num}"
                )

        return True
