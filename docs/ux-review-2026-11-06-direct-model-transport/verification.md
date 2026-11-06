# 产品档案：模型直传与密钥边界

## 场景

部署者为 FormFlow 配置一个 OpenAI-compatible provider，并提交一张图片和一份 PDF。需求 Agent 与审核 Agent 都优先尝试把原始文件交给模型；provider 不支持文件输入时，`auto` 才允许回退到服务器文字解析或 OCR。

## 可观察结果

- 图片以 `image_url` 数据块发送，PDF 以 `file` 数据块发送，文件名和 MIME 类型保留在模型输入中。
- 需求 Agent 请求携带真实的来源资料 ID；审核 Agent 的证据保留文件 ID 和页码，并明确这是模型定位线索，仍需组织者打开原文核对。
- API Key 只出现在 `Authorization` 请求头，不进入 JSON 请求体、错误摘要或审计信息。
- `direct` 模式在 provider 拒绝文件输入时报告“检查未完成”；`auto` 模式才可进入降级路径。

## 复现入口

```bash
python -m pytest -q tests/test_llm.py tests/test_requirements_agent.py tests/test_review_agent.py
```

这些测试使用本地 HTTP 捕获器验证真实 `LLMClient` 的请求形状，不连接外部 provider，也不使用真实密钥或真实材料。

## 边界

本档案验证的是传输契约、来源 ID 和密钥隔离，不代表任意 provider 都支持相同的文件格式，也不证明模型引用的原文已经被程序自动验证。第一次接入真实 provider 时，应使用获准脱敏材料单独确认文件输入、页码证据、留存政策和费用。
