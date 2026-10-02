import click
import typer
import argparse
from celery import shared_task

cli_app = typer.Typer()


@shared_task(bind=True)
def processar(self, id):
    return id


@click.command()
@click.option("--n")
def comando(n):
    pass


@cli_app.command()
def outro():
    pass


def principal():
    p = argparse.ArgumentParser(description="x")
    return p.parse_args()
