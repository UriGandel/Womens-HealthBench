"""Reproducible symptom-forecasting benchmark."""

from .evaluation import run_benchmark
from .features import build_features
from .synthetic import generate_synthetic_records

__all__ = ["build_features", "generate_synthetic_records", "run_benchmark"]
__version__ = "0.1.0"
