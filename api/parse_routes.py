from typing import Annotated

from fastapi import APIRouter, Depends

from dependencies import verify_access
from models import ParseRequest
from parser import parse_description_ai


router = APIRouter()


@router.post("/api/parse-product")
async def parse_product_text(
    req: ParseRequest,
    _: Annotated[None, Depends(verify_access)],
):
    result = await parse_description_ai(req.text, req.imageBase64)
    return result
