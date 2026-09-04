import io
from pathlib import Path
import pandas as pd
from app.core.exceptions import DatasetError
from app.core.logging import logger

class DataLoader:
    """Safely loads datasets from various formats (CSV, TSV, XLSX)."""

    @staticmethod
    def load_from_bytes(content: bytes, filename: str) -> pd.DataFrame:
        ext = Path(filename).suffix.lower()
        try:
            if ext in [".csv", ".txt"]:
                # Try UTF-8 first, fallback to latin-1
                try:
                    df = pd.read_csv(io.BytesIO(content), encoding="utf-8")
                except UnicodeDecodeError:
                    df = pd.read_csv(io.BytesIO(content), encoding="latin-1")
            elif ext == ".tsv":
                df = pd.read_csv(io.BytesIO(content), sep="\t")
            elif ext in [".xlsx", ".xls"]:
                df = pd.read_excel(io.BytesIO(content))
            else:
                raise DatasetError(f"Unsupported file format '{ext}'. Please upload CSV, TSV, or Excel.")
            
            # Basic sanitization of column names (strip whitespace)
            df.columns = [str(c).strip() for c in df.columns]
            return df
        except Exception as e:
            logger.error(f"Failed to load file {filename}: {str(e)}")
            if isinstance(e, DatasetError):
                raise
            raise DatasetError(f"Failed to parse file '{filename}': {str(e)}")

    @staticmethod
    def load_from_path(file_path: str | Path) -> pd.DataFrame:
        path = Path(file_path)
        if not path.exists():
            raise DatasetError(f"File not found: {file_path}")
        with open(path, "rb") as f:
            return DataLoader.load_from_bytes(f.read(), path.name)
