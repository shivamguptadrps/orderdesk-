async def test_health_returns_ok_with_db(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "db": "ok", "env": "test"}


async def test_web_app_is_served_when_installed(client, monkeypatch, tmp_path):
    from app.core.config import get_settings

    (tmp_path / "_expo" / "static").mkdir(parents=True)
    (tmp_path / "index.html").write_text("<html>OrderDesk web</html>")
    (tmp_path / "_expo" / "static" / "app-abc123.js").write_text("console.log(1)")
    monkeypatch.setattr(get_settings(), "web_dir", str(tmp_path))

    res = await client.get("/app/_expo/static/app-abc123.js")
    assert res.status_code == 200 and "immutable" in res.headers["cache-control"]
    # deep links fall back to the app page
    res = await client.get("/app/manage/shops")
    assert res.status_code == 200 and "OrderDesk web" in res.text and res.headers["cache-control"] == "no-cache"
    # no escaping the folder
    res = await client.get("/app/../../etc/passwd")
    assert "root:" not in res.text
    # a browser opening the site root goes to the app; API clients still get JSON
    assert (await client.get("/", headers={"Accept": "text/html"})).headers["location"] == "/app/"
    assert (await client.get("/")).json()["web_app"] == "/app/"


async def test_web_app_off_by_default(client):
    assert (await client.get("/app/")).status_code == 404
    assert (await client.get("/", headers={"Accept": "text/html"})).status_code == 200
