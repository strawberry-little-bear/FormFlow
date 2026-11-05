# 验证档案：来源资料到需求 Agent

## 场景

使用本地演示环境、虚构通知/名单/报名模板和空的 `FORMFLOW_LLM_API_KEY`，从组织者入口新建隔离任务，上传三份来源资料，再发送一条需求整理请求。浏览器视口覆盖 1440、390 和 320 像素。

## 结论

- 通知、名单和模板均由服务器保存，返回的资料编号为 `src_*`，页面只展示元数据和解析状态。
- Agent 请求携带真实来源资料编号，服务端按任务范围加载原始文件；资料编号不会由浏览器自行伪造或替换成文件正文。
- 上传阶段只建立文字缓存，不偷偷启动 OCR；页面明确说明模型支持原始文件时优先直读，失败或不支持时才进入解析/OCR 降级。
- 未配置模型密钥时，原始要求保留，页面说明可以先用模板或手动编辑，且不显示“用原请求重试”这种不会成功的操作。
- 三种视口均无整页横向溢出，没有控制台错误或失败请求。

## 证据

浏览器复现脚本：[`scripts/ux_requirements_materials_walkthrough.cjs`](../../scripts/ux_requirements_materials_walkthrough.cjs)

```powershell
$env:FORMFLOW_LLM_API_KEY = ''
$env:FORMFLOW_WALKTHROUGH_BASE = 'http://127.0.0.1:8012'
node scripts/ux_requirements_materials_walkthrough.cjs
```

本轮运行结果包含三份 `src_*` 资料编号、对应的 Agent 请求、无密钥降级状态和 390/320 像素截图。运行产生的临时文件位于 `data/`，不会进入版本库。

## 限制

本记录验证的是资料边界、请求合同和无密钥体验，不代表任何真实模型 provider 的文件输入兼容性、语义准确率、视觉排版判断或数据留存政策。规则生成后仍须由组织者核对并确认发布。
