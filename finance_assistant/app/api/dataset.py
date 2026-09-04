import json
from typing import Any
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.data.dataset_manager import dataset_manager
from app.data.inspector import DatasetInspector
from app.data.loader import DataLoader
from app.data.schema_mapper import SchemaCompatibilityChecker
from app.core.exceptions import DatasetError, IncompatibleSchemaError

router = APIRouter(prefix="/dataset", tags=["Dataset Management"])

class DatasetConfirmationRequest(BaseModel):
    dataset_id: str
    name: str | None = None
    operation: str = "create"  # 'create', 'add', 'replace'
    user_mappings: dict[str, str] | None = None

@router.get("")
def list_datasets():
    return {"datasets": dataset_manager.list_datasets(), "active_id": dataset_manager.active_dataset_id}

@router.get("/{dataset_id}")
def get_dataset(dataset_id: str):
    if dataset_id not in dataset_manager.datasets:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")
    ds = dataset_manager.datasets[dataset_id]
    return ds

@router.get("/{dataset_id}/versions")
def get_dataset_versions(dataset_id: str):
    if dataset_id not in dataset_manager.datasets:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")
    ds = dataset_manager.datasets[dataset_id]
    return {"dataset_id": dataset_id, "versions": ds.versions, "active_version": ds.active_version}

@router.post("/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    dataset_id: str = Form("finance"),
    name: str = Form("Financial Dataset"),
    operation: str = Form("create"),  # create, add, replace
    user_mappings_json: str = Form("{}"),
):
    """Uploads and analyzes dataset, returning schema profile, compatibility and preview."""
    try:
        content = await file.read()
        df = DataLoader.load_from_bytes(content, file.filename)
        profile = DatasetInspector.inspect(df)
        
        user_mappings = json.loads(user_mappings_json) if user_mappings_json else {}
        compat = SchemaCompatibilityChecker.check_compatibility(profile, user_mappings)

        # If user explicitly chooses to ingest immediately and compatible
        report = None
        if compat.compatible:
            if operation == "create":
                report = dataset_manager.create_dataset(
                    raw_df=df,
                    dataset_id=dataset_id,
                    name=name,
                    filename=file.filename,
                    user_mappings=compat.mapped_fields,
                )
            elif operation == "add":
                report = dataset_manager.add_to_dataset(
                    raw_df=df,
                    dataset_id=dataset_id,
                    filename=file.filename,
                    user_mappings=compat.mapped_fields,
                )
            elif operation == "replace":
                report = dataset_manager.replace_dataset(
                    raw_df=df,
                    dataset_id=dataset_id,
                    filename=file.filename,
                    user_mappings=compat.mapped_fields,
                )

        return {
            "filename": file.filename,
            "profile": profile,
            "compatibility": compat,
            "operation_report": report,
            "status": "ingested" if report else "requires_confirmation",
        }
    except IncompatibleSchemaError as ise:
        raise HTTPException(status_code=422, detail=str(ise))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/add")
async def add_dataset_records(
    file: UploadFile = File(...),
    dataset_id: str = Form(...),
    user_mappings_json: str = Form("{}"),
):
    try:
        content = await file.read()
        df = DataLoader.load_from_bytes(content, file.filename)
        user_mappings = json.loads(user_mappings_json) if user_mappings_json else {}
        report = dataset_manager.add_to_dataset(
            raw_df=df,
            dataset_id=dataset_id,
            filename=file.filename,
            user_mappings=user_mappings,
        )
        return report
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/replace")
async def replace_dataset_records(
    file: UploadFile = File(...),
    dataset_id: str = Form(...),
    user_mappings_json: str = Form("{}"),
):
    try:
        content = await file.read()
        df = DataLoader.load_from_bytes(content, file.filename)
        user_mappings = json.loads(user_mappings_json) if user_mappings_json else {}
        report = dataset_manager.replace_dataset(
            raw_df=df,
            dataset_id=dataset_id,
            filename=file.filename,
            user_mappings=user_mappings,
        )
        return report
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: str, confirm: bool = False):
    try:
        dataset_manager.delete_dataset(dataset_id, confirm=confirm)
        return {"status": "success", "message": f"Dataset '{dataset_id}' deleted."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
