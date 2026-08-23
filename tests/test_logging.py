import json
import logging

from ly_tb_automation.logging import JsonFormatter


def test_json_formatter_includes_operational_context() -> None:
    record = logging.LogRecord("test", logging.INFO, __file__, 1, "任务完成", (), None)
    record.operation = "startup"
    record.status = "success"

    payload = json.loads(JsonFormatter().format(record))

    assert payload["message"] == "任务完成"
    assert payload["operation"] == "startup"
    assert payload["status"] == "success"
