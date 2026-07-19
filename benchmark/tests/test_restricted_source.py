from pathlib import Path

import pytest

from healthbench_benchmark.io import load_records


def test_raw_mcphases_archive_is_refused(tmp_path: Path) -> None:
    raw = tmp_path / "mcphases.zip"
    raw.write_bytes(b"not read")
    with pytest.raises(ValueError, match="Raw mcPHASES archives are unsupported"):
        load_records(raw, source="mcphases-local")
