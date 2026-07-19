"""Command-line entry point."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .evaluation import run_benchmark, write_report
from .io import load_records
from .synthetic import generate_synthetic_records


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Run the HealthBench symptom benchmark")
    result.add_argument("--output", type=Path, default=Path("artifacts/report.json"))
    result.add_argument("--input", type=Path, help="Normalized JSON records; never raw source data")
    result.add_argument(
        "--source",
        choices=("synthetic", "mcphases-local"),
        default="synthetic",
        help="Restricted data may only be read from a local path outside the repository",
    )
    result.add_argument("--participants", type=int, default=42)
    result.add_argument("--days", type=int, default=84)
    result.add_argument("--seed", type=int, default=20260719)
    result.add_argument("--folds", type=int, default=5)
    return result


def main() -> None:
    args = parser().parse_args()
    if args.input:
        records = load_records(args.input, source=args.source)
    elif args.source == "mcphases-local":
        raise SystemExit("--source mcphases-local requires --input outside the repository")
    else:
        records = generate_synthetic_records(args.participants, args.days, args.seed)
    report = run_benchmark(records, grouped_folds=args.folds)
    write_report(report, args.output)
    print(json.dumps({"output": str(args.output), "claim_policy": report["claim_policy"]}))


if __name__ == "__main__":
    main()
