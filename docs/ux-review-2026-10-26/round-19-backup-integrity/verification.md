# 2026-10-26 备份与恢复完整性收口

## 本轮目标

把路线文档中的“数据库及私有附件一致备份、恢复验证”从已有基础实现推进到可展示的恢复演练证据：备份要能说明来源，校验要拒绝不完整清单，恢复失败不能留下半成品目录。

## 实现范围

- `scripts/backup_demo.py` 生成的 `manifest.json` 记录 UTC 创建时间与固定来源布局（`formflow.db` + `storage/`）。
- 校验阶段严格检查清单对象、格式、创建时间、来源、路径集合、非负文件大小和 64 位十六进制 SHA-256。
- 恢复仍先写入同一父目录下的临时目录，全部文件与 SQLite 校验通过后才改名到目标；任一步失败都会删除临时目录。
- README 与产品路线明确说明验证边界：只覆盖隔离虚构演示数据，不等价于正式部署的异地备份、自动保留、对象存储快照或迁移回滚。

## 回归证据

```text
python -m pytest -q tests/test_backup_demo.py
9 passed

python -m py_compile scripts/backup_demo.py tests/test_backup_demo.py
通过

git diff --check -- scripts/backup_demo.py tests/test_backup_demo.py README.md docs/product-roadmap.md
通过
```

覆盖的行为包括：正常备份/校验/恢复往返、运行服务时拒绝备份、不覆盖已有备份和目标、ZIP 内容篡改、路径穿越、不完整清单、恢复失败清理临时目录，以及 SQLite WAL 完整性检查。

## 尚未覆盖

本轮没有把演示脚本包装成生产备份服务，也没有声称完成异地复制、自动保留、加密密钥管理、对象存储一致性、部署迁移回滚或灾难恢复时间目标验证。
