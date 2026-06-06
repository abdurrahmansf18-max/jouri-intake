from fastapi import APIRouter

import product_core_routes
import product_image_routes
import product_stock_routes


router = APIRouter()
router.include_router(product_core_routes.router)
router.include_router(product_stock_routes.router)
router.include_router(product_image_routes.router)
