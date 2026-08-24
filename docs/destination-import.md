# 目的地 Excel 导入

## 操作流程

1. 打开管理后台的“目的地”页面。
2. 下载系统提供的 Excel 模板。
3. 按模板填写数据，不要修改表头。
4. 选择 `.xlsx` 文件并点击“校验并导入”。
5. 查看新增、更新、跳过和错误统计；根据行号修正错误后可再次导入。

相同 `city_code` 再次导入时更新已有城市，不创建重复记录。一个文件内重复出现的 `city_code` 会保留第一行并跳过后续行。

## 字段说明

| 字段 | 必填 | 规则 | 示例 |
| --- | --- | --- | --- |
| `country_code` | 是 | 两位英文字母，系统转为大写 | `JP` |
| `country_name_zh` | 是 | 国家中文名 | `日本` |
| `country_name_en` | 是 | 国家英文名 | `Japan` |
| `city_code` | 是 | 以国家代码开头，只含字母、数字、连字符 | `JP-TOKYO` |
| `city_name_zh` | 是 | 城市中文名 | `东京` |
| `city_name_en` | 是 | 城市英文名 | `Tokyo` |
| `city_slug` | 是 | 小写英文、数字和连字符 | `tokyo` |
| `is_core_city` | 是 | `1/0`、`是/否` 或 `true/false` | `1` |
| `priority` | 是 | 0～9999，数字越小越优先 | `10` |
| `is_enabled` | 是 | `1/0`、`是/否` 或 `true/false` | `1` |

## 导入限制

- 只接受 `.xlsx` 文件。
- 单个文件最大 5 MB、最多 10,000 个非空数据行。
- 空行自动忽略。
- 缺少必填表头时整份文件拒绝导入。
- 非法数据按行跳过，其他合法行继续处理。
- 每次导入及其错误都会写入数据库，便于追踪。

## 稳定错误码

| 错误码 | 含义 |
| --- | --- |
| `REQUIRED_FIELD_MISSING` | 必填字段为空 |
| `INVALID_COUNTRY_CODE` | 国家代码格式错误 |
| `INVALID_CITY_CODE` | 城市代码格式错误 |
| `CITY_COUNTRY_MISMATCH` | 城市代码与国家代码不匹配 |
| `INVALID_CITY_SLUG` | 目录标识格式错误 |
| `INVALID_BOOLEAN` | 布尔字段无法识别 |
| `INVALID_PRIORITY` | 优先级不是允许范围内的整数 |
| `DUPLICATE_CITY_IN_FILE` | 文件中城市代码重复 |
| `COUNTRY_DATA_CONFLICT` | 同一文件中的国家名称不一致 |
| `DESTINATION_CONFLICT` | 与数据库已有国家/城市唯一约束冲突 |
