# AI Agent Skills — Full Catalog

> Auto-generated. Total: **2881 skills** across **148 categories**.
> When asked "what skill should I use?", browse this file and suggest the most relevant skill IDs.
> Install a skill: `Ctrl+Shift+/` → search for the skill ID → press Enter.

## agent-behavior

- **codex-fable5**: Apply Fable-inspired discipline to Codex work: inspect first, track goals and findings, ground conclusions in evidence, verify before completion, and adapt Claude/Fable prompt guidance without identity or provider claims. _(risk: critical)_
- **dispatch**: Delegate tasks to OpenAI Codex CLI and Google Antigravity CLI from Claude Code with topic-aware sessions _(risk: critical)_
- **ditto**: Use when a user asks to mine or update a private, evidence-backed work profile from local Claude Code, Codex, Copilot CLI, or OpenCode sessions. _(risk: critical)_
- **fable-safe-prompt**: Rewrite allowed prompts to reduce false-positive safety triggers without bypassing policy or changing intent. _(risk: safe)_
- **zipai-optimizer**: Ultra-dense token optimizer skill for prompt caching, log pruning, AST-based inspection, and minified JSON payloads. _(risk: safe)_

## agent-evaluation

- **agent-evaluation-reporting**: Use when summarizing agent evaluations where autonomous, assisted, failed, timed-out, or invalid outcomes must remain distinct and comparable.
- **run-deep-swe**: Run reproducible DeepSWE coding-agent benchmark evaluations through OpenRouter and mini-swe-agent. _(risk: critical)_

## agent-orchestration

- **agent-self-scheduling**: Schedule AI agent runs with cron, loops, or external clocks while avoiding unsafe tight autonomous timers. _(risk: critical)_
- **agentflow**: Orchestrate autonomous AI development pipelines through your Kanban board (Asana, GitHub Projects, Linear). Manages multi-worker Claude Code dispatch, deterministic quality gates, adversarial review, per-task cost tracking, and recoverable pipeline design. _(risk: critical)_
- **agy-delegate**: Delegate coding tasks to the Google Antigravity CLI (`agy`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **aider-delegate**: Delegate coding tasks to Aider (`aider`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **claude-delegate**: Delegate coding tasks to a separate Claude Code CLI process or Claude session only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **cline-delegate**: Delegate coding tasks to the Cline CLI (`cline`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **cline-pilot**: Proxy Cline CLI coding tasks: dispatch, monitor background runs via hard evidence, relay decision points in a fixed format, verify against a checklist, and learn per-tag preferences over time. _(risk: critical)_
- **codex-delegate**: Delegate coding tasks to the OpenAI Codex CLI only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **codex-subagent**: Launch Codex CLI as an isolated subagent for bounded coding, review, or verification tasks. _(risk: critical)_
- **commandcode-delegate**: Delegate coding tasks to the Command Code CLI (`cmd`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **copilot-delegate**: Delegate coding tasks to the GitHub Copilot CLI (`copilot`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **cursor-delegate**: Delegate coding tasks to the Cursor Agent CLI (`cursor-agent`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **delegate-setup**: Configure approved delegation lanes across installed implementer CLIs, including optional model and effort choices, then write global or project config only after explicit user approval. _(risk: safe)_
- **delegating-to-agents**: Delegate bounded work to other AI agents while preserving context, ownership, and progress checks. _(risk: critical)_
- **fact-check-x-unified**: Fact-Check-X 流程编排能力，依次组织各方答案汇总、各方答案聚合（未核验）、权威核验后的最终答案和各方答案测评，生成可打开、可审计、可迁移的阶段产物与完整报告包。 _(risk: critical)_
- **goal-instruction-writer**: Preview, draft, refine, or audit durable agent Goals with acceptance evidence, drift controls, proportional verification, and bounded waiting. Use for multi-stage work, not one-shot prompts. _(risk: safe)_
- **goal-loop**: Draft and explain persistent goal-loop prompts for long-running agent work with clear stop conditions. _(risk: safe)_
- **grok-build**: Delegate well-specified implementation tasks to xAI's Grok Build CLI running headlessly while the orchestrating agent plans, writes task specs, reviews every diff, and owns the result. _(risk: critical)_
- **grok-delegate**: Delegate coding tasks to the Grok Build CLI only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **idea-evaluator**: Evaluates an idea by hosting a multi-turn debate between a Pro and Con agent, delivering a final verdict on whether it's worth pursuing. _(risk: safe)_
- **jev-use**: Route enumerable judgment steps - did it work, which option, how risky, is this safe to run - to the Jev judgment model through the jev_judge and jev_gate MCP tools, batched into one call per state. _(risk: critical)_
- **kimi-delegate**: Delegate coding tasks to the Kimi Code CLI (`kimi`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **multi-agent-task-orchestrator**: Route tasks to specialized AI agents with anti-duplication, quality gates, and 30-minute heartbeat monitoring _(risk: safe)_
- **omp-delegate**: Delegate coding tasks to Oh My Pi (`omp`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **opencode-delegate**: Delegate coding tasks to the OpenCode CLI only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **orchestrate**: Coordinate focused subagents on substantial work, keep their ownership non-overlapping, and integrate verified results. Use for large-scope Codex tasks; keep trivial work with the coordinator. _(risk: safe)_
- **pi-delegate**: Delegate coding tasks to the Pi coding agent CLI (`pi`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **polis-protocol-a-self-optimizing-city-of-agents**: Polis Protocol: A Self-Optimizing City of Agents _(risk: critical)_
- **qoder-delegate**: Delegate coding tasks to the Qoder CLI (`qodercli`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **ralph-loop-yylo**: Execute exactly one explicitly assigned YYLO Ledger task through the Ralph loop to a validated queued commit. Use only when the user explicitly requests ralph-loop-yylo. _(risk: critical)_
- **review-multi-agent-orchestration**: Use when a supervisor, swarm, graph, planner-worker system, or parallel agent workflow needs review for task boundaries, shared state, branch joins, retries, cancellation, context handoffs, budgets, deadlocks, or human escalation before implementation or production rollout. _(risk: safe)_
- **subagent-orchestrator**: Coordinate quota-aware parallel subagents for large, multi-file Antigravity tasks. _(risk: critical)_
- **vibe-delegate**: Delegate coding tasks to the Mistral Vibe CLI (`vibe`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **warp-delegate**: Delegate coding tasks to the Warp Agent CLI (`oz`) only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_
- **zcode-delegate**: Delegate coding tasks to the Z.AI ZCode CLI only when the user explicitly requests it, while the orchestrator retains review and landing responsibility. _(risk: critical)_

## agent-persona

- **idea-evaluator-con**: The Con Agent persona for idea evaluation. Critiques an idea by identifying potential flaws, risks, and market challenges. _(risk: safe)_
- **idea-evaluator-pro**: The Pro Agent persona for idea evaluation. Logically supports an idea, arguing for its market fit, feasibility, and potential. _(risk: safe)_

## agent-squad

- **alex**: Turns requirements into a precise, dependency-aware implementation plan. _(risk: safe)_
- **aria**: Designs the data model, API contracts, and structural foundation of the system. _(risk: safe)_
- **dep**: Handles containerization, CI/CD pipelines, and deployment setup. _(risk: critical)_
- **luna**: Reviews code for objective correctness, security, and reliability. _(risk: safe)_
- **mason**: Produces clean, functional code that matches the architecture and checklists. _(risk: safe)_
- **max**: Cleans up and improves existing code without changing behavior. _(risk: safe)_
- **quinn**: Verifies specified behavior through appropriate tests and truthful coverage reports. _(risk: safe)_
- **rex**: Translates user intent into a precise, unambiguous specification and requirements. _(risk: safe)_

## agent-tooling

- **aas-compose-stack**: Preserve the coding agent's explicit AAS skill selection as a validated stack and optional evidence. _(risk: safe)_
- **aas-discover**: Discover AAS skills for an explicit task and compare their complete instructions without installing them. _(risk: safe)_
- **aas-review-stack**: Review AAS stack manifests, preview plans and selection evidence in Workbench without applying changes. _(risk: safe)_

## ai

- **weaviate-cookbooks**: Build Weaviate AI apps from official cookbook blueprints for RAG, agentic RAG, data exploration, multimodal PDF search, async clients, and frontends. _(risk: critical)_

## ai-agents

- **accint-frames**: Drain acc's deliberation queue — open/waiting brain_frames checkpointed by headless runs — via acc_act(runtime="continue"). _(risk: critical)_
- **accint-solve**: Route a goal through acc's scored-memory loop via acc_act(runtime="solve"); deliberate any returned brain_frame and submit via continue. _(risk: critical)_
- **lambda-lang**: Native agent-to-agent language for compact multi-agent messaging. A shared tongue agents speak directly, not a translation layer. 340+ atoms across 7 domains; 3x smaller than natural language. _(risk: safe)_
- **llm-council**: Run Fireworks-hosted open-weight model councils that compare responses and synthesize a final answer. _(risk: critical)_
- **loop-library**: Find, compare, adapt, and design bounded AI-agent feedback loops with explicit checks, stop rules, guardrails, and handoffs. _(risk: safe)_
- **open-dynamic-workflows**: Plan, orchestrate, and adversarially verify parallel AI coding agents with a dynamic multi-agent workflow engine. _(risk: critical)_
- **pilot-protocol**: Give an AI agent a permanent network address, encrypted P2P messaging, and an installable app store via Pilot Protocol _(risk: critical)_
- **pydantic-ai**: Build production-ready AI agents with PydanticAI — type-safe tool use, structured outputs, dependency injection, and multi-model support. _(risk: safe)_

## ai-ml

- **advanced-evaluation**: This skill should be used when the user asks to "implement LLM-as-judge", "compare model outputs", "create evaluation rubrics", "mitigate evaluation bias", or mentions direct scoring, pairwise comparison, position bias, evaluation pipelines, or automated quality assessment. _(risk: unknown)_
- **agent-evaluation**: Testing and benchmarking LLM agents including behavioral testing, capability assessment, reliability metrics, and production monitoring—where even top agents achieve less than 50% on re... _(risk: unknown)_
- **agent-framework-azure-ai-py**: Build Azure AI Foundry agents using the Microsoft Agent Framework Python SDK (agent-framework-azure-ai). Use when creating persistent agents with AzureAIAgentsProvider, using hosted tools (code int... _(risk: unknown)_
- **agent-manager-skill**: Manage multiple local CLI agents via tmux sessions (start/stop/monitor/assign) with cron-friendly scheduling. _(risk: unknown)_
- **agent-memory-mcp**: A hybrid memory system that provides persistent, searchable knowledge management for AI agents (Architecture, Patterns, Decisions). _(risk: unknown)_
- **agent-memory-systems**: Memory is the cornerstone of intelligent agents. Without it, every interaction starts from zero. This skill covers the architecture of agent memory: short-term (context window), long-term (vector s... _(risk: unknown)_
- **agent-orchestration-improve-agent**: Systematic improvement of existing agents through performance analysis, prompt engineering, and continuous iteration. _(risk: unknown)_
- **agent-orchestration-multi-agent-optimize**: Optimize multi-agent systems with coordinated profiling, workload distribution, and cost-aware orchestration. Use when improving agent performance, throughput, or reliability. _(risk: unknown)_
- **agent-orchestrator**: Meta-skill que orquestra todos os agentes do ecossistema. Scan automatico de skills, match por capacidades, coordenacao de workflows multi-skill e registry management. _(risk: safe)_
- **agent-tool-builder**: Tools are how AI agents interact with the world. A well-designed tool is the difference between an agent that works and one that hallucinates, fails silently, or costs 10x more tokens than necessar... _(risk: unknown)_
- **agentic-actions-auditor**: Audits GitHub Actions workflows for security vulnerabilities in AI agent integrations including Claude Code Action, Gemini CLI, OpenAI Codex, and GitHub AI Inference. Detects attack vectors where attacker-controlled input reaches AI agents running in CI/CD pipelines,... _(risk: unknown)_
- **agents-md**: This skill should be used when the user asks to "create AGENTS.md", "update AGENTS.md", "maintain agent docs", "set up CLAUDE.md", or needs to keep agent instructions concise. Enforces research-backed best practices for minimal, high-signal agent documentation. _(risk: unknown)_
- **ai-agents-architect**: Expert in designing and building autonomous AI agents. Masters tool use, memory systems, planning strategies, and multi-agent orchestration. Use when: build agent, AI agent, autonomous agent, tool ... _(risk: unknown)_
- **ai-analyzer**: AI驱动的综合健康分析系统，整合多维度健康数据、识别异常模式、预测健康风险、提供个性化建议。支持智能问答和AI健康报告生成。 _(risk: unknown)_
- **ai-engineer**: Build production-ready LLM applications, advanced RAG systems, and intelligent agents. Implements vector search, multimodal AI, agent orchestration, and enterprise AI integrations. _(risk: unknown)_
- **ai-md**: Convert human-written CLAUDE.md into AI-native structured-label format. Battle-tested across 4 models. Same rules, fewer tokens, higher compliance. _(risk: safe)_
- **ai-product**: Every product will be AI-powered. The question is whether you'll build it right or ship a demo that falls apart in production. This skill covers LLM integration patterns, RAG architecture, prompt ... _(risk: unknown)_
- **ai-studio-image**: Geracao de imagens humanizadas via Google AI Studio (Gemini). Fotos realistas estilo influencer ou educacional com iluminacao natural e imperfeicoes sutis. _(risk: safe)_
- **ai-wrapper-product**: Expert in building products that wrap AI APIs (OpenAI, Anthropic, etc.) into focused tools people will pay for. Not just 'ChatGPT but different' - products that solve specific problems with AI. Cov... _(risk: unknown)_
- **amazon-alexa**: Integracao completa com Amazon Alexa para criar skills de voz inteligentes, transformar Alexa em assistente com Claude como cerebro (projeto Auri) e integrar com AWS ecosystem (Lambda, DynamoDB,... _(risk: safe)_
- **andrej-karpathy**: Agente que simula Andrej Karpathy — ex-Director of AI da Tesla, co-fundador da OpenAI, fundador da Eureka Labs, e o maior educador de deep learning do mundo. Use quando quiser: aprender deep... _(risk: safe)_
- **antigravity-skill-orchestrator**: A meta-skill that understands task requirements, dynamically selects appropriate skills, tracks successful skill combinations using agent-memory-mcp, and prevents skill overuse for simple tasks. _(risk: safe)_
- **antigravity-workflows**: Orchestrate multiple Antigravity skills through guided workflows for SaaS MVP delivery, security audits, AI agent builds, and browser QA.
- **auri-core**: Auri: assistente de voz inteligente (Alexa + Claude claude-opus-4-20250805). Visao do produto, persona Vitoria Neural, stack AWS, modelo Free/Pro/Business/Enterprise, roadmap 4 fases, GTM, north...
- **autonomous-agent-patterns**: Design patterns for building autonomous coding agents. Covers tool integration, permission systems, browser automation, and human-in-the-loop workflows. Use when building AI agents, designing tool ... _(risk: unknown)_
- **autonomous-agents**: Autonomous agents are AI systems that can independently decompose goals, plan actions, execute tools, and self-correct without constant human guidance. The challenge isn't making them capable - it'... _(risk: unknown)_
- **azure-ai-ml-py**: Azure Machine Learning SDK v2 for Python. Use for ML workspaces, jobs, models, datasets, compute, and pipelines. _(risk: unknown)_
- **azure-ai-openai-dotnet**: Azure OpenAI SDK for .NET. Client library for Azure OpenAI and OpenAI services. Use for chat completions, embeddings, image generation, audio transcription, and assistants. _(risk: unknown)_
- **azure-search-documents-py**: Azure AI Search SDK for Python. Use for vector search, hybrid search, semantic ranking, indexing, and skillsets. _(risk: unknown)_
- **blockrun**: Use when user needs capabilities Claude lacks (image generation, real-time X/Twitter data) or explicitly requests external models (\"blockrun\", \"use grok\", \"use gpt\", \"da... _(risk: unknown)_
- **brand-guidelines-anthropic**: Applies Anthropic's official brand colors and typography to any sort of artifact that may benefit from having Anthropic's look-and-feel. Use it when brand colors or style guidelines, visual formatt... _(risk: unknown)_
- **brand-guidelines-community**: Applies Anthropic's official brand colors and typography to any sort of artifact that may benefit from having Anthropic's look-and-feel. Use it when brand colors or style guidelines, visual formatt... _(risk: unknown)_
- **browser-automation**: Browser automation powers web testing, scraping, and AI agent interactions. The difference between a flaky script and a reliable system comes down to understanding selectors, waiting strategies, an... _(risk: unknown)_
- **cc-skill-continuous-learning**: Development skill from everything-claude-code _(risk: unknown)_
- **cc-skill-strategic-compact**: Development skill from everything-claude-code _(risk: unknown)_
- **clarity-gate**: Pre-ingestion verification for epistemic quality in RAG systems. Ensures documents are properly qualified before entering knowledge bases. Produces CGD (Clarity-Gated Documents) and validates SOT (Source of Truth) files.
 _(risk: unknown)_
- **claude-ally-health**: A health assistant skill for medical information analysis, symptom tracking, and wellness guidance. _(risk: safe)_
- **claude-code-expert**: Especialista profundo em Claude Code - CLI da Anthropic. Maximiza produtividade com atalhos, hooks, MCPs, configuracoes avancadas, workflows, CLAUDE.md, memoria, sub-agentes, permissoes e...
- **claude-code-guide**: Master guide for using Claude Code effectively. Includes configuration templates, prompting strategies \"Thinking\" keywords, debugging techniques, and best practices for interacting wit... _(risk: unknown)_
- **claude-d3js-skill**: Creating interactive data visualisations using d3.js. This skill should be used when creating custom charts, graphs, network diagrams, geographic visualisations, or any complex SVG-based data visua... _(risk: unknown)_
- **claude-in-chrome-troubleshooting**: Diagnose and fix Claude in Chrome MCP extension connectivity issues. Use when mcp__claude-in-chrome__* tools fail, return "Browser extension is not connected", or behave erratically. _(risk: unknown)_
- **claude-monitor**: Monitor de performance do Claude Code e sistema local. Diagnostica lentidao, mede CPU/RAM/disco, verifica API latency e gera relatorios de saude do sistema. _(risk: safe)_
- **claude-scientific-skills**: Scientific research and analysis skills _(risk: safe)_
- **claude-settings-audit**: Analyze a repository to generate recommended Claude Code settings.json permissions. Use when setting up a new project, auditing existing settings, or determining which read-only bash commands to allow. Detects tech stack, build tools, and monorepo structure. _(risk: unknown)_
- **claude-speed-reader**: -Speed read Claude's responses at 600+ WPM using RSVP with Spritz-style ORP highlighting _(risk: safe)_
- **claude-win11-speckit-update-skill**: Windows 11 system management _(risk: safe)_
- **code-review-ai-ai-review**: You are an expert AI-powered code review specialist combining automated static analysis, intelligent pattern recognition, and modern DevOps practices. Leverage AI tools (GitHub Copilot, Qodo, GPT-5, C _(risk: unknown)_
- **computer-use-agents**: Build AI agents that interact with computers like humans do - viewing screens, moving cursors, clicking buttons, and typing text. Covers Anthropic's Computer Use, OpenAI's Operator/CUA, and open-so... _(risk: unknown)_
- **context-window-management**: Strategies for managing LLM context windows including summarization, trimming, routing, and avoiding context rot Use when: context window, token limit, context management, context engineering, long... _(risk: unknown)_
- **context7-auto-research**: Automatically fetch latest library/framework documentation for Claude Code via Context7 API _(risk: unknown)_
- **conversation-memory**: Persistent memory systems for LLM conversations including short-term, long-term, and entity-based memory Use when: conversation memory, remember, memory persistence, long-term memory, chat history. _(risk: unknown)_
- **crewai**: Expert in CrewAI - the leading role-based multi-agent framework used by 60% of Fortune 500 companies. Covers agent design with roles and goals, task definition, crew orchestration, process types (s... _(risk: unknown)_
- **crypto-bd-agent**: Autonomous crypto business development patterns — multi-chain token discovery, 100-point scoring with wallet forensics, x402 micropayments, ERC-8004 on-chain identity, LLM cascade routing, and... _(risk: safe)_
- **data-scientist**: Expert data scientist for advanced analytics, machine learning, and statistical modeling. Handles complex data analysis, predictive modeling, and business intelligence. _(risk: unknown)_
- **deep-research**: Execute autonomous multi-step research using Google Gemini Deep Research Agent. Use for: market analysis, competitive landscaping, literature reviews, technical research, due diligence. Takes 2-10 ... _(risk: safe)_
- **design-orchestration**: Orchestrates design workflows by routing work through brainstorming, multi-agent review, and execution readiness in the correct order. _(risk: unknown)_
- **devcontainer-setup**: Creates devcontainers with Claude Code, language-specific tooling (Python/Node/Rust/Go), and persistent volumes. Use when adding devcontainer support to a project, setting up isolated development environments, or configuring sandboxed Claude Code workspaces. _(risk: unknown)_
- **dispatching-parallel-agents**: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies _(risk: unknown)_
- **docx-official**: Comprehensive document creation, editing, and analysis with support for tracked changes, comments, formatting preservation, and text extraction. When Claude needs to work with professional document... _(risk: unknown)_
- **earllm-build**: Build, maintain, and extend the EarLLM One Android project — a Kotlin/Compose app that connects Bluetooth earbuds to an LLM via voice pipeline. Use this skill whenever working on the earbudllm... _(risk: safe)_
- **embedding-strategies**: Select and optimize embedding models for semantic search and RAG applications. Use when choosing embedding models, implementing chunking strategies, or optimizing embedding quality for specific dom... _(risk: unknown)_
- **error-debugging-multi-agent-review**: Use when working with error debugging multi agent review _(risk: unknown)_
- **evaluation**: Build evaluation frameworks for agent systems _(risk: safe)_
- **ffuf-claude-skill**: Web fuzzing with ffuf _(risk: safe)_
- **gemini-api-dev**: Use this skill when building applications with Gemini models, Gemini API, working with multimodal content (text, images, audio, video), implementing function calling, using structured outputs, or n... _(risk: unknown)_
- **gemini-api-integration**: Use when integrating Google Gemini API into projects. Covers model selection, multimodal inputs, streaming, function calling, and production best practices. _(risk: safe)_
- **geo-fundamentals**: Generative Engine Optimization for AI search engines (ChatGPT, Claude, Perplexity). _(risk: unknown)_
- **geoffrey-hinton**: Agente que simula Geoffrey Hinton — Godfather of Deep Learning, Prêmio Turing 2018, criador do backpropagation e das Deep Belief Networks. Use quando quiser: perspectivas históricas sobre deep... _(risk: safe)_
- **hierarchical-agent-memory**: Scoped CLAUDE.md memory system that reduces context token spend. Creates directory-level context files, tracks savings via dashboard, and routes agents to the right sub-context. _(risk: safe)_
- **hugging-face-cli**: Execute Hugging Face Hub operations using the `hf` CLI. Use when the user needs to download models/datasets/spaces, upload files to Hub repositories, create repos, manage local cache, or run comput... _(risk: safe)_
- **hugging-face-datasets**: Create and manage datasets on Hugging Face Hub. Supports initializing repos, defining configs/system prompts, streaming row updates, and SQL-based dataset querying/transformation. Designed to work alongside HF MCP server for comprehensive dataset workflows. _(risk: unknown)_
- **hugging-face-model-trainer**: This skill should be used when users want to train or fine-tune language models using TRL (Transformer Reinforcement Learning) on Hugging Face Jobs infrastructure. Covers SFT, DPO, GRPO and reward modeling training methods, plus GGUF conversion for... _(risk: unknown)_
- **hybrid-search-implementation**: Combine vector and keyword search for improved retrieval. Use when implementing RAG systems, building search engines, or when neither approach alone provides sufficient recall. _(risk: unknown)_
- **ilya-sutskever**: Agente que simula Ilya Sutskever — co-fundador da OpenAI, ex-Chief Scientist, fundador da SSI. Use quando quiser perspectivas sobre: AGI safety-first, consciência de IA, scaling laws, deep... _(risk: safe)_
- **imagen**: AI image generation skill powered by Google Gemini, enabling seamless visual content creation for UI placeholders, documentation, and design assets. _(risk: safe)_
- **infinite-gratitude**: Multi-agent research skill for parallel research execution (10 agents, battle-tested with real case studies). _(risk: safe)_
- **internal-comms-anthropic**: A set of resources to help me write all kinds of internal communications, using the formats that my company likes to use. Claude should use this skill whenever asked to write some sort of internal ... _(risk: unknown)_
- **internal-comms-community**: A set of resources to help me write all kinds of internal communications, using the formats that my company likes to use. Claude should use this skill whenever asked to write some sort of internal ... _(risk: unknown)_
- **langchain-architecture**: Design LLM applications using the LangChain framework with agents, memory, and tool integration patterns. Use when building LangChain applications, implementing AI agents, or creating complex LLM w... _(risk: unknown)_
- **langfuse**: Expert in Langfuse - the open-source LLM observability platform. Covers tracing, prompt management, evaluation, datasets, and integration with LangChain, LlamaIndex, and OpenAI. Essential for debug... _(risk: unknown)_
- **langgraph**: Expert in LangGraph - the production-grade framework for building stateful, multi-actor AI applications. Covers graph construction, state management, cycles and branches, persistence with checkpoin... _(risk: unknown)_
- **linear-claude-skill**: Manage Linear issues, projects, and teams _(risk: safe)_
- **llm-app-patterns**: Production-ready patterns for building LLM applications. Covers RAG pipelines, agent architectures, prompt IDEs, and LLMOps monitoring. Use when designing AI applications, implementing RAG, buildin... _(risk: unknown)_
- **llm-application-dev-ai-assistant**: You are an AI assistant development expert specializing in creating intelligent conversational interfaces, chatbots, and AI-powered applications. Design comprehensive AI assistant solutions with natur _(risk: unknown)_
- **llm-application-dev-langchain-agent**: You are an expert LangChain agent developer specializing in production-grade AI systems using LangChain 0.1+ and LangGraph. _(risk: unknown)_
- **llm-application-dev-prompt-optimize**: You are an expert prompt engineer specializing in crafting effective prompts for LLMs through advanced techniques including constitutional AI, chain-of-thought reasoning, and model-specific optimizati _(risk: unknown)_
- **llm-evaluation**: Implement comprehensive evaluation strategies for LLM applications using automated metrics, human feedback, and benchmarking. Use when testing LLM performance, measuring AI application quality, or ... _(risk: unknown)_
- **llm-ops**: LLM Operations -- RAG, embeddings, vector databases, fine-tuning, prompt engineering avancado, custos de LLM, evals de qualidade e arquiteturas de IA para producao. Ativar para: implementar RAG,... _(risk: safe)_
- **llm-prompt-optimizer**: Use when improving prompts for any LLM. Applies proven prompt engineering techniques to boost output quality, reduce hallucinations, and cut token usage. _(risk: safe)_
- **llm-structured-output**: Get reliable JSON, enums, and typed objects from LLMs using response_format, tool_use, and schema-constrained decoding across OpenAI, Anthropic, and Google APIs.
 _(risk: safe)_
- **loki-mode**: Multi-agent autonomous startup system for Claude Code. Triggers on "Loki Mode". Orchestrates 100+ specialized agents across engineering, QA, DevOps, security, data/ML, business operations,... _(risk: unknown)_
- **machine-learning-ops-ml-pipeline**: Design and implement a complete ML pipeline for: $ARGUMENTS _(risk: unknown)_
- **mcp-builder**: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate exte... _(risk: unknown)_
- **mcp-builder-ms**: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate exte... _(risk: unknown)_
- **memory-systems**: Design short-term, long-term, and graph-based memory architectures _(risk: safe)_
- **molykit**: CRITICAL: Use for MolyKit AI chat toolkit. Triggers on:
BotClient, OpenAI, SSE streaming, AI chat, molykit,
PlatformSend, spawn(), ThreadToken, cross-platform async,
Chat widget, Messages, PromptInput, Avatar, LLM _(risk: unknown)_
- **multi-agent-brainstorming**: Simulate a structured peer-review process using multiple specialized agents to validate designs, surface hidden assumptions, and identify failure modes before implementation. _(risk: unknown)_
- **multi-agent-patterns**: This skill should be used when the user asks to "design multi-agent system", "implement supervisor pattern", "create swarm architecture", "coordinate multiple agents", or mentions multi-agent patterns, context isolation, agent handoffs, sub-agents, or parallel agent execution. _(risk: unknown)_
- **n8n-mcp-tools-expert**: Expert guide for using n8n-mcp MCP tools effectively. Use when searching for nodes, validating configurations, accessing templates, managing workflows, or using any n8n-mcp tool. Provides tool selection guidance, parameter formats, and common patterns. _(risk: unknown)_
- **nerdzao-elite-gemini-high**: Modo Elite Coder + UX Pixel-Perfect otimizado especificamente para Gemini 3.1 Pro High. Workflow completo com foco em qualidade máxima e eficiência de tokens. _(risk: safe)_
- **notebooklm**: Use this skill to query your Google NotebookLM notebooks directly from Claude Code for source-grounded, citation-backed answers from Gemini. Browser automation, library management, persistent auth.... _(risk: unknown)_
- **parallel-agents**: Multi-agent orchestration patterns. Use when multiple independent tasks can run with different domain expertise or when comprehensive analysis requires multiple perspectives. _(risk: unknown)_
- **pdf-official**: Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. When Claude needs to fill in a PDF form or programmaticall... _(risk: unknown)_
- **performance-testing-review-ai-review**: You are an expert AI-powered code review specialist combining automated static analysis, intelligent pattern recognition, and modern DevOps practices. Leverage AI tools (GitHub Copilot, Qodo, GPT-5, C _(risk: unknown)_
- **performance-testing-review-multi-agent-review**: Use when working with performance testing review multi agent review _(risk: unknown)_
- **podcast-generation**: Generate AI-powered podcast-style audio narratives using Azure OpenAI's GPT Realtime Mini model via WebSocket. Use when building text-to-speech features, audio narrative generation, podcast creatio... _(risk: unknown)_
- **pptx-official**: Presentation creation, editing, and analysis. When Claude needs to work with presentations (.pptx files) for: (1) Creating new presentations, (2) Modifying or editing content, (3) Working with layo... _(risk: unknown)_
- **project-development**: This skill should be used when the user asks to "start an LLM project", "design batch pipeline", "evaluate task-model fit", "structure agent project", or mentions pipeline architecture, agent-assisted development, cost estimation, or choosing... _(risk: unknown)_
- **prompt-caching**: Caching strategies for LLM prompts including Anthropic prompt caching, response caching, and CAG (Cache Augmented Generation) Use when: prompt caching, cache prompt, response cache, cag, cache augm... _(risk: unknown)_
- **prompt-engineering**: Expert guide on prompt engineering patterns, best practices, and optimization techniques. Use when user wants to improve prompts, learn prompting strategies, or debug agent behavior. _(risk: unknown)_
- **prompt-engineering-patterns**: Master advanced prompt engineering techniques to maximize LLM performance, reliability, and controllability in production. Use when optimizing prompts, improving LLM outputs, or designing productio... _(risk: unknown)_
- **prompt-library**: Curated collection of high-quality prompts for various use cases. Includes role-based prompts, task-specific templates, and prompt refinement techniques. Use when user needs prompt templates, role-... _(risk: unknown)_
- **rag-engineer**: Expert in building Retrieval-Augmented Generation systems. Masters embedding models, vector databases, chunking strategies, and retrieval optimization for LLM applications. Use when: building RAG, ... _(risk: unknown)_
- **react-flow-architect**: Expert ReactFlow architect for building interactive graph applications with hierarchical node-edge systems, performance optimization, and auto-layout integration. Use when Claude needs to create or... _(risk: unknown)_
- **sam-altman**: Agente que simula Sam Altman — CEO da OpenAI, ex-presidente da Y Combinator, arquiteto da era AGI. Use quando quiser: perspectivas sobre startups e fundraising (YC playbook completo), visão sobre... _(risk: safe)_
- **scikit-learn**: Machine learning in Python with scikit-learn. Use for classification, regression, clustering, model evaluation, and ML pipelines. _(risk: unknown)_
- **skill-developer**: Create and manage Claude Code skills following Anthropic best practices. Use when creating new skills, modifying skill-rules.json, understanding trigger patterns, working with hooks, debugging skil... _(risk: unknown)_
- **skill-improver**: Iteratively reviews and fixes Claude Code skill quality issues until they meet standards. Runs automated fix-review cycles using the skill-reviewer agent. Use to fix skill quality issues, improve skill descriptions, run automated skill review loops, or iteratively refine a... _(risk: unknown)_
- **skill-seekers**: -Automatically convert documentation websites, GitHub repositories, and PDFs into Claude AI skills in minutes. _(risk: safe)_
- **spline-3d-integration**: Use when adding interactive 3D scenes from Spline.design to web projects, including React embedding and runtime control API. _(risk: safe)_
- **subagent-driven-development**: Use when executing implementation plans with independent tasks in the current session _(risk: unknown)_
- **superpowers-lab**: Lab environment for Claude superpowers _(risk: safe)_
- **tdd-orchestrator**: Master TDD orchestrator specializing in red-green-refactor discipline, multi-agent workflow coordination, and comprehensive test-driven development practices. _(risk: unknown)_
- **tool-design**: Build tools that agents can use effectively, including architectural reduction patterns _(risk: safe)_
- **varlock**: Secure environment variable management with Varlock. Use when handling secrets, API keys, credentials, or any sensitive configuration. Ensures secrets are never exposed in terminals, logs, traces, or Claude's context. Trigger phrases include "environment variables",... _(risk: unknown)_
- **varlock-claude-skill**: Secure environment variable management ensuring secrets are never exposed in Claude sessions, terminals, logs, or git commits _(risk: safe)_
- **vector-database-engineer**: Expert in vector databases, embedding strategies, and semantic search implementation. Masters Pinecone, Weaviate, Qdrant, Milvus, and pgvector for RAG applications, recommendation systems, and similar _(risk: unknown)_
- **vector-index-tuning**: Optimize vector index performance for latency, recall, and memory. Use when tuning HNSW parameters, selecting quantization strategies, or scaling vector search infrastructure. _(risk: unknown)_
- **vexor**: Vector-powered CLI for semantic file search with a Claude/Codex skill _(risk: safe)_
- **voice-agents**: Voice agents represent the frontier of AI interaction - humans speaking naturally with AI systems. The challenge isn't just speech recognition and synthesis, it's achieving natural conversation flo... _(risk: unknown)_
- **voice-ai-development**: Expert in building voice AI applications - from real-time voice agents to voice-enabled apps. Covers OpenAI Realtime API, Vapi for voice agents, Deepgram for transcription, ElevenLabs for synthesis... _(risk: unknown)_
- **voice-ai-engine-development**: Build real-time conversational AI voice engines using async worker pipelines, streaming transcription, LLM agents, and TTS synthesis with interrupt handling and multi-provider support _(risk: unknown)_
- **web-artifacts-builder**: Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies (React, Tailwind CSS, shadcn/ui). Use for complex artifacts requiring state ma... _(risk: unknown)_
- **yann-lecun**: Agente que simula Yann LeCun — inventor das Convolutional Neural Networks, Chief AI Scientist da Meta, Prêmio Turing 2018. Use quando quiser: perspectivas sobre deep learning e visão... _(risk: safe)_
- **yann-lecun-filosofia**: Sub-skill filosófica e pedagógica de Yann LeCun. Cobre filosofia do open source (LLaMA, soberania tecnológica, analogia Linux), análise de incentivos Meta vs OpenAI vs Google, modo professor... _(risk: safe)_
- **agent-creator**: Create custom AI subagents with proper plugin structure, persona generation, and companion routing skills. _(risk: critical)_
- **agent-memory**: A hybrid memory system that provides persistent, searchable knowledge management for AI agents. _(risk: critical)_
- **agent-squad**: Main agent orchestrator that coordinates a specialized squad of agents _(risk: critical)_
- **agentphone**: Build AI phone agents with AgentPhone API. Use when the user wants to make phone calls, send/receive SMS, manage phone numbers, create voice agents, set up webhooks, or check usage — anything related to telephony, phone numbers, or voice AI. _(risk: critical)_
- **ai-native-cli**: Design spec with 98 rules for building CLI tools that AI agents can safely use. Covers structured JSON output, error handling, input contracts, safety guardrails, exit codes, and agent self-description. _(risk: safe)_
- **ai-seo**: Optimize content for AI search and LLM citations across AI Overviews, ChatGPT, Perplexity, Claude, Gemini, and similar systems. Use when improving AI visibility, answer engine optimization, or citation readiness. _(risk: critical)_
- **aomi-transact**: Build natural-language crypto/DeFi agents and EVM MCP plugins (Claude Code, Cursor, Codex, Gemini). Aomi turns prompts into wallet-signed txs on Ethereum, Base, Arbitrum, Optimism, Polygon, Linea — non-custodial, fork-simulated. 40+ apps: Uniswap, Aave, Lido, Morpho, GMX, Hyperliquid, Polymarket. _(risk: critical)_
- **bifrost-gateway**: Run and configure Bifrost, the open-source AI gateway: one OpenAI-compatible API for 20+ LLM providers with fallbacks, virtual keys and budgets, semantic caching, observability and an MCP gateway. _(risk: safe)_
- **brave-man**: Runs a structured clarifying interview for new project requests before building. Instead of writing code, it outputs a fully specified prompt.md for a fresh agent session to execute, preventing expensive mistakes. _(risk: critical)_
- **claude-api**: Build apps with the Claude API or Anthropic SDK. TRIGGER when: code imports `anthropic`/`@anthropic-ai/sdk`/`claude_agent_sdk`, or user asks to use Claude API, Anthropic SDKs, or Agent SDK. DO NOT TRIGGER when: code imports `openai`/other AI SDK, general programming, or ML/data-science tasks. _(risk: critical)_
- **context-engineering**: Optimizes agent context setup. Use when starting a new session, when agent output quality degrades, when switching between tasks, or when you need to configure rules files and context for a project. _(risk: critical)_
- **ejentum-reasoning-harness**: MCP server exposing four cognitive harness modes (reasoning, code, anti-deception, memory). Each call returns an engineered scaffold (failure pattern, procedure, suppression vectors, falsification test) the agent ingests before generating. _(risk: critical)_
- **faf-go**: Guided interview to Gold Code (100% AI-Readiness). Use when helping users improve their .faf file through questions. Leverages Claude Code's AskUserQuestion for seamless integration. Just type /faf-go and answer questions till done. _(risk: critical)_
- **hf-cli**: Curated upstream guidance for Hf Cli; use when the workflow matches the user goal. _(risk: critical)_
- **hf-mcp**: Use Hugging Face Hub via MCP server tools. Search models, datasets, Spaces, papers. Get repo details, fetch documentation, run compute jobs, and use Gradio Spaces as AI tools. Available when connected to the HF MCP server. _(risk: critical)_
- **hf-mem**: Hugging Face CLI to estimate the required memory to load Safetensors or GGUF model weights for inference from the Hugging Face Hub _(risk: critical)_
- **hugging-face-community-evals**: Run evaluations for Hugging Face Hub models using inspect-ai and lighteval on local hardware. Use for backend selection, local GPU evals, and choosing between vLLM / Transformers / accelerate. _(risk: critical)_
- **hugging-face-gradio**: Build Gradio web UIs and demos in Python. Use when creating or editing Gradio apps, components, event listeners, layouts, or chatbots. _(risk: critical)_
- **hugging-face-papers**: Look up and read Hugging Face paper pages in markdown, and use the papers API for structured metadata such as authors, linked models/datasets/spaces, Github repo and project page. _(risk: critical)_
- **hugging-face-trackio**: Track and visualize ML training experiments with Trackio. Use when logging metrics during training (Python API), firing alerts for training diagnostics, or retrieving/analyzing logged metrics (CLI). _(risk: critical)_
- **hugging-face-vision-trainer**: Train object detection, image classification, and SAM or SAM2 segmentation models locally or on Hugging Face Jobs, with bounded dataset pilots and explicit artifact persistence. _(risk: critical)_
- **huggingface-best**: Use when the user asks about finding the best, top, or recommended model for a task, wants to know what AI model to use, or wants to compare models by benchmark scores. _(risk: critical)_
- **huggingface-local-models**: Use to select models to run locally with llama.cpp and GGUF on CPU, Mac Metal, CUDA, or ROCm. Covers finding GGUFs, quant selection, running servers, exact GGUF file lookup, conversion, and OpenAI-compatible local serving. _(risk: critical)_
- **huggingface-lora-space-builder**: Build and publish a Gradio demo on Hugging Face Spaces for a user-provided LoRA. _(risk: critical)_
- **huggingface-spaces**: Build, deploy, and maintain applications on Hugging Face Spaces — Gradio / Docker / Static SDKs, ZeroGPU and dedicated hardware, model loading, debugging, buckets, inference providers, community grants. _(risk: critical)_
- **huggingface-zerogpu**: AI demos and GPU compute with Gradio Spaces and Hugging Face Spaces ZeroGPU. _(risk: critical)_
- **llm-security**: Authorized security assessment of LLM applications and AI agents: prompt injection, tool abuse, RAG exposure, memory poisoning, system-prompt extraction, and agent-compliance engineering per OWASP LLM/ASI Top 10. _(risk: offensive)_
- **loopy**: Discover, find, compare, audit, repair, adapt, craft, run, debrief, and prepare repeatable AI-agent loops for publication. _(risk: critical)_
- **manage-skills**: Discover, list, create, edit, toggle, copy, move, and delete AI agent skills across 11 tools (Cursor, Claude, Agents, Windsurf, Copilot, Codex, Cline, Aider, Continue, Roo Code, Augment) _(risk: critical)_
- **mesh-memory**: Self-hosted semantic memory for AI agents via MCP. Save worklogs, decisions, and notes, then recall them across sessions by meaning, not keyword. Postgres + pgvector with auto-tagging. _(risk: safe)_
- **mmx-cli**: Use mmx to generate text, images, video, speech, and music via the MiniMax AI platform. Use when the user wants to create media content, chat with MiniMax models, perform web search, or manage MiniMax API resources from the terminal. _(risk: critical)_
- **monte-carlo-monitoring-advisor**: Analyze data coverage, create monitors for warehouse tables and AI agents. Covers coverage gaps, use-case analysis, data monitor creation, and agent observability. _(risk: critical)_
- **moyu**: Anti-over-engineering guardrail that activates when an AI coding agent expands scope, adds abstractions, or changes files the user did not request.
 _(risk: safe)_
- **multi-agent-architect**: Design and optimize production-grade multi-agent systems with LangGraph, LangChain, and DeepAgents for complex AI workflows. _(risk: safe)_
- **neon-ai-gateway**: One API and one credential for frontier and open-source LLMs, built into your Neon branch and powered by Databricks. _(risk: critical)_
- **odw**: Dynamic multi-agent workflows — plan first, then orchestrate parallel agents with adversarial verification via the local odw daemon. Use when the user asks for a "workflow", says "ultracode", or hands you a task spanning many files/items that benefits from parallel agents. _(risk: critical)_
- **routerbase-model-gateway**: Integrate RouterBase as an OpenAI-compatible model gateway for routing GPT, Claude, Gemini, media, audio, and embedding requests. _(risk: safe)_
- **runaway-guard**: Cost-safety discipline for paid AI / inference APIs: treat $-cost as a third complexity dimension alongside time and space. Forces a written per-run $-cap, per-day $-cap, max-iterations bound, concurrency limit, and a matching provider-dashboard hard cap BEFORE any call site is written. _(risk: safe)_
- **sandbase-mcp**: Discover, inspect, and invoke 2,000+ AI models and APIs through SandBase's local MCP bridge with explicit schema and cost checks. _(risk: critical)_
- **train-sentence-transformers**: Train or fine-tune SentenceTransformer, CrossEncoder, and SparseEncoder models for retrieval, similarity, clustering, classification, reranking, and related embedding tasks. _(risk: critical)_
- **trl-training**: Train and fine-tune transformer language models using TRL (Transformers Reinforcement Learning). Supports SFT, DPO, GRPO, KTO, RLOO and Reward Model training via CLI commands. _(risk: critical)_
- **unified-ai-gateway**: Operate and evaluate Unified AI System through fifteen governed MCP tools, including provider-free prompt enhancement, while preserving fake-provider, authorization, and evidence boundaries. _(risk: critical)_
- **unslop-commit**: Rewrites commit messages so they sound like a careful human engineer wrote them. Strips AI/marketing slop ("comprehensive solution", "robust implementation", "leverage", "enhance", "seamlessly", "This commit..."). Keeps Conventional Commits format. _(risk: critical)_
- **unsloth-finetuning**: Fine-tune and post-train LLMs with Unsloth Core on a single consumer GPU: VRAM sizing, LoRA/QLoRA, GRPO/DPO, chat-template correctness, and GGUF export. _(risk: critical)_

## ai-powered seo

- **ai-blog-intro-writer**: AI Blog Intro Writer. Use when working with topic and article angle, or article draft. _(risk: safe)_
- **ai-competitor-title-rewriter**: AI Competitor Title Rewriter. Use when working with competitor title and your page topic. _(risk: safe)_
- **ai-content-detector**: AI Content Detector. Use when working with text to review. _(risk: safe)_
- **ai-content-improver**: AI Content Improver. Use when working with draft text. _(risk: safe)_
- **ai-content-outline-generator**: AI Content Outline Generator. Use when working with topic or reader question. _(risk: safe)_
- **ai-faq-creator**: AI FAQ Creator. Use when working with source content or topic. _(risk: safe)_
- **ai-keyword-explainer**: AI Keyword Explainer. Use when working with keyword or phrase. _(risk: safe)_
- **ai-meta-tag-writer**: AI Meta Tag Writer. Use when working with page copy or factual page summary. _(risk: safe)_
- **ai-schema-generator**: AI Schema Generator. Use when working with visible page content and page URL. _(risk: safe)_
- **ai-snippet-generator**: AI Snippet Generator. Use when working with question and supporting source text. _(risk: safe)_

## ai-research

- **bdistill-knowledge-extraction**: Extract structured domain knowledge from AI models in-session or from local open-source models via Ollama. No API key needed. _(risk: safe)_

## ai-testing

- **bdistill-behavioral-xray**: X-ray any AI model's behavioral patterns — refusal boundaries, hallucination tendencies, reasoning style, formatting defaults. No API key needed. _(risk: safe)_

## analysis

- **nexrad-mosaic-construction**: Construct a quality-aware NEXRAD multi-radar mosaic from aligned single-site products with explicit coverage, beam geometry, quality weighting, overlap resolution, and provenance. _(risk: safe)_
- **nexrad-radar-visualization**: Plot NEXRAD Level II/III site scans and decoded radar mosaics with correct radar geometry, map grids, units, quality masks, timestamps, and provenance. _(risk: safe)_
- **radar-satellite-analysis**: Interpret weather radar and satellite observations by validating product metadata and geometry, deriving storm and cloud structures, tracking evolution, and quantifying uncertainty. _(risk: safe)_

## andruia

- **00-andruia-consultant**: Arquitecto de Soluciones Principal y Consultor Tecnológico de Andru.ia. Diagnostica y traza la hoja de ruta óptima para proyectos de IA en español. _(risk: safe)_
- **10-andruia-skill-smith**: Ingeniero de Sistemas de Andru.ia. Diseña, redacta y despliega nuevas habilidades (skills) dentro del repositorio siguiendo el Estándar de Diamante. _(risk: safe)_
- **20-andruia-niche-intelligence**: Estratega de Inteligencia de Dominio de Andru.ia. Analiza el nicho específico de un proyecto para inyectar conocimientos, regulaciones y estándares únicos del sector. Actívalo tras definir el nicho. _(risk: safe)_

## api

- **api-design-principles**: Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers. Use when designing new APIs, reviewing API specifications, or establishing... _(risk: unknown)_
- **api-documentation-generator**: Generate comprehensive, developer-friendly API documentation from code, including endpoints, parameters, examples, and best practices _(risk: unknown)_
- **api-documenter**: Master API documentation with OpenAPI 3.1, AI-powered tools, and modern developer experience practices. Create interactive docs, generate SDKs, and build comprehensive developer portals. _(risk: unknown)_
- **api-patterns**: API design principles and decision-making. REST vs GraphQL vs tRPC selection, response formats, versioning, pagination. _(risk: unknown)_
- **graphql**: GraphQL gives clients exactly the data they need - no more, no less. One endpoint, typed schema, introspection. But the flexibility that makes it powerful also makes it dangerous. Without proper co... _(risk: unknown)_
- **openapi-spec-generation**: Generate and maintain OpenAPI 3.1 specifications from code, design-first specs, and validation patterns. Use when creating API documentation, generating SDKs, or ensuring API contract compliance. _(risk: unknown)_
- **reference-builder**: Creates exhaustive technical references and API documentation. Generates comprehensive parameter listings, configuration guides, and searchable reference materials. _(risk: unknown)_

## api-integration

- **pakistan-payments-stack**: Design and implement production-grade Pakistani payment integrations (JazzCash, Easypaisa, bank/PSP rails, optional Raast) for SaaS with PKR billing, webhook reliability, and reconciliation. _(risk: safe)_
- **2slides-ppt-generator**: AI-powered presentation generation via the 2slides API — create slides from text, match a reference image style, summarize documents into decks, add AI voice narration, and export pages/audio. Use for any "make slides", "create a deck", or "slides from this document" request. _(risk: critical)_
- **adhx**: Fetch any X/Twitter post as clean LLM-friendly JSON. Converts x.com, twitter.com, or adhx.com links into structured data with full article content, author info, and engagement metrics. No scraping or browser required. _(risk: safe)_
- **aident-loadout**: Run multi-step work across apps the user connected in Aident Loadout: live action schemas, connection checks, cost preflight, and approval before side effects. _(risk: critical)_
- **connection-auth-rules**: Build a Connection Auth Rules for a Monte Carlo connection type. Fetches live connector schemas and transform steps from the apollo-agent repo. _(risk: critical)_
- **curlshot**: Capture web page screenshots, PDFs and scrolling videos, or render HTML/Markdown to images, with the hosted CurlShot API. _(risk: safe)_
- **famulor-skill**: Operate Famulor assistants, communication history, campaigns, knowledge, automations, telephony, and workspace administration through its hosted MCP server. _(risk: critical)_
- **gemini-interactions-api**: Build with the Gemini Interactions API for text, chat, multimodal generation, streaming, managed or background agents, function calling, structured output, and generateContent migrations. _(risk: critical)_
- **gemini-live-api-dev**: Use this skill when building real-time, bidirectional streaming applications with the Gemini Live API. _(risk: critical)_
- **huggingface-tool-builder**: Use this skill when the user wants to build tool/scripts or achieve a task where using data from the Hugging Face API would help. This is especially useful when chaining or combining API calls or the task will be repeated/automated. _(risk: critical)_
- **mailtrap-sending-emails**: Configure or troubleshoot Mailtrap live email sending with Email API, SMTP, transactional streams, bulk streams, or batches. _(risk: critical)_
- **placecall**: Place real outbound phone calls to US businesses through the PlaceCall API: book, ask, get quotes, then read the outcome and transcript. _(risk: critical)_
- **postman-collection-generator**: Generate complete, import-ready Postman Collection v2.1 JSON files from natural language API descriptions or cURL commands. _(risk: critical)_
- **postman-openapi-converter**: Convert OpenAPI 3.x or Swagger 2.0 specs (YAML or JSON) into complete, import-ready Postman Collection v2.1 JSON files. _(risk: critical)_
- **riffkit**: Create short videos with Riffkit: Adapt a source formula, Swap approved footage, or generate from an idea. Use for UGC ads and localized video; requires an account and render approval. _(risk: critical)_
- **sdk-dx**: Design SDKs that developers love to use—APIs that feel native, error messages that guide, and experiences that reduce friction. This skill covers creating SDKs that drive adoption through exceptional developer experience rather than aggressive marketing. _(risk: critical)_
- **sendblue-api**: Send and receive iMessage, SMS, and RCS from application code via the Sendblue HTTP API — text, media, group messages, send styles, reactions, typing indicators, status callbacks, and inbound webhooks. _(risk: critical)_
- **sendblue-cli**: Send iMessage and SMS from the shell via the @sendblue/cli npm package — outbound sends, contact management, and account setup with no API client or webhook server required. _(risk: critical)_
- **us-property-data**: Use when a task needs real U.S. residential property data: valuation, listings, price or tax history, schools, or a zillow.com URL. _(risk: safe)_
- **youtube-full**: Fetch YouTube transcripts, search videos, browse channels, and extract playlists via TranscriptAPI — no yt-dlp, no Google API key, works from any cloud server. _(risk: safe)_
- **youtube-transcript-skills**: Fetch YouTube video transcripts, search videos/channels, browse channels, and extract playlists via the getyoutubetranscript.com API; verify current account terms. _(risk: safe)_

## app-builder

- **app-builder**: Main application building orchestrator. Creates full-stack applications from natural language requests. Determines project type, selects tech stack, coordinates agents. _(risk: unknown)_
- **templates**: Project scaffolding templates for new applications. Use when creating new projects from scratch. Contains 12 templates for various tech stacks. _(risk: unknown)_

## architecture

- **architect-review**: Master software architect specializing in modern architecture _(risk: unknown)_
- **architecture**: Architectural decision-making framework. Requirements analysis, trade-off evaluation, ADR documentation. Use when making architecture decisions or analyzing system design. _(risk: unknown)_
- **architecture-decision-records**: Write and maintain Architecture Decision Records (ADRs) following best practices for technical decision documentation. Use when documenting significant technical decisions, reviewing past architect... _(risk: unknown)_
- **cqrs-implementation**: Implement Command Query Responsibility Segregation for scalable architectures. Use when separating read and write models, optimizing query performance, or building event-sourced systems. _(risk: unknown)_
- **ddd-context-mapping**: Map relationships between bounded contexts and define integration contracts using DDD context mapping patterns. _(risk: safe)_
- **ddd-strategic-design**: Design DDD strategic artifacts including subdomains, bounded contexts, and ubiquitous language for complex business domains. _(risk: safe)_
- **ddd-tactical-patterns**: Apply DDD tactical patterns in code using entities, value objects, aggregates, repositories, and domain events with explicit invariants. _(risk: safe)_
- **docs-architect**: Creates comprehensive technical documentation from existing codebases. Analyzes architecture, design patterns, and implementation details to produce long-form technical manuals and ebooks. _(risk: unknown)_
- **domain-driven-design**: Plan and route Domain-Driven Design work from strategic modeling to tactical implementation and evented architecture patterns. _(risk: safe)_
- **event-sourcing-architect**: Expert in event sourcing, CQRS, and event-driven architecture patterns. Masters event store design, projection building, saga orchestration, and eventual consistency patterns. Use PROACTIVELY for e... _(risk: unknown)_
- **event-store-design**: Design and implement event stores for event-sourced systems. Use when building event sourcing infrastructure, choosing event store technologies, or implementing event persistence patterns. _(risk: unknown)_
- **framework-migration-code-migrate**: You are a code migration expert specializing in transitioning codebases between frameworks, languages, versions, and platforms. Generate comprehensive migration plans, automated migration scripts, and _(risk: unknown)_
- **framework-migration-legacy-modernize**: Orchestrate a comprehensive legacy system modernization using the strangler fig pattern, enabling gradual replacement of outdated components while maintaining continuous business operations through ex _(risk: unknown)_
- **full-stack-orchestration-full-stack-feature**: Use when working with full stack orchestration full stack feature _(risk: unknown)_
- **legacy-modernizer**: Refactor legacy codebases, migrate outdated frameworks, and implement gradual modernization. Handles technical debt, dependency updates, and backward compatibility. _(risk: unknown)_
- **microservices-patterns**: Design microservices architectures with service boundaries, event-driven communication, and resilience patterns. Use when building distributed systems, decomposing monoliths, or implementing micros... _(risk: unknown)_
- **monorepo-architect**: Expert in monorepo architecture, build systems, and dependency management at scale. Masters Nx, Turborepo, Bazel, and Lerna for efficient multi-project development. Use PROACTIVELY for monorepo setup, _(risk: unknown)_
- **projection-patterns**: Build read models and projections from event streams. Use when implementing CQRS read sides, building materialized views, or optimizing query performance in event-sourced systems. _(risk: unknown)_
- **saga-orchestration**: Implement saga patterns for distributed transactions and cross-aggregate workflows. Use when coordinating multi-step business processes, handling compensating transactions, or managing long-running... _(risk: unknown)_
- **seo-structure-architect**: Analyzes and optimizes content structure including header hierarchy, suggests schema markup, and internal linking opportunities. Creates search-friendly content organization. _(risk: unknown)_
- **software-architecture**: Guide for quality focused software architecture. This skill should be used when users want to write code, design architecture, analyze code, in any case that relates to software development. _(risk: unknown)_
- **wiki-architect**: Analyzes code repositories and generates hierarchical documentation structures with onboarding guides. Use when the user wants to create a wiki, generate documentation, map a codebase structure, or... _(risk: unknown)_
- **architecture-review**: Review repository architecture using Ontoly Software Graph and MCP capabilities. Use when asked to explain architecture, module boundaries, package topology, service ownership, or architectural risk. _(risk: unknown)_
- **brooks-audit**: Architecture audit that maps module dependencies, checks layering integrity, and flags structural decay across a codebase, drawing on twelve classic engineering books. _(risk: safe)_
- **codebase-design**: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary. _(risk: safe)_
- **composition-patterns**: Use when working with composition-patterns tasks or workflows _(risk: safe)_
- **dali-short-address-commissioner**: Commissions DALI and DALI-2 (IEC 62386) lighting buses: short-address assignment (0-63), 24-bit binary search collision resolution, groups, and DT8 color control. Trigger phrases: commission dali, dali short address, dali collision resolution, dali bus addressing, dali-2 setup. _(risk: critical)_
- **dependency-analysis**: Analyze internal and package dependencies using Ontoly graph traversal. Use when asked which modules, packages, services, or files depend on each other. _(risk: unknown)_
- **domain-modeling**: Build and sharpen a project's domain model. Use when the user wants to pin down domain terminology or a ubiquitous language, record an architectural decision, or when another skill needs to maintain the domain model. _(risk: safe)_
- **eol-resistor-calculator**: Calculates and validates end-of-line (EOL, SEOL, DEOL, TEOL) resistor loops for intrusion alarm panels (Honeywell, DSC, Paradox, Bosch) with wire gauge drop and state tables. Trigger phrases: eol resistor, deol wiring, alarm zone resistor, calculate end of line, double eol tamper. _(risk: safe)_
- **esl-price-sync**: Synchronizes retail prices between ERP/POS systems and Electronic Shelf Labels (SES-imagotag, ZKONG, Pricer, Hanshow, SOLUM) with delta watermarking, idempotency, and battery modeling. Trigger phrases: esl price sync, electronic shelf labels, zkong sync, ses imagotag price, ghost pricing audit. _(risk: critical)_
- **monopoly**: MONOPOLY is a Senior System Design Engineer skill for architecting, reviewing, and scaling systems. Triggers on requests involving architecture, databases, scaling, microservices, or infrastructure design. Proactively engages to design resilient backend systems.
 _(risk: critical)_
- **site-architecture**: Plan or restructure website hierarchy, navigation, URL patterns, breadcrumbs, and internal linking. Use when mapping pages, sections, and site structure, but not for XML sitemap auditing or schema markup. _(risk: safe)_

## auth

- **auth-implementation-patterns**: Master authentication and authorization patterns including JWT, OAuth2, session management, and RBAC to build secure, scalable access control systems. Use when implementing auth systems, securing A... _(risk: unknown)_
- **clerk-auth**: Expert patterns for Clerk auth implementation, middleware, organizations, webhooks, and user sync Use when: adding authentication, clerk auth, user authentication, sign in, sign up. _(risk: unknown)_

## automation

- **airtable-automation**: Automate Airtable tasks via Rube MCP (Composio): records, bases, tables, fields, views. Always search tools first for current schemas. _(risk: unknown)_
- **bamboohr-automation**: Automate BambooHR tasks via Rube MCP (Composio): employees, time-off, benefits, dependents, employee updates. Always search tools first for current schemas. _(risk: unknown)_
- **bdi-mental-states**: This skill should be used when the user asks to "model agent mental states", "implement BDI architecture", "create belief-desire-intention models", "transform RDF to beliefs", "build cognitive agent", or mentions BDI ontology, mental state modeling, rational agency, or neuro-symbolic AI integration. _(risk: unknown)_
- **billing-automation**: Build automated billing systems for recurring payments, invoicing, subscription lifecycle, and dunning management. Use when implementing subscription billing, automating invoicing, or managing recu... _(risk: unknown)_
- **biopython**: Comprehensive molecular biology toolkit. Use for sequence manipulation, file parsing (FASTA/GenBank/PDB), phylogenetics, and programmatic NCBI/PubMed access (Bio.Entrez). Best for batch processing, custom bioinformatics pipelines, BLAST automation. For quick lookups use gget;... _(risk: unknown)_
- **box-automation**: Automate Box cloud storage operations including file upload/download, search, folder management, sharing, collaborations, and metadata queries via Rube MCP (Composio). Always search tools first for... _(risk: unknown)_
- **brevo-automation**: Automate Brevo (Sendinblue) tasks via Rube MCP (Composio): manage email campaigns, create/edit templates, track senders, and monitor campaign performance. Always search tools first for current sche... _(risk: unknown)_
- **cal-com-automation**: Automate Cal.com tasks via Rube MCP (Composio): manage bookings, check availability, configure webhooks, and handle teams. Always search tools first for current schemas. _(risk: unknown)_
- **canva-automation**: Automate Canva tasks via Rube MCP (Composio): designs, exports, folders, brand templates, autofill. Always search tools first for current schemas. _(risk: unknown)_
- **changelog-automation**: Automate changelog generation from commits, PRs, and releases following Keep a Changelog format. Use when setting up release workflows, generating release notes, or standardizing commit conventions. _(risk: unknown)_
- **circleci-automation**: Automate CircleCI tasks via Rube MCP (Composio): trigger pipelines, monitor workflows/jobs, retrieve artifacts and test metadata. Always search tools first for current schemas. _(risk: unknown)_
- **coda-automation**: Automate Coda tasks via Rube MCP (Composio): manage docs, pages, tables, rows, formulas, permissions, and publishing. Always search tools first for current schemas. _(risk: unknown)_
- **confluence-automation**: Automate Confluence page creation, content search, space management, labels, and hierarchy navigation via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **convertkit-automation**: Automate ConvertKit (Kit) tasks via Rube MCP (Composio): manage subscribers, tags, broadcasts, and broadcast stats. Always search tools first for current schemas. _(risk: unknown)_
- **discord-automation**: Automate Discord tasks via Rube MCP (Composio): messages, channels, roles, webhooks, reactions. Always search tools first for current schemas. _(risk: unknown)_
- **docusign-automation**: Automate DocuSign tasks via Rube MCP (Composio): templates, envelopes, signatures, document management. Always search tools first for current schemas. _(risk: unknown)_
- **dropbox-automation**: Automate Dropbox file management, sharing, search, uploads, downloads, and folder operations via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **figma-automation**: Automate Figma tasks via Rube MCP (Composio): files, components, design tokens, comments, exports. Always search tools first for current schemas. _(risk: unknown)_
- **freshdesk-automation**: Automate Freshdesk helpdesk operations including tickets, contacts, companies, notes, and replies via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **freshservice-automation**: Automate Freshservice ITSM tasks via Rube MCP (Composio): create/update tickets, bulk operations, service requests, and outbound emails. Always search tools first for current schemas. _(risk: unknown)_
- **gmail-automation**: Interact with Gmail - search emails, read messages, send emails, create drafts, and manage labels.
Use when user asks to: search email, read email, send email, create email draft, mark as read,
archive email, star email, or manage Gmail labels. Lightweight alternative... _(risk: unknown)_
- **google-calendar-automation**: Interact with Google Calendar - list calendars, view events, create/update/delete events, and find free time.
Use when user asks to: check calendar, schedule a meeting, create an event, find available time, list upcoming events,
delete or update a calendar event, or... _(risk: unknown)_
- **google-docs-automation**: Interact with Google Docs - create documents, search by title, read content, and edit text.
Use when user asks to: create a Google Doc, find a document, read doc content, add text to a doc,
or replace text in a document. Lightweight alternative to full Google... _(risk: unknown)_
- **google-drive-automation**: Interact with Google Drive - search files, find folders, list contents, download files, upload files,
create folders, move, copy, rename, and trash files. Use when user asks to: search Google Drive,
find a file/folder, list Drive contents, download or upload files,... _(risk: unknown)_
- **google-slides-automation**: Read and write Google Slides presentations - get text, find presentations, create presentations, add slides,
replace text, and manage slide content. Use when user asks to: read a presentation, create slides, find slides,
add a slide, replace text in a presentation, or... _(risk: unknown)_
- **googlesheets-automation**: Automate Google Sheets operations (read, write, format, filter, manage spreadsheets) via Rube MCP (Composio). Read/write data, manage tabs, apply formatting, and search rows programmatically. _(risk: unknown)_
- **helpdesk-automation**: Automate HelpDesk tasks via Rube MCP (Composio): list tickets, manage views, use canned responses, and configure custom fields. Always search tools first for current schemas. _(risk: unknown)_
- **instagram-automation**: Automate Instagram tasks via Rube MCP (Composio): create posts, carousels, manage media, get insights, and publishing limits. Always search tools first for current schemas. _(risk: unknown)_
- **intercom-automation**: Automate Intercom tasks via Rube MCP (Composio): conversations, contacts, companies, segments, admins. Always search tools first for current schemas. _(risk: unknown)_
- **klaviyo-automation**: Automate Klaviyo tasks via Rube MCP (Composio): manage email/SMS campaigns, inspect campaign messages, track tags, and monitor send jobs. Always search tools first for current schemas. _(risk: unknown)_
- **make-automation**: Automate Make (Integromat) tasks via Rube MCP (Composio): operations, enums, language and timezone lookups. Always search tools first for current schemas. _(risk: unknown)_
- **microsoft-teams-automation**: Automate Microsoft Teams tasks via Rube MCP (Composio): send messages, manage channels, create meetings, handle chats, and search messages. Always search tools first for current schemas. _(risk: unknown)_
- **miro-automation**: Automate Miro tasks via Rube MCP (Composio): boards, items, sticky notes, frames, sharing, connectors. Always search tools first for current schemas. _(risk: unknown)_
- **monday-automation**: Automate Monday.com work management including boards, items, columns, groups, subitems, and updates via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **n8n-expression-syntax**: Validate n8n expression syntax and fix common errors. Use when writing n8n expressions, using {{}} syntax, accessing $json/$node variables, troubleshooting expression errors, or working with webhook data in workflows. _(risk: unknown)_
- **n8n-node-configuration**: Operation-aware node configuration guidance. Use when configuring nodes, understanding property dependencies, determining required fields, choosing between get_node detail levels, or learning common configuration patterns by node type. _(risk: unknown)_
- **n8n-validation-expert**: Interpret validation errors and guide fixing them. Use when encountering validation errors, validation warnings, false positives, operator structure issues, or need help understanding validation results. Also use when asking about validation... _(risk: unknown)_
- **n8n-workflow-patterns**: Proven workflow architectural patterns from real n8n workflows. Use when building new workflows, designing workflow structure, choosing workflow patterns, planning workflow architecture, or asking about webhook processing, HTTP API integration,... _(risk: unknown)_
- **nft-standards**: Implement NFT standards (ERC-721, ERC-1155) with proper metadata handling, minting strategies, and marketplace integration. Use when creating NFT contracts, building NFT marketplaces, or implementi... _(risk: unknown)_
- **notion-automation**: Automate Notion tasks via Rube MCP (Composio): pages, databases, blocks, comments, users. Always search tools first for current schemas. _(risk: unknown)_
- **notion-template-business**: Expert in building and selling Notion templates as a business - not just making templates, but building a sustainable digital product business. Covers template design, pricing, marketplaces, market... _(risk: unknown)_
- **odoo-automated-tests**: Write and run Odoo automated tests using TransactionCase, HttpCase, and browser tour tests. Covers test data setup, mocking, and CI integration. _(risk: safe)_
- **odoo-shopify-integration**: Connect Odoo with Shopify: sync products, inventory, orders, and customers using the Shopify API and Odoo's external API or connector modules. _(risk: unknown)_
- **one-drive-automation**: Automate OneDrive file management, search, uploads, downloads, sharing, permissions, and folder operations via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **outlook-automation**: Automate Outlook tasks via Rube MCP (Composio): emails, calendar, contacts, folders, attachments. Always search tools first for current schemas. _(risk: unknown)_
- **outlook-calendar-automation**: Automate Outlook Calendar tasks via Rube MCP (Composio): create events, manage attendees, find meeting times, and handle invitations. Always search tools first for current schemas. _(risk: unknown)_
- **payment-integration**: Integrate Stripe, PayPal, and payment processors. Handles checkout flows, subscriptions, webhooks, and PCI compliance. Use PROACTIVELY when implementing payments, billing, or subscription features. _(risk: unknown)_
- **paypal-integration**: Integrate PayPal payment processing with support for express checkout, subscriptions, and refund management. Use when implementing PayPal payments, processing online transactions, or building e-com... _(risk: unknown)_
- **plaid-fintech**: Expert patterns for Plaid API integration including Link token flows, transactions sync, identity verification, Auth for ACH, balance checks, webhook handling, and fintech compliance best practices... _(risk: unknown)_
- **postmark-automation**: Automate Postmark email delivery tasks via Rube MCP (Composio): send templated emails, manage templates, monitor delivery stats and bounces. Always search tools first for current schemas. _(risk: unknown)_
- **prompt-engineer**: Transforms user prompts into optimized prompts using frameworks (RTF, RISEN, Chain of Thought, RODES, Chain of Density, RACE, RISE, STAR, SOAP, CLEAR, GROW) _(risk: safe)_
- **reddit-automation**: Automate Reddit tasks via Rube MCP (Composio): search subreddits, create posts, manage comments, and browse top content. Always search tools first for current schemas. _(risk: unknown)_
- **render-automation**: Automate Render tasks via Rube MCP (Composio): services, deployments, projects. Always search tools first for current schemas. _(risk: unknown)_
- **robius-matrix-integration**: CRITICAL: Use for Matrix SDK integration with Makepad. Triggers on:
Matrix SDK, sliding sync, MatrixRequest, timeline,
matrix-sdk, matrix client, robrix, matrix room,
Matrix 集成, 聊天客户端 _(risk: unknown)_
- **sentry-automation**: Automate Sentry tasks via Rube MCP (Composio): manage issues/events, configure alerts, track releases, monitor projects and teams. Always search tools first for current schemas. _(risk: unknown)_
- **shopify-automation**: Automate Shopify tasks via Rube MCP (Composio): products, orders, customers, inventory, collections. Always search tools first for current schemas. _(risk: unknown)_
- **slack-gif-creator**: Knowledge and utilities for creating animated GIFs optimized for Slack. Provides constraints, validation tools, and animation concepts. Use when users request animated GIFs for Slack like "... _(risk: unknown)_
- **social-orchestrator**: Orquestrador unificado de canais sociais — coordena Instagram, Telegram e WhatsApp em um unico fluxo de trabalho. Publicacao cross-channel, metricas unificadas, reutilizacao de conteudo por... _(risk: critical)_
- **square-automation**: Automate Square tasks via Rube MCP (Composio): payments, orders, invoices, locations. Always search tools first for current schemas. _(risk: unknown)_
- **sred-work-summary**: Go back through the previous year of work and create a Notion doc that groups relevant links into projects that can then be documented as SRED projects. _(risk: unknown)_
- **stripe-automation**: Automate Stripe tasks via Rube MCP (Composio): customers, charges, subscriptions, invoices, products, refunds. Always search tools first for current schemas. _(risk: unknown)_
- **stripe-integration**: Implement Stripe payment processing for robust, PCI-compliant payment flows including checkout, subscriptions, and webhooks. Use when integrating Stripe payments, building subscription systems, or ... _(risk: unknown)_
- **telegram-automation**: Automate Telegram tasks via Rube MCP (Composio): send messages, manage chats, share photos/documents, and handle bot commands. Always search tools first for current schemas. _(risk: unknown)_
- **telegram-bot-builder**: Expert in building Telegram bots that solve real problems - from simple automation to complex AI-powered bots. Covers bot architecture, the Telegram Bot API, user experience, monetization strategie... _(risk: unknown)_
- **telegram-mini-app**: Expert in building Telegram Mini Apps (TWA) - web apps that run inside Telegram with native-like experience. Covers the TON ecosystem, Telegram Web App API, payments, user authentication, and build... _(risk: unknown)_
- **todoist-automation**: Automate Todoist task management, projects, sections, filtering, and bulk operations via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **trello-automation**: Automate Trello boards, cards, and workflows via Rube MCP (Composio). Create cards, manage lists, assign members, and search across boards programmatically. _(risk: unknown)_
- **twilio-communications**: Build communication features with Twilio: SMS messaging, voice calls, WhatsApp Business API, and user verification (2FA). Covers the full spectrum from simple notifications to complex IVR systems a... _(risk: unknown)_
- **twitter-automation**: Automate Twitter/X tasks via Rube MCP (Composio): posts, search, users, bookmarks, lists, media. Always search tools first for current schemas. _(risk: unknown)_
- **unsplash-integration**: Integration skill for searching and fetching high-quality, free-to-use professional photography from Unsplash. _(risk: safe)_
- **web3-testing**: Test smart contracts comprehensively using Hardhat and Foundry with unit tests, integration tests, and mainnet forking. Use when testing Solidity contracts, setting up blockchain test suites, or va... _(risk: unknown)_
- **webflow-automation**: Automate Webflow CMS collections, site publishing, page management, asset uploads, and ecommerce orders via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **whatsapp-automation**: Automate WhatsApp Business tasks via Rube MCP (Composio): send messages, manage templates, upload media, and handle contacts. Always search tools first for current schemas. _(risk: unknown)_
- **workflow-automation**: Workflow automation is the infrastructure that makes AI agents reliable. Without durable execution, a network hiccup during a 10-step payment flow means lost money and angry customers. With it, wor... _(risk: unknown)_
- **yes-md**: 6-layer AI governance: safety gates, evidence-based debugging, anti-slack detection, and machine-enforced hooks. Makes AI safe, thorough, and honest. _(risk: safe)_
- **zapier-make-patterns**: No-code automation democratizes workflow building. Zapier and Make (formerly Integromat) let non-developers automate business processes without writing code. But no-code doesn't mean no-complexity ... _(risk: unknown)_
- **zendesk-automation**: Automate Zendesk tasks via Rube MCP (Composio): tickets, users, organizations, replies. Always search tools first for current schemas. _(risk: unknown)_
- **apify-generate-output-schema**: Generate output schemas (dataset_schema.json, output_schema.json, key_value_store_schema.json) for an Apify Actor by analyzing its source code. Use when creating or updating Actor output schemas. _(risk: critical)_
- **apify-integration-development**: Curated upstream guidance for Apify Integration Development; use when the workflow matches the user goal. _(risk: critical)_
- **auto-research**: Research uncertain questions with an explicit, user-approved web search or ChatGPT consultation, then present options and wait for implementation approval. _(risk: critical)_
- **browser-bridge**: Inspect, control, and automate tasks in your real Microsoft Edge or Google Chrome browser via Chrome DevTools Protocol (CDP) with bilingual UI, native tab grouping, and self-healing daemon. _(risk: critical)_
- **flowhunt-skill**: Automation discovery audit skill. Walks through a 5-question workflow intake, then audits Gmail/Calendar/Slack/task trackers to identify automation opportunities. Use when a user wants to discover what processes in their business can be automated. _(risk: safe)_
- **google-no-code**: Design Google Forms and wire Apps Script triggers (onFormSubmit) for email alerts, spreadsheet logging, and dynamic questions — no code editor required. _(risk: critical)_
- **n8n-agents**: Design n8n AI agents, chains, classifiers, extractors, tool calling, memory, RAG, structured output, and human-review flows. _(risk: critical)_
- **n8n-binary-and-data**: Handle n8n files and binary data across uploads, downloads, transforms, multimodal inputs, agent tools, and chat surfaces. _(risk: critical)_
- **n8n-code-tool**: Write and debug JavaScript or Python for the AI-callable n8n Custom Code Tool, including schemas, sandbox limits, and return formats. _(risk: critical)_
- **n8n-error-handling**: Design visible, structured, recoverable n8n failures using error outputs, retries, Error Trigger workflows, and HTTP error responses. _(risk: critical)_
- **n8n-multi-instance**: Select, verify, and safely switch n8n MCP instances across production, staging, teams, or clients, especially before credential writes. _(risk: critical)_
- **n8n-subworkflows**: Build reusable n8n sub-workflows with typed inputs, all-vs-each execution, discoverable naming, and agent-tool exposure. _(risk: critical)_
- **sendblue-notify**: Text the user's phone when a long-running task, agent turn, or scheduled job finishes — via @sendblue/cli for outbound, optionally wired to a Claude Code Stop hook for automatic fire. _(risk: critical)_
- **smart-git-automation**: Smart change detection, auto branch naming, and streamlined commit/PR workflow _(risk: critical)_
- **textme**: Text Claude from your phone — set up the njerschow/textme daemon so inbound iMessages drive a Claude Code session on your laptop, with voice notes, image input, code execution, and a phone-number whitelist. _(risk: critical)_
- **using-n8n-mcp-skills**: Route n8n MCP workflow design, editing, validation, testing, deployment, credential, execution, and debugging tasks to specialist guidance. _(risk: critical)_

## backend

- **architecture-patterns**: Implement proven backend architecture patterns including Clean Architecture, Hexagonal Architecture, and Domain-Driven Design. Use when architecting complex backend systems or refactoring existing ... _(risk: unknown)_
- **backend-architect**: Expert backend architect specializing in scalable API design, microservices architecture, and distributed systems. _(risk: unknown)_
- **backend-dev-guidelines**: Opinionated backend development standards for Node.js + Express + TypeScript microservices. Covers layered architecture, BaseController pattern, dependency injection, Prisma repositories, Zod valid... _(risk: unknown)_
- **backend-development-feature-development**: Orchestrate end-to-end backend feature development from requirements to deployment. Use when coordinating multi-phase feature delivery across teams and services. _(risk: unknown)_
- **bullmq-specialist**: BullMQ expert for Redis-backed job queues, background processing, and reliable async execution in Node.js/TypeScript applications. Use when: bullmq, bull queue, redis queue, background job, job queue. _(risk: unknown)_
- **bun-development**: Modern JavaScript/TypeScript development with Bun runtime. Covers package management, bundling, testing, and migration from Node.js. Use when working with Bun, optimizing JS/TS development speed, o... _(risk: unknown)_
- **comfyui-gateway**: REST API gateway for ComfyUI servers. Workflow management, job queuing, webhooks, caching, auth, rate limiting, and image delivery (URL + base64). _(risk: safe)_
- **convex**: Convex reactive backend expert: schema design, TypeScript functions, real-time subscriptions, auth, file storage, scheduling, and deployment. _(risk: safe)_
- **copilot-sdk**: Build applications powered by GitHub Copilot using the Copilot SDK. Use when creating programmatic integrations with Copilot across Node.js/TypeScript, Python, Go, or .NET. Covers session managemen... _(risk: unknown)_
- **django-access-review**: django-access-review _(risk: unknown)_
- **django-perf-review**: Django performance code review. Use when asked to "review Django performance", "find N+1 queries", "optimize Django", "check queryset performance", "database performance", "Django ORM issues", or audit Django code for performance problems. _(risk: unknown)_
- **django-pro**: Master Django 5.x with async views, DRF, Celery, and Django Channels. Build scalable web applications with proper architecture, testing, and deployment. _(risk: unknown)_
- **dotnet-architect**: Expert .NET backend architect specializing in C#, ASP.NET Core, Entity Framework, Dapper, and enterprise application patterns. _(risk: unknown)_
- **dotnet-backend**: Build ASP.NET Core 8+ backend services with EF Core, auth, background jobs, and production API patterns. _(risk: safe)_
- **dotnet-backend-patterns**: Master C#/.NET backend development patterns for building robust APIs, MCP servers, and enterprise applications. Covers async/await, dependency injection, Entity Framework Core, Dapper, configuratio... _(risk: unknown)_
- **fastapi-pro**: Build high-performance async APIs with FastAPI, SQLAlchemy 2.0, and Pydantic V2. Master microservices, WebSockets, and modern Python async patterns. _(risk: unknown)_
- **fastapi-router-py**: Create FastAPI routers with CRUD operations, authentication dependencies, and proper response models. Use when building REST API endpoints, creating new routes, implementing CRUD operations, or add... _(risk: unknown)_
- **fastapi-templates**: Create production-ready FastAPI projects with async patterns, dependency injection, and comprehensive error handling. Use when building new FastAPI applications or setting up backend API projects. _(risk: unknown)_
- **fp-backend**: Functional programming patterns for Node.js/Deno backend development using fp-ts, ReaderTaskEither, and functional dependency injection _(risk: unknown)_
- **hubspot-integration**: Expert patterns for HubSpot CRM integration including OAuth authentication, CRM objects, associations, batch operations, webhooks, and custom objects. Covers Node.js and Python SDKs. Use when: hubs... _(risk: unknown)_
- **javascript-pro**: Master modern JavaScript with ES6+, async patterns, and Node.js APIs. Handles promises, event loops, and browser/Node compatibility. _(risk: unknown)_
- **junta-leiloeiros**: Coleta e consulta dados de leiloeiros oficiais de todas as 27 Juntas Comerciais do Brasil. Scraper multi-UF, banco SQLite, API FastAPI e exportacao CSV/JSON. _(risk: safe)_
- **m365-agents-ts**: Microsoft 365 Agents SDK for TypeScript/Node.js. _(risk: unknown)_
- **new-rails-project**: Create a new Rails project _(risk: unknown)_
- **nodejs-backend-patterns**: Build production-ready Node.js backend services with Express/Fastify, implementing middleware patterns, error handling, authentication, database integration, and API design best practices. Use when... _(risk: unknown)_
- **odoo-woocommerce-bridge**: Sync Odoo with WooCommerce: products, inventory, orders, and customers via WooCommerce REST API and Odoo external API. _(risk: unknown)_
- **php-pro**: Write idiomatic PHP code with generators, iterators, SPL data
structures, and modern OOP features. Use PROACTIVELY for high-performance PHP
applications.
 _(risk: unknown)_
- **polars**: Fast in-memory DataFrame library for datasets that fit in RAM. Use when pandas is too slow but data still fits in memory. Lazy evaluation, parallel execution, Apache Arrow backend. Best for 1-100GB datasets, ETL pipelines, faster pandas replacement. For larger-than-RAM data use dask or vaex. _(risk: unknown)_
- **pubmed-database**: Direct REST API access to PubMed. Advanced Boolean/MeSH queries, E-utilities API, batch processing, citation management. For Python workflows, prefer biopython (Bio.Entrez). Use this for direct HTTP/REST work or custom API implementations. _(risk: unknown)_
- **python-development-python-scaffold**: You are a Python project architecture expert specializing in scaffolding production-ready Python applications. Generate complete project structures with modern tooling (uv, FastAPI, Django), type hint _(risk: unknown)_
- **python-pro**: Master Python 3.12+ with modern features, async programming, performance optimization, and production-ready practices. Expert in the latest Python ecosystem including uv, ruff, pydantic, and FastAPI. _(risk: unknown)_
- **ruby-pro**: Write idiomatic Ruby code with metaprogramming, Rails patterns, and performance optimization. Specializes in Ruby on Rails, gem development, and testing frameworks. _(risk: unknown)_
- **segment-cdp**: Expert patterns for Segment Customer Data Platform including Analytics.js, server-side tracking, tracking plans with Protocols, identity resolution, destinations configuration, and data governance ... _(risk: unknown)_
- **skill-rails-upgrade**: Analyze Rails apps and provide upgrade assessments _(risk: safe)_
- **telegram**: Integracao completa com Telegram Bot API. Setup com BotFather, mensagens, webhooks, inline keyboards, grupos, canais. Boilerplates Node.js e Python. _(risk: critical)_
- **uniprot-database**: Direct REST API access to UniProt. Protein searches, FASTA retrieval, ID mapping, Swiss-Prot/TrEMBL. For Python workflows with multiple databases, prefer bioservices (unified interface to 40+ services). Use this for direct HTTP/REST work or UniProt-specific control. _(risk: unknown)_
- **whatsapp-cloud-api**: Integracao com WhatsApp Business Cloud API (Meta). Mensagens, templates, webhooks HMAC-SHA256, automacao de atendimento. Boilerplates Node.js e Python. _(risk: critical)_
- **api-analyzer**: Validates whether an API request is correct based on provided inputs (method, URL, headers, body, auth, query params).
- **api-and-interface-design**: Guides stable API and interface design. Use when designing APIs, module boundaries, or any public interface. Use when creating REST or GraphQL endpoints, defining type contracts between modules, or establishing boundaries between frontend and backend.
- **api-designer**: Generates complete, production-ready REST API endpoint specifications for any system or domain the user describes. _(risk: safe)_
- **api-integration**: Designs event-driven architectures, webhook systems, API chaining flows, ETL pipelines, and integration patterns between services.
- **api-integration-architect**: Design, implement, debug, and optimize API integrations with expert-level patterns for REST, GraphQL, webhooks, and authentication flows. _(risk: unknown)_
- **api-onboarding**: Reduce time-to-first-API-call (TTFAC) by optimizing every step of the developer onboarding journey. This skill covers authentication simplification, sandbox environments, interactive documentation, and identifying and eliminating common failure points. _(risk: critical)_
- **api-sdk-generator**: Generates client SDK code, API wrapper libraries, request/response models, and language-specific usage patterns for any REST API. _(risk: critical)_
- **api-security**: Authorized security assessment of REST, GraphQL, WebSocket, and SOAP APIs: discovery, authentication and authorization flaws (BOLA/IDOR, JWT/OAuth), rate-limit testing, and a structured multi-phase methodology. _(risk: offensive)_
- **atlas-contract**: Goal-integrity skill. Use for backend/API/persistence, preserve/do-not-change, tests/validation, mocks, rework, multi-part requests. Emits Goal Contracts, Deviation Notices, Phase Checks, Final Audits. Skip for Q&A or trivial edits. _(risk: critical)_
- **cohesivity**: Provision headless backend services for AI agents through Cohesivity: hosting, databases, storage, LLMs, and third-party APIs over one HTTP API. Use when a trusted .cohesivity file exists or the user approves a new backend. _(risk: critical)_
- **graphql-schema**: GraphQL queries, mutations, and code generation patterns. Use when creating GraphQL operations, working with Apollo Client, or generating types. _(risk: critical)_
- **hono**: Build ultra-fast web APIs and full-stack apps with Hono — runs on Cloudflare Workers, Deno, Bun, Node.js, and any WinterCG-compatible runtime. _(risk: critical)_
- **neon-functions**: Long-running, serverless Node.js HTTP functions deployed onto your Neon branch, with DATABASE_URL injected automatically and compute that runs next to your data. _(risk: critical)_
- **openapi-spec-generator**: Generate complete, production-ready OpenAPI 3.x and Swagger 2.0 specifications from natural language descriptions, code, or partial specs. _(risk: critical)_
- **supabase**: Use when doing ANY task involving Supabase. _(risk: critical)_
- **upstash-ratelimit**: Add rate limiting to API routes, middleware, and edge functions with @upstash/ratelimit: sliding window, fixed window, and token bucket backed by Upstash Redis. _(risk: critical)_
- **upstash-redis**: Use the @upstash/redis HTTP client for caching, sessions, counters, and Redis data structures from serverless and edge runtimes without connection pooling. _(risk: critical)_
- **x402-express-wrapper**: Wrapper oficial de M2MCent (Node.js) para inyectar muros de pago x402 en APIs o servidores Model Context Protocol (MCP). Usar al construir nuevos servicios que requieran monetización máquina a máquina. _(risk: critical)_

## backlink & link-building

- **anchor-text-analyzer**: Anchor Text Analyzer. Use when working with links with anchor text and destinations. _(risk: safe)_
- **backlink-idea-generator**: Backlink Idea Generator. Use when working with site topic and target audience. _(risk: safe)_
- **backlink-tracking-template-generator**: Backlink Tracking Template Generator. Use when working with tracking goal; existing rows optional. _(risk: safe)_
- **domain-authority-simulator**: Domain Authority Simulator. Use when working with domain signals and an explicit scoring rubric. _(risk: safe)_
- **guest-posting-opportunity-finder**: Guest Posting Opportunity Finder. Use when working with topic, audience and optional prospect list. _(risk: safe)_
- **link-relevance-evaluator**: Link Relevance Evaluator. Use when working with source page context and destination page context. _(risk: safe)_
- **link-source-categorizer**: Link Source Categorizer. Use when working with backlink rows with source URLs and optional page context. _(risk: safe)_
- **link-toxicity-checker**: Link Toxicity Checker. Use when working with backlink examples and available evidence. _(risk: safe)_
- **outreach-email-template-generator**: Outreach Email Template Generator. Use when working with recipient context, outreach purpose and genuine offer. _(risk: safe)_

## blockchain

- **chord-onchain-trading**: Read DEX market data and prepare best-route swap quotes and unsigned swap transactions on eight EVM chains with the Chord API. Never signs or moves funds. _(risk: critical)_
- **maxia**: Connect to MAXIA AI-to-AI marketplace on Solana. Discover, buy, sell AI services. Earn USDC. 13 MCP tools, A2A protocol, DeFi yields, sentiment analysis, rug detection. _(risk: critical)_
- **meteora-dlmm-pool-screening**: Screen and rank Meteora DLMM pools for LP quality using public Meteora APIs (fee/TVL, bin step, organic score). Read-only: never deploys, swaps, or signs.
 _(risk: critical)_
- **moltnode-chain-reader**: Read 31 blockchains over keyless JSON-RPC with MoltNode (balances, blocks, contract calls) and get Chord swap quotes with an unsigned transaction and simulation. _(risk: critical)_

## blockchain-web3

- **blockchain-developer**: Build production-ready Web3 applications, smart contracts, and decentralized systems. Implements DeFi protocols, NFT platforms, DAOs, and enterprise blockchain integrations. _(risk: unknown)_
- **defi-protocol-templates**: Implement DeFi protocols with production-ready templates for staking, AMMs, governance, and lending systems. Use when building decentralized finance applications or smart contract protocols. _(risk: unknown)_
- **emblemai-crypto-wallet**: Crypto wallet management across 7 blockchains via EmblemAI Agent Hustle API. Balance checks, token swaps, portfolio analysis, and transaction execution for Solana, Ethereum, Base, BSC, Polygon, Hedera, and Bitcoin. _(risk: critical)_

## browser-automation

- **browser-act**: Use BrowserAct for authenticated browser automation, JS-rendered extraction, screenshots, parallel sessions, verification handling, and human handoff. _(risk: critical)_
- **browser-harness**: Drive an existing browser through CDP for authenticated, visual, or interactive web automation. _(risk: critical)_
- **hasdata**: Use HasData APIs for web scraping and structured web data extraction. _(risk: critical)_
- **hasdata-cli**: Command-line access to search, scraping, and structured web data. _(risk: critical)_
- **jet-browser**: Verify or integrate Jet Browser when a project needs isolated WPE WebKit sessions, native input, screenshots, ordered JSONL automation, or reproducible runtime checks. _(risk: critical)_
- **puppeteer-skill**: Generates Puppeteer scripts for browser automation, scraping, and PDF generation. Triggers on: "Puppeteer", "headless Chrome", "page.goto", "scrape", "PDF generation". _(risk: critical)_
- **reverse-browser-automation**: Automate browsers (Playwright) and Windows desktop applications (UI automation) for reverse-engineering evidence collection, UI-driven workflows, and network observation during analysis. _(risk: offensive)_
- **skyvern-browser-automation**: AI-powered browser automation — navigate sites, fill forms, extract structured data, log in with stored credentials, and build reusable workflows. _(risk: safe)_

## business

- **lex**: Centralized 'Truth Engine' for cross-jurisdictional legal context (US, EU, CA) and contract scaffolding. _(risk: safe)_
- **360-feedback-system**: 360 feedback register: reviewer, subject, review cycle, visibility, due date and score, as CSV, SQL, JSON Schema or Notion on request. Use for 360 reviews or peer feedback cycles. _(risk: safe)_
- **access-matrix**: Access matrix of role-by-module permissions, with per-role scope, confidentiality level and SME tier, as CSV, SQL, JSON Schema or Notion on request. Use for access reviews. _(risk: safe)_
- **accounting-audit-system-builder**: Routes an accounting or audit request to the right module skill, from software selection through monthly closing, asking only what is missing. Use for books of accounts or audit files. _(risk: safe)_
- **accounting-software-selection**: Scores shortlisted accounting packages against 57 evidence-backed fields, emitted as CSV, SQL, JSON Schema or Notion on request. Use for choosing accounting software. _(risk: safe)_
- **admin-access-register**: Admin account register: system, main and backup admin, seats, plan, 2FA, shared logins and access-review dates, as CSV, SQL, JSON Schema or Notion on request. Use for access reviews. _(risk: safe)_
- **advanced-analytics-dashboard**: Dashboard metric register: metric, source module, formula, period, value, target, trend, owner and last-updated, as CSV, SQL, JSON Schema or Notion on request. Use for KPI dashboards. _(risk: safe)_
- **alumni-re-hire-tracker**: Alumni and re-hire register: former role, last working day, re-hire eligibility, current employer and re-engagement date, as CSV, SQL, JSON Schema or Notion on request. Use for alumni outreach. _(risk: safe)_
- **announcement-board**: Announcement board: author, category, department, priority, audience, publish and expiry dates, status and acknowledgements, as CSV, SQL, JSON Schema or Notion on request. Use for internal notices. _(risk: safe)_
- **asset-it-management**: Asset and IT register: serial, model, condition, assignee, location, purchase value, warranty expiry and return date, as CSV, SQL, JSON Schema or Notion on request. Use for asset audits. _(risk: safe)_
- **attendance**: Daily attendance register: check-in and check-out, hours worked, work mode, late minutes, leave and regularisation flags, as CSV, SQL, JSON Schema or Notion on request. Use for payroll input. _(risk: safe)_
- **audit-log**: Audit trail register: timestamp, user, module, record, action, field changed, old and new value, and the reason for the change. Use for change history and control evidence. _(risk: safe)_
- **audit-preparation**: Audit preparation register: required document, period covered, request and receipt dates, preparer and reviewer, auditor queries and adjustments. Use for assembling an audit file. _(risk: safe)_
- **board-governance**: Board and governance register: meeting date, agenda, decision, resolution number, vote result, action owner and due date. Use for board packs and action tracking. _(risk: safe)_
- **brand-growth-system-builder**: Route requests across 13 brand and growth modules. Use when an SME needs help choosing branding, website, local SEO, content, or cloud-planning workflows. _(risk: safe)_
- **brand-kit-print-collateral**: Print collateral spec: item, finished/trim size and artwork size including bleed, bleed, colour mode, stock and GSM, finish, safe margin, print method, quantity and unit cost. Use for cards and letterhead. _(risk: safe)_
- **buddy-program-manager**: Buddy programme register: new hire, assigned buddy, department, start and end dates, check-ins planned and done, and feedback score. Use for onboarding buddy schemes. _(risk: safe)_
- **budget-cash-flow**: Budget against actual by department, category and period, with budget and actual amounts, variance, percentage used and linked expenses. Use for budget tracking or cash-flow reviews. _(risk: safe)_
- **business-email-template**: Business email template register: trigger, sender and recipient type, subject pattern, body structure, personalisation tokens and send checks. Use for repeatable outbound email. _(risk: safe)_
- **business-website-setup**: Website page register: URL, title, meta description, search intent, NAP block, schema type, canonical, indexability and Core Web Vitals target. Use for site builds and SEO reviews. _(risk: safe)_
- **candidate-talent-pool**: Candidate and prospect pool: contact details, experience, skills, consent status and date, referral source and last contact. Use for talent pipelines and re-engagement. _(risk: safe)_
- **capacity-workload-planner**: Weekly capacity and workload register: available and allocated hours, utilisation percentage, over-allocation check and leave days. Use for resource planning. _(risk: safe)_
- **clients-accounts**: Client and account register: contacts, billing address, tax ID and basis, payment terms, invoice totals, amounts paid and outstanding balance. Use for account tracking. _(risk: safe)_
- **code-of-conduct**: Build a human-reviewed conduct register after context-first intake. Use when an SME needs policy acknowledgements, complaint handling, and breach follow-up. _(risk: safe)_
- **company-email-accounts**: Mailbox and licence register: employee, account type, aliases, groups, tool, licence cost, 2FA and password policy state, and access-review dates. Use for account provisioning. _(risk: safe)_
- **competency-matrix**: Competency matrix of expected proficiency by job title and grade, with assessment method and linked skill area. Use for role frameworks and hiring bars. _(risk: safe)_
- **contract-document-renewal**: Contract register: counterparty, owner, start and end dates, auto-renewal flag, renewal notice deadline, value and tax basis. Use for renewal tracking and notice deadlines. _(risk: safe)_
- **course-upskilling-requests**: Training request register: course, provider, cost, duration, budget line, the three approval steps, service bond and completion evidence. Use for upskilling approvals. _(risk: safe)_
- **credit-cycle-analysis**: Debtor and creditor credit-cycle analysis: weighted collection or payment days, ageing buckets, credit limit utilisation and gap against benchmark. Use for working-capital review. _(risk: safe)_
- **crossframe-org**: Use when CrossFrame Suite routes explicit Chinese analysis of teams, projects, organizations, responsibility chains, feedback write-back, repair, or retrospectives. _(risk: safe)_
- **csv-manual-export**: CSV Manual Export: a UTF-8 CSV template from a confirmed field list, empty by default, with no invented columns or values. Use for an import, staging or handoff file. _(risk: safe)_
- **culture-retention**: Employee survey and retention register: engagement, growth, happiness, work-life balance and manager-relationship scores, key concern and retention risk. Use for culture surveys. _(risk: safe)_
- **data-export-engine**: Data export log: source module, purpose, format, requester and approver, delivery dates, personal-data flag and status. Use for export audit trails. _(risk: safe)_
- **data-privacy-controls**: Data privacy control register: data category, lawful basis, retention period, access roles, encryption and consent requirement per module. Use for GDPR compliance. _(risk: safe)_
- **day-book**: Daily cash, bank and digital day book: opening and closing balances per book, in/out movements, debit/credit presentation and reconciliation status. Use for daily bookkeeping. _(risk: safe)_
- **dei-dashboard**: Diversity, equity and inclusion dashboard: metric by department and period, value against target, group size and minimum-threshold flag. Use for DEI reporting. _(risk: safe)_
- **design-theme-guide**: Design-token register: colour, typography, spacing and radius tokens with light and dark values, contrast ratio and WCAG level. Use for design system documentation. _(risk: safe)_
- **disciplinary-pip-tracker**: Disciplinary and performance-improvement case register: case type, linked review or issue, improvement goals, review dates, outcome and confidentiality. Use for PIP tracking. _(risk: safe)_
- **document-management-system**: Document register: type, owner, upload and signed dates, version, storage link, confidentiality and signature-required flag. Use for document control. _(risk: safe)_
- **employee-suggestion-hub**: Suggestion register: submitter or anonymous flag, category, votes, reviewer, decision and response status. Use for employee feedback programs. _(risk: safe)_
- **esop-equity-tracker**: ESOP and equity grant register: grant date, shares granted, strike price, vesting start, schedule and cliff, plus vested and exercised shares. Use for equity tracking. _(risk: safe)_
- **event-staffing-ordering**: Order W-2 compliant temporary event staff for conventions, trade shows, festivals, concerts, sporting events, and brand activations across 300+ US and Canadian markets via TempGuru. Covers city coverage, role pricing, availability, state compliance lookups via MCP, and request submission. _(risk: safe)_
- **events-activities**: Event register: type, date and time, venue, organizer, audience, budget against actual cost, RSVP and attendance counts and feedback score. Use for event tracking. _(risk: safe)_
- **expense-accounting**: Expense accounting register: expense number and date, payee with PAN and VAT, bill reference, document type, amount with VAT, ledger account, approver and status. Use for expense bookkeeping. _(risk: safe)_
- **expense-management**: Expense claim register: claim id, employee and department, amount and tax, approver and level, category, cost centre, budget line, receipt flag and status. Use for claim approvals. _(risk: safe)_
- **gamification-engine**: Gamification points register: player and department, points balance and points earned this month, level, badges, source module and last-updated date. Use for points and badge tracking. _(risk: safe)_
- **gbp-local-seo-intent**: Google Business Profile register: element, primary and supporting keywords, search intent, landing page, post dates, review rating and reply status, visibility and status. Use for local SEO. _(risk: safe)_
- **health-wellness**: Wellbeing check-in register: anonymous flag, department, check-in date, wellbeing score, stress and energy levels, support and resource flags, confidentiality and status. Use for wellness programmes. _(risk: safe)_
- **intern-program**: Internship register: intern and department, supervisor and mentor, institution, start and end dates, stipend, learning goals, mid-term and final scores, conversion flags. Use for intern tracking. _(risk: safe)_
- **internal-communication**: Internal communication log: title, type, date, department, host and attendees, agenda, action items, follow-up date, meeting link and delivery status. Use for internal comms tracking. _(risk: safe)_
- **inventory-stock-reconciliation**: Stock reconciliation register: count date, item, warehouse, book vs physical quantity, variance quantity and value, variance reason, damage and expiry, adjustment and approval. Use for stock counts. _(risk: safe)_
- **invoices-billing**: Invoice and billing register: invoice number, client, project, issue and due dates, subtotal, discount, tax and withholding, total, payments, balance and aging. Use for billing follow-up. _(risk: safe)_
- **issue-grievance-tracker**: Grievance register: issue type, raised by or anonymous, person or team concerned, department, date raised, policy reference, severity, assignee, action taken and status. Use for complaint handling. _(risk: safe)_
- **it-manager-pro**: Elite IT Management Advisor specializing in data-driven strategy, executive communication, and human-centric leadership for the 2026 digital era. _(risk: safe)_
- **json-schema-manual**: JSON Schema Manual: draft 2020-12 validation schema from a confirmed field list, with required and enum values only where confirmed. Use for an API or import contract. _(risk: safe)_
- **knowledge-base**: Knowledge base register: article title, category, department, owner, tags, summary, linked SOP, audience, last and next review dates and status. Use for documentation management. _(risk: safe)_
- **kpi-tracker**: KPI register: metric by level, department, job title and employee, linked OKR, unit and direction, target against actual, achievement and weight percentages, period and owner. Use for scorecards. _(risk: safe)_
- **learning-career-development**: Training register: course, provider, delivery method, department, employee, duration, progress percentage, score, mandatory flag, certificate earned and skills gained. Use for learning records. _(risk: safe)_
- **leave-management**: Leave register: request, leave type, employee and department, manager and approver, start and end dates, days requested, leave balances, handover notes and status. Use for leave tracking. _(risk: safe)_
- **legal-compliance-vault**: Legal and compliance document vault: document type, framework, owner and department, effective and expiry dates, renewal flag, storage link, confidentiality and status. Use for policy tracking. _(risk: safe)_
- **linktree-link-hub**: Link-in-bio register: label, destination URL, link type, priority order, audience, click tracking, UTM source, schedule, click count and status. Use for link hub tracking. _(risk: safe)_
- **logo-image-design**: Brand asset register: asset type, format, dimensions and aspect ratio, colour mode, background variant, clear space, approved and prohibited uses, rights owner and licence. Use for brand control. _(risk: safe)_
- **mentorship-program**: Mentorship register: mentor and mentee pair, department, focus area, mentee goal, session counts, last and next session, overall rating, progress notes and status. Use for mentorship tracking. _(risk: safe)_
- **moatmri**: Analyze AI disruption pressure across a business, map competitive exposure, and produce a 90-day defensive action plan. _(risk: safe)_
- **monthly-closing-statements**: Monthly closing register: period dates, cash/bank/party/inventory/TDS reconciliation flags, profit, receivables, payables, working capital, open adjustments and reviewer. Use for period close. _(risk: safe)_
- **notification-reminder-hub**: Notification register: title, type, priority, recipient and department, message, linked record, trigger module, scheduled and sent dates and status. Use for reminder tracking. _(risk: safe)_
- **notion-manual-import**: Notion Manual Import: the Notion step for any module - CSV, property mapping, import steps and verification for the field list the active module confirmed. Use whenever the user picks Notion. _(risk: safe)_
- **offboarding-exit**: Offboarding register: exit type, employee and manager, notice and final day, reason, handover owner, and done flags for knowledge transfer, assets, access and settlement. Use for exit tracking. _(risk: safe)_
- **offer-appointment**: Offer register: candidate, position, department, employment type, offered salary and currency, offer date and expiry, joining date, probation, approver and sign-off. Use for offer tracking. _(risk: safe)_
- **okr-system**: OKR register: objective, owner and level, department, quarter and year, up to three key results with progress percentages, parent OKR and overall progress. Use for objective tracking. _(risk: safe)_
- **onboarding-playbook**: Onboarding checklist: step, phase and order, department, owner, linked SOP and required flag. Use for joiner onboarding. _(risk: safe)_
- **organization-design**: Org structure register: department, type, parent, head, location, approved against actual headcount, annual budget, cost centre code and establishment date. Use for org design. _(risk: safe)_
- **outreachgenie-list-audit**: Audit saved OutreachGenie prospect lists against an outreach flow for missing template values, text limits and incomplete collection, using read-only MCP snapshots and local reports. _(risk: safe)_
- **party-ledger-reconciliation**: Party ledger reconciliation: party type, name and PAN/VAT, ledger against statement balance, difference and reason, duplicates, confirmation status and adjustment. Use for balance checks. _(risk: safe)_
- **payment-accounting**: Payment voucher register: payment number and date, paid to and purpose, mode, gross amount, TDS rate and deducted, net paid, invoice allocation, ledger and reconciliation status. Use for vouchers. _(risk: safe)_
- **payments-received**: Payments received log: reference, client and invoice, amount and currency, payment date and method, withholding tax, bank account, received-by and receipt-sent status. Use for incoming payments. _(risk: safe)_
- **payroll-finance**: Payroll register: employee, department and month, basic, DA, HRA and TA, bonus, deductions, net pay, pay period, payment date and method. Use for payroll records. _(risk: safe)_
- **people-directory**: Employee master record: name, employee id, department, job title, grade, manager, employment type, contact and emergency details, access role, start and end dates, status. Use for people records. _(risk: safe)_
- **performance-management**: Performance review register: review type, period, employee and reviewer, KPI, OKR and behaviour scores, overall rating, PIP and promotion flags, development plan. Use for performance reviews. _(risk: safe)_
- **petty-cash-management**: Petty cash register: entry number, date and type, payee and purpose, cash in and out, running balance, cash limit flag, custodian, physical count and variance. Use for petty cash. _(risk: safe)_
- **policy-acknowledgement**: Policy acknowledgement register: employee, policy and version, sent and due dates, acknowledged date and flag, days overdue, reminder sent and status. Use for policy sign-off tracking. _(risk: safe)_
- **policy-library**: Policy register: name, version, category, owner and approver, applies to, compliance framework, acknowledgement requirement, effective date and next review. Use for policy management. _(risk: safe)_
- **pre-boarding**: Pre-boarding checklist: task, employee and department, owner, category, joining and due dates, documents received, laptop, email and account-record readiness, status. Use for pre-boarding. _(risk: safe)_
- **presentation-deck**: Build an evidence-linked slide register after context-first intake. Use when an SME needs a presentation deck, speaker notes, or a structured business story. _(risk: safe)_
- **pro-launch**: Build an app or product from 0 to 1, taste-first, with phase gates: references, naming, style frames, UI loop, launch video, GTM and shipping. Use for 做产品, 起名, 找参考, UI 太丑, launch plans. _(risk: safe)_
- **probation-tracker**: Probation register: employee, start and end dates, 30, 60 and 90-day review scores, overall score and confirmation letter. Use for probation tracking. _(risk: safe)_
- **product-marketing**: When the user wants to create or update their product marketing context document. _(risk: critical)_
- **product-marketing-context**: Create or update a reusable product marketing context document with positioning, audience, ICP, use cases, and messaging. Use at the start of a project to avoid repeating core marketing context across tasks. _(risk: critical)_
- **project-based-performance**: Project performance review: role, project and manager, delivery, quality and collaboration scores, overall score and feedback. Use for project appraisals. _(risk: safe)_
- **projects-work-management**: Project register: owner, team, priority, progress percentage, milestones, deliverables and budget against actual cost. Use for project tracking. _(risk: safe)_
- **promotion-upgrade-requests**: Promotion register: current and requested role and grade, justification, OKR and behaviour scores, time in role, salary proposal and decision. Use for upgrade requests. _(risk: safe)_
- **purchase-accounting**: Purchase register: supplier, invoice, gross amount, VAT and TDS, net payable, ledger account and payment balance. Use for purchase accounting. _(risk: safe)_
- **receipt-accounting**: Receipt register: payer, mode, gross amount received, invoice allocation, unapplied amount and TDS collected. Use for receipt and sales-income accounting. _(risk: safe)_
- **recognition-rewards**: Recognition register: employee, reward type, category, visibility, message and points awarded. Use for employee recognition programs. _(risk: safe)_
- **recruitment-pipeline**: Recruitment pipeline: candidate, position, stage, source, applied and interview dates, interview score, notice period and offer. Use for hiring tracking. _(risk: safe)_
- **remote-work-tracker**: Remote work register: employee, location, week start, HQ versus remote days, core-hours compliance and manager approval. Use for hybrid work tracking. _(risk: safe)_
- **reports-analytics**: Report register: type, source modules, owner, audience, frequency, last and next run and report link. Use for reporting governance. _(risk: safe)_
- **revops**: Design and improve revenue operations, lead lifecycle rules, scoring, routing, handoffs, and CRM process automation. Use when marketing, sales, and customer success workflows need clearer operational structure. _(risk: critical)_
- **saas-pricing-strategist**: Design, optimize, and test pricing strategies for SaaS products using data-driven frameworks, competitive analysis, and psychological pricing principles. _(risk: unknown)_
- **salary-benchmarking**: Salary benchmark register: role, department and grade against market and internal minimum, median and maximum. Use for compensation review. _(risk: safe)_
- **salary-wage-accounting**: Payroll register: gross, allowances, TDS and provident fund deductions, net pay, payment date and statutory reconciliation. Use for salary accounting. _(risk: safe)_
- **sales-accounting**: Sales register: customer, invoice, gross amount, discount, VAT and TDS, net receivable, credit terms and balance. Use for sales accounting. _(risk: safe)_
- **sales-enablement**: Create sales collateral such as decks, one-pagers, objection docs, demo scripts, playbooks, and proposal templates. Use when a sales team needs assets that help reps move deals forward and close. _(risk: safe)_
- **second-deposit-igaming**: Explore local casino deposit exports with heuristic signals and descriptive comparisons. Sensitive player data; contact lists and country-rule use require separate operator verification. _(risk: critical)_
- **seo-directory-backlinks**: Directory and backlink register: platform, domain, target URL, follow attribute, authority and spam scores, approval and NAP-match status. Use for SEO citation tracking. _(risk: safe)_
- **shark**: Pitch a business idea to a Shark Tank-style panel of Claude sub-agent investors who grill it, hear a founder agent answer, and each go IN or OUT with a practice offer. _(risk: safe)_
- **skill-gap-analysis**: Skill gap register: employee, skill area, current against required level, gap severity and recommended training. Use for capability planning. _(risk: safe)_
- **social-media-setup**: Social media register: platforms and handles, post captions and hashtags, publishing cadence, approval status and profile checklist. Use for social account setup. _(risk: safe)_
- **sop-company-wiki**: SOP and company wiki register: title, category, department, owner, version, priority and review dates. Use for process documentation. _(risk: safe)_
- **source-document-filing**: Source document register: document type and number, party, amount, index key, storage location, retention period and verification. Use for document filing. _(risk: safe)_
- **spreadsheet-manual-build**: Spreadsheet Manual Build: an empty Excel workbook or CSV from a confirmed field list, formatted and validated. Use for an xlsx template or a manual register. _(risk: safe)_
- **stakeholder-investor-reports**: Stakeholder report register: stakeholder, period, key metrics, preparer, approver, send date and report link. Use for investor and board reporting. _(risk: safe)_
- **tax-register**: Tax register: sales and purchase tax, withholding deducted and received, net payable, filing due date and days remaining. Use for tax compliance. _(risk: safe)_
- **tds-booking-payment**: TDS register: payee PAN, payment nature, rate and amount deducted, deposit date and challan reference, return filing and ledger variance. Use for TDS compliance. _(risk: safe)_
- **team-calendar**: Team calendar: event, type, date and time with time zone, attendees, organizer, location and source module. Use for shared scheduling. _(risk: safe)_
- **template-library**: Template register: name, type, owning module and department, owner, last updated and content link. Use for document template governance. _(risk: safe)_
- **time-tracking**: Time entry register: employee, project, client, task, hours, billable flag, rate and amount, invoice and approver. Use for time tracking. _(risk: safe)_
- **usage-based-pricing**: Design pricing models that developers understand, accept, and can predict. Trigger phrases: usage-based pricing, API pricing, metered billing, developer pricing, pricing page, cost calculator, pay as you go, pricing transparency, competitive pricing, developer billing _(risk: critical)_
- **vendor-contractor-management**: Vendor register: name, type, services, contact, linked contract dates, payment terms and rating. Use for vendor and contractor management. _(risk: safe)_

## business-strategy

- **find-complementary-founders**: Use when an owner explicitly asks for a cofounder or project partner, or explicitly says they need a complementary builder, operator, go-to-market partner, or scaling capability. Assess and publish only the agent's own owner, then rank only approved own-owner profiles. _(risk: critical)_
- **kotler-macro-analyzer**: Professional PESTEL/SWOT analysis agent based on Kotler's methodology for strategic market audits. _(risk: safe)_
- **osterwalder-canvas-architect**: Iterative consultant agent for building and validating logically consistent 9-block Business Model Canvases. _(risk: safe)_

## career-jobs

- **healthcare-job-search**: Find open US healthcare jobs (nursing, CNA, allied health, therapy, imaging, pharmacy, physicians) and the hourly pay employers post, via CareJobs.Now's free MCP server or JSON endpoints. _(risk: safe)_
- **neverapply**: Find matching jobs, tailor resumes, prepare for interviews and apply to jobs with the user's approval through NeverApply's hosted MCP server (OAuth sign-in). _(risk: critical)_

## cloud

- **aws-agentic-ai**: AWS Bedrock AgentCore comprehensive expert for deploying and managing AI agents at scale. Use when working with any AgentCore service including Gateway, Runtime, Memory, Identity, Code Interpreter, Browser, Observability, Agent Registry, or Evaluations. _(risk: critical)_
- **aws-cdk-development**: AWS Cloud Development Kit (CDK) expert for building cloud infrastructure with TypeScript/Python. _(risk: critical)_
- **aws-cost-operations**: AWS cost optimization, monitoring, and operational excellence expert. Use when analyzing AWS bills, estimating costs, setting up CloudWatch alarms, querying logs, auditing CloudTrail activity, or assessing security posture. _(risk: critical)_
- **aws-mcp-setup**: Configure AWS MCP servers for documentation search and API access. Use when setting up AWS MCP, configuring AWS documentation tools, troubleshooting MCP connectivity, or when user mentions aws-mcp, awsdocs, uvx setup, or MCP server configuration. _(risk: critical)_
- **aws-serverless-eda**: AWS serverless and event-driven architecture expert based on Well-Architected Framework. Use when building serverless APIs, Lambda functions, REST APIs, microservices, or async workflows. _(risk: critical)_
- **aws-sst-development**: SST v4 (Ion) expert for managing AWS resources as code with the Pulumi-backed framework. _(risk: critical)_
- **azure-ai-language-conversations-py**: Implement Conversational Language Understanding (CLU) using the azure-ai-language-conversations Python SDK. Use when working with ConversationAnalysisClient to analyze conversation intent and entities, building NLP features, or integrating language understanding into applications. _(risk: critical)_
- **azure-servicebus-rust**: Azure Service Bus library for Rust. Send and receive messages using queues, topics, and subscriptions. Triggers: "service bus rust", "ServiceBusClient rust", "send message servicebus rust", "receive message servicebus rust", "queue rust messaging", "topic subscription rust". _(risk: critical)_
- **azure-storage-queue-rust**: Azure Queue Storage library for Rust. Send, receive, and manage queue messages. Triggers: "queue storage rust", "QueueClient rust", "send message rust", "receive messages rust", "QueueServiceClient rust", "queue rust". _(risk: critical)_
- **hf-cloud-aws-context-discovery**: Discover the effective local AWS profile, region, account, and caller identity before any AWS task without exposing credentials. _(risk: safe)_
- **neon-object-storage**: S3-compatible object storage that branches with your Neon project, so files and the database stay in sync across every branch. _(risk: critical)_
- **rclone-cli**: Rclone command-line cloud storage manager reference and usage guide. Use this skill whenever the user mentions rclone, or any task involving terminal-based cloud file operations such as upload, download, sync, copy, move, mount, or remote management. _(risk: critical)_

## cloud-devops

- **agents-v2-py**: Build container-based Foundry Agents with Azure AI Projects SDK (ImageBasedHostedAgentDefinition). Use when creating hosted agents with custom container images in Azure AI Foundry. _(risk: unknown)_
- **api-testing-observability-api-mock**: You are an API mocking expert specializing in realistic mock services for development, testing, and demos. Design mocks that simulate real API behavior and enable parallel development. _(risk: unknown)_
- **apify-actor-development**: Develop, debug, and deploy Apify Actors - serverless cloud programs for web scraping, automation, and data processing. Use when creating new Actors, modifying existing ones, or troubleshooting Acto... _(risk: unknown)_
- **apify-actorization**: Convert existing projects into Apify Actors - serverless cloud programs. Actorize JavaScript/TypeScript (SDK with Actor.init/exit), Python (async context manager), or any language (CLI wrapper). Us... _(risk: unknown)_
- **apify-brand-reputation-monitoring**: Track reviews, ratings, sentiment, and brand mentions across Google Maps, Booking.com, TripAdvisor, Facebook, Instagram, YouTube, and TikTok. Use when user asks to monitor brand reputation, analyze... _(risk: unknown)_
- **appdeploy**: Deploy web apps with backend APIs, database, and file storage. Use when the user asks to deploy or publish a website or web app and wants a public URL. Uses HTTP API via curl. _(risk: safe)_
- **application-performance-performance-optimization**: Optimize end-to-end application performance with profiling, observability, and backend/frontend tuning. Use when coordinating performance optimization across the stack. _(risk: unknown)_
- **aws-cost-cleanup**: Automated cleanup of unused AWS resources to reduce costs _(risk: safe)_
- **aws-cost-optimizer**: Comprehensive AWS cost analysis and optimization recommendations using AWS CLI and Cost Explorer _(risk: safe)_
- **aws-serverless**: Specialized skill for building production-ready serverless applications on AWS. Covers Lambda functions, API Gateway, DynamoDB, SQS/SNS event-driven patterns, SAM/CDK deployment, and cold start opt... _(risk: unknown)_
- **aws-skills**: AWS development with infrastructure automation and cloud architecture patterns _(risk: safe)_
- **azd-deployment**: Deploy containerized applications to Azure Container Apps using Azure Developer CLI (azd). Use when setting up azd projects, writing azure.yaml configuration, creating Bicep infrastructure for Cont... _(risk: unknown)_
- **azure-ai-agents-persistent-dotnet**: Azure AI Agents Persistent SDK for .NET. Low-level SDK for creating and managing AI agents with threads, messages, runs, and tools. _(risk: unknown)_
- **azure-ai-agents-persistent-java**: Azure AI Agents Persistent SDK for Java. Low-level SDK for creating and managing AI agents with threads, messages, runs, and tools. _(risk: unknown)_
- **azure-ai-anomalydetector-java**: Build anomaly detection applications with Azure AI Anomaly Detector SDK for Java. Use when implementing univariate/multivariate anomaly detection, time-series analysis, or AI-powered monitoring. _(risk: unknown)_
- **azure-ai-contentsafety-java**: Build content moderation applications with Azure AI Content Safety SDK for Java. Use when implementing text/image analysis, blocklist management, or harm detection for hate, violence, sexual conten... _(risk: unknown)_
- **azure-ai-contentsafety-py**: Azure AI Content Safety SDK for Python. Use for detecting harmful content in text and images with multi-severity classification. _(risk: unknown)_
- **azure-ai-contentsafety-ts**: Analyze text and images for harmful content using Azure AI Content Safety (@azure-rest/ai-content-safety). Use when moderating user-generated content, detecting hate speech, violence, sexual conten... _(risk: unknown)_
- **azure-ai-contentunderstanding-py**: Azure AI Content Understanding SDK for Python. Use for multimodal content extraction from documents, images, audio, and video. _(risk: unknown)_
- **azure-ai-document-intelligence-dotnet**: Azure AI Document Intelligence SDK for .NET. Extract text, tables, and structured data from documents using prebuilt and custom models. _(risk: unknown)_
- **azure-ai-document-intelligence-ts**: Extract text, tables, and structured data from documents using Azure Document Intelligence (@azure-rest/ai-document-intelligence). Use when processing invoices, receipts, IDs, forms, or building cu... _(risk: unknown)_
- **azure-ai-formrecognizer-java**: Build document analysis applications with Azure Document Intelligence (Form Recognizer) SDK for Java. Use when extracting text, tables, key-value pairs from documents, receipts, invoices, or buildi... _(risk: unknown)_
- **azure-ai-projects-dotnet**: Azure AI Projects SDK for .NET. High-level client for Azure AI Foundry projects including agents, connections, datasets, deployments, evaluations, and indexes. _(risk: unknown)_
- **azure-ai-projects-java**: Azure AI Projects SDK for Java. High-level SDK for Azure AI Foundry project management including connections, datasets, indexes, and evaluations. _(risk: unknown)_
- **azure-ai-projects-py**: Build AI applications using the Azure AI Projects Python SDK (azure-ai-projects). Use when working with Foundry project clients, creating versioned agents with PromptAgentDefinition, running evalua... _(risk: unknown)_
- **azure-ai-projects-ts**: Build AI applications using Azure AI Projects SDK for JavaScript (@azure/ai-projects). Use when working with Foundry project clients, agents, connections, deployments, datasets, indexes, evaluation... _(risk: unknown)_
- **azure-ai-textanalytics-py**: Azure AI Text Analytics SDK for sentiment analysis, entity recognition, key phrases, language detection, PII, and healthcare NLP. Use for natural language processing on text. _(risk: unknown)_
- **azure-ai-transcription-py**: Azure AI Transcription SDK for Python. Use for real-time and batch speech-to-text transcription with timestamps and diarization. _(risk: unknown)_
- **azure-ai-translation-text-py**: Azure AI Text Translation SDK for real-time text translation, transliteration, language detection, and dictionary lookup. Use for translating text content in applications. _(risk: unknown)_
- **azure-ai-translation-ts**: Build translation applications using Azure Translation SDKs for JavaScript (@azure-rest/ai-translation-text, @azure-rest/ai-translation-document). Use when implementing text translation, transliter... _(risk: unknown)_
- **azure-ai-vision-imageanalysis-java**: Build image analysis applications with Azure AI Vision SDK for Java. Use when implementing image captioning, OCR text extraction, object detection, tagging, or smart cropping. _(risk: unknown)_
- **azure-ai-vision-imageanalysis-py**: Azure AI Vision Image Analysis SDK for captions, tags, objects, OCR, people detection, and smart cropping. Use for computer vision and image understanding tasks. _(risk: unknown)_
- **azure-ai-voicelive-dotnet**: Azure AI Voice Live SDK for .NET. Build real-time voice AI applications with bidirectional WebSocket communication. _(risk: unknown)_
- **azure-ai-voicelive-java**: Azure AI VoiceLive SDK for Java. Real-time bidirectional voice conversations with AI assistants using WebSocket. _(risk: unknown)_
- **azure-ai-voicelive-py**: Build real-time voice AI applications using Azure AI Voice Live SDK (azure-ai-voicelive). Use this skill when creating Python applications that need real-time bidirectional audio communication with... _(risk: unknown)_
- **azure-ai-voicelive-ts**: Azure AI Voice Live SDK for JavaScript/TypeScript. Build real-time voice AI applications with bidirectional WebSocket communication. _(risk: unknown)_
- **azure-appconfiguration-java**: Azure App Configuration SDK for Java. Centralized application configuration management with key-value settings, feature flags, and snapshots. _(risk: unknown)_
- **azure-appconfiguration-py**: Azure App Configuration SDK for Python. Use for centralized configuration management, feature flags, and dynamic settings. _(risk: unknown)_
- **azure-appconfiguration-ts**: Build applications using Azure App Configuration SDK for JavaScript (@azure/app-configuration). Use when working with configuration settings, feature flags, Key Vault references, dynamic refresh, o... _(risk: unknown)_
- **azure-communication-callautomation-java**: Build call automation workflows with Azure Communication Services Call Automation Java SDK. Use when implementing IVR systems, call routing, call recording, DTMF recognition, text-to-speech, or AI-... _(risk: unknown)_
- **azure-communication-callingserver-java**: Azure Communication Services CallingServer (legacy) Java SDK. Note - This SDK is deprecated. Use azure-communication-callautomation instead for new projects. Only use this skill when maintaining le... _(risk: unknown)_
- **azure-communication-chat-java**: Build real-time chat applications with Azure Communication Services Chat Java SDK. Use when implementing chat threads, messaging, participants, read receipts, typing notifications, or real-time cha... _(risk: unknown)_
- **azure-communication-common-java**: Azure Communication Services common utilities for Java. Use when working with CommunicationTokenCredential, user identifiers, token refresh, or shared authentication across ACS services. _(risk: unknown)_
- **azure-communication-sms-java**: Send SMS messages with Azure Communication Services SMS Java SDK. Use when implementing SMS notifications, alerts, OTP delivery, bulk messaging, or delivery reports. _(risk: unknown)_
- **azure-compute-batch-java**: Azure Batch SDK for Java. Run large-scale parallel and HPC batch jobs with pools, jobs, tasks, and compute nodes. _(risk: unknown)_
- **azure-containerregistry-py**: Azure Container Registry SDK for Python. Use for managing container images, artifacts, and repositories. _(risk: unknown)_
- **azure-cosmos-db-py**: Build Azure Cosmos DB NoSQL services with Python/FastAPI following production-grade patterns. Use when implementing database client setup with dual auth (DefaultAzureCredential + emulator), service... _(risk: unknown)_
- **azure-cosmos-java**: Azure Cosmos DB SDK for Java. NoSQL database operations with global distribution, multi-model support, and reactive patterns. _(risk: unknown)_
- **azure-cosmos-py**: Azure Cosmos DB SDK for Python (NoSQL API). Use for document CRUD, queries, containers, and globally distributed data. _(risk: unknown)_
- **azure-cosmos-rust**: Azure Cosmos DB SDK for Rust (NoSQL API). Use for document CRUD, queries, containers, and globally distributed data. _(risk: unknown)_
- **azure-cosmos-ts**: Azure Cosmos DB JavaScript/TypeScript SDK (@azure/cosmos) for data plane operations. Use for CRUD operations on documents, queries, bulk operations, and container management. _(risk: unknown)_
- **azure-data-tables-java**: Build table storage applications with Azure Tables SDK for Java. Use when working with Azure Table Storage or Cosmos DB Table API for NoSQL key-value data, schemaless storage, or structured data at... _(risk: unknown)_
- **azure-data-tables-py**: Azure Tables SDK for Python (Storage and Cosmos DB). Use for NoSQL key-value storage, entity CRUD, and batch operations. _(risk: unknown)_
- **azure-eventgrid-dotnet**: Azure Event Grid SDK for .NET. Client library for publishing and consuming events with Azure Event Grid. Use for event-driven architectures, pub/sub messaging, CloudEvents, and EventGridEvents. _(risk: unknown)_
- **azure-eventgrid-java**: Build event-driven applications with Azure Event Grid SDK for Java. Use when publishing events, implementing pub/sub patterns, or integrating with Azure services via events. _(risk: unknown)_
- **azure-eventgrid-py**: Azure Event Grid SDK for Python. Use for publishing events, handling CloudEvents, and event-driven architectures. _(risk: unknown)_
- **azure-eventhub-dotnet**: Azure Event Hubs SDK for .NET. _(risk: unknown)_
- **azure-eventhub-java**: Build real-time streaming applications with Azure Event Hubs SDK for Java. Use when implementing event streaming, high-throughput data ingestion, or building event-driven architectures. _(risk: unknown)_
- **azure-eventhub-py**: Azure Event Hubs SDK for Python streaming. Use for high-throughput event ingestion, producers, consumers, and checkpointing. _(risk: unknown)_
- **azure-eventhub-rust**: Azure Event Hubs SDK for Rust. Use for sending and receiving events, streaming data ingestion. _(risk: unknown)_
- **azure-eventhub-ts**: Build event streaming applications using Azure Event Hubs SDK for JavaScript (@azure/event-hubs). Use when implementing high-throughput event ingestion, real-time analytics, IoT telemetry, or event... _(risk: unknown)_
- **azure-functions**: Expert patterns for Azure Functions development including isolated worker model, Durable Functions orchestration, cold start optimization, and production patterns. Covers .NET, Python, and Node.js ... _(risk: unknown)_
- **azure-identity-dotnet**: Azure Identity SDK for .NET. Authentication library for Azure SDK clients using Microsoft Entra ID. Use for DefaultAzureCredential, managed identity, service principals, and developer credentials. _(risk: unknown)_
- **azure-identity-java**: Azure Identity Java SDK for authentication with Azure services. Use when implementing DefaultAzureCredential, managed identity, service principal, or any Azure authentication pattern in Java applic... _(risk: unknown)_
- **azure-identity-py**: Azure Identity SDK for Python authentication. Use for DefaultAzureCredential, managed identity, service principals, and token caching. _(risk: unknown)_
- **azure-identity-rust**: Azure Identity SDK for Rust authentication. Use for DeveloperToolsCredential, ManagedIdentityCredential, ClientSecretCredential, and token-based authentication. _(risk: unknown)_
- **azure-identity-ts**: Authenticate to Azure services using Azure Identity SDK for JavaScript (@azure/identity). Use when configuring authentication with DefaultAzureCredential, managed identity, service principals, or i... _(risk: unknown)_
- **azure-keyvault-certificates-rust**: Azure Key Vault Certificates SDK for Rust. Use for creating, importing, and managing certificates. _(risk: unknown)_
- **azure-keyvault-py**: Azure Key Vault SDK for Python. Use for secrets, keys, and certificates management with secure storage. _(risk: unknown)_
- **azure-keyvault-secrets-rust**: Azure Key Vault Secrets SDK for Rust. Use for storing and retrieving secrets, passwords, and API keys. Triggers: "keyvault secrets rust", "SecretClient rust", "get secret rust", "set secret rust". _(risk: unknown)_
- **azure-keyvault-secrets-ts**: Manage secrets using Azure Key Vault Secrets SDK for JavaScript (@azure/keyvault-secrets). Use when storing and retrieving application secrets or configuration values. _(risk: unknown)_
- **azure-maps-search-dotnet**: Azure Maps SDK for .NET. Location-based services including geocoding, routing, rendering, geolocation, and weather. Use for address search, directions, map tiles, IP geolocation, and weather data. _(risk: unknown)_
- **azure-messaging-webpubsub-java**: Build real-time web applications with Azure Web PubSub SDK for Java. Use when implementing WebSocket-based messaging, live updates, chat applications, or server-to-client push notifications. _(risk: unknown)_
- **azure-messaging-webpubsubservice-py**: Azure Web PubSub Service SDK for Python. Use for real-time messaging, WebSocket connections, and pub/sub patterns. _(risk: unknown)_
- **azure-mgmt-apicenter-dotnet**: Azure API Center SDK for .NET. Centralized API inventory management with governance, versioning, and discovery. _(risk: unknown)_
- **azure-mgmt-apicenter-py**: Azure API Center Management SDK for Python. Use for managing API inventory, metadata, and governance across your organization. _(risk: unknown)_
- **azure-mgmt-apimanagement-dotnet**: Azure Resource Manager SDK for API Management in .NET. _(risk: unknown)_
- **azure-mgmt-apimanagement-py**: Azure API Management SDK for Python. Use for managing APIM services, APIs, products, subscriptions, and policies. _(risk: unknown)_
- **azure-mgmt-applicationinsights-dotnet**: Azure Application Insights SDK for .NET. Application performance monitoring and observability resource management. _(risk: unknown)_
- **azure-mgmt-arizeaiobservabilityeval-dotnet**: Azure Resource Manager SDK for Arize AI Observability and Evaluation (.NET). _(risk: unknown)_
- **azure-mgmt-botservice-dotnet**: Azure Resource Manager SDK for Bot Service in .NET. Management plane operations for creating and managing Azure Bot resources, channels (Teams, DirectLine, Slack), and connection settings. _(risk: unknown)_
- **azure-mgmt-botservice-py**: Azure Bot Service Management SDK for Python. Use for creating, managing, and configuring Azure Bot Service resources. _(risk: unknown)_
- **azure-mgmt-fabric-dotnet**: Azure Resource Manager SDK for Fabric in .NET. _(risk: unknown)_
- **azure-mgmt-fabric-py**: Azure Fabric Management SDK for Python. Use for managing Microsoft Fabric capacities and resources. _(risk: unknown)_
- **azure-mgmt-mongodbatlas-dotnet**: Manage MongoDB Atlas Organizations as Azure ARM resources using Azure.ResourceManager.MongoDBAtlas SDK. Use when creating, updating, listing, or deleting MongoDB Atlas organizations through Azure M... _(risk: unknown)_
- **azure-mgmt-weightsandbiases-dotnet**: Azure Weights & Biases SDK for .NET. ML experiment tracking and model management via Azure Marketplace. Use for creating W&B instances, managing SSO, marketplace integration, and ML observability. _(risk: unknown)_
- **azure-microsoft-playwright-testing-ts**: Run Playwright tests at scale using Azure Playwright Workspaces (formerly Microsoft Playwright Testing). Use when scaling browser tests across cloud-hosted browsers, integrating with CI/CD pipeline... _(risk: unknown)_
- **azure-monitor-ingestion-java**: Azure Monitor Ingestion SDK for Java. Send custom logs to Azure Monitor via Data Collection Rules (DCR) and Data Collection Endpoints (DCE). _(risk: unknown)_
- **azure-monitor-ingestion-py**: Azure Monitor Ingestion SDK for Python. Use for sending custom logs to Log Analytics workspace via Logs Ingestion API. _(risk: unknown)_
- **azure-monitor-opentelemetry-exporter-java**: Azure Monitor OpenTelemetry Exporter for Java. Export OpenTelemetry traces, metrics, and logs to Azure Monitor/Application Insights. _(risk: unknown)_
- **azure-monitor-opentelemetry-exporter-py**: Azure Monitor OpenTelemetry Exporter for Python. Use for low-level OpenTelemetry export to Application Insights. _(risk: unknown)_
- **azure-monitor-opentelemetry-py**: Azure Monitor OpenTelemetry Distro for Python. Use for one-line Application Insights setup with auto-instrumentation. _(risk: unknown)_
- **azure-monitor-opentelemetry-ts**: Instrument applications with Azure Monitor and OpenTelemetry for JavaScript (@azure/monitor-opentelemetry). Use when adding distributed tracing, metrics, and logs to Node.js applications with Appli... _(risk: unknown)_
- **azure-monitor-query-java**: Azure Monitor Query SDK for Java. Execute Kusto queries against Log Analytics workspaces and query metrics from Azure resources. _(risk: unknown)_
- **azure-monitor-query-py**: Azure Monitor Query SDK for Python. Use for querying Log Analytics workspaces and Azure Monitor metrics. _(risk: unknown)_
- **azure-postgres-ts**: Connect to Azure Database for PostgreSQL Flexible Server from Node.js/TypeScript using the pg (node-postgres) package. _(risk: unknown)_
- **azure-resource-manager-cosmosdb-dotnet**: Azure Resource Manager SDK for Cosmos DB in .NET. _(risk: unknown)_
- **azure-resource-manager-durabletask-dotnet**: Azure Resource Manager SDK for Durable Task Scheduler in .NET. _(risk: unknown)_
- **azure-resource-manager-mysql-dotnet**: Azure MySQL Flexible Server SDK for .NET. Database management for MySQL Flexible Server deployments. _(risk: unknown)_
- **azure-resource-manager-playwright-dotnet**: Azure Resource Manager SDK for Microsoft Playwright Testing in .NET. _(risk: unknown)_
- **azure-resource-manager-postgresql-dotnet**: Azure PostgreSQL Flexible Server SDK for .NET. Database management for PostgreSQL Flexible Server deployments. _(risk: unknown)_
- **azure-resource-manager-redis-dotnet**: Azure Resource Manager SDK for Redis in .NET. _(risk: unknown)_
- **azure-resource-manager-sql-dotnet**: Azure Resource Manager SDK for Azure SQL in .NET. _(risk: unknown)_
- **azure-search-documents-dotnet**: Azure AI Search SDK for .NET (Azure.Search.Documents). Use for building search applications with full-text, vector, semantic, and hybrid search. _(risk: unknown)_
- **azure-search-documents-ts**: Build search applications using Azure AI Search SDK for JavaScript (@azure/search-documents). Use when creating/managing indexes, implementing vector/hybrid search, semantic ranking, or building ag... _(risk: unknown)_
- **azure-servicebus-dotnet**: Azure Service Bus SDK for .NET. Enterprise messaging with queues, topics, subscriptions, and sessions. _(risk: unknown)_
- **azure-servicebus-py**: Azure Service Bus SDK for Python messaging. Use for queues, topics, subscriptions, and enterprise messaging patterns. _(risk: unknown)_
- **azure-servicebus-ts**: Build messaging applications using Azure Service Bus SDK for JavaScript (@azure/service-bus). Use when implementing queues, topics/subscriptions, message sessions, dead-letter handling, or enterpri... _(risk: unknown)_
- **azure-speech-to-text-rest-py**: Azure Speech to Text REST API for short audio (Python). Use for simple speech recognition of audio files up to 60 seconds without the Speech SDK. _(risk: unknown)_
- **azure-storage-blob-java**: Build blob storage applications with Azure Storage Blob SDK for Java. Use when uploading, downloading, or managing files in Azure Blob Storage, working with containers, or implementing streaming da... _(risk: unknown)_
- **azure-storage-blob-py**: Azure Blob Storage SDK for Python. Use for uploading, downloading, listing blobs, managing containers, and blob lifecycle. _(risk: unknown)_
- **azure-storage-blob-rust**: Azure Blob Storage SDK for Rust. Use for uploading, downloading, and managing blobs and containers. _(risk: unknown)_
- **azure-storage-blob-ts**: Azure Blob Storage JavaScript/TypeScript SDK (@azure/storage-blob) for blob operations. Use for uploading, downloading, listing, and managing blobs and containers. _(risk: unknown)_
- **azure-storage-file-datalake-py**: Azure Data Lake Storage Gen2 SDK for Python. Use for hierarchical file systems, big data analytics, and file/directory operations. _(risk: unknown)_
- **azure-storage-file-share-py**: Azure Storage File Share SDK for Python. Use for SMB file shares, directories, and file operations in the cloud. _(risk: unknown)_
- **azure-storage-file-share-ts**: Azure File Share JavaScript/TypeScript SDK (@azure/storage-file-share) for SMB file share operations. _(risk: unknown)_
- **azure-storage-queue-py**: Azure Queue Storage SDK for Python. Use for reliable message queuing, task distribution, and asynchronous processing. _(risk: unknown)_
- **azure-storage-queue-ts**: Azure Queue Storage JavaScript/TypeScript SDK (@azure/storage-queue) for message queue operations. Use for sending, receiving, peeking, and deleting messages in queues. _(risk: unknown)_
- **azure-web-pubsub-ts**: Build real-time messaging applications using Azure Web PubSub SDKs for JavaScript (@azure/web-pubsub, @azure/web-pubsub-client). Use when implementing WebSocket-based real-time features, pub/sub me... _(risk: unknown)_
- **bash-defensive-patterns**: Master defensive Bash programming techniques for production-grade scripts. Use when writing robust shell scripts, CI/CD pipelines, or system utilities requiring fault tolerance and safety. _(risk: unknown)_
- **bash-pro**: Master of defensive Bash scripting for production automation, CI/CD
pipelines, and system utilities. Expert in safe, portable, and testable shell
scripts.
 _(risk: unknown)_
- **bats-testing-patterns**: Master Bash Automated Testing System (Bats) for comprehensive shell script testing. Use when writing tests for shell scripts, CI/CD pipelines, or requiring test-driven development of shell utilities. _(risk: unknown)_
- **bevy-ecs-expert**: Master Bevy's Entity Component System (ECS) in Rust, covering Systems, Queries, Resources, and parallel scheduling. _(risk: safe)_
- **c4-container**: Expert C4 Container-level documentation specialist. _(risk: unknown)_
- **cdk-patterns**: Common AWS CDK patterns and constructs for building cloud infrastructure with TypeScript, Python, or Java. Use when designing reusable CDK stacks and L3 constructs. _(risk: unknown)_
- **cicd-automation-workflow-automate**: You are a workflow automation expert specializing in creating efficient CI/CD pipelines, GitHub Actions workflows, and automated development processes. Design automation that reduces manual work, i... _(risk: unknown)_
- **cloud-architect**: Expert cloud architect specializing in AWS/Azure/GCP multi-cloud infrastructure design, advanced IaC (Terraform/OpenTofu/CDK), FinOps cost optimization, and modern architectural patterns. _(risk: unknown)_
- **cloudflare-workers-expert**: Expert in Cloudflare Workers and the Edge Computing ecosystem. Covers Wrangler, KV, D1, Durable Objects, and R2 storage. _(risk: safe)_
- **data-engineer**: Build scalable data pipelines, modern data warehouses, and real-time streaming architectures. Implements Apache Spark, dbt, Airflow, and cloud-native data platforms. _(risk: unknown)_
- **database-design**: Database design principles and decision-making. Schema design, indexing strategy, ORM selection, serverless databases. _(risk: unknown)_
- **database-migrations-migration-observability**: Migration monitoring, CDC, and observability infrastructure _(risk: unknown)_
- **datadog-automation**: Automate Datadog tasks via Rube MCP (Composio): query metrics, search logs, manage monitors/dashboards, create events and downtimes. Always search tools first for current schemas. _(risk: unknown)_
- **debug-buttercup**: Debugs the Buttercup CRS (Cyber Reasoning System) running on Kubernetes. Use when diagnosing pod crashes, restart loops, Redis failures, resource pressure, disk saturation, DinD issues, or any service misbehavior in the crs namespace. Covers triage, log analysis,... _(risk: unknown)_
- **deployment-engineer**: Expert deployment engineer specializing in modern CI/CD pipelines, GitOps workflows, and advanced deployment automation. _(risk: unknown)_
- **deployment-procedures**: Production deployment principles and decision-making. Safe deployment workflows, rollback strategies, and verification. Teaches thinking, not scripts. _(risk: unknown)_
- **deployment-validation-config-validate**: You are a configuration management expert specializing in validating, testing, and ensuring the correctness of application configurations. Create comprehensive validation schemas, implement configurat _(risk: unknown)_
- **devops-deploy**: DevOps e deploy de aplicacoes — Docker, CI/CD com GitHub Actions, AWS Lambda, SAM, Terraform, infraestrutura como codigo e monitoramento. Ativar para: dockerizar aplicacao, configurar pipeline... _(risk: critical)_
- **drizzle-orm-expert**: Expert in Drizzle ORM for TypeScript — schema design, relational queries, migrations, and serverless database integration. Use when building type-safe database layers with Drizzle. _(risk: safe)_
- **error-debugging-error-analysis**: You are an expert error analysis specialist with deep expertise in debugging distributed systems, analyzing production incidents, and implementing comprehensive observability solutions. _(risk: unknown)_
- **error-debugging-error-trace**: You are an error tracking and observability expert specializing in implementing comprehensive error monitoring solutions. Set up error tracking systems, configure alerts, implement structured loggi... _(risk: unknown)_
- **error-diagnostics-error-analysis**: You are an expert error analysis specialist with deep expertise in debugging distributed systems, analyzing production incidents, and implementing comprehensive observability solutions. _(risk: unknown)_
- **error-diagnostics-error-trace**: You are an error tracking and observability expert specializing in implementing comprehensive error monitoring solutions. Set up error tracking systems, configure alerts, implement structured logging, _(risk: unknown)_
- **expo-cicd-workflows**: Helps understand and write EAS workflow YAML files for Expo projects. Use this skill when the user asks about CI/CD or workflows in an Expo or EAS context, mentions .eas/workflows/, or wants help with EAS build pipelines or deployment automation. _(risk: unknown)_
- **expo-deployment**: Deploy Expo apps to production _(risk: safe)_
- **gcp-cloud-run**: Specialized skill for building production-ready serverless applications on GCP. Covers Cloud Run services (containerized), Cloud Run Functions (event-driven), cold start optimization, and event-dri... _(risk: unknown)_
- **github-actions-templates**: Create production-ready GitHub Actions workflows for automated testing, building, and deploying applications. Use when setting up CI/CD with GitHub Actions, automating development workflows, or cre... _(risk: unknown)_
- **github-automation**: Automate GitHub repositories, issues, pull requests, branches, CI/CD, and permissions via Rube MCP (Composio). Manage code workflows, review PRs, search code, and handle deployments programmatically. _(risk: unknown)_
- **github-workflow-automation**: Automate GitHub workflows with AI assistance. Includes PR reviews, issue triage, CI/CD integration, and Git operations. Use when automating GitHub workflows, setting up PR review automation, creati... _(risk: unknown)_
- **gitlab-ci-patterns**: Build GitLab CI/CD pipelines with multi-stage workflows, caching, and distributed runners for scalable automation. Use when implementing GitLab CI/CD, optimizing pipeline performance, or setting up... _(risk: unknown)_
- **gitops-workflow**: Implement GitOps workflows with ArgoCD and Flux for automated, declarative Kubernetes deployments with continuous reconciliation. Use when implementing GitOps practices, automating Kubernetes deplo... _(risk: unknown)_
- **grafana-dashboards**: Create and manage production Grafana dashboards for real-time visualization of system and application metrics. Use when building monitoring dashboards, visualizing metrics, or creating operational ... _(risk: unknown)_
- **grpc-golang**: Build production-ready gRPC services in Go with mTLS, streaming, and observability. Use when designing Protobuf contracts with Buf or implementing secure service-to-service transport. _(risk: safe)_
- **helm-chart-scaffolding**: Design, organize, and manage Helm charts for templating and packaging Kubernetes applications with reusable configurations. Use when creating Helm charts, packaging Kubernetes applications, or impl... _(risk: unknown)_
- **hosted-agents-v2-py**: Build hosted agents using Azure AI Projects SDK with ImageBasedHostedAgentDefinition. Use when creating container-based agents in Azure AI Foundry. _(risk: unknown)_
- **hugging-face-jobs**: This skill should be used when users want to run any workload on Hugging Face Jobs infrastructure. Covers UV scripts, Docker-based jobs, hardware selection, cost estimation, authentication with tok... _(risk: safe)_
- **hybrid-cloud-architect**: Expert hybrid cloud architect specializing in complex multi-cloud solutions across AWS/Azure/GCP and private clouds (OpenStack/VMware). _(risk: unknown)_
- **hybrid-cloud-networking**: Configure secure, high-performance connectivity between on-premises infrastructure and cloud platforms using VPN and dedicated connections. Use when building hybrid cloud architectures, connecting ... _(risk: unknown)_
- **incident-responder**: Expert SRE incident responder specializing in rapid problem resolution, modern observability, and comprehensive incident management. _(risk: unknown)_
- **inngest**: Inngest expert for serverless-first background jobs, event-driven workflows, and durable execution without managing queues or workers. Use when: inngest, serverless background job, event-driven wor... _(risk: unknown)_
- **java-pro**: Master Java 21+ with modern features like virtual threads, pattern matching, and Spring Boot 3.x. Expert in the latest Java ecosystem including GraalVM, Project Loom, and cloud-native patterns. _(risk: unknown)_
- **kpi-dashboard-design**: Design effective KPI dashboards with metrics selection, visualization best practices, and real-time monitoring patterns. Use when building business dashboards, selecting metrics, or designing data ... _(risk: unknown)_
- **kubernetes-architect**: Expert Kubernetes architect specializing in cloud-native infrastructure, advanced GitOps workflows (ArgoCD/Flux), and enterprise container orchestration. _(risk: unknown)_
- **makepad-deployment**: CRITICAL: Use for Makepad packaging and deployment. Triggers on:
deploy, package, APK, IPA, 打包, 部署,
cargo-packager, cargo-makepad, WASM, Android, iOS,
distribution, installer, .deb, .dmg, .nsis,
GitHub Actions, CI, action, marketplace _(risk: unknown)_
- **manifest**: Install and configure the Manifest observability plugin for your agents. Use when setting up telemetry, configuring API keys, or troubleshooting the plugin. _(risk: unknown)_
- **microsoft-azure-webjobs-extensions-authentication-events-dotnet**: Microsoft Entra Authentication Events SDK for .NET. Azure Functions triggers for custom authentication extensions. _(risk: unknown)_
- **ml-engineer**: Build production ML systems with PyTorch 2.x, TensorFlow, and modern ML frameworks. Implements model serving, feature engineering, A/B testing, and monitoring. _(risk: unknown)_
- **multi-cloud-architecture**: Design multi-cloud architectures using a decision framework to select and integrate services across AWS, Azure, and GCP. Use when building multi-cloud systems, avoiding vendor lock-in, or leveragin... _(risk: unknown)_
- **multi-platform-apps-multi-platform**: Build and deploy the same feature consistently across web, mobile, and desktop platforms using API-first architecture and parallel implementation strategies. _(risk: unknown)_
- **neon-postgres**: Expert patterns for Neon serverless Postgres, branching, connection pooling, and Prisma/Drizzle integration Use when: neon database, serverless postgres, database branching, neon postgres, postgres... _(risk: unknown)_
- **observability-monitoring-monitor-setup**: You are a monitoring and observability expert specializing in implementing comprehensive monitoring solutions. Set up metrics collection, distributed tracing, log aggregation, and create insightful da _(risk: unknown)_
- **observability-monitoring-slo-implement**: You are an SLO (Service Level Objective) expert specializing in implementing reliability standards and error budget-based practices. Design SLO frameworks, define SLIs, and build monitoring that ba... _(risk: unknown)_
- **odoo-docker-deployment**: Production-ready Docker and docker-compose setup for Odoo with PostgreSQL, persistent volumes, environment-based configuration, and Nginx reverse proxy. _(risk: safe)_
- **pagerduty-automation**: Automate PagerDuty tasks via Rube MCP (Composio): manage incidents, services, schedules, escalation policies, and on-call rotations. Always search tools first for current schemas. _(risk: unknown)_
- **performance-engineer**: Expert performance engineer specializing in modern observability, _(risk: unknown)_
- **prometheus-configuration**: Set up Prometheus for comprehensive metric collection, storage, and monitoring of infrastructure and applications. Use when implementing metrics collection, setting up monitoring infrastructure, or... _(risk: unknown)_
- **react-best-practices**: React and Next.js performance optimization guidelines from Vercel Engineering. This skill should be used when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance pat... _(risk: unknown)_
- **risk-metrics-calculation**: Calculate portfolio risk metrics including VaR, CVaR, Sharpe, Sortino, and drawdown analysis. Use when measuring portfolio risk, implementing risk limits, or building risk monitoring systems. _(risk: unknown)_
- **secrets-management**: Implement secure secrets management for CI/CD pipelines using Vault, AWS Secrets Manager, or native platform solutions. Use when handling sensitive credentials, rotating secrets, or securing CI/CD ... _(risk: unknown)_
- **server-management**: Server management principles and decision-making. Process management, monitoring strategy, and scaling decisions. Teaches thinking, not commands. _(risk: unknown)_
- **service-mesh-observability**: Implement comprehensive observability for service meshes including distributed tracing, metrics, and visualization. Use when setting up mesh monitoring, debugging latency issues, or implementing SL... _(risk: unknown)_
- **skill-creator-ms**: Guide for creating effective skills for AI coding agents working with Azure SDKs and Microsoft Foundry services. Use when creating new skills or updating existing skills. _(risk: unknown)_
- **slo-implementation**: Define and implement Service Level Indicators (SLIs) and Service Level Objectives (SLOs) with error budgets and alerting. Use when establishing reliability targets, implementing SRE practices, or m... _(risk: unknown)_
- **sql-pro**: Master modern SQL with cloud-native databases, OLTP/OLAP optimization, and advanced query techniques. Expert in performance tuning, data modeling, and hybrid analytical systems. _(risk: unknown)_
- **tailwind-patterns**: Tailwind CSS v4 principles. CSS-first configuration, container queries, modern patterns, design token architecture. _(risk: unknown)_
- **terraform-aws-modules**: Terraform module creation for AWS — reusable modules, state management, and HCL best practices. Use when building or reviewing Terraform AWS infrastructure. _(risk: unknown)_
- **terraform-module-library**: Build reusable Terraform modules for AWS, Azure, and GCP infrastructure following infrastructure-as-code best practices. Use when creating infrastructure modules, standardizing cloud provisioning, ... _(risk: unknown)_
- **terraform-skill**: Terraform infrastructure as code best practices _(risk: safe)_
- **terraform-specialist**: Expert Terraform/OpenTofu specialist mastering advanced IaC automation, state management, and enterprise infrastructure patterns. _(risk: unknown)_
- **test-automator**: Master AI-powered test automation with modern frameworks, self-healing tests, and comprehensive quality engineering. Build scalable testing strategies with advanced CI/CD integration. _(risk: unknown)_
- **upstash-qstash**: Upstash QStash expert for serverless message queues, scheduled jobs, and reliable HTTP-based task delivery without managing infrastructure. Use when: qstash, upstash queue, serverless cron, schedul... _(risk: unknown)_
- **using-neon**: Guides and best practices for working with Neon Serverless Postgres. Covers getting started, local development with Neon, choosing a connection method, Neon features, authentication (@neondatabase/... _(risk: safe)_
- **vercel-ai-sdk-expert**: Expert in the Vercel AI SDK. Covers Core API (generateText, streamText), UI hooks (useChat, useCompletion), tool calling, and streaming UI components with React and Next.js. _(risk: safe)_
- **vercel-automation**: Automate Vercel tasks via Rube MCP (Composio): manage deployments, domains, DNS, env vars, projects, and teams. Always search tools first for current schemas. _(risk: unknown)_
- **vercel-deployment**: Expert knowledge for deploying to Vercel with Next.js Use when: vercel, deploy, deployment, hosting, production. _(risk: safe)_
- **workflow-orchestration-patterns**: Design durable workflows with Temporal for distributed systems. Covers workflow vs activity separation, saga patterns, state management, and determinism constraints. Use when building long-running ... _(risk: unknown)_

## code

- **sankhya-dashboard-html-jsp-custom-best-pratices**: This skill should be used when the user asks for patterns, best practices, creation, or fixing of Sankhya dashboards using HTML, JSP, Java, and SQL. _(risk: safe)_

## code-quality

- **clean-code**: Applies principles from Robert C. Martin's 'Clean Code'. Use this skill when writing, reviewing, or refactoring code to ensure high quality, readability, and maintainability. Covers naming, functio... _(risk: safe)_
- **closed-loop-delivery**: Use when a coding task must be completed against explicit acceptance criteria with minimal user re-intervention across implementation, review feedback, deployment, and runtime verification. _(risk: safe)_
- **code-refactoring-context-restore**: Use when working with code refactoring context restore _(risk: unknown)_
- **code-refactoring-refactor-clean**: You are a code refactoring expert specializing in clean code principles, SOLID design patterns, and modern software engineering best practices. Analyze and refactor the provided code to improve its... _(risk: unknown)_
- **code-review-excellence**: Master effective code review practices to provide constructive feedback, catch bugs early, and foster knowledge sharing while maintaining team morale. Use when reviewing pull requests, establishing... _(risk: unknown)_
- **code-reviewer**: Elite code review expert specializing in modern AI-powered code _(risk: unknown)_
- **code-simplifier**: Simplifies and refines code for clarity, consistency, and maintainability while preserving all functionality. Use when asked to "simplify code", "clean up code", "refactor for clarity", "improve readability", or review recently modified code for elegance. Focuses on project-specific best practices. _(risk: unknown)_
- **codebase-cleanup-refactor-clean**: You are a code refactoring expert specializing in clean code principles, SOLID design patterns, and modern software engineering best practices. Analyze and refactor the provided code to improve its... _(risk: unknown)_
- **comprehensive-review-full-review**: Use when working with comprehensive review full review _(risk: unknown)_
- **error-handling-patterns**: Master error handling patterns across languages including exceptions, Result types, error propagation, and graceful degradation to build resilient applications. Use when implementing error handling... _(risk: unknown)_
- **fix-review**: Verify fix commits address audit findings without new bugs _(risk: safe)_
- **kaizen**: Guide for continuous improvement, error proofing, and standardization. Use this skill when the user wants to improve code quality, refactor, or discuss process improvements. _(risk: unknown)_
- **lint-and-validate**: Automatic quality control, linting, and static analysis procedures. Use after every code modification to ensure syntax correctness and project standards. Triggers onKeywords: lint, format, check, v... _(risk: unknown)_
- **receiving-code-review**: Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performat... _(risk: unknown)_
- **requesting-code-review**: Use when completing tasks, implementing major features, or before merging to verify work meets requirements _(risk: unknown)_
- **sharp-edges**: sharp-edges _(risk: unknown)_
- **uncle-bob-craft**: Use when performing code review, writing or refactoring code, or discussing architecture; complements clean-code and does not replace project linter/formatter. _(risk: safe)_
- **verification-before-completion**: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evide... _(risk: unknown)_
- **audit-agent-run-evidence**: Use when an agent, harness, gateway, MCP workflow, or multi-step automation claims completion and the available traces, checkpoints, approvals, tool calls, or deployment records must be judged without trusting self-reported success. _(risk: safe)_
- **babysit-pr**: Babysit a pull request through its bot review rounds: verify, fix, reply, resolve. Use for any babysit or watch-the-PR ask. _(risk: critical)_
- **break-ai-fix-loops**: Stop ineffective AI coding repair loops with stable failure fingerprints, a three-attempt budget, real-path proof, negative controls, and tested rollback. _(risk: critical)_
- **brooks-debt**: Tech debt assessment that identifies, classifies, and prioritizes maintainability problems — helping teams build a refactoring roadmap — drawing on twelve classic engineering books. _(risk: safe)_
- **brooks-harness**: Maintenance orchestrator for the brooks-lint plugin itself. _(risk: critical)_
- **brooks-review**: PR code review that surfaces decay risks, design smells, and maintainability issues with concrete Symptom → Source → Consequence → Remedy findings, drawing on twelve classic engineering books. _(risk: safe)_
- **brooks-sweep**: Full-sweep mode: runs a unified analysis across all quality dimensions — code decay, architecture, tech debt, and test quality — then applies fixes directly to the codebase. Safe changes are auto-applied; risky changes are confirmed before execution. _(risk: critical)_
- **bugs-are-annoying**: Adversarial code auditor that hunts down bugs, logic errors, and security flaws. Use for deep correctness passes, not style reviews. _(risk: critical)_
- **clean-code-guard**: Review generated or changed production code with Clean Code, SOLID, DRY, KISS, YAGNI, and LLM-specific failure-mode checks. _(risk: critical)_
- **complexity-cuts**: Lower Big-O on existing code via a one-transformation-at-a-time playbook with verify-revert-stop. For new code use lemmaly; for math-level wins escalate to mathguard. _(risk: safe)_
- **constraint-driven-development**: Write the project quality bar as enforced CONSTRAINTS.md so agents stop quietly lowering it: coverage, performance, accessibility thresholds watched on every diff. _(risk: safe)_
- **debate-review**: Two-model debate review of a GitHub PR, GitLab MR, Azure DevOps PR, or local working tree, posted as inline comments or printed. Use for any PR/MR review request, or a local review before a PR exists. _(risk: critical)_
- **doubt-driven-development**: Subjects every non-trivial decision to a fresh-context adversarial review before it stands. _(risk: critical)_
- **invariant-guard**: Correctness-first: forces writing the function contract, loop invariant, termination argument, and edge cases BEFORE code. Catches Boyer-Moore, leftmost binary search, QuickSelect traps. _(risk: safe)_
- **logic-diff**: Compare two code versions for semantic equivalence via semi-formal tracing of both versions side-by-side. _(risk: safe)_
- **logic-fix-all**: Autonomous repository-wide audit-and-fix pipeline: health → review → locate/explain → fix → diff-verify → iterate until clean. Starts with a mandatory consent prompt (token-intensive); after consent runs hands-free. _(risk: critical)_
- **logic-review**: Find logic bugs in a single file or function via semi-formal execution tracing (Premises → Trace → Divergence → Trigger → Remedy). _(risk: critical)_
- **lovable-cleanup**: Audits and strips Lovable scaffolding from Vite + React projects — removes lovable-tagger, swaps placeholder assets, prunes unused Radix deps, cleans generated docs, and neutralizes stale favicon/CDN caching so the codebase ships as yours. _(risk: critical)_
- **orchestrate-batch-refactor**: Plan and execute large refactors with dependency-aware work packets and parallel analysis. _(risk: safe)_
- **review-and-simplify-changes**: Review a git diff or explicit file scope for reuse, code quality, efficiency, clarity, and standards issues, then optionally apply safe Codex-driven fixes. _(risk: critical)_
- **review-swarm**: Parallel read-only multi-agent review of a current git diff or explicit file scope to find behavioral regressions, security or privacy risks, performance or reliability issues, and contract or test coverage gaps. _(risk: safe)_
- **sharp-coder**: Two-layer performance skill combining disciplined THINK layer (surgical edits, simplicity) and terse SPEAK layer (caveman compression). Triggers on requests for brevity, token efficiency, or disciplined coding.
 _(risk: safe)_
- **simplify-code**: Review a diff for clarity and safe simplifications, then optionally apply low-risk fixes. _(risk: safe)_
- **super-code**: Standing house style to enforce dense, correct, and idiomatic code on all coding tasks. Minimizes code bloat and agent operation overhead. _(risk: safe)_
- **ui-lint**: Quick automated lint — detects common design system violations in seconds _(risk: safe)_
- **ui-review**: Review UI code for design system compliance, accessibility, and best practices _(risk: safe)_
- **unslop-review**: Rewrites code review comments so they read like a human teammate wrote them. Cuts corporate-AI throat-clearing ("I noticed...", "I was wondering if perhaps...", "It might be worth considering..."). Each comment is direct: location, the issue, a concrete fix. _(risk: critical)_
- **vibers-code-review**: Human review workflow for AI-generated GitHub projects with spec-based feedback, security review, and follow-up PRs from the Vibers service. _(risk: critical)_
- **wp-guard**: Review generated or changed WordPress plugins, themes, and blocks for security, internationalization, performance, and API correctness. _(risk: offensive)_

## coding

- **faf-expert**: Advanced .faf (Foundational AI-context Format) specialist. IANA-registered format, MCP server config, championship scoring, bi-directional sync. _(risk: safe)_

## collaboration

- **viboscope**: Psychological compatibility matching — find cofounders, collaborators, and friends with explicit consent and unverified provider scoring _(risk: safe)_

## communication

- **a4a**: Connect your AI agent to the A4A end-to-end encrypted agent-to-agent messaging network via local MCP tools or Python SDK. _(risk: critical)_
- **cooper-email**: Give an AI agent its own email inbox with Cooper Email: send, receive, reply, and wait for replies or verification codes over MCP or HTTP. _(risk: critical)_

## competitor analysis

- **competitor-backlink-idea-generator**: Competitor Backlink Idea Generator. Use when working with your niche and competitor backlink examples or export. _(risk: safe)_
- **competitor-gap-analyzer**: Competitor Gap Analyzer. Use when working with your offering and at least one competitor profile. _(risk: safe)_
- **competitor-keyword-overlap-checker**: Competitor Keyword Overlap Checker. Use when working with two labeled keyword sets. _(risk: safe)_
- **competitor-summary-report-creator**: Competitor Summary Report Creator. Use when working with competitor names or URLs and evidence to summarize. _(risk: safe)_
- **content-length-comparator**: Content Length Comparator. Use when working with two or more labeled text samples. _(risk: safe)_
- **domain-comparison-report-tool**: Domain Comparison Report Tool. Use when working with two or more domains with dated comparable metrics. _(risk: safe)_
- **keyword-share-estimator**: Keyword Share Estimator. Use when working with comparable visibility values for your domain and selected competitors. _(risk: safe)_
- **meta-tag-comparison-tool**: Meta Tag Comparison Tool. Use when working with HTML or extracted metadata from two or more labeled pages. _(risk: safe)_
- **ranking-opportunity-finder**: Ranking Opportunity Finder. Use when working with query/page performance export or dated ranking evidence. _(risk: safe)_

## consulting

- **web-project-brainstorming**: Masterclass framework for brainstorming web development projects and page designs. Outlines structural phases for concept, UX flow, styling aesthetics, technical architecture, and SEO. _(risk: safe)_

## content

- **audio-transcriber**: Transform audio recordings into professional Markdown documentation with intelligent summaries using LLM integration _(risk: safe)_
- **youtube-summarizer**: Extract transcripts from YouTube videos and generate comprehensive, detailed summaries using intelligent analysis frameworks _(risk: safe)_
- **app-store-changelog**: Generate user-facing App Store release notes from git history since the last tag. _(risk: safe)_
- **changelog-updates**: Create release notes and product updates that developers actually read and care about. This skill covers changelog formatting, versioning communication, breaking change announcements, deprecation notices, and building anticipation for new features. _(risk: critical)_
- **copywriting-psychologist**: Write or revise conversion copy using audience awareness, motivations, and credible proof when ads, landing pages, or sales messages feel generic. _(risk: safe)_
- **crossframe-casebook**: Use when CrossFrame Suite routes explicit Chinese casebook work: turning materials into reusable cases, anonymized entries, mechanisms, and retrieval indexes. _(risk: safe)_
- **crossframe-critical**: Use only when the user explicitly names crossframe-critical for a Chinese structural critique dossier, article plan, or long-form critical essay. _(risk: safe)_
- **crossframe-debate**: Use when CrossFrame Suite routes explicit Chinese proposition testing, debate analysis, hidden-premise review, rebuttal design, or withdrawal condition checks. _(risk: safe)_
- **crossframe-dialogue**: Use when CrossFrame Suite routes explicit Chinese reader replies, editor responses, consultation-style short answers, or boundary-aware structural advice. _(risk: safe)_
- **crossframe-essay**: Use when explicit CrossFrame work needs a Chinese critical insight essay, commentary, concept essay, public piece, or structure-to-article draft after diagnosis. _(risk: safe)_
- **crossframe-notebook**: Use when CrossFrame Suite routes explicit Chinese notes for books, theories, articles, excerpts, bidirectional reading, absorption, or conflict mapping. _(risk: safe)_
- **crossframe-teach**: Use when CrossFrame Suite routes explicit Chinese teaching of CrossFrame concepts, misreading boundaries, plain-language examples, signals, or exercises. _(risk: safe)_
- **cv-generator**: Generate professional, ATS-optimized CVs for FlowCV, Canva, Google Docs, or Word. Handles multi-source merging, JD targeting, seniority adaptation, and humanized rewriting. Outputs paste-ready text with an ATS flaw report and improvement suggestions. _(risk: safe)_
- **defuddle**: Extract clean markdown content from web pages using Defuddle CLI, removing clutter and navigation to save tokens. Use instead of WebFetch when the user provides a URL to read or analyze, for online documentation, articles, blog posts, or any standard web page. _(risk: critical)_
- **dev-to-hashnode**: When the user wants to publish on Dev.to, Hashnode, or other developer blogging platforms. Trigger phrases include "Dev.to," "Hashnode," "developer blog," "cross-posting," "technical blogging," "canonical URL," or "developer content platform." _(risk: critical)_
- **developer-onboarding**: Get developers to "Hello World" fast with optimized quickstarts, tutorials, and sample apps. _(risk: critical)_
- **developer-seo**: SEO strategy for technical queries and developer audiences. Covers keyword research for "how to X in language" queries, error message SEO, Stack Overflow-style content, technical long-tail keywords, and competing with official documentation sites. _(risk: critical)_
- **devrel-content**: When the user wants to create technical content for developers including blog posts, tutorials, and documentation. _(risk: critical)_
- **docs-generator**: Generate technical deliverables from completed analysis: reverse-engineering reports, penetration-test reports, CTF write-ups, and signature-analysis documentation with evidence-backed structure. _(risk: critical)_
- **docs-guard**: Review generated or changed documentation before it ships, including READMEs, API references, docstrings, changelogs, tutorials, and documentation sites. _(risk: critical)_
- **documentation-and-adrs**: Records decisions and documentation. Use when making architectural decisions, changing public APIs, shipping features, or when you need to record context that future engineers and agents will need to understand the codebase. _(risk: critical)_
- **emotional-arc-designer**: Map the emotional progression of a narrative, page, or campaign when content needs a coherent path from attention to action. _(risk: safe)_
- **hugo-to-markdown**: Convert Hugo documentation sites and Hugo-managed content into standard Markdown. _(risk: critical)_
- **humanize-chinese**: Detect and rewrite AI-like Chinese text with a practical workflow for scoring, humanization, academic AIGC reduction, and style conversion. Use when the user asks to 去AI味, 降AIGC, 去除AI痕迹, 论文降重, 知网检测, 维普检测, humanize chinese, detect AI text, or make Chinese text sound more natural. _(risk: safe)_
- **internal-comms**: Write internal communications such as status reports, leadership updates, 3P updates, newsletters, FAQs, incident reports, and project updates using repeatable internal formats. _(risk: safe)_
- **renhua**: Write Chinese social posts and product copy in a real person's voice, removing AI tells. Use for 小红书, X 帖子, 日记, 朋友圈, 产品介绍, 去 AI 味, 说人话. _(risk: safe)_
- **seo**: Run a broad SEO audit across technical SEO, on-page SEO, schema, sitemaps, content quality, AI search readiness, and GEO. Use as the umbrella skill when the user asks for a full SEO analysis or strategy. _(risk: critical)_
- **seo-aeo-blog-writer**: Writes search-intent-led long-form articles with answer-first structure, FAQ coverage, internal links, and conversion paths for SEO and AEO. _(risk: safe)_
- **seo-aeo-content-cluster**: Builds a topical authority map from business goals, search intent, existing content, and gaps, then prioritises foundational and supporting pages. _(risk: safe)_
- **seo-aeo-content-quality-auditor**: Audits a website, codebase, page, or content set for technical SEO, search intent, AEO, conversion paths, and publishing readiness, then produces prioritised fixes that can be implemented and verified. _(risk: safe)_
- **seo-aeo-keyword-research**: Researches and prioritises keywords from the site context and live search intent, including problem queries, question queries, difficulty tiers, and a content map. _(risk: safe)_
- **seo-content**: Content quality and E-E-A-T analysis with AI citation readiness assessment. Use when user says "content quality", "E-E-A-T", "content analysis", "readability check", "thin content", or "content audit".
 _(risk: critical)_
- **seo-image-gen**: Generate SEO-focused images such as OG cards, hero images, schema assets, product visuals, and infographics. Use when image generation is part of an SEO workflow or content publishing task. _(risk: critical)_
- **seo-plan**: Strategic SEO planning for new or existing websites. Industry-specific templates, competitive analysis, content strategy, and implementation roadmap. Use when user says "SEO plan", "SEO strategy", "content strategy", "site architecture", or "SEO roadmap".
 _(risk: critical)_
- **slideops**: Turn a repository into a cited HTML slide deck and detect the day it drifts from the code. Citations record file, lines, and hash; a stdlib check reports CURRENT, MOVED, or CHANGED. _(risk: critical)_
- **story-bible-continuity**: Deterministic continuity check for long manuscripts against a story bible: name drift, age arithmetic, era anachronisms, unpaid foreshadowing, POV leaks. Use for continuity checks on novels or serials. _(risk: safe)_
- **technical-tutorials**: When the user wants to create step-by-step technical tutorials, quickstarts, or code walkthroughs. Trigger phrases include "tutorial," "quickstart," "getting started guide," "walkthrough," "step by step," "how to guide," "hands-on guide," or "code tutorial." _(risk: critical)_
- **unslop-file**: Humanize natural-language memory files (CLAUDE.md, todos, preferences, docs) by removing AI-isms and adding burstiness while preserving every code block, URL, path, command, and heading exactly. _(risk: critical)_
- **wordpress-centric-high-seo-optimized-blogwriting-skill**: Generate clean, human-sounding, SEO-optimized WordPress blog posts with optional Yoast metadata, JSON-LD schema markup, and image SEO planning. Supports modular batch output. _(risk: safe)_
- **writing-guidelines**: Curated upstream guidance for Writing Guidelines; use when the workflow matches the user goal. _(risk: unknown)_
- **youtube-seo-optimizer**: Generate complete YouTube & podcast SEO packages with live-researched keywords — titles, descriptions, tags, hashtags, chapters, and audit fixes. Use for new or underperforming content.
 _(risk: safe)_

## content seo

- **blog-title-generator**: Blog Title Generator. Use when working with topic or page summary. _(risk: safe)_
- **content-freshness-checker**: Content Freshness Checker. Use when working with content and known publication or update date if available. _(risk: safe)_
- **content-gap-finder**: Content Gap Finder. Use when working with existing content inventory and audience goal. _(risk: safe)_
- **faq-generator**: FAQ Generator. Use when working with actual questions plus answer facts. _(risk: safe)_
- **featured-snippet-optimizer**: Featured Snippet Optimizer. Use when working with target question and existing passage. _(risk: safe)_
- **headline-analyzer**: Headline Analyzer. Use when working with headline and intended article summary. _(risk: safe)_
- **keyword-placement-highlighter**: Keyword Placement Highlighter. Use when working with text and target keywords. _(risk: safe)_
- **meta-description-writer**: Meta Description Writer. Use when working with page content or factual summary. _(risk: safe)_
- **paragraph-keyword-optimizer**: Paragraph Keyword Optimizer. Use when working with paragraph and target keyword. _(risk: safe)_
- **product-description-generator**: Product Description Generator. Use when working with verified product features and intended buyer. _(risk: safe)_
- **readability-enhancer**: Readability Enhancer. Use when working with text and optional reader level. _(risk: safe)_
- **tone-of-voice-analyzer**: Tone of Voice Analyzer. Use when working with text and optional brand voice sample. _(risk: safe)_

## content-documentation

- **blog-writing-guide**: Write, review, and improve blog posts for the Sentry engineering blog following Sentry's specific writing standards, voice, and quality bar. Use this skill whenever someone asks to write a blog post, draft a technical article, review blog content, improve a draft, write a... _(risk: unknown)_
- **brand-guidelines**: Write copy following Sentry brand guidelines. Use when writing UI text, error messages, empty states, onboarding flows, 404 pages, documentation, marketing copy, or any user-facing content. Covers both Plain Speech (default) and Sentry Voice tones. _(risk: unknown)_
- **c4-architecture-c4-architecture**: Generate comprehensive C4 architecture documentation for an existing repository/codebase using a bottom-up analysis approach. _(risk: unknown)_
- **c4-code**: Expert C4 Code-level documentation specialist. Analyzes code directories to create comprehensive C4 code-level documentation including function signatures, arguments, dependencies, and code structure. _(risk: unknown)_
- **c4-component**: Expert C4 Component-level documentation specialist. Synthesizes C4 Code-level documentation into Component-level architecture, defining component boundaries, interfaces, and relationships. _(risk: unknown)_
- **c4-context**: Expert C4 Context-level documentation specialist. Creates high-level system context diagrams, documents personas, user journeys, system features, and external dependencies. _(risk: unknown)_
- **canvas-design**: Create beautiful visual art in .png and .pdf documents using design philosophy. You should use this skill when the user asks to create a poster, piece of art, design, or other static piece. Create ... _(risk: unknown)_
- **code-documentation-code-explain**: You are a code education expert specializing in explaining complex code through clear narratives, visual diagrams, and step-by-step breakdowns. Transform difficult concepts into understandable expl... _(risk: unknown)_
- **code-documentation-doc-generate**: You are a documentation expert specializing in creating comprehensive, maintainable documentation from code. Generate API docs, architecture diagrams, user guides, and technical references using AI... _(risk: unknown)_
- **codex-review**: Professional code review with auto CHANGELOG generation, integrated with Codex AI _(risk: unknown)_
- **copywriting**: Write rigorous, conversion-focused marketing copy for landing pages and emails. Enforces brief confirmation and strict no-fabrication rules. _(risk: unknown)_
- **customs-trade-compliance**: Codified expertise for customs documentation, tariff classification, duty optimisation, restricted party screening, and regulatory compliance across multiple jurisdictions. _(risk: safe)_
- **daily**: Documentation and capabilities reference for Daily _(risk: safe)_
- **daily-news-report**: Scrapes content based on a preset URL list, filters high-quality technical information, and generates daily Markdown reports. _(risk: unknown)_
- **doc-coauthoring**: Guide users through a structured workflow for co-authoring documentation. Use when user wants to write documentation, proposals, technical specs, decision docs, or similar structured content. This ... _(risk: unknown)_
- **documentation-generation-doc-generate**: You are a documentation expert specializing in creating comprehensive, maintainable documentation from code. Generate API docs, architecture diagrams, user guides, and technical references using AI... _(risk: unknown)_
- **documentation-templates**: Documentation templates and structure guidelines. README, API docs, code comments, and AI-friendly documentation. _(risk: unknown)_
- **employment-contract-templates**: Create employment contracts, offer letters, and HR policy documents following legal best practices. Use when drafting employment agreements, creating HR policies, or standardizing employment docume... _(risk: unknown)_
- **evolution**: CRITICAL: Use for makepad-skills self-evolution and contribution. Triggers on:
evolve, evolution, contribute, contribution, self-improve, self-improvement,
add pattern, new pattern, capture learning, document solution,
hooks, hook system, auto-trigger, skill... _(risk: unknown)_
- **hig-project-context**: Create or update a shared Apple design context document that other HIG skills use to tailor guidance. _(risk: unknown)_
- **hugging-face-evaluation**: Add and manage evaluation results in Hugging Face model cards. Supports extracting eval tables from README content, importing scores from Artificial Analysis API, and running custom model evaluations with vLLM/lighteval. Works with the model-index metadata format. _(risk: unknown)_
- **hugging-face-paper-publisher**: Publish and manage research papers on Hugging Face Hub. Supports creating paper pages, linking papers to models/datasets, claiming authorship, and generating professional markdown-based research articles. _(risk: unknown)_
- **i18n-localization**: Internationalization and localization patterns. Detecting hardcoded strings, managing translations, locale files, RTL support. _(risk: unknown)_
- **nanobanana-ppt-skills**: AI-powered PPT generation with document analysis and styled images _(risk: safe)_
- **odoo-edi-connector**: Guide for implementing EDI (Electronic Data Interchange) with Odoo: X12, EDIFACT document mapping, partner onboarding, and automated order processing. _(risk: unknown)_
- **odoo-l10n-compliance**: Country-specific Odoo localization: tax configuration, e-invoicing (CFDI, FatturaPA, SAF-T), fiscal reporting, and country chart of accounts setup. _(risk: unknown)_
- **on-call-handoff-patterns**: Master on-call shift handoffs with context transfer, escalation procedures, and documentation. Use when transitioning on-call responsibilities, documenting shift summaries, or improving on-call pro... _(risk: unknown)_
- **professional-proofreader**: Use when a user asks to "proofread", "review and correct", "fix grammar", "improve readability while keeping my voice", and to proofread a document file and save an updated version.
 _(risk: safe)_
- **readme**: When the user wants to create or update a README.md file for a project. Also use when the user says 'write readme,' 'create readme,' 'document this project,' 'project documentation,' or asks for he... _(risk: safe)_
- **sred-project-organizer**: Take a list of projects and their related documentation, and organize them into the SRED format for submission. _(risk: unknown)_
- **startup-business-analyst-business-case**: Generate comprehensive investor-ready business case document with
market, solution, financials, and strategy
 _(risk: unknown)_
- **tutorial-engineer**: Creates step-by-step tutorials and educational content from code. Transforms complex concepts into progressive learning experiences with hands-on examples. _(risk: safe)_
- **wiki-onboarding**: Generates two complementary onboarding guides — a Principal-Level architectural deep-dive and a Zero-to-Hero contributor walkthrough. Use when the user wants onboarding documentation fo... _(risk: unknown)_
- **wiki-page-writer**: Generates rich technical documentation pages with dark-mode Mermaid diagrams, source code citations, and first-principles depth. Use when writing documentation, generating wiki pages, creating tech... _(risk: unknown)_

## content-writing

- **de-ai-writer**: Chinese AI-smell removal engine: 35 Chinese AI-tell patterns (赋能/闭环), AI-smell scoring, de-AI rewriting, style clone. Use when a Chinese draft reads machine-written or the user asks 去AI味. _(risk: safe)_

## context-optimization

- **geminiignore-finops**: Configure and optimize .geminiignore files for AI context window efficiency and token cost reduction (FinOps). _(risk: safe)_

## core-dev

- **vscode-extension-guide-en**: Guide for VS Code extension development from scaffolding to Marketplace publication _(risk: safe)_

## creative

- **algorithmic-art**: Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields,... _(risk: unknown)_
- **interactive-portfolio**: Expert in building portfolios that actually land jobs and clients - not just showing work, but creating memorable experiences. Covers developer portfolios, designer portfolios, creative portfolios,... _(risk: unknown)_
- **scroll-experience**: Expert in building immersive scroll-driven experiences - parallax storytelling, scroll animations, interactive narratives, and cinematic web experiences. Like NY Times interactives, Apple product p... _(risk: unknown)_
- **article-illustrations**: Generate hand-drawn 16:9 article illustrations with the Grav character IP, sparse annotations, and absurd but clear visual metaphors. _(risk: safe)_
- **liuguang-banlan-ui**: Builds two parameterized UI modes—流光溢彩白 (iridescent white) and 五彩斑斓黑 (colorful black)—with OKLCH, WebGL/CSS fallback, vision gating, screenshot QA, and total/per-color intensity reports. Use when a UI request names either mode or needs measured color parameters. _(risk: critical)_
- **modellix**: Integrate the Modellix API/CLI for async AI image, video, and speech generation or transcription (model run --wait, task download). _(risk: critical)_

## data

- **x-twitter-scraper**: X (Twitter) data platform skill — tweet search, user lookup, follower extraction, engagement metrics, giveaway draws, monitoring, webhooks, 19 extraction tools, MCP server. _(risk: safe)_
- **analytics**: When the user wants to set up, improve, or audit analytics tracking and measurement. _(risk: critical)_
- **apify-facebook-ads-library-scraper**: Research Meta Ad Library ads by advertiser or keyword with creative links, dates and disclosed reach or spend through the harshmaur/facebook-ads-library-scraper Apify Actor. _(risk: critical)_
- **apify-linkedin-jobs-scraper**: Search and export LinkedIn job postings with salary, seniority, recruiter and company fields using the harshmaur/linkedin-jobs-scraper Apify Actor. No LinkedIn login. _(risk: critical)_
- **apify-reddit-scraper**: Scrape Reddit posts, comments, subreddits and users with the harshmaur/reddit-scraper Apify Actor. No Reddit API key. Keyword search, date windows, full threads. _(risk: critical)_
- **apify-tiktok-scraper**: Research TikTok videos, profiles, hashtags, comments and followers with engagement statistics through the harshmaur/tiktok-scraper Apify Actor. No TikTok login. _(risk: critical)_
- **apify-youtube-transcript-scraper**: Get YouTube captions, timestamped quotations, SRT/VTT and translated transcripts for videos, channels and playlists through the harshmaur/youtube-transcript-scraper Apify Actor. _(risk: critical)_
- **arrowspace**: Spectral vector search using graph Laplacian eigenstructure. Use when cosine/L2 similarity misses latent structure in your embeddings. _(risk: safe)_
- **datacircle**: Every GTM API plan on datacircle.dev, as one file you download and query. Use it to compare or price a GTM data API. _(risk: critical)_
- **datawebot**: Find products for sale across online shops, list returned sellers' prices with direct links, and run Amazon and Shopify extraction Jobs through the hosted datawebot MCP server. _(risk: critical)_
- **footval-follow-matches-and-tables**: Football scores, fixtures, match centres and league tables through FootVal: live and past results, a team's next or last matches, events, statistics, line-ups and standings. _(risk: safe)_
- **footval-scout-and-rank-players**: Scout and rank footballers with FootVal: shortlists by league, position, age, foot and value; undervalued, overvalued, rising and young players; club, league and national squads. _(risk: safe)_
- **footval-stats-and-transfer-news**: Football season leaderboards and transfer news from FootVal: top scorers, assists, minutes and appearances per competition, plus confirmed transfers and rumours with reliability. _(risk: safe)_
- **footval-value-and-compare-players**: Explain what a footballer is worth with FootVal: its own transfer value next to the market value, the factors behind the gap, and comparisons of two to four players. _(risk: safe)_
- **glasser**: Search, inspect, and run third-party data APIs through one CLI when the environment has no suitable integration. _(risk: critical)_
- **huggingface-datasets**: Use this skill for Hugging Face Dataset Viewer API workflows that fetch subset/split metadata, paginate rows, search text, apply filters, download parquet URLs, and read size or statistics. _(risk: unknown)_
- **invokely-statistics**: Use Invokely MCP to find official statistics, retrieve values and series, compare or rank places, and report each figure with its period, unit, and source citation. _(risk: safe)_
- **looot**: Search, price and run 2,500+ data API endpoints (work emails, company search, SERP, web pages) from one prepaid balance via the looot MCP server. _(risk: critical)_
- **monte-carlo-asset-health**: Curated upstream guidance for Monte Carlo Asset Health; use when the workflow matches the user goal. _(risk: critical)_
- **monte-carlo-context-detection**: Route data-related requests to the right Monte Carlo skill or workflow. USE WHEN alerts, incidents, data broken, stale, coverage gaps, data quality, or any ambiguous data observability request. _(risk: critical)_
- **monte-carlo-monitor-creation**: Guides creation of Monte Carlo monitors via MCP tools, producing monitors-as-code YAML for CI/CD deployment. _(risk: safe)_
- **monte-carlo-performance-diagnosis**: Diagnoses pipeline performance issues -- slow jobs, expensive queries, latency trends -- using Monte Carlo's cross-platform observability. Uses a tiered investigation approach: discover problems, bridge to affected tables, then drill into root causes. _(risk: critical)_
- **monte-carlo-prevent**: Surfaces Monte Carlo data observability context (table health, alerts, lineage, blast radius) before SQL/dbt edits. _(risk: critical)_
- **monte-carlo-push-ingestion**: Review and adapt warehouse metadata, lineage and query-log collection templates for an explicitly authorized Monte Carlo destination. _(risk: critical)_
- **monte-carlo-remediation**: Investigate and remediate data quality alerts using Monte Carlo MCP tools. Runs root cause analysis, assesses blast radius, discovers available tools (MCP/CLI/API), proposes and executes fixes, or escalates with full context when uncertain. _(risk: critical)_
- **monte-carlo-storage-cost-analysis**: Analyze a warehouse for stale, unused, or redundant tables via the analyze_storage_costs MCP tool. Classifies waste patterns and table categories, computes safety tiers, and handles category drill-downs and lineage follow-ups. _(risk: critical)_
- **monte-carlo-validation-notebook**: Generates SQL validation notebooks for dbt PR changes with before/after comparison queries. _(risk: critical)_
- **nexrad-mosaic-access**: Access official NOAA/NCEP MRMS radar and multisensor composites for a region and time; validate product, grid, domain, quality, timestamp, and provenance. _(risk: safe)_
- **nexrad-product-access**: Discover and access NEXRAD data for a selected radar site, time, product, or Level II moment using completed archive volumes, real-time chunks, or supported Level III sources with metadata validation. _(risk: safe)_
- **noaa-radar-satellite-fetching**: Retrieve NOAA NEXRAD and GOES products from public cloud archives using verified site, product, channel, sector, and scan-time selection. _(risk: safe)_
- **optim-agent**: Guide agent-driven parameter optimization for configurable systems with measurable objectives. Use for HPO, inference tuning, simulations, or RL/control experiments. _(risk: safe)_
- **pangolinfo-amazon-data-research**: Plan and run read-only Amazon product, review, category, seller, and market research through Pangolinfo's documented MCP bridge. _(risk: safe)_
- **postgres-readonly-queries**: Execute safe read-only SQL queries against PostgreSQL databases with multi-connection support and defense-in-depth write protection. _(risk: critical)_
- **sql-sentinel**: Audit SQL for the cost & performance anti-patterns that burn warehouse credits. Scores warehouse health 0-100 and outputs a prioritized cost-reduction plan for BigQuery, Snowflake, Redshift, and Postgres. _(risk: critical)_
- **us-watchlist-alerts**: Free US stock watchlists, price alerts and daily briefs; no API key, NYSE-holiday aware. Informational only, never places trades. _(risk: safe)_
- **warehouse**: Plan and review read-only data warehouse analysis with explicit scope, privacy, provenance, and validation checks. _(risk: critical)_
- **weather-data-lifecycle-management**: Manage ownership, retention, and cleanup of downloaded weather data across one-shot jobs, interactive viewers, caches, failures, and cancellation. _(risk: safe)_
- **weather-data-reproducibility**: Record and verify provenance manifests for weather-data inputs and derived artifacts, including object identity, selections, software versions, transformations, and hashes. _(risk: safe)_
- **weather-model-data-fetching**: Retrieve numerical weather prediction data from public AWS S3 and HTTP archives using GRIB2 inventories, byte ranges, Herbie, provider fallbacks, and verified caching. _(risk: safe)_
- **weather-model-run-discovery**: Resolve the newest complete numerical weather prediction cycle and forecast objects across provider mirrors without downloading full payloads. _(risk: safe)_
- **weather-observation-fetching**: Retrieve surface and upper-air weather observations from authoritative APIs and archives with station identity, time, units, and quality flags preserved. _(risk: safe)_
- **weather-pipeline-performance-diagnosis**: Diagnose slow weather-data workflows by measuring discovery, transfer, parsing, scientific processing, and rendering separately before changing code. _(risk: safe)_

## data-ai

- **local-llm-expert**: Master local LLM inference, model selection, VRAM optimization, and local deployment using Ollama, llama.cpp, vLLM, and LM Studio. Expert in quantization formats (GGUF, EXL2) and local AI privacy. _(risk: unknown)_
- **seek-and-analyze-video**: Seek and analyze video content using Memories.ai Large Visual Memory Model for persistent video intelligence _(risk: safe)_
- **ai-engineering-toolkit**: Overview of six AI engineering workflows: prompt evaluation (8-dimension scoring), context budget planning, RAG pipeline design, agent security audit (65-point checklist), eval harness building, and product sense coaching. _(risk: offensive)_
- **recsys-pipeline-architect**: Designs composable recommendation, ranking, and feed pipelines using the six-stage Source→Hydrator→Filter→Scorer→Selector→SideEffect framework _(risk: critical)_

## data-engineering

- **ab-test-setup**: Structured guide for setting up A/B tests with mandatory gates for hypothesis, metrics, and execution readiness. _(risk: unknown)_
- **airflow-dag-patterns**: Build production Apache Airflow DAGs with best practices for operators, sensors, testing, and deployment. Use when creating data pipelines, orchestrating workflows, or scheduling batch jobs. _(risk: unknown)_
- **amplitude-automation**: Automate Amplitude tasks via Rube MCP (Composio): events, user activity, cohorts, user identification. Always search tools first for current schemas. _(risk: unknown)_
- **analytics-product**: Analytics de produto — PostHog, Mixpanel, eventos, funnels, cohorts, retencao, north star metric, OKRs e dashboards de produto. Ativar para: configurar tracking de eventos, criar funil de...
- **analytics-tracking**: Design, audit, and improve analytics tracking systems that produce reliable, decision-ready data. _(risk: unknown)_
- **apify-content-analytics**: Track engagement metrics, measure campaign ROI, and analyze content performance across Instagram, Facebook, YouTube, and TikTok. _(risk: unknown)_
- **app-store-optimization**: Complete App Store Optimization (ASO) toolkit for researching, optimizing, and tracking mobile app performance on Apple App Store and Google Play Store _(risk: unknown)_
- **business-analyst**: Master modern business analysis with AI-powered analytics, real-time dashboards, and data-driven insights. Build comprehensive KPI frameworks, predictive models, and strategic recommendations. _(risk: unknown)_
- **calendly-automation**: Automate Calendly scheduling, event management, invitee tracking, availability checks, and organization administration via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **carrier-relationship-management**: Codified expertise for managing carrier portfolios, negotiating freight rates, tracking carrier performance, allocating freight, and maintaining strategic carrier relationships. _(risk: safe)_
- **computer-vision-expert**: SOTA Computer Vision Expert (2026). Specialized in YOLO26, Segment Anything 3 (SAM 3), Vision Language Models, and real-time spatial analysis. _(risk: unknown)_
- **data-engineering-data-driven-feature**: Build features guided by data insights, A/B testing, and continuous measurement using specialized agents for analysis, implementation, and experimentation. _(risk: unknown)_
- **data-engineering-data-pipeline**: You are a data pipeline architecture expert specializing in scalable, reliable, and cost-effective data pipelines for batch and streaming data processing. _(risk: unknown)_
- **data-quality-frameworks**: Implement data quality validation with Great Expectations, dbt tests, and data contracts. Use when building data quality pipelines, implementing validation rules, or establishing data contracts. _(risk: unknown)_
- **data-storytelling**: Transform data into compelling narratives using visualization, context, and persuasive structure. Use when presenting analytics to stakeholders, creating data reports, or building executive present... _(risk: unknown)_
- **data-structure-protocol**: Give agents persistent structural memory of a codebase — navigate dependencies, track public APIs, and understand why connections exist without re-reading the whole repo. _(risk: safe)_
- **dbt-transformation-patterns**: Master dbt (data build tool) for analytics engineering with model organization, testing, documentation, and incremental strategies. Use when building data transformations, creating data models, or ... _(risk: unknown)_
- **fal-platform**: Platform APIs for model management, pricing, and usage tracking _(risk: safe)_
- **google-analytics-automation**: Automate Google Analytics tasks via Rube MCP (Composio): run reports, list accounts/properties, funnels, pivots, key events. Always search tools first for current schemas. _(risk: unknown)_
- **instagram**: Integracao completa com Instagram via Graph API. Publicacao, analytics, comentarios, DMs, hashtags, agendamento, templates e gestao de contas Business/Creator. _(risk: critical)_
- **mailchimp-automation**: Automate Mailchimp email marketing including campaigns, audiences, subscribers, segments, and analytics via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **mixpanel-automation**: Automate Mixpanel tasks via Rube MCP (Composio): events, segmentation, funnels, cohorts, user profiles, JQL queries. Always search tools first for current schemas. _(risk: unknown)_
- **ml-pipeline-workflow**: Build end-to-end MLOps pipelines from data preparation through model training, validation, and production deployment. Use when creating ML pipelines, implementing MLOps practices, or automating mod... _(risk: unknown)_
- **mlops-engineer**: Build comprehensive ML pipelines, experiment tracking, and model registries with MLflow, Kubeflow, and modern MLOps tools. _(risk: unknown)_
- **moodle-external-api-development**: Create custom external web service APIs for Moodle LMS. Use when implementing web services for course management, user tracking, quiz operations, or custom plugin functionality. Covers parameter va... _(risk: unknown)_
- **odoo-project-timesheet**: Expert guide for Odoo Project and Timesheets: task stages, billable time tracking, timesheet approval, budget alerts, and invoicing from timesheets. _(risk: safe)_
- **odoo-sales-crm-expert**: Expert guide for Odoo Sales and CRM: pipeline stages, quotation templates, pricelists, sales teams, lead scoring, and forecasting. _(risk: safe)_
- **pipedrive-automation**: Automate Pipedrive CRM operations including deals, contacts, organizations, activities, notes, and pipeline management via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **product-manager**: Senior PM agent with 6 knowledge domains, 30+ frameworks, 12 templates, and 32 SaaS metrics with formulas. Pure Markdown, zero scripts. _(risk: unknown)_
- **quant-analyst**: Build financial models, backtest trading strategies, and analyze market data. Implements risk metrics, portfolio optimization, and statistical arbitrage. _(risk: unknown)_
- **scala-pro**: Master enterprise-grade Scala development with functional programming, distributed systems, and big data processing. Expert in Apache Pekko, Akka, Spark, ZIO/Cats Effect, and reactive architectures. _(risk: unknown)_
- **scanpy**: Standard single-cell RNA-seq analysis pipeline. Use for QC, normalization, dimensionality reduction (PCA/UMAP/t-SNE), clustering, differential expression, and visualization. Best for exploratory scRNA-seq analysis with established workflows. For... _(risk: unknown)_
- **seaborn**: Statistical visualization with pandas integration. Use for quick exploration of distributions, relationships, and categorical comparisons with attractive defaults. Best for box plots, violin plots, pair plots, heatmaps. Built on matplotlib. For interactive plots use plotly;... _(risk: unknown)_
- **segment-automation**: Automate Segment tasks via Rube MCP (Composio): track events, identify users, manage groups, page views, aliases, batch operations. Always search tools first for current schemas. _(risk: unknown)_
- **sendgrid-automation**: Automate SendGrid email operations including sending emails, managing contacts/lists, sender identities, templates, and analytics via Rube MCP (Composio). Always search tools first for current sche... _(risk: unknown)_
- **spark-optimization**: Optimize Apache Spark jobs with partitioning, caching, shuffle optimization, and memory tuning. Use when improving Spark performance, debugging slow jobs, or scaling data processing pipelines. _(risk: unknown)_
- **startup-metrics-framework**: This skill should be used when the user asks about \\\"key startup metrics", "SaaS metrics", "CAC and LTV", "unit economics", "burn multiple", "rule of 40", "marketplace metrics", or requests... _(risk: unknown)_
- **youtube-automation**: Automate YouTube tasks via Rube MCP (Composio): upload videos, manage playlists, search content, get analytics, and handle comments. Always search tools first for current schemas. _(risk: unknown)_
- **zoom-automation**: Automate Zoom meeting creation, management, recordings, webinars, and participant tracking via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **snowflake-development**: Comprehensive Snowflake development assistant covering SQL best practices, data pipeline design (Dynamic Tables, Streams, Tasks, Snowpipe), Cortex AI functions, Cortex Agents, Snowpark Python, dbt integration, performance tuning, and security hardening. _(risk: safe)_

## database

- **cc-skill-clickhouse-io**: ClickHouse database patterns, query optimization, analytics, and data engineering best practices for high-performance analytical workloads. _(risk: unknown)_
- **claimable-postgres**: Provision instant temporary Postgres databases via Claimable Postgres by Neon (pg.new). No login or credit card required. Use for quick Postgres environments and throwaway DATABASE_URL for prototyping. _(risk: unknown)_
- **database-admin**: Expert database administrator specializing in modern cloud databases, automation, and reliability engineering. _(risk: unknown)_
- **database-architect**: Expert database architect specializing in data layer design from scratch, technology selection, schema modeling, and scalable database architectures. _(risk: unknown)_
- **database-cloud-optimization-cost-optimize**: You are a cloud cost optimization expert specializing in reducing infrastructure expenses while maintaining performance and reliability. Analyze cloud spending, identify savings opportunities, and ... _(risk: unknown)_
- **database-migration**: Execute database migrations across ORMs and platforms with zero-downtime strategies, data transformation, and rollback procedures. Use when migrating databases, changing schemas, performing data tr... _(risk: unknown)_
- **database-migrations-sql-migrations**: SQL database migrations with zero-downtime strategies for PostgreSQL, MySQL, and SQL Server. Focus on data integrity and rollback plans. _(risk: unknown)_
- **database-optimizer**: Expert database optimizer specializing in modern performance tuning, query optimization, and scalable architectures. _(risk: unknown)_
- **food-database-query**: Food Database Query _(risk: unknown)_
- **nosql-expert**: Expert guidance for distributed NoSQL databases (Cassandra, DynamoDB). Focuses on mental models, query-first modeling, single-table design, and avoiding hot partitions in high-scale systems. _(risk: unknown)_
- **odoo-backup-strategy**: Complete Odoo backup and restore strategy: database dumps, filestore backup, automated scheduling, cloud storage upload, and tested restore procedures. _(risk: safe)_
- **odoo-module-developer**: Expert guide for creating custom Odoo modules. Covers __manifest__.py, model inheritance, ORM patterns, and module structure best practices. _(risk: safe)_
- **odoo-orm-expert**: Master Odoo ORM patterns: search, browse, create, write, domain filters, computed fields, and performance-safe query techniques. _(risk: safe)_
- **postgres-best-practices**: Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres queries, schema designs, or database configurations. _(risk: unknown)_
- **postgresql**: Design a PostgreSQL-specific schema. Covers best-practices, data types, indexing, constraints, performance patterns, and advanced features _(risk: unknown)_
- **prisma-expert**: Prisma ORM expert for schema design, migrations, query optimization, relations modeling, and database operations. Use PROACTIVELY for Prisma schema issues, migration problems, query performance, re... _(risk: unknown)_
- **pydantic-models-py**: Create Pydantic models following the multi-model pattern with Base, Create, Update, Response, and InDB variants. Use when defining API request/response schemas, database models, or data validation ... _(risk: unknown)_
- **sql-optimization-patterns**: Master SQL query optimization, indexing strategies, and EXPLAIN analysis to dramatically improve database performance and eliminate slow queries. Use when debugging slow queries, designing database... _(risk: unknown)_
- **sqlmap-database-pentesting**: This skill should be used when the user asks to "automate SQL injection testing," "enumerate database structure," "extract database credentials using sqlmap," "dump tables and columns... _(risk: unknown)_
- **supabase-automation**: Automate Supabase database queries, table management, project administration, storage, edge functions, and SQL execution via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **database-security**: Authorized database security assessment across PostgreSQL, MySQL, MSSQL, MongoDB, and Redis: exposure, authorization gaps, UDF/command execution paths, and misconfiguration review. _(risk: offensive)_
- **neon-postgres-branches**: Choose and create the right Neon branch type for testing and development. Use when users ask about Neon branching, migration testing with real data, isolated test environments, schema-only branch workflows for sensitive data, or branch creation via Neon CLI or Neon MCP. _(risk: critical)_
- **neon-postgres-egress-optimizer**: Diagnose and fix excessive Postgres egress (network data transfer) in a codebase. _(risk: critical)_
- **postgresql-cli**: PostgreSQL interactive terminal (psql) reference and usage guide. _(risk: critical)_
- **redis-cli**: Redis command-line interface (redis-cli) reference and usage guide. Use this skill whenever the user mentions redis-cli, Redis CLI, or any task involving querying, inspecting, debugging, or managing Redis from the command line. _(risk: critical)_
- **saas-multi-tenant**: Design and implement multi-tenant SaaS architectures with row-level security, tenant-scoped queries, shared-schema isolation, and safe cross-tenant admin patterns in PostgreSQL and TypeScript. _(risk: critical)_
- **supabase-postgres-best-practices**: Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres queries, schema designs, or database configurations. _(risk: critical)_

## database-processing

- **base**: Database management, forms, reports, and data operations with LibreOffice Base. _(risk: safe)_

## databases

- **drizzle-migration-conflict**: Diagnose, repair, and prevent Drizzle Kit migration conflicts involving generated SQL, snapshots, journals, merge queues, and team workflows. _(risk: critical)_
- **pixeltable**: Build Pixeltable apps in app.py with tables, computed columns, embedding search, and HTTP routes. Use for RAG, media pipelines, and tool-calling agents. _(risk: critical)_
- **weaviate**: Search, query, inspect, create, and import data into Weaviate vector database collections using bundled adapted scripts and references. _(risk: critical)_

## debugging

- **bug-hunt-swarm**: Parallel read-only multi-agent root-cause investigation for bugs, regressions, crashes, flaky behavior, or unexplained failures. _(risk: safe)_
- **diagnose-android-overheating**: Use when diagnosing Android overheating, idle heat, thermal throttling, charging or radio heat, or abnormal battery drain with read-only ADB evidence and approval gates. _(risk: critical)_
- **logic-locate**: Locate the root cause of a CONFIRMED failure via backward-then-forward semi-formal tracing. _(risk: safe)_
- **phase-gated-debugging**: Use when debugging any bug. Enforces a 5-phase protocol where code edits are blocked until root cause is confirmed. Prevents premature fix attempts. _(risk: safe)_

## design

- **core-components**: Core component library and design system patterns. Use when building UI, using design tokens, or working with the component library. _(risk: unknown)_
- **design-md**: Analyze Stitch projects and synthesize a semantic design system into DESIGN.md files _(risk: safe)_
- **makepad-dsl**: CRITICAL: Use for Makepad DSL syntax and inheritance. Triggers on:
makepad dsl, live_design, makepad inheritance, makepad prototype,
"<Widget>", "Foo = { }", makepad object, makepad property,
makepad DSL 语法, makepad 继承, makepad 原型, 如何定义 makepad 组件 _(risk: unknown)_
- **makepad-font**: CRITICAL: Use for Makepad font and text rendering. Triggers on:
makepad font, makepad text, makepad glyph, makepad typography,
font atlas, text layout, font family, font size, text shaping,
makepad 字体, makepad 文字, makepad 排版, makepad 字形
 _(risk: unknown)_
- **accesslint-diff**: Diff a live page's accessibility violations against a baseline — by default compares uncommitted changes (stash-based), or pass --branch [<name>] to diff against a branch. Reports only new violations introduced, violations fixed, and pre-existing count. Use `scan` for a full audit with no diffing. _(risk: safe)_
- **accesslint-scan**: Audit a live page for accessibility issues, locate each WCAG violation precisely, and return a selector-grounded fix worklist without editing. _(risk: critical)_
- **agent-reels**: Find animation and video references on 1human, consult a human-agent shared library, and contribute public creations only with prior owner permission. _(risk: critical)_
- **design-philosophy**: Visual philosophy and art-direction for frontend. Use when creating high-concept work, campaigns, or when the user asks for a visual philosophy, manifesto, or unmistakable art-like aesthetic.
- **design-spatial**: Design — spatial composition _(risk: critical)_
- **design-thinking**: Direction and intent for frontend design. Use with design when defining purpose, tone, domain, color world, and review bar; includes cross-domain lens from cinema, architecture, marketing, UX, automotive, industrial design. _(risk: critical)_
- **deterministic-design**: Measure rendered UI layout with reproducible spatial metrics and a separately assessed usability review; distinguish measurements from subjective judgments and user tests. _(risk: safe)_
- **diagram-generator**: Generate, refine, validate, and render diagrams from natural language, notes, code, schemas, or existing diagram sources: flowcharts, swimlanes, attack-path graphs, data-flow diagrams, architecture, and state machines. _(risk: safe)_
- **free-design-resources**: Design resource register: resource and provider, licence type, commercial-use and attribution rules, export format, lock-in risk, free tier limit and accessibility notes. Use for tool vetting. _(risk: safe)_
- **logo-to-stickers**: Turn a brand mark or existing IP into consistent, playful paper stickers with small visual stories and separate transparent images. Use for brand characters and website sticker sets. _(risk: safe)_
- **lookdev**: Human-in-the-loop web studio to tune AI-generated output by eye. Stand up a local interactive studio (sliders, pickers, drag handles) or an inline edit/highlight/comment annotation studio for prose & media, instead of guessing values or shipping a static comparison grid. _(risk: safe)_
- **lookdev-auto**: Automated visual tuning: a vision or video model rates rendered variants in a loop. Render several labeled variants into one artifact, ask the model to rate them and suggest better values, render the suggestions, ask it to pick the best, repeat until good — the model is the eye, you run the loop. _(risk: safe)_
- **loss-aversion-designer**: Compare gain and loss framing and describe credible costs of inaction when an offer needs urgency without fearmongering. _(risk: safe)_
- **qrx**: Make branded, print-ready art QR codes to validate before use with QRX (qrx.codes). Use when a link needs a QR code that looks like artwork or matches a brand for print, packaging, signs, slides or event badges, and to list or re-point QRX codes. Not for plain QR codes the agent makes locally. _(risk: critical)_
- **rayden-use**: Build and maintain Rayden UI components and screens in Figma via Figma MCP with full design token enforcement _(risk: safe)_
- **ui-page**: Scaffold a new mobile page/screen using the StyleSeed layout patterns _(risk: critical)_
- **ui-pattern**: Generate a composed UI pattern (card layout, list, form section, grid, etc.) using design system primitives _(risk: critical)_
- **ui-score**: Score a UI file's design quality 0-100 against StyleSeed's design language — per-category breakdown, the worst offenders, and a prioritized fix list. A quantified version of /ss-review. _(risk: critical)_
- **ui-setup**: Interactive setup wizard — guides you step-by-step to configure the design system for your project _(risk: critical)_
- **ui-skills-root**: Use before UI-related work to select the smallest useful UI Skills context through the ui-skills CLI. _(risk: critical)_
- **ui-tokens**: View, add, or modify design tokens in the StyleSeed design system _(risk: critical)_
- **ux-audit**: Audit screens for UX issues using Nielsen's heuristics and modern mobile UX best practices _(risk: safe)_
- **ux-copy**: Generate UX microcopy (button labels, error messages, empty states, toasts) following a casual-but-polite voice and tone _(risk: critical)_
- **ux-flow**: Design user flows and navigation structure following proven UX patterns _(risk: critical)_
- **ux-persuasion-engineer**: Audit decision friction and propose clear, accessible UX flows when layout, defaults, or sequencing obstruct informed action. _(risk: safe)_
- **uxui-principles**: Evaluate interfaces against 168 research-backed UX/UI principles, detect antipatterns, and inject UX context into AI coding sessions. _(risk: safe)_
- **visual-emotion-engineer**: Create a visual direction brief for color, typography, imagery, and hierarchy when design must support a defined emotion, culture, and accessibility needs. _(risk: safe)_

## design-it

- **3d-ui**: Web and App implementation guide for 3D UI. Trigger when user wants actual 3D objects, perspective effects, and spatial depth. _(risk: safe)_
- **ai-native-ui**: Web and App implementation guide for AI Native UI. Trigger when user wants conversational interfaces, adaptive layouts, and generative AI aesthetics. _(risk: safe)_
- **aurora-ui**: Web and App implementation guide for Aurora UI. Trigger when user wants gradient glows, color blobs, and atmospheric lighting effects. _(risk: safe)_
- **bento-ui**: Web and App implementation guide for Bento UI. Trigger when user wants modular grid cards, Apple-like dashboard style, or sections arranged like a bento box. _(risk: safe)_
- **brutalism**: Web and App implementation guide for Brutalism. Trigger when user wants a raw appearance, intentionally unfinished look, and rejection of standard design conventions. _(risk: safe)_
- **brutalist-typography**: Web and App implementation guide for Brutalist Typography. Trigger when user wants huge fonts, raw presentation, and aggressive layout decisions. _(risk: safe)_
- **card-based-design**: Web and App implementation guide for Card-Based Design. Trigger when user wants information cards, Pinterest-style layouts, and bite-sized content containers. _(risk: safe)_
- **claymorphism**: Web and App implementation guide for Claymorphism. Trigger when user wants soft 3D elements, rounded shapes, and a playful, tactile appearance. _(risk: safe)_
- **color-blocking**: Web and App implementation guide for Color Blocking. Trigger when user wants large color sections, striking layout divisions, and Mondrian-style grids. _(risk: safe)_
- **command-center-ui**: Web and App implementation guide for Command Center UI. Trigger when user wants monitoring systems, enterprise dashboards, NOCs, and global maps. _(risk: safe)_
- **cyber-y2k**: Web and App implementation guide for Cyber Y2K. Trigger when user wants modern Y2K, holographic visuals, and glitch aesthetics. _(risk: safe)_
- **cyberpunk-ui**: Web and App implementation guide for Cyberpunk UI. Trigger when user wants neon colors, dark backgrounds, high-tech dystopian aesthetics, and hacking interfaces. _(risk: safe)_
- **dark-mode**: Web and App implementation guide for Dark Mode Design. Trigger when user wants dark surfaces, reduced eye strain, and premium sleek aesthetics. _(risk: safe)_
- **dashboard-design**: Web and App implementation guide for Dashboard Design. Trigger when user wants analytics-focused layouts, data visualization, and modular overview screens. _(risk: safe)_
- **data-dense-design**: Web and App implementation guide for Data-Dense Design. Trigger when user wants professional tools, maximum information density, and expert interfaces (like Bloomberg terminals or IDEs). _(risk: safe)_
- **duotone-design**: Web and App implementation guide for Duotone Design. Trigger when user wants two-color schemes, striking imagery, and Spotify-like playlist aesthetics. _(risk: safe)_
- **editorial-design**: Web and App implementation guide for Editorial Design. Trigger when user wants a magazine-inspired layout, large headlines, and elegant typography pairing. _(risk: safe)_
- **flat-design**: Web and App implementation guide for the Flat Design style. Trigger when the user wants no shadows, simple shapes, and bold colors. _(risk: safe)_
- **flat-design-2**: Web and App implementation guide for Flat Design 2.0 (Semi-Flat). Trigger when the user wants flat design with subtle shadows and improved usability. _(risk: safe)_
- **floating-ui**: Web and App implementation guide for Floating UI. Trigger when user wants detached cards, elevated components, and a light, airy feel. _(risk: safe)_
- **frutiger-aero**: Web and App implementation guide for Frutiger Aero. Trigger when user wants glossy gradients, early 2000s nature-inspired tech, glass, and water motifs. _(risk: safe)_
- **glassmorphism**: Web and App implementation guide for Glassmorphism. Trigger when user wants a frosted glass effect, blurred backgrounds, transparency, or a sleek MacOS-like feel. _(risk: safe)_
- **gradient-design**: Web and App implementation guide for Gradient Design. Trigger when user wants heavy gradient usage, vibrant transitions, and modern energetic feels. _(risk: safe)_
- **high-contrast**: Web and App implementation guide for High Contrast Design. Trigger when user wants accessibility-focused design, extreme legibility, or stark visual impact. _(risk: safe)_
- **holographic-ui**: Web and App implementation guide for Holographic UI. Trigger when user wants light-based appearance, projected interfaces, and transparent floating elements. _(risk: safe)_
- **isometric-design**: Web and App implementation guide for Isometric Design. Trigger when user wants angled 3D appearances without vanishing points, often used for technical illustrations. _(risk: safe)_
- **layered-design**: Web and App implementation guide for Layered Design. Trigger when user wants multiple depth levels, floating panels, and overlapping content. _(risk: safe)_
- **material-design**: Web and App implementation guide for Material Design. Trigger when user wants Google's aesthetic, elevation, motion, and consistent components. _(risk: safe)_
- **maximalism**: Web and App implementation guide for Controlled Maximalism. Trigger when user wants lots of elements, dense content, but a highly curated and artistic presentation. _(risk: safe)_
- **minimalism**: Web and App implementation guide for the Minimalism design style. Trigger when the user wants simple layouts, lots of whitespace, few colors, and clear hierarchy. _(risk: safe)_
- **monochromatic-ui**: Web and App implementation guide for Monochromatic UI. Trigger when user wants a single-color palette, high elegance, and strict color discipline. _(risk: safe)_
- **neo-brutalism**: Web and App implementation guide for Neo-Brutalism. Trigger when user wants thick borders, hard shadows, bright colors, and a playful yet structured look. _(risk: safe)_
- **neumorphism**: Web and App implementation guide for Neumorphism (Soft UI). Trigger when user wants soft shadows, extruded appearance, and light source simulation. _(risk: safe)_
- **retro-design**: Web and App implementation guide for Retro Design (60s-80s). Trigger when user wants vintage aesthetics, warm muted colors, and nostalgic layouts. _(risk: safe)_
- **retro-futurism**: Web and App implementation guide for Retro Futurism. Trigger when user wants vintage future concepts, 1950s space age aesthetics, or atompunk vibes. _(risk: safe)_
- **sci-fi-interface**: Web and App implementation guide for Sci-Fi Interface Design. Trigger when user wants HUDs, spacecraft dashboards, or tactical military readouts. _(risk: safe)_
- **skeuomorphism**: Web and App implementation guide for Skeuomorphism. Trigger when user wants UI to mimic real-world objects, realistic textures, or physical metaphors. _(risk: safe)_
- **soft-pastel**: Web and App implementation guide for Soft Pastel Design. Trigger when user wants gentle colors, calming UI, baby/lifestyle branding, or low-contrast aesthetics. _(risk: safe)_
- **spatial-computing-ui**: Web and App implementation guide for Spatial Computing UI. Trigger when user wants floating elements, environmental awareness, and Apple Vision Pro style. _(risk: safe)_
- **spatial-design**: Web and App implementation guide for Spatial Design. Trigger when user wants environment-aware layouts, Apple Vision Pro inspiration, and mixed reality aesthetics. _(risk: safe)_
- **swiss-design**: Web and App implementation guide for Swiss Design (International Typographic Style). Trigger when user wants strict grid systems, strong typography, and clean, asymmetrical alignment. _(risk: safe)_
- **synthwave**: Web and App implementation guide for Synthwave. Trigger when user wants 80s-inspired neon, dark backgrounds, outrun grids, and Miami Vice aesthetics. _(risk: safe)_
- **tile-design**: Web and App implementation guide for Tile Design. Trigger when user wants Microsoft Metro style, sharp square information units, and horizontal scrolling grids. _(risk: safe)_
- **typography-first**: Web and App implementation guide for Typography First Design. Trigger when user wants text as the absolute main visual element, with minimal UI chroming. _(risk: safe)_
- **vaporwave**: Web and App implementation guide for Vaporwave. Trigger when user wants neon colors, retro digital aesthetics, 90s OS elements, and Roman statues. _(risk: safe)_
- **vibrant-maximalism**: Web and App implementation guide for Vibrant Maximalism. Trigger when user wants rich colors, dense layouts, extreme sensory input, and "more is more". _(risk: safe)_
- **widget-based-design**: Web and App implementation guide for Widget-Based Design. Trigger when user wants modular blocks, iOS Home Screen aesthetics, and customizable mini-apps. _(risk: safe)_
- **y2k-design**: Web and App implementation guide for Y2K Design. Trigger when user wants chrome effects, futuristic 2000s look, blob shapes, and tech optimism. _(risk: safe)_

## desktop

- **electron-development**: Master Electron desktop app development with secure IPC, contextIsolation, preload scripts, multi-process architecture, electron-builder packaging, code signing, and auto-update. _(risk: safe)_

## developer-tools

- **address-github-comments**: Use when you need to address review or issue comments on an open GitHub Pull Request using the gh CLI. _(risk: unknown)_
- **bash-linux**: Bash/Linux terminal patterns. Critical commands, piping, error handling, scripting. Use when working on macOS or Linux systems. _(risk: unknown)_
- **behavioral-modes**: AI operational modes (brainstorm, implement, debug, review, teach, ship, orchestrate). Use to adapt behavior based on task type. _(risk: unknown)_
- **bitbucket-automation**: Automate Bitbucket repositories, pull requests, branches, issues, and workspace management via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **browser-extension-builder**: Expert in building browser extensions that solve real problems - Chrome, Firefox, and cross-browser extensions. Covers extension architecture, manifest v3, content scripts, popup UIs, monetization ... _(risk: unknown)_
- **busybox-on-windows**: How to use a Win32 build of BusyBox to run many of the standard UNIX command line tools on Windows. _(risk: unknown)_
- **chrome-extension-developer**: Expert in building Chrome Extensions using Manifest V3. Covers background scripts, service workers, content scripts, and cross-context communication. _(risk: safe)_
- **commit**: ALWAYS use this skill when committing code changes — never commit directly without it. Creates commits following Sentry conventions with proper conventional commit format and issue references. Trigger on any commit, git commit, save changes, or commit message task. _(risk: unknown)_
- **conductor-revert**: Git-aware undo by logical work unit (track, phase, or task) _(risk: unknown)_
- **create-branch**: Create a git branch following Sentry naming conventions. Use when asked to "create a branch", "new branch", "start a branch", "make a branch", "switch to a new branch", or when starting new work on the default branch. _(risk: unknown)_
- **create-pr**: Alias for sentry-skills:pr-writer. Use when users explicitly ask for "create-pr" or reference the legacy skill name. Redirects to the canonical PR writing workflow. _(risk: unknown)_
- **debugger**: Debugging specialist for errors, test failures, and unexpected
behavior. Use proactively when encountering any issues.
 _(risk: unknown)_
- **debugging-strategies**: Master systematic debugging techniques, profiling tools, and root cause analysis to efficiently track down bugs across any codebase or technology stack. Use when investigating bugs, performance iss... _(risk: unknown)_
- **debugging-toolkit-smart-debug**: Use when working with debugging toolkit smart debug _(risk: unknown)_
- **dependency-upgrade**: Manage major dependency version upgrades with compatibility analysis, staged rollout, and comprehensive testing. Use when upgrading framework versions, updating major dependencies, or managing brea... _(risk: unknown)_
- **distributed-debugging-debug-trace**: You are a debugging expert specializing in setting up comprehensive debugging environments, distributed tracing, and diagnostic tools. Configure debugging workflows, implement tracing solutions, an... _(risk: unknown)_
- **distributed-tracing**: Implement distributed tracing with Jaeger and Tempo to track requests across microservices and identify performance bottlenecks. Use when debugging microservices, analyzing request flows, or implem... _(risk: unknown)_
- **dwarf-expert**: Provides expertise for analyzing DWARF debug files and understanding the DWARF debug format/standard (v3-v5). Triggers when understanding DWARF information, interacting with DWARF files, answering DWARF-related questions, or working with code that parses DWARF data. _(risk: unknown)_
- **environment-setup-guide**: Guide developers through setting up development environments with proper tools, dependencies, and configurations _(risk: unknown)_
- **error-detective**: Search logs and codebases for error patterns, stack traces, and anomalies. Correlates errors across systems and identifies root causes. _(risk: unknown)_
- **error-diagnostics-smart-debug**: Use when working with error diagnostics smart debug _(risk: unknown)_
- **file-organizer**: Intelligently organizes files and folders by understanding context, finding duplicates, and suggesting better organizational structures. Use when user wants to clean up directories, organize downlo... _(risk: unknown)_
- **finishing-a-development-branch**: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup _(risk: unknown)_
- **framework-migration-deps-upgrade**: You are a dependency management expert specializing in safe, incremental upgrades of project dependencies. Plan and execute dependency updates with minimal risk, proper testing, and clear migration pa _(risk: unknown)_
- **gh-review-requests**: Fetch unread GitHub notifications for open PRs where review is requested from a specified team or opened by a team member. Use when asked to "find PRs I need to review", "show my review requests", "what needs my review", "fetch GitHub review requests", or "check team review queue". _(risk: unknown)_
- **git-advanced-workflows**: Master advanced Git workflows including rebasing, cherry-picking, bisect, worktrees, and reflog to maintain clean history and recover from any situation. Use when managing complex Git histories, co... _(risk: unknown)_
- **git-hooks-automation**: Master Git hooks setup with Husky, lint-staged, pre-commit framework, and commitlint. Automate code quality gates, formatting, linting, and commit message enforcement before code reaches CI. _(risk: safe)_
- **git-pr-workflows-onboard**: You are an **expert onboarding specialist and knowledge transfer architect** with deep experience in remote-first organizations, technical team integration, and accelerated learning methodologies. You _(risk: unknown)_
- **git-pr-workflows-pr-enhance**: You are a PR optimization expert specializing in creating high-quality pull requests that facilitate efficient code reviews. Generate comprehensive PR descriptions, automate review processes, and ensu _(risk: unknown)_
- **git-pushing**: Stage, commit, and push git changes with conventional commit messages. Use when user wants to commit and push changes, mentions pushing to remote, or asks to save and push their work. Also activate... _(risk: unknown)_
- **github-issue-creator**: Convert raw notes, error logs, voice dictation, or screenshots into crisp GitHub-flavored markdown issue reports. Use when the user pastes bug info, error messages, or informal descriptions and wan... _(risk: unknown)_
- **gitlab-automation**: Automate GitLab project management, issues, merge requests, pipelines, branches, and user operations via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **issues**: Interact with GitHub issues - create, list, and view issues. _(risk: unknown)_
- **iterate-pr**: Iterate on a PR until CI passes. Use when you need to fix CI failures, address review feedback, or continuously push fixes until all checks are green. Automates the feedback-fix-push-wait cycle. _(risk: unknown)_
- **linkedin-automation**: Automate LinkedIn tasks via Rube MCP (Composio): create posts, manage profile, company info, comments, and image uploads. Always search tools first for current schemas. _(risk: unknown)_
- **linkedin-cli**: Use when automating LinkedIn via CLI: fetch profiles, search people/companies, send messages, manage connections, create posts, and Sales Navigator. _(risk: safe)_
- **linux-shell-scripting**: This skill should be used when the user asks to "create bash scripts", "automate Linux tasks", "monitor system resources", "backup files", "manage users", or "write production she... _(risk: unknown)_
- **makepad-reference**: CRITICAL: Use for Makepad troubleshooting and reference. Triggers on:
troubleshoot, error, debug, fix, problem, issue,
no matching field, parse error, widget not found, UI not updating,
code quality, refactor, responsive layout, adaptive,
api docs, reference,... _(risk: unknown)_
- **monorepo-management**: Master monorepo management with Turborepo, Nx, and pnpm workspaces to build efficient, scalable multi-package repositories with optimized builds and dependency management. Use when setting up monor... _(risk: unknown)_
- **obsidian-clipper-template-creator**: Guide for creating templates for the Obsidian Web Clipper. Use when you want to create a new clipping template, understand available variables, or format clipped content. _(risk: safe)_
- **odoo-performance-tuner**: Expert guide for diagnosing and fixing Odoo performance issues: slow queries, worker configuration, memory limits, PostgreSQL tuning, and profiling tools. _(risk: safe)_
- **oss-hunter**: Automatically hunt for high-impact OSS contribution opportunities in trending repositories. _(risk: safe)_
- **performance-profiling**: Performance profiling principles. Measurement, analysis, and optimization techniques. _(risk: unknown)_
- **posix-shell-pro**: Expert in strict POSIX sh scripting for maximum portability across Unix-like systems. Specializes in shell scripts that run on any POSIX-compliant shell (dash, ash, sh, bash --posix). _(risk: unknown)_
- **posthog-automation**: Automate PostHog tasks via Rube MCP (Composio): events, feature flags, projects, user profiles, annotations. Always search tools first for current schemas. _(risk: unknown)_
- **powershell-windows**: PowerShell Windows patterns. Critical pitfalls, operator syntax, error handling. _(risk: unknown)_
- **shellcheck-configuration**: Master ShellCheck static analysis configuration and usage for shell script quality. Use when setting up linting infrastructure, fixing code issues, or ensuring script portability. _(risk: unknown)_
- **systematic-debugging**: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes _(risk: unknown)_
- **team-collaboration-issue**: You are a GitHub issue resolution expert specializing in systematic bug investigation, feature implementation, and collaborative development workflows. Your expertise spans issue triage, root cause an _(risk: unknown)_
- **tiktok-automation**: Automate TikTok tasks via Rube MCP (Composio): upload/publish videos, post photos, manage content, and view user profiles/stats. Always search tools first for current schemas. _(risk: unknown)_
- **using-git-worktrees**: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - creates isolated git worktrees with smart directory selection and safety verifi... _(risk: unknown)_
- **wiki-changelog**: Analyzes git commit history and generates structured changelogs categorized by change type. Use when the user asks about recent changes, wants a changelog, or needs to understand what changed in th... _(risk: unknown)_
- **agents-generator**: Generate project-specific AGENTS.md and companion rules by analyzing a codebase. Supports full, minimal, update, and dry-run modes with package-manager detection, monorepos, backups, managed blocks, confidence scoring, and command validation. _(risk: critical)_
- **agy-powerline**: Install, check and restyle the agy-powerline statusline for Antigravity CLI (agy): quotas, model, context window and git on agy's status bar. _(risk: critical)_
- **gh-attach**: Upload and download GitHub user-attachments (screenshots, PDFs, zips, videos) from the terminal; use when asked to attach or embed a file in a PR, issue, or comment, or download an attachment URL. _(risk: critical)_
- **gh-image**: Upload local images to GitHub and get canonical user-attachments embed URLs; use when asked to attach a screenshot to a PR, issue, or comment, or to embed before/after images in a README. _(risk: critical)_
- **github**: Use the `gh` CLI for issues, pull requests, Actions runs, and GitHub API queries. _(risk: safe)_
- **mcp-tool-developer**: Build Model Context Protocol (MCP) servers and tools from scratch. Full-stack MCP development with TypeScript/Python, testing, deployment, and registry publishing. _(risk: safe)_
- **skill-porter**: Preview conservative tool-name translations and copy complete local skill bundles for manual adaptation to Google Antigravity. _(risk: critical)_
- **tokenwise**: Measurement-driven model router for Claude Code. Routes Haiku/Sonnet/Opus per task class, logs every routed task with real $ numbers, and A/B tests cheaper tiers before you trust the savings. _(risk: critical)_

## development

- **api-endpoint-builder**: Builds production-ready REST API endpoints with validation, error handling, authentication, and documentation. Follows best practices for security and scalability. _(risk: safe)_
- **bug-hunter**: Systematically finds and fixes bugs using proven debugging techniques. Traces from symptoms to root cause, implements fixes, and prevents regression. _(risk: safe)_
- **codebase-audit-pre-push**: Deep audit before GitHub push: removes junk files, dead code, security holes, and optimization issues. Checks every file line-by-line for production readiness. _(risk: safe)_
- **performance-optimizer**: Identifies and fixes performance bottlenecks in code, databases, and APIs. Measures before and after to prove improvements. _(risk: safe)_
- **skill-check**: Validate Claude Code skills against the agentskills specification. Catches structural, semantic, and naming issues before users do. _(risk: safe)_
- **agent-harness-fault-injection**: Use when an agent workflow needs deterministic recovery evidence for sandbox, MCP/tool, worker, checkpoint, memory, or orchestration failures. _(risk: safe)_
- **agenttrace-session-audit**: Audit local AI coding-agent sessions with agenttrace for cost, tool failures, latency, anomalies, health, diffs, and CI gates. _(risk: safe)_
- **animated-github-profile**: Build high-impact, animated GitHub profile READMEs that play like mini-movies using pure SVG, CSS, and SMIL animations. Covers dark/light theme switching, swinging lanyard ID badges, tech orbits, local stat cards, and automated contribution graphs. _(risk: safe)_
- **api-contract-testing**: Design and review API contract tests across providers and consumers. Use for schema changes, compatibility regressions and client integration failures. _(risk: safe)_
- **api-rate-limit-handler**: Implement bounded, idempotency-aware API throttling, backoff, and retry handling for 429 and transient 5xx responses. _(risk: safe)_
- **ask-copilot**: Use GitHub Copilot CLI in non-interactive mode to ask questions, review code, or generate snippets without manual interaction. _(risk: critical)_
- **ax-extract-workflow**: Reconstruct workflow behind a past coding-agent artifact using local ax sessions/commits/skills/tool traces. Use when asked how X was built. _(risk: safe)_
- **boost-asio-pro**: Use when writing asynchronous C++ networking code with Boost.Asio or standalone Asio — TCP/UDP servers and clients, SSL/TLS, timers, strands, composed async ops. Covers io_context, co_spawn, awaitable, async_read/async_write, asio::spawn, yield_context, and pre-C++20 callback styles. _(risk: safe)_
- **brooks-lint**: AI code reviewer grounded in classic software engineering books for catching design smells, coupling issues, and architectural risks. _(risk: safe)_
- **browser-extension-launch**: Builds, tests, packages, and prepares Chrome extensions for store launch from a plain-language idea; use for new extensions, fixes, releases, and submission recovery. _(risk: critical)_
- **chatexport-need-miner**: Mines offline Telegram Desktop chat exports (result.json) for unmet market needs and product opportunities using chunked streaming and verbatim quote grounding. Trigger phrases: mine chat export, telegram result.json, find unmet needs, analyze telegram chat. _(risk: safe)_
- **cmux**: Control cmux workspaces, panes, surfaces, and agent sessions safely from macOS terminal workflows. _(risk: critical)_
- **cockney**: Cheeky Cockney coding mode: terse replies, the smallest correct change, plain English for anything risky. _(risk: safe)_
- **code-audit**: Authorized source-code security review and SAST workflows: Semgrep and CodeQL pattern hunting, dangerous API identification, and fix verification. _(risk: safe)_
- **code-polish**: Rewrites unprofessional code comments into clear ones and performs non-semantic cleanup. Use to professionalize code without altering logic or behavior. _(risk: critical)_
- **code-review-and-quality**: Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human. Use when you need to assess code quality across multiple dimensions before it enters the main branch. _(risk: critical)_
- **code-review-sensei**: Expert code reviewer that catches bugs, security issues, performance problems, and design flaws with actionable fix suggestions. _(risk: unknown)_
- **code-showcase-core-components**: Core component library and design system patterns. Use when building UI, using design tokens, or working with the component library.
- **code-showcase-react-ui-patterns**: Modern React UI patterns for loading states, error handling, and data fetching. Use when building UI components, handling async data, or managing UI states. _(risk: critical)_
- **code-showcase-systematic-debugging**: Four-phase debugging methodology with root cause analysis. Use when investigating bugs, fixing test failures, or troubleshooting unexpected behavior. Emphasizes NO FIXES WITHOUT ROOT CAUSE FIRST. _(risk: critical)_
- **code-showcase-testing-patterns**: Jest testing patterns, factory functions, mocking strategies, and TDD workflow. Use when writing unit tests, creating test factories, or following TDD red-green-refactor cycle. _(risk: critical)_
- **code-simplification**: Simplifies code for clarity. Use when refactoring code for clarity without changing behavior. Use when code works but is harder to read, maintain, or extend than it should be. Use when reviewing code that has accumulated unnecessary complexity. _(risk: critical)_
- **codebase-onboarding**: Onboard a developer to a repository using Ontoly graph summaries. Use when asked to explain a new codebase, identify entrypoints, map packages, or suggest first files to inspect. _(risk: unknown)_
- **codebase-to-wordpress-converter**: Expert skill for converting any codebase (React/HTML/Next.js) into a pixel-perfect, SEO-optimized, and dynamic WordPress theme. _(risk: safe)_
- **cross-platform-contract-propagation-audit**: Use when auditing whether a field, enum, flag, or API contract propagates consistently across storage, services, clients, analytics, and tests. _(risk: safe)_
- **debugging-and-error-recovery**: Guides systematic root-cause debugging. Use when tests fail, builds break, behavior doesn't match expectations, or you encounter any unexpected error. Use when you need a systematic approach to finding and fixing the root cause rather than guessing. _(risk: critical)_
- **debugging-code**: Interactively debug source code — set breakpoints, step through execution line by line, inspect live variable state, evaluate expressions against the running program, and navigate the call stack to trace root causes. _(risk: critical)_
- **debugging-toolkit**: Use when working with debugging toolkit smart debug (Alias for debugging-toolkit-smart-debug) _(risk: critical)_
- **diagnosing-bugs**: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow. _(risk: safe)_
- **distribute-skill-to-all-agents**: Distribute a skill across configured agent skill folders while respecting local symlink layouts. _(risk: critical)_
- **ecl-harness-engineer**: Create or audit ECL Agent Harness infrastructure: AGENTS.md, change tracking, repository guidance, lint checks, CI gates, and agent handoff docs. _(risk: critical)_
- **effective-agent-skills**: Author and review high-quality agent skills with triggers, progressive disclosure, and safety notes. _(risk: safe)_
- **faber-language**: Write, check and run Faber programs, an experimental statically typed language for coding agents and human authors. Uses version-matched faberlang.dev language documentation. _(risk: critical)_
- **five-axis-code-review**: Five-axis code review checklist (correctness, security, readability, performance, test coverage) producing actionable comments instead of style nitpicks. Use when the user asks to review code, a diff, or a pull request. _(risk: safe)_
- **folder-specific-claude-and-agents-md**: Create folder-scoped CLAUDE.md and AGENTS.md guidance for future agents working in that area. _(risk: critical)_
- **gdb-cli**: GDB debugging assistant for AI agents - analyze core dumps, debug live processes, investigate crashes and deadlocks with source code correlation _(risk: critical)_
- **git-commit-message**: Generates conventional-commit messages from staged changes: type prefix + English imperative subject (≤50 chars) + optional body explaining why. Use when the user asks to write, generate, or polish a git commit message. _(risk: safe)_
- **global-chat-agent-discovery**: Discover and compare MCP servers and AI agents using Global Chat's cross-protocol directory and MCP server. _(risk: safe)_
- **go-in-depth**: Go in depth harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report. _(risk: safe)_
- **go-rust-reverse**: Reverse engineer stripped Go and Rust binaries: runtime recognition, pclntab/module metadata recovery, panic-string analysis, and idiomatic decompilation strategies. _(risk: safe)_
- **graceful-shutdown**: Implement graceful shutdown for servers and workers: drain connections, finish in-flight work, release resources, and exit cleanly on SIGTERM/SIGINT. _(risk: safe)_
- **implement**: Implement a piece of work based on a PRD or set of issues. _(risk: critical)_
- **improve-codebase-architecture**: Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. _(risk: safe)_
- **incremental-implementation**: Delivers changes incrementally. Use when implementing any feature or change that touches more than one file. Use when you're about to write a large amount of code at once, or when a task feels too big to land in one step. _(risk: critical)_
- **instructree**: Map, explain, and lint repository-scoped coding-agent instructions before changing code. _(risk: safe)_
- **jq**: Expert jq usage for JSON querying, filtering, transformation, and pipeline integration. Practical patterns for real shell workflows. _(risk: safe)_
- **laravel-development-workflow**: Build and fix existing Laravel applications through root-cause diagnosis, repository-native implementation, regression coverage, and risk-based verification. _(risk: critical)_
- **lemmaly**: Algorithm-first discipline: state Big-O, data structure, and algorithm family BEFORE writing loops, queries, or recursion. Catches O(n^2), N+1, and brute-force defaults. _(risk: safe)_
- **lintlang-audit**: Audit named agent instructions, tool definitions, and supported Python prompts with local LintLang checks; return finding codes and locations without changing files. _(risk: safe)_
- **logic-explain**: Explain what a specific piece of code actually does for a given input by producing a step-by-step execution trace (interprocedural, with name resolution and type transitions). _(risk: safe)_
- **logic-lens**: AI-powered Claude Code skill that performs deep code review using formal logic and reasoning frameworks to detect bugs, anti-patterns, and security risks beyond what linters catch. _(risk: safe)_
- **lore**: Markdown project memory for AI agents. Use for decisions, architecture, conventions, monorepo scopes, `.lore/`, or `lore` commands; not native `/init`/`/compact` or generic init/compress/audit/query. _(risk: safe)_
- **macos-menubar-tuist-app**: Build, refactor, or review SwiftUI macOS menubar apps that use Tuist. _(risk: safe)_
- **macos-spm-app-packaging**: Scaffold, build, sign, and package SwiftPM macOS apps without Xcode projects. _(risk: critical)_
- **makepad-2-0-animation**: Makepad 2.0 guidance for animation; use when building or debugging Makepad UI code. _(risk: safe)_
- **makepad-2-0-dsl**: Makepad 2.0 guidance for dsl; use when building or debugging Makepad UI code. _(risk: unknown)_
- **makepad-2-0-events**: Makepad 2.0 guidance for events; use when building or debugging Makepad UI code. _(risk: unknown)_
- **makepad-2-0-layout**: Makepad 2.0 guidance for layout; use when building or debugging Makepad UI code. _(risk: unknown)_
- **makepad-2-0-widgets**: Makepad 2.0 guidance for widgets; use when building or debugging Makepad UI code. _(risk: unknown)_
- **marlin-bed-leveling**: Calibrates Marlin 2.x 3D printer firmware bed leveling: Unified Bed Leveling (UBL), Bilinear ABL, M420 S1 post-homing, Z-probe offsets, G26 mesh prints, and EEPROM slots. Trigger phrases: marlin bed leveling, ubl calibration, m420 s1, z probe offset, g29 bed level, first layer adhesion. _(risk: critical)_
- **obsess**: Perfectionist mode for one target: checked attempts on a UI detail or hot path, keeps the best version, stops on a budget. Only on explicit /obsess. _(risk: critical)_
- **ontoly-software-graph**: Use Ontoly's deterministic Software Graph, MCP server, and agent skills for architecture review, request tracing, impact analysis, and dependency analysis. _(risk: critical)_
- **openhook**: Creates private callback inboxes with Openhook. Use when an agent needs to wait for a webhook, inspect received HTTP/email/DNS events, or verify a test callback's contents. _(risk: critical)_
- **orca-replay**: Answers questions about a past agent run from its recording rather than from memory, and replays or forks that run. Use when asked why an earlier run did something, or to reproduce a failure. _(risk: critical)_
- **performance-optimization**: Optimizes application performance. Use when performance requirements exist, when you suspect performance regressions, or when Core Web Vitals or load times need improvement. Use when profiling reveals bottlenecks that need fixing. _(risk: critical)_
- **poka-yoke**: Mistake-proof code, config and process: make the wrong action impossible or self-announcing rather than documented. _(risk: safe)_
- **prototype**: Build a throwaway prototype to flesh out a design — a runnable terminal app for state/business-logic questions, or several radically different UI variations toggleable from one route. _(risk: safe)_
- **push-skill-to-github**: Commit and push skill changes to the configured skills repository after review and validation. _(risk: critical)_
- **python-development**: You are a Python project architecture expert specializing in scaffolding production-ready Python applications. Generate complete project structures with modern tooling (uv, FastAPI, Django), type hint (Alias for python-development-python-scaffold) _(risk: critical)_
- **python-pptx-generator**: Generate complete Python scripts that build polished PowerPoint decks with python-pptx and real slide content. _(risk: safe)_
- **rayden-code**: Generate React code with Rayden UI components using correct props, tokens, and premium layout patterns _(risk: safe)_
- **re-create**: Completely delete and rewrite a file or module from scratch when structural rot makes patching impossible. _(risk: critical)_
- **repo-foundation**: Implement features, fixes, modules, contract migrations, and resumed work while preserving user edits and authorized public contracts. _(risk: critical)_
- **repo-native-refactor**: Review diffs without editing, or perform evidence-based cleanup while preserving authorized behavior, public contracts, and domain ownership. _(risk: critical)_
- **resolving-merge-conflicts**: Use when you need to resolve an in-progress git merge/rebase conflict. _(risk: critical)_
- **runapi-cli**: Generate AI images, videos, and music/audio from agents using the RunAPI CLI. _(risk: critical)_
- **setup-matt-pocock-skills**: Configure this repo for the engineering skills — set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills. _(risk: safe)_
- **shipvela-publish**: Publish an explicitly selected website through the user's connected Shipvela MCP account, track the exact deployment, and return its live HTTPS URL after success. _(risk: critical)_
- **shopify-firebase-app**: Scaffold, extend and deploy Shopify embedded apps on Firebase with Nitrogen. Use for a Shopify app on Cloud Functions, Firestore and Hosting, or inside a Nitrogen project. _(risk: critical)_
- **since-cutoff**: Find which APIs of a project's pinned Python dependencies changed after the model's training cutoff, where the code uses them, and write short AGENTS.md or CLAUDE.md notes. _(risk: safe)_
- **source-driven-development**: Grounds every implementation decision in official documentation. Use when you want authoritative, source-cited code free from outdated patterns. Use when building with any framework or library where correctness matters. _(risk: critical)_
- **spec-driven-loop**: Freeze PRD, technical design, and acceptance criteria before medium-to-large Codex work; coordinate agents with explicit ownership, then judge delivery from diffs, tests, and evidence. _(risk: safe)_
- **squirrel**: Full-cycle AI coding skill: plans, builds, tests, lints, fixes bugs, and writes production-grade docs. Auto-detects project state and adapts its 8-phase pipeline. _(risk: safe)_
- **swift-concurrency-expert**: Review and fix Swift concurrency issues such as actor isolation and Sendable violations. _(risk: safe)_
- **tdd**: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests. _(risk: safe)_
- **technical-change-tracker**: Track code changes with structured JSON records, state machine enforcement, and AI session handoff for bot continuity _(risk: safe)_
- **tmux**: Expert tmux session, window, and pane management for terminal multiplexing, persistent remote workflows, and shell scripting automation. _(risk: safe)_
- **tokenleak**: Token-lean rules for coding agents: cut the context re-sent on every later call (big reads, noisy logs, re-reads, serial calls) without losing correctness. _(risk: safe)_
- **tree-ring-memory**: Use Tree Ring Memory for local-first AI-agent memory lifecycle work: recall, evidence, audit, forgetting, and consolidation without transcript dumping. _(risk: critical)_
- **triage**: Move issues and external PRs through a state machine of triage roles — categorise, verify, grill if needed, and write agent-ready briefs. _(risk: safe)_
- **ui-update**: Update StyleSeed engine in your project — analyzes what's outdated and updates safely _(risk: critical)_
- **unship**: Compare AI agent-made UI variants locally in a real app, then keep one and clean up unused temporary code. _(risk: critical)_
- **using-lwc**: Use when project decisions, code structure, research, incidents, or verified context must survive future coding-agent sessions through LWC memory and graph indexes. _(risk: critical)_
- **what-could-break**: Find what a change breaks outside its own diff, then prove the one fact that makes it safe by running real code. Use before any multi-file edit or an edit to a shared path. _(risk: safe)_
- **wp-site-health-auditor**: Turns a WordPress Site Health report into a risk-tiered, backup-first fix plan with exact WP-CLI/PHP snippets. Use for site health, recommended improvements, or critical issue reports. _(risk: critical)_

## development-and-testing

- **openclaw-github-repo-commander**: 7-stage super workflow for GitHub repo audit, cleanup, PR review, and competitor analysis _(risk: safe)_

## devops

- **docker-expert**: Docker containerization expert with deep knowledge of multi-stage builds, image optimization, container security, Docker Compose orchestration, and production deployment patterns. Use PROACTIVELY f... _(risk: unknown)_
- **agent-evals**: Build automated evaluation suites for AI agents using golden datasets, rubrics, and regression gates. Use when shipping agent features, validating prompt changes, or gating deployments on quality. _(risk: critical)_
- **agent-observability**: Instrument AI agents with tracing, token metrics, latency, and cost visibility. Use for reliability and debugging. _(risk: critical)_
- **ai-inference-service-mesh**: Use verified service mesh patterns for AI inference traffic management, mTLS, canary releases, policy enforcement, and cross-cluster resilience. _(risk: critical)_
- **ai-pipeline-orchestration**: Orchestrate AI/ML pipelines for data ingestion, model training, batch inference, and RAG indexing using Prefect, Airflow, or Dagster. _(risk: critical)_
- **ai-sre-incident-response**: Build AI-focused SRE incident response practices for LLM outages, degraded quality, runaway cost events, and safety regressions. _(risk: critical)_
- **alerting-oncall**: Set up alerting rules, configure on-call rotations, and manage incident response workflows. _(risk: critical)_
- **antigravity-maintainer-batch-release**: Run protected AAS maintainer sweeps, PR merge batches, resumable review, immutable distribution, Core checks, and scripted releases. Use for repository maintenance, main alignment, CLI/MCP/Workbench changes, or release work; not ordinary contribution tasks. _(risk: critical)_
- **apple-container**: Build, run, and manage OCI/Linux containers as lightweight per-container VMs on Apple-silicon macOS using Apple's open-source container CLI, no Docker daemon required. _(risk: critical)_
- **argocd-gitops**: Implement GitOps with ArgoCD for declarative Kubernetes deployments. _(risk: critical)_
- **arm-templates**: Deploy Azure resources with ARM templates and Bicep. Create modular deployments and manage dependencies. Use when deploying Azure-native IaC. _(risk: critical)_
- **aws-cost-optimization**: Reduce AWS spend with rightsizing, autoscaling, commitment planning, and storage lifecycle policies. Use when running FinOps reviews, lowering cloud bills, or improving cost-per-request metrics. _(risk: critical)_
- **aws-ec2**: Manage EC2 instances, AMIs, and auto-scaling groups. Configure security groups, key pairs, and instance types. Use when deploying compute resources on AWS. _(risk: critical)_
- **aws-ecs-fargate**: Deploy containers on ECS and Fargate. Configure task definitions, services, and load balancing. Use when running containerized workloads on AWS. _(risk: critical)_
- **aws-iam**: Manage IAM users, roles, and policies. Implement least-privilege access and security best practices. Use when configuring AWS identity and access management. _(risk: critical)_
- **aws-lambda**: Build and deploy serverless functions on AWS Lambda. Configure triggers, manage permissions, and optimize performance. Use when implementing serverless applications. _(risk: critical)_
- **aws-rds**: Provision and manage RDS databases. Configure backups, replication, and security. Use when deploying managed relational databases on AWS. _(risk: critical)_
- **aws-s3**: Configure S3 buckets, policies, and lifecycle rules. Implement versioning, replication, and security. Use when managing object storage on AWS. _(risk: critical)_
- **aws-vpc**: Design and implement VPCs and networking. Configure subnets, route tables, and security groups. Use when setting up AWS network infrastructure. _(risk: critical)_
- **azure-aks**: Deploy and manage Azure Kubernetes Service clusters. Configure node pools, networking, and integrations. Use when running Kubernetes workloads on Azure. _(risk: critical)_
- **azure-devops**: Set up Azure Pipelines for CI/CD, configure build and release pipelines, manage Azure DevOps projects, and integrate with Azure services. _(risk: critical)_
- **azure-functions-devsec**: Build serverless applications on Azure Functions. Configure triggers, bindings, and deployment. Use when implementing serverless workloads on Azure. _(risk: critical)_
- **azure-networking**: Configure Azure VNets, NSGs, and Azure Firewall. Implement hub-spoke topology and private endpoints. Use when designing Azure network infrastructure. _(risk: critical)_
- **azure-sql**: Provision Azure SQL Database and Cosmos DB. Configure security, backups, and replication. Use when deploying managed databases on Azure. _(risk: critical)_
- **azure-vms**: Manage Azure Virtual Machines and scale sets. Configure availability sets and managed disks. Use when deploying compute resources on Azure. _(risk: critical)_
- **backup-recovery**: Implement backup and recovery strategies. Configure rsync, Restic, and cloud backups. Use when designing data protection solutions. _(risk: critical)_
- **block-storage**: Manage block storage volumes and LVM. Configure cloud block storage and local disks. Use when managing disk storage. _(risk: critical)_
- **blue-green-deploy**: Configure zero-downtime deployment strategies including blue-green, canary, and rolling deployments. _(risk: critical)_
- **brendangregg-use-tsa**: Methodical performance troubleshooting and root-cause analysis with Brendan Gregg's USE and TSA methods, plus evidence-backed RCA and postmortem reports. _(risk: safe)_
- **cdn-setup**: Configure CDNs for content delivery. Set up CloudFront, Cloudflare, and Fastly. Use when optimizing global content delivery. _(risk: critical)_
- **ci-cd-and-automation**: Automates CI/CD pipeline setup. Use when setting up or modifying build and deployment pipelines. Use when you need to automate quality gates, configure test runners in CI, or establish deployment strategies. _(risk: critical)_
- **circleci**: Configure CircleCI workflows and orbs for continuous integration and deployment. _(risk: critical)_
- **cloudflare-pages**: Deploy static sites and full-stack apps on Cloudflare Pages with previews, functions, and custom domains. _(risk: critical)_
- **cloudflare-r2**: Manage Cloudflare R2 buckets, lifecycle, and signed URLs. Use for low-egress object storage and media delivery. _(risk: critical)_
- **cloudflare-workers**: Build and deploy edge functions with Cloudflare Workers and Wrangler. Use for APIs, cron jobs, and edge middleware. _(risk: critical)_
- **cloudflare-zero-trust**: Protect internal apps with Cloudflare Access, device posture, and Zero Trust policies. _(risk: critical)_
- **cloudformation**: Deploy AWS resources with CloudFormation templates. Create stacks, use nested stacks, and implement drift detection. Use when deploying AWS-native IaC. _(risk: critical)_
- **cloudish**: Deploy a Dockerfile, source folder, or existing image to Cloudish as a running container at a live URL, built server-side with no local Docker, with confirmation before spending credits. _(risk: critical)_
- **container-registries**: Manage container registries including ECR, ACR, GCR, and Docker Hub. _(risk: critical)_
- **convex-backend**: Build reactive backends with Convex functions, schema validation, auth integration, and deployment workflows. Use when building real-time apps with type-safe server functions and automatic caching. _(risk: critical)_
- **cron-doctor**: Diagnose and validate cron expressions before they ship. Catches the five silent death-traps: impossible dates that never fire, OR-semantics that fire too often, midnight spikes, uneven step drift, and leap-year February 29. _(risk: safe)_
- **database-backups**: Implement database backup strategies. Configure automated backups, retention, and recovery testing. Use when designing backup and recovery procedures. _(risk: critical)_
- **datadog**: Implement Datadog monitoring and APM for infrastructure and applications. _(risk: critical)_
- **deed-page**: Publish an HTML file or static folder to a permanent public https://<slug>.deed.page/ URL with one curl request. No account; the first publish returns a token for updates. _(risk: critical)_
- **deploy-to-vercel**: Deploy applications and websites to Vercel. Use when the user requests deployment actions like "deploy my app", "deploy and give me the link", "push this live", or "create a preview deployment". _(risk: critical)_
- **devcontainers-nix**: Create reproducible development environments with Dev Containers, Nix flakes, and Devbox for consistent toolchains across teams. _(risk: critical)_
- **devops-pipeline-builder**: Design and implement CI/CD pipelines, Docker configurations, deployment strategies, and infrastructure automation with production-ready patterns. _(risk: critical)_
- **dns-management**: Configure DNS zones and records. Manage Route53, Cloud DNS, and self-hosted DNS. Use when setting up DNS infrastructure. _(risk: critical)_
- **docker-compose**: Define and run multi-container Docker applications using Docker Compose. _(risk: critical)_
- **docker-management**: Build, optimize, and troubleshoot Docker containers and images. _(risk: critical)_
- **dropthehassle-publish**: Publish a finished static site to a free HTTPS link with DropTheHassle: build it if needed, deploy, hand over the claim link, verify it is live, never spend money. _(risk: critical)_
- **eas-hosting**: Curated upstream guidance for Eas Hosting; use when the workflow matches the user goal. _(risk: critical)_
- **eas-observe**: Curated upstream guidance for Eas Observe; use when the workflow matches the user goal. _(risk: critical)_
- **ebpf-observability**: Use eBPF for deep kernel-level observability — trace syscalls, network flows, and application behavior without code changes using Cilium, Tetragon, and bpftrace. _(risk: critical)_
- **elk-stack**: Deploy and manage the ELK Stack (Elasticsearch, Logstash, Kibana) for log aggregation and analysis. _(risk: critical)_
- **feature-flags**: Implement feature flags for progressive feature rollout using LaunchDarkly, Unleash, or custom solutions. _(risk: critical)_
- **fedora-hyprland-installer**: Install, configure, verify, repair, update, and uninstall Hyprland on Fedora Linux with GPU-aware detection (NVIDIA/AMD/Intel). _(risk: critical)_
- **firebase-app-platform**: Build and operate apps on Firebase using Auth, Firestore, Cloud Functions, and Hosting. Use when building mobile/web backends with managed services, real-time data sync, or serverless APIs. _(risk: critical)_
- **frontend-observability**: A portable, framework-agnostic field-side observability pattern for React or React Native integrations. _(risk: critical)_
- **gcp-cloud-functions**: Deploy serverless functions on Google Cloud Functions. Configure triggers and manage deployments. Use when implementing serverless workloads on GCP. _(risk: critical)_
- **gcp-cloud-sql**: Provision Cloud SQL databases. Configure high availability, backups, and security. Use when deploying managed databases on GCP. _(risk: critical)_
- **gcp-compute**: Manage Compute Engine instances and instance templates. Configure managed instance groups and preemptible VMs. Use when deploying compute resources on GCP. _(risk: critical)_
- **gcp-gke**: Deploy and manage Google Kubernetes Engine clusters. Configure node pools, networking, and workload identity. Use when running Kubernetes on GCP. _(risk: critical)_
- **gcp-networking**: Configure VPCs, firewall rules, and Cloud NAT. Implement shared VPC and private service connect. Use when designing GCP network infrastructure. _(risk: critical)_
- **git-workflow**: Implement Git branching strategies, PR workflows, and release management patterns. _(risk: critical)_
- **github-actions**: Build, test, and deploy applications using GitHub Actions workflows. _(risk: critical)_
- **github-actions-advanced**: Design, debug, and harden GitHub Actions CI/CD workflows, including reusable workflows, matrix builds, self-hosted runners, OIDC authentication, caching, environments, secrets, and release automation.
 _(risk: critical)_
- **github-actions-debugger**: Specialized skill for diagnosing, analyzing, and fixing failing GitHub Actions workflows by parsing run logs and pipeline definitions. _(risk: critical)_
- **gitlab-ci**: Configure GitLab CI/CD pipelines and runners for automated building, testing, and deployment. _(risk: critical)_
- **gpu-kubernetes-operations**: Operate GPU-backed Kubernetes clusters for AI inference and training with scheduling, autoscaling, node health, MIG partitioning, and cost controls. _(risk: critical)_
- **gpu-server-management**: Set up and manage NVIDIA GPU servers for AI workloads _(risk: critical)_
- **helm-charts**: Create, manage, and deploy Helm charts for Kubernetes package management. _(risk: critical)_
- **identity-access-management**: Set up and manage SSO, SCIM provisioning, and MFA for startup teams using Google Workspace, Okta, or Azure AD. _(risk: critical)_
- **jenkins**: Create and manage Jenkins CI/CD pipelines, configure agents, manage plugins, and automate builds. _(risk: critical)_
- **kubernetes-ops**: Deploy, scale, and manage Kubernetes workloads. _(risk: critical)_
- **kubestellar-console**: Multi-cluster Kubernetes dashboard with AI-powered operations via MCP server and 10+ built-in agent skills _(risk: critical)_
- **kustomize**: Customize Kubernetes manifests without templating using Kustomize. _(risk: critical)_
- **linux-administration**: System administration for Linux servers. Manage packages, services, and system configuration. Use when administering Linux systems. _(risk: critical)_
- **llm-caching**: Implement multi-layer LLM caching with exact match, semantic similarity, and provider-side prompt caching. _(risk: critical)_
- **llm-cost-optimization**: Reduce LLM API and infrastructure costs through model selection, prompt caching, batching, caching, quantization, and self-hosting strategies. _(risk: critical)_
- **llm-fine-tuning**: Set up infrastructure for fine-tuning LLMs with QLoRA, LoRA, and full fine-tuning using Hugging Face TRL, Axolotl, and distributed training with DeepSpeed or FSDP. _(risk: critical)_
- **llm-gateway**: Deploy an API gateway for LLM traffic with load balancing, rate limiting, key management, semantic caching, fallback routing, and cost tracking. _(risk: critical)_
- **llm-inference-scaling**: Auto-scale LLM inference clusters on Kubernetes using KEDA, custom GPU metrics, and horizontal pod autoscaling. _(risk: critical)_
- **llmops-platform-engineering**: Build production LLMOps platforms with CI/CD, model promotion workflows, evaluation gates, rollback, and governance across cloud and self-hosted inference. _(risk: critical)_
- **load-balancing**: Configure load balancers and traffic distribution. Implement health checks and SSL termination. Use when distributing traffic across servers. _(risk: critical)_
- **loki-logging**: Configure Grafana Loki for log aggregation and analysis. _(risk: critical)_
- **mac-mini-llm-lab**: Configure a Mac mini as a reliable local LLM server with remote access, observability, and power-safe operation. Use when building an always-on private AI inference server on Apple Silicon. _(risk: critical)_
- **mdm-device-management**: Manage and secure company devices with MDM solutions _(risk: critical)_
- **mirrord**: Run a local process inside a live Kubernetes cluster's network, env and traffic with mirrord, so changes are tested against real services without deploying. _(risk: critical)_
- **mise-configurator**: Generate production-ready mise.toml setups for local development, CI/CD pipelines, and toolchain standardization. _(risk: safe)_
- **model-registry-governance**: Establish model registry standards, governance controls, metadata schemas, approvals, and lifecycle policies for enterprise AI deployments. _(risk: critical)_
- **model-serving-kubernetes**: Deploy ML models on Kubernetes with KServe (formerly KFServing) and NVIDIA Triton Inference Server. _(risk: critical)_
- **mongodb**: Administer MongoDB databases. Configure replica sets, sharding, and backups. Use when managing MongoDB deployments. _(risk: critical)_
- **multi-tenant-llm-hosting**: Design secure, multi-tenant LLM hosting platforms with tenant isolation, quotas, billing attribution, noisy-neighbor protection, and per-tenant policy controls. _(risk: critical)_
- **mysql**: Administer MySQL/MariaDB databases. Configure replication and optimize performance. Use when managing MySQL deployments. _(risk: critical)_
- **new-relic**: Configure New Relic observability platform for infrastructure and application monitoring. _(risk: critical)_
- **newman-cicd-integration**: Generate ready-to-use CI/CD pipeline configurations that install and run Newman for automated API testing. _(risk: critical)_
- **nfs-storage**: Configure NFS servers and clients. Implement network file sharing for Linux systems. Use when setting up shared storage. _(risk: critical)_
- **object-storage**: Configure object storage with S3, GCS, and MinIO. Implement lifecycle policies and access controls. Use when managing object storage. _(risk: critical)_
- **observability-and-instrumentation**: Instruments code so production behavior is visible and diagnosable. Use when adding logging, metrics, tracing, or alerting. Use when shipping any feature that runs in production and you need evidence it works. _(risk: critical)_
- **ollama-stack**: Run local LLM workloads with Ollama, Open WebUI, and GPU-aware tuning for private development environments. _(risk: critical)_
- **openclaw-local-mac-mini**: Set up OpenClaw locally and run it reliably on a Mac mini for private, always-on local agent workflows. _(risk: critical)_
- **openclaw-security-hardening**: Harden OpenClaw self-hosted environments with baseline host controls, auth tightening, secret handling, network segmentation, and safe update/rollback workflows. _(risk: critical)_
- **openshift**: Manage Red Hat OpenShift clusters and deployments. _(risk: critical)_
- **opentelemetry**: Instrument applications and infrastructure with OpenTelemetry for unified traces, metrics, and logs. _(risk: critical)_
- **opentofu-migration**: Migrate from Terraform to OpenTofu with state compatibility, provider registry setup, and CI/CD pipeline updates. Use when adopting the open-source Terraform fork or evaluating license-free IaC. _(risk: critical)_
- **performance-tuning**: Optimize Linux system performance. Configure kernel parameters, analyze bottlenecks, and tune resources. Use when improving system performance. _(risk: critical)_
- **planetscale**: Operate MySQL-compatible databases on PlanetScale with branching workflows, safe migrations, and production rollouts. _(risk: critical)_
- **platform-engineering**: Build internal developer platforms (IDPs) with self-service infrastructure, golden paths, and developer portals using Backstage, Crossplane, and score. _(risk: critical)_
- **podman**: Manage containers using Podman, the daemonless container engine. _(risk: critical)_
- **postgresql-devsec**: Administer PostgreSQL databases. Configure replication, backups, and performance tuning. Use when managing PostgreSQL deployments. _(risk: critical)_
- **production-runtime-certification**: Certify a deployed service with fresh evidence across source, CI, migrations, runtime health, readiness, and critical routes; use before declaring a release production-ready. _(risk: safe)_
- **prometheus-grafana**: Set up metrics collection and visualization with Prometheus and Grafana. _(risk: critical)_
- **rag-infrastructure**: Build and operate Retrieval-Augmented Generation (RAG) infrastructure with vector stores, embedding pipelines, and hybrid search. _(risk: critical)_
- **rag-observability-evals**: Monitor and evaluate RAG systems with retrieval quality metrics, groundedness checks, hallucination detection, and continuous regression testing. _(risk: critical)_
- **redis**: Configure Redis for caching and data storage. Set up clustering, persistence, and Sentinel. Use when implementing Redis caching or queues. _(risk: critical)_
- **reverse-proxy**: Configure nginx and Traefik as reverse proxies. Implement SSL termination and routing. Use when setting up application gateways. _(risk: critical)_
- **saas-security-posture**: Audit and harden your SaaS tool stack _(risk: critical)_
- **semantic-versioning**: Automate versioning and changelog generation using semantic versioning principles. _(risk: critical)_
- **service-mesh**: Implement Istio and Linkerd service meshes. Configure mTLS, traffic management, and observability. Use when managing microservices communication. _(risk: critical)_
- **shipping-and-launch**: Prepares production launches. Use when preparing to deploy to production. Use when you need a pre-launch checklist, when setting up monitoring, when planning a staged rollout, or when you need a rollback strategy. _(risk: critical)_
- **solidping**: Run SolidPing uptime monitoring through its hosted MCP server: list and diagnose checks, read results and incidents, create checks across 40+ types, and manage status pages. _(risk: critical)_
- **sre-dashboards**: Design and operationalize SRE dashboards that surface reliability, latency, error, saturation, and capacity signals across services. _(risk: critical)_
- **ssh-configuration**: Configure SSH servers and clients securely. Manage keys, tunnels, and config files. Use when setting up secure remote access. _(risk: critical)_
- **sshepherd**: Zero-knowledge SSH ops CLI — server health checks, docker/systemd control, log tailing, Postgres introspection, and declarative deploys, without ever exposing credentials to the agent. _(risk: critical)_
- **startup-it-troubleshooting**: Practical IT troubleshooting playbooks for small teams without dedicated IT staff. _(risk: critical)_
- **systemd-services**: Create and manage systemd services and timers. Configure service dependencies and resource limits. Use when managing system services. _(risk: critical)_
- **terraform-aws**: Provision AWS infrastructure with Terraform. Create modules, manage state, and implement IaC best practices. Use when deploying AWS resources declaratively. _(risk: critical)_
- **terraform-azure**: Provision Azure infrastructure with Terraform. Configure providers, manage state, and deploy resources. Use when implementing IaC for Azure. _(risk: critical)_
- **terraform-gcp**: Provision GCP infrastructure with Terraform. Configure providers and deploy Google Cloud resources. Use when implementing IaC for GCP. _(risk: critical)_
- **user-management**: Manage users, groups, and permissions on Linux systems. Configure sudo and access controls. Use when managing system access. _(risk: critical)_
- **vector-database-ops**: Deploy, manage, and optimize vector databases for AI applications. _(risk: critical)_
- **vercel-cli-with-tokens**: Deploy and manage projects on Vercel using token-based authentication. Use when working with Vercel CLI using access tokens rather than interactive login — e.g. "deploy to vercel", "set up vercel", "add environment variables to vercel". _(risk: safe)_
- **vercel-deployments**: Deploy frontend and full-stack apps on Vercel with previews, edge functions, environment promotion, and production guardrails. _(risk: critical)_
- **vercel-optimize**: Audit deployed Vercel apps for cost and performance issues using metrics, project config, code scans, and version-aware recommendations. _(risk: critical)_
- **vibecode-production-qa-validator**: 13-phase production QA for fullstack Next.js apps: build verification, SEO tags, OG images, favicon, route regression, API auth, page speed, lazy load, vulnerability scan, UI/UX cards, error boundaries, database, secure rendering, and cleanup. _(risk: critical)_
- **vllm-server**: Deploy and manage vLLM for high-throughput LLM inference. Configure continuous batching, tensor parallelism, quantization, and OpenAI-compatible API endpoints for production LLM serving. _(risk: critical)_
- **webly**: Publish a website or share files at a live URL in seconds with no account, then let the person claim it, edit it over Webly's MCP server, and publish drafts they approve. _(risk: critical)_
- **windows-server**: Administer Windows Server systems. Manage IIS, Active Directory, and PowerShell automation. Use when administering Windows infrastructure. _(risk: critical)_

## document-processing

- **writer**: Document creation, format conversion (ODT/DOCX/PDF), mail merge, and automation with LibreOffice Writer. _(risk: safe)_
- **pdf-conversion-router**: Use when converting a PDF into another format such as Markdown, HTML, text, JSON, DOCX, or structured notes and the agent must choose the best extraction route, settings, and cleanup strategy for maximum fidelity and readability. _(risk: safe)_

## document-verification

- **check-identity-pack**: Run an AFP 100-point or AUSTRAC safe-harbour identity check over a set of documents, and report exactly what's missing. Use when the user asks to check identity documents, verify someone's ID for onboarding, or assess whether a document pack satisfies Australian identity requirements. _(risk: critical)_
- **detect-ai-text**: Estimate whether a document's prose was written by AI, with the linguistic tells and honest abstention on non-prose. Use when the user asks whether an essay, report, CV, submission, or article was AI-generated — for triage, not proof. _(risk: critical)_
- **extract-document-data**: Extract structured, grounded fields from documents — values cite their page, missing values abstain instead of hallucinating. Use for parsing invoices, payslips, statements, contracts. _(risk: critical)_
- **find-matching-tenders**: Find open AU/NZ government tenders matching what a company does, ranked by fit with why and gap analysis. Use when the user asks to find tenders, bid opportunities, government contracts, or RFPs for their business (or a client's). _(risk: critical)_
- **screen-adverse-media**: Screen a person or organisation for adverse media coverage, PEP status, and sanctions exposure — corroboration-gated, returns "review" never "guilty". Use when the user asks to screen someone before onboarding, partnership, or investment; for AML/CTF flows; or for ongoing counterparty monitoring. _(risk: critical)_
- **verify-citations**: Verify citations and references in a document, report, or article against real sources. Use when the user asks to fact-check, verify references, check citations, or validate evidence in research reports, tender responses, whitepapers, or academic writing. _(risk: critical)_
- **verify-document**: Check whether a document (PDF or image) shows signs of tampering or forgery before you rely on it. Use when the user asks to verify a payslip, invoice, bank statement, ID document, contract, or any document where authenticity matters. _(risk: critical)_

## dotnet

- **avalonia-layout-zafiro**: Guidelines for modern Avalonia UI layout using Zafiro.Avalonia, emphasizing shared styles, generic components, and avoiding XAML redundancy. _(risk: unknown)_
- **avalonia-viewmodels-zafiro**: Optimal ViewModel and Wizard creation patterns for Avalonia using Zafiro and ReactiveUI. _(risk: unknown)_
- **avalonia-zafiro-development**: Mandatory skills, conventions, and behavioral rules for Avalonia UI development using the Zafiro toolkit. _(risk: unknown)_
- **csharp-pro**: Write modern C# code with advanced features like records, pattern matching, and async/await. Optimizes .NET applications, implements enterprise patterns, and ensures comprehensive testing. _(risk: unknown)_
- **m365-agents-dotnet**: Microsoft 365 Agents SDK for .NET. Build multichannel agents for Teams/M365/Copilot Studio with ASP.NET Core hosting, AgentApplication routing, and MSAL-based auth. _(risk: unknown)_

## ecommerce

- **apify-ecommerce**: Scrape e-commerce data for pricing intelligence, customer reviews, and seller discovery across Amazon, Walmart, eBay, IKEA, and 50+ marketplaces. Use when user asks to monitor prices, track competi... _(risk: unknown)_
- **shopify-development**: Build Shopify apps, extensions, themes using GraphQL Admin API, Shopify CLI, Polaris UI, and Liquid. _(risk: unknown)_
- **buywhere-product-catalog**: Use BuyWhere's MCP and API surfaces to add product search, price comparison, and deal discovery to AI shopping agents. _(risk: safe)_
- **etsy-search-listings**: Fetch live Etsy search listing rows for a keyword, market phrase, or category via Apify Actor publicrecords/etsy-search-scraper (MCP). Needs an Apify token; Actor run is billed. _(risk: critical)_
- **etsy-shop-sales-history**: Read Etsy shop sales counters, deltas, and breakout flags from Apify Actor publicrecords/etsy-shop-velocity (MCP panel snapshot). Needs an Apify token; Actor run is billed. _(risk: critical)_
- **woo-guard**: Review generated or changed WooCommerce extensions, payment and shipping integrations, checkout customizations, and order or product logic. _(risk: critical)_

## education

- **examprep-ai**: Exam preparation assistant that converts syllabi, past papers, or notes into a ranked High Score Roadmap. Covers theory, numericals, MCQs, coding, and lab prep, ordered Easy → Medium → Hard. Use for last-minute revision, important topics, and question prediction. _(risk: safe)_
- **learn**: Help a user learn a topic through adaptive tutoring, lesson planning, practice, retrieval checks, explanations, study guides, or exercises. Use when the user asks to learn, understand, practice, drill, review, study, or be tutored on something. _(risk: safe)_
- **lesson-generator**: Build compact, standalone multi-lesson course artifacts with lesson navigation, objectives, flashcards, quizzes, and source links. _(risk: safe)_
- **puzzle-activity-planner**: Plan puzzle-based activities for classrooms, parties, and events with pre-configured generator links _(risk: safe)_
- **teach**: Teach the user a new skill or concept, within this workspace. _(risk: safe)_

## embedded-systems

- **arm-cortex-expert**: Senior embedded software engineer specializing in firmware and driver development for ARM Cortex-M microcontrollers (Teensy, STM32, nRF52, SAMD). _(risk: unknown)_
- **cpp-pro**: Write idiomatic C++ code with modern features, RAII, smart pointers, and STL algorithms. Handles templates, move semantics, and performance optimization. _(risk: unknown)_

## engineering

- **ai-agent-evaluation-benchmarking**: Autonomous AI agent benchmark evaluation register: task completion rates, planning accuracy, tool invocation precision, and cost benchmarks. _(risk: safe)_
- **ai-agent-tool-routing**: Use when designing or reviewing an AI agent tool registry or MCP router: document parameter schemas, caller authorization, execution limits, replay-safe retries and verification evidence. _(risk: safe)_
- **ai-code-generation-guardrails**: Use when reviewing AI-generated code before merge or execution: plan AST/security checks, isolated behavior tests and evidence, with language-specific coverage limits. _(risk: safe)_
- **ai-prompt-regression-testing**: Use when comparing prompt changes against a fixed evaluation set: record actual model settings, required checks, missing results, judge limitations and case-level regression evidence. _(risk: safe)_
- **cross-chain-relayer-audit**: Cross-chain relayer bridge audit register: message hash verifications, replay protection nonces, validator quorum, and withdrawal proofs. _(risk: safe)_
- **defi-yield-strategy-allocator**: Multi-vault automated yield strategy allocation register: APY benchmarks, impermanent loss risk tiers, and rebalancing triggers. _(risk: safe)_
- **observability-cloud-planning**: Build a cloud, SLO, and incident-readiness register after intake. Use when an SME needs monitoring scope, alert ownership, cost limits, or service planning. _(risk: safe)_
- **smart-contract-formal-verification**: Foundry and Soroban formal invariant verification register: state transition rules, boundary invariant properties, and symbolic execution checks. _(risk: safe)_
- **smart-contract-upgrade-governance**: Soroban WASM upgrade governance register: executable bytecode hash, timelocked migration delays, and multi-sig authorization quorum. _(risk: safe)_
- **soroban-contract-audit**: Soroban smart contract security audit register: authorization checks, panic pathways, integer overflows, and storage footprint verification for Stellar. _(risk: safe)_
- **soroban-liquidity-pool**: Automated market maker liquidity pool register: constant-product invariant curves, swap fee tiers, and LP token shares for Soroban DeFi. _(risk: safe)_
- **soroban-oracle-data-feed-audit**: DeFi price oracle integration and safety audit register: heartbeat bounds, stale price threshold reversion, and TWAP medianizer validation. _(risk: safe)_
- **soroban-storage-ttl-lifecycle**: Soroban ledger state rent and TTL extension register: live state tracking, bump thresholds, rent fee reserves, and archive boundaries. _(risk: safe)_
- **soroban-token-minter**: Soroban SEP-41 token contract architecture register: admin control, supply caps, metadata standard, and transfer event emissions on Stellar. _(risk: safe)_
- **stellar-anchor-integration**: Stellar anchor protocol compliance register: SEP-10 web authentication, SEP-24 interactive deposit and withdrawal, and KYC lifecycle. _(risk: safe)_
- **stellar-asset-clawback-compliance**: Regulated Stellar asset clawback architecture register: issuer authorization flags, claimable balance revocations, and regulatory audit trail. _(risk: safe)_
- **stellar-escrow-timelock**: Decentralized conditional escrow and timelock contract register: multi-signature release conditions, clawback expiry, and settlement triggers. _(risk: safe)_
- **stellar-multisig-threshold-coordinator**: Multi-signature signer and threshold coordination register: weight configurations, master key locks, and cosigner quorum thresholds for Stellar. _(risk: safe)_
- **web3-rate-limiting-circuit-breaker**: On-chain and relayer rate-limiting circuit breaker register: throughput thresholds, emergency pause triggers, and multi-sig recovery. _(risk: safe)_
- **web3-transaction-relayer-pool**: Gasless transaction relayer node pool register: fee sponsorship limits, nonce synchronization, and balance replenishment alerts. _(risk: safe)_
- **zk-proof-verification-pipeline**: Zero-knowledge cryptographic verification pipeline register: proving system, circuit verification keys, public inputs, and gas costs. _(risk: safe)_

## finance

- **axonx**: Develop AxonX research plugins and operate quantitative research tasks through CLI or MCP, inspecting execution status, logs, artifacts, and lineage. _(risk: critical)_
- **calibrate-first**: Measure a dataset's detection floor before reading any trading-signal result, pre-register every test, and report too-small-to-see as UNDECIDABLE, not 'no effect'. _(risk: critical)_
- **equibles**: Query Equibles for US stock market data: SEC filing search, XBRL financial statements, earnings call transcripts, insider and 13F holdings, and daily prices. _(risk: safe)_
- **fxmacrodata**: Query FXMacroData for official-source macro indicators, release calendars, central-bank policy rates, FX rates and CFTC positioning across 22 currencies. _(risk: safe)_
- **krexa**: Turn a trading idea, post or video into fixed rules, backtest and paper-trade them, and request a user-approved live agent through Krexa's MCP server. Cannot move funds. _(risk: critical)_
- **longbridge**: Guide to using a separately installed Longbridge integration — real-time quotes, charts, fundamentals, portfolio analysis, options, and more for HK/US/A-share/SG markets. Trilingual: Simplified Chinese, Traditional Chinese, English. _(risk: critical)_
- **longbridge-content**: Latest news articles, regulatory filings, community discussion topics for listed stocks, and SEC EDGAR filing analysis (10-K/10-Q/8-K/proxy/Form 4) via Longbridge. _(risk: critical)_
- **longbridge-derivatives**: Curated upstream guidance for Longbridge Derivatives; use when the workflow matches the user goal. _(risk: unknown)_
- **longbridge-fundamentals**: Financial statements, business segments, dividends, valuation multiples (PE/PB/PS), industry comparison, operating data, corporate actions, company and executive profiles, cross-stock comparison, and valuation ranking via Longbridge. _(risk: critical)_
- **longbridge-market-data**: Real-time quotes, K-line charts, order book, trade ticks, intraday capital flow, market sentiment temperature, trading session schedule, security lists, exchange rates, and IPO calendar for HK/US/A-share/SG via Longbridge. Also covers ADR premium and FX carry frameworks. _(risk: critical)_
- **longbridge-quant**: Curated upstream guidance for Longbridge Quant; use when the workflow matches the user goal. _(risk: critical)_
- **options-flow-analyzer**: Compare raw and explicitly filtered options put/call ratios with documented premium, delta and expiry assumptions _(risk: safe)_
- **traderspy-market-briefing**: Crypto market briefing from live TraderSpy data: majors, funding, open interest, top-trader lean, fresh AI signals and screener movers. Use for "what's happening in crypto" or a recap. _(risk: safe)_
- **traderspy-market-screener**: Scan the most-traded crypto futures pairs for up to 3 technical conditions in one TraderSpy call, compare coins, and backtest what followed a condition. Use for "which coins are oversold". _(risk: safe)_
- **traderspy-position-check**: Health-check crypto futures positions the user describes, with TraderSpy data: liquidation and stop distance, multi-timeframe read, funding and top-trader side. Reports only; never tells the user to close or add. _(risk: safe)_
- **traderspy-smart-money**: Track what top crypto futures traders hold on Binance, Hyperliquid, Bybit and OKX with TraderSpy: elite leaderboard, positions, trader profiles and history. Use for "what are whales doing". _(risk: safe)_
- **traderspy-technical-analysis**: Read one crypto futures pair with TraderSpy: 19 indicators on up to 3 timeframes in one call, key levels, funding, open interest and positioning. Use for "analyse BTC" or "is SOL oversold". _(risk: critical)_
- **traderspy-trading-signals**: Fetch and explain TraderSpy's AI crypto futures signals: entry, take-profit ladder, stop, triggers, status against the live price, and how recent signals resolved. Use for "latest signals". _(risk: safe)_
- **xvary-stock-research**: Thesis-driven equity analysis from public SEC EDGAR and market data; /analyze, /score, /compare workflows with bundled Python tools (Claude Code, Cursor, Codex). _(risk: critical)_
- **yield-intelligence**: Passive income portfolio analysis — activate when user asks about dividend yields, Treasury rates, REIT income, monthly passive income goals, or portfolio yield optimization. Scans 4 asset classes, ranks by risk-adjusted return, and builds allocations targeting a specific monthly income. _(risk: safe)_

## fintech

- **backtesting-frameworks**: Build robust backtesting systems for trading strategies with proper handling of look-ahead bias, survivorship bias, and transaction costs. Use when developing trading algorithms, validating strateg... _(risk: unknown)_
- **odoo-accounting-setup**: Expert guide for configuring Odoo Accounting: chart of accounts, journals, fiscal positions, taxes, payment terms, and bank reconciliation. _(risk: safe)_
- **pci-compliance**: Implement PCI DSS compliance requirements for secure handling of payment card data and payment systems. Use when securing payment processing, achieving PCI compliance, or implementing payment card ... _(risk: unknown)_
- **startup-financial-modeling**: This skill should be used when the user asks to \\\"create financial projections", "build a financial model", "forecast revenue", "calculate burn rate", "estimate runway", "model cash flow", or... _(risk: unknown)_

## framework

- **nestjs-expert**: Nest.js framework expert specializing in module architecture, dependency injection, middleware, guards, interceptors, testing with Jest/Supertest, TypeORM/Mongoose integration, and Passport.js auth... _(risk: unknown)_
- **typescript-expert**: TypeScript and JavaScript expert with deep knowledge of type-level programming, performance optimization, monorepo management, migration strategies, and modern tooling. _(risk: unknown)_
- **trpc-fullstack**: Build end-to-end type-safe APIs with tRPC — routers, procedures, middleware, subscriptions, and Next.js/React integration patterns.

## front-end

- **landing-page-generator**: Generates high-converting Next.js/React landing pages with Tailwind CSS. Uses PAS, AIDA, and BAB frameworks for optimized copy/components (Heroes, Features, Pricing). Focuses on Core Web Vitals/SEO. _(risk: critical)_
- **progressive-web-app**: Build Progressive Web Apps (PWAs) with offline support, installability, and caching strategies. Trigger whenever the user mentions PWA, service workers, web app manifests, Workbox, 'add to home screen', or wants their web app to work offline, feel native, or be installable. _(risk: critical)_

## frontend

- **3d-web-experience**: Expert in building 3D experiences for the web - Three.js, React Three Fiber, Spline, WebGL, and interactive 3D scenes. Covers product configurators, 3D portfolios, immersive websites, and bringing ... _(risk: unknown)_
- **accessibility-compliance-accessibility-audit**: You are an accessibility expert specializing in WCAG compliance, inclusive design, and assistive technology compatibility. Conduct audits, identify barriers, and provide remediation guidance. _(risk: unknown)_
- **algolia-search**: Expert patterns for Algolia search implementation, indexing strategies, React InstantSearch, and relevance tuning Use when: adding search to, algolia, instantsearch, search api, search functionality. _(risk: unknown)_
- **angular**: Modern Angular (v20+) expert with deep knowledge of Signals, Standalone Components, Zoneless applications, SSR/Hydration, and reactive patterns. _(risk: safe)_
- **angular-best-practices**: Angular performance optimization and best practices guide. Use when writing, reviewing, or refactoring Angular code for optimal performance, bundle size, and rendering efficiency. _(risk: safe)_
- **angular-migration**: Migrate from AngularJS to Angular using hybrid mode, incremental component rewriting, and dependency injection updates. Use when upgrading AngularJS applications, planning framework migrations, or ... _(risk: unknown)_
- **angular-state-management**: Master modern Angular state management with Signals, NgRx, and RxJS. Use when setting up global state, managing component stores, choosing between state solutions, or migrating from legacy patterns. _(risk: safe)_
- **angular-ui-patterns**: Modern Angular UI patterns for loading states, error handling, and data display. Use when building UI components, handling async data, or managing component states. _(risk: safe)_
- **antigravity-design-expert**: Core UI/UX engineering skill for building highly interactive, spatial, weightless, and glassmorphism-based web interfaces using GSAP and 3D CSS. _(risk: safe)_
- **baseline-ui**: Validates animation durations, enforces typography scale, checks component accessibility, and prevents layout anti-patterns in Tailwind CSS projects. Use when building UI components, reviewing CSS utilities, styling React views, or enforcing design consistency. _(risk: unknown)_
- **cc-skill-backend-patterns**: Backend architecture patterns, API design, database optimization, and server-side best practices for Node.js, Express, and Next.js API routes. _(risk: unknown)_
- **cc-skill-coding-standards**: Universal coding standards, best practices, and patterns for TypeScript, JavaScript, React, and Node.js development. _(risk: unknown)_
- **cc-skill-frontend-patterns**: Frontend development patterns for React, Next.js, state management, performance optimization, and UI best practices. _(risk: unknown)_
- **enhance-prompt**: Transforms vague UI ideas into polished, Stitch-optimized prompts. Enhances specificity, adds UI/UX keywords, injects design system context, and structures output for better generation results. _(risk: unknown)_
- **expo-tailwind-setup**: Set up Tailwind CSS v4 in Expo with react-native-css and NativeWind v5 for universal styling _(risk: unknown)_
- **fixing-accessibility**: Audit and fix HTML accessibility issues including ARIA labels, keyboard navigation, focus management, color contrast, and form errors. Use when adding interactive controls, forms, dialogs, or reviewing WCAG compliance. _(risk: unknown)_
- **fixing-metadata**: Audit and fix HTML metadata including page titles, meta descriptions, canonical URLs, Open Graph tags, Twitter cards, favicons, JSON-LD structured data, and robots directives. Use when adding SEO metadata, fixing social share previews, reviewing Open Graph tags,... _(risk: unknown)_
- **fixing-motion-performance**: Audit and fix animation performance issues including layout thrashing, compositor properties, scroll-linked motion, and blur effects. Use when animations stutter, transitions jank, or reviewing CSS/JS animation performance. _(risk: unknown)_
- **fp-react**: Practical patterns for using fp-ts with React - hooks, state, forms, data fetching. Works with React 18/19, Next.js 14/15. _(risk: unknown)_
- **fp-ts-react**: Practical patterns for using fp-ts with React - hooks, state, forms, data fetching. Use when building React apps with functional programming patterns. Works with React 18/19, Next.js 14/15. _(risk: safe)_
- **frontend-design**: Create distinctive, production-grade frontend interfaces with intentional aesthetics, high craft, and non-generic visual identity. Use when building or styling web UIs, components, pages, dashboard... _(risk: unknown)_
- **frontend-dev-guidelines**: Opinionated frontend development standards for modern React + TypeScript applications. Covers Suspense-first data fetching, lazy loading, feature-based architecture, MUI v7 styling, TanStack Router... _(risk: unknown)_
- **frontend-developer**: Build React components, implement responsive layouts, and handle client-side state management. Masters React 19, Next.js 15, and modern frontend architecture. _(risk: unknown)_
- **frontend-mobile-development-component-scaffold**: You are a React component architecture expert specializing in scaffolding production-ready, accessible, and performant components. Generate complete component implementations with TypeScript, tests, s _(risk: unknown)_
- **frontend-ui-dark-ts**: Build dark-themed React applications using Tailwind CSS with custom theming, glassmorphism effects, and Framer Motion animations. Use when creating dashboards, admin panels, or data-rich interfaces... _(risk: unknown)_
- **health-trend-analyzer**: 分析一段时间内健康数据的趋势和模式。关联药物、症状、生命体征、化验结果和其他健康指标的变化。识别令人担忧的趋势、改善情况，并提供数据驱动的洞察。当用户询问健康趋势、模式、随时间的变化或"我的健康状况有什么变化？"时使用。支持多维度分析（体重/BMI、症状、药物依从性、化验结果、情绪睡眠），相关性分析，变化检测，以及交互式HTML可视化报告（ECharts图表）。 _(risk: unknown)_
- **html-injection-testing**: This skill should be used when the user asks to "test for HTML injection", "inject HTML into web pages", "perform HTML injection attacks", "deface web applications", or "test conten... _(risk: unknown)_
- **iconsax-library**: Extensive icon library and AI-driven icon generation skill for premium UI/UX design. _(risk: safe)_
- **javascript-typescript-typescript-scaffold**: You are a TypeScript project architecture expert specializing in scaffolding production-ready Node.js and frontend applications. Generate complete project structures with modern tooling (pnpm, Vite, N _(risk: unknown)_
- **magic-ui-generator**: Utilizes Magic by 21st.dev to generate, compare, and integrate multiple production-ready UI component variations. _(risk: safe)_
- **makepad-platform**: CRITICAL: Use for Makepad cross-platform support. Triggers on:
makepad platform, makepad os, makepad macos, makepad windows, makepad linux,
makepad android, makepad ios, makepad web, makepad wasm, makepad metal,
makepad d3d11, makepad opengl, makepad webgl, OsType, CxOs,
makepad 跨平台, makepad 平台支持 _(risk: unknown)_
- **makepad-widgets**: CRITICAL: Use for Makepad widgets and UI components. Triggers on:
makepad widget, makepad View, makepad Button, makepad Label, makepad Image,
makepad TextInput, RoundedView, SolidView, ScrollView, "makepad component",
makepad Markdown, makepad Html, TextFlow, rich... _(risk: unknown)_
- **mobile-developer**: Develop React Native, Flutter, or native mobile apps with modern architecture patterns. Masters cross-platform development, native integrations, offline sync, and app store optimization. _(risk: unknown)_
- **native-data-fetching**: Use when implementing or debugging ANY network request, API call, or data fetching. Covers fetch API, React Query, SWR, error handling, caching, offline support, and Expo Router data loaders (useLoaderData). _(risk: unknown)_
- **nextjs-app-router-patterns**: Master Next.js 14+ App Router with Server Components, streaming, parallel routes, and advanced data fetching. Use when building Next.js applications, implementing SSR/SSG, or optimizing React Serve... _(risk: unknown)_
- **nextjs-best-practices**: Next.js App Router principles. Server Components, data fetching, routing patterns. _(risk: unknown)_
- **nextjs-supabase-auth**: Expert integration of Supabase Auth with Next.js App Router Use when: supabase auth next, authentication next.js, login supabase, auth middleware, protected route. _(risk: unknown)_
- **playwright-skill**: Complete browser automation with Playwright. Auto-detects dev servers, writes clean test scripts to /tmp. Test pages, fill forms, take screenshots, check responsive design, validate UX, test login ... _(risk: unknown)_
- **radix-ui-design-system**: Build accessible design systems with Radix UI primitives. Headless component customization, theming strategies, and compound component patterns for production-grade UI libraries. _(risk: safe)_
- **react-flow-node-ts**: Create React Flow node components with TypeScript types, handles, and Zustand integration. Use when building custom nodes for React Flow canvas, creating visual workflow editors, or implementing no... _(risk: unknown)_
- **react-modernization**: Upgrade React applications to latest versions, migrate from class components to hooks, and adopt concurrent features. Use when modernizing React codebases, migrating to React Hooks, or upgrading to... _(risk: unknown)_
- **react-native-architecture**: Build production React Native apps with Expo, navigation, native modules, offline sync, and cross-platform patterns. Use when developing mobile apps, implementing native integrations, or architecti... _(risk: unknown)_
- **react-patterns**: Modern React patterns and principles. Hooks, composition, performance, TypeScript best practices. _(risk: unknown)_
- **react-state-management**: Master modern React state management with Redux Toolkit, Zustand, Jotai, and React Query. Use when setting up global state, managing server state, or choosing between state management solutions. _(risk: unknown)_
- **react-ui-patterns**: Modern React UI patterns for loading states, error handling, and data fetching. Use when building UI components, handling async data, or managing UI states. _(risk: unknown)_
- **remotion-best-practices**: Best practices for Remotion - Video creation in React _(risk: unknown)_
- **screen-reader-testing**: Test web applications with screen readers including VoiceOver, NVDA, and JAWS. Use when validating screen reader compatibility, debugging accessibility issues, or ensuring assistive technology supp... _(risk: unknown)_
- **senior-architect**: Comprehensive software architecture skill for designing scalable, maintainable systems using ReactJS, NextJS, NodeJS, Express, React Native, Swift, Kotlin, Flutter, Postgres, GraphQL, Go, Python. I... _(risk: unknown)_
- **senior-frontend**: Frontend development skill for React, Next.js, TypeScript, and Tailwind CSS applications. Use when building React components, optimizing Next.js performance, analyzing bundle sizes, scaffolding frontend projects, implementing accessibility, or reviewing frontend code quality. _(risk: safe)_
- **senior-fullstack**: Comprehensive fullstack development skill for building complete web applications with React, Next.js, Node.js, GraphQL, and PostgreSQL. Includes project scaffolding, code quality analysis, architec... _(risk: unknown)_
- **seo-fundamentals**: Core principles of SEO including E-E-A-T, Core Web Vitals, technical foundations, content quality, and how modern search engines evaluate pages. _(risk: unknown)_
- **shadcn**: Manages shadcn/ui components and projects, providing context, documentation, and usage patterns for building modern design systems. _(risk: safe)_
- **shopify-apps**: Expert patterns for Shopify app development including Remix/React Router apps, embedded apps with App Bridge, webhook handling, GraphQL Admin API, Polaris components, billing, and app extensions. U... _(risk: unknown)_
- **slack-automation**: Automate Slack messaging, channel management, search, reactions, and threads via Rube MCP (Composio). Send messages, search conversations, manage channels/users, and react to messages programmatica... _(risk: unknown)_
- **stitch-ui-design**: Expert guide for creating effective prompts for Google Stitch AI UI design tool. Use when user wants to design UI/UX in Stitch, create app interfaces, generate mobile/web designs, or needs help cra... _(risk: safe)_
- **tailwind-design-system**: Build scalable design systems with Tailwind CSS, design tokens, component libraries, and responsive patterns. Use when creating component libraries, implementing design systems, or standardizing UI... _(risk: unknown)_
- **tanstack-query-expert**: Expert in TanStack Query (React Query) — asynchronous state management. Covers data fetching, stale time configuration, mutations, optimistic updates, and Next.js App Router (SSR) integration. _(risk: safe)_
- **theme-factory**: Toolkit for styling artifacts with a theme. These artifacts can be slides, docs, reportings, HTML landing pages, etc. There are 10 pre-set themes with colors/fonts that you can apply to any artifac... _(risk: unknown)_
- **threejs-animation**: Three.js animation - keyframe animation, skeletal animation, morph targets, animation mixing. Use when animating objects, playing GLTF animations, creating procedural motion, or blending animations. _(risk: unknown)_
- **threejs-fundamentals**: Three.js scene setup, cameras, renderer, Object3D hierarchy, coordinate systems. Use when setting up 3D scenes, creating cameras, configuring renderers, managing object hierarchies, or working with transforms. _(risk: unknown)_
- **threejs-geometry**: Three.js geometry creation - built-in shapes, BufferGeometry, custom geometry, instancing. Use when creating 3D shapes, working with vertices, building custom meshes, or optimizing with instanced rendering. _(risk: unknown)_
- **threejs-interaction**: Three.js interaction - raycasting, controls, mouse/touch input, object selection. Use when handling user input, implementing click detection, adding camera controls, or creating interactive 3D experiences. _(risk: unknown)_
- **threejs-lighting**: Three.js lighting - light types, shadows, environment lighting. Use when adding lights, configuring shadows, setting up IBL, or optimizing lighting performance. _(risk: unknown)_
- **threejs-loaders**: Three.js asset loading - GLTF, textures, images, models, async patterns. Use when loading 3D models, textures, HDR environments, or managing loading progress. _(risk: unknown)_
- **threejs-postprocessing**: Three.js post-processing - EffectComposer, bloom, DOF, screen effects. Use when adding visual effects, color grading, blur, glow, or creating custom screen-space shaders. _(risk: unknown)_
- **threejs-shaders**: Three.js shaders - GLSL, ShaderMaterial, uniforms, custom effects. Use when creating custom visual effects, modifying vertices, writing fragment shaders, or extending built-in materials. _(risk: unknown)_
- **threejs-skills**: Create 3D scenes, interactive experiences, and visual effects using Three.js. Use when user requests 3D graphics, WebGL experiences, 3D visualizations, animations, or interactive 3D elements. _(risk: safe)_
- **threejs-textures**: Three.js textures - texture types, UV mapping, environment maps, texture settings. Use when working with images, UV coordinates, cubemaps, HDR environments, or texture optimization. _(risk: unknown)_
- **ui-skills**: Opinionated, evolving constraints to guide agents when building interfaces _(risk: safe)_
- **ui-ux-designer**: Create interface designs, wireframes, and design systems. Masters user research, accessibility standards, and modern design tools. _(risk: unknown)_
- **ui-ux-pro-max**: UI/UX design intelligence. 50 styles, 21 palettes, 50 font pairings, 20 charts, 9 stacks (React, Next.js, Vue, Svelte, SwiftUI, React Native, Flutter, Tailwind, shadcn/ui). Actions: plan, build, cr... _(risk: unknown)_
- **ui-visual-validator**: Rigorous visual validation expert specializing in UI testing, design system compliance, and accessibility verification. _(risk: unknown)_
- **wcag-audit-patterns**: Conduct WCAG 2.2 accessibility audits with automated testing, manual verification, and remediation guidance. Use when auditing websites for accessibility, fixing WCAG violations, or implementing ac... _(risk: unknown)_
- **web-design-guidelines**: Review UI code for Web Interface Guidelines compliance. Use when asked to \"review my UI\", \"check accessibility\", \"audit design\", \"review UX\", or \"check my site aga... _(risk: unknown)_
- **web-performance-optimization**: Optimize website and web application performance including loading speed, Core Web Vitals, bundle size, caching strategies, and runtime performance _(risk: unknown)_
- **webapp-testing**: Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browse... _(risk: unknown)_
- **zod-validation-expert**: Expert in Zod — TypeScript-first schema validation. Covers parsing, custom errors, refinements, type inference, and integration with React Hook Form, Next.js, and tRPC. _(risk: safe)_
- **zustand-store-ts**: Create Zustand stores with TypeScript, subscribeWithSelector middleware, and proper state/action separation. Use when building React state management, creating global stores, or implementing reacti... _(risk: unknown)_
- **anti-slop-design**: Autonomous Principal Design Technologist. Cures vibe-coded software from AI frontend slop using curated token archetypes and 7-axis quality gating. _(risk: critical)_
- **anti-ui-slop**: Stop coding agents from shipping generic UI. Extend the product's design system, use UIZZE evidence only when useful, cover required states, and inspect the rendered result. _(risk: safe)_
- **astro**: Build content-focused websites with Astro — zero JS by default, islands architecture, multi-framework components, and Markdown/MDX support. _(risk: safe)_
- **build-ui**: Step-by-step workflow for UI work: read the project, follow the plan for the job (new screen, dashboard, polish, simplify, review), then render, fix and check again. _(risk: safe)_
- **design-it**: Routes frontend design tasks to 48 specific UI styles. Triggers for websites, app screens, or UI components requesting a specific aesthetic. _(risk: safe)_
- **design-taste-frontend**: Use when building high-agency frontend interfaces with strict design taste, calibrated color, responsive layout, and motion rules. _(risk: safe)_
- **design-token-contrast**: Checks WCAG 2.2 contrast between the color tokens of a project (light and dark theme) and suggests the closest passing color that keeps the hue. _(risk: safe)_
- **emil-design-eng**: Use when designing or reviewing polished product UI with Emil Kowalski-inspired animation, interaction, and component craft guidance. _(risk: safe)_
- **frontend-api-integration-patterns**: Production-ready patterns for integrating frontend applications with backend APIs, including race condition handling, request cancellation, retry strategies, error normalization, and UI state management. _(risk: safe)_
- **frontend-data-contracts**: A portable, framework-agnostic discipline for type safety at the network edge of any React or React Native app. _(risk: critical)_
- **frontend-lighthouse**: Add a portable Lighthouse CI gate for production frontend builds with Core Web Vitals budgets, category floors, median runs, and CI artifacts. _(risk: safe)_
- **frontend-optimistic-mutations**: A portable, framework-agnostic discipline for the write path of any React or React Native app using a query/cache layer. _(risk: critical)_
- **full-output-enforcement**: Use when a task requires exhaustive unabridged output, complete files, or strict prevention of placeholders and skipped code. _(risk: safe)_
- **gpt-taste**: Use when generating elite GSAP-heavy frontend pages with strict AIDA structure, wide hero typography, and gapless bento grids. _(risk: safe)_
- **high-end-visual-design**: Use when designing expensive agency-grade interfaces with premium fonts, spatial rhythm, soft depth, and fluid microinteractions. _(risk: safe)_
- **industrial-brutalist-ui**: Use when creating raw industrial or tactical telemetry UIs with rigid grids, stark typography, CRT effects, and high-density data. _(risk: safe)_
- **ios-screens**: Build iPhone app screens that feel native: navigation, sheets, Dynamic Type, dark mode, permissions and paywalls, checked on small and large iPhones. _(risk: safe)_
- **landing-page**: Build landing, home and pricing pages that look like a real product instead of AI output: honest copy, one design system, checked on phone and desktop. _(risk: safe)_
- **markstream-angular**: Integrate the alpha markstream-angular renderer into Angular 20+ applications with standalone components, signals, safe HTML defaults, and optional peer features. _(risk: critical)_
- **markstream-custom-components**: Override Markstream node renderers and add trusted custom tags across Vue, React, Svelte, and Angular using scoped or renderer-local mappings. _(risk: critical)_
- **markstream-install**: Install and configure Markstream streaming Markdown renderers for Vue, React, Svelte, Angular, Nuxt, Next.js, and Vue 2 applications. _(risk: critical)_
- **markstream-migration**: Audit and migrate an existing Markdown renderer to Markstream while preserving custom renderers, security policy, streaming behavior, and explicit parity gaps. _(risk: critical)_
- **markstream-nuxt**: Integrate markstream-vue into Nuxt 3 or 4 with SSR-safe client boundaries, renderer modes, explicit CSS, and browser-only optional peers. _(risk: critical)_
- **markstream-react**: Integrate the beta markstream-react renderer into React 18+ or Next.js with correct client/server entrypoints, CSS, streaming state, and component overrides. _(risk: critical)_
- **markstream-svelte**: Integrate the beta markstream-svelte renderer into Svelte 5 or SvelteKit with runes, explicit CSS, smooth streaming, workers, and SSR-safe boundaries. _(risk: critical)_
- **markstream-vue**: Integrate markstream-vue into plain Vue 3 with renderer modes, code and DOM choices, streaming state, virtualization, optional peers, and scoped components. _(risk: critical)_
- **markstream-vue2**: Integrate markstream-vue2 into Vue 2.6 or 2.7 with correct Composition API decisions, CSS, streaming state, optional peers, and scoped overrides. _(risk: critical)_
- **markstream-vue2-cli**: Integrate markstream-vue2 into Vue CLI or Webpack 4 with export-map-safe CSS, CDN worker fallbacks, and conservative code-block defaults. _(risk: critical)_
- **markstream-vue2-vite**: Integrate markstream-vue2 into Vue 2 plus Vite with bundled worker imports, CSS ordering, Composition API compatibility, and safe streaming defaults. _(risk: critical)_
- **minimalist-ui**: Use when creating clean editorial interfaces with warm monochrome palettes, crisp borders, restrained motion, and flat bento layouts. _(risk: safe)_
- **premium-3d-website**: Guidelines for building premium 3D websites, focusing on custom WebGL shaders, post-processing, physics-based interactions, smooth animations, preloaders, and device optimization. _(risk: safe)_
- **redesign-existing-projects**: Use when upgrading existing websites or apps by auditing generic UI patterns and applying premium design fixes without rewrites. _(risk: safe)_
- **review-animations**: Use when reviewing animation and motion code against a strict craft, performance, accessibility, and interaction-quality bar. _(risk: safe)_
- **stitch-design-taste**: Use when generating Google Stitch DESIGN.md systems for premium typography, color, layout, motion intent, and anti-generic UI rules. _(risk: safe)_
- **sveltekit**: Build full-stack web applications with SvelteKit — file-based routing, SSR, SSG, API routes, and form actions in one framework. _(risk: safe)_
- **tastegate**: Build or fix a frontend so it looks designed, not AI-generated, then prove it in a real browser: renders at phone and desktop width and fails on overlap, low contrast and AI-slop defaults. _(risk: safe)_
- **ui-from-screenshot**: Turn a screenshot or mockup into matching UI with the project's own components, then compare the result side by side with the image and fix the differences. _(risk: safe)_
- **ui-states**: Design and build the UI states agents forget: first use, empty, loading, error, offline, no results, long content, permission denied and success. _(risk: safe)_
- **uxkin-research**: Research how real products handle a screen, flow or visual style before designing it: search UXKIN's real iOS screens, user journeys and website design systems, compare several and report what they share. _(risk: safe)_
- **web-design-system**: Choose a design direction for a website from real sites and write it down as a DESIGN.md: colors with roles, type, spacing, radius, shadows and components, in light and dark. _(risk: safe)_
- **web-review**: Review a website or landing page and list what to fix, most important first: message, generic AI look, consistency, copy, mobile, accessibility, speed and missing states. _(risk: safe)_
- **write-design-md**: Write or update a project's DESIGN.md from the colors, type, spacing and components it really uses, with rules agents follow so new screens match. _(risk: safe)_

## fullstack

- **vibe-code-cleanup**: Safe production cleanup and hardening for vibe-coded fullstack apps (Next.js, React, Node.js, etc.). Removes dead imports, unused files, and broken references without breaking routes or APIs. _(risk: safe)_

## game-development

- **2d-games**: 2D game development principles. Sprites, tilemaps, physics, camera. _(risk: unknown)_
- **3d-games**: 3D game development principles. Rendering, shaders, physics, cameras. _(risk: unknown)_
- **game-art**: Game art principles. Visual style selection, asset pipeline, animation workflow. _(risk: unknown)_
- **game-audio**: Game audio principles. Sound design, music integration, adaptive audio systems. _(risk: unknown)_
- **game-design**: Game design principles. GDD structure, balancing, player psychology, progression. _(risk: unknown)_
- **game-development**: Game development orchestrator. Routes to platform-specific skills based on project needs. _(risk: unknown)_
- **godot-4-migration**: Specialized guide for migrating Godot 3.x projects to Godot 4 (GDScript 2.0), covering syntax changes, Tweens, and exports. _(risk: safe)_
- **godot-gdscript-patterns**: Master Godot 4 GDScript patterns including signals, scenes, state machines, and optimization. Use when building Godot games, implementing game systems, or learning GDScript best practices. _(risk: unknown)_
- **hig-inputs**: Apple HIG guidance for input methods and interaction patterns: gestures, Apple Pencil, keyboards, game controllers, pointers, Digital Crown, eye tracking, focus system, remotes, spatial... _(risk: unknown)_
- **hig-technologies**: Apple HIG guidance for Apple technology integrations: Siri, Apple Pay, HealthKit, HomeKit, ARKit, machine learning, generative AI, iCloud, Sign in with Apple, SharePlay, CarPlay, Game Center,... _(risk: unknown)_
- **makepad-shaders**: CRITICAL: Use for Makepad shader system. Triggers on:
makepad shader, makepad draw_bg, Sdf2d, makepad pixel,
makepad glsl, makepad sdf, draw_quad, makepad gpu,
makepad 着色器, makepad shader 语法, makepad 绘制 _(risk: unknown)_
- **mobile-games**: Mobile game development principles. Touch input, battery, performance, app stores. _(risk: unknown)_
- **multiplayer**: Multiplayer game development principles. Architecture, networking, synchronization. _(risk: unknown)_
- **pc-games**: PC and console game development principles. Engine selection, platform features, optimization strategies. _(risk: unknown)_
- **shader-programming-glsl**: Expert guide for writing efficient GLSL shaders (Vertex/Fragment) for web and game engines, covering syntax, uniforms, and common effects. _(risk: safe)_
- **threejs-materials**: Three.js materials - PBR, basic, phong, shader materials, material properties. Use when styling meshes, working with textures, creating custom shaders, or optimizing material performance. _(risk: unknown)_
- **unity-developer**: Build Unity games with optimized C# scripts, efficient rendering, and proper asset management. Masters Unity 6 LTS, URP/HDRP pipelines, and cross-platform deployment. _(risk: unknown)_
- **unity-ecs-patterns**: Master Unity ECS (Entity Component System) with DOTS, Jobs, and Burst for high-performance game development. Use when building data-oriented games, optimizing performance, or working with large ent... _(risk: unknown)_
- **unreal-engine-cpp-pro**: Expert guide for Unreal Engine 5.x C++ development, covering UObject hygiene, performance patterns, and best practices. _(risk: safe)_
- **vr-ar**: VR/AR development principles. Comfort, interaction, performance requirements. _(risk: unknown)_
- **web-games**: Web browser game development principles. Framework selection, WebGPU, optimization, PWA. _(risk: unknown)_
- **engine-selection**: Selects game engines and frameworks by platform, genre, and architecture (full canvas shell vs hybrid DOM shell + guest viewport). Covers Phaser, PixiJS, Kaplay, Canvas/WebGL, Three.js, Babylon.js, Godot, Unity, Ink, Twine. Use when choosing a stack or comparing runtimes before implementation. _(risk: safe)_
- **unity-ai-game-creator**: Transform raw game ideas into complete Unity projects with AI-powered asset generation, scene blueprints, music/SFX prompts, and step-by-step development procedures using Unity 6+ and modern AI tools. _(risk: safe)_

## general

- **advogado-criminal**: Advogado criminalista especializado em Maria da Penha, violencia domestica, feminicidio, direito penal brasileiro, medidas protetivas, inquerito policial e acao penal. _(risk: safe)_
- **advogado-especialista**: Advogado especialista em todas as areas do Direito brasileiro: familia, criminal, trabalhista, tributario, consumidor, imobiliario, empresarial, civil e constitucional. _(risk: safe)_
- **agentmail**: Email infrastructure for AI agents. Create accounts, send/receive emails, manage webhooks, and check karma balance via the AgentMail API. _(risk: safe)_
- **alpha-vantage**: Access real-time and historical stock market data, forex rates, cryptocurrency prices, commodities, economic indicators, and 50+ technical indicators via the Alpha Vantage API. Use when fetching stock prices (OHLCV), company fundamentals (income statement, balance sheet, cash... _(risk: unknown)_
- **analyze-project**: Forensic root cause analyzer for Antigravity sessions. Classifies scope deltas, rework patterns, root causes, hotspots, and auto-improves prompts/health. _(risk: unknown)_
- **apify-audience-analysis**: Understand audience demographics, preferences, behavior patterns, and engagement quality across Facebook, Instagram, YouTube, and TikTok. _(risk: unknown)_
- **apify-competitor-intelligence**: Analyze competitor strategies, content, pricing, ads, and market positioning across Google Maps, Booking.com, Facebook, Instagram, YouTube, and TikTok. _(risk: unknown)_
- **apify-influencer-discovery**: Find and evaluate influencers for brand partnerships, verify authenticity, and track collaboration performance across Instagram, Facebook, YouTube, and TikTok. _(risk: unknown)_
- **apify-trend-analysis**: Discover and track emerging trends across Google Trends, Instagram, Facebook, YouTube, and TikTok to inform content strategy. _(risk: unknown)_
- **apify-ultimate-scraper**: Universal AI-powered web scraper for any platform. Scrape data from Instagram, Facebook, TikTok, YouTube, Google Maps, Google Search, Google Trends, Booking.com, and TripAdvisor. Use for lead gener... _(risk: unknown)_
- **ask-questions-if-underspecified**: Clarify requirements before implementing. Use when serious doubts arise. _(risk: unknown)_
- **avoid-ai-writing**: Audit and rewrite content to remove 21 categories of AI writing patterns with a 43-entry replacement table
- **bill-gates**: Agente que simula Bill Gates — cofundador da Microsoft, arquiteto da industria de software comercial, estrategista tecnologico global, investidor sistemico e filantropo baseado em dados. Use... _(risk: safe)_
- **build**: build _(risk: unknown)_
- **c-pro**: Write efficient C code with proper memory management, pointer _(risk: unknown)_
- **chat-widget**: Build a real-time support chat system with a floating widget for users and an admin dashboard for support staff. Use when the user wants live chat, customer support chat, real-time messaging, or in-app support. _(risk: unknown)_
- **cirq**: Google quantum computing framework. Use when targeting Google Quantum AI hardware, designing noise-aware circuits, or running quantum characterization experiments. Best for Google hardware, noise modeling, and low-level circuit design. For IBM hardware use qiskit; for quantum... _(risk: unknown)_
- **citation-management**: Comprehensive citation management for academic research. Search Google Scholar and PubMed for papers, extract accurate metadata, validate citations, and generate properly formatted BibTeX entries. This skill should be used when you need to find papers, verify citation... _(risk: unknown)_
- **context-agent**: Agente de contexto para continuidade entre sessoes. Salva resumos, decisoes, tarefas pendentes e carrega briefing automatico na sessao seguinte. _(risk: safe)_
- **context-guardian**: Guardiao de contexto que preserva dados criticos antes da compactacao automatica. Snapshots, verificacao de integridade e zero perda de informacao. _(risk: safe)_
- **context-manager**: Elite AI context engineering specialist mastering dynamic context management, vector databases, knowledge graphs, and intelligent memory systems. _(risk: unknown)_
- **create-issue-gate**: Use when starting a new implementation task and an issue must be created with strict acceptance criteria gating before execution. _(risk: safe)_
- **cred-omega**: CISO operacional enterprise para gestao total de credenciais e segredos. Descobre, classifica, protege e governa TODAS as API keys, tokens, secrets, service accounts e credenciais em qualquer... _(risk: critical)_
- **customer-support**: Elite AI-powered customer support specialist mastering conversational AI, automated ticketing, sentiment analysis, and omnichannel support experiences. _(risk: unknown)_
- **design-spells**: Curated micro-interactions and design details that add "magic" and personality to websites and apps. _(risk: safe)_
- **diary**: Unified Diary System: A context-preserving automated logger for multi-project development. _(risk: safe)_
- **elon-musk**: Agente que simula Elon Musk com profundidade psicologica e comunicacional de alta fidelidade. Ativado para: "fale como Elon", "simule Elon Musk", "o que Elon diria sobre X", "first principles... _(risk: safe)_
- **emergency-card**: 生成紧急情况下快速访问的医疗信息摘要卡片。当用户需要旅行、就诊准备、紧急情况或询问"紧急信息"、"医疗卡片"、"急救信息"时使用此技能。提取关键信息（过敏、用药、急症、植入物），支持多格式输出（JSON、文本、二维码），用于急救或快速就医。 _(risk: unknown)_
- **explain-like-socrates**: Explains concepts using Socratic-style dialogue. Use when the user asks to explain, teach or help understand a concept like socrates.
 _(risk: safe)_
- **family-health-analyzer**: 分析家族病史、评估遗传风险、识别家庭健康模式、提供个性化预防建议 _(risk: unknown)_
- **favicon**: Generate favicons from a source image _(risk: unknown)_
- **fda-food-safety-auditor**: Expert AI auditor for FDA Food Safety (FSMA), HACCP, and PCQI compliance. Reviews food facility records and preventive controls. _(risk: unknown)_
- **fda-medtech-compliance-auditor**: Expert AI auditor for Medical Device (SaMD) compliance, IEC 62304, and 21 CFR Part 820. Reviews DHFs, technical files, and software validation. _(risk: unknown)_
- **filesystem-context**: Use for file-based context management, dynamic context discovery, and reducing context window bloat. Offload context to files for just-in-time loading. _(risk: unknown)_
- **fitness-analyzer**: 分析运动数据、识别运动模式、评估健身进展，并提供个性化训练建议。支持与慢性病数据的关联分析。 _(risk: unknown)_
- **fp-async**: Practical async patterns using TaskEither - clean pipelines instead of try/catch hell, with real API examples _(risk: unknown)_
- **fp-data-transforms**: Everyday data transformations using functional patterns - arrays, objects, grouping, aggregation, and null-safe access _(risk: unknown)_
- **fp-either-ref**: Quick reference for Either type. Use when user needs error handling, validation, or operations that can fail with typed errors. _(risk: unknown)_
- **fp-errors**: Stop throwing everywhere - handle errors as values using Either and TaskEither for cleaner, more predictable code _(risk: unknown)_
- **fp-option-ref**: Quick reference for Option type. Use when user needs to handle nullable values, optional data, or wants to avoid null checks. _(risk: unknown)_
- **fp-pipe-ref**: Quick reference for pipe and flow. Use when user needs to chain functions, compose operations, or build data pipelines in fp-ts. _(risk: unknown)_
- **fp-pragmatic**: A practical, jargon-free guide to functional programming - the 80/20 approach that gets results without the academic overhead _(risk: unknown)_
- **fp-taskeither-ref**: Quick reference for TaskEither. Use when user needs async error handling, API calls, or Promise-based operations that can fail. _(risk: unknown)_
- **fp-types-ref**: Quick reference for fp-ts types. Use when user asks which type to use, needs Option/Either/Task decision help, or wants fp-ts imports. _(risk: unknown)_
- **goal-analyzer**: 分析健康目标数据、识别目标模式、评估目标进度,并提供个性化目标管理建议。支持与营养、运动、睡眠等健康数据的关联分析。 _(risk: unknown)_
- **hosted-agents**: Build background agents in sandboxed environments. Use for hosted coding agents, sandboxed VMs, Modal sandboxes, and remote coding environments. _(risk: unknown)_
- **hugging-face-dataset-viewer**: Use this skill for Hugging Face Dataset Viewer API workflows that fetch subset/split metadata, paginate rows, search text, apply filters, download parquet URLs, and read size or statistics. _(risk: unknown)_
- **hugging-face-tool-builder**: Use this skill when the user wants to build tool/scripts or achieve a task where using data from the Hugging Face API would help. This is especially useful when chaining or combining API calls or the task will be repeated/automated. This Skill creates a reusable script to... _(risk: unknown)_
- **image-studio**: Studio de geracao de imagens inteligente — roteamento automatico entre ai-studio-image (fotos humanizadas/influencer) e stability-ai (arte/ ilustracao/edicao). Detecta o tipo de imagem solicitada... _(risk: safe)_
- **latex-paper-conversion**: This skill should be used when the user asks to convert an academic paper in LaTeX from one format (e.g., Springer, IPOL) to another format (e.g., MDPI, IEEE, Nature). It automates extraction, injection, fixing formatting, and compiling. _(risk: safe)_
- **legal-advisor**: Draft privacy policies, terms of service, disclaimers, and legal notices. Creates GDPR-compliant texts, cookie policies, and data processing agreements. _(risk: unknown)_
- **leiloeiro-avaliacao**: Avaliacao pericial de imoveis em leilao. Valor de mercado, liquidacao forcada, ABNT NBR 14653, metodos comparativo/renda/custo, CUB e margem de seguranca. _(risk: safe)_
- **leiloeiro-edital**: Analise e auditoria de editais de leilao judicial e extrajudicial. Riscos ocultos, clausulas perigosas, debitos, ocupante e classificacao da oportunidade. _(risk: safe)_
- **leiloeiro-ia**: Especialista em leiloes judiciais e extrajudiciais de imoveis. Analise juridica, pericial e de mercado integrada. Orquestra os 5 modulos especializados. _(risk: safe)_
- **leiloeiro-juridico**: Analise juridica de leiloes: nulidades, bem de familia, alienacao fiduciaria, CPC arts 829-903, Lei 9514/97, onus reais, embargos e jurisprudencia. _(risk: safe)_
- **leiloeiro-risco**: Analise de risco em leiloes de imoveis. Score 36 pontos, riscos juridicos/financeiros/operacionais, stress test 4 cenarios e ROI ponderado por risco. _(risk: safe)_
- **logistics-exception-management**: Codified expertise for handling freight exceptions, shipment delays, damages, losses, and carrier disputes. Informed by logistics professionals with 15+ years operational experience. _(risk: safe)_
- **magic-animator**: AI-powered animation tool for creating motion in logos, UI, icons, and social media assets. _(risk: safe)_
- **makepad-animation**: CRITICAL: Use for Makepad animation system. Triggers on:
makepad animation, makepad animator, makepad hover, makepad state,
makepad transition, "from: { all: Forward", makepad pressed,
makepad 动画, makepad 状态, makepad 过渡, makepad 悬停效果 _(risk: unknown)_
- **makepad-basics**: CRITICAL: Use for Makepad getting started and app structure. Triggers on:
makepad, makepad getting started, makepad tutorial, live_design!, app_main!,
makepad project setup, makepad hello world, "how to create makepad app",
makepad 入门, 创建 makepad 应用, makepad 教程, makepad 项目结构 _(risk: unknown)_
- **makepad-event-action**: CRITICAL: Use for Makepad event and action handling. Triggers on:
makepad event, makepad action, Event enum, ActionTrait, handle_event,
MouseDown, KeyDown, TouchUpdate, Hit, FingerDown, post_action,
makepad 事件, makepad action, 事件处理 _(risk: unknown)_
- **makepad-layout**: CRITICAL: Use for Makepad layout system. Triggers on:
makepad layout, makepad width, makepad height, makepad flex,
makepad padding, makepad margin, makepad flow, makepad align,
Fit, Fill, Size, Walk, "how to center in makepad",
makepad 布局, makepad 宽度, makepad 对齐, makepad 居中 _(risk: unknown)_
- **makepad-splash**: CRITICAL: Use for Makepad Splash scripting language. Triggers on:
splash language, makepad script, makepad scripting, script!, cx.eval,
makepad dynamic, makepad AI, splash 语言, makepad 脚本 _(risk: unknown)_
- **matematico-tao**: Matemático ultra-avançado inspirado em Terence Tao. Análise rigorosa de código e arquitetura com teoria matemática profunda: teoria da informação, teoria dos grafos, complexidade computacional,...
- **matplotlib**: Low-level plotting library for full customization. Use when you need fine-grained control over every plot element, creating novel plot types, or integrating with specific scientific workflows. Export to PNG/PDF/SVG for publication. For quick... _(risk: unknown)_
- **mental-health-analyzer**: 分析心理健康数据、识别心理模式、评估心理健康状况、提供个性化心理健康建议。支持与睡眠、运动、营养等其他健康数据的关联分析。 _(risk: unknown)_
- **mermaid-expert**: Create Mermaid diagrams for flowcharts, sequences, ERDs, and architectures. Masters syntax for all diagram types and styling. _(risk: unknown)_
- **minecraft-bukkit-pro**: Master Minecraft server plugin development with Bukkit, Spigot, and Paper APIs. _(risk: unknown)_
- **multi-advisor**: Conselho de especialistas — consulta multiplos agentes do ecossistema em paralelo para analise multi-perspectiva de qualquer topico. Ativa personas, especialistas e agentes tecnicos...
- **nutrition-analyzer**: 分析营养数据、识别营养模式、评估营养状况，并提供个性化营养建议。支持与运动、睡眠、慢性病数据的关联分析。 _(risk: unknown)_
- **occupational-health-analyzer**: 分析职业健康数据、识别工作相关健康风险、评估职业健康状况、提供个性化职业健康建议。支持与睡眠、运动、心理健康等其他健康数据的关联分析。 _(risk: unknown)_
- **odoo-migration-helper**: Step-by-step guide for migrating Odoo custom modules between versions (v14→v15→v16→v17). Covers API changes, deprecated methods, and view migration. _(risk: safe)_
- **odoo-qweb-templates**: Expert in Odoo QWeb templating for PDF reports, email templates, and website pages. Covers t-if, t-foreach, t-field, and report actions. _(risk: safe)_
- **odoo-upgrade-advisor**: Step-by-step Odoo version upgrade advisor: pre-upgrade checklist, community vs enterprise upgrade path, OCA module compatibility, and post-upgrade validation. _(risk: safe)_
- **oral-health-analyzer**: 分析口腔健康数据、识别口腔问题模式、评估口腔健康状况、提供个性化口腔健康建议。支持与营养、慢性病、用药等其他健康数据的关联分析。 _(risk: unknown)_
- **plotly**: Interactive visualization library. Use when you need hover info, zoom, pan, or web-embeddable charts. Best for dashboards, exploratory analysis, and presentations. For static publication figures use matplotlib or scientific-visualization. _(risk: unknown)_
- **pr-writer**: ALWAYS use this skill when creating or updating pull requests — never create or edit a PR directly without it. Follows Sentry conventions for PR titles, descriptions, and issue references. Trigger on any create PR, open PR, submit PR, make PR,... _(risk: unknown)_
- **privacy-by-design**: Use when building apps that collect user data. Ensures privacy protections are built in from the start—data minimization, consent, encryption. _(risk: safe)_
- **rehabilitation-analyzer**: 分析康复训练数据、识别康复模式、评估康复进展，并提供个性化康复建议 _(risk: unknown)_
- **remotion**: Generate walkthrough videos from Stitch projects using Remotion with smooth transitions, zooming, and text overlays _(risk: unknown)_
- **risk-manager**: Monitor portfolio risk, R-multiples, and position limits. Creates hedging strategies, calculates expectancy, and implements stop-losses. _(risk: unknown)_
- **robius-event-action**: CRITICAL: Use for Robius event and action patterns. Triggers on:
custom action, MatchEvent, post_action, cx.widget_action,
handle_actions, DefaultNone, widget action, event handling,
事件处理, 自定义动作 _(risk: unknown)_
- **robius-state-management**: CRITICAL: Use for Robius state management patterns. Triggers on:
AppState, persistence, theme switch, 状态管理,
Scope::with_data, save state, load state, serde,
状态持久化, 主题切换 _(risk: unknown)_
- **robius-widget-patterns**: CRITICAL: Use for Robius widget patterns. Triggers on:
apply_over, TextOrImage, modal, 可复用, 模态,
collapsible, drag drop, reusable widget, widget design,
pageflip, 组件设计, 组件模式 _(risk: unknown)_
- **semgrep-rule-variant-creator**: Creates language variants of existing Semgrep rules. Use when porting a Semgrep rule to specified target languages. Takes an existing rule and target languages as input, produces independent rule+test directories for each language. _(risk: unknown)_
- **sexual-health-analyzer**: Sexual Health Analyzer _(risk: unknown)_
- **skill-installer**: Instala, valida, registra e verifica novas skills no ecossistema. 10 checks de seguranca, copia, registro no orchestrator e verificacao pos-instalacao. _(risk: safe)_
- **skill-router**: Use when the user is unsure which skill to use or where to start. Interviews the user with targeted questions and recommends the best skill(s) from the installed library for their goal. _(risk: safe)_
- **skill-sentinel**: Auditoria e evolucao do ecossistema de skills. Qualidade de codigo, seguranca, custos, gaps, duplicacoes, dependencias e relatorios de saude. _(risk: safe)_
- **skill-writer**: Create and improve agent skills following the Agent Skills specification. Use when asked to create, write, or update skills. _(risk: unknown)_
- **skin-health-analyzer**: Analyze skin health data, identify skin problem patterns, assess skin health status. Supports correlation analysis with nutrition, chronic diseases, and medication data. _(risk: unknown)_
- **sleep-analyzer**: 分析睡眠数据、识别睡眠模式、评估睡眠质量，并提供个性化睡眠改善建议。支持与其他健康数据的关联分析。 _(risk: unknown)_
- **speckit-updater**: SpecKit Safe Update _(risk: unknown)_
- **speed**: Launch RSVP speed reader for text _(risk: unknown)_
- **stability-ai**: Geracao de imagens via Stability AI (SD3.5, Ultra, Core). Text-to-image, img2img, inpainting, upscale, remove-bg, search-replace. 15 estilos artisticos. _(risk: safe)_
- **steve-jobs**: Agente que simula Steve Jobs — cofundador da Apple, CEO da Pixar, fundador da NeXT, o maior designer de produtos tecnologicos da historia e o mais influente apresentador de produtos do mundo. Use... _(risk: safe)_
- **stitch-loop**: Teaches agents to iteratively build websites using Stitch with an autonomous baton-passing loop pattern _(risk: unknown)_
- **task-intelligence**: Protocolo de Inteligência Pré-Tarefa — ativa TODOS os agentes relevantes do ecossistema ANTES de executar qualquer tarefa solicitada pelo usuário. Enriquece o contexto com análise paralela...
- **tcm-constitution-analyzer**: 分析中医体质数据、识别体质类型、评估体质特征,并提供个性化养生建议。支持与营养、运动、睡眠等健康数据的关联分析。 _(risk: unknown)_
- **travel-health-analyzer**: 分析旅行健康数据、评估目的地健康风险、提供疫苗接种建议、生成多语言紧急医疗信息卡片。支持WHO/CDC数据集成的专业级旅行健康风险评估。 _(risk: unknown)_
- **vexor-cli**: Semantic file discovery via `vexor`. Use whenever locating where something is implemented/loaded/defined in a medium or large repo, or when the file location is unclear. Prefer this over manual browsing. _(risk: unknown)_
- **vibe-code-auditor**: Audit rapidly generated or AI-produced code for structural flaws, fragility, and production risks. _(risk: safe)_
- **warren-buffett**: Agente que simula Warren Buffett — o maior investidor do seculo XX e XXI, CEO da Berkshire Hathaway, discipulo de Benjamin Graham e socio intelectual de Charlie Munger. Use quando quiser: analise... _(risk: safe)_
- **weightloss-analyzer**: 分析减肥数据、计算代谢率、追踪能量缺口、管理减肥阶段 _(risk: unknown)_
- **wellally-tech**: Integrate digital health data sources (Apple Health, Fitbit, Oura Ring) and connect to WellAlly.tech knowledge base. Import external health device data, standardize to local format, and recommend relevant WellAlly.tech knowledge base articles based on health data. Support... _(risk: unknown)_
- **yann-lecun-debate**: Sub-skill de debates e posições de Yann LeCun. Cobre críticas técnicas detalhadas aos LLMs, rivalidades intelectuais (LeCun vs Hinton, Sutskever, Russell, Yudkowsky, Bostrom), lista completa de... _(risk: safe)_
- **yann-lecun-tecnico**: Sub-skill técnica de Yann LeCun. Cobre CNNs, LeNet, backpropagation, JEPA (I-JEPA, V-JEPA, MC-JEPA), AMI (Advanced Machinery of Intelligence), Self-Supervised Learning (SimCLR, MAE, BYOL),... _(risk: safe)_
- **antigravity-agent-manager**: Configure and orchestrate parallel agents using the standalone Antigravity 2.0 Agent Manager and Antigravity IDE. _(risk: critical)_

## golang

- **dbos-golang**: DBOS Go SDK for building reliable, fault-tolerant applications with durable workflows. Use this skill when writing Go code with DBOS, creating workflows and steps, using queues, using the DBOS Clie... _(risk: safe)_
- **go-concurrency-patterns**: Master Go concurrency with goroutines, channels, sync primitives, and context. Use when building concurrent Go applications, implementing worker pools, or debugging race conditions. _(risk: unknown)_
- **go-rod-master**: Comprehensive guide for browser automation and web scraping with go-rod (Chrome DevTools Protocol) including stealth anti-bot-detection patterns. _(risk: safe)_
- **golang-pro**: Master Go 1.21+ with modern patterns, advanced concurrency, performance optimization, and production-ready microservices. _(risk: unknown)_
- **temporal-golang-pro**: Use when building durable distributed systems with Temporal Go SDK. Covers deterministic workflow rules, mTLS worker configs, and advanced patterns. _(risk: safe)_

## granular-workflow-bundle

- **ai-agent-development**: AI agent development workflow for building autonomous agents, multi-agent systems, and agent orchestration with CrewAI, LangGraph, and custom agents. _(risk: safe)_
- **api-documentation**: API documentation workflow for generating OpenAPI specs, creating developer guides, and maintaining comprehensive API documentation. _(risk: safe)_
- **api-security-testing**: API security testing workflow for REST and GraphQL APIs covering authentication, authorization, rate limiting, input validation, and security best practices. _(risk: safe)_
- **bash-scripting**: Bash scripting workflow for creating production-ready shell scripts with defensive patterns, error handling, and testing. _(risk: safe)_
- **e2e-testing**: End-to-end testing workflow with Playwright for browser automation, visual regression, cross-browser testing, and CI/CD integration. _(risk: safe)_
- **kubernetes-deployment**: Kubernetes deployment workflow for container orchestration, Helm charts, service mesh, and production-ready K8s configurations. _(risk: safe)_
- **linux-troubleshooting**: Linux system troubleshooting workflow for diagnosing and resolving system issues, performance problems, and service failures. _(risk: safe)_
- **postgresql-optimization**: PostgreSQL database optimization workflow for query tuning, indexing strategies, performance analysis, and production database management. _(risk: safe)_
- **python-fastapi-development**: Python FastAPI backend development with async patterns, SQLAlchemy, Pydantic, authentication, and production API patterns. _(risk: safe)_
- **rag-implementation**: RAG (Retrieval-Augmented Generation) implementation workflow covering embedding selection, vector database setup, chunking strategies, and retrieval optimization. _(risk: safe)_
- **react-nextjs-development**: React and Next.js 14+ application development with App Router, Server Components, TypeScript, Tailwind CSS, and modern frontend patterns. _(risk: safe)_
- **terraform-infrastructure**: Terraform infrastructure as code workflow for provisioning cloud resources, creating reusable modules, and managing infrastructure at scale. _(risk: safe)_
- **web-security-testing**: Web application security testing workflow for OWASP Top 10 vulnerabilities including injection, XSS, authentication flaws, and access control issues. _(risk: safe)_
- **wordpress-plugin-development**: WordPress plugin development workflow covering plugin architecture, hooks, admin interfaces, REST API, and security best practices. _(risk: safe)_
- **wordpress-theme-development**: WordPress theme development workflow covering theme architecture, template hierarchy, custom post types, block editor support, and responsive design. _(risk: safe)_
- **wordpress-woocommerce-development**: WooCommerce store development workflow covering store setup, payment integration, shipping configuration, and customization. _(risk: safe)_

## graphics-processing

- **draw**: Vector graphics and diagram creation, format conversion (ODG/SVG/PDF) with LibreOffice Draw. _(risk: safe)_

## growth

- **indexing-issue-auditor**: High-level technical SEO and site architecture auditor. Invoke to scan local or live environments for indexing, crawl budget, and structural errors. _(risk: safe)_
- **linkedin-profile-optimizer**: High-intent expert for LinkedIn profile checks and SEO optimization. Silently audits and rewrites profiles, delivering only the finished, ready-to-paste result. _(risk: safe)_
- **social-post-writer-seo**: Social Media Strategist and Content Writer. Creates clear, engaging social media posts for Instagram, LinkedIn, and Facebook. _(risk: safe)_

## hr-team

- **hr-pro**: Professional, ethical HR partner for hiring, onboarding/offboarding, PTO and leave, performance, compliant policies, and employee relations. _(risk: unknown)_
- **lightning-factory-explainer**: Explain Bitcoin Lightning channel factories and the SuperScalar protocol — scalable Lightning onboarding using shared UTXOs, Decker-Wattenhofer trees, timeout-signature trees, MuSig2, and Taproot. No soft fork required. _(risk: unknown)_
- **odoo-hr-payroll-setup**: Expert guide for Odoo HR and Payroll: salary structures, payslip rules, leave policies, employee contracts, and payroll journal entries. _(risk: safe)_
- **team-collaboration-standup-notes**: You are an expert team communication specialist focused on async-first standup practices, AI-assisted note generation from commit history, and effective remote team coordination patterns. _(risk: unknown)_
- **team-composition-analysis**: This skill should be used when the user asks to \\\"plan team structure", "determine hiring needs", "design org chart", "calculate compensation", "plan equity allocation", or requests... _(risk: unknown)_

## javascript-typescript

- **animejs-animation**: Advanced JavaScript animation library skill for creating complex, high-performance web animations. _(risk: safe)_
- **dbos-typescript**: DBOS TypeScript SDK for building reliable, fault-tolerant applications with durable workflows. Use this skill when writing TypeScript code with DBOS, creating workflows and steps, using queues, usi... _(risk: safe)_
- **fp-refactor**: Comprehensive guide for refactoring imperative TypeScript code to fp-ts functional patterns _(risk: unknown)_
- **fp-ts-errors**: Handle errors as values using fp-ts Either and TaskEither for cleaner, more predictable TypeScript code. Use when implementing error handling patterns with fp-ts. _(risk: safe)_
- **fp-ts-pragmatic**: A practical, jargon-free guide to fp-ts functional programming - the 80/20 approach that gets results without the academic overhead. Use when writing TypeScript with fp-ts library. _(risk: safe)_
- **javascript-mastery**: Comprehensive JavaScript reference covering 33+ essential concepts every developer should know. From fundamentals like primitives and closures to advanced patterns like async/await and functional p... _(risk: unknown)_
- **modern-javascript-patterns**: Master ES6+ features including async/await, destructuring, spread operators, arrow functions, promises, modules, iterators, generators, and functional programming patterns for writing clean, effici... _(risk: unknown)_
- **n8n-code-javascript**: Write JavaScript code in n8n Code nodes. Use when writing JavaScript in n8n, using $input/$json/$node syntax, making HTTP requests with $helpers, working with dates using DateTime, troubleshooting Code node errors, or choosing between Code node modes. _(risk: unknown)_
- **trigger-dev**: Trigger.dev expert for background jobs, AI workflows, and reliable async execution with excellent developer experience and TypeScript-first design. Use when: trigger.dev, trigger dev, background ta... _(risk: unknown)_
- **typescript-advanced-types**: Master TypeScript's advanced type system including generics, conditional types, mapped types, template literals, and utility types for building type-safe applications. Use when implementing complex... _(risk: unknown)_
- **typescript-pro**: Master TypeScript with advanced types, generics, and strict type safety. Handles complex type systems, decorators, and enterprise-grade patterns. _(risk: unknown)_

## keyword research

- **keyword-clustering-tool**: Keyword Clustering Tool. Use when working with keyword list. _(risk: safe)_
- **keyword-comparison-tool**: Keyword Comparison Tool. Use when working with two or more keywords and optional metrics. _(risk: safe)_
- **keyword-density-checker**: Keyword Density Checker. Use when working with text and target word or phrase. _(risk: safe)_
- **keyword-difficulty-estimator**: Keyword Difficulty Estimator. Use when working with keyword plus supplied SERP or competitor evidence. _(risk: safe)_
- **keyword-expansion-tool**: Keyword Expansion Tool. Use when working with seed terms and optional industry. _(risk: safe)_
- **keyword-gap-finder**: Keyword Gap Finder. Use when working with your keyword set and competitor keyword sets. _(risk: safe)_
- **keyword-intent-identifier**: Keyword Intent Identifier. Use when working with keyword or query list. _(risk: safe)_
- **keyword-suggestion-tool**: Keyword Suggestion Tool. Use when working with seed topic. _(risk: safe)_
- **long-tail-keyword-generator**: Long-Tail Keyword Generator. Use when working with seed topic and optional audience or use case. _(risk: safe)_
- **trending-keyword-visualizer**: Trending Keyword Visualizer. Use when working with dated keyword interest or volume series with source. _(risk: safe)_

## knowledge-management

- **maintain-codex-wiki**: Maintain a review-first engineering wiki with provenance, citation-aware queries, explicit capture and promotion, and deterministic checks. _(risk: critical)_
- **wiki-builder**: Create and maintain reusable research wikis with source provenance, configurable structure, and local markdown outputs. _(risk: safe)_

## learning

- **onboard**: Decompose mixed project materials (code, docs, PDF/Excel/PPT) into a sourced overview and a goal-driven three-tier learning path, then teach it interactively. _(risk: safe)_

## legal

- **event-staffing-compliance**: Assess worker-classification and compliance risk for temporary event staffing in the US and Canada — W-2 vs 1099, misclassification penalties, joint-employer liability, COI, and wage/hour rules. Includes live state-by-state lookups via MCP. _(risk: safe)_

## lifestyle

- **party-planning**: Estimate party food and drink quantities, select games, and draft hosting timelines using HostPartyPlay's published planning heuristics. _(risk: safe)_

## local seo

- **geo-keyword-expansion-tool**: Geo Keyword Expansion Tool. Use when working with seed keyword and target locations. _(risk: safe)_
- **gmb-optimization-helper**: GMB Optimization Helper. Use when working with Google Business Profile details or business facts. _(risk: safe)_
- **local-citation-finder**: Local Citation Finder. Use when working with business category and service location. _(risk: safe)_
- **local-keyword-generator**: Local Keyword Generator. Use when working with service or product and actual target location. _(risk: safe)_
- **local-seo-audit-checklist**: Local SEO Audit Checklist. Use when working with business type, location and profile or site details. _(risk: safe)_
- **location-based-content-idea-generator**: Local Content Idea Generator. Use when working with location, audience and business topic. _(risk: safe)_
- **nap-consistency-checker**: NAP Consistency Checker. Use when working with canonical business name, address and phone plus listing records. _(risk: safe)_
- **review-response-generator**: Review Response Generator. Use when working with review text and verified business context. _(risk: safe)_

## marketing

- **content-creator**: Create SEO-optimized marketing content with consistent brand voice. Includes brand voice analyzer, SEO optimizer, content frameworks, and social media templates. Use when writing blog posts, creati... _(risk: unknown)_
- **ad-campaign-analyzer**: Analyze cross-channel campaign data, quantify uncertainty, and propose evidence-labeled budget tests without overstating causality. _(risk: critical)_
- **ad-creative**: Create, iterate, and scale paid ad creative for Google Ads, Meta, LinkedIn, TikTok, and similar platforms. Use when generating headlines, descriptions, primary text, or large sets of ad variations for testing and performance optimization. _(risk: critical)_
- **alternatives-pages**: Create "[Competitor] alternative" and comparison pages for developer tools. Build honest, high-converting comparison content that ranks for competitive search terms. _(risk: critical)_
- **awareness-stage-mapper**: Map audience awareness stages to messaging strategy when planning a campaign, offer, or persuasion sequence. _(risk: safe)_
- **brand-perception-psychologist**: Audit visual, verbal, and behavioral brand signals and propose alignment changes when market perception differs from the intended position. _(risk: safe)_
- **churn-prevention**: Reduce voluntary and involuntary churn with cancel flows, save offers, dunning, win-back tactics, and retention strategy. Use when users are cancelling, failed payments are rising, or subscription retention needs improvement. _(risk: critical)_
- **co-marketing**: When the user wants to find co-marketing partners, plan joint campaigns, or brainstorm partnership opportunities. _(risk: safe)_
- **cold-email**: Write B2B cold emails and follow-up sequences that earn replies. Use when creating outbound prospecting emails, SDR outreach, personalized opening lines, subject lines, CTAs, and multi-touch follow-up sequences. _(risk: safe)_
- **comment-to-dm-cta**: Plan the "Comment KEYWORD" CTA of an Instagram Reel (keyword, overlay, caption, DM copy), then, after explicit user confirmation, set up the matching auto-DM in CommentKeyword. _(risk: critical)_
- **community-building**: When the user wants to build, grow, or improve a developer community on Discord, Slack, or forums. _(risk: critical)_
- **competitor-ad-intelligence**: Research public competitor ads, analyze creative patterns and landing pages, and produce an evidence-labeled strategic teardown. _(risk: critical)_
- **competitor-analysis**: Research competitors with Browserbase discovery, enrichment lanes, screenshots, matrices, and HTML reports. _(risk: critical)_
- **competitor-profiling**: When the user wants to research, profile, or analyze competitors from their URLs. _(risk: critical)_
- **competitor-tracking**: Systematic competitor analysis for developer tools. Track features, pricing, positioning, content strategy, and community sentiment for direct and indirect competitors. _(risk: critical)_
- **content-strategy**: Plan a content strategy, topic clusters, editorial roadmap, and content mix for traffic, authority, and lead generation. Use when deciding what to publish, what topics to prioritize, or how to structure a content program. _(risk: critical)_
- **cro**: When the user wants to optimize, improve, or increase conversions on any marketing page or form — including homepage, landing pages, pricing pages, feature pages, lead capture forms, or contact forms. _(risk: safe)_
- **customer-psychographic-profiler**: Build an evidence-grounded customer profile of motivations, fears, identity, and trust barriers before positioning, copywriting, or funnel design. _(risk: safe)_
- **customer-research**: When the user wants to conduct, analyze, or synthesize customer research. _(risk: critical)_
- **define-my-content-pillars**: Find the three to five subjects someone can post about repeatedly, from what they have published and know first-hand. Use when someone asks what to post about or has run out of ideas. _(risk: safe)_
- **developer-advocacy**: When the user wants to do developer advocacy activities including conference talks, live coding, podcasts, and building in public. _(risk: critical)_
- **developer-audience-context**: When the user wants to establish or update their developer audience context. Also use when starting any other developer marketing skill to ensure foundational context is loaded. _(risk: critical)_
- **developer-churn**: When the user wants to understand, reduce, or recover from developer churn. Trigger phrases include "why developers leave," "churn rate," "win-back campaign," "at-risk users," "developer retention," "preventing churn," or "competitor switching." _(risk: critical)_
- **developer-listening**: Monitor what developers say about your brand, competitors, and the problems they're solving. Track mentions and conversations across GitHub, Hacker News, Reddit, Stack Overflow, Twitter, and Discord. _(risk: critical)_
- **developer-newsletter**: When the user wants to create, write, or improve a newsletter for developer audiences. Trigger phrases include "newsletter," "email marketing," "developer email," "weekly digest," "dev newsletter," "email subscribers," "newsletter growth," or "email list." _(risk: critical)_
- **developer-sandbox**: Design and build interactive playgrounds that let developers experience your product without commitment. This skill covers playground architecture, pre-populated examples, embedding strategies, gating decisions, and converting playground users to signups. _(risk: critical)_
- **developer-signup-flow**: Design frictionless signup experiences for developers including GitHub OAuth, API key generation, and onboarding personalization. _(risk: critical)_
- **docs-as-marketing**: Transform documentation into a powerful marketing channel that attracts, converts, and retains developers. _(risk: critical)_
- **draft-my-comments**: Write a LinkedIn comment that adds something the post did not have, not agreement. Use when someone asks what to comment, wants to engage with creators, or says their comments go nowhere. _(risk: safe)_
- **email-marketing-bible**: Data-backed email marketing for AI agents: automation flows, deliverability triage, copy de-slopping, AI email design, ESP control via MCP with send gates and compliance. _(risk: critical)_
- **free-tier-strategy**: Design free tiers that convert to paid without creating resentment or abuse. Trigger phrases: free tier design, freemium model, free trial strategy, free tier limits, developer free plan, open source commercial, feature gating, upgrade triggers, free tier conversion
- **get-seen-in-replies**: Write a reply to someone else's tweet that is worth reading on its own. Use when someone asks what to reply, wants to grow by replying on Twitter/X, or says their replies go nowhere. _(risk: safe)_
- **headline-psychologist**: Draft and compare audience-aware headlines when copy needs clearer relevance and curiosity without clickbait or unsupported promises. _(risk: safe)_
- **identity-mirror**: Map an audience's current and aspirational identity into credible messaging when copy needs stronger personal relevance. _(risk: safe)_
- **jobs-to-be-done-analyst**: Uncover the functional, emotional and social jobs a customer hires a product to do: progress state, hiring trigger, alternatives, success criteria, JTBD map. Use when you need to understand why users buy, switch or churn, or to anchor positioning, messaging and onboarding in real jobs. _(risk: safe)_
- **lead-magnets**: Plan and optimize lead magnets for email capture and lead generation. Use when designing gated content, checklists, templates, downloadable resources, or other offers that convert visitors into subscribers. _(risk: safe)_
- **linkedin-content-generator**: AI-powered LinkedIn content suite: generate posts, carousels, newsletters, and 30-day calendars with niche-specific SEO rules and a feedback-based personal memory system. _(risk: critical)_
- **linkedin-post-writer**: Draft LinkedIn posts from 16 illustrative hook formulas mapped to engagement goals (comments, reposts, likes, saves), with optional formatting conventions and an AI-tell scrub pass before publishing.
- **mailtrap-managing-contacts**: Manage Mailtrap contacts, lists, segments, custom fields, imports, CRM syncs, and campaign audiences through the UI or API. _(risk: critical)_
- **marketing-mindset**: Use when a user asks how to win first customers, whether doing X will produce Y, how to write an ad or judge a marketing test — a marketer's decision framework, not a tactic library. _(risk: safe)_
- **marketing-plan**: When the user needs a comprehensive marketing plan for a client, a company they advise, or their own product. _(risk: critical)_
- **objection-preemptor**: Map customer objections and address them with evidence and choice-preserving language when a funnel, sales page, or pitch encounters recurring hesitation. _(risk: safe)_
- **offers**: When the user wants to design, construct, or improve an offer — the thing they actually sell — including value framing, bonus stacking, guarantee design, scarcity/urgency, naming, and payment structure. _(risk: safe)_
- **omentir-linkedin-outreach**: Run LinkedIn prospecting and outreach through the Omentir MCP server: find people, score fit, draft messages, and check campaigns. Never signs into LinkedIn. _(risk: critical)_
- **onboarding**: When the user wants to optimize post-signup onboarding, user activation, first-run experience, or time-to-value. _(risk: safe)_
- **onboarding-psychologist**: Design first-use and onboarding experiences that bring an early win, cut setup friction, build ownership and form habits through stable cues. Use when onboarding loses users early, time-to-value is long, or the first session should build confidence, momentum and a lasting habit. _(risk: safe)_
- **open-source-marketing**: When the user wants to market an open source project authentically. Trigger phrases include "open source marketing," "OSS marketing," "GitHub marketing," "promote my library," "grow stars," "launch open source," "open source growth," or "contributor marketing." _(risk: critical)_
- **outreachagent**: Operate reply-aware cold outbound email workflows for AI agents with inboxes, contacts, templates, pacing, approvals, webhooks, and delivery metrics. _(risk: critical)_
- **pitch-psychologist**: Structure pitches, decks, and talk tracks around audience beliefs, proof, and a clear decision when presentations need stronger progression. _(risk: safe)_
- **post**: Make share-post image sets that look native: Xiaohongshu carousels, X images, covers, App Store poster layouts, real screenshots and faithful app-UI mocks. Use for 图文, 配图, 组图, 封面, 分享帖. _(risk: safe)_
- **postel-writing**: Draft X (Twitter) or LinkedIn posts in the user's own voice, research high-performing posts, and schedule or publish them through the user's Postel account. _(risk: critical)_
- **power-user-cultivation**: When the user wants to identify and nurture developer advocates, build champion programs, or turn active users into contributors and evangelists. _(risk: safe)_
- **price-psychology-strategist**: Design pricing presentation, anchors, and tiers when an offer needs clearer value and fairness without misleading comparisons. _(risk: safe)_
- **pricing**: When the user wants help with pricing decisions, packaging, or monetization strategy. _(risk: safe)_
- **public-relations**: When the user wants help with public relations, earned media, press coverage, journalist outreach, or media strategy (not pull requests). _(risk: critical)_
- **repurpose-into-a-post**: Turn an article, newsletter, transcript or video into a Twitter/X or LinkedIn post that stands on its own. Use when someone wants to repurpose, share or promote content they already made. _(risk: critical)_
- **same-idea-both-platforms**: Write one idea as a Twitter/X post and a LinkedIn post that read as written separately, not pasted twice. Use when someone wants to cross-post or adapt a post for the other platform. _(risk: critical)_
- **scarcity-urgency-psychologist**: Design honest scarcity and urgency messaging when verified inventory, capacity, or deadlines justify a timely decision. _(risk: safe)_
- **seo-drift**: Snapshot a site's SEO state and detect ranking, indexation, metadata, canonical, robots, schema, and on-page regressions over time. _(risk: safe)_
- **sequence-psychologist**: Plan email nurture and multi-touch communication sequences when each message should build trust and prepare the next decision. _(risk: safe)_
- **social-proof-architect**: Select and place genuine testimonials, case studies, and other proof when an audience needs evidence at specific trust barriers. _(risk: safe)_
- **socialclaw**: Agent-first social media publishing skill — schedule and publish posts across the listed platforms (X, LinkedIn, Instagram, Facebook Pages, TikTok, Discord, Telegram, YouTube, Reddit, WordPress, Pinterest) via a single workspace API key. _(risk: critical)_
- **subject-line-psychologist**: Draft email subject lines and notification copy matched to audience and sequence position when earning attention requires clarity and truthful curiosity. _(risk: safe)_
- **taisly-social-media-posting**: Use Taisly Agent Kit to prepare and publish approved short-form video posts across TikTok, Instagram Reels, YouTube Shorts, X, and Facebook. _(risk: critical)_
- **talivia-agent-kit**: Set up and verify Talivia revenue analytics through MCP, with explicit confirmation for website changes and payment attribution. _(risk: critical)_
- **telegram-channel-ads**: Vet and price ad posts in Telegram channels: reach benchmarks by size, topic and language, ad-network and channel-age checks, CPM and deletion-window math. _(risk: safe)_
- **trust-calibrator**: Diagnose audience trust barriers and calibrate proof, certainty, and credibility signals when messaging overclaims or fails to reassure. _(risk: safe)_
- **turn-this-into-a-thread**: Turn a long idea, transcript, article or draft into a Twitter/X thread where every tweet stands alone. Use when someone asks for a thread or to break long writing into tweets. _(risk: critical)_
- **wechat-official-account-strategist**: Grow WeChat Official Accounts (微信公众号) with high-conversion content strategy, title formulas, article architecture, and Mini-Program integration. _(risk: safe)_
- **why-did-this-post-flop**: Diagnose why one Twitter/X or LinkedIn post underperformed: not seen, seen and skipped, or read and ignored. Use when someone asks why a post did badly or got no engagement. _(risk: safe)_
- **write-in-my-voice**: Draft a Twitter/X or LinkedIn post that sounds like the person asking, from posts they already wrote. Use when someone asks for a post or rewrite in their voice, or asks if text sounds like them. _(risk: critical)_
- **xiaohongshu-content-strategist**: Create viral Xiaohongshu (小红书) content with platform-native strategy, save-rate optimization, trending formats, and search SEO for China's #1 lifestyle platform. _(risk: safe)_
- **zhongcao-note-copywriter**: Install and use the official Xiaohongshu Copywriter package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_

## marketing-growth

- **activecampaign-automation**: Automate ActiveCampaign tasks via Rube MCP (Composio): manage contacts, tags, list subscriptions, automation enrollment, and tasks. Always search tools first for current schemas. _(risk: unknown)_
- **close-automation**: Automate Close CRM tasks via Rube MCP (Composio): create leads, manage calls/SMS, handle tasks, and track notes. Always search tools first for current schemas. _(risk: unknown)_
- **competitor-alternatives**: When the user wants to create competitor comparison or alternative pages for SEO and sales enablement. Also use when the user mentions 'alternative page,' 'vs page,' 'competitor comparison,' 'compa... _(risk: unknown)_
- **content-marketer**: Elite content marketing strategist specializing in AI-powered content creation, omnichannel distribution, SEO optimization, and data-driven performance marketing. _(risk: unknown)_
- **email-systems**: Email has the highest ROI of any marketing channel. $36 for every $1 spent. Yet most startups treat it as an afterthought - bulk blasts, no personalization, landing in spam folders. This skill cov... _(risk: unknown)_
- **form-cro**: Optimize any form that is NOT signup or account registration — including lead capture, contact, demo request, application, survey, quote, and checkout forms. _(risk: unknown)_
- **free-tool-strategy**: When the user wants to plan, evaluate, or build a free tool for marketing purposes — lead generation, SEO value, or brand awareness. Also use when the user mentions "engineering as mar... _(risk: unknown)_
- **hubspot-automation**: Automate HubSpot CRM operations (contacts, companies, deals, tickets, properties) via Rube MCP using Composio integration. _(risk: unknown)_
- **keyword-extractor**: Extracts up to 50 highly relevant SEO keywords from text. Use when user wants to generate or extract keywords for given text.
 _(risk: safe)_
- **local-legal-seo-audit**: Audit and improve local SEO for law firms, attorneys, forensic experts and legal/professional services sites with local presence, focusing on GBP, directories, E-E-A-T and practice/location pages. _(risk: safe)_
- **odoo-ecommerce-configurator**: Expert guide for Odoo eCommerce and Website: product catalog, payment providers, shipping methods, SEO, and order-to-fulfillment workflow. _(risk: safe)_
- **onboarding-cro**: When the user wants to optimize post-signup onboarding, user activation, first-run experience, or time-to-value. Also use when the user mentions "onboarding flow," "activation rate," "u... _(risk: unknown)_
- **page-cro**: Analyze and optimize individual pages for conversion performance. _(risk: unknown)_
- **paid-ads**: When the user wants help with paid advertising campaigns on Google Ads, Meta (Facebook/Instagram), LinkedIn, Twitter/X, or other ad platforms. Also use when the user mentions 'PPC,' 'paid media,' '... _(risk: unknown)_
- **paywall-upgrade-cro**: When the user wants to create or optimize in-app paywalls, upgrade screens, upsell modals, or feature gates. Also use when the user mentions "paywall," "upgrade screen," "upgrade modal,... _(risk: unknown)_
- **popup-cro**: Create and optimize popups, modals, overlays, slide-ins, and banners to increase conversions without harming user experience or brand trust. _(risk: unknown)_
- **programmatic-seo**: Design and evaluate programmatic SEO strategies for creating SEO-driven pages at scale using templates and structured data. _(risk: unknown)_
- **sales-automator**: Draft cold emails, follow-ups, and proposal templates. Creates
pricing pages, case studies, and sales scripts. Use PROACTIVELY for sales
outreach or lead nurturing.
 _(risk: unknown)_
- **salesforce-automation**: Automate Salesforce tasks via Rube MCP (Composio): leads, contacts, accounts, opportunities, SOQL queries. Always search tools first for current schemas. _(risk: unknown)_
- **salesforce-development**: Expert patterns for Salesforce platform development including Lightning Web Components (LWC), Apex triggers and classes, REST/Bulk APIs, Connected Apps, and Salesforce DX with scratch orgs and 2nd ... _(risk: unknown)_
- **schema-markup**: Design, validate, and optimize schema.org structured data for eligibility, correctness, and measurable SEO impact. _(risk: unknown)_
- **seo-audit**: Diagnose and audit SEO issues affecting crawlability, indexation, rankings, and organic performance. _(risk: unknown)_
- **seo-authority-builder**: Analyzes content for E-E-A-T signals and suggests improvements to
build authority and trust. Identifies missing credibility elements. Use
PROACTIVELY for YMYL topics.
 _(risk: unknown)_
- **seo-cannibalization-detector**: Analyzes multiple provided pages to identify keyword overlap and potential cannibalization issues. Suggests differentiation strategies. Use PROACTIVELY when reviewing similar content. _(risk: unknown)_
- **seo-content-auditor**: Analyzes provided content for quality, E-E-A-T signals, and SEO best practices. Scores content and provides improvement recommendations based on established guidelines. _(risk: unknown)_
- **seo-content-planner**: Creates comprehensive content outlines and topic clusters for SEO.
Plans content calendars and identifies topic gaps. Use PROACTIVELY for content
strategy and planning.
 _(risk: unknown)_
- **seo-content-refresher**: Identifies outdated elements in provided content and suggests updates to maintain freshness. Finds statistics, dates, and examples that need updating. Use PROACTIVELY for older content. _(risk: unknown)_
- **seo-content-writer**: Writes SEO-optimized content based on provided keywords and topic briefs. Creates engaging, comprehensive content following best practices. Use PROACTIVELY for content creation tasks. _(risk: unknown)_
- **seo-keyword-strategist**: Analyzes keyword usage in provided content, calculates density, suggests semantic variations and LSI keywords based on the topic. Prevents over-optimization. Use PROACTIVELY for content optimization. _(risk: unknown)_
- **seo-meta-optimizer**: Creates optimized meta titles, descriptions, and URL suggestions based on character limits and best practices. Generates compelling, keyword-rich metadata. Use PROACTIVELY for new content. _(risk: unknown)_
- **seo-snippet-hunter**: Formats content to be eligible for featured snippets and SERP features. Creates snippet-optimized content blocks based on best practices. Use PROACTIVELY for question-based content. _(risk: unknown)_
- **signup-flow-cro**: When the user wants to optimize signup, registration, account creation, or trial activation flows. Also use when the user mentions "signup conversions," "registration friction," "signup... _(risk: unknown)_
- **x-article-publisher-skill**: Publish articles to X/Twitter _(risk: safe)_
- **zoho-crm-automation**: Automate Zoho CRM tasks via Rube MCP (Composio): create/update records, search contacts, manage leads, and convert leads. Always search tools first for current schemas. _(risk: unknown)_

## mcp

- **ai-dev-jobs-mcp**: Search indexed AI and ML jobs, inspect listings and employers, match roles, and view salary and market stats via AI Dev Jobs MCP _(risk: safe)_
- **cowork-to-code-bridge**: Use an already-installed, independently verified cowork-to-code bridge to run narrowly approved actions on the user's own macOS, Linux, or WSL2 machine through a local file queue. _(risk: critical)_
- **keenable-search-mcp**: Search the public web with site and date filters, and read pages with an extraction prompt, through Keenable's keyless MCP server. Use when the user chooses Keenable or its connected tools. _(risk: safe)_
- **mercury-mcp**: Cheatsheet for the Mercury (proton) MCP tools. Use when connected to the Mercury MCP server to look up which mercury_* tool to call for messaging teammates, threads, tasks, automations, or admin team-graph edits. _(risk: critical)_
- **not-human-search-mcp**: Search AI-ready websites, inspect indexed site details, verify MCP endpoints, and discover tools and APIs using the Not Human Search MCP server _(risk: safe)_
- **parallel-search-mcp**: Search the public web and verify sources with Parallel's free Search MCP. Use when the user chooses Parallel or its connected tools for current information and URL extraction. _(risk: safe)_
- **protect-mcp-governance**: Agent governance skill for MCP tool calls — Cedar policy authoring, shadow-to-enforce rollout, and Ed25519 receipt verification. _(risk: critical)_
- **restosignals**: Find US restaurants and bars before they open, as scored leads fused from liquor-license, food-permit and business-filing records, via the RestoSignals MCP server or REST API. _(risk: safe)_
- **serply-search-mcp**: Search Google, Bing, Google News and Google Scholar, and read public pages, with the Serply MCP server. Use when the user chooses Serply or its connected tools for current information and source verification. _(risk: safe)_

## media

- **fal-audio**: Text-to-speech and speech-to-text using fal.ai audio models _(risk: safe)_
- **fal-generate**: Generate images and videos using fal.ai AI models _(risk: safe)_
- **fal-image-edit**: AI-powered image editing with style transfer and object removal _(risk: safe)_
- **fal-upscale**: Upscale and enhance image and video resolution using AI _(risk: safe)_
- **fal-workflow**: Generate workflow JSON files for chaining AI models _(risk: safe)_
- **videodb**: Video and audio perception, indexing, and editing. Ingest files/URLs/live streams, build visual/spoken indexes, search with timestamps, edit timelines, add overlays/subtitles, generate media, and create real-time alerts. _(risk: safe)_
- **videodb-skills**: Upload, stream, search, edit, transcribe, and generate AI video and audio using the VideoDB SDK. _(risk: safe)_
- **ai-audiobook-narration**: Install and use the official AI Audiobook Generator package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **ai-headshot-studio**: Install and use the official AI Headshot Generator package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **ai-image-generation-studio**: Install and use the official AI Image Generator package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **ai-image-realism**: Install and use the official AI Image Realism package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **ai-logo-maker**: Install and use the official AI Logo Maker package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **ai-multilingual-dubbing**: Install and use the official Multilingual Voiceover package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **ai-photo-restyler**: Install and use the official Photo to Anime package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **ai-podcast-voiceover**: Install and use the official AI Podcast Voiceover package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **ai-storyboard-generator**: Install and use the official AI Storyboard Generator package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **atlas-cloud-media**: Generate Atlas Cloud images and videos through its asynchronous media API with schema-first model selection and credential-safe polling. _(risk: critical)_
- **beatra**: Install and use the official AI Media Generator package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **beatra-ai-video-studio**: Install and use the official Beatra AI Video Studio package, pinned by digest, for paid text-to-video, image-to-video, and video edit or extend jobs on the hosted Beatra service. _(risk: critical)_
- **ecommerce-listing-image-set**: Install and use the official Ecommerce Product Images package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **film-crew**: Turn a one-line AI video idea into a shot list and per-shot, model-ready prompts via a film crew (director, DP, gaffer, editor, script supervisor). Also fixes failing video prompts and diagnoses bad clips before a reroll. Works with Wan, LTX, Kling, Veo, Seedance, Hailuo, Runway. _(risk: safe)_
- **gemini-omni-flash-api**: Use this skill for generative video editing, text-to-video, image-referenced video generation, and first-frame-to-video transition animations using the official google-genai SDK. _(risk: critical)_
- **generate-nanobanana**: Generate and edit images/video with Google's Gemini media models (Nano Banana 2/Pro, Gemini Omni Flash), with cost-approval gates, reference-image support, and a prompt/output log per call. _(risk: critical)_
- **image-generator**: Generate and edit images using Gemini's Nano Banana Pro model (gemini-3-pro-image-preview). Use this skill when the user asks you to generate images, create visuals, edit photos, create logos, generate product mockups, or perform any image generation/editing task. _(risk: critical)_
- **ingest-youtube**: Pull a YouTube video transcript into a queryable markdown vault with yt-dlp subtitle discovery, VTT cleanup, metadata frontmatter, and capture-seed stubs. _(risk: critical)_
- **lanshu-create-ai-presenter-video**: Turn a topic or script into a publish-ready explainer video, led by an AI presenter or performed in one of twelve styled explainer looks. _(risk: critical)_
- **macos-screen-recorder**: macOS screen recorder that captures the main display PLUS system audio via ScreenCaptureKit — no BlackHole/loopback driver, no sudo, just the standard Screen Recording permission. CLI-driven; fills the headless-screen-recording-with-system-sound gap QuickTime and `screencapture -v` can't. _(risk: critical)_
- **md2video-audio**: Convert Markdown documents into narrated MP4 videos with synchronized visuals and voice narration. _(risk: critical)_
- **muapi-media**: Generate images and videos with MuAPI's schema-driven asynchronous media API while protecting keys, polling, and output downloads. _(risk: critical)_
- **music-generation-studio**: Install and use the official AI Music Generator package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **nsfw-ai-spicyapi**: Generate adult (18+) images, image-to-video clips and image edits through the SpicyAPI API, with a cost quote before every paid run and adults-only / consent rules. _(risk: critical)_
- **poster-design-studio**: Install and use the official AI Poster Maker package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **pro-motion**: Make a motion-graphics launch, brand or promo film audio first: plan the music, then render the film in code (canvas to MP4) cut to the track. Use for 发布视频, 宣传片, TVC, BGM, Suno prompts. _(risk: safe)_
- **product-photo-studio**: Install and use the official AI Product Photography package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **remotion-captions**: Transcribing, displaying and animating captions _(risk: critical)_
- **remotion-create**: Create a new Remotion video _(risk: critical)_
- **remotion-docs**: Search Remotion documentation _(risk: unknown)_
- **remotion-interactivity**: Structure Remotion markup for interactivity _(risk: unknown)_
- **remotion-render**: Export a Remotion video _(risk: unknown)_
- **screenstudio-alt**: Open-source headless Screen Studio alternative: auto speed-up of idle, auto-zoom on click clusters, keystroke overlay chips, smoothed synthetic cursor, and 9:16 vertical export that follows the action — post-production for screen recordings from the CLI. _(risk: critical)_
- **soundza**: Find, audition and add free sound effects, ambience or music to a game, video or app with Soundza, or generate a new sound effect from a prompt, over MCP or a REST API. _(risk: safe)_
- **suno-lyrics-to-song**: Install and use the official Lyrics to Song package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **talking-avatar-video**: Install and use the official Talking Avatar Video package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **video-router**: Route a video-production brief to generation, deterministic composition, supplied-footage editing, or an automatic cross-modal plan before production begins.
- **viral-video-teardown-remake**: Install and use the official Viral Video Remake package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **voice-cloning-studio**: Install and use the official AI Voice Cloning package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **voiceover-narration-studio**: Install and use the official AI Voiceover Generator package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **watch-igaming**: Reviews a video link or local screen recording from transcript and scene-change frames matched by timecode, then returns a review, QA table, UX audit, comparison or minutes. _(risk: safe)_
- **web-media-getter**: One query across free image / video / GIF APIs (stock + historical/archival + GIF engines), returning normalized, license-tagged results with optional top-K download + attribution sidecar. The retrieval peer to local semantic search and generative media. _(risk: safe)_
- **wechat-cover-maker**: Install and use the official WeChat Article Cover package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_
- **zhongcao-cover-maker**: Install and use the official Xiaohongshu Cover Maker package, pinned by digest, for paid hosted work on the Beatra service. _(risk: critical)_

## media-processing

- **video-content-extractor**: Extract key frames from MP4 videos at configurable intervals, run Tesseract OCR, and generate structured Markdown reports with video metadata and timestamped text transcripts. _(risk: safe)_

## memory

- **recallmax**: FREE — God-tier long-context memory for AI agents. Injects 500K-1M clean tokens, auto-summarizes with tone/intent preservation, compresses 14-turn history into 800 tokens. _(risk: safe)_
- **agent-memory-discipline**: Rules for when an agent should recall from long-term memory before acting and when it should save decisions, corrections and failures afterwards. Works with any memory backend. _(risk: critical)_
- **memory-handoff**: Portable session handoff across agent CLIs: read a project's handoff file at session start, rewrite it at session end, so the next session starts mid-thought instead of cold. _(risk: critical)_

## meta

- **anti-deception**: Use before responding to pressure for agreement, manufactured urgency, authority appeals, or requests to certify unsupported claims; separate evidence from persuasion and state uncertainty. _(risk: critical)_
- **anti-sycophancy**: Eliminate sycophantic agreement patterns in AI responses. Load via /skill anti-sycophancy. _(risk: safe)_
- **faf-context**: Get your project to 100% ✪ AI-readiness, fast — the AI auto-detects your stack and only asks for what it can't know (your goal and the human "why"). Least typing, maximum context. For time-conscious builders; feeds into faf-expert for depth. _(risk: critical)_
- **skill-issue**: Find out why a coding-agent skill won't fire — grade each SKILL.md A–F on activation, simulate which skill a prompt triggers, and flag collisions where one silently shadows another. _(risk: safe)_
- **skill-optimizer**: Diagnose and optimize Agent Skills (SKILL.md) with real session data and research-backed static analysis. Works with Claude Code, Codex, and any Agent Skills-compatible agent. _(risk: safe)_
- **skill-skill**: Write, upgrade or audit a Claude skill so it changes what gets generated: forcing functions, triggerable descriptions, and a static audit script with a 0-100 health score. Use for 写 skill, 改 skill. _(risk: safe)_
- **skill-suggester**: Scan prompt history for recurring patterns and unmet needs, then propose new skills or command templates _(risk: safe)_
- **the-honoured-one**: Forces the AI to fully load context and read relevant files before performing complex, multi-file tasks, architectural changes, or debugging. Prevents acting on assumptions. _(risk: safe)_
- **using-agent-skills**: Meta-skill for discovering and invoking the right agent skill for the work at hand, applied at session start. _(risk: safe)_
- **wgm**: Turns a rough request into working software via a governed build loop: align first, plan, then iterate one task at a time with deterministic backpressure and holdout-scenario judging. _(risk: safe)_

## meta-skills

- **agentfolio**: Skill for discovering and researching autonomous AI agents, tools, and ecosystems using the AgentFolio directory. _(risk: unknown)_
- **cc-skill-project-guidelines-example**: Project Guidelines Skill (Example) _(risk: unknown)_
- **skill-creator**: This skill should be used when the user asks to create a new skill, build a skill, make a custom skill, develop a CLI skill, or wants to extend the CLI with new capabilities. Automates the entire s... _(risk: safe)_
- **using-superpowers**: Use when starting any conversation - establishes how to find and use skills, requiring Skill tool invocation before ANY response including clarifying questions _(risk: unknown)_
- **writing-skills**: Use when creating, updating, or improving agent skills. _(risk: unknown)_

## ml-ops

- **remote-gpu-trainer**: Deploy, monitor, and debug long GPU jobs on RENTED/remote instances (AutoDL, RunPod, vast.ai, Lambda, Slurm, K8s): teardown/billing safety, spot resilience, resumable checkpointing, OOM/NaN triage. _(risk: critical)_

## mobile

- **android-jetpack-compose-expert**: Expert guidance for building modern Android UIs with Jetpack Compose, covering state management, navigation, performance, and Material Design 3. _(risk: safe)_
- **android_ui_verification**: Automated end-to-end UI testing and verification on an Android Emulator using ADB. _(risk: safe)_
- **building-native-ui**: Complete guide for building beautiful apps with Expo Router. Covers fundamentals, styling, components, navigation, animations, patterns, and native tabs. _(risk: unknown)_
- **expo-api-routes**: Guidelines for creating API routes in Expo Router with EAS Hosting _(risk: unknown)_
- **expo-dev-client**: Build and distribute Expo development clients locally or via TestFlight _(risk: unknown)_
- **expo-ui-jetpack-compose**: expo-ui-jetpack-compose _(risk: unknown)_
- **expo-ui-swift-ui**: expo-ui-swift-ui _(risk: unknown)_
- **flutter-expert**: Master Flutter development with Dart 3, advanced widgets, and multi-platform deployment. _(risk: unknown)_
- **growth-engine**: Motor de crescimento para produtos digitais -- growth hacking, SEO, ASO, viral loops, email marketing, CRM, referral programs e aquisicao organica. Ativar para: criar estrategia de growth, SEO...
- **hig-components-content**: Apple Human Interface Guidelines for content display components. _(risk: unknown)_
- **hig-components-controls**: Apple HIG guidance for selection and input controls including pickers, toggles, sliders, steppers, segmented controls, combo boxes, text fields, text views, labels, token fields, virtual... _(risk: unknown)_
- **hig-components-dialogs**: Apple HIG guidance for presentation components including alerts, action sheets, popovers, sheets, and digit entry views. _(risk: unknown)_
- **hig-components-layout**: Apple Human Interface Guidelines for layout and navigation components. _(risk: unknown)_
- **hig-components-menus**: Apple HIG guidance for menu and button components including menus, context menus, dock menus, edit menus, the menu bar, toolbars, action buttons, pop-up buttons, pull-down buttons, disclosure... _(risk: unknown)_
- **hig-components-search**: Apple HIG guidance for navigation-related components including search fields, page controls, and path controls. _(risk: unknown)_
- **hig-components-status**: Apple HIG guidance for status and progress UI components including progress indicators, status bars, and activity rings. _(risk: unknown)_
- **hig-components-system**: Apple HIG guidance for system experience components: widgets, live activities, notifications, complications, home screen quick actions, top shelf, watch faces, app clips, and app shortcuts. _(risk: unknown)_
- **hig-foundations**: Apple Human Interface Guidelines design foundations. _(risk: unknown)_
- **hig-patterns**: Apple Human Interface Guidelines interaction and UX patterns. _(risk: unknown)_
- **hig-platforms**: Apple Human Interface Guidelines for platform-specific design. _(risk: unknown)_
- **ios-developer**: Develop native iOS applications with Swift/SwiftUI. Masters iOS 18, SwiftUI, UIKit integration, Core Data, networking, and App Store optimization. _(risk: unknown)_
- **kotlin-coroutines-expert**: Expert patterns for Kotlin Coroutines and Flow, covering structured concurrency, error handling, and testing. _(risk: safe)_
- **mobile-design**: Mobile-first design and engineering doctrine for iOS and Android apps. Covers touch interaction, performance, platform conventions, offline behavior, and mobile-specific decision-making. Teaches pr... _(risk: unknown)_
- **swiftui-expert-skill**: Write, review, or improve SwiftUI code following best practices for state management, view composition, performance, and iOS 26+ Liquid Glass adoption. Use when building new SwiftUI features, refactoring existing views, reviewing code quality, or adopting modern SwiftUI patterns. _(risk: unknown)_
- **upgrading-expo**: Upgrade Expo SDK versions _(risk: safe)_
- **add-app-clip**: Add an iOS App Clip target to an Expo app. Use when the user mentions App Clip, AASA, apple-app-site-association, appclips, smart app banner, or wants to ship a lightweight iOS Clip invoked from a URL alongside their parent app. _(risk: critical)_
- **android-dev**: Production-grade Android app development guide covering native (Kotlin/Java), cross-platform (Flutter, RN, KMM), and hybrid architectures. _(risk: safe)_
- **appium-skill**: Generates production-grade Appium mobile automation scripts for Android and iOS in Java, Python, or JavaScript. Supports real device and emulator testing locally and on TestMu AI cloud with 100+ real devices. _(risk: critical)_
- **eas-app-stores**: Curated upstream guidance for Eas App Stores; use when the workflow matches the user goal. _(risk: critical)_
- **eas-simulator**: Curated upstream guidance for Eas Simulator; use when the workflow matches the user goal. _(risk: critical)_
- **eas-update-insights**: Check the health of published EAS Updates: crash rates, install/launch counts, unique users, payload size, and the split between embedded and OTA users per channel. _(risk: critical)_
- **eas-workflows**: Use when writing or reviewing Expo EAS workflow YAML: inspect current schema and job syntax, validate configuration, and separate draft edits from launching builds or submissions. _(risk: critical)_
- **expo-animation**: Curated upstream guidance for Expo Animation; use when the workflow matches the user goal. _(risk: unknown)_
- **expo-brownfield**: Integrate Expo and React Native into an existing native iOS or Android app. Use when the user mentions brownfield, embedding React Native in a native app, AAR/XCFramework, or adding Expo to an existing Kotlin/Swift project. Covers both the isolated approach and the integrated approach. _(risk: critical)_
- **expo-examples**: Expo's official example projects — the expo/examples repo of ~70 `with-*` integrations (Stripe, Clerk, Supabase, OpenAI, maps, Reanimated, SQLite, Skia, NativeWind, and more). _(risk: critical)_
- **expo-module**: Guide for creating and writing Expo native modules and views using the Expo Modules API (Swift, Kotlin, TypeScript). Covers module definition DSL, native views, shared objects, config plugins, lifecycle hooks, autolinking, and type system. _(risk: critical)_
- **expo-observe**: Set up and query EAS Observe for Expo apps, including root integration, interactive markers, route metrics, CLI summaries, traces, logs, and performance diagnosis. _(risk: critical)_
- **expo-ui**: Build native UI with the @expo/ui package: real SwiftUI on iOS and Jetpack Compose on Android rendered from React in an Expo or React Native app. _(risk: critical)_
- **ios-debugger-agent**: Debug the current iOS project on a booted simulator with XcodeBuildMCP. _(risk: safe)_
- **mobile-reverse**: Authorized Android/iOS application reverse engineering and security testing: APK/IPA analysis, runtime instrumentation (Frida/Objection), SSL-pinning and jailbreak/root-detection bypass, per OWASP MASTG. _(risk: offensive)_
- **swiftui-liquid-glass**: Implement or review SwiftUI Liquid Glass APIs with correct fallbacks and modifier order. _(risk: safe)_
- **swiftui-performance-audit**: Audit SwiftUI performance issues from code review and profiling evidence. _(risk: safe)_
- **swiftui-ui-patterns**: Apply proven SwiftUI UI patterns for navigation, sheets, async state, and reusable screens. _(risk: safe)_
- **swiftui-view-refactor**: Refactor SwiftUI views into smaller components with stable, explicit data flow. _(risk: safe)_
- **update-swiftui-apis**: Scan Apple's SwiftUI documentation for deprecated APIs and update the SwiftUI Expert Skill with modern replacements. _(risk: critical)_
- **use-dom**: Use Expo DOM components to run web code in a webview on native and as-is on web. Migrate web code to native incrementally. _(risk: critical)_

## monopoly

- **patterns**: Reference document for monopoly patterns. _(risk: safe)_
- **scale-benchmarks**: Reference document for monopoly scale-benchmarks. _(risk: safe)_
- **security-checklist**: Review a scoped architecture against evidence-based network, identity, data, secrets, dependency and incident-response controls. _(risk: safe)_
- **tech-matrix**: Reference document for monopoly tech-matrix. _(risk: safe)_

## networking

- **lightning-architecture-review**: Review Bitcoin Lightning Network protocol designs, compare channel factory approaches, and analyze Layer 2 scaling tradeoffs. Covers trust models, on-chain footprint, consensus requirements, HTLC/PTLC compatibility, liveness, and watchtower support. _(risk: unknown)_
- **lightning-channel-factories**: Technical reference on Lightning Network channel factories, multi-party channels, LSP architectures, and Bitcoin Layer 2 scaling without soft forks. Covers Decker-Wattenhofer, timeout trees, MuSig2 key aggregation, HTLC/PTLC forwarding, and watchtower breach detection. _(risk: unknown)_
- **network-101**: This skill should be used when the user asks to "set up a web server", "configure HTTP or HTTPS", "perform SNMP enumeration", "configure SMB shares", "test network services", or ne... _(risk: unknown)_
- **wireshark-analysis**: This skill should be used when the user asks to "analyze network traffic with Wireshark", "capture packets for troubleshooting", "filter PCAP files", "follow TCP/UDP streams", "dete... _(risk: unknown)_

## office-productivity

- **azure-ai-translation-document-py**: Azure AI Document Translation SDK for batch translation of documents with format preservation. Use for translating Word, PDF, Excel, PowerPoint, and other document formats at scale. _(risk: unknown)_
- **frontend-slides**: Create stunning, animation-rich HTML presentations from scratch or by converting PowerPoint files. _(risk: safe)_
- **google-sheets-automation**: Read and write Google Sheets spreadsheets - get content, update cells, append rows, fetch specific ranges,
search for spreadsheets, and view metadata. Use when user asks to: read a spreadsheet, update cells,
add data to Google Sheets, find a spreadsheet, check sheet...
 _(risk: unknown)_
- **referral-program**: When the user wants to create, optimize, or analyze a referral program, affiliate program, or word-of-mouth strategy. Also use when the user mentions 'referral,' 'affiliate,' 'ambassador,' 'word of... _(risk: unknown)_
- **xlsx-official**: Comprehensive spreadsheet creation, editing, and analysis with support for formulas, formatting, data analysis, and visualization. When Claude needs to work with spreadsheets (.xlsx, .xlsm, .csv, .... _(risk: unknown)_
- **pptx-deck-creation**: Create editable, production-ready PPTX decks with narrative planning, explicit layout specs, asset guidance, and quality checks. _(risk: critical)_

## on-page optimization

- **duplicate-content-checker**: Duplicate Content Checker. Use when working with two or more texts or accessible pages. _(risk: safe)_
- **heading-analyzer**: Heading Analyzer. Use when working with HTML, Markdown or extracted headings. _(risk: safe)_
- **image-alt-tag-generator**: Image Alt Tag Generator. Use when working with image or accurate image description and page context. _(risk: safe)_
- **internal-link-suggestion-tool**: Internal Link Suggestion Tool. Use when working with source text and available destination pages. _(risk: safe)_
- **internal-linking-planner**: Internal Linking Planner. Use when working with site page inventory and priority user journeys. _(risk: safe)_
- **meta-description-optimizer**: Meta Description Optimizer. Use when working with existing description and page content or summary. _(risk: safe)_
- **meta-tag-generator**: Meta Tag Generator. Use when working with page summary, URL and optional brand or social image. _(risk: safe)_
- **on-page-seo-audit-checker**: On-Page SEO Audit Checker. Use when working with page URL or HTML and target reader task. _(risk: safe)_
- **readability-score-calculator**: Readability Score Calculator. Use when working with text and language. _(risk: safe)_
- **seo-content-checker**: SEO Content Checker. Use when working with content and target query or reader task. _(risk: safe)_
- **title-meta-length-counter**: Title & Meta Length Counter. Use when working with title and/or meta description. _(risk: safe)_
- **word-count-structure-checker**: Word Count & Structure Checker. Use when working with text or structured article. _(risk: safe)_

## operations

- **energy-procurement**: Codified expertise for electricity and gas procurement, tariff optimisation, demand charge management, renewable PPA evaluation, and multi-facility energy cost management. _(risk: safe)_
- **inventory-demand-planning**: Codified expertise for demand forecasting, safety stock optimisation, replenishment planning, and promotional lift estimation at multi-location retailers. _(risk: safe)_
- **product-inventor**: Product Inventor e Design Alchemist de nivel maximo — combina Product Thinking, Design Systems, UI Engineering, Psicologia Cognitiva, Storytelling e execucao impecavel nivel Jobs/Apple. Use quando...
- **production-scheduling**: Codified expertise for production scheduling, job sequencing, line balancing, changeover optimisation, and bottleneck resolution in discrete and batch manufacturing. _(risk: safe)_
- **quality-nonconformance**: Codified expertise for quality control, non-conformance investigation, root cause analysis, corrective action, and supplier quality management in regulated manufacturing. _(risk: safe)_
- **returns-reverse-logistics**: Codified expertise for returns authorisation, receipt and inspection, disposition decisions, refund processing, fraud detection, and warranty claims management. _(risk: safe)_
- **anti-sleep**: Keep a Mac awake with caffeinate during long builds, downloads, or supervised automation runs. _(risk: critical)_
- **it-manager-hospital**: World-class Hospital IT Management Advisor specializing in clinical safety, digital maturity (HIMSS/ONA/JCI), and HIS/PEP ecosystems. _(risk: safe)_
- **itil-expert**: Expert advisor for ITIL 4 and ITIL 5 (2026 digital product paradigm), specialized in AI-native governance, sustainability, and value co-creation. _(risk: safe)_
- **mailtrap-setting-up-sending-domain**: Add or verify a Mailtrap sending domain, troubleshoot DNS propagation, publish SPF/DKIM/DMARC records, and complete compliance. _(risk: critical)_
- **pi-custom-model**: Register custom Pi Agent model slugs so saved OpenRouter variants resolve correctly. _(risk: critical)_
- **pre-release-review**: Run a read-only pre-release review for deploy readiness, migrations, config, secrets, rollout order, rollback risk, and launch blockers. _(risk: safe)_
- **vps-server-management**: Manage authorized VPS hosts and server-side agents through cautious SSH and operations workflows. _(risk: critical)_

## orchestration

- **polis-protocol**: Coordinate multi-vendor AI agents as a self-improving team — a learning router assigns work by track record and citizens can amend the protocol's own rules. _(risk: critical)_

## payments

- **doom-pay**: Add self-custodial DOOM and wDOOM checkout links with DoomPay, then verify payment receipts on Doomsday Network Layer-1 or Base Mainnet. _(risk: critical)_

## pentest-tools

- **src-hunter**: Bug-bounty/SRC vulnerability-hunting workflow: five-phase methodology (intake, recon, enumeration, hunt, report) with attack playbooks for SQLi, XSS, RCE, SSRF, IDOR, CSRF, path traversal, and file upload. _(risk: offensive)_

## performance

- **bazel-build-optimization**: Optimize Bazel builds for large-scale monorepos. Use when configuring Bazel, implementing remote execution, or optimizing build performance for enterprise codebases. _(risk: unknown)_
- **cloudformation-best-practices**: CloudFormation template optimization, nested stacks, drift detection, and production-ready patterns. Use when writing or reviewing CF templates. _(risk: unknown)_
- **comprehensive-review-pr-enhance**: You are a PR optimization expert specializing in creating high-quality pull requests that facilitate efficient code reviews. Generate comprehensive PR descriptions, automate review processes, and e... _(risk: unknown)_
- **context-optimization**: This skill should be used when the user asks to "optimize context", "reduce token costs", "improve context efficiency", "implement KV-cache optimization", "partition context", or mentions context limits, observation masking, context budgeting, or extending effective context... _(risk: unknown)_
- **cost-optimization**: Optimize cloud costs through resource rightsizing, tagging strategies, reserved instances, and spending analysis. Use when reducing cloud expenses, analyzing infrastructure costs, or implementing c... _(risk: unknown)_
- **dx-optimizer**: Developer Experience specialist. Improves tooling, setup, and workflows. Use PROACTIVELY when setting up new projects, after team feedback, or when development friction is noticed. _(risk: unknown)_
- **email-sequence**: When the user wants to create or optimize an email sequence, drip campaign, automated email flow, or lifecycle email program. Also use when the user mentions "email sequence," "drip campa... _(risk: unknown)_
- **file-uploads**: Expert at handling file uploads and cloud storage. Covers S3, Cloudflare R2, presigned URLs, multipart uploads, and image optimization. Knows how to handle large files without blocking. Use when: f... _(risk: unknown)_
- **istio-traffic-management**: Configure Istio traffic management including routing, load balancing, circuit breakers, and canary deployments. Use when implementing service mesh traffic policies, progressive delivery, or resilie... _(risk: unknown)_
- **julia-pro**: Master Julia 1.10+ with modern features, performance optimization, multiple dispatch, and production-ready practices. _(risk: unknown)_
- **leiloeiro-mercado**: Analise de mercado imobiliario para leiloes. Liquidez, desagio tipico, ROI, estrategias de saida (flip/reforma/renda), Selic 2025 e benchmark CDI/FII. _(risk: safe)_
- **monetization**: Estrategia e implementacao de monetizacao para produtos digitais - Stripe, subscriptions, pricing experiments, freemium, upgrade flows, churn prevention, revenue optimization e modelos de negocio...
- **nx-workspace-patterns**: Configure and optimize Nx monorepo workspaces. Use when setting up Nx, configuring project boundaries, optimizing build caching, or implementing affected commands. _(risk: unknown)_
- **odoo-inventory-optimizer**: Expert guide for Odoo Inventory: stock valuation (FIFO/AVCO), reordering rules, putaway strategies, routes, and multi-warehouse configuration. _(risk: safe)_
- **production-code-audit**: Autonomously deep-scan entire codebase line-by-line, understand architecture and patterns, then systematically transform it to production-grade, corporate-level professional quality with optimizations _(risk: unknown)_
- **qiskit**: IBM quantum computing framework. Use when targeting IBM Quantum hardware, working with Qiskit Runtime for production workloads, or needing IBM optimization tools. Best for IBM hardware execution, quantum error mitigation, and enterprise quantum computing. For Google hardware... _(risk: unknown)_
- **similarity-search-patterns**: Implement efficient similarity search with vector databases. Use when building semantic search, implementing nearest neighbor queries, or optimizing retrieval performance. _(risk: unknown)_
- **social-content**: When the user wants help creating, scheduling, or optimizing social media content for LinkedIn, Twitter/X, Instagram, TikTok, Facebook, or other platforms. Also use when the user mentions 'LinkedIn... _(risk: unknown)_
- **turborepo-caching**: Configure Turborepo for efficient monorepo builds with local and remote caching. Use when setting up Turborepo, optimizing build pipelines, or implementing distributed caching. _(risk: unknown)_

## personal-development

- **quit-sponsor**: Helps an AI agent provide non-judgmental, evidence-informed quit-smoking support with user-consented tracking, craving check-ins, and escalation to human or clinical help. Not medical care. _(risk: safe)_
- **satori**: Clinically informed wisdom companion blending psychology and philosophy into a structured thinking partner _(risk: safe)_

## planning

- **blueprint**: Turn a one-line objective into a step-by-step construction plan any coding agent can execute cold. Each step has a self-contained context brief — a fresh agent in a new session can pick up any step without reading prior steps. _(risk: safe)_
- **decision-navigator**: Guide stuck or overwhelmed users through targeted branching questions until they reach concrete next steps. _(risk: safe)_
- **idea-refine**: Refines raw ideas into sharp, actionable concepts through structured divergent and convergent thinking. Use when an idea is still vague, when you need to stress-test assumptions before committing to a plan, or when you want to expand options before converging on one. _(risk: critical)_
- **idea-to-blueprint**: Turn a raw product, app, bot or feature idea into one evidence-backed build blueprint (researched stack, epics, Given/When/Then criteria, tests) that coding agents build one epic per session. _(risk: safe)_
- **not-a-vibe-coder**: Turns vague prompts into 8 structured planning files for brand new projects. DO NOT use on existing codebases. _(risk: critical)_
- **planning-and-task-breakdown**: Breaks work into ordered tasks. Use when you have a spec or clear requirements and need to break work into implementable tasks. Use when a task feels too large to start, when you need to estimate scope, or when parallel work is possible.
- **spec-driven-development**: Creates specs before coding. Use when starting a new project, feature, or significant change and no specification exists yet. Use when requirements are unclear, ambiguous, or only exist as a vague idea. _(risk: critical)_

## presentation-processing

- **impress**: Presentation creation, format conversion (ODP/PPTX/PDF), slide automation with LibreOffice Impress. _(risk: safe)_

## product

- **before-you-build**: Review product risk before coding by checking demand, alternatives, channels, switching costs, and failure signals. _(risk: safe)_
- **idea-autopsy**: Autopsy a business idea before you build it: kill-list check, five hard filters, a free-AI one-prompt test, live ad-market verification, and a verdict with a named kill-pattern. _(risk: critical)_
- **product-decision-agent**: 中文产品决策 Agent。用于需求优先级、Roadmap、增长、留存、运营、数据异常、A/B Test、项目延期和跨团队协作；先判断事实、阶段、核心阻塞与主导机制，再给出下一步、停止清单和切换条件。默认中文，不引用原文或讲历史。 _(risk: safe)_
- **product-design-harness**: Use when a product direction, feature, workflow, experiment, launch, feedback signal, automation, or scale decision needs judgment before execution or the next iteration. _(risk: safe)_
- **shopify-review-triage**: Turn public 1-3-star Shopify App Store review rows into a P0-P3 triage brief: incident risk, repeated friction, pricing confusion, feature requests, and an explicit needs-human-read bucket.

## product-management

- **asana-automation**: Automate Asana tasks via Rube MCP (Composio): tasks, projects, sections, teams, workspaces. Always search tools first for current schemas. _(risk: unknown)_
- **basecamp-automation**: Automate Basecamp project management, to-dos, messages, people, and to-do list organization via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **clickup-automation**: Automate ClickUp project management including tasks, spaces, folders, lists, comments, and team operations via Rube MCP (Composio). Always search tools first for current schemas. _(risk: unknown)_
- **code-refactoring-tech-debt**: You are a technical debt expert specializing in identifying, quantifying, and prioritizing technical debt in software projects. Analyze the codebase to uncover debt, assess its impact, and create acti _(risk: unknown)_
- **codebase-cleanup-tech-debt**: You are a technical debt expert specializing in identifying, quantifying, and prioritizing technical debt in software projects. Analyze the codebase to uncover debt, assess its impact, and create acti _(risk: unknown)_
- **jira-automation**: Automate Jira tasks via Rube MCP (Composio): issues, projects, sprints, boards, comments, users. Always search tools first for current schemas. _(risk: unknown)_
- **linear-automation**: Automate Linear tasks via Rube MCP (Composio): issues, projects, cycles, teams, labels. Always search tools first for current schemas. _(risk: unknown)_
- **marketing-ideas**: Provide proven marketing strategies and growth ideas for SaaS and software products, prioritized using a marketing feasibility scoring system. _(risk: unknown)_
- **marketing-psychology**: Apply behavioral science and mental models to marketing decisions, prioritized using a psychological leverage and feasibility scoring system. _(risk: unknown)_
- **odoo-xml-views-builder**: Expert at building Odoo XML views: Form, List, Kanban, Search, Calendar, and Graph. Generates correct XML for Odoo 14-17 with proper visibility syntax. _(risk: safe)_
- **product-design**: Design de produto nivel Apple — sistemas visuais, UX flows, acessibilidade, linguagem visual proprietaria, design tokens, prototipagem e handoff. Cobre Figma, design systems, tipografia, cor,...
- **product-manager-toolkit**: Comprehensive toolkit for product managers including RICE prioritization, customer interview analysis, PRD templates, discovery frameworks, and go-to-market strategies. Use for feature prioritizati... _(risk: unknown)_
- **saas-mvp-launcher**: Use when planning or building a SaaS MVP from scratch. Provides a structured roadmap covering tech stack, architecture, auth, payments, and launch checklist. _(risk: safe)_
- **vizcom**: AI-powered product design tool for transforming sketches into full-fidelity 3D renders. _(risk: safe)_
- **wrike-automation**: Automate Wrike project management via Rube MCP (Composio): create tasks/folders, manage projects, assign work, and track progress. Always search tools first for current schemas. _(risk: unknown)_
- **idea-os**: Five-phase pipeline (triage → clarify → research → PRD → plan) that turns a raw idea into four linked files: clarifying questions, deep research, a PRD with non-goals and metrics, and a phased execution plan with mermaid user journey and kill criteria. _(risk: safe)_

## productivity

- **interview-coach**: Full job search coaching system — JD decoding, resume, storybank, mock interviews, transcript analysis, comp negotiation. 23 commands, persistent state. _(risk: safe)_
- **anywrite**: Compiled CLI covering all 52 endpoints of the Anytype local API — objects, properties, tags, search, chat, files — one binary, no MCP server needed. _(risk: critical)_
- **apple-notes-search**: Semantic + keyword search and connection-discovery across the user's own Apple Notes via the apple-notes MCP server. Use when the user wants to find, recall, or synthesize something from their notes, or surface non-obvious bridges/related notes. macOS, on-device. _(risk: critical)_
- **ask-matt**: Ask which skill or flow fits your situation. A router over the user-invoked skills in this repo. _(risk: safe)_
- **brain-to-docs**: Interview the user to turn project vision and decisions into README and ADR documentation. _(risk: critical)_
- **busabase**: Use when managing Busabase workspace records, knowledge, apps, or skills through permission-aware ChangeRequests with auditable history. _(risk: critical)_
- **byagent**: Publish agent-written Markdown or HTML as a shareable link with the byagent CLI, then read readers' line comments back, edit, republish to the same link and resolve them. _(risk: critical)_
- **career-ops**: Multi-CLI job-search command center: evaluate offers, scan portals, tailor CVs, track applications, prep interviews. Invoke per mode. _(risk: safe)_
- **codex-profiles**: Use codex-profiles to run Codex CLI or Codex Desktop with isolated CODEX_HOME profiles for separate accounts, projects, and local state. _(risk: critical)_
- **compile-knowledge**: Compile durable, non-obvious findings into an interlinked markdown knowledge store — atomic files, [[wiki-links]], a maintained index — so an agent gets smarter across sessions instead of relearning the same facts. _(risk: safe)_
- **context-kit**: Evaluate, adapt, and safely install Context Kit personal context artifacts for Claude Code or adjacent agent workflows. _(risk: critical)_
- **court**: Put an idea on trial: a prosecutor and a defense Claude argue, 12 juror sub-agents vote independently, and a judge reads the verdict and the changes that would flip it. _(risk: critical)_
- **daily-gift**: Relationship-aware daily gift engine with five-stage creative pipeline — editorial judgment, synthesis, concept generation, visual strategy, and rendering in H5, image, or video _(risk: critical)_
- **faf-wizard**: Done-for-you .faf generator. One-click AI context for any project - new, legacy, or famous. Auto-detects stack, scores readiness, works everywhere. _(risk: safe)_
- **grill-me**: A relentless interview to sharpen a plan or design. _(risk: safe)_
- **grill-with-docs**: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. _(risk: safe)_
- **grilling**: Interview the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases. _(risk: safe)_
- **handoff**: Compact the current conversation into a handoff document for another agent to pick up. _(risk: safe)_
- **i-have-adhd**: Shape output for ADHD readers: next action first, numbered steps, restated state, no tangents, time estimates, visible wins. Toggle with /i-have-adhd. _(risk: safe)_
- **interview-me**: Draw out what the user actually wants with one-question-at-a-time interviews until intent is clear — before any plan, spec, or code exists. _(risk: safe)_
- **interview-style-doc-building**: Build structured strategy documents by asking one question at a time and patching the file. _(risk: critical)_
- **jobgpt**: Job search automation, auto apply, resume generation, application tracking, salary intelligence, and recruiter outreach using the JobGPT MCP server. _(risk: critical)_
- **json-canvas**: Create and edit JSON Canvas files (.canvas) with nodes, edges, groups, and connections. Use when working with .canvas files, creating visual canvases, mind maps, flowcharts, or when the user mentions Canvas files in Obsidian. _(risk: critical)_
- **kernel-prompt**: Use when composing or improving an LLM prompt or agent instruction. Asks one round of questions, then returns only the prompt; never performs the task. _(risk: safe)_
- **markdown-rendering**: Open Markdown reliably in cmux panes and recover from blank rendered surfaces. _(risk: safe)_
- **mcd-secret-menu-lab**: Plan McDonald's China recipe combinations using an authorized MCP connection for current store menus, prices and nutrition. Use for recreating food hacks or exploring combinations within a budget. _(risk: safe)_
- **mdpr-skill**: Review MDPR Markdown presentation workflows with semantic hints, visual checks, and deterministic renderer boundaries. _(risk: safe)_
- **meeting-distiller-pro**: Transform messy meeting notes and transcripts into structured action items, decisions, and follow-ups. Never lose a meeting insight again. _(risk: unknown)_
- **meeting-notes**: Turns raw meeting notes into structured minutes: conclusion first, then decisions / action items / open questions; every action item must have an owner and a deadline. Use when the user pastes meeting transcripts or rough notes and asks for minutes or a summary. _(risk: safe)_
- **obsidian-bases**: Create and edit Obsidian Bases (.base files) with views, filters, formulas, and summaries. Use when working with .base files, creating database-like views of notes, or when the user mentions Bases, table views, card views, filters, or formulas in Obsidian. _(risk: critical)_
- **obsidian-cli**: Use the Obsidian CLI to read, create, search, and manage vault content, or to develop and debug Obsidian plugins and themes from the command line. _(risk: critical)_
- **obsidian-markdown**: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific syntax. Use when working with .md files in Obsidian, or when the user mentions wikilinks, callouts, frontmatter, tags, embeds, or Obsidian notes. _(risk: critical)_
- **ppl-personal-crm**: Uses the ppl personal CRM over MCP to prepare for conversations, recall facts about people, log interactions and manage relationship follow-ups. _(risk: critical)_
- **project-memory-log**: Maintain one operation log and one deduplicated document catalog for long-running projects. Use when resuming project work or tracing durable document changes across sessions. _(risk: critical)_
- **read-all-adrs**: Read every ADR in a project before summarizing architectural context or decisions. _(risk: safe)_
- **rich-elicitation**: Asks clarifying questions in multiple rounds before starting ambiguous tasks. Fires when 2+ task dimensions each have 3+ viable answers.
- **session-handoff**: Use when context approaches capacity, before /clear or /compact, when switching tasks, or when ending a coding session: produces a structured handoff artifact for the next session. _(risk: safe)_
- **setup-help**: Walk a user through setup or installation one step at a time with the remaining steps visible. _(risk: safe)_
- **syncbook-discovery**: Find reciprocal collaborators on Syncbook or prepare a private profile draft for human review using only explicitly supplied task facts. _(risk: critical)_
- **taasky**: Negotiate terms with another person or their agent through the hosted Taasky MCP server: meeting times, prices, dates. The human confirms every accept, reject or withdraw. _(risk: critical)_
- **telegram-bot-messaging**: Send Telegram messages, files, and alerts via bot API; ask questions with inline buttons and wait for the answer. Supports multiple bots, named chat targets, and CI/cron/hook notifications. _(risk: critical)_
- **time-ledger**: Natural-language time tracking: parse what the user says they did into Activity/Minutes/Date rows in their own Notion database — asking instead of guessing when unsure. _(risk: critical)_
- **trading-ledger**: A trading journal that captures the decision, not just the fill: thesis, plan, and emotion at the moment of entry, written to the user's own Notion database; reviews grade decisions, not P&L. _(risk: critical)_
- **unpaid-intern**: A free second brain for work in plain markdown files the user owns. Turns transcripts, docs, and tickets into briefings, meeting prep, debriefs, follow-ups, and status tables. _(risk: critical)_
- **usage-engineer**: Cut wasted tokens in coding-agent sessions: compact long logs, stop identical retries, check stale project maps, and audit local Codex/OpenCode usage. _(risk: critical)_
- **workorai**: WorkorAI talent-marketplace skill: candidates search jobs and manage applications; employers run the job lifecycle and get ranked candidate matches with white-box fit explanations. _(risk: critical)_

## programming-languages

- **elixir-pro**: Write idiomatic Elixir code with OTP patterns, supervision trees, and Phoenix LiveView. Masters concurrency, fault tolerance, and distributed systems. _(risk: unknown)_
- **haskell-pro**: Expert Haskell engineer specializing in advanced type systems, pure _(risk: unknown)_

## project management

- **project-brief**: Project Detail Optimizer. Use when working with one sentence, rough notes or an existing project brief. _(risk: safe)_

## project-management

- **progressive-estimation**: Estimate AI-assisted and hybrid human+agent development work with research-backed PERT statistics and calibration feedback loops _(risk: safe)_
- **accint-commitments**: Triage acc's open promises and close them with honest real-world verdicts via acc_act(runtime="outcome"). _(risk: critical)_
- **artifact-yylo**: Capture and retrieve durable YYLO Ledger artifact Records with intentional profiles, payload modes, provenance, retention, and secret-safe immutable evidence. _(risk: safe)_
- **feature-tracking**: Maintain durable feature-level memory across AI coding sessions with lightweight Markdown tracks for status, source-of-truth docs, decisions, risks, and changes. _(risk: critical)_
- **ledger-tasks-yylo**: Use YYLO Ledger task management: create, list, search, get, mark, update, archive, deps, ready, order and merge with dependencies. _(risk: critical)_
- **plan-ledger-tasks-yylo**: Create a concise Product Development Requirement and one or more implementation-sized YYLO Ledger tasks when the user explicitly asks to plan or register work. _(risk: critical)_
- **project-skill-audit**: Audit a project and recommend the highest-value skills to add or update. _(risk: safe)_
- **project-state-governor**: Govern evidence-backed canonical project state across sessions, branches, reviews, and research cycles without inventing product intent. _(risk: critical)_
- **resumable-implementation-contracts**: Create repository-based execution contracts for multi-session implementation work, with stable task IDs, evidence, checkpoints, and exact resume state. _(risk: safe)_
- **to-issues**: Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices. _(risk: safe)_
- **to-prd**: Turn the current conversation into a PRD and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed. _(risk: safe)_
- **understand-project-yylo**: Inspect the current product architecture, dependencies, and validation loops before planning or implementing a requested change. _(risk: safe)_
- **wiki-yylo**: Use YYLO Ledger wiki Records as durable project knowledge. Search before creating, classify information correctly, and make revision-safe Markdown updates without editing Ledger storage directly. _(risk: safe)_
- **workflow-yylo**: Create and maintain validated YYLO Ledger workflow Records while keeping storage, execution, and run evidence as separate explicit boundaries. _(risk: safe)_

## prompt-engineering

- **recursive-context-pruning-token-budgeting**: Optimizes AI agent performance by pruning redundant context, managing token usage, and enforcing ultra-concise, direct-to-value responses. _(risk: safe)_

## python

- **astropy**: Comprehensive Python library for astronomy and astrophysics. This skill should be used when working with astronomical data including celestial coordinates, physical units, FITS files, cosmological calculations, time systems, tables, world coordinate systems (WCS), and... _(risk: unknown)_
- **async-python-patterns**: Master Python asyncio, concurrent programming, and async/await patterns for high-performance applications. Use when building async APIs, concurrent systems, or I/O-bound applications requiring non-... _(risk: unknown)_
- **dbos-python**: DBOS Python SDK for building reliable, fault-tolerant applications with durable workflows. Use this skill when writing Python code with DBOS, creating workflows and steps, using queues, using DBOSC... _(risk: safe)_
- **discord-bot-architect**: Specialized skill for building production-ready Discord bots. Covers Discord.js (JavaScript) and Pycord (Python), gateway intents, slash commands, interactive components, rate limiting, and sharding. _(risk: unknown)_
- **m365-agents-py**: Microsoft 365 Agents SDK for Python. Build multichannel agents for Teams/M365/Copilot Studio with aiohttp hosting, AgentApplication routing, streaming responses, and MSAL-based auth. _(risk: unknown)_
- **n8n-code-python**: Write Python code in n8n Code nodes. Use when writing Python in n8n, using _input/_json/_node syntax, working with standard library, or need to understand Python limitations in n8n Code nodes. _(risk: unknown)_
- **networkx**: Comprehensive toolkit for creating, analyzing, and visualizing complex networks and graphs in Python. Use when working with network/graph data structures, analyzing relationships between entities, computing graph algorithms (shortest paths, centrality, clustering), detecting... _(risk: unknown)_
- **odoo-rpc-api**: Expert on Odoo's external JSON-RPC and XML-RPC APIs. Covers authentication, model calls, record CRUD, and real-world integration examples in Python, JavaScript, and curl. _(risk: safe)_
- **python-packaging**: Create distributable Python packages with proper project structure, setup.py/pyproject.toml, and publishing to PyPI. Use when packaging Python libraries, creating CLI tools, or distributing Python ... _(risk: unknown)_
- **python-patterns**: Python development principles and decision-making. Framework selection, async patterns, type hints, project structure. Teaches thinking, not copying. _(risk: unknown)_
- **python-performance-optimization**: Profile and optimize Python code using cProfile, memory profilers, and performance best practices. Use when debugging slow Python code, optimizing bottlenecks, or improving application performance. _(risk: unknown)_
- **slack-bot-builder**: Build Slack apps using the Bolt framework across Python, JavaScript, and Java. Covers Block Kit for rich UIs, interactive components, slash commands, event handling, OAuth installation flows, and W... _(risk: unknown)_
- **statsmodels**: Statistical models library for Python. Use when you need specific model classes (OLS, GLM, mixed models, ARIMA) with detailed diagnostics, residuals, and inference. Best for econometrics, time series, rigorous inference with coefficient tables. For... _(risk: unknown)_
- **sympy**: Use this skill when working with symbolic mathematics in Python. This skill should be used for symbolic computation tasks including solving equations algebraically, performing calculus operations (derivatives, integrals, limits), manipulating algebraic expressions, working... _(risk: unknown)_
- **temporal-python-pro**: Master Temporal workflow orchestration with Python SDK. Implements durable workflows, saga patterns, and distributed transactions. Covers async/await, testing strategies, and production deployment. _(risk: unknown)_
- **uv-package-manager**: Master the uv package manager for fast Python dependency management, virtual environments, and modern Python project workflows. Use when setting up Python projects, managing dependencies, or optimi... _(risk: unknown)_
- **wiki-vitepress**: Packages generated wiki Markdown into a VitePress static site with dark theme, dark-mode Mermaid diagrams with click-to-zoom, and production build output. Use when the user wants to create a browsa... _(risk: unknown)_

## quality

- **dos-verify-done-claims**: Before accepting an agent's 'done / shipped / fixed' claim, verify it against ground truth (git ancestry + the commit's own diff) using the DOS kernel's `dos verify` and `dos commit-audit` — never the agent's own narration. _(risk: critical)_
- **pre-ship-gate**: A ship gate that runs before any production deploy: checks the silent failure modes that make a deploy 'succeed' while prod stays broken, then verifies the live revision instead of trusting deploy output. _(risk: safe)_

## reasoning

- **axiom**: First-principles assumption auditor. Classifies each hidden assumption (fact / convention / belief / interest-driven), ranks by fragility × impact, and rebuilds conclusions from verified premises. Bilingual: auto-detects Chinese or English. _(risk: safe)_
- **falsify**: The scientific thinking protocol for AI agents. Use when facing complex, ambiguous, or high-stakes questions where guessing is costly: hypothesis → attempt to break it → evidence → calibrated conclusion. _(risk: safe)_

## reliability

- **tool-use-guardian**: FREE — Intelligent tool-call reliability wrapper. Monitors, retries, fixes, and learns from tool failures. Auto-recovers from truncated JSON, timeouts, rate limits, and mid-chain failures. _(risk: safe)_
- **automated-triage**: Triage Monte Carlo alerts interactively or build an automated workflow. Fetch, score, and troubleshoot alerts using MCP tools now, or design a reusable workflow that runs on a schedule. _(risk: critical)_
- **monte-carlo-analyze-root-cause**: Curated upstream guidance for Monte Carlo Analyze Root Cause; use when the workflow matches the user goal. _(risk: critical)_
- **tune-monitor**: Analyze a Monte Carlo monitor and recommend config changes to reduce alert noise. Supports metric, custom SQL, validation, and table monitors. Fetches the report, identifies patterns, and suggests tuning. _(risk: critical)_
- **windows-shell-reliability**: Reliable command execution on Windows: paths, encoding, and common binary pitfalls. _(risk: safe)_

## research

- **apify-lead-generation**: Generates B2B/B2C leads by scraping Google Maps, websites, Instagram, TikTok, Facebook, LinkedIn, YouTube, and Google Search. Use when user asks to find leads, prospects, businesses, build lead lis... _(risk: unknown)_
- **apify-market-research**: Analyze market conditions, geographic opportunities, pricing, consumer behavior, and product validation across Google Maps, Facebook, Instagram, Booking.com, and TripAdvisor. _(risk: unknown)_
- **competitive-landscape**: This skill should be used when the user asks to \\\"analyze competitors", "assess competitive landscape", "identify differentiation", "evaluate market positioning", "apply Porter's Five Forces",... _(risk: unknown)_
- **exa-search**: Semantic search, similar content discovery, and structured research using Exa API _(risk: unknown)_
- **firecrawl-scraper**: Deep web scraping, screenshots, PDF parsing, and website crawling using Firecrawl API _(risk: unknown)_
- **last30days**: Research a topic from the last 30 days on Reddit + X + Web, become an expert, and write copy-paste-ready prompts for the user's target tool. _(risk: unknown)_
- **market-sizing-analysis**: This skill should be used when the user asks to \\\"calculate TAM\\\", "determine SAM", "estimate SOM", "size the market", "calculate market opportunity", "what's the total addressable market", or... _(risk: unknown)_
- **search-specialist**: Expert web researcher using advanced search techniques and _(risk: unknown)_
- **tavily-web**: Web search, content extraction, crawling, and research capabilities using Tavily API _(risk: unknown)_
- **web-scraper**: Web scraping inteligente multi-estrategia. Extrai dados estruturados de paginas web (tabelas, listas, precos). Paginacao, monitoramento e export CSV/JSON. _(risk: safe)_
- **wiki-qa**: Answers questions about a code repository using source file analysis. Use when the user asks a question about how something works, wants to understand a component, or needs help navigating the code... _(risk: unknown)_
- **wiki-researcher**: Conducts multi-turn iterative deep research on specific topics within a codebase with zero tolerance for shallow analysis. Use when the user wants an in-depth investigation, needs to understand how... _(risk: unknown)_
- **arcmira-find-quotes**: Search indexed YouTube and podcast transcripts for quotes, speakers and clip boundaries with timestamped source links using Arcmira. _(risk: safe)_
- **ask-human-expert**: Ask real executives and domain experts a question through Instant Expert for a written answer or short call: practitioner knowledge, customer discovery. Free test mode; live sends need approval. _(risk: critical)_
- **deep-research-framework**: Framework for deep research reports: define the question and tier sources first, cross-verify, then write conclusion-first reports with explicit uncertainty statements. Use when the user asks for a research report, topic investigation, or competitive analysis. _(risk: safe)_
- **deepapi**: Use DeepAPI for supported scraping, research, and email workflows with explicit credentials and approval. _(risk: critical)_
- **dsh-deepread**: Use for evidence-first reading of articles, books, PDFs, web pages, or document sets, with knowledge maps and Feynman checks. _(risk: safe)_
- **efficient-web-research**: Protocol for token-efficient web research. Use when accessing URLs, GitHub repos, or running search queries. Prevents full-page fetching waste. _(risk: safe)_
- **entropy-box**: Entropy Box knowledge-compiler for embodied-AI: turns bounded requirements into grounded workflows via Solution Consult, Search, Lookup, and Evidence. Do not use it to control physical robots. _(risk: critical)_
- **fact-check-x-complete**: Compare claims from one or more AI answers, verify their citations against public primary sources, and produce an evidence-linked fact-check report without installing a bundled browser runtime. _(risk: critical)_
- **gemini-deep-research**: Run autonomous multi-step research with Google's Gemini Deep Research Agent: kick off a query, poll progress, and collect a cited report for market analysis or literature reviews. _(risk: critical)_
- **helium-mcp**: Connect to Helium's MCP server for news research, media bias analysis, balanced perspectives, stock/options data, and semantic meme search across 3.2M+ articles and 5,000+ sources _(risk: safe)_
- **ii-commons**: Deterministic search across arXiv, PubMed/PMC, and US policy corpora with daily freshness cutoffs. _(risk: safe)_
- **jev-social**: Run read-only, browser-grounded Instagram, TikTok, or LinkedIn research through Jev routing and socai CLI, returning source-linked evidence and reports. _(risk: critical)_
- **linkdigest-social-link-reader**: Read one public Xiaohongshu, Douyin, TikTok, YouTube, X or WeChat article link into text an agent can use (transcript, image text, key points) via the LinkDigest API or MCP server. _(risk: critical)_
- **longbridge-research**: Curated upstream guidance for Longbridge Research; use when the workflow matches the user goal. _(risk: critical)_
- **multi-source-search**: Cross-validate web research and produce an offline-checkable evidence ledger with explicit source diversity, confidence, conflicts, and gaps. _(risk: safe)_
- **news-sentiment-engine**: Multi-source RSS news aggregation with Claude-powered sentiment analysis and structured briefing output _(risk: critical)_
- **papers-skill**: Skill for academic research workflows: search Semantic Scholar (200M+ papers), inspect citations, download arXiv PDFs, and extract PDF text. Bundles a self-contained Python CLI. _(risk: safe)_
- **people-data**: Research LinkedIn professional profiles and public business-contact data, including email/phone lookup, people search, and YouTube channel business-email discovery. _(risk: safe)_
- **perq**: Find verified free AI credits, free tiers, startup programs and student perks for AI APIs, GPUs and dev tools, each with the vendor's source link and a last-verified date. _(risk: safe)_
- **pi-web-search**: Give Pi Agents a safe web-search and fetch workflow using the installed pi-web-access package. _(risk: safe)_
- **research-prompt**: Turn vague research needs into one precise deep-research prompt with context and output criteria. _(risk: safe)_
- **survey-generator**: Generate source-backed AI/ML survey paper artifacts with curated bibliographies and Fireworks/Kimi HTML rendering. _(risk: critical)_
- **system-prompt-lookup**: Checks what a shipped AI product's system prompt and tool schema actually say, by reading a dated archive of captured prompts instead of recalling them. Use before asserting or accepting any claim about an agent's instructions. _(risk: safe)_
- **youtube-transcript**: Fetch YouTube transcripts through DeepAPI or local fallback tooling and save clean text output. _(risk: safe)_

## reverse-engineering

- **dsl-vm-reverse**: Reverse JavaScript-based custom DSL/VM interpreters and risk-control engines: identify IIFE/switch-based opcode dispatch, extract opcode tables, and capture runtime semantics. _(risk: critical)_

## rust

- **makepad-skills**: Makepad UI development skills for Rust apps: setup, patterns, shaders, packaging, and troubleshooting. _(risk: safe)_
- **memory-safety-patterns**: Implement memory-safe programming with RAII, ownership, smart pointers, and resource management across Rust, C++, and C. Use when writing safe systems code, managing resources, or preventing memory... _(risk: unknown)_
- **robius-app-architecture**: CRITICAL: Use for Robius app architecture patterns. Triggers on:
Tokio, async, submit_async_request, 异步, 架构,
SignalToUI, Cx::post_action, worker task,
app structure, MatchEvent, handle_startup _(risk: unknown)_
- **rust-async-patterns**: Master Rust async programming with Tokio, async traits, error handling, and concurrent patterns. Use when building async Rust applications, implementing concurrent systems, or debugging async code. _(risk: unknown)_
- **rust-pro**: Master Rust 1.75+ with modern async patterns, advanced type system features, and production-ready systems programming. _(risk: unknown)_
- **systems-programming-rust-project**: You are a Rust project architecture expert specializing in scaffolding production-ready Rust applications. Generate complete project structures with cargo tooling, proper module organization, testing _(risk: unknown)_
- **zeroize-audit**: Detects missing zeroization of sensitive data in source code and identifies zeroization removed by compiler optimizations, with assembly-level analysis, and control-flow verification. Use for auditing C/C++/Rust code handling secrets, keys, passwords, or other sensitive data. _(risk: unknown)_

## schema & structured data

- **ai-schema-markup-generator**: Schema Markup Generator. Use when working with entity type or page facts and canonical page URL. _(risk: safe)_
- **featured-tool-schema-generator**: Featured Tool Schema Generator. Use when working with tool page URL and visible tool capabilities. _(risk: safe)_
- **local-schema-builder**: Local Schema Builder. Use when working with business facts, page URL and actual address or service area. _(risk: safe)_
- **structured-data-validator**: Structured Data Validator. Use when working with JSON-LD, Microdata or RDFa source. _(risk: safe)_

## science

- **doc2math**: Convert narrative technical documents into grounded Mathematical Problem Specifications with variables, constraints, objectives, and uncertainty. _(risk: safe)_
- **mathguard**: Math-heavy escalation for n >= 10^6 — Bloom, HyperLogLog, Count-Min, MinHash/LSH, FFT, JL projection, sweep line. Use when classical O(n log n) is the floor and approximate or math wins. _(risk: safe)_
- **scarf-single-cell**: Analyze single-cell RNA-seq at million-cell scale with Scarf: out-of-core Zarr stores on disk or object storage, provenance-tracked artifacts, audited QC, clustering, markers and donor comparisons. _(risk: critical)_

## security

- **007**: Security audit, hardening, threat modeling (STRIDE/PASTA), Red/Blue Team, OWASP checks, code review, incident response, and infrastructure security for any project. _(risk: critical)_
- **active-directory-attacks**: This skill should be used when the user asks to "attack Active Directory", "exploit AD", "Kerberoasting", "DCSync", "pass-the-hash", "BloodHound enumeration", "Golden Ticket", ... _(risk: unknown)_
- **anti-reversing-techniques**: Understand anti-reversing, obfuscation, and protection techniques encountered during software analysis. Use when analyzing protected binaries, bypassing anti-debugging for authorized analysis, or u... _(risk: unknown)_
- **api-fuzzing-bug-bounty**: This skill should be used when the user asks to "test API security", "fuzz APIs", "find IDOR vulnerabilities", "test REST API", "test GraphQL", "API penetration testing", "bug b... _(risk: unknown)_
- **api-security-best-practices**: Implement secure API design patterns including authentication, authorization, input validation, rate limiting, and protection against common API vulnerabilities _(risk: unknown)_
- **attack-tree-construction**: Build comprehensive attack trees to visualize threat paths. Use when mapping attack scenarios, identifying defense gaps, or communicating security risks to stakeholders. _(risk: unknown)_
- **audit-context-building**: Enables ultra-granular, line-by-line code analysis to build deep architectural context before vulnerability or bug finding. _(risk: unknown)_
- **audit-skills**: Expert security auditor for AI Skills and Bundles. Performs non-intrusive static analysis to identify malicious patterns, data leaks, system stability risks, and obfuscated payloads across Windows, macOS, Linux/Unix, and Mobile (Android/iOS). _(risk: safe)_
- **aws-compliance-checker**: Automated compliance checking against CIS, PCI-DSS, HIPAA, and SOC 2 benchmarks _(risk: safe)_
- **aws-iam-best-practices**: IAM policy review, hardening, and least privilege implementation _(risk: safe)_
- **aws-penetration-testing**: This skill should be used when the user asks to "pentest AWS", "test AWS security", "enumerate IAM", "exploit cloud infrastructure", "AWS privilege escalation", "S3 bucket testing... _(risk: unknown)_
- **aws-secrets-rotation**: Automate AWS secrets rotation for RDS, API keys, and credentials _(risk: safe)_
- **aws-security-audit**: Comprehensive AWS security posture assessment using AWS CLI and security best practices _(risk: safe)_
- **azure-keyvault-keys-rust**: Azure Key Vault Keys SDK for Rust. Use for creating, managing, and using cryptographic keys. Triggers: "keyvault keys rust", "KeyClient rust", "create key rust", "encrypt rust", "sign rust". _(risk: unknown)_
- **azure-keyvault-keys-ts**: Manage cryptographic keys using Azure Key Vault Keys SDK for JavaScript (@azure/keyvault-keys). Use when creating, encrypting/decrypting, signing, or rotating keys. _(risk: unknown)_
- **azure-security-keyvault-keys-dotnet**: Azure Key Vault Keys SDK for .NET. Client library for managing cryptographic keys in Azure Key Vault and Managed HSM. Use for key creation, rotation, encryption, decryption, signing, and verification. _(risk: unknown)_
- **azure-security-keyvault-keys-java**: Azure Key Vault Keys Java SDK for cryptographic key management. Use when creating, managing, or using RSA/EC keys, performing encrypt/decrypt/sign/verify operations, or working with HSM-backed keys. _(risk: unknown)_
- **azure-security-keyvault-secrets-java**: Azure Key Vault Secrets Java SDK for secret management. Use when storing, retrieving, or managing passwords, API keys, connection strings, or other sensitive configuration data. _(risk: unknown)_
- **backend-security-coder**: Expert in secure backend coding practices specializing in input validation, authentication, and API security. Use PROACTIVELY for backend security implementations or security code reviews. _(risk: unknown)_
- **binary-analysis-patterns**: Master binary analysis patterns including disassembly, decompilation, control flow analysis, and code pattern recognition. Use when analyzing executables, understanding compiled code, or performing... _(risk: unknown)_
- **broken-authentication**: This skill should be used when the user asks to "test for broken authentication vulnerabilities", "assess session management security", "perform credential stuffing tests", "evaluate ... _(risk: unknown)_
- **burp-suite-testing**: This skill should be used when the user asks to "intercept HTTP traffic", "modify web requests", "use Burp Suite for testing", "perform web vulnerability scanning", "test with Burp ... _(risk: unknown)_
- **burpsuite-project-parser**: Searches and explores Burp Suite project files (.burp) from the command line. Use when searching response headers or bodies with regex patterns, extracting security audit findings, dumping proxy history or site map data, or analyzing HTTP traffic captured in a Burp project. _(risk: unknown)_
- **cc-skill-security-review**: Use this skill when adding authentication, handling user input, working with secrets, creating API endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist a... _(risk: unknown)_
- **cloud-penetration-testing**: This skill should be used when the user asks to "perform cloud penetration testing", "assess Azure or AWS or GCP security", "enumerate cloud resources", "exploit cloud misconfiguratio... _(risk: unknown)_
- **code-review-checklist**: Comprehensive checklist for conducting thorough code reviews covering functionality, security, performance, and maintainability _(risk: unknown)_
- **codebase-cleanup-deps-audit**: You are a dependency security expert specializing in vulnerability scanning, license compliance, and supply chain security. Analyze project dependencies for known vulnerabilities, licensing issues,... _(risk: unknown)_
- **constant-time-analysis**: Detects timing side-channel vulnerabilities in cryptographic code. Use when implementing or reviewing crypto code, encountering division on secrets, secret-dependent branches, or constant-time programming questions in C, C++, Go, Rust, Swift, Java, Kotlin, C#, PHP,... _(risk: unknown)_
- **dependency-management-deps-audit**: You are a dependency security expert specializing in vulnerability scanning, license compliance, and supply chain security. Analyze project dependencies for known vulnerabilities, licensing issues,... _(risk: unknown)_
- **deployment-pipeline-design**: Design multi-stage CI/CD pipelines with approval gates, security checks, and deployment orchestration. Use when architecting deployment workflows, setting up continuous delivery, or implementing Gi... _(risk: unknown)_
- **devops-troubleshooter**: Expert DevOps troubleshooter specializing in rapid incident response, advanced debugging, and modern observability. _(risk: unknown)_
- **differential-review**: Performs security-focused differential review of code changes (PRs, commits, diffs). Adapts analysis depth to codebase size, uses git history for context, calculates blast radius, checks test coverage, and generates comprehensive markdown reports. Automatically... _(risk: unknown)_
- **ethical-hacking-methodology**: This skill should be used when the user asks to "learn ethical hacking", "understand penetration testing lifecycle", "perform reconnaissance", "conduct security scanning", "exploit ... _(risk: unknown)_
- **ffuf-web-fuzzing**: Expert guidance for ffuf web fuzzing during penetration testing, including authenticated fuzzing with raw requests, auto-calibration, and result analysis _(risk: unknown)_
- **file-path-traversal**: This skill should be used when the user asks to "test for directory traversal", "exploit path traversal vulnerabilities", "read arbitrary files through web applications", "find LFI vu... _(risk: unknown)_
- **find-bugs**: Find bugs, security vulnerabilities, and code quality issues in local branch changes. Use when asked to review changes, find bugs, security review, or audit code on the current branch. _(risk: unknown)_
- **firebase**: Firebase gives you a complete backend in minutes - auth, database, storage, functions, hosting. But the ease of setup hides real complexity. Security rules are your last line of defense, and they'r... _(risk: unknown)_
- **firmware-analyst**: Expert firmware analyst specializing in embedded systems, IoT security, and hardware reverse engineering. _(risk: unknown)_
- **frontend-mobile-security-xss-scan**: You are a frontend security specialist focusing on Cross-Site Scripting (XSS) vulnerability detection and prevention. Analyze React, Vue, Angular, and vanilla JavaScript code to identify injection poi _(risk: unknown)_
- **frontend-security-coder**: Expert in secure frontend coding practices specializing in XSS prevention, output sanitization, and client-side security patterns. _(risk: unknown)_
- **gdpr-data-handling**: Implement GDPR-compliant data handling with consent management, data subject rights, and privacy by design. Use when building systems that process EU personal data, implementing privacy controls, o... _(risk: unknown)_
- **gha-security-review**: GitHub Actions security review for workflow exploitation vulnerabilities. Use when asked to "review GitHub Actions", "audit workflows", "check CI security", "GHA security", "workflow security review", or review .github/workflows/ for pwn requests, expression injection,... _(risk: unknown)_
- **graphql-architect**: Master modern GraphQL with federation, performance optimization, and enterprise security. Build scalable schemas, implement advanced caching, and design real-time systems. _(risk: unknown)_
- **idor-testing**: This skill should be used when the user asks to "test for insecure direct object references," "find IDOR vulnerabilities," "exploit broken access control," "enumerate user IDs or obje... _(risk: unknown)_
- **incident-response-incident-response**: Use when working with incident response incident response _(risk: unknown)_
- **incident-response-smart-fix**: [Extended thinking: This workflow implements a sophisticated debugging and resolution pipeline that leverages AI-assisted debugging tools and observability platforms to systematically diagnose and res _(risk: unknown)_
- **incident-runbook-templates**: Create structured incident response runbooks with step-by-step procedures, escalation paths, and recovery actions. Use when building runbooks, responding to incidents, or establishing incident resp... _(risk: unknown)_
- **k8s-manifest-generator**: Create production-ready Kubernetes manifests for Deployments, Services, ConfigMaps, and Secrets following best practices and security standards. Use when generating Kubernetes YAML manifests, creat... _(risk: unknown)_
- **k8s-security-policies**: Implement Kubernetes security policies including NetworkPolicy, PodSecurityPolicy, and RBAC for production-grade security. Use when securing Kubernetes clusters, implementing network isolation, or ... _(risk: unknown)_
- **laravel-expert**: Senior Laravel Engineer role for production-grade, maintainable, and idiomatic Laravel solutions. Focuses on clean architecture, security, performance, and modern standards (Laravel 10/11+). _(risk: safe)_
- **laravel-security-audit**: Security auditor for Laravel applications. Analyzes code for vulnerabilities, misconfigurations, and insecure practices using OWASP standards and Laravel security best practices. _(risk: safe)_
- **linkerd-patterns**: Implement Linkerd service mesh patterns for lightweight, security-focused service mesh deployments. Use when setting up Linkerd, configuring traffic policies, or implementing zero-trust networking ... _(risk: unknown)_
- **linux-privilege-escalation**: This skill should be used when the user asks to "escalate privileges on Linux", "find privesc vectors on Linux systems", "exploit sudo misconfigurations", "abuse SUID binaries", "ex... _(risk: unknown)_
- **malware-analyst**: Expert malware analyst specializing in defensive malware research, threat intelligence, and incident response. Masters sandbox analysis, behavioral analysis, and malware family identification. _(risk: unknown)_
- **memory-forensics**: Master memory forensics techniques including memory acquisition, process analysis, and artifact extraction using Volatility and related tools. Use when analyzing memory dumps, investigating inciden... _(risk: unknown)_
- **metasploit-framework**: This skill should be used when the user asks to "use Metasploit for penetration testing", "exploit vulnerabilities with msfconsole", "create payloads with msfvenom", "perform post-exp... _(risk: offensive)_
- **mobile-security-coder**: Expert in secure mobile coding practices specializing in input validation, WebView security, and mobile-specific security patterns. _(risk: unknown)_
- **mtls-configuration**: Configure mutual TLS (mTLS) for zero-trust service-to-service communication. Use when implementing zero-trust networking, certificate management, or securing internal service communication. _(risk: unknown)_
- **network-engineer**: Expert network engineer specializing in modern cloud networking, security architectures, and performance optimization. _(risk: unknown)_
- **nodejs-best-practices**: Node.js development principles and decision-making. Framework selection, async patterns, security, and architecture. Teaches thinking, not copying. _(risk: unknown)_
- **observability-engineer**: Build production-ready monitoring, logging, and tracing systems. Implements comprehensive observability strategies, SLI/SLO management, and incident response workflows. _(risk: unknown)_
- **odoo-security-rules**: Expert in Odoo access control: ir.model.access.csv, record rules (ir.rule), groups, and multi-company security patterns. _(risk: safe)_
- **pentest-checklist**: This skill should be used when the user asks to "plan a penetration test", "create a security assessment checklist", "prepare for penetration testing", "define pentest scope", "foll... _(risk: unknown)_
- **pentest-commands**: This skill should be used when the user asks to "run pentest commands", "scan with nmap", "use metasploit exploits", "crack passwords with hydra or john", "scan web vulnerabilities ... _(risk: unknown)_
- **postmortem-writing**: Write effective blameless postmortems with root cause analysis, timelines, and action items. Use when conducting incident reviews, writing postmortem documents, or improving incident response proce... _(risk: unknown)_
- **privilege-escalation-methods**: This skill should be used when the user asks to "escalate privileges", "get root access", "become administrator", "privesc techniques", "abuse sudo", "exploit SUID binaries", "K... _(risk: unknown)_
- **protocol-reverse-engineering**: Master network protocol reverse engineering including packet analysis, protocol dissection, and custom protocol documentation. Use when analyzing network traffic, understanding proprietary protocol... _(risk: unknown)_
- **red-team-tactics**: Red team tactics principles based on MITRE ATT&CK. Attack phases, detection evasion, reporting. _(risk: unknown)_
- **red-team-tools**: This skill should be used when the user asks to "follow red team methodology", "perform bug bounty hunting", "automate reconnaissance", "hunt for XSS vulnerabilities", "enumerate su... _(risk: unknown)_
- **reverse-engineer**: Expert reverse engineer specializing in binary analysis, disassembly, decompilation, and software analysis. Masters IDA Pro, Ghidra, radare2, x64dbg, and modern RE toolchains. _(risk: unknown)_
- **sast-configuration**: Configure Static Application Security Testing (SAST) tools for automated vulnerability detection in application code. Use when setting up security scanning, implementing DevSecOps practices, or aut... _(risk: unknown)_
- **scanning-tools**: This skill should be used when the user asks to "perform vulnerability scanning", "scan networks for open ports", "assess web application security", "scan wireless networks", "detec... _(risk: unknown)_
- **security-auditor**: Expert security auditor specializing in DevSecOps, comprehensive cybersecurity, and compliance frameworks. _(risk: unknown)_
- **security-bluebook-builder**: Create or refine a concise, normative security policy ("Blue Book") for sensitive applications. Use when users need a threat model, data classification rules, auth/session policy, logging and audit requirements, retention/deletion expectations, incident response, or security... _(risk: unknown)_
- **security-compliance-compliance-check**: You are a compliance expert specializing in regulatory requirements for software systems including GDPR, HIPAA, SOC2, PCI-DSS, and other industry standards. Perform compliance audits and provide im... _(risk: unknown)_
- **security-requirement-extraction**: Derive security requirements from threat models and business context. Use when translating threats into actionable requirements, creating security user stories, or building security test cases. _(risk: unknown)_
- **security-scanning-security-dependencies**: You are a security expert specializing in dependency vulnerability analysis, SBOM generation, and supply chain security. Scan project dependencies across ecosystems to identify vulnerabilities, ass... _(risk: unknown)_
- **security-scanning-security-hardening**: Coordinate multi-layer security scanning and hardening across application, infrastructure, and compliance controls. _(risk: unknown)_
- **security-scanning-security-sast**: Static Application Security Testing (SAST) for code vulnerability
analysis across multiple languages and frameworks
 _(risk: unknown)_
- **semgrep-rule-creator**: Creates custom Semgrep rules for detecting security vulnerabilities, bug patterns, and code patterns. Use when writing Semgrep rules or building custom static analysis detections. _(risk: unknown)_
- **seo-forensic-incident-response**: Investigate sudden drops in organic traffic or rankings and run a structured forensic SEO incident response with triage, root-cause analysis and recovery plan. _(risk: safe)_
- **service-mesh-expert**: Expert service mesh architect specializing in Istio, Linkerd, and cloud-native networking patterns. Masters traffic management, security policies, observability integration, and multi-cluster mesh con _(risk: unknown)_
- **shodan-reconnaissance**: This skill should be used when the user asks to "search for exposed devices on the internet," "perform Shodan reconnaissance," "find vulnerable services using Shodan," "scan IP ranges... _(risk: unknown)_
- **skill-scanner**: Scan agent skills for security issues. Use when asked to "scan a skill", "audit a skill", "review skill security", "check skill for injection", "validate SKILL.md", or assess whether an agent skill is safe to install. Checks for prompt injection, malicious scripts,... _(risk: unknown)_
- **smtp-penetration-testing**: This skill should be used when the user asks to "perform SMTP penetration testing", "enumerate email users", "test for open mail relays", "grab SMTP banners", "brute force email cre... _(risk: unknown)_
- **solidity-security**: Master smart contract security best practices to prevent common vulnerabilities and implement secure Solidity patterns. Use when writing smart contracts, auditing existing contracts, or implementin... _(risk: unknown)_
- **sql-injection-testing**: This skill should be used when the user asks to "test for SQL injection vulnerabilities", "perform SQLi attacks", "bypass authentication using SQL injection", "extract database inform... _(risk: unknown)_
- **ssh-penetration-testing**: This skill should be used when the user asks to "pentest SSH services", "enumerate SSH configurations", "brute force SSH credentials", "exploit SSH vulnerabilities", "perform SSH tu... _(risk: unknown)_
- **stride-analysis-patterns**: Apply STRIDE methodology to systematically identify threats. Use when analyzing system security, conducting threat modeling sessions, or creating security documentation. _(risk: unknown)_
- **supply-chain-risk-auditor**: Identifies dependencies at heightened risk of exploitation or takeover. Use when assessing supply chain attack surface, evaluating dependency health, or scoping security engagements. _(risk: unknown)_
- **threat-mitigation-mapping**: Map identified threats to appropriate security controls and mitigations. Use when prioritizing security investments, creating remediation plans, or validating control effectiveness. _(risk: unknown)_
- **threat-modeling-expert**: Expert in threat modeling methodologies, security architecture review, and risk assessment. Masters STRIDE, PASTA, attack trees, and security requirement extraction. Use for security architecture r... _(risk: unknown)_
- **top-web-vulnerabilities**: This skill should be used when the user asks to "identify web application vulnerabilities", "explain common security flaws", "understand vulnerability categories", "learn about inject... _(risk: unknown)_
- **variant-analysis**: Find similar vulnerabilities and bugs across codebases using pattern-based analysis. Use when hunting bug variants, building CodeQL/Semgrep queries, analyzing security vulnerabilities, or performing systematic code audits after finding an initial issue. _(risk: unknown)_
- **vulnerability-scanner**: Advanced vulnerability analysis principles. OWASP 2025, Supply Chain Security, attack surface mapping, risk prioritization. _(risk: unknown)_
- **windows-privilege-escalation**: This skill should be used when the user asks to "escalate privileges on Windows," "find Windows privesc vectors," "enumerate Windows for privilege escalation," "exploit Windows miscon... _(risk: unknown)_
- **wordpress-penetration-testing**: This skill should be used when the user asks to "pentest WordPress sites", "scan WordPress for vulnerabilities", "enumerate WordPress users, themes, or plugins", "exploit WordPress vu... _(risk: unknown)_
- **xss-html-injection**: This skill should be used when the user asks to "test for XSS vulnerabilities", "perform cross-site scripting attacks", "identify HTML injection flaws", "exploit client-side injection... _(risk: unknown)_
- **access-review**: Conduct periodic access reviews and certifications. Implement access governance and recertification workflows. Use when managing access compliance. _(risk: critical)_
- **agy-auto**: Configure agy-auto PreToolUse security gate to run Antigravity CLI (agy) unattended with layered policy controls instead of --dangerously-skip-permissions. _(risk: critical)_
- **ai-agent-security**: Secure AI agents against prompt injection, tool abuse, and data exfiltration with defense-in-depth controls. _(risk: safe)_
- **ai-coding-agent-guardrails**: Secure AI coding agents (Claude Code, Cursor, Codex, Copilot) with permission boundaries, secret protection, code review gates, and safe sandbox configurations for team environments. _(risk: critical)_
- **ai-red-teaming**: Run structured AI red team exercises for jailbreak resistance, data exfiltration risk, harmful output controls, and agent tool abuse resilience. _(risk: offensive)_
- **ai-security-hardening**: Harden AI/LLM deployments against prompt injection, data exfiltration, model theft, and supply chain attacks. _(risk: safe)_
- **akf-trust-metadata**: The AI native file format. EXIF for AI — stamps every file with trust scores, source provenance, and compliance metadata. Embeds into 20+ formats (DOCX, PDF, images, code). EU AI Act, SOX, HIPAA auditing. _(risk: critical)_
- **apk-redteam-pipeline**: End-to-end Android APK red-team pipeline _(risk: offensive)_
- **apk-reverse**: Android APK reverse engineering: unpacking, Java decompilation, smali modification, repacking and signing, Frida dynamic hooking, and native .so analysis with jadx, apktool, adb, and related tools. _(risk: offensive)_
- **asset-inventory**: Maintain IT asset inventory and configuration management database. Track hardware, software, and cloud resources. Use when managing IT assets. _(risk: critical)_
- **attack-chain**: Authorized multi-stage attack-path planning and orchestration spanning reconnaissance, initial access, privilege escalation, lateral movement, and reporting. Entry point for full engagements and cross-phase operations. _(risk: offensive)_
- **audit-logging**: Implement centralized audit logging and SIEM integration. Configure log retention and security monitoring. Use when implementing audit trail requirements. _(risk: safe)_
- **aws-cloudtrail**: Configure AWS CloudTrail for audit logging. Set up organization trails and event analysis. Use when auditing AWS activity. _(risk: safe)_
- **aws-secrets-manager**: Store and rotate secrets in AWS Secrets Manager. _(risk: critical)_
- **azure-keyvault**: Manage secrets and certificates in Azure Key Vault. Configure access policies, integrate with Azure services, and implement secure secret management. Use when managing secrets in Azure environments. _(risk: critical)_
- **azure-monitor-audit**: Configure Azure Monitor and Activity Log for auditing. Set up diagnostic settings and log analytics. Use when auditing Azure activity. _(risk: safe)_
- **bb-methodology**: Use at the START of any bug bounty hunting session, when switching targets, or when feeling lost about what to do next. _(risk: offensive)_
- **binary-diff**: Cross-version binary symbol migration: diff updated binaries, recover function names without PDBs, and propagate annotations after software updates using BinDiff-style tooling. _(risk: safe)_
- **bug-bounty**: Complete bug bounty workflow _(risk: offensive)_
- **bugcrowd-reporting**: Bugcrowd-specific reporting tactics complementing report-writing _(risk: safe)_
- **bumblebee**: Run Bumblebee supply-chain inventory and exposure scans on macOS/Linux to detect compromised packages, extensions, and MCP host configs. _(risk: safe)_
- **business-continuity**: Develop business continuity plans and impact analysis. Implement BCP testing and communication procedures. Use when building organizational resilience. _(risk: safe)_
- **case-review**: Quality-gate review of a reverse-engineering or assessment case package: scope readiness, Evidence-to-Finding-to-Path traceability, work-item coverage, timeline consistency, and artifact hashes. _(risk: safe)_
- **change-management**: Implement change management processes. Configure CAB reviews, change windows, and rollback procedures. Use when managing production changes. _(risk: safe)_
- **cis-benchmarks**: Audit and remediate CIS benchmark violations. _(risk: critical)_
- **client-secret-exposure-audit**: Audit a deployed web app for secrets exposed to the browser: hardcoded API keys/tokens in JS, secrets in HTML meta/attributes/comments, publicly reachable source/config/deploy files, and header/CORS misconfig. _(risk: critical)_
- **cloud-iam-deep**: Cloud IAM red-team attack chain across AWS, Azure, GCP _(risk: offensive)_
- **cloud-k8s**: Authorized cloud, container, and Kubernetes security assessment: metadata SSRF, IAM misconfiguration, container escape paths, and cluster RBAC review. _(risk: offensive)_
- **cloudflare-security-audit**: Audit authorized codebases for exploitable vulnerabilities using scoped reconnaissance, adversarial review, validation, and structured reporting. _(risk: offensive)_
- **container-hardening**: Secure Docker images and container runtime configurations. _(risk: critical)_
- **container-scanning**: Scan container images for vulnerabilities using Trivy, Grype, and cloud-native tools. _(risk: critical)_
- **container-security-hardening**: Harden Docker/container images and runtime deployments with secure base images, non-root users, CVE scanning, SBOM/signing, seccomp/AppArmor, and Kubernetes pod security controls. Use for Dockerfile security reviews, container CVEs, image scanning, distroless images, or production hardening.
 _(risk: critical)_
- **cyber-audit**: Run read-only exposure checks for security advisories and write a structured local audit report. _(risk: safe)_
- **darkmoon-pentest**: Start, follow and triage authorized autonomous AI pentest runs on a self-hosted Darkmoon Pro instance through its MCP server. _(risk: offensive)_
- **dast-scanning**: Perform dynamic application security testing with OWASP ZAP, Burp Suite, and Nikto. _(risk: offensive)_
- **dependency-scanning**: Scan package dependencies for known vulnerabilities using Snyk, Dependabot, and OWASP Dependency-Check. _(risk: safe)_
- **digital-forensics**: Authorized digital forensics: memory dumps, disk timelines, PCAP investigation, artifact triage, and incident-response evidence preservation. _(risk: safe)_
- **disaster-recovery**: Implement disaster recovery strategies and runbooks. Configure RPO/RTO targets and failover procedures. Use when planning for business continuity. _(risk: critical)_
- **doomsday-escrow**: Verify cryptographic Proof-of-Escrow collateral (L1 UTXO outpoint proofs and Base Mainnet wDOOM settlement receipts) on GitHub bounties before spending autonomous agent compute. _(risk: critical)_
- **dotnet-reverse**: .NET/C# binary reverse engineering: managed PE analysis, dnSpyEx debugging, de4dot deobfuscation (ConfuserEx/SmartAssembly/Babel), IL patching, NativeAOT targets, and analysis of red-team Sharp* tooling. _(risk: offensive)_
- **edr-bypass-re**: Review EDR telemetry and known defense-evasion classes using offline evidence and controlled defensive coverage assessments. _(risk: offensive)_
- **email-security**: Authorized email security review: phishing analysis, SPF/DKIM/DMARC header authentication, BEC pattern investigation, and mailbox token abuse research. _(risk: offensive)_
- **enterprise-vpn-attack**: External SSL VPN / remote-access appliance attack matrix _(risk: offensive)_
- **evidence-hygiene**: Evidence-capture and PoC-redaction discipline for bug-bounty submissions _(risk: safe)_
- **fedramp-compliance**: Implement FedRAMP requirements for federal cloud services. Configure NIST 800-53 controls and continuous monitoring. Use when providing cloud services to US federal agencies. _(risk: safe)_
- **firewall-config**: Configure iptables, nftables, and cloud firewalls. Implement network segmentation and traffic filtering. Use when securing network perimeters or implementing security zones. _(risk: critical)_
- **firmware-pentest**: Firmware penetration testing following the OWASP FSTM nine-stage flow: extraction, EMBA automation, Firmadyne/QEMU emulation, AFL++ fuzzing, and hands-on exploitation in authorized labs. _(risk: offensive)_
- **fsi-compliance-checker**: Maps code, architecture, and infrastructure changes to specific control IDs in PCI-DSS v4.0.1 and MAS TRM (Singapore financial regulator), producing an audit-traceable findings report with per-control remediation. _(risk: critical)_
- **gcp-audit-logs**: Configure GCP Cloud Audit Logs for compliance. Set up log routing and BigQuery analysis. Use when auditing GCP activity. _(risk: critical)_
- **gcp-secret-manager**: Secure secrets in Google Cloud Secret Manager. Configure IAM policies, integrate with GKE, and manage secret versions. Use when managing secrets in GCP environments. _(risk: critical)_
- **gdpr-compliance**: Implement GDPR data protection requirements. Configure consent management, data subject rights, and privacy by design. Use when processing EU personal data. _(risk: critical)_
- **ghidra-reverse**: Free/open reverse engineering with Ghidra (headless or GUI): decompilation, cross-references, scripting, and optional Ghidra MCP workflows when IDA is unavailable. _(risk: safe)_
- **hardware-security**: Authorized hardware and embedded interface security research: UART/JTAG discovery, debug-pad triage, secure-boot overview, and offline firmware analysis. _(risk: offensive)_
- **hashicorp-vault**: Manage secrets and PKI with HashiCorp Vault. _(risk: critical)_
- **hipaa-compliance**: Implement HIPAA security and privacy rules. Configure PHI protections and BAA requirements. Use when handling healthcare data. _(risk: critical)_
- **hunt-api-misconfig**: Hunt API security misconfiguration _(risk: offensive)_
- **hunt-aspnet**: Hunt ASP.NET-specific surface _(risk: offensive)_
- **hunt-ato**: Hunt account takeover taxonomy _(risk: offensive)_
- **hunt-auth-bypass**: Hunting skill for auth bypass vulnerabilities. _(risk: offensive)_
- **hunt-brute-force**: Hunt Missing/Weak Rate Limiting _(risk: offensive)_
- **hunt-business-logic**: Hunting skill for business logic vulnerabilities. _(risk: offensive)_
- **hunt-cache-poison**: Hunting skill for cache poison vulnerabilities. _(risk: offensive)_
- **hunt-captcha-bypass**: Hunt CAPTCHA Bypass _(risk: offensive)_
- **hunt-cicd**: Hunt CI/CD pipeline vulnerabilities _(risk: offensive)_
- **hunt-clickjacking**: Hunt Clickjacking _(risk: offensive)_
- **hunt-cloud-misconfig**: Hunt cloud / infrastructure misconfigurations. _(risk: offensive)_
- **hunt-cors**: Hunt CORS Misconfiguration _(risk: offensive)_
- **hunt-csrf**: Hunting skill for csrf vulnerabilities. _(risk: offensive)_
- **hunt-deserialization**: Hunt Insecure Deserialization _(risk: offensive)_
- **hunt-dispatch**: Skill-set loader for /hunt orchestrator. _(risk: offensive)_
- **hunt-dom**: Hunt client-side DOM vulnerabilities _(risk: offensive)_
- **hunt-exceptional-conditions**: Hunt mishandling of exceptional conditions _(risk: offensive)_
- **hunt-file-upload**: Hunt file upload bugs _(risk: offensive)_
- **hunt-fintech-graphql**: Hunt fintech-specific GraphQL vulnerabilities _(risk: offensive)_
- **hunt-forgot-password**: Hunt Forgot Password / Account Recovery Authentication Flaws _(risk: offensive)_
- **hunt-graphql**: Hunting skill for graphql vulnerabilities. _(risk: offensive)_
- **hunt-grpc**: Hunt gRPC vulnerabilities _(risk: offensive)_
- **hunt-host-header**: Hunt Host Header Injection _(risk: offensive)_
- **hunt-html-injection**: Hunt HTML Injection _(risk: offensive)_
- **hunt-http-smuggling**: Hunt HTTP request smuggling (CL.TE, TE.CL, H2.CL, H2.TE). _(risk: offensive)_
- **hunt-idor**: Hunting skill for idor vulnerabilities. Built from 26 public bug bounty reports. Use when hunting idor on any target. _(risk: offensive)_
- **hunt-jwt-crypto**: Hunt JWT cryptographic failures _(risk: offensive)_
- **hunt-k8s**: Hunt Kubernetes & Docker _(risk: offensive)_
- **hunt-laravel**: Hunt Laravel specific vulnerabilities _(risk: offensive)_
- **hunt-ldap**: Hunt LDAP Injection and XPath Injection _(risk: offensive)_
- **hunt-lfi**: Hunt Local File Inclusion (LFI), Remote File Inclusion (RFI), and Path Traversal _(risk: offensive)_
- **hunt-llm-ai**: Hunt LLM/AI feature bugs _(risk: offensive)_
- **hunt-mfa-bypass**: Hunt MFA / 2FA bypass _(risk: offensive)_
- **hunt-misc**: Hunting skill for misc vulnerabilities. Reference for authorized role, token and workflow-boundary reviews. Historical source count is not independently verified. _(risk: offensive)_
- **hunt-nextjs**: Hunt Next.js specific vulnerabilities _(risk: offensive)_
- **hunt-nodejs**: Hunt Node.js specific vulnerabilities _(risk: offensive)_
- **hunt-nosqli**: Hunt NoSQL Injection _(risk: offensive)_
- **hunt-ntlm-info**: Hunt NTLM/Negotiate information disclosure on internet-reachable IIS/SharePoint/Exchange. _(risk: offensive)_
- **hunt-oauth**: Hunting skill for oauth vulnerabilities. Built from 19 public bug bounty reports. Use when hunting oauth on any target. _(risk: offensive)_
- **hunt-open-redirect**: Hunt Open Redirect _(risk: offensive)_
- **hunt-race-condition**: Hunting skill for race condition vulnerabilities. _(risk: offensive)_
- **hunt-rag-vector**: Hunt vector-store / embedding-layer weaknesses in RAG pipelines (OWASP LLM08 Vector and Embedding Weaknesses) _(risk: offensive)_
- **hunt-rce**: Hunting skill for rce vulnerabilities. Built from 67 public bug bounty reports. Use when hunting rce on any target. _(risk: offensive)_
- **hunt-saml**: Hunt SAML / SSO attacks. _(risk: offensive)_
- **hunt-session**: Hunt Session Management vulnerabilities _(risk: offensive)_
- **hunt-shadow-api**: Hunt shadow / zombie / undocumented API surface (OWASP API9 Improper Inventory Management) _(risk: offensive)_
- **hunt-sharepoint**: Hunt Microsoft SharePoint Server (2013/2016/2019/Subscription Edition) on-prem farms _(risk: offensive)_
- **hunt-source-leak**: Hunt source code and build artifact leakage _(risk: offensive)_
- **hunt-spa-api**: Discover a single-page-app's hidden backend API from its public JS bundle, then test that API for broken access control / missing authentication. _(risk: offensive)_
- **hunt-springboot**: Hunt Spring Boot specific vulnerabilities _(risk: offensive)_
- **hunt-sqli**: Hunting skill for sqli vulnerabilities. _(risk: offensive)_
- **hunt-ssrf**: Hunting skill for ssrf vulnerabilities. _(risk: offensive)_
- **hunt-ssti**: Hunt server-side template injection (SSTI) across Jinja2 (Flask/Django), Twig (Symfony), Freemarker (Java), ERB (Rails), Spring, Velocity, Mako, Thymeleaf, Smarty. _(risk: offensive)_
- **hunt-subdomain**: Hunting skill for subdomain takeover vulnerabilities. _(risk: offensive)_
- **hunt-tls-network**: Hunt TLS/SSL and DNS misconfigurations _(risk: offensive)_
- **hunt-websocket**: Hunt WebSocket vulnerabilities _(risk: offensive)_
- **hunt-xss**: Hunting skill for xss vulnerabilities. _(risk: offensive)_
- **hunt-xxe**: Hunting skill for xxe vulnerabilities. _(risk: offensive)_
- **ida-reverse**: Reverse engineer binaries with IDA Pro: decompilation, disassembly, data-flow tracking, cross-references, and IDA MCP automation for deep static analysis of PE/ELF/Mach-O targets. _(risk: critical)_
- **identity-federation**: Authorized assessment of federated identity systems: SAML, OIDC, OAuth2 flows, SSO misconfiguration, and token-confusion issues. _(risk: offensive)_
- **incident-management**: Implement incident management processes and escalation procedures. Configure on-call schedules and post-incident reviews. Use when managing production incidents. _(risk: safe)_
- **incident-response**: Handle security incidents with IR playbooks and procedures. _(risk: critical)_
- **infinity**: Enforces a strict input boundary protocol (detect, classify, filter, verify) to ensure untrusted data never reaches business logic raw. _(risk: safe)_
- **ios-redteam-pipeline**: End-to-end iOS red-team pipeline _(risk: offensive)_
- **iso27001-compliance**: Implement ISO 27001 Information Security Management System. Configure ISMS controls and risk management. Use when implementing enterprise security frameworks. _(risk: safe)_
- **js-reverse**: Front-end JavaScript reverse engineering: locate signature chains, analyze encrypted request parameters, sample runtime behavior, and reproduce logic locally in Node for evidence-based output. _(risk: offensive)_
- **kubernetes-hardening**: Implement Kubernetes security contexts, Pod Security Standards, and network policies. _(risk: critical)_
- **launch-check**: Bounded pre-launch audit of a live URL for AI-built apps: exposed secret keys, open Supabase/Firebase tables, security headers, phone layout, search and speed. _(risk: critical)_
- **linux-hardening**: Apply CIS benchmarks and secure Linux servers. _(risk: critical)_
- **llm-app-security**: Secure LLM-powered applications with input validation, output controls, tenant isolation, and abuse prevention. _(risk: critical)_
- **m365-entra-attack**: Microsoft 365 / Entra ID red-team attack chain _(risk: offensive)_
- **macos-reverse**: Authorized macOS and Mach-O reverse engineering: codesign inspection, Objective-C/Swift recovery, endpoint-security surfaces, and Apple-platform malware analysis. _(risk: safe)_
- **malware-analysis**: Analyze suspected malware through static, dynamic, and behavioral techniques: IOC extraction, YARA/Sigma rule authoring, sandbox orchestration, and anti-analysis detection. _(risk: critical)_
- **marketplace-rbac-audit**: Audit multi-role marketplace authorization across roles, resource ownership, tenant boundaries, and order-state transitions; use when access rules need evidence, not UI assumptions. _(risk: safe)_
- **mcp-dependency-drift-audit**: Statically audit MCP configs for mutable npm/npx package references before approval or CI, without executing discovered MCP servers. _(risk: safe)_
- **mcp-server-security**: Secure Model Context Protocol (MCP) servers with transport encryption, tool authorization, input validation, and audit logging for safe AI agent integrations. _(risk: safe)_
- **meme-coin-audit**: Meme coin and token security audit _(risk: offensive)_
- **mid-engagement-ir-detection**: Methodology for detecting client SOC patches, attacker activity, and security-state changes that occur DURING a red-team engagement _(risk: offensive)_
- **model-supply-chain-security**: Secure the AI model supply chain with artifact signing, provenance attestation, SBOM workflows, dependency controls, and trusted model promotion. _(risk: critical)_
- **netapi**: Check domains and IPs against a free compromised feed, find newly registered lookalike domains, and get TLD stats and Top 1M ranks from NetAPI, with no API key. _(risk: safe)_
- **offensive-osint**: Operational arsenal for authorized external red-team and bug-bounty recon. _(risk: offensive)_
- **okta-attack**: Okta-as-IdP red-team attack chain _(risk: offensive)_
- **openclaw-deployment-hardening**: Secure OpenClaw deployments with preflight hardening checks, CI/CD guardrails, container runtime restrictions, and post-deploy verification. _(risk: critical)_
- **osint-methodology**: Comprehensive OSINT methodology for external red-team operations and authorized attack-surface assessments. _(risk: offensive)_
- **ot-ics**: Authorized OT/ICS security assessment: Purdue-model zoning review, PLC/SCADA exposure, industrial protocol discovery, and passive-first evaluation discipline. _(risk: offensive)_
- **patch-diff-exploit**: Locate vulnerability fixes in vendor patches, diff binaries across versions, and build N-day PoCs. Attack-side complement to binary-diff for authorized research. _(risk: offensive)_
- **pci-dss-compliance**: Implement PCI DSS requirements for payment card data. Configure cardholder data environment and security controls. Use when processing payment cards. _(risk: critical)_
- **penetration-testing**: Perform basic penetration testing and security assessments. _(risk: offensive)_
- **pentest-tools**: Operate 20+ penetration-testing tools (Nmap, Nuclei, SQLMap, FFUF, Hashcat, and more) through structured workflows with consistent output handling. _(risk: offensive)_
- **permission-manager**: Manage opencode permissions: review always-allow lists, suggest safe read-only commands, configure permission patterns _(risk: critical)_
- **policy-as-code**: Implement policy as code with OPA, Sentinel, and Kyverno. Automate policy enforcement in CI/CD and infrastructure. Use when enforcing compliance through automation. _(risk: critical)_
- **privacy-mask**: Mask, redact, anonymize and censor sensitive information (PII) in screenshots and images — phone numbers, emails, IDs, API keys, crypto wallets, credit cards, passwords, and more. _(risk: critical)_
- **production-audit**: Audit a shipped repo for production-readiness gaps across RLS, webhooks, secrets, grants, Stripe idempotency, mobile UX, and deployment health. _(risk: critical)_
- **prompt-injection-defense**: Defend AI systems against prompt injection and indirect prompt attacks using input controls, tool permissions, output validation, and isolation boundaries. _(risk: safe)_
- **protocol-reverse**: Authorized reverse engineering of custom binary protocols, Protobuf/gRPC schemas, WebSocket frames, and PCAP-driven protocol recovery. _(risk: safe)_
- **pwn-chain**: Go from reverse engineering to a working exploit: stack/heap/kernel pwn workflows with pwntools, libc-database, ROP, and stabilization from CTF to authorized remote targets. _(risk: offensive)_
- **radare2**: Drive the radare2 CLI for binary reconnaissance, disassembly, analysis, function locating, export, and lightweight patching (r2/rabin2/rasm2/radiff2) without a GUI. _(risk: critical)_
- **radio-sdr**: Authorized RF/SDR security research: signal identification, replay-feasibility study in shielded labs, and wireless protocol analysis within applicable spectrum and authorization constraints. _(risk: offensive)_
- **recon-scope-triage**: Triage ASM/recon output for ownership before testing _(risk: offensive)_
- **redteam-mindset**: Red-team operator discipline _(risk: offensive)_
- **redteam-report-template**: Client-facing red-team deliverable format _(risk: safe)_
- **report-writing**: Bug bounty report writing for H1/Bugcrowd/Intigriti/Immunefi _(risk: safe)_
- **reverse-engineering**: General reverse-engineering methodology for compiled, obfuscated, packed, or virtualized targets: GDB, Frida, angr, Unicorn, and Qiling workflows across languages and platforms, with anti-analysis countermeasures. _(risk: critical)_
- **runbook-creation**: Create operational runbooks and standard operating procedures. Document troubleshooting guides and recovery procedures. Use when documenting operational knowledge. _(risk: safe)_
- **sast-scanning**: Perform static application security testing with tools like Semgrep, CodeQL, and SonarQube. _(risk: safe)_
- **sbom-supply-chain**: Generate, sign, and verify SBOMs and provenance attestations to secure the software supply chain. Use when implementing SLSA controls, artifact trust policies, or compliance evidence for releases. _(risk: critical)_
- **security-and-hardening**: Hardens code against vulnerabilities. Use when handling user input, authentication, data storage, or external integrations. Use when building any feature that accepts untrusted data, manages user sessions, or interacts with third-party services. _(risk: critical)_
- **security-arsenal**: Security payloads, bypass tables, wordlists, gf pattern names, always-rejected bug list, and conditionally-valid-with-chain table. _(risk: offensive)_
- **security-automation**: Automate security workflows and remediation. Build security pipelines, automate compliance checks, and implement SOAR capabilities. Use when scaling security operations or implementing DevSecOps. _(risk: critical)_
- **skill-audit**: Pre-install review framework for AI agent skills: inspect complete content, permissions, dependencies and suspicious behavior before activation. _(risk: safe)_
- **skill-security-audit**: Audit an Agent Skill, MCP server, connector, or desktop extension before installation by tracing code, dependencies, permissions, credentials, data flow, and irreversible actions. _(risk: safe)_
- **soc2-compliance**: Implement SOC 2 Trust Services Criteria. Configure security, availability, and processing integrity controls. Use when preparing for a SOC 2 examination. _(risk: safe)_
- **sops-encryption**: Encrypt files and configs with Mozilla SOPS. _(risk: critical)_
- **ssl-tls-management**: Manage SSL/TLS certificates with Let's Encrypt and internal PKI. Configure secure HTTPS, certificate renewal, and cipher suites. Use when implementing secure communications. _(risk: critical)_
- **supply-chain-attack-recon**: Authorized read-only review of public software supply-chain exposure _(risk: offensive)_
- **supply-chain-attack-response**: Detect, respond to, and prevent software supply chain attacks on package registries, container images, and CI/CD pipelines with lockfile auditing, provenance verification _(risk: offensive)_
- **supply-chain-security**: Software supply-chain security assessment: SBOM generation, SCA scanning, CI/CD pipeline review, container image audit, build integrity, dependency provenance, and vulnerability reachability verification. _(risk: safe)_
- **thick-client**: Authorized security testing of desktop thick clients: local storage, update channels, IPC, traffic interception, and client-side trust-boundary review. _(risk: offensive)_
- **threat-hunting**: Blue-team threat hunting: detection engineering with Sigma/YARA, SIEM query design, and validation of incident detections against known technique patterns. _(risk: safe)_
- **threat-intelligence**: Authorized OSINT and cyber threat intelligence: enriching IOCs, campaigns, impersonation, scams, and threat-actor profiles from public sources with defined boundaries. _(risk: safe)_
- **threat-modeling**: Conduct threat modeling using STRIDE methodology. Identify threats, assess risks, and design security controls. Use when designing secure systems or assessing application security. _(risk: critical)_
- **triage-validation**: Finding validation before writing any report _(risk: offensive)_
- **vendor-management**: Implement vendor risk management programs. Assess third-party security and maintain vendor inventory. Use when managing supplier security. _(risk: safe)_
- **vmware-vcenter-attack**: VMware vSphere / vCenter Server external attack matrix _(risk: offensive)_
- **vpn-setup**: Configure WireGuard, OpenVPN, and cloud VPNs. Implement secure remote access and site-to-site connectivity. Use when setting up secure network tunnels. _(risk: critical)_
- **vulnerability-scanning**: Scan systems and dependencies for CVEs and security vulnerabilities. _(risk: offensive)_
- **waf-setup**: Deploy and tune Web Application Firewalls. Configure rules for OWASP Top 10 protection. Use when protecting web applications from common attacks. _(risk: critical)_
- **web2-recon**: Web2 recon pipeline _(risk: offensive)_
- **web3-audit**: Smart contract security audit _(risk: offensive)_
- **wifi-wireless**: Authorized wireless security assessment: Wi-Fi capture, WPA handshake analysis, rogue AP detection research, and lab-only deauthentication testing. _(risk: offensive)_
- **windows-ad**: Authorized Active Directory and Windows identity attacks: Kerberos abuse, AD CS escalation, BloodHound path analysis, NTLM relay, and domain privilege-escalation research. _(risk: offensive)_
- **windows-hardening**: Harden Windows servers per security baselines and CIS benchmarks. Configure Group Policy, Windows Defender, and security features. Use when securing Windows Server environments. _(risk: critical)_
- **zero-trust**: Implement zero-trust network architecture. Configure identity-based access, micro-segmentation, and continuous verification. Use when implementing modern security architectures. _(risk: critical)_

## seo

- **altorank**: Run AltoRank through its hosted MCP server: readiness audits, Search Console, keyword research, and SEO drafts into a review queue. _(risk: safe)_
- **geo-audit**: Full website GEO+SEO audit with parallel subagent delegation. _(risk: safe)_
- **geo-brand-mentions**: Brand mention and authority scanner for AI visibility. _(risk: safe)_
- **geo-citability**: AI citability scoring and optimization. _(risk: safe)_
- **geo-compare**: Monthly delta tracking and progress reporting for GEO clients. _(risk: safe)_
- **geo-content**: Content quality and E-E-A-T assessment for AI citability — evaluate experience, expertise, authoritativeness, trustworthiness, and content structure _(risk: safe)_
- **geo-crawlers**: AI crawler access analysis. _(risk: safe)_
- **geo-llmstxt**: Analyzes and generates llms.txt files -- a proposed convention for helping AI systems understand website structure and content. _(risk: safe)_
- **geo-platform-optimizer**: Platform-specific AI search optimization — audit and optimize for Google AI Overviews, ChatGPT, Perplexity, Gemini, and Bing Copilot individually _(risk: safe)_
- **geo-proposal**: Auto-generate a professional, client-ready GEO service proposal from audit data. _(risk: safe)_
- **geo-prospect**: CRM-lite for managing GEO agency prospects and clients. _(risk: safe)_
- **geo-report**: Generate a professional, client-facing GEO report combining all audit results into a single deliverable with scores, findings, and prioritized actions _(risk: safe)_
- **geo-report-pdf**: Generate a professional PDF report from a GEO audit using pandoc + Chrome headless. _(risk: critical)_
- **geo-schema**: Schema.org structured data audit and generation optimized for AI discoverability — detect, validate, and generate JSON-LD markup _(risk: safe)_
- **geo-technical**: Technical SEO audit with GEO-specific checks — crawlability, indexability, security, performance, SSR, and AI crawler access _(risk: safe)_
- **lognorm**: Work a site's SEO and AI-visibility (GEO) backlog through the hosted LogNorm MCP server: audits, fixes, content, AI-answer tracking. _(risk: critical)_
- **nextjs-seo-indexing**: Fix SEO indexing issues, crawl budget problems, and Search Console coverage errors for Next.js apps. Covers canonical tags, noindex audits, sitemap health, static rendering, and internal linking. _(risk: safe)_
- **schema-markup-generator**: Generate and implement JSON-LD structured data for web apps, blogs, FAQs, and SaaS sites. Supports WebSite, SoftwareApplication, BlogPosting, FAQPage, HowTo, and more. _(risk: safe)_
- **seo-aeo-internal-linking**: Maps internal link opportunities between pages with relevant anchor text, placement instructions, orphan-page detection, and cannibalisation checks. _(risk: safe)_
- **seo-aeo-landing-page-writer**: Writes or improves conversion-focused landing pages for products, services, and offers with practical SEO and AEO structure. _(risk: safe)_
- **seo-aeo-meta-description-generator**: Writes title tags, meta descriptions, Open Graph tags, and Twitter Card tags aligned to page intent and conversion goals. _(risk: safe)_
- **seo-aeo-orchestrator**: Runs an audit-first SEO/AEO growth workflow from project discovery through implementation, foundational content, measurement setup, deployment verification, and optional weekly monitoring. _(risk: critical)_
- **seo-aeo-schema-generator**: Generates and validates implementation-ready JSON-LD structured data for relevant page types and rich-result eligibility. _(risk: safe)_
- **seo-competitor-pages**: Generate SEO-optimized competitor comparison and alternatives pages. Covers "X vs Y" layouts, "alternatives to X" pages, feature matrices, schema markup, and conversion optimization. Use when user says "comparison page", "vs page", "alternatives page", "competitor comparison", or "X vs Y".
 _(risk: critical)_
- **seo-dataforseo**: Use DataForSEO for live SERPs, keyword metrics, backlinks, competitor analysis, on-page checks, and AI visibility data. Trigger when the user needs real SEO data rather than static guidance. _(risk: critical)_
- **seo-geo**: Optimize content for AI Overviews, ChatGPT, Perplexity, and other AI search systems. Use when improving GEO, AI citations, llms.txt readiness, crawler accessibility, and passage-level citability. _(risk: critical)_
- **seo-hreflang**: Hreflang and international SEO audit, validation, and generation. Detects common mistakes, validates language/region codes, and generates correct hreflang implementations. Use when user says "hreflang", "i18n SEO", "international SEO", "multi-language", "multi-region", or "language tags".
 _(risk: critical)_
- **seo-images**: Image optimization analysis for SEO and performance. Checks alt text, file sizes, formats, responsive images, lazy loading, and CLS prevention. Use when user says "image optimization", "alt text", "image SEO", "image size", or "image audit".
 _(risk: safe)_
- **seo-page**: Deep single-page SEO analysis covering on-page elements, content quality, technical meta tags, schema, images, and performance. Use when user says "analyze this page", "check page SEO", or provides a single URL for review.
 _(risk: safe)_
- **seo-programmatic**: Plan and audit programmatic SEO pages generated at scale from structured data. Use when designing templates, URL systems, internal linking, quality gates, and index-bloat safeguards for pages at scale. _(risk: critical)_
- **seo-schema**: Detect, validate, and generate Schema.org structured data. JSON-LD format preferred. Use when user says "schema", "structured data", "rich results", "JSON-LD", or "markup".
 _(risk: critical)_
- **seo-sitemap**: Analyze existing XML sitemaps or generate new ones with industry templates. Validates format, URLs, and structure. Use when user says "sitemap", "generate sitemap", "sitemap issues", or "XML sitemap".
 _(risk: critical)_
- **social-metadata-hardening**: Fix social sharing previews so URLs render as rich cards on Facebook, LinkedIn, X/Twitter, WhatsApp, Telegram, and more. Covers OG tags, Twitter cards, absolute image URLs, and debugging. _(risk: safe)_
- **tools-page-seo-optimizer**: Framework-agnostic SEO workflow for any site with multiple tool, product, or feature pages. Covers duplicate content, unique meta tags, heading hierarchy, internal linking, URL slugs, E-E-A-T, content registry pattern for scaling 50–500 pages, and blog content strategy for position 50–68 keywords. _(risk: safe)_

## seo performance

- **bounce-rate-estimator**: Bounce Rate Estimator. Use when working with sessions and bounced sessions, or sessions and engaged sessions with metric definition. _(risk: safe)_
- **ctr-predictor**: CTR Predictor. Use when working with impressions and an explicitly supplied CTR assumption or historical benchmark. _(risk: safe)_
- **impression-to-click-ratio-calculator**: Impression-to-Click Ratio Calculator. Use when working with clicks and impressions for the same scope. _(risk: safe)_
- **keyword-roi-calculator**: Keyword ROI Calculator. Use when working with traffic estimate, conversion rate, value per conversion, margin and SEO cost for one period. _(risk: safe)_
- **organic-growth-forecast-tool**: Organic Growth Forecast Tool. Use when working with dated traffic history or baseline with explicit growth assumptions. _(risk: safe)_
- **ranking-progress-tracker**: Ranking Progress Tracker. Use when working with dated keyword positions with engine, market and device. _(risk: safe)_
- **seo-health-score-calculator**: SEO Health Score Calculator. Use when working with audit findings and a disclosed scoring rubric. _(risk: safe)_
- **site-comparison-report-generator**: Site Comparison Report Generator. Use when working with two or more sites and the user's comparison goal. _(risk: safe)_
- **traffic-potential-calculator**: Traffic Potential Calculator. Use when working with search volume and explicit CTR assumptions for matching period and market. _(risk: safe)_
- **visibility-index-calculator**: Visibility Index Calculator. Use when working with keyword weights and rank-to-CTR mapping with rankings. _(risk: safe)_

## seo utility

- **canonical-url-builder**: Canonical URL Builder. Use when working with preferred page URL and duplicate URL variants. _(risk: safe)_
- **og-tag-generator**: OG Tag Generator. Use when working with page URL, title, description and optional public image URL. _(risk: safe)_
- **redirect-301-generator**: 301 Redirect Generator. Use when working with source-to-destination mapping and deployment platform. _(risk: safe)_
- **reverse-image-search**: Reverse Image Search. Use when working with image or public image URL. _(risk: safe)_
- **robots-txt-creator**: Robots.txt Creator. Use when working with site origin and desired crawl rules. _(risk: safe)_
- **search-preview-simulator**: Search Preview Simulator. Use when working with title, description and page URL. _(risk: safe)_
- **seo-checklist-generator**: SEO Checklist Generator. Use when working with site type and current goal. _(risk: safe)_
- **sitemap-generator**: XML Sitemap Generator. Use when working with canonical public page URLs and optional real modification dates. _(risk: safe)_
- **text-to-html-converter**: Text to HTML Converter. Use when working with plain text and optional structure preferences. _(risk: safe)_
- **text-translator**: Text Translator. Use when working with source text and target language or locale. _(risk: safe)_
- **url-slug-generator**: URL Slug Generator. Use when working with page title and optional language or URL policy. _(risk: safe)_

## shopping

- **movie-coupon**: Fetch movie ticket coupons from platforms like Taopiaopiao and Maoyan. Returns coupon links and QR code images for users to redeem via WeChat. _(risk: critical)_
- **obtain-coupons-all-in-one**: All-in-one coupon fetcher supporting takeout (Meituan, Ele.me, JD), parcel/courier (SF, ZTO, YTO, etc.), travel (DiDi, Ctrip), and movie tickets (Taopiaopiao, Maoyan) coupons with one-click access to all discounts. _(risk: critical)_
- **parcel-coupon**: Call parcel/courier coupon API to fetch one-stop logistics service coupons, including smart shipping and smart price matching. Returns coupon links and QR code images for users to redeem via WeChat. _(risk: safe)_
- **takeout-coupon**: Call takeout coupon API to fetch hidden coupon lists, red packets and aggregated redemption pages for platforms (Meituan, Taobao Flash/Ele.me, JD.com). Returns coupon codes and redemption instructions for users to copy and redeem in corresponding apps. _(risk: critical)_
- **trip-coupon**: Call trip/travel coupon API to fetch travel coupons including DiDi ride-hailing gift packages and hotel coupon bundles. Returns coupon links and QR code images for users to redeem via WeChat. _(risk: critical)_

## skill discovery

- **selector**: Select a specialized 100seotools skill from a plain-language SEO or project-documentation request. Use when the user needs help choosing the appropriate workflow. _(risk: safe)_

## skill-authoring

- **writing-great-skills**: Reference for writing and editing skills well — the vocabulary and principles that make a skill predictable. _(risk: safe)_
- **yao-meta-skill**: Create, refactor, evaluate, and package agent skills from workflows, prompts, transcripts, docs, or notes. Use for skill creation, reusable workflow packaging, skill improvement, evals, and team-ready distribution. _(risk: critical)_

## spreadsheet-processing

- **calc**: Spreadsheet creation, format conversion (ODS/XLSX/CSV), formulas, data automation with LibreOffice Calc. _(risk: safe)_

## startup-business

- **launch-strategy**: When the user wants to plan a product launch, feature announcement, or release strategy. Also use when the user mentions 'launch,' 'Product Hunt,' 'feature release,' 'announcement,' 'go-to-market,'... _(risk: unknown)_
- **micro-saas-launcher**: Expert in launching small, focused SaaS products fast - the indie hacker approach to building profitable software. Covers idea validation, MVP development, pricing, launch strategies, and growing t... _(risk: unknown)_
- **personal-tool-builder**: Expert in building custom tools that solve your own problems first. The best products often start as personal tools - scratch your own itch, build for yourself, then discover others have the same i... _(risk: unknown)_
- **pricing-strategy**: Design pricing, packaging, and monetization strategies based on value, customer willingness to pay, and growth objectives. _(risk: unknown)_
- **startup-business-analyst-financial-projections**: Create detailed 3-5 year financial model with revenue, costs, cash
flow, and scenarios
 _(risk: unknown)_
- **startup-business-analyst-market-opportunity**: Generate comprehensive market opportunity analysis with TAM/SAM/SOM
calculations
 _(risk: unknown)_
- **viral-generator-builder**: Expert in building shareable generator tools that go viral - name generators, quiz makers, avatar creators, personality tests, and calculator tools. Covers the psychology of sharing, viral mechanic... _(risk: unknown)_

## super-code

- **bash**: Language-specific super-code guidelines for bash. _(risk: safe)_
- **c**: Language-specific super-code guidelines for c. _(risk: safe)_
- **cpp**: Language-specific super-code guidelines for cpp. _(risk: safe)_
- **csharp**: Language-specific super-code guidelines for csharp. _(risk: safe)_
- **dart**: Language-specific super-code guidelines for dart. _(risk: safe)_
- **elixir**: Language-specific super-code guidelines for elixir. _(risk: safe)_
- **go**: Language-specific super-code guidelines for go. _(risk: safe)_
- **java**: Language-specific super-code guidelines for java. _(risk: safe)_
- **kotlin**: Language-specific super-code guidelines for kotlin. _(risk: safe)_
- **php**: Language-specific super-code guidelines for php. _(risk: safe)_
- **python**: Language-specific super-code guidelines for python. _(risk: safe)_
- **ruby**: Language-specific super-code guidelines for ruby. _(risk: safe)_
- **rust**: Language-specific super-code guidelines for rust. _(risk: safe)_
- **scala**: Language-specific super-code guidelines for scala. _(risk: safe)_
- **swift**: Language-specific super-code guidelines for swift. _(risk: safe)_
- **typescript**: Language-specific super-code guidelines for typescript. _(risk: safe)_

## technical seo

- **broken-link-finder**: Broken Link Finder. Use when working with page URL, HTML or a list of links. _(risk: safe)_
- **canonical-tag-checker**: Canonical Tag Checker. Use when working with HTML and page URL, or accessible page URL. _(risk: safe)_
- **hreflang-tag-generator**: Hreflang Tag Generator. Use when working with equivalent page URLs mapped to language and optional region. _(risk: safe)_
- **http-status-code-tester**: HTTP Status Code Tester. Use when working with one or more HTTP(S) URLs. _(risk: safe)_
- **mobile-friendly-test**: Mobile-Friendly Test. Use when working with accessible page or supplied screenshots and HTML. _(risk: safe)_
- **page-speed-score-simulator**: Page Speed Score Simulator. Use when working with performance report or explicit hypothetical performance inputs. _(risk: safe)_
- **redirect-checker**: Redirect Checker. Use when working with URL or recorded response chain. _(risk: safe)_
- **robots-txt-validator**: Robots.txt Validator. Use when working with robots.txt text, crawler and URLs to test. _(risk: safe)_
- **xml-sitemap-visualizer**: XML Sitemap Visualizer. Use when working with XML sitemap or sitemap index. _(risk: safe)_

## test-automation

- **playwright-java**: Scaffold, write, debug, and enhance enterprise-grade Playwright E2E tests in Java using Page Object Model, JUnit 5, Allure reporting, and parallel execution. _(risk: safe)_
- **awt-e2e-testing**: AI-powered E2E web testing — eyes and hands for AI coding tools. Declarative YAML scenarios, Playwright execution, visual matching (OpenCV + OCR), platform auto-detection (Flutter/React/Vue), learning DB. Install: npx skills add ksgisang/awt-skill --skill awt -g _(risk: critical)_

## testing

- **acceptance-orchestrator**: Use when a coding task should be driven end-to-end from issue intake through implementation, review, deployment, and acceptance verification with minimal human re-intervention. _(risk: safe)_
- **conductor-implement**: Execute tasks from a track's implementation plan following TDD workflow _(risk: unknown)_
- **e2e-testing-patterns**: Master end-to-end testing with Playwright and Cypress to build reliable test suites that catch bugs, improve confidence, and enable fast deployment. Use when implementing E2E tests, debugging flaky... _(risk: unknown)_
- **git-pr-workflows-git-workflow**: Orchestrate a comprehensive git workflow from code review through PR creation, leveraging specialized agents for quality assurance, testing, and deployment readiness. This workflow implements modern g _(risk: unknown)_
- **go-playwright**: Expert capability for robust, stealthy, and efficient browser automation using Playwright Go. _(risk: safe)_
- **javascript-testing-patterns**: Implement comprehensive testing strategies using Jest, Vitest, and Testing Library for unit tests, integration tests, and end-to-end testing with mocking, fixtures, and test-driven development. Use... _(risk: unknown)_
- **k6-load-testing**: Comprehensive k6 load testing skill for API, browser, and scalability testing. Write realistic load scenarios, analyze results, and integrate with CI/CD. _(risk: safe)_
- **nerdzao-elite**: Senior Elite Software Engineer (15+) and Senior Product Designer. Full workflow with planning, architecture, TDD, clean code, and pixel-perfect UX validation. _(risk: safe)_
- **pypict-skill**: Pairwise test generation _(risk: safe)_
- **python-testing-patterns**: Implement comprehensive testing strategies with pytest, fixtures, mocking, and test-driven development. Use when writing Python tests, setting up test suites, or implementing testing best practices. _(risk: unknown)_
- **screenshots**: Generate marketing screenshots of your app using Playwright. Use when the user wants to create screenshots for Product Hunt, social media, landing pages, or documentation. _(risk: safe)_
- **spec-to-code-compliance**: Verifies code implements exactly what documentation specifies for blockchain audits. Use when comparing code against whitepapers, finding gaps between specs and implementation, or performing compliance checks for protocol implementations. _(risk: unknown)_
- **tdd-workflow**: Test-Driven Development workflow principles. RED-GREEN-REFACTOR cycle. _(risk: unknown)_
- **tdd-workflows-tdd-cycle**: Use when working with tdd workflows tdd cycle _(risk: unknown)_
- **tdd-workflows-tdd-green**: Implement the minimal code needed to make failing tests pass in the TDD green phase. _(risk: unknown)_
- **tdd-workflows-tdd-red**: Generate failing tests for the TDD red phase to define expected behavior and edge cases. _(risk: unknown)_
- **tdd-workflows-tdd-refactor**: Use when working with tdd workflows tdd refactor _(risk: unknown)_
- **temporal-python-testing**: Test Temporal workflows with pytest, time-skipping, and mocking strategies. Covers unit testing, integration testing, replay testing, and local development setup. Use when implementing Temporal wor... _(risk: unknown)_
- **test-driven-development**: Use when implementing any feature or bugfix, before writing implementation code _(risk: unknown)_
- **test-fixing**: Run tests and systematically fix all failing tests using smart error grouping. Use when user asks to fix failing tests, mentions test failures, runs test suite and failures occur, or requests to ma... _(risk: unknown)_
- **testing-patterns**: Jest testing patterns, factory functions, mocking strategies, and TDD workflow. Use when writing unit tests, creating test factories, or following TDD red-green-refactor cycle. _(risk: unknown)_
- **track-management**: Use this skill when creating, managing, or working with Conductor tracks - the logical work units for features, bugs, and refactors. Applies to spec.md, plan.md, and track lifecycle operations. _(risk: unknown)_
- **unit-testing-test-generate**: Generate comprehensive, maintainable unit tests across languages with strong coverage and edge case focus. _(risk: unknown)_
- **workflow-patterns**: Use this skill when implementing tasks according to Conductor's TDD workflow, handling phase checkpoints, managing git commits for tasks, or understanding the verification protocol. _(risk: unknown)_
- **writing-plans**: Use when you have a spec or requirements for a multi-step task, before touching code _(risk: unknown)_
- **ab-testing**: When the user wants to plan, design, or implement an A/B test or experiment, or build a growth experimentation program. _(risk: critical)_
- **agent-qa-authoring**: Create, edit, validate, and run Agent QA tests, suites, and hooks through MCP or CLI while preserving canonical IDs and schema contracts. _(risk: critical)_
- **agent-qa-debug-fix**: Debug, patch, and verify failed Agent QA runs from MCP evidence, artifacts, logs, and local code without hiding product or infrastructure defects. _(risk: critical)_
- **agent-qa-result-triage**: Triage failed Agent QA runs with MCP evidence, artifacts, logs, fixed failure categories, confidence, and actionable next steps. _(risk: safe)_
- **agentic-test-audit**: Audit a pytest suite: surviving mutants and untested code, flaky, order-dependent and slow tests, and removal candidates checked on held-out mutants. Report-only. _(risk: safe)_
- **agentic-verify**: Check that a Python change is caught by tests: run every mutant of the changed lines and write tests until they catch them. Reports evidence instead of a diff to read. _(risk: safe)_
- **android-ui-journey-testing**: XML-specified Android UI journey testing, interactive step execution, assertion verification, and JSON outcome reporting. _(risk: critical)_
- **assay**: Run assay on a web page you just wrote or changed. It opens the page in a real browser, drives every control, and reports where the page contradicts itself. Local browser checks without an LLM API key. _(risk: safe)_
- **brooks-test**: Review test-suite quality using established testing literature; identify brittleness, mock abuse, unclear fixtures, weak assertions, slow feedback, and maintenance risks. _(risk: safe)_
- **browser-testing-with-devtools**: Test browser apps with Chrome DevTools MCP by inspecting live DOM, console logs, network traffic, screenshots, accessibility, and performance traces. _(risk: critical)_
- **cucumber-skill**: Generates Cucumber BDD tests with Gherkin feature files and step definitions in Java, JavaScript, or Ruby. Use when user mentions "Cucumber", "Gherkin", "Feature/Scenario", "Given/When/Then", "BDD". _(risk: critical)_
- **cypress-skill**: Generates production-grade Cypress E2E and component tests in JavaScript or TypeScript. Supports local execution and TestMu AI cloud. Use when the user asks to write Cypress tests, set up Cypress, test with cy commands, or mentions "Cypress", "cy.visit", "cy.get", "cy.intercept". _(risk: critical)_
- **electron-drive-skill**: Launch the project's Electron app on a scratch profile and drive it: click, type, screenshot, run renderer or main-process code, read logs. Use to verify UI changes end to end. _(risk: critical)_
- **huggingface-community-evals**: Curated upstream guidance for Huggingface Community Evals; use when the workflow matches the user goal. _(risk: unknown)_
- **hyperexecute-skill**: Operates HyperExecute end-to-end for TestMu AI/LambdaTest cloud test execution: analyze projects, create YAML, validate locally, run CLI jobs, debug failures, and wire CI. _(risk: critical)_
- **junit-5-skill**: Generates production-grade JUnit 5 unit and integration tests in Java. Covers assertions, parameterized tests, lifecycle hooks, mocking with Mockito, and nested tests. Use when user mentions "JUnit", "JUnit 5", "@Test", "assertEquals", "Assertions", "Java unit test". _(risk: critical)_
- **lambdatest-agent-skills**: Production-grade test automation skills for 46 frameworks across E2E, unit, mobile, BDD, visual, and cloud testing in 15+ languages. _(risk: safe)_
- **mailtrap-testing-with-sandbox**: Capture outbound email in Mailtrap Email Sandbox for development, staging, CI, HTML inspection, spam checks, and fake inbox tests. _(risk: safe)_
- **mock-hunter**: Audit a live web page in five phases (catalog, click, trace, classify, report) to identify mock data, hardcoded values, LLM-generated metrics, and broken endpoints. Outputs a markdown report with REAL/MOCK/LLM/HARDCODED/BROKEN/UNKNOWN verdicts per visible value. _(risk: critical)_
- **oneroster-csv-validator**: Validates 1EdTech / IMS Global OneRoster v1.1 and v1.2 CSV roster sets: manifest integrity, bulk vs delta strictness, foreign key references, and encoding sanitization. Trigger phrases: oneroster csv validator, validate oneroster zip, clever roster error, oneroster sourcedid. _(risk: safe)_
- **postman-newman-automation**: Generate Newman CLI commands, configuration files, Jenkins pipeline scripts, and shell automation for running Postman collections in CI/CD or local environments. _(risk: critical)_
- **pytest-skill**: Generates production-grade pytest tests in Python with fixtures, parametrize, markers, mocking, and conftest patterns. Use when user mentions "pytest", "conftest", "@pytest.fixture", "@pytest.mark", "Python test". _(risk: critical)_
- **robot-framework-skill**: Generates Robot Framework tests in keyword-driven syntax with Python. Supports SeleniumLibrary, RequestsLibrary, and custom keywords. Use when user mentions "Robot Framework", "*** Test Cases ***", "SeleniumLibrary", ".robot file". _(risk: critical)_
- **score-eval**: Use when scoring an evaluation diff against a supplied rubric and baseline fixture: retain evidence for detected/fixed findings and report unscorable or unexecuted checks. _(risk: critical)_
- **smartui-skill**: Generates SmartUI visual regression test configurations for screenshot comparison on TestMu AI cloud. Framework-agnostic — works with Playwright, Selenium, Cypress, Puppeteer. Use when user mentions "SmartUI", "visual regression", "screenshot comparison", "visual testing". _(risk: critical)_
- **supercov**: Measure line, branch and MC/DC coverage of a project's existing tests with the supercov CLI, then write small, focused tests for the code no test reaches. _(risk: critical)_
- **tdd-workflows**: Use when working with tdd workflows tdd cycle (Alias for tdd-workflows-tdd-cycle)
- **test-framework-migration-skill**: Migrates and converts test automation scripts between Selenium, Playwright, Puppeteer, and Cypress. _(risk: critical)_
- **test-guard**: Review generated or changed test code against universal testing rules before it ships or is presented for approval. _(risk: critical)_
- **testdriver-e2e-testing**: Build E2E tests with TestDriver.ai, the AI code reviewer that runs every pull request in a real desktop sandbox, finds bugs, and builds regression tests _(risk: critical)_
- **testng-skill**: Generates TestNG tests in Java with groups, data providers, parallel execution, XML suite configuration, and listeners. Use when user mentions "TestNG", "@DataProvider", "testng.xml", "groups". Triggers on: "TestNG", "@DataProvider", "testng.xml", "TestNG suite", "parallel tests Java". _(risk: critical)_
- **uiverify-triage-visual-changes**: Triage a UI Verify visual regression build from your coding agent over MCP: sort changed screenshots into regressions, intended changes and noise, then accept baselines. _(risk: critical)_
- **vitest-skill**: Generates Vitest tests in JavaScript/TypeScript with Vite-native speed. Jest-compatible API with ESM support and HMR. Use when user mentions "Vitest", "vi.mock", "vitest.config". Triggers on: "Vitest", "vi.mock", "vi.fn", "Vite test", "vitest config". _(risk: critical)_
- **wjttc-builder**: PLAN and GENERATE WJTTC (Championship-Grade) test suites for any project. Analyzes the codebase, classifies components across the WJTTC five tiers (Brake · Engine · Aero · Tyre · Pit), writes a tiered test plan, and scaffolds executable test files. _(risk: critical)_
- **wjttc-tester**: F1-inspired test EXECUTOR + reporter. Runs a test plan, finds and reproduces bugs, audits suite signal integrity, then files a WJTTC report (Brake/Engine/Aero/Tyre/Pit) with a tier verdict. _(risk: critical)_

## tool-quality

- **clarvia-aeo-check**: Score any MCP server, API, or CLI for agent-readiness using Clarvia AEO (Agent Experience Optimization). Use current provider evidence as advisory input when evaluating a tool. _(risk: safe)_

## tools

- **android-cli**: Orchestrates Android development tasks including project creation, deployment, SDK management, and environment diagnostics using the `android` command-line tool. _(risk: critical)_

## travel

- **travel-planner**: 旅行/行程规划需求时使用:规划去某地旅行、X天X城、带老人孩子、自驾、假期安排等。产出逐日行程表、预算估算(经济/舒适/奢华三档)、交通住宿建议、景点美食清单。必须先问预算,预算未确认只输出问题清单;事实数据带来源和查询日期。 _(risk: safe)_

## uncategorized

- **aegisops-ai**: Autonomous DevSecOps & FinOps Guardrails. Guide to reviewing Linux kernel patches, Terraform cost changes and Kubernetes policy with a separately reviewed upstream tool and configured model. _(risk: critical)_
- **changelog-entry**: Generate a properly formatted CHANGELOG.md entry in Keep a Changelog format from a commit range or PR. Groups changes into Added/Changed/Deprecated/Removed/Fixed/Security categories and outputs a ready-to-paste block. _(risk: safe)_
- **reverse-engineer-anything**: Use REA to investigate shipped apps, binaries, packages, and runtimes; trace features with evidence, compare versions, or guide reconstruction. Skip ordinary source-code analysis. _(risk: critical)_
- **user-thoughts**: Persist user decisions and project constraints to mdbase across sessions. Use on explicit /user-thoughts or /ustht requests, or within previously authorized project-memory capture scope. _(risk: critical)_

## video

- **youtube-notetaker**: Turn YouTube talks into local study notes with slides, transcripts, editable annotations, and a markdown-backed viewer. _(risk: critical)_

## voice-agents

- **pipecat-friday-agent**: Build a low-latency, Iron Man-inspired tactical voice assistant (F.R.I.D.A.Y.) using Pipecat, Gemini, and OpenAI. _(risk: safe)_

## web

- **url-to-markdown**: Fetch a public webpage as clean Markdown for an agent: read, summarize, quote, or cite the page while preserving its source URL. _(risk: safe)_

## web-development

- **accesslint-audit**: Find and fix WCAG 2.2 accessibility issues. Two modes — report (sweep a codebase or page, produce a prioritized written report, no edits) and fix (audit→edit→verify loop on a target). Prefers direct-CDP live-DOM auditing; falls back to a browser-MCP composition or HTML-string audits. _(risk: safe)_
- **applicationinsights-web-ts**: Instrument browser/web apps with the Application Insights JavaScript SDK (@microsoft/applicationinsights-web). _(risk: critical)_
- **bilig-workpaper**: Use formula-backed WorkPaper JSON and MCP tools for agent spreadsheet tasks without driving Excel or a browser UI. _(risk: critical)_
- **browser-extension-reverse**: Authorized reverse engineering of Chrome/Firefox extensions: manifest analysis, background workers, content scripts, and extension-based credential or data-exposure research. _(risk: offensive)_
- **ckw-design**: Frontend design entry point: direction, design system, visual philosophy. Use whenever building or touching the look of any web UI (components, pages, dashboards, React/Vue/HTML-CSS) or when the user says "make this look better", "fix the spacing/layout", or mentions styling, color, type, or polish. _(risk: safe)_
- **design-system**: Mechanical implementation invariants for frontend design: token architecture, typography hierarchy, loading order, FOUT prevention, chrome stability, motion timing, color semantics. Use with design when building components, pages, or design systems. _(risk: critical)_
- **design-ux**: UX / usability audit — heuristic evaluation of INTERACTIVE UIs (not just visual polish). Load with design when a UI "feels off", "sucks to use", is hard to learn, needs an instruction wall, or before shipping an interactive tool/editor/app. _(risk: critical)_
- **formik-patterns**: Formik form handling with validation patterns. Use when building forms, implementing validation, or handling form submission. _(risk: critical)_
- **frontend-architecture**: A portable, framework-agnostic architecture style for any React or React Native frontend. Organizes apps into feature modules with page/screen directories, a strict server-state vs UI-state split, barrel-only cross-module imports, co-located styles, and clear component-promotion rules. _(risk: critical)_
- **frontend-seo**: A portable, framework-agnostic SEO system for any React or React Native-for-web frontend. _(risk: critical)_
- **frontend-slides-frontend-slides**: Create stunning, animation-rich HTML presentations from scratch or by converting PowerPoint files. Use when the user wants to build a presentation, convert a PPT/PPTX to web, or create slides for a talk/pitch. _(risk: critical)_
- **frontend-ui-engineering**: Builds production-quality UIs. Use when building or modifying user-facing interfaces. Use when creating components, implementing layouts, managing state, or when the output needs to look and feel production-quality rather than AI-generated. _(risk: critical)_
- **jest-skill**: Generates Jest unit and integration tests in JavaScript or TypeScript. Covers mocking, snapshots, async testing, and React component testing. Use when user mentions "Jest", "describe/it/expect", "jest.mock", "toMatchSnapshot". _(risk: critical)_
- **pagespeed-enhancer**: Scan, audit, and fix web performance issues across all four Lighthouse/PageSpeed Insights pillars — Performance, Accessibility, Best Practices, and SEO — in structured batches. _(risk: safe)_
- **photopea-embedded-editor**: Embed Photopea in web apps using photopea.js. Covers embedding, file I/O, scripting, exporting, layers, text, filters, and selected Photoshop-like scripting patterns. _(risk: critical)_
- **react-component-performance**: Diagnose slow React components and suggest targeted performance fixes. _(risk: safe)_
- **react-native-skills**: Review React Native and Expo rendering, lists, animations, navigation and native UI against project versions and measured behavior. _(risk: safe)_
- **selenium-skill**: Generates production-grade Selenium WebDriver automation scripts and tests in Java, Python, JavaScript, C#, Ruby, or PHP. Supports local execution and TestMu AI cloud with 3000+ browser/OS combinations. _(risk: critical)_
- **seo-technical**: Audit technical SEO across crawlability, indexability, security, URLs, mobile, Core Web Vitals, structured data, JavaScript rendering, and related platform signals like robots.txt and AI crawler access. _(risk: critical)_
- **styleseed-design-review**: Reviews UI/frontend code and tells you exactly why it "looks AI-generated" — then how to fix it. _(risk: safe)_
- **transformers-js**: Use Transformers.js to run state-of-the-art machine learning models directly in JavaScript/TypeScript. _(risk: critical)_
- **ui-a11y**: Audit a component or page for accessibility issues and fix them _(risk: critical)_
- **ui-component**: Generate a new UI component following the StyleSeed design conventions _(risk: critical)_
- **ui-motion**: Apply a named StyleSeed motion to a component — either one of the 5 personality seeds (Spring/Silk/Snap/Float/Pulse × entrance/exit/hover/press/layout) or a distinctive keyword move from the motion library (toggle-flip, toggle-curtain, reveal-blur, pop-in, shimmer, …). _(risk: critical)_
- **ux-feedback**: Add appropriate user feedback states (loading, success, error, empty) to a component or page _(risk: critical)_
- **vercel-react-view-transitions**: Guide React and Next.js view transitions, shared element animations, route transitions, transition types, and reduced-motion-safe UI state animation. _(risk: safe)_
- **webdriverio-skill**: Generates WebdriverIO (WDIO) automation tests in JavaScript or TypeScript. Supports local and TestMu AI cloud. Use when user mentions "WebdriverIO", "WDIO", "wdio.conf", "browser.url", "$", "$$". Triggers on: "WebdriverIO", "WDIO", "wdio", "browser.$". _(risk: critical)_

## workflow

- **ai-loop**: Runs a bounded spec-build-review development loop with explicit scope, stop conditions, and human approval gates for risky or ambiguous work. _(risk: safe)_
- **atlas-ledger**: Companion to atlas-contract. Auto-invoked by its Final Audit on caught drift; also use after Post Reviews or user requests to record a mistake. Distills drift into WHEN/DON'T/INSTEAD clauses, writes to Atlas.md after confirmation. _(risk: critical)_
- **crossframe**: Use when the user explicitly invokes CrossFrame or 跨尺度结构诊断 for Chinese-canonical structural diagnosis of complex relationships, organizations, institutions, public disputes, or long-term evolution. _(risk: safe)_
- **crossframe-public**: Use when CrossFrame Suite routes explicit Chinese analysis of public issues, platform governance, policy, institutional responsibility, appeals, or compliance evidence. _(risk: safe)_
- **crossframe-review**: Use when explicit CrossFrame output needs review for reasoning fidelity, evidence boundaries, source anchors, concept drift, article collapse, or repair steps. _(risk: safe)_
- **crossframe-suite**: Use when the user explicitly invokes CrossFrame Suite for Chinese structural diagnosis workflows across relationships, organizations, public issues, philosophy, research, or essay output. _(risk: safe)_
- **deprecation-and-migration**: Manages deprecation and migration. Use when removing old systems, APIs, or features. Use when migrating users from one implementation to another. Use when deciding whether to maintain or sunset existing code. _(risk: critical)_
- **git-pr-review**: Generate a concise and structured PR description from commit history with minimal token usage _(risk: safe)_
- **git-workflow-and-versioning**: Structures git workflow practices. Use when making any code change. Use when committing, branching, resolving conflicts, or when you need to organize work across multiple parallel streams. _(risk: critical)_
- **github-presence**: When the user wants to optimize their GitHub profile, README, or project discoverability. Trigger phrases include "GitHub README," "README optimization," "GitHub profile," "GitHub stars," "GitHub discoverability," "awesome lists," or "GitHub marketing." _(risk: critical)_
- **idea-darwin**: Darwinian idea evolution engine — toss rough ideas onto an evolution island, let them compete, crossbreed, and mutate through structured rounds to surface your strongest concepts. _(risk: safe)_
- **nika**: Runs repeatable AI work as checked, budgeted workflow files. _(risk: critical)_
- **pr-merge-champion**: Optimize pull requests for quick approval and merging by ensuring clean diffs, comprehensive self-reviews, and structured documentation. _(risk: safe)_
- **repo-maintainer**: Audit and repair repository hygiene across artifacts, dependencies, CI, docs, Git state, and code-quality signals. Use for repository maintenance, cleanup, health checks, or pre-release hardening. _(risk: critical)_
- **skeleton-first**: Prove a data/AI/agent workflow end to end on a tiny sample, find cheap wins, then scale in cost-gated steps within budget. _(risk: safe)_

## workflow-bundle

- **ai-ml**: AI and machine learning workflow covering LLM application development, RAG implementation, agent architecture, ML pipelines, and AI-powered features. _(risk: safe)_
- **cloud-devops**: Cloud infrastructure and DevOps workflow covering AWS, Azure, GCP, Kubernetes, Terraform, CI/CD, monitoring, and cloud-native development. _(risk: safe)_
- **database**: Database development and operations workflow covering SQL, NoSQL, database design, migrations, optimization, and data engineering. _(risk: safe)_
- **development**: Comprehensive web, mobile, and backend development workflow bundling frontend, backend, full-stack, and mobile development skills for end-to-end application delivery. _(risk: safe)_
- **documentation**: Documentation generation workflow covering API docs, architecture docs, README files, code comments, and technical writing. _(risk: safe)_
- **office-productivity**: Office productivity workflow covering document creation, spreadsheet automation, presentation generation, and integration with LibreOffice and Microsoft Office formats. _(risk: safe)_
- **os-scripting**: Operating system and shell scripting troubleshooting workflow for Linux, macOS, and Windows. Covers bash scripting, system administration, debugging, and automation. _(risk: safe)_
- **security-audit**: Comprehensive security auditing workflow covering web application testing, API security, penetration testing, vulnerability scanning, and security hardening. _(risk: safe)_
- **testing-qa**: Comprehensive testing and QA workflow covering unit testing, integration testing, E2E testing, browser automation, and quality assurance. _(risk: safe)_
- **wordpress**: Complete WordPress development workflow covering theme development, plugin creation, WooCommerce integration, performance optimization, and security hardening. _(risk: safe)_

## workflow-planning

- **brainstorming**: Use before creative or constructive work (features, architecture, behavior). Transforms vague ideas into validated designs through disciplined reasoning and collaboration. _(risk: unknown)_
- **concise-planning**: Use when a user asks for a plan for a coding task, to generate a clear, actionable, and atomic checklist. _(risk: unknown)_
- **conductor-manage**: Manage track lifecycle: archive, restore, delete, rename, and cleanup _(risk: unknown)_
- **conductor-new-track**: Create a new track with specification and phased implementation plan _(risk: unknown)_
- **conductor-setup**: Configure a Rails project to work with Conductor (parallel coding agents) _(risk: unknown)_
- **conductor-status**: Display project status, active tracks, and next actions _(risk: unknown)_
- **conductor-validator**: Validates Conductor project artifacts for completeness,
consistency, and correctness. Use after setup, when diagnosing issues, or
before implementation to verify project context.
 _(risk: unknown)_
- **context-compression**: This skill should be used when the user asks to "compress context", "summarize conversation history", "implement compaction", "reduce token usage", or mentions context compression, structured summarization, tokens-per-task optimization, or long-running agent sessions... _(risk: unknown)_
- **context-degradation**: This skill should be used when the user asks to "diagnose context problems", "fix lost-in-middle issues", "debug agent failures", "understand context poisoning", or mentions context degradation, attention patterns, context clash, context confusion, or agent performance... _(risk: unknown)_
- **context-driven-development**: Use this skill when working with Conductor's context-driven development methodology, managing project context artifacts, or understanding the relationship between product.md, tech-stack.md, and... _(risk: unknown)_
- **context-fundamentals**: This skill should be used when the user asks to "understand context", "explain context windows", "design agent architecture", "debug context issues", "optimize context usage", or discusses context components, attention mechanics, progressive disclosure, or context budgeting.... _(risk: unknown)_
- **context-management-context-restore**: Use when working with context management context restore _(risk: unknown)_
- **context-management-context-save**: Use when working with context management context save _(risk: unknown)_
- **executing-plans**: Use when you have a written implementation plan to execute in a separate session with review checkpoints _(risk: unknown)_
- **odoo-manufacturing-advisor**: Expert guide for Odoo Manufacturing: Bills of Materials (BoM), Work Centers, routings, MRP planning, and production order workflows. _(risk: safe)_
- **odoo-purchase-workflow**: Expert guide for Odoo Purchase: RFQ → PO → Receipt → Vendor Bill workflow, purchase agreements, vendor price lists, and 3-way matching. _(risk: safe)_
- **plan-writing**: Structured task planning with clear breakdowns, dependencies, and verification criteria. Use when implementing features, refactoring, or any multi-step work. _(risk: unknown)_
- **planning-with-files**: Implements Manus-style file-based planning for complex tasks. Creates task_plan.md, findings.md, and progress.md. Use when starting complex multi-step tasks, research projects, or any task requirin... _(risk: unknown)_
- **startup-analyst**: Expert startup business analyst specializing in market sizing, financial modeling, competitive analysis, and strategic planning for early-stage companies. _(risk: unknown)_

## writing

- **beautiful-prose**: A hard-edged writing style contract for timeless, forceful English prose without modern AI tics. Use when users ask for prose or rewrites that must be clean, exact, concrete, and free of AI cadence, filler, or therapeutic tone. _(risk: unknown)_
- **copy-editing**: When the user wants to edit, review, or improve existing marketing copy. Also use when the user mentions 'edit this copy,' 'review my copy,' 'copy feedback,' 'proofread,' 'polish this,' 'make this ... _(risk: unknown)_
- **scientific-writing**: Core skill for the deep research and writing tool. Write scientific manuscripts in full paragraphs (never bullet points). Use two-stage process with (1) section outlines with key points using research-lookup then (2) convert to flowing prose. IMRAD... _(risk: unknown)_
- **bluebook-writing**: Write design-reading books and articles in plain language with a two-layer skeleton: a zero-terminology everyday story first, then the professional layer with formal names, mechanisms, boundaries, and costs. Use when explaining unfamiliar systems to non-programmers. _(risk: safe)_
- **bulletmind**: Convert input into clean, structured, hierarchical bullet points for summarization, note-taking, and structured thinking. _(risk: safe)_
- **email-issue-fixer**: Fix small email mistakes without touching the writer's voice, and strip tracking parameters from links on request. Always returns the corrected draft plus a change list. _(risk: safe)_
- **short**: Rewrite the previous response more briefly while preserving the substance. _(risk: safe)_
- **tech-writing-proofread**: Proofreads English technical writing for typos, grammar, punctuation, terminology consistency, jargon, and structure; returns an itemized Original → Suggestion → Reason list without rewriting the document. Use when asked to proofread or polish a technical doc, README, or blog draft. _(risk: safe)_
- **unslop**: Post-process AI-generated text through the unslop CLI to strip AI writing patterns before publishing _(risk: safe)_
