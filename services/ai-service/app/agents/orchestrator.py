"""
GenAI Content Platform — Strand Agent Orchestration
AWS Multi-Agent Orchestrator for content scripting workflows.
All models: FREE TIER only (meta.llama3-1-8b-instruct-v1:0)
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import structlog
from multi_agent_orchestrator.agents import BedrockLLMAgent, BedrockLLMAgentOptions
from multi_agent_orchestrator.orchestrator import (
    MultiAgentOrchestrator,
    OrchestratorConfig,
)

from app.config import settings

logger = structlog.get_logger(__name__)

# Ensure libraries that create their own boto3 session can still resolve region.
os.environ.setdefault("AWS_DEFAULT_REGION", settings.aws_region)


# ═══════════════════════════════════════════════════════════════
# System Prompts
# ═══════════════════════════════════════════════════════════════

SCRIPTING_SYSTEM_PROMPT = """You are a professional content writer for a Communications & Media team.

CORE RULES:
1. Always follow the brand voice examples provided in the context below.
2. Output ONLY the requested content — no commentary, no explanations, no preambles.
3. Match the content type exactly (article, script, social post, email, ad copy).
4. Maintain consistent tone throughout the piece.
5. Use natural, engaging language appropriate for the target audience.
6. Include relevant hooks, transitions, and calls-to-action where appropriate.

BRAND VOICE CONTEXT (if provided):
{brand_context}

CONTENT TYPE: {content_type}

STRUCTURE REQUIREMENTS:
{format_rules}

OUTPUT TEMPLATE (MUST follow exactly):
{output_template}
"""


def get_format_rules(content_type: str) -> str:
    """Return strict output structure rules per content type."""
    rules = {
        "article": (
            "- Start with a single plain title line (no markdown symbols).\n"
            "- Write a full-length article with 5-7 substantive sections and clear subheadings.\n"
            "- Each section must include one developed paragraph (4-7 sentences), not a short summary.\n"
            "- Add a short bullet list (3-5 points) in key sections to improve readability.\n"
            "- Preserve depth, examples, and practical detail from the brief; do not compress into a short overview.\n"
            "- End with a complete conclusion and one clear call to action.\n"
            "- Do not include screenplay tags, bracketed stage directions, or markdown markers like ** or #."
        ),
        "script": (
            "- Use this exact section order: HOOK, PROBLEM, SOLUTION, BENEFITS, CALL TO ACTION.\n"
            "- Each section starts on a new line with uppercase label and colon.\n"
            "- Keep each section detailed (3-6 sentences), not one-liners.\n"
            "- Only the section labels are uppercase; body text must be normal sentence case.\n"
            "- Do not use [MUSIC], [SFX], [NARRATOR], or any bracketed directions unless explicitly requested in the brief.\n"
            "- Use clean spoken language, not production notes."
        ),
        "social": (
            "- Output one social post only, 80-120 words.\n"
            "- Structure: Hook sentence, value sentences, CTA sentence.\n"
            "- Short lines, no headings, no numbering.\n"
            "- Max 2 hashtags at the end.\n"
            "- No markdown symbols, no bracketed stage directions."
        ),
        "email": (
            "- Structure: Subject line, Greeting, Body (2-3 short paragraphs), CTA, Sign-off.\n"
            "- Keep paragraphs short and scannable.\n"
            "- Include one clear CTA only.\n"
            "- No markdown symbols or bracketed directions."
        ),
        "ad": (
            "- Provide 3 ad variants.\n"
            "- Each variant must include: Headline, Body (1-2 sentences), CTA.\n"
            "- Keep each variant concise and distinct in angle.\n"
            "- No markdown symbols or bracketed directions."
        ),
    }
    return rules.get(content_type, rules["article"])


def get_output_template(content_type: str) -> str:
    """Return exact output template per content type."""
    templates = {
        "article": (
            "Title: <single line title>\n\n"
            "Introduction:\n<one developed paragraph, 4-7 sentences>\n\n"
            "Section 1 - <short heading>:\n<one developed paragraph, 4-7 sentences>\n"
            "Key Points:\n- <point>\n- <point>\n- <point>\n\n"
            "Section 2 - <short heading>:\n<one developed paragraph, 4-7 sentences>\n"
            "Key Points:\n- <point>\n- <point>\n- <point>\n\n"
            "Section 3 - <short heading>:\n<one developed paragraph, 4-7 sentences>\n"
            "Key Points:\n- <point>\n- <point>\n- <point>\n\n"
            "Section 4 - <short heading>:\n<one developed paragraph, 4-7 sentences>\n"
            "Key Points:\n- <point>\n- <point>\n- <point>\n\n"
            "Conclusion:\n<one developed paragraph, 4-6 sentences>\n\n"
            "Call to Action:\n<2-3 sentences>"
        ),
        "script": (
            "HOOK: <2-3 sentences>\n\n"
            "PROBLEM: <2-3 sentences>\n\n"
            "SOLUTION: <2-3 sentences>\n\n"
            "BENEFITS: <2-3 sentences>\n\n"
            "CALL TO ACTION: <1-2 sentences>"
        ),
        "social": (
            "Hook:\n<1 short line>\n\n"
            "Value:\n<2-4 short lines>\n\n"
            "CTA:\n<1 short line>\n\n"
            "Hashtags:\n<up to 2 hashtags>"
        ),
        "email": (
            "Subject: <single line>\n\n"
            "Greeting: <single line>\n\n"
            "Body:\n<2-3 short paragraphs>\n\n"
            "CTA:\n<1-2 sentences>\n\n"
            "Sign-off:\n<single line>"
        ),
        "ad": (
            "Variant 1\nHeadline: <line>\nBody: <1-2 sentences>\nCTA: <line>\n\n"
            "Variant 2\nHeadline: <line>\nBody: <1-2 sentences>\nCTA: <line>\n\n"
            "Variant 3\nHeadline: <line>\nBody: <1-2 sentences>\nCTA: <line>"
        ),
    }
    return templates.get(content_type, templates["article"])

REVIEW_SYSTEM_PROMPT = """You are a content quality reviewer. 
Score the following content on a scale of 0.0 to 1.0 across these dimensions:
- brand_alignment: How well does it match the brand voice examples?
- clarity: Is the message clear and well-structured?
- engagement: Is the content compelling and likely to engage the audience?
- grammar: Is the grammar and spelling correct?
- overall: Weighted average of all scores.

Output ONLY valid JSON with these keys. No other text.
Example: {"brand_alignment": 0.85, "clarity": 0.9, "engagement": 0.8, "grammar": 0.95, "overall": 0.875}
"""

LOCALIZATION_REFINE_PROMPT = """You are a professional localization editor.
Refine the following {target_locale} translation for marketing/creative tone.
Keep the meaning EXACT. Only fix:
- Idiomatic expressions that don't translate well
- Cultural nuances specific to the {target_locale} market
- Natural flow and readability in {target_locale}

Translation to refine:
{translation}

Output ONLY the refined text. No commentary."""


# ═══════════════════════════════════════════════════════════════
# Agent Definitions
# ═══════════════════════════════════════════════════════════════


def create_scripting_agent() -> BedrockLLMAgent:
    """Create the main content scripting agent. Uses FREE TIER model."""
    return BedrockLLMAgent(BedrockLLMAgentOptions(
        name="scripting-agent",
        description="Generates on-brand content from a brief. Handles articles, scripts, social posts, emails, and ad copy.",
        model_id=settings.bedrock_text_model_id,  # meta.llama3-1-8b-instruct-v1:0 — FREE TIER
        streaming=True,
        inference_config={
            "maxTokens": 2048,
            "temperature": 0.7,
            "topP": 0.9,
        },
    ))


def create_review_agent() -> BedrockLLMAgent:
    """Create the content review/scoring agent. Uses FREE TIER model."""
    return BedrockLLMAgent(BedrockLLMAgentOptions(
        name="review-agent",
        description="Reviews and scores generated content for quality, brand alignment, and engagement.",
        model_id=settings.bedrock_text_lite_model_id,  # amazon.titan-text-lite-v1 — FREE TIER
        streaming=False,
        inference_config={
            "maxTokens": 512,
            "temperature": 0.1,  # Low temperature for consistent scoring
        },
    ))


def create_localization_agent() -> BedrockLLMAgent:
    """Create the localization refinement agent. Uses FREE TIER model."""
    return BedrockLLMAgent(BedrockLLMAgentOptions(
        name="localization-agent",
        description="Refines machine translations for marketing tone and cultural nuance.",
        model_id=settings.bedrock_text_lite_model_id,  # amazon.titan-text-lite-v1 — FREE TIER
        streaming=False,
        inference_config={
            "maxTokens": 1024,
            "temperature": 0.3,
        },
    ))


# ═══════════════════════════════════════════════════════════════
# Orchestrator Setup
# ═══════════════════════════════════════════════════════════════


def create_orchestrator() -> MultiAgentOrchestrator:
    """Create and configure the multi-agent orchestrator."""
    orchestrator = MultiAgentOrchestrator(OrchestratorConfig(
        LOG_AGENT_CHAT=True,
        LOG_CLASSIFIER_CHAT=True,
        LOG_CLASSIFIER_RAW_OUTPUT=False,
        LOG_CLASSIFIER_OUTPUT=True,
        LOG_EXECUTION_TIMES=True,
        MAX_RETRIES=3,
        USE_DEFAULT_AGENT_IF_NONE_IDENTIFIED=True,
    ))

    # Register agents
    orchestrator.add_agent(create_scripting_agent())
    orchestrator.add_agent(create_review_agent())
    orchestrator.add_agent(create_localization_agent())

    logger.info("multi_agent_orchestrator_initialized", agents=["scripting", "review", "localization"])
    return orchestrator


# ═══════════════════════════════════════════════════════════════
# Scripting Agent Workflow
# ═══════════════════════════════════════════════════════════════


async def generate_content(
    brief: str,
    content_type: str,
    brand_context: str,
    user_id: str,
    session_id: str,
    tone: str | None = None,
    max_tokens: int = 2048,
    temperature: float = 0.7,
) -> dict[str, Any]:
    """
    Generate content using the scripting agent with brand RAG context.
    
    Workflow:
    1. Build system prompt with brand context
    2. Call scripting agent
    3. Score result with review agent
    4. Return generated content + quality score
    """
    start_time = time.time()

    # Build system prompt with brand context
    system = SCRIPTING_SYSTEM_PROMPT.format(
        brand_context=brand_context or "No brand context available. Use professional defaults.",
        content_type=content_type,
        format_rules=get_format_rules(content_type),
        output_template=get_output_template(content_type),
    )

    if tone:
        system += f"\nTONE: {tone}"

    # Build the full brief
    full_brief = f"""Create a {content_type} based on this brief and follow the exact structure requirements.

{brief}

Important: Keep the content comprehensive and detailed. Do not reduce it to a short summary.

Remember: Output ONLY the content, using the exact template labels. No preamble, no commentary."""

    def _build_agent(model_id: str) -> BedrockLLMAgent:
        agent = BedrockLLMAgent(BedrockLLMAgentOptions(
            name="scripting-agent",
            description="Generates on-brand content",
            model_id=model_id,
            streaming=False,  # We handle streaming separately at the endpoint level
            inference_config={
                "maxTokens": max_tokens,
                "temperature": temperature,
                "topP": 0.9,
            },
        ))
        agent.set_system_prompt(system)
        return agent

    model_used = settings.bedrock_text_model_id
    agent = _build_agent(model_used)

    try:
        response = await agent.process_request(
            input_text=full_brief,
            user_id=user_id,
            session_id=session_id,
            chat_history=[],
            additional_params={},
        )
    except Exception as e:
        err = str(e)
        fallback_model = settings.bedrock_text_lite_model_id
        if (
            model_used != fallback_model
            and "on-demand throughput" in err
            and "inference profile" in err
        ):
            logger.warning(
                "scripting_agent_model_fallback",
                from_model=model_used,
                to_model=fallback_model,
                reason="on_demand_not_supported",
            )
            model_used = fallback_model
            agent = _build_agent(model_used)
            response = await agent.process_request(
                input_text=full_brief,
                user_id=user_id,
                session_id=session_id,
                chat_history=[],
                additional_params={},
            )
        else:
            raise

    generated_text = str(response.content[0].get("text", "")) if response.content else str(response)
    latency_ms = int((time.time() - start_time) * 1000)

    logger.info(
        "content_generated",
        content_type=content_type,
        model_id=model_used,
        latency_ms=latency_ms,
        brief_length=len(brief),
        output_length=len(generated_text),
    )

    return {
        "text": generated_text,
        "model_id": model_used,
        "latency_ms": latency_ms,
    }


# ═══════════════════════════════════════════════════════════════
# Review Agent Workflow
# ═══════════════════════════════════════════════════════════════


async def score_content(
    content: str,
    brand_context: str,
    content_type: str,
    user_id: str,
    session_id: str,
) -> dict[str, float]:
    """
    Score generated content using the review agent (LLM-as-judge).
    Uses amazon.titan-text-lite-v1 (FREE TIER) for scoring.
    
    Returns quality scores dict with keys:
    brand_alignment, clarity, engagement, grammar, overall
    """
    agent = BedrockLLMAgent(BedrockLLMAgentOptions(
        name="review-agent",
        description="Score content quality",
        model_id=settings.bedrock_text_lite_model_id,  # FREE TIER
        streaming=False,
        inference_config={
            "maxTokens": 512,
            "temperature": 0.1,
        },
    ))

    review_prompt = f"""Score this {content_type} content:

BRAND VOICE EXAMPLES:
{brand_context or "No brand examples available."}

CONTENT TO REVIEW:
{content}

Return ONLY a JSON object with scores (0.0-1.0):
{{"brand_alignment": 0.0, "clarity": 0.0, "engagement": 0.0, "grammar": 0.0, "overall": 0.0}}"""

    agent.set_system_prompt(REVIEW_SYSTEM_PROMPT)

    response = await agent.process_request(
        input_text=review_prompt,
        user_id=user_id,
        session_id=session_id,
        chat_history=[],
        additional_params={},
    )

    response_text = str(response.content[0].get("text", "{}")) if response.content else str(response)

    try:
        scores = json.loads(response_text)
    except json.JSONDecodeError:
        logger.warning("review_score_parse_error", response=response_text)
        scores = {
            "brand_alignment": 0.5,
            "clarity": 0.5,
            "engagement": 0.5,
            "grammar": 0.5,
            "overall": 0.5,
        }

    logger.info("content_scored", scores=scores, model_id=settings.bedrock_text_lite_model_id)
    return scores
