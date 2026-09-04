from enum import Enum
from pydantic import BaseModel, Field

class CanonicalField(str, Enum):
    VENDOR = "vendor"
    VENDOR_ID = "vendor_id"
    TRANSACTION_ID = "transaction_id"
    TRANSACTION_DATE = "transaction_date"
    AMOUNT = "amount"
    CATEGORY = "category"
    STATUS = "status"
    DESCRIPTION = "description"
    ACCOUNT = "account"

class CanonicalFieldDefinition(BaseModel):
    field: CanonicalField
    description: str
    required_for_domains: list[str] = Field(default_factory=list)
    common_aliases: list[str] = Field(default_factory=list)
    expected_type: str

CANONICAL_SCHEMA: dict[CanonicalField, CanonicalFieldDefinition] = {
    CanonicalField.VENDOR: CanonicalFieldDefinition(
        field=CanonicalField.VENDOR,
        description="Name of the vendor, merchant, supplier, or counterparty receiving payment.",
        required_for_domains=["vendor_payouts"],
        common_aliases=["vendor", "supplier", "payee", "merchant", "party", "beneficiary", "recipient", "biller", "vendor_name", "supplier_name"],
        expected_type="string",
    ),
    CanonicalField.AMOUNT: CanonicalFieldDefinition(
        field=CanonicalField.AMOUNT,
        description="Monetary transaction or payout amount.",
        required_for_domains=["transactions", "vendor_payouts", "reconciliation"],
        common_aliases=["amount", "paid", "payment", "total", "value", "cost", "payout", "spend", "amount_paid", "transaction_amount", "net_amount"],
        expected_type="float",
    ),
    CanonicalField.TRANSACTION_DATE: CanonicalFieldDefinition(
        field=CanonicalField.TRANSACTION_DATE,
        description="Date or timestamp on which the transaction occurred.",
        required_for_domains=["transactions", "vendor_payouts"],
        common_aliases=["date", "transaction_date", "txndate", "txn_date", "payment_date", "time", "timestamp", "posted_date"],
        expected_type="date",
    ),
    CanonicalField.STATUS: CanonicalFieldDefinition(
        field=CanonicalField.STATUS,
        description="Payment or reconciliation status (e.g. Paid, Pending, Reconciled, Unreconciled, Cleared, Failed).",
        required_for_domains=["reconciliation"],
        common_aliases=["status", "payment_status", "reconciled", "recon_status", "state", "reconciliation_status"],
        expected_type="string",
    ),
    CanonicalField.CATEGORY: CanonicalFieldDefinition(
        field=CanonicalField.CATEGORY,
        description="Expense or business category (e.g. Travel, Software, Cloud, Office Supplies).",
        required_for_domains=[],
        common_aliases=["category", "expense_category", "department", "type", "expense_type", "tag", "cost_center"],
        expected_type="string",
    ),
    CanonicalField.TRANSACTION_ID: CanonicalFieldDefinition(
        field=CanonicalField.TRANSACTION_ID,
        description="Unique identifier for the transaction or invoice.",
        required_for_domains=[],
        common_aliases=["transaction_id", "txn_id", "id", "reference", "ref_no", "invoice_id", "payment_id"],
        expected_type="string",
    ),
    CanonicalField.VENDOR_ID: CanonicalFieldDefinition(
        field=CanonicalField.VENDOR_ID,
        description="Unique identifier for the vendor entity.",
        required_for_domains=[],
        common_aliases=["vendor_id", "supplier_id", "payee_id", "merchant_id"],
        expected_type="string",
    ),
    CanonicalField.DESCRIPTION: CanonicalFieldDefinition(
        field=CanonicalField.DESCRIPTION,
        description="Narrative or line-item description of the transaction.",
        required_for_domains=[],
        common_aliases=["description", "memo", "narration", "details", "notes", "remarks"],
        expected_type="string",
    ),
    CanonicalField.ACCOUNT: CanonicalFieldDefinition(
        field=CanonicalField.ACCOUNT,
        description="Source bank account, card, or ledger code.",
        required_for_domains=[],
        common_aliases=["account", "account_number", "bank_account", "ledger", "source_account"],
        expected_type="string",
    ),
}
