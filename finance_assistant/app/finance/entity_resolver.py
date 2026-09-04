import difflib
import re
from pydantic import BaseModel, Field
from app.core.exceptions import AmbiguousEntityError, EntityNotFoundError
from app.data.repository import finance_repository
from app.core.logging import logger

class EntityResolutionResult(BaseModel):
    status: str  # 'exact_match', 'approximate_match', 'multiple_matches', 'not_found'
    resolved_entity: str | None = None
    candidates: list[str] = Field(default_factory=list)
    confidence: float = 1.0
    message: str | None = None

class EntityResolver:
    """Resolves natural language entity/vendor mentions against real dataset records."""

    @staticmethod
    def normalize_name(name: str) -> str:
        # Lowercase, strip punctuation and company suffixes like inc, corp, pvt, ltd, co, llc
        s = name.lower().strip()
        s = re.sub(r"\b(inc|incorporated|corp|corporation|ltd|limited|llc|pvt|private|co|company)\b", "", s)
        s = re.sub(r"[^a-z0-9]", "", s)
        return s

    @classmethod
    def resolve_vendor(cls, query_vendor: str, existing_vendors: list[str] | None = None) -> EntityResolutionResult:
        if not query_vendor or not query_vendor.strip():
            return EntityResolutionResult(status="not_found", message="No vendor name provided.")

        raw_query = query_vendor.strip()
        norm_query = cls.normalize_name(raw_query)

        vendors = existing_vendors if existing_vendors is not None else finance_repository.get_vendors()
        if not vendors:
            return EntityResolutionResult(
                status="not_found",
                message=f"No vendors available in the current dataset."
            )

        # 1. Exact case-insensitive match
        for v in vendors:
            if v.lower() == raw_query.lower():
                return EntityResolutionResult(
                    status="exact_match",
                    resolved_entity=v,
                    candidates=[v],
                    confidence=1.0
                )

        # 2. Normalized match
        norm_map: dict[str, list[str]] = {}
        for v in vendors:
            nv = cls.normalize_name(v)
            norm_map.setdefault(nv, []).append(v)

        if norm_query in norm_map:
            matches = norm_map[norm_query]
            if len(matches) == 1:
                return EntityResolutionResult(
                    status="exact_match",
                    resolved_entity=matches[0],
                    candidates=matches,
                    confidence=0.98
                )
            else:
                return EntityResolutionResult(
                    status="multiple_matches",
                    candidates=matches,
                    confidence=0.5,
                    message=f"Multiple vendors match '{raw_query}': {', '.join(matches)}"
                )

        # 3. Substring containment match
        substring_matches = []
        for v in vendors:
            nv = cls.normalize_name(v)
            if norm_query and (norm_query in nv or nv in norm_query):
                substring_matches.append(v)

        if len(substring_matches) == 1:
            return EntityResolutionResult(
                status="approximate_match",
                resolved_entity=substring_matches[0],
                candidates=substring_matches,
                confidence=0.85
            )
        elif len(substring_matches) > 1:
            return EntityResolutionResult(
                status="multiple_matches",
                candidates=substring_matches[:5],
                confidence=0.6,
                message=f"Multiple vendors found matching '{raw_query}'. Did you mean: {', '.join(substring_matches[:5])}?"
            )

        # 4. Fuzzy similarity matching
        fuzzy_matches = []
        for v in vendors:
            nv = cls.normalize_name(v)
            sim = difflib.SequenceMatcher(None, norm_query, nv).ratio()
            if sim >= 0.75:
                fuzzy_matches.append((v, sim))

        fuzzy_matches.sort(key=lambda x: x[1], reverse=True)

        if len(fuzzy_matches) == 1:
            return EntityResolutionResult(
                status="approximate_match",
                resolved_entity=fuzzy_matches[0][0],
                candidates=[fuzzy_matches[0][0]],
                confidence=round(fuzzy_matches[0][1], 2)
            )
        elif len(fuzzy_matches) > 1:
            # Check if top match is significantly better
            if fuzzy_matches[0][1] - fuzzy_matches[1][1] >= 0.15:
                return EntityResolutionResult(
                    status="approximate_match",
                    resolved_entity=fuzzy_matches[0][0],
                    candidates=[m[0] for m in fuzzy_matches[:5]],
                    confidence=round(fuzzy_matches[0][1], 2)
                )
            return EntityResolutionResult(
                status="multiple_matches",
                candidates=[m[0] for m in fuzzy_matches[:5]],
                confidence=0.5,
                message=f"Multiple vendors closely resemble '{raw_query}': {', '.join([m[0] for m in fuzzy_matches[:5]])}"
            )

        # 5. Not found
        return EntityResolutionResult(
            status="not_found",
            message=f"Vendor '{raw_query}' was not found in the dataset.",
            confidence=0.0
        )
