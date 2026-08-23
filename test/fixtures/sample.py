"""Module docstring that mentions def parse and class Thing on purpose."""
import os


def load(path):
    """Read a file.

    Even this docstring says: def nested(): pass
    """
    with open(path) as handle:
        return handle.read()


class Repository:
    """A store."""

    def __init__(self, root):
        self.root = root

    def save(self, record):
        def _validate(value):
            return bool(value)

        if _validate(record):
            return os.path.join(
                self.root,
                record,
            )
        return None

    async def find(self, key):
        return key


TOP_LEVEL = 1


async def main():
    repo = Repository('.')
    return repo
