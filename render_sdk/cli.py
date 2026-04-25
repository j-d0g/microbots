"""Optional command-line interface. Register as ``render-sdk`` via pyproject."""

from __future__ import annotations

import click

from . import RenderSDK


def _parse_env_pairs(pairs: tuple[str, ...]) -> dict[str, str]:
    """Parse ``--env KEY=VALUE`` options into a dict.

    Ignores entries without ``=`` so a malformed arg doesn't raise a
    cryptic ``ValueError`` deep in the deploy pipeline.
    """
    parsed: dict[str, str] = {}
    for raw in pairs:
        if "=" not in raw:
            click.echo(f"warning: ignoring malformed --env '{raw}' (expected KEY=VALUE)",
                       err=True)
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        if not key:
            click.echo(f"warning: ignoring --env with empty key: '{raw}'", err=True)
            continue
        parsed[key] = value
    return parsed


@click.group()
def main() -> None:
    """Render Deploy SDK — CLI."""


@main.command()
@click.argument("path")
@click.option("--env", "-e", multiple=True, help="KEY=VALUE env vars (repeatable)")
@click.option("--region", default="fra", help="Render region (default: fra)")
@click.option("--auto-dockerfile", is_flag=True, default=False,
              help="Generate a fallback Dockerfile if none exists.")
def deploy(path: str, env: tuple[str, ...], region: str, auto_dockerfile: bool) -> None:
    """Deploy a local folder to Render."""
    env_vars = _parse_env_pairs(env)
    sdk = RenderSDK()
    result = sdk.deploy(
        path,
        env_vars=env_vars or None,
        region=region,
        auto_generate_dockerfile=auto_dockerfile,
    )
    click.echo(f"\nLive URL: {result.url}")
    click.echo(f"  Service:  {result.service_name} ({result.service_id})")
    click.echo(f"  Duration: {result.duration_s}s  |  New service: {result.is_new}")


@main.command()
@click.argument("path")
def status(path: str) -> None:
    """Show registry status for a deployed path."""
    sdk = RenderSDK()
    info = sdk.status(path)
    if info is None:
        click.echo(f"No service registered for: {path}")
        return
    for k, v in info.items():
        click.echo(f"  {k:<15}: {v}")


@main.command("list")
def list_services() -> None:
    """List all deployed services."""
    sdk = RenderSDK()
    services = sdk.list_services()
    if not services:
        click.echo("No services registered.")
        return
    for svc in services:
        click.echo(
            f"  {svc['service_name']:<30} {svc['live_url']:<50} [{svc['status']}]"
        )


@main.command()
@click.argument("path")
@click.option("--delete-image", is_flag=True, default=False,
              help="Also note that the image should be removed from the registry.")
def teardown(path: str, delete_image: bool) -> None:
    """Delete a Render service and remove it from the registry."""
    sdk = RenderSDK()
    sdk.teardown(path, delete_image=delete_image)
    click.echo(f"Teardown complete for: {path}")


@main.command()
@click.argument("service_id")
@click.option("--tail", default=20, help="Number of deploys to show")
def logs(service_id: str, tail: int) -> None:
    """Show recent deploy events for a service ID."""
    sdk = RenderSDK()
    sdk.stream_logs(service_id, tail=tail)


if __name__ == "__main__":
    main()
