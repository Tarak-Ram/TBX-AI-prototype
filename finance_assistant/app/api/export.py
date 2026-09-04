from fastapi import APIRouter, HTTPException, Query, Response
from app.export.csv import CSVExporter
from app.export.excel import ExcelExporter

router = APIRouter(prefix="/export", tags=["Export"])

@router.get("/csv")
def export_csv_query(query_id: str = Query(...)):
    return export_evidence_endpoint(query_id=query_id, format="csv")

@router.get("/excel")
def export_excel_query(query_id: str = Query(...)):
    return export_evidence_endpoint(query_id=query_id, format="excel")

@router.get("/{query_id}")
def export_evidence_endpoint(query_id: str, format: str = Query("csv", pattern="^(csv|excel|xlsx)$")):
    try:
        if format == "csv":
            csv_bytes = CSVExporter.export_evidence_to_csv(query_id)
            return Response(
                content=csv_bytes,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=evidence_{query_id}.csv"}
            )
        else:
            excel_bytes = ExcelExporter.export_evidence_to_excel(query_id)
            return Response(
                content=excel_bytes,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename=evidence_{query_id}.xlsx"}
            )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
