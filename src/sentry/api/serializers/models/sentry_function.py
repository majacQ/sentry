from sentry.api.serializers import Serializer, register
from sentry.models.sentryfunction import SentryFunction


@register(SentryFunction)
class SentryFunctionSerializer(Serializer):
    def serialize(self, obj, attrs, user):
        events = [event for event in obj.events]
        data = {
            "organization": obj.organization,
            "name": obj.name,
            "code": obj.code,
            "slug": obj.slug,
            "author": obj.author,
            "overview": obj.overview,
            "events": events,
            "external_id": obj.external_id,
        }

        return data
