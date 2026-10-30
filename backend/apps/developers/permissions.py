from rest_framework import permissions
from .models import APIKey


class HasAPIKeyScopeOrJWT(permissions.BasePermission):
    """
    Allows full first-party access when authenticated via JWT, or enforces explicit
    scope membership when authenticated via an external Developer `APIKey`.
    """

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False

        auth_obj = request.auth
        if isinstance(auth_obj, APIKey):
            scopes_map = getattr(view, "required_scopes_by_method", None)
            if not scopes_map:
                # Endpoints without explicit external API scope mapping are JWT-only
                return False
            needed = scopes_map.get(request.method)
            if not needed:
                return False
            return needed in (auth_obj.scopes or [])

        return True
