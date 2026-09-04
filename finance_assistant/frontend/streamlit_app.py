import json
import os
import sys
from pathlib import Path
import pandas as pd
import streamlit as st

# Add finance_assistant to sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app.conversation.context import ConversationContext
from app.conversation.resolver import ConversationResolver
from app.core.exceptions import (
    AmbiguousEntityError,
    EntityNotFoundError,
    IncompatibleSchemaError,
    UnsupportedQuestionError,
)
from app.data.dataset_manager import dataset_manager
from app.data.duckdb import duckdb_manager
from app.data.inspector import DatasetInspector
from app.data.loader import DataLoader
from app.data.schema_mapper import SchemaCompatibilityChecker
from app.export.csv import CSVExporter
from app.export.excel import ExcelExporter
from app.finance.calculator import FinancialCalculator
from app.finance.query_planner import QueryPlanner
from app.finance.schemas import ResponsePayload
from app.finance.validator import ResultValidator
from app.llm.response import ResponseGenerator
from app.llm.sarvam import SarvamProvider
from app.main import seed_sample_dataset_if_empty

st.set_page_config(
    page_title="TBX Finance Assistant",
    page_icon="💳",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS for crisp, executive typography and spacing
st.markdown("""
<style>
    .main-title {
        font-size: 1.8rem;
        font-weight: 700;
        color: #1e293b;
        margin-bottom: 0.2rem;
    }
    .subtitle {
        font-size: 0.95rem;
        color: #64748b;
        margin-bottom: 1.2rem;
    }
    .card-meta {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 12px 16px;
        margin-bottom: 12px;
    }
    .metric-badge {
        display: inline-block;
        background-color: #e0f2fe;
        color: #0369a1;
        font-size: 0.8rem;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 4px;
        margin-right: 6px;
    }
    .evidence-box {
        background-color: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 12px;
        font-size: 0.85rem;
    }
</style>
""", unsafe_allow_html=True)

# Ensure sample data is seeded
seed_sample_dataset_if_empty()

# Session State Initialization
if "messages" not in st.session_state:
    st.session_state.messages = []
if "conversation_id" not in st.session_state:
    st.session_state.conversation_id = "session_default"

# ----------------- SIDEBAR -----------------
with st.sidebar:
    st.markdown("### 💳 Finance Assistant")
    st.caption("TBX — BVP Tech Catalyst Hackathon")
    st.markdown("---")

    # Active Dataset Information
    ds_meta, active_version = dataset_manager.get_active_dataset()
    if ds_meta and active_version:
        st.markdown(f"**Active Dataset:** `{ds_meta.name}`")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("Version", f"v{active_version.dataset_version}")
        with col2:
            st.metric("Rows", f"{active_version.row_count:,}")
        
        st.caption(f"Source file: `{active_version.source_file}`")
        with st.expander("Canonical Field Mappings"):
            for canon, raw in active_version.mapped_fields.items():
                st.text(f"{raw} → {canon}")
    else:
        st.warning("No active dataset loaded.")

    st.markdown("---")
    st.markdown("#### Dataset Onboarding")
    
    upload_operation = st.radio(
        "Choose operation:",
        ["Create New", "Add to Existing", "Replace Existing"],
        index=0,
        help="Explicitly choose how to apply the uploaded data."
    )

    uploaded_file = st.file_uploader(
        "Upload Financial CSV or Excel",
        type=["csv", "tsv", "xlsx", "xls"],
        key="file_uploader"
    )

    if uploaded_file is not None:
        file_bytes = uploaded_file.getvalue()
        try:
            raw_df = DataLoader.load_from_bytes(file_bytes, uploaded_file.name)
            profile = DatasetInspector.inspect(raw_df)
            compat = SchemaCompatibilityChecker.check_compatibility(profile)

            st.markdown("##### Dataset Analysis")
            st.write(f"**Rows:** {profile.total_rows:,} | **Cols:** {profile.total_columns}")
            st.write(f"**Schema compatibility:** {int(compat.confidence * 100)}%")
            
            if compat.warnings:
                st.caption(f"⚠️ Warnings: {len(compat.warnings)}")
                for w in compat.warnings[:3]:
                    st.caption(f"• {w}")

            # Column mapping confirmation UI
            st.markdown("###### Detected column mappings:")
            custom_mappings = {}
            for canon_field in ["amount", "vendor", "transaction_date", "status", "category"]:
                current_guess = compat.mapped_fields.get(canon_field)
                col_options = ["None"] + list(profile.columns.keys())
                default_idx = col_options.index(current_guess) if current_guess in col_options else 0
                chosen = st.selectbox(
                    f"Map canonical '{canon_field}':",
                    options=col_options,
                    index=default_idx,
                    key=f"map_{canon_field}"
                )
                if chosen != "None":
                    custom_mappings[canon_field] = chosen

            if st.button("Confirm & Ingest Data", type="primary"):
                ds_id = "finance_dataset" if upload_operation != "Create New" else f"ds_{Path(uploaded_file.name).stem[:10]}"
                ds_name = f"Dataset ({uploaded_file.name})"
                
                with st.spinner("Ingesting into DuckDB..."):
                    if upload_operation == "Create New":
                        report = dataset_manager.create_dataset(
                            raw_df=raw_df,
                            dataset_id=ds_id,
                            name=ds_name,
                            filename=uploaded_file.name,
                            user_mappings=custom_mappings,
                        )
                    elif upload_operation == "Add to Existing":
                        report = dataset_manager.add_to_dataset(
                            raw_df=raw_df,
                            dataset_id=dataset_manager.active_dataset_id or "finance_dataset",
                            filename=uploaded_file.name,
                            user_mappings=custom_mappings,
                        )
                    else:  # Replace
                        report = dataset_manager.replace_dataset(
                            raw_df=raw_df,
                            dataset_id=dataset_manager.active_dataset_id or "finance_dataset",
                            filename=uploaded_file.name,
                            user_mappings=custom_mappings,
                        )
                st.success(report.message)
                st.rerun()

        except Exception as e:
            st.error(f"Error inspecting dataset: {str(e)}")

    st.markdown("---")
    with st.expander("Dataset Management"):
        datasets = dataset_manager.list_datasets()
        st.write(f"Total Datasets: {len(datasets)}")
        for d in datasets:
            badge = " (Active)" if d["is_active"] else ""
            st.text(f"• {d['name']} v{d['active_version']}{badge}")
        
        if ds_meta:
            delete_confirm = st.checkbox("Confirm deletion of active dataset", key="del_chk")
            if st.button("Delete Active Dataset", disabled=not delete_confirm):
                dataset_manager.delete_dataset(ds_meta.dataset_id, confirm=True)
                st.warning(f"Deleted dataset '{ds_meta.dataset_id}'.")
                st.rerun()


# ----------------- MAIN AREA -----------------
st.markdown('<div class="main-title">Natural-Language Financial Query Compiler</div>', unsafe_allow_html=True)
st.markdown('<div class="subtitle">Deterministic financial computation via DuckDB & Python • Sarvam LLM natural language interface</div>', unsafe_allow_html=True)

# Sample question chips
st.markdown("**Quick questions to ask:**")
chip_cols = st.columns(4)
chip_questions = [
    "How much did we pay vendors last month?",
    "Which vendor received the most?",
    "How much did Acme receive in August 2026?",
    "Show unreconciled transactions",
]
for i, q_text in enumerate(chip_questions):
    if chip_cols[i].button(q_text, key=f"chip_{i}"):
        st.session_state.pending_input = q_text

# Display Chat History
for idx, msg in enumerate(st.session_state.messages):
    with st.chat_message(msg["role"]):
        st.write(msg["content"])
        payload: ResponsePayload = msg.get("payload")
        if payload and msg["role"] == "assistant":
            # Metadata block
            if payload.calculation != "None":
                st.markdown(
                    f"<span class='metric-badge'>Calculation: {payload.calculation}</span>"
                    f"<span class='metric-badge'>Period: {payload.period or 'All time'}</span>"
                    f"<span class='metric-badge'>Records: {payload.records:,}</span>"
                    f"<span class='metric-badge'>Confidence: {payload.confidence}</span>",
                    unsafe_allow_html=True,
                )

            # Breakdown table if present
            if payload.breakdown:
                with st.expander("📊 Breakdown Details", expanded=False):
                    st.dataframe(pd.DataFrame(payload.breakdown), use_container_width=True)

            # Audit Evidence & Export block
            if payload.evidence and payload.evidence.supporting_records:
                with st.expander(f"🔍 Audit Evidence ({payload.query_id})", expanded=False):
                    evidence_df = pd.DataFrame(payload.evidence.supporting_records)
                    st.dataframe(evidence_df, use_container_width=True)
                    
                    exp_col1, exp_col2 = st.columns(2)
                    with exp_col1:
                        csv_data = CSVExporter.export_evidence_to_csv(payload.query_id)
                        st.download_button(
                            label="📥 Export CSV",
                            data=csv_data,
                            file_name=f"evidence_{payload.query_id}.csv",
                            mime="text/csv",
                            key=f"csv_{idx}_{payload.query_id}",
                        )
                    with exp_col2:
                        excel_data = ExcelExporter.export_evidence_to_excel(payload.query_id)
                        st.download_button(
                            label="📥 Export Excel",
                            data=excel_data,
                            file_name=f"evidence_{payload.query_id}.xlsx",
                            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            key=f"excel_{idx}_{payload.query_id}",
                        )

# Chat Input
user_input = st.chat_input("Ask a financial question (e.g. 'How much did Acme receive last month?', 'What about July?')")

# Check if chip was clicked
if "pending_input" in st.session_state and st.session_state.pending_input:
    user_input = st.session_state.pending_input
    st.session_state.pending_input = None

if user_input:
    # Append user question
    st.session_state.messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.write(user_input)

    with st.chat_message("assistant"):
        with st.spinner("Compiling query & computing deterministically..."):
            # Check active dataset
            ds_meta, active_version = dataset_manager.get_active_dataset()
            if not active_version:
                res_payload = ResponsePayload(
                    answer="No active dataset available. Please upload a dataset in the sidebar first.",
                    calculation="None",
                    records=0,
                    confidence="LOW",
                    query_id="NONE",
                    is_unsupported=True,
                )
            else:
                state = ConversationResolver.get_or_create(st.session_state.conversation_id)
                context_dict = ConversationContext.get_context_dict(state)

                provider = SarvamProvider()
                intent = provider.extract_intent(
                    question=user_input,
                    context=context_dict,
                    available_schema=active_version.mapped_fields,
                )

                try:
                    query_plan, resolved_filters = QueryPlanner.plan(intent)
                    execution_result = FinancialCalculator.execute(query_plan)
                    ResultValidator.validate_execution(execution_result, active_version.dataset_version)
                    
                    response_gen = ResponseGenerator(provider=provider)
                    res_payload = response_gen.generate_response(user_input, execution_result, intent)
                    ConversationResolver.update_state(state, user_input, intent, res_payload)
                    
                except EntityNotFoundError as enfe:
                    res_payload = ResponsePayload(
                        answer=str(enfe),
                        calculation="Entity validation: Not Found",
                        records=0,
                        confidence="HIGH",
                        query_id="NOT_FOUND",
                        is_not_found=True,
                    )
                except AmbiguousEntityError as aee:
                    candidates = aee.details.get("candidates", [])
                    res_payload = ResponsePayload(
                        answer=str(aee),
                        calculation="Entity validation: Ambiguous",
                        records=0,
                        confidence="MEDIUM",
                        query_id="AMBIGUOUS",
                        needs_clarification=True,
                        clarification_options=candidates,
                    )
                except UnsupportedQuestionError as uqe:
                    res_payload = ResponsePayload(
                        answer=f"I cannot answer that question because {str(uqe)}",
                        calculation="Ontology Validation: Unsupported",
                        records=0,
                        confidence="HIGH",
                        query_id="UNSUPPORTED",
                        is_unsupported=True,
                    )
                except IncompatibleSchemaError as ise:
                    res_payload = ResponsePayload(
                        answer=f"The uploaded dataset does not contain enough information: {str(ise)}",
                        calculation="Schema Validation: Incompatible",
                        records=0,
                        confidence="LOW",
                        query_id="INCOMPATIBLE",
                        is_unsupported=True,
                    )
                except Exception as e:
                    res_payload = ResponsePayload(
                        answer=f"A processing error occurred: {str(e)}",
                        calculation="Error",
                        records=0,
                        confidence="LOW",
                        query_id="ERROR",
                        is_unsupported=True,
                    )

            # Render assistant message
            st.write(res_payload.answer)
            if res_payload.calculation != "None":
                st.markdown(
                    f"<span class='metric-badge'>Calculation: {res_payload.calculation}</span>"
                    f"<span class='metric-badge'>Period: {res_payload.period or 'All time'}</span>"
                    f"<span class='metric-badge'>Records: {res_payload.records:,}</span>"
                    f"<span class='metric-badge'>Confidence: {res_payload.confidence}</span>",
                    unsafe_allow_html=True,
                )

            if res_payload.breakdown:
                with st.expander("📊 Breakdown Details", expanded=True):
                    st.dataframe(pd.DataFrame(res_payload.breakdown), use_container_width=True)

            if res_payload.evidence and res_payload.evidence.supporting_records:
                with st.expander(f"🔍 Audit Evidence ({res_payload.query_id})", expanded=True):
                    st.dataframe(pd.DataFrame(res_payload.evidence.supporting_records), use_container_width=True)
                    exp_col1, exp_col2 = st.columns(2)
                    with exp_col1:
                        csv_data = CSVExporter.export_evidence_to_csv(res_payload.query_id)
                        st.download_button(
                            label="📥 Export CSV",
                            data=csv_data,
                            file_name=f"evidence_{res_payload.query_id}.csv",
                            mime="text/csv",
                            key=f"csv_active_{res_payload.query_id}",
                        )
                    with exp_col2:
                        excel_data = ExcelExporter.export_evidence_to_excel(res_payload.query_id)
                        st.download_button(
                            label="📥 Export Excel",
                            data=excel_data,
                            file_name=f"evidence_{res_payload.query_id}.xlsx",
                            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            key=f"excel_active_{res_payload.query_id}",
                        )

            # Save assistant message to session state
            st.session_state.messages.append({
                "role": "assistant",
                "content": res_payload.answer,
                "payload": res_payload,
            })
