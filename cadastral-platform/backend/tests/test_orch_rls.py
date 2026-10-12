"""Run the orchestrator as a non-superuser role so row-level security is really enforced."""
import psycopg
import pytest
from psycopg.conninfo import make_conninfo

from app.common.contracts import RunStatus
from app.common.db import make_pool
from app.orchestrator.core import Orchestrator
from app.orchestrator.inputs import RunRequest
from test_orch_support import ack_all, fake_registry, fast_config, make_project, make_user, pool, dsn  # noqa: F401
from collections import Counter


@pytest.fixture(scope="module")
def app_pool(dsn, pool):
    with pool.connection() as conn:
        if not conn.execute("SELECT rolsuper FROM pg_roles WHERE rolname=current_user").fetchone()["rolsuper"]:
            pytest.skip("need a superuser to create the test role")
        conn.execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orch_app_test') THEN "
                     "CREATE ROLE orch_app_test LOGIN; END IF; END $$")
        conn.execute("GRANT USAGE ON SCHEMA core, legal, agents, plans, cadastre, planning, terrain, utilities, annotations TO orch_app_test")
        conn.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, legal, agents, plans TO orch_app_test")
        conn.execute("GRANT USAGE ON ALL SEQUENCES IN SCHEMA agents, core, legal, plans TO orch_app_test")
        conn.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core, legal, agents TO orch_app_test")
    p = make_pool(make_conninfo(dsn, user="orch_app_test"), min_size=1, max_size=8)
    yield p
    p.close()


def test_orchestrator_under_rls(pool, app_pool):
    uid = make_user(pool)
    project = make_project(pool, uid)
    ack_all(pool, uid, project)
    orch = Orchestrator(app_pool, fake_registry(Counter()), fast_config())
    run = orch.create_run(uid, RunRequest(project_id=project))
    assert orch.execute_run(run.run_id, uid).status is RunStatus.succeeded
    assert orch.get_run(run.run_id, uid)["tokens_used"] == 0
    stranger = make_user(pool)
    from app.orchestrator.core import RunNotFound
    with pytest.raises(RunNotFound):
        orch.load_run(run.run_id, stranger)
