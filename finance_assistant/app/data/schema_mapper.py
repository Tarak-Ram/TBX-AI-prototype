import re
import difflib
import pandas as pd
from pydantic import BaseModel, Field
from app.data.schema_registry import CANONICAL_SCHEMA, CanonicalField
from app.data.inspector import DatasetInspector, DatasetProfile

class CompatibilityResult(BaseModel):
    compatible: bool
    confidence: float
    mapped_fields: dict[str, str] = Field(default_factory=dict)
    unmapped_canonical_fields: list[str] = Field(default_factory=list)
    missing_required_fields: list[str] = Field(default_factory=list)
    supported_domains: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    explanation: str

class SchemaCompatibilityChecker:
    """Evaluates whether an uploaded dataset matches the financial ontology and maps columns."""

    @classmethod
    def normalize_str(cls, text: str) -> str:
        return re.sub(r"[^a-zA-Z0-9]", "", text.lower())

    @classmethod
    def check_compatibility(
        cls, 
        profile: DatasetProfile,
        user_mappings: dict[str, str] | None = None
    ) -> CompatibilityResult:
        mapped_fields: dict[str, str] = {}
        warnings: list[str] = []
        raw_cols = list(profile.columns.keys())
        norm_raw_cols = {cls.normalize_str(c): c for c in raw_cols}

        # Apply any explicit user mappings first
        if user_mappings:
            for canon_name, dataset_col in user_mappings.items():
                if dataset_col in profile.columns:
                    mapped_fields[canon_name] = dataset_col

        # Auto-map remaining canonical fields using alias heuristics and profile inspection
        for canon_field, canon_def in CANONICAL_SCHEMA.items():
            field_key = canon_field.value
            if field_key in mapped_fields:
                continue

            # 1. Profile suggestion priority
            if field_key == "amount" and profile.suggested_amount_column:
                mapped_fields[field_key] = profile.suggested_amount_column
                continue
            elif field_key == "transaction_date" and profile.suggested_date_column:
                mapped_fields[field_key] = profile.suggested_date_column
                continue
            elif field_key == "vendor" and profile.suggested_vendor_column:
                mapped_fields[field_key] = profile.suggested_vendor_column
                continue
            elif field_key == "status" and profile.suggested_status_column:
                mapped_fields[field_key] = profile.suggested_status_column
                continue
            elif field_key == "category" and profile.suggested_category_column:
                mapped_fields[field_key] = profile.suggested_category_column
                continue

            # 2. Match aliases
            best_col = None
            best_score = 0.0

            for raw_col in raw_cols:
                if raw_col in mapped_fields.values():
                    continue
                norm_col = cls.normalize_str(raw_col)

                # Check exact alias match
                for alias in canon_def.common_aliases:
                    norm_alias = cls.normalize_str(alias)
                    if norm_col == norm_alias:
                        best_col = raw_col
                        best_score = 1.0
                        break
                    # Substring match
                    elif norm_alias in norm_col or norm_col in norm_alias:
                        sim = difflib.SequenceMatcher(None, norm_col, norm_alias).ratio()
                        if sim > best_score and sim >= 0.75:
                            best_score = sim
                            best_col = raw_col

                if best_score == 1.0:
                    break

            if best_col and best_score >= 0.75:
                mapped_fields[field_key] = best_col

        # Validate minimum viability
        has_amount = "amount" in mapped_fields
        has_date = "transaction_date" in mapped_fields
        has_vendor = "vendor" in mapped_fields
        has_status = "status" in mapped_fields

        missing_required = []
        supported_domains = []

        if not has_amount:
            missing_required.append("amount")

        if has_amount:
            supported_domains.append("transactions")

        if has_amount and has_vendor:
            supported_domains.append("vendor_payouts")
        else:
            if not has_vendor:
                warnings.append("No vendor column mapped. Vendor queries will be unavailable until a vendor column is mapped.")

        if has_amount and has_status:
            supported_domains.append("reconciliation")
        else:
            if not has_status:
                warnings.append("No status column mapped. Reconciliation queries will be limited.")

        if not has_date:
            warnings.append("No transaction date column mapped. Time-based queries (months, quarters, date ranges) will be unavailable.")

        # Determine compatibility and confidence
        compatible = has_amount
        confidence = 0.0
        if compatible:
            score = 0.4  # baseline for having amount
            if has_vendor:
                score += 0.3
            if has_date:
                score += 0.2
            if has_status:
                score += 0.1
            confidence = round(min(score, 0.98), 2)
        else:
            confidence = 0.1
            warnings.append("Dataset missing required 'amount' column for financial computation.")

        unmapped = [f.value for f in CANONICAL_SCHEMA.keys() if f.value not in mapped_fields]

        explanation = (
            f"Dataset is compatible with {len(supported_domains)} domain(s): {', '.join(supported_domains)}. "
            f"Confidence: {int(confidence * 100)}%."
            if compatible
            else "Your dataset cannot support financial questions because no reliable amount field was found."
        )

        return CompatibilityResult(
            compatible=compatible,
            confidence=confidence,
            mapped_fields=mapped_fields,
            unmapped_canonical_fields=unmapped,
            missing_required_fields=missing_required,
            supported_domains=supported_domains,
            warnings=warnings,
            explanation=explanation,
        )

class SchemaMapper:
    """Transforms raw DataFrame into canonical schema representation."""

    @staticmethod
    def apply_mapping(df: pd.DataFrame, mapped_fields: dict[str, str]) -> pd.DataFrame:
        df_canonical = pd.DataFrame()

        # Invert mapping: raw_col -> canonical_name
        for canon_name, raw_col in mapped_fields.items():
            if raw_col in df.columns:
                series = df[raw_col].copy()
                
                # Apply data type cleaning
                if canon_name == CanonicalField.AMOUNT.value:
                    series = DatasetInspector.clean_monetary_series(series)
                    series = pd.to_numeric(series, errors="coerce")
                elif canon_name == CanonicalField.TRANSACTION_DATE.value:
                    series = pd.to_datetime(series, errors="coerce").dt.date
                elif canon_name == CanonicalField.VENDOR.value:
                    series = series.astype(str).str.strip()
                elif canon_name == CanonicalField.STATUS.value:
                    series = series.astype(str).str.strip()
                elif canon_name == CanonicalField.CATEGORY.value:
                    series = series.astype(str).str.strip()

                df_canonical[canon_name] = series

        # Keep original columns with a raw_ prefix for unmapped or reference columns
        for col in df.columns:
            if col not in mapped_fields.values():
                df_canonical[f"raw_{col}"] = df[col]

        return df_canonical
