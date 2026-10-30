from drf_spectacular.extensions import OpenApiAuthenticationExtension


class ScopedAPIKeyScheme(OpenApiAuthenticationExtension):
    target_class = "apps.developers.authentication.ScopedAPIKeyAuthentication"
    name = "DeveloperApiKey"

    def get_security_definition(self, auto_schema):
        return {
            "type": "apiKey",
            "in": "header",
            "name": "X-API-Key",
            "description": "Scoped external developer API key (`edusms_live_...` or `edusms_sim_...`).",
        }


class GatewayTokenScheme(OpenApiAuthenticationExtension):
    target_class = "apps.devices.authentication.GatewayTokenAuthentication"
    name = "GatewayDeviceToken"

    def get_security_definition(self, auto_schema):
        return {
            "type": "apiKey",
            "in": "header",
            "name": "X-Gateway-Token",
            "description": "Paired Android SIM gateway credential (`edugw_...`).",
        }
