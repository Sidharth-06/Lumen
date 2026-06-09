"""FastAPI entrypoint."""
from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .llm import llm
from .models import (
    CompareRequest,
    CompareResponse,
    HealthResponse,
    RecommendRequest,
    RecommendResponse,
)
from .compare import compare as run_compare
from .pipeline import recommend
from .search import search_client
from .auth.models import AuthUser
from .auth.routes import router as auth_router
from .auth.routes import current_user, optional_user
from .copilot import router as copilot_router
from .trackify.routes import router as trackify_router
from .trackify.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("lumen")

app = FastAPI(
    title="LuMen - Smart Shopping Reader",
    description="Natural-language product recommendations, comparison, and price tracking grounded in live web search.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(copilot_router)
app.include_router(trackify_router)


@app.on_event("startup")
async def startup_event() -> None:
    start_scheduler()


@app.on_event("shutdown")
async def shutdown_event() -> None:
    shutdown_scheduler()


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        search_provider=settings.search_provider,
        firecrawl_enabled=bool(settings.firecrawl_api_key),
    )


@app.post("/api/recommend", response_model=RecommendResponse)
async def recommend_endpoint(
    req: RecommendRequest,
    user: AuthUser | None = Depends(optional_user),
) -> RecommendResponse:
    """Open to guests for their first free search; auth enforced on the frontend for subsequent ones."""
    if not llm.enabled:
        raise HTTPException(
            status_code=503,
            detail="No LLM provider configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY.",
        )
    if not search_client.enabled:
        raise HTTPException(
            status_code=503,
            detail="No search provider configured. Set TAVILY_API_KEY or SERPAPI_API_KEY.",
        )
    try:
        return await recommend(req)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        log.exception("Recommendation failed")
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}") from exc


@app.post("/api/compare", response_model=CompareResponse)
async def compare_endpoint(
    req: CompareRequest,
    user: AuthUser = Depends(current_user),
) -> CompareResponse:
    if not llm.enabled:
        raise HTTPException(
            status_code=503,
            detail="No LLM provider configured. Set GROQ_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY.",
        )
    try:
        return await run_compare(req)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        log.exception("Comparison failed")
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}") from exc
