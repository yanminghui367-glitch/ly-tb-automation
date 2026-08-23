import io

import pytest

pytest.importorskip("openpyxl")

from openpyxl import Workbook

from ly_tb_automation.destinations import (
    IMPORT_HEADERS,
    build_destination_template,
    read_destination_workbook,
)


def test_generated_template_can_be_read() -> None:
    rows = read_destination_workbook(io.BytesIO(build_destination_template()))

    assert len(rows) == 1
    assert rows[0]["city_code"] == "JP-TOKYO"


def test_workbook_missing_required_header_is_rejected() -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(IMPORT_HEADERS[:-1])
    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)

    with pytest.raises(ValueError, match="is_enabled"):
        read_destination_workbook(output)
