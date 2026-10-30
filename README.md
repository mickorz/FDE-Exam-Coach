# FDE-Exam-Coach

一个帮助开发者备考 FDE（Forward Deployed Engineer，前线部署工程师）工程师考试的教练系统。

## 快速开始

Phase 1 备考应用已可用（Windows 需 Python 3.9+）：

```sh
启动备考.bat        # 或：cd app && python server.py
```

访问 http://127.0.0.1:8765 ，详见 `app/README.md`（含 AI 讲解配置）。

## 概述

FDE-Exam-Coach 面向想通过 FDE 工程师考试的开发者，提供备考教练能力：

- FDE 考试知识点梳理与学习路径规划
- 练习题演练与错题复盘
- 备考过程跟进与薄弱环节诊断

> 项目处于初始阶段，核心能力范围与技术选型随 `dev-docs/design/` 设计文档推进逐步明确。

## 目录结构

```text
app/           备考应用主工程（基于 thirdparties/FDE_Learning 扩展，见 app/README.md）
thirdparties/  只读参考项目（FDE_Learning、wrong-notebook，勿直接修改）
docs/          读者向文档
dev-docs/      开发过程文档
dev-examples/  开发期沙盒
```
