from app.routers.auth import register_auth_routes
from app.routers.jobs import register_jobs_routes
from app.routers.trigger import register_trigger_routes
from app.routers.users import register_user_routes

__all__ = [
    "register_auth_routes",
    "register_jobs_routes",
    "register_trigger_routes",
    "register_user_routes",
]
