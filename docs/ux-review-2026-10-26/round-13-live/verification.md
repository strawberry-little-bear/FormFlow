# 2026-10-26 评审短期问题闭环验证

## 本轮目标

对 `feedback.md` 中上一轮修复的 8 类短期体验问题做真实浏览器复核，并补上提交者端 390px / 320px 的操作区实拍。演示服务使用全新种子数据，API 运行在 `127.0.0.1:11858`；移动端提交前操作区使用同一启动器在隔离端口 `127.0.0.1:11859` 的全新种子。两套服务都未配置 `FORMFLOW_LLM_API_KEY`。

## 真实浏览器结果

- 赵六提交者路径已走通：凭证登录 → 填写字段 → 上传材料 → 保存服务器草稿 → 刷新恢复 → 已上传槽位从引导中跳过 → 正式提交 → 读取回执。
- 提交接口返回 HTTP 200，回执显示“已正式提交 · v1”，正式提交后显示“补正与回执”，不再显示提交前引导。
- 赵六复核页 `#/review/1/4` 显示 `2 检查未完成`，明确写出“未配置 `FORMFLOW_LLM_API_KEY`”，并提供“回任务列表查看模型配置提示”；未出现“用原请求重试”按钮。
- 复核页 `#/review/1/1`、`#/review/1/2`、`#/review/1/3` 均正常渲染；`#/review/1` 显示“先选一位提交者”中文空态，不发出缺失编号请求。
- 390px 和 320px 提交前页面均无整页横向溢出：`scrollWidth === clientWidth`。
- 390px：正式提交按钮 `322×44px`，约 2 行；标题宽度 `358px`。
- 320px：正式提交按钮 `252×44px`，约 2 行；标题宽度 `288px`。
- 两档操作区截图显示正式提交按钮独占一行，按钮文字未被截断。
- 本轮浏览器场景控制台错误 0，页面异常 0，4xx/5xx 响应 0。

## 自动化检查

- `node --check scripts/ux_mobile_actions.cjs`：通过
- `git diff --check`：通过
- 之前 round-12 的全量回归仍为 Python `435 passed`、前端契约 `158 passed`；本轮只修改了走查脚本的截图裁剪边界，因此未重复运行无关业务测试。

## 本轮脚本修正

`scripts/ux_mobile_actions.cjs` 的截图裁剪现在会先滚动到操作按钮，再将裁剪矩形限制在视口范围内。修正前脚本在按钮位于页面下方时会报 `Clipped area is either empty or outside the resulting image`，不代表产品页面故障。

## 证据文件

- `round-13-live/submitter-results.json` 与提交者流程截图
- `round-13-review/review-s4-no-key.png`、`review-s1.png`、`review-s2.png`、`review-s3.png`、`review-missing-subject.png`
- `submitter-actions-390.png`、`submitter-actions-320.png`

## 边界

本记录验证的是本地虚构种子和无头 Chromium；没有把它扩展为真实用户试点、公网部署安全验收或屏幕阅读器认证。模型未配置时的语义规则仍按产品设计停在“检查未完成”，资格与最终验收仍由组织者人工决定。
