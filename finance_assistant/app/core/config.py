import os
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field

class Settings(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    app_name: str = "TBX Finance Assistant"
    app_version: str = "1.0.0"
    debug: bool = False
    
    # Base paths
    base_dir: Path = Path(__file__).resolve().parent.parent.parent
    data_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parent.parent.parent / "data")
    storage_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parent.parent.parent / "data")
    raw_data_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parent.parent.parent / "data" / "raw")
    processed_data_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parent.parent.parent / "data" / "processed")
    metadata_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parent.parent.parent / "data" / "metadata")
    
    # DuckDB & Storage
    duckdb_path: str = str(Path(__file__).resolve().parent.parent.parent / "data" / "finance.duckdb")
    
    # LLM Settings
    llm_provider: str = os.getenv("LLM_PROVIDER", "sarvam")
    sarvam_api_key: str = os.getenv("SARVAM_API_KEY", "")
    sarvam_model: str = os.getenv("SARVAM_MODEL", "sarvam-2b")
    sarvam_base_url: str = os.getenv("SARVAM_BASE_URL", "https://api.sarvam.ai")
    
    qwen_api_key: str = os.getenv("QWEN_API_KEY", "")
    qwen_model: str = os.getenv("QWEN_MODEL", "qwen-turbo")
    
    # Server configuration
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8001"))

settings = Settings()

# Ensure directories exist
settings.raw_data_dir.mkdir(parents=True, exist_ok=True)
settings.processed_data_dir.mkdir(parents=True, exist_ok=True)
settings.metadata_dir.mkdir(parents=True, exist_ok=True)
