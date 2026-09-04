from contextlib import asynccontextmanager
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, dataset, evidence, export, health, query
from app.core.config import settings
from app.core.logging import logger
from app.data.dataset_manager import dataset_manager

def seed_sample_dataset_if_empty():
    """Seeds a realistic corporate financial dataset for instant demo and evaluation."""
    if not dataset_manager.active_dataset_id:
        logger.info("No active dataset found. Seeding initial BVP Tech Catalyst demo dataset...")
        sample_data = [
            # August 2026 transactions
            {"Vendor Name": "Acme Corp", "Amount Paid": 12431882.0, "Transaction Date": "2026-08-15", "Category": "Hardware & Infrastructure", "Status": "Reconciled"},
            {"Vendor Name": "XYZ Logistics", "Amount Paid": 4500000.0, "Transaction Date": "2026-08-10", "Category": "Supply Chain", "Status": "Reconciled"},
            {"Vendor Name": "CloudScale Systems", "Amount Paid": 2850000.0, "Transaction Date": "2026-08-20", "Category": "Cloud Services", "Status": "Reconciled"},
            {"Vendor Name": "Alpha Security", "Amount Paid": 1200000.0, "Transaction Date": "2026-08-05", "Category": "Cybersecurity", "Status": "Unreconciled"},
            {"Vendor Name": "TechFlow Solutions", "Amount Paid": 950000.0, "Transaction Date": "2026-08-28", "Category": "Software", "Status": "Reconciled"},
            {"Vendor Name": "Acme Corp", "Amount Paid": 500000.0, "Transaction Date": "2026-08-22", "Category": "Hardware", "Status": "Reconciled"},
            {"Vendor Name": "Apex Travel", "Amount Paid": 340000.0, "Transaction Date": "2026-08-18", "Category": "Travel", "Status": "Reconciled"},
            {"Vendor Name": "OfficeSphere", "Amount Paid": 120000.0, "Transaction Date": "2026-08-12", "Category": "Office Supplies", "Status": "Unreconciled"},
            
            # July 2026 transactions
            {"Vendor Name": "Acme Corp", "Amount Paid": 9800000.0, "Transaction Date": "2026-07-14", "Category": "Hardware & Infrastructure", "Status": "Reconciled"},
            {"Vendor Name": "XYZ Logistics", "Amount Paid": 5200000.0, "Transaction Date": "2026-07-22", "Category": "Supply Chain", "Status": "Reconciled"},
            {"Vendor Name": "CloudScale Systems", "Amount Paid": 2700000.0, "Transaction Date": "2026-07-19", "Category": "Cloud Services", "Status": "Reconciled"},
            {"Vendor Name": "Apex Travel", "Amount Paid": 420000.0, "Transaction Date": "2026-07-08", "Category": "Travel", "Status": "Reconciled"},
            {"Vendor Name": "Alpha Security", "Amount Paid": 1200000.0, "Transaction Date": "2026-07-03", "Category": "Cybersecurity", "Status": "Reconciled"},

            # June 2026 transactions
            {"Vendor Name": "Acme Corp", "Amount Paid": 8500000.0, "Transaction Date": "2026-06-11", "Category": "Hardware & Infrastructure", "Status": "Reconciled"},
            {"Vendor Name": "XYZ Logistics", "Amount Paid": 4100000.0, "Transaction Date": "2026-06-25", "Category": "Supply Chain", "Status": "Reconciled"},
            {"Vendor Name": "CloudScale Systems", "Amount Paid": 2600000.0, "Transaction Date": "2026-06-15", "Category": "Cloud Services", "Status": "Reconciled"},
            {"Vendor Name": "Apex Travel", "Amount Paid": 290000.0, "Transaction Date": "2026-06-10", "Category": "Travel", "Status": "Reconciled"},
            
            # Additional transactions
            {"Vendor Name": "Delta Marketing", "Amount Paid": 1800000.0, "Transaction Date": "2026-08-01", "Category": "Marketing", "Status": "Unreconciled"},
            {"Vendor Name": "Global Legal Advisors", "Amount Paid": 750000.0, "Transaction Date": "2026-08-04", "Category": "Legal", "Status": "Reconciled"},
        ]
        df = pd.DataFrame(sample_data)
        dataset_manager.create_dataset(
            raw_df=df,
            dataset_id="bvp_finance_demo",
            name="BVP Tech Catalyst Demo Dataset",
            filename="bvp_catalyst_transactions_2026.csv",
            user_mappings={
                "vendor": "Vendor Name",
                "amount": "Amount Paid",
                "transaction_date": "Transaction Date",
                "category": "Category",
                "status": "Status",
            }
        )
        logger.info("Seeded BVP Tech Catalyst demo dataset successfully!")

@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_sample_dataset_if_empty()
    yield

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Deterministic Financial Query Compiler with DuckDB and Sarvam LLM",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(dataset.router)
app.include_router(chat.router)
app.include_router(query.router)
app.include_router(evidence.router)
app.include_router(export.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.debug)
