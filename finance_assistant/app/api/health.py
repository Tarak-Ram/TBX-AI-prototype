from fastapi import APIRouter
from app.core.config import settings
from app.data.dataset_manager import dataset_manager
from app.data.duckdb import duckdb_manager

router = APIRouter(tags=["Health"])

@router.get("/health")
def health_check():
    ds_meta, active_version = dataset_manager.get_active_dataset()
    return {
        "status": "ok",
        "app_name": settings.app_name,
        "version": settings.app_version,
        "active_dataset": ds_meta.dataset_id if ds_meta else None,
        "active_version": active_version.dataset_version if active_version else None,
        "active_records": active_version.row_count if active_version else 0,
        "duckdb_connected": True,
    }
