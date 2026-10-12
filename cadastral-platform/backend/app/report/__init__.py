"""Site Assessment and Planning Constraints Report (A4 PDF + JSON). Pure function: build_site_report(inputs)."""
from app.report.inputs import SiteReportInputs  # noqa: F401
from app.report.build import build_site_report  # noqa: F401

__all__ = ["SiteReportInputs", "build_site_report"]
