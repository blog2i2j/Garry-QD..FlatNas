# Changelog
All notable changes to this project will be documented in this file.

## [Unreleased]
- Docker 自动升级镜像：开关关闭时后台不再执行镜像拉取/版本对比
- Docker 自动升级镜像：升级完成后按“保留版本数”自动清理旧镜像，并加入磁盘可用空间阈值保护
- 自动化测试：补充自动升级开关、磁盘不足、无新版本、拉取失败、镜像清理等场景用例

