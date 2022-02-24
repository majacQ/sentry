import pytest

from sentry.testutils.helpers import override_options


@pytest.fixture(scope="session")
def live_server(live_server):
    mgr = override_options({"system.url-prefix": live_server.url})
    mgr.start()
    yield
    mgr.stop()
