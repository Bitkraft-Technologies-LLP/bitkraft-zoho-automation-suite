# Coding Agent Context & Workspace Guide

Welcome, Agent! This directory (`.agent-context/`) serves as a structured context repository for AI-driven development. If you are starting fresh on this repository, or resuming an existing session, this guide ensures a zero-friction handoff.

---

## 📂 Context Directory Map

| File Name | Purpose | Description |
| :--- | :--- | :--- |
| [README.md](file:///Users/aliasgerr/.gemini/antigravity/scratch/bitkraft-zoho-automation-suite/.agent-context/README.md) | **Context Index** | This file. Directory index, purpose, and workspace overview. |
| [bootstrapping.md](file:///Users/aliasgerr/.gemini/antigravity/scratch/bitkraft-zoho-automation-suite/.agent-context/bootstrapping.md) | **Environment Setup** | Detailed steps to set up the Node.js/Python runtimes, manage credentials, and handle fresh git clones. |
| [harnessing.md](file:///Users/aliasgerr/.gemini/antigravity/scratch/bitkraft-zoho-automation-suite/.agent-context/harnessing.md) | **Testing & Run Guide** | CLI dry-runs, safety flags, mocking patterns, and how to verify features without side effects. |
| [specs.md](file:///Users/aliasgerr/.gemini/antigravity/scratch/bitkraft-zoho-automation-suite/.agent-context/specs.md) | **System Architecture** | Technical specs of the 4 core subsystems (Invoice Parser, ICEGATE Automation, Payment Advice, Control Center). |

---

## 📋 Coding Agent Onboarding Flow

When given a coding task or issue in this repository, follow these steps to bootstrap your context:

1. **Verify Open Issues**:
   Check the [GitHub Issues tracker](https://github.com/Bitkraft-Technologies-LLP/bitkraft-zoho-automation-suite/issues) of the repository to identify active tasks, backlogs, and work descriptions.

2. **Set Up the Environment**:
   Follow the step-by-step instructions in [bootstrapping.md](file:///Users/aliasgerr/.gemini/antigravity/scratch/bitkraft-zoho-automation-suite/.agent-context/bootstrapping.md) to install Node and Python dependencies and configure your `.env` variables.

3. **Explore System Architecture**:
   Review [specs.md](file:///Users/aliasgerr/.gemini/antigravity/scratch/bitkraft-zoho-automation-suite/.agent-context/specs.md) to understand directories, file boundaries, data schemas, and Zoho integration touchpoints.

4. **Verify Safety Harnesses**:
   Check [harnessing.md](file:///Users/aliasgerr/.gemini/antigravity/scratch/bitkraft-zoho-automation-suite/.agent-context/harnessing.md) to run diagnostic runs (e.g. `--dry-run` invoice parsing or statement reconciliation) to test your code changes safely without causing side-effects in production Zoho data.
