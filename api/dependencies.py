from typing import Annotated

from fastapi import Cookie

import auth_service


def verify_access(
    jouri_session: Annotated[str | None, Cookie()] = None,
):
    auth_service.verify_access_token(jouri_session)
