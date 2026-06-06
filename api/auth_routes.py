from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, WebSocket, WebSocketDisconnect, Cookie

import auth_service
from dependencies import verify_access
from models import AuthRequest
from realtime import ws_manager


router = APIRouter()


@router.post("/api/auth/verify")
def auth_verify(body: AuthRequest, response: Response, request: Request):
    client_ip = (request.client.host if request.client else "unknown")
    token = auth_service.verify_login(body.code, client_ip)
    if token is None:
        return {"ok": True}

    response.set_cookie(
        auth_service.AUTH_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=auth_service.COOKIE_SECURE,
        max_age=auth_service.SESSION_TTL,
    )
    return {"ok": True}


@router.get("/api/auth/required")
def auth_required():
    return {"required": auth_service.is_auth_required()}


@router.get("/api/auth/check")
def auth_check(_: Annotated[None, Depends(verify_access)]):
    return {"authed": True}


@router.post("/api/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(auth_service.AUTH_COOKIE_NAME, path="/")
    response.delete_cookie(auth_service.EDIT_UNLOCK_COOKIE_NAME, path="/")
    return {"ok": True}


@router.post("/api/auth/verify-edit-lock")
def verify_edit_lock(body: AuthRequest, response: Response, _: Annotated[None, Depends(verify_access)]):
    token = auth_service.verify_edit_lock_code(body.code)
    if token:
        response.set_cookie(
            auth_service.EDIT_UNLOCK_COOKIE_NAME,
            token,
            httponly=True,
            samesite="lax",
            secure=auth_service.COOKIE_SECURE,
            max_age=auth_service.EDIT_UNLOCK_TTL,
        )
    return {"ok": True}


@router.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    jouri_session: Annotated[str | None, Cookie()] = None,
):
    if auth_service.is_auth_required() and not auth_service.is_valid_session(jouri_session):
        await ws.close(code=4001)
        return
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
