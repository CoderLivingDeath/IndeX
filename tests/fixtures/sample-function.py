import os
from pathlib import Path
import json as json_lib

def calculate_total(items):
    """Calculate the sum of all items."""
    return sum(items)

class DataProcessor:
    def __init__(self, prefix):
        self.prefix = prefix

    def process(self, data):
        return f"{self.prefix}: {data}"
