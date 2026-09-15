# Testing

How tests are written and run in {{PROJECT}}. The general evidence rules are in [AGENTS.md](../AGENTS.md#evidence); this document covers what is specific to Python.

## Layout

Tests live in `tests/`, mirroring the package layout, and are named `test_<module>.py`. A test module maps to one source module: `tests/test_store.py` tests `store.py`.

```text
src/{{SLUG}}/
  store.py
  parser.py
tests/
  test_store.py
  test_parser.py
```

Do not put tests beside the source as `*_test.py` inside the package. A test that ships inside the installed package is imported by users' tooling, appears in coverage of the wheel, and cannot be excluded from a type check without an ignore rule.

Fixtures used by more than one module go in `tests/conftest.py`. A fixture used by one module belongs in that module — a shared fixture that turns out to have one consumer is a sign the boundary is wrong, not a reason to keep it central.

## Running

```sh
pytest                          # everything
pytest tests/test_store.py      # one module
pytest -k "expires"             # by name
pytest --lf                     # only what failed last time
```

Select the smallest set that covers the change. A change to one module runs that module's tests; a change to a shared contract runs the owning module's tests plus each consumer's. Do not run the whole suite to be safe — a suite nobody trusts to be fast is a suite that gets skipped.

## What a test must own

A test that passes only when run alone is a defect in the test. Pytest runs tests in one process by default, so anything global is shared:

- **Time.** Never call `datetime.now()` in a test or in code a test exercises directly. Inject the clock, or freeze it with a fixture. A test that asserts on the current date fails on the last day of a month, at midnight, or in a different time zone.
- **Randomness.** Seed it explicitly, or inject the generator. An unseeded test that fails once a month is worse than no test.
- **The filesystem.** Use `tmp_path`, which pytest creates and removes per test. Never write to the working directory, and never assume a path is absent because it was absent last run.
- **The environment.** `monkeypatch.setenv` restores the previous value; assigning `os.environ` directly does not. Use the fixture.
- **Network and external services.** Mock at the boundary the code owns — the function that performs the call — not by patching a library internals. A test that patches `requests.get` is testing the mock.

## Fixtures

Use `tmp_path` for files, `monkeypatch` for the environment, and `capsys` for output. Prefer these over hand-rolled setup and teardown: they are cleaned up even when a test fails.

Yield-style fixtures must put teardown after the `yield`, and the teardown must run even if the test raises:

```python
@pytest.fixture
def server():
    instance = Server()
    instance.start()
    yield instance
    instance.stop()
```

A resource acquired in a fixture and released in a test's final line is not released when the test fails.

## Assertions

Use plain `assert`. Pytest rewrites it to report the values that differed, so the message is already good.

```python
assert result == expected
assert item is not None
```

`assert x == True` and `assert len(items) == 1` are weaker than `assert x` and `assert items == [expected]`. Assert the value, not a property of it, whenever the whole value is known.

Test the failure path explicitly:

```python
with pytest.raises(ValueError, match="unknown mode"):
    parse("nonsense")
```

The `match` is not decoration. Without it the test passes when the code raises the wrong `ValueError` for the wrong reason.

## Naming

A test name describes the behavior, not the method:

```python
def test_expired_token_is_rejected():        # behavior
def test_validate_returns_false():           # restates the method
```

A test that asserts the implementation matches itself proves nothing. If a test has to change every time the implementation is refactored without changing behavior, it is testing the implementation.

## Docstrings

Tests are exempt from the docstring gate: a test's name is its documentation, and a docstring restating the name adds nothing. Add one only when the test encodes a non-obvious reason to exist — a regression it pins, or a boundary it guards.
