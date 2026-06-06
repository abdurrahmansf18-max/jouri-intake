from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import auth_routes
import backup_routes
import log_routes
import parse_routes
import product_routes
import startup_service


@asynccontextmanager
async def lifespan(_: FastAPI):
    startup_service.run_startup_tasks()
    yield


app = FastAPI(title="Jouri Intake API", lifespan=lifespan, docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://syncra.website", "https://www.syncra.website"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(parse_routes.router)
app.include_router(product_routes.router)
app.include_router(backup_routes.router)
app.include_router(log_routes.router)
