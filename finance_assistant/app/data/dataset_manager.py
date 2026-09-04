import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any
import pandas as pd
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.exceptions import DatasetError, DuplicateDataError, IncompatibleSchemaError
from app.core.logging import logger
from app.data.duckdb import duckdb_manager
from app.data.inspector import DatasetInspector, DatasetProfile
from app.data.schema_mapper import SchemaCompatibilityChecker, SchemaMapper

class DatasetVersionMetadata(BaseModel):
    dataset_id: str
    dataset_version: int
    created_at: str
    updated_at: str
    schema_hash: str
    row_count: int
    source_file: str
    status: str  # 'active', 'archived', 'deleted'
    mapped_fields: dict[str, str] = Field(default_factory=dict)
    table_name: str
    compatibility_score: float = 1.0
    storage_path: str = ""

class DatasetMetadata(BaseModel):
    dataset_id: str
    name: str
    active_version: int
    versions: dict[int, DatasetVersionMetadata] = Field(default_factory=dict)
    created_at: str
    updated_at: str

class DatasetOperationReport(BaseModel):
    operation: str
    dataset_id: str
    version: int
    records_received: int
    records_added: int
    duplicates_skipped: int
    validation_failures: int
    active_table_name: str
    status: str
    message: str

class DatasetManager:
    """Orchestrates dataset onboarding, versioning, add, replace, and deletion."""

    def __init__(self, metadata_path: Path | None = None):
        self.metadata_file = metadata_path or (settings.metadata_dir / "datasets_registry.json")
        self.datasets: dict[str, DatasetMetadata] = {}
        self.active_dataset_id: str | None = None
        self._load_registry()

    def _load_registry(self):
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, "r") as f:
                    data = json.load(f)
                    for ds_id, ds_data in data.get("datasets", {}).items():
                        self.datasets[ds_id] = DatasetMetadata(**ds_data)
                    self.active_dataset_id = data.get("active_dataset_id")
                logger.info(f"Loaded registry with {len(self.datasets)} dataset(s). Active: {self.active_dataset_id}")
                self._restore_active_dataset_to_duckdb()
            except Exception as e:
                logger.error(f"Error reading dataset metadata: {str(e)}")

    def _restore_active_dataset_to_duckdb(self):
        if not self.active_dataset_id or self.active_dataset_id not in self.datasets:
            return
        ds = self.datasets[self.active_dataset_id]
        if ds.active_version in ds.versions:
            ver = ds.versions[ds.active_version]
            if ver.storage_path:
                parquet_path = Path(ver.storage_path)
                if parquet_path.is_file():
                    try:
                        df = pd.read_parquet(parquet_path)
                        duckdb_manager.register_dataframe(ver.table_name, df)
                        duckdb_manager.set_active_table(ver.table_name)
                        logger.info(f"Restored table '{ver.table_name}' and 'active_dataset' view in DuckDB.")
                    except Exception as e:
                        logger.error(f"Failed to restore active dataset to DuckDB: {str(e)}")

    def _save_registry(self):
        try:
            self.metadata_file.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "active_dataset_id": self.active_dataset_id,
                "datasets": {k: (v.model_dump() if hasattr(v, "model_dump") else v.dict()) for k, v in self.datasets.items()}
            }
            with open(self.metadata_file, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving dataset metadata: {str(e)}")

    @staticmethod
    def compute_schema_hash(df: pd.DataFrame) -> str:
        sig = "|".join(sorted(df.columns))
        return hashlib.sha256(sig.encode()).hexdigest()[:16]

    def create_dataset(
        self,
        raw_df: pd.DataFrame,
        dataset_id: str,
        name: str,
        filename: str,
        user_mappings: dict[str, str] | None = None,
    ) -> DatasetOperationReport:
        """Creates a brand new dataset (Version 1)."""
        # 1. Profile & Check compatibility
        profile = DatasetInspector.inspect(raw_df)
        compat = SchemaCompatibilityChecker.check_compatibility(profile, user_mappings)

        if not compat.compatible:
            raise IncompatibleSchemaError(compat.explanation)

        # 2. Canonical mapping
        canonical_df = SchemaMapper.apply_mapping(raw_df, compat.mapped_fields)
        
        # Deduplicate initial rows
        initial_len = len(canonical_df)
        canonical_df = canonical_df.drop_duplicates()
        dups_skipped = initial_len - len(canonical_df)

        version = 1
        table_name = f"{dataset_id}_v{version}"
        now_str = datetime.utcnow().isoformat()
        schema_hash = self.compute_schema_hash(canonical_df)

        # 3. Ingest into DuckDB and persist to disk
        duckdb_manager.register_dataframe(table_name, canonical_df)
        duckdb_manager.set_active_table(table_name)
        
        parquet_path = settings.storage_dir / "datasets" / f"{table_name}.parquet"
        parquet_path.parent.mkdir(parents=True, exist_ok=True)
        canonical_df.to_parquet(parquet_path, index=False)

        # 4. Save metadata
        v_meta = DatasetVersionMetadata(
            dataset_id=dataset_id,
            dataset_version=version,
            created_at=now_str,
            updated_at=now_str,
            schema_hash=schema_hash,
            row_count=len(canonical_df),
            source_file=filename,
            status="active",
            mapped_fields=compat.mapped_fields,
            table_name=table_name,
            compatibility_score=compat.confidence,
            storage_path=str(parquet_path),
        )

        ds_meta = DatasetMetadata(
            dataset_id=dataset_id,
            name=name,
            active_version=version,
            versions={version: v_meta},
            created_at=now_str,
            updated_at=now_str,
        )

        self.datasets[dataset_id] = ds_meta
        self.active_dataset_id = dataset_id
        self._save_registry()

        return DatasetOperationReport(
            operation="Create",
            dataset_id=dataset_id,
            version=version,
            records_received=initial_len,
            records_added=len(canonical_df),
            duplicates_skipped=dups_skipped,
            validation_failures=0,
            active_table_name=table_name,
            status="success",
            message=f"Created dataset '{name}' v1 with {len(canonical_df)} records.",
        )

    def add_to_dataset(
        self,
        raw_df: pd.DataFrame,
        dataset_id: str,
        filename: str,
        user_mappings: dict[str, str] | None = None,
    ) -> DatasetOperationReport:
        """Adds records to an existing dataset, validating schema and skipping duplicates."""
        if dataset_id not in self.datasets:
            raise DatasetError(f"Dataset '{dataset_id}' not found.")

        ds_meta = self.datasets[dataset_id]
        curr_version = ds_meta.active_version
        active_meta = ds_meta.versions[curr_version]

        # Use the established mapping of the active dataset unless overridden
        mappings = user_mappings or active_meta.mapped_fields

        # Inspect and map new records
        profile = DatasetInspector.inspect(raw_df)
        compat = SchemaCompatibilityChecker.check_compatibility(profile, mappings)
        if not compat.compatible:
            raise IncompatibleSchemaError(f"Cannot add data: {compat.explanation}")

        new_canonical_df = SchemaMapper.apply_mapping(raw_df, compat.mapped_fields)
        received_count = len(new_canonical_df)

        # Retrieve current data
        current_df = duckdb_manager.execute_query(f"SELECT * FROM {active_meta.table_name}")
        
        # Combine and deduplicate
        combined_df = pd.concat([current_df, new_canonical_df], ignore_index=True)
        initial_combined_len = len(combined_df)
        combined_df = combined_df.drop_duplicates()
        
        records_added = len(combined_df) - len(current_df)
        duplicates_skipped = received_count - records_added

        # Create new version to preserve auditability
        new_version = curr_version + 1
        new_table_name = f"{dataset_id}_v{new_version}"
        now_str = datetime.utcnow().isoformat()
        schema_hash = self.compute_schema_hash(combined_df)

        duckdb_manager.register_dataframe(new_table_name, combined_df)
        duckdb_manager.set_active_table(new_table_name)

        parquet_path = settings.storage_dir / "datasets" / f"{new_table_name}.parquet"
        parquet_path.parent.mkdir(parents=True, exist_ok=True)
        combined_df.to_parquet(parquet_path, index=False)

        # Mark previous version archived
        active_meta.status = "archived"
        
        new_v_meta = DatasetVersionMetadata(
            dataset_id=dataset_id,
            dataset_version=new_version,
            created_at=now_str,
            updated_at=now_str,
            schema_hash=schema_hash,
            row_count=len(combined_df),
            source_file=filename,
            status="active",
            mapped_fields=compat.mapped_fields,
            table_name=new_table_name,
            compatibility_score=compat.confidence,
            storage_path=str(parquet_path),
        )

        ds_meta.active_version = new_version
        ds_meta.versions[new_version] = new_v_meta
        ds_meta.updated_at = now_str
        self._save_registry()

        return DatasetOperationReport(
            operation="Add",
            dataset_id=dataset_id,
            version=new_version,
            records_received=received_count,
            records_added=records_added,
            duplicates_skipped=duplicates_skipped,
            validation_failures=0,
            active_table_name=new_table_name,
            status="success",
            message=f"Added {records_added} records to '{dataset_id}' (v{new_version}). {duplicates_skipped} duplicates skipped.",
        )

    def replace_dataset(
        self,
        raw_df: pd.DataFrame,
        dataset_id: str,
        filename: str,
        user_mappings: dict[str, str] | None = None,
    ) -> DatasetOperationReport:
        """Replaces an existing dataset by creating a validated new version before atomically switching."""
        if dataset_id not in self.datasets:
            raise DatasetError(f"Dataset '{dataset_id}' not found.")

        ds_meta = self.datasets[dataset_id]
        curr_version = ds_meta.active_version

        # 1. Profile and validate new dataset first
        profile = DatasetInspector.inspect(raw_df)
        compat = SchemaCompatibilityChecker.check_compatibility(profile, user_mappings)
        if not compat.compatible:
            raise IncompatibleSchemaError(f"Cannot replace dataset: {compat.explanation}")

        canonical_df = SchemaMapper.apply_mapping(raw_df, compat.mapped_fields)
        initial_count = len(canonical_df)
        canonical_df = canonical_df.drop_duplicates()
        dups_skipped = initial_count - len(canonical_df)

        new_version = curr_version + 1
        new_table_name = f"{dataset_id}_v{new_version}"
        now_str = datetime.utcnow().isoformat()
        schema_hash = self.compute_schema_hash(canonical_df)

        # 2. Register into DuckDB and atomically switch active pointer
        duckdb_manager.register_dataframe(new_table_name, canonical_df)
        duckdb_manager.set_active_table(new_table_name)

        parquet_path = settings.storage_dir / "datasets" / f"{new_table_name}.parquet"
        parquet_path.parent.mkdir(parents=True, exist_ok=True)
        canonical_df.to_parquet(parquet_path, index=False)

        # 3. Archive previous active version
        if curr_version in ds_meta.versions:
            ds_meta.versions[curr_version].status = "archived"

        new_v_meta = DatasetVersionMetadata(
            dataset_id=dataset_id,
            dataset_version=new_version,
            created_at=now_str,
            updated_at=now_str,
            schema_hash=schema_hash,
            row_count=len(canonical_df),
            source_file=filename,
            status="active",
            mapped_fields=compat.mapped_fields,
            table_name=new_table_name,
            compatibility_score=compat.confidence,
            storage_path=str(parquet_path),
        )

        ds_meta.active_version = new_version
        ds_meta.versions[new_version] = new_v_meta
        ds_meta.updated_at = now_str
        self._save_registry()

        return DatasetOperationReport(
            operation="Replace",
            dataset_id=dataset_id,
            version=new_version,
            records_received=initial_count,
            records_added=len(canonical_df),
            duplicates_skipped=dups_skipped,
            validation_failures=0,
            active_table_name=new_table_name,
            status="success",
            message=f"Replaced dataset '{dataset_id}' with version {new_version} ({len(canonical_df)} records).",
        )

    def delete_dataset(self, dataset_id: str, confirm: bool = False) -> bool:
        """Deletes a dataset and drops its tables upon explicit confirmation."""
        if not confirm:
            raise DatasetError("Dataset deletion requires explicit confirmation (confirm=True).")

        if dataset_id not in self.datasets:
            raise DatasetError(f"Dataset '{dataset_id}' not found.")

        ds_meta = self.datasets[dataset_id]
        for v in ds_meta.versions.values():
            duckdb_manager.drop_table(v.table_name)

        del self.datasets[dataset_id]
        if self.active_dataset_id == dataset_id:
            self.active_dataset_id = next(iter(self.datasets.keys())) if self.datasets else None
            if self.active_dataset_id:
                active_meta = self.datasets[self.active_dataset_id]
                active_ver = active_meta.versions[active_meta.active_version]
                duckdb_manager.set_active_table(active_ver.table_name)

        self._save_registry()
        logger.info(f"Deleted dataset '{dataset_id}'")
        return True

    def get_active_dataset(self) -> tuple[DatasetMetadata | None, DatasetVersionMetadata | None]:
        if not self.active_dataset_id or self.active_dataset_id not in self.datasets:
            return None, None
        ds_meta = self.datasets[self.active_dataset_id]
        v_meta = ds_meta.versions.get(ds_meta.active_version)
        return ds_meta, v_meta

    def list_datasets(self) -> list[dict[str, Any]]:
        result = []
        for ds_id, ds in self.datasets.items():
            active_v = ds.versions.get(ds.active_version)
            result.append({
                "dataset_id": ds_id,
                "name": ds.name,
                "active_version": ds.active_version,
                "row_count": active_v.row_count if active_v else 0,
                "is_active": ds_id == self.active_dataset_id,
                "updated_at": ds.updated_at,
            })
        return result

dataset_manager = DatasetManager()
