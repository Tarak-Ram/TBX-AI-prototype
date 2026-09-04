from fastapi import APIRouter, HTTPException
from app.finance.evidence import EvidenceManager
from app.finance.schemas import Evidence

router = APIRouter(prefix="/evidence", tags=["Evidence"])

@router.get("/{query_id}", response_model=Evidence)
def get_query_evidence(query_id: str):
    ev = EvidenceManager.get_evidence(query_id)
    if not ev:
        raise HTTPException(status_code=404, detail=f"Evidence for query ID '{query_id}' not found.")
    return ev
