"""Post-build script: injects Lakebase env vars into .build/app.yml.
Uses only stdlib so it works with any Python interpreter.
"""
import re
from pathlib import Path

APP_YML = Path(__file__).parent.parent / ".build" / "app.yml"

# New env entries — indented to match the existing env list items
INJECT = """\
  - name: INTELLIGENT_DARTS_LAKEBASE_PROJECT
    value: intelligent-darts
  - name: INTELLIGENT_DARTS_LAKEBASE_HOST
    value: ep-flat-haze-d16jh93f.database.us-west-2.cloud.databricks.com"""

text = APP_YML.read_text()

# Skip if already patched
if "INTELLIGENT_DARTS_LAKEBASE_PROJECT" in text:
    print("app.yml already patched, skipping")
else:
    # Insert the new entries right before the blank line that precedes 'resources:'
    text = re.sub(r"(\n\nresources:)", "\n" + INJECT + r"\1", text, count=1)
    APP_YML.write_text(text)
    print(f"Patched {APP_YML} with Lakebase env vars")
