# 素材库单张图片替换｜2026-10-15

用户要求：在截图的环球领航素材卡片增加“修改图片”，允许逐张重新上传。适用于各店产品库“图片与资料”的公共副图、详情首页和共用详情正文；不改变商品主图列表布局。

每张卡片下方“修改图片”→选择一张本地 PNG/JPG/WebP→查看预览→保存。单张最多16MB。取消不写入；读取或保存失败有明确提示；丢失回执的重试沿用原请求编号。服务端验证店铺、图片范围、文件格式和完整像素解码，限制80百万像素、单边32768像素，拒绝动态多帧；这些检查不代表商品内容或平台审核通过。

图片按店铺保存新版本，位于本店已配置素材目录的`.travel-os-image-versions/`内。原图及每次已保存的版本保留；SQLite记录当前映射、版本和幂等回执，不保存前端上传的base64。图库显示“已修改”；后续重新导入继续应用本店最新映射，当前随机副图/首页配置同步更新，原草稿因配置版本变化需要重新核对。

影响范围明确为素材库和后续新建任务：新增派生导入版本，不改原导入、原run、队列、固定清单manifest、已发布记录或待核验商品。已有700条固定清单继续使用原快照；如果要采用新素材，应沿项目现有资料版本绑定机制单独处理，不能把换图当作原任务已更新或自动恢复执行。原始文件在外部另改造成hash冲突时拒绝继续套用旧映射，要求核对版本。

执行或创建/核验任务期间拒绝保存；保存持有本店原有capture互斥，并在异步文件操作后重查版本。事务失败回滚导入、映射、配置和事件，只删除本次实际新写的暂存文件。跨店、过期版本和请求编号复用不同内容均拒绝。

实现：`workbench/material-replacement.mjs`、`material-editor.js`；接入`source-store.mjs`、`publishing-rules.mjs`、`material-library.mjs`、`travel-os-api.mjs`、`travel-os.js`、`travel-os.css`及`static-files.mjs`。完整解码依赖锁定版本sharp，调用依据：[构造参数](https://sharp.pixelplumbing.com/api-constructor/)、[像素统计触发解码](https://sharp.pixelplumbing.com/api-input/#stats)。未对上传图片裁切、改色或重新编码。

验证：`workbench/scripts/material-replacement.test.mjs`、`material-replacement-ui-qa.mjs`均使用临时合成资料；不替换真实店铺素材、不访问淘宝发布。证据集中在`output/material-replacement-20261015/`；独立QA报告为`independent-qa.md`，最终加载与真实页面只读检查另记。

已完成独立QA并正式加载：71项版本`20261015-material-kernel-sync`、PID55516；本机及`http://192.168.1.3:4318`实际页面只读验证，环球2首页+8正文均有修改按钮，单文件选择、原图预览、取消和手机布局正常，页面错误0、真实上传0、发布操作0。维护前后9库既有表、8店设置和原任务状态逐项一致。具体层级和并行开发边界见`output/material-replacement-20261015/VALIDATION.md`；真实图片保存功能通过隔离合成素材验证，没有为测试而替换用户图片。
