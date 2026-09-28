#!/bin/bash
# deploy-github.sh — 梗王吐槽机 GitHub 推送脚本
# 逐行执行，遇到密码提示用 Personal Access Token 替代密码

cd /Users/lujin/.qwenworkcn/workspace/mul2yakx6ko1mtin/outputs/roast-agent

# 1. 初始化 git 仓库
git init

# 2. 添加所有文件
git add .

# 3. 提交
git commit -m "🔥 梗王吐槽机 v1.0 - 毒舌吐槽 Agent"

# 4. 重命名主分支
git branch -M main

# 5. 添加远程仓库（把 YOUR_TOKEN 替换为你的 GitHub Personal Access Token）
# 如果还没有 Token，去这里创建：https://github.com/settings/tokens/new
# 勾选 repo 权限，有效期选 90 天
git remote add origin https://JAMESCHENG1:YOUR_TOKEN@github.com/JAMESCHENG1/roast-agent.git

# 6. 推送到 GitHub
git push -u origin main

echo ""
echo "✅ 推送完成！"
echo "仓库地址: https://github.com/JAMESCHENG1/roast-agent"
