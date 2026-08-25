"""Server-rendered routes for Step 3 product title tasks."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from .products import (
    ProductTaskError,
    create_product_batch,
    get_product,
    get_product_batch,
    list_batch_jobs,
    list_product_batches,
    list_product_services,
    list_product_titles,
    list_products,
    product_counts,
    retry_failed_product_jobs,
    select_title_candidate,
)


def build_product_router(database_path: Path, templates: Jinja2Templates) -> APIRouter:
    router = APIRouter()

    def products_context(request: Request, error: ProductTaskError | None = None) -> dict[str, Any]:
        return {
            "request": request,
            "environment": request.app.state.settings.environment,
            "products": list_products(database_path),
            "batches": list_product_batches(database_path),
            "counts": product_counts(database_path),
            "error": error,
        }

    @router.get("/products", response_class=HTMLResponse, include_in_schema=False)
    def products_page(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(
            request=request,
            name="products.html",
            context=products_context(request),
        )

    @router.post("/product-batches", response_class=HTMLResponse, include_in_schema=False)
    def create_batch(
        request: Request,
        scope: Annotated[str, Form()],
        missing_only: Annotated[str | None, Form()] = None,
    ) -> Response:
        try:
            result = create_product_batch(
                database_path,
                scope=scope,
                missing_only=missing_only == "1",
            )
        except ProductTaskError as exc:
            return templates.TemplateResponse(
                request=request,
                name="products.html",
                context=products_context(request, exc),
                status_code=400,
            )
        return RedirectResponse(
            url=f"/product-batches/{result.batch_id}?created={int(result.created)}",
            status_code=303,
        )

    @router.get("/product-batches/{batch_id}", response_class=HTMLResponse, include_in_schema=False)
    def product_batch_page(request: Request, batch_id: int) -> HTMLResponse:
        try:
            batch = get_product_batch(database_path, batch_id)
            jobs = list_batch_jobs(database_path, batch_id)
        except ProductTaskError as exc:
            return templates.TemplateResponse(
                request=request,
                name="products.html",
                context=products_context(request, exc),
                status_code=404,
            )
        return templates.TemplateResponse(
            request=request,
            name="product_batch.html",
            context={
                "environment": request.app.state.settings.environment,
                "batch": batch,
                "jobs": jobs,
                "created": request.query_params.get("created"),
                "retried": request.query_params.get("retried"),
            },
        )

    @router.post(
        "/product-batches/{batch_id}/retry", response_class=HTMLResponse, include_in_schema=False
    )
    def retry_batch(
        request: Request,
        batch_id: int,
        execution_version: Annotated[int, Form()],
    ) -> Response:
        try:
            retry_failed_product_jobs(
                database_path,
                batch_id,
                expected_execution_version=execution_version,
            )
        except ProductTaskError as exc:
            return templates.TemplateResponse(
                request=request,
                name="products.html",
                context=products_context(request, exc),
                status_code=400,
            )
        return RedirectResponse(url=f"/product-batches/{batch_id}?retried=1", status_code=303)

    @router.get("/products/{product_id}", response_class=HTMLResponse, include_in_schema=False)
    def product_detail(request: Request, product_id: int) -> HTMLResponse:
        try:
            product = get_product(database_path, product_id)
        except ProductTaskError as exc:
            return templates.TemplateResponse(
                request=request,
                name="products.html",
                context=products_context(request, exc),
                status_code=404,
            )
        return templates.TemplateResponse(
            request=request,
            name="product_detail.html",
            context={
                "environment": request.app.state.settings.environment,
                "product": product,
                "titles": list_product_titles(database_path, product_id),
                "services": list_product_services(database_path, product_id),
                "error": None,
                "selected": request.query_params.get("selected"),
            },
        )

    @router.post(
        "/products/{product_id}/title-selection",
        response_class=HTMLResponse,
        include_in_schema=False,
    )
    def select_title(
        request: Request,
        product_id: int,
        candidate_id: Annotated[int, Form()],
        version: Annotated[int, Form()],
    ) -> Response:
        try:
            select_title_candidate(
                database_path,
                product_id=product_id,
                candidate_id=candidate_id,
                expected_version=version,
            )
        except ProductTaskError as exc:
            try:
                product = get_product(database_path, product_id)
            except ProductTaskError:
                return templates.TemplateResponse(
                    request=request,
                    name="products.html",
                    context=products_context(request, exc),
                    status_code=404,
                )
            status_code = 409 if exc.code == "PRODUCT_VERSION_CONFLICT" else 400
            return templates.TemplateResponse(
                request=request,
                name="product_detail.html",
                context={
                    "environment": request.app.state.settings.environment,
                    "product": product,
                    "titles": list_product_titles(database_path, product_id),
                    "services": list_product_services(database_path, product_id),
                    "error": exc,
                    "selected": None,
                },
                status_code=status_code,
            )
        return RedirectResponse(url=f"/products/{product_id}?selected=1", status_code=303)

    return router
