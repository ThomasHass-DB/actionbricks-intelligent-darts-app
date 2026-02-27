"""Post-build script: injects Lakebase env vars into .build/app.yml.
Uses only stdlib so it works with any Python interpreter.
"""
import re
from pathlib import Path

APP_YML = Path(__file__).parent.parent / ".build" / "app.yml"

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
    # Insert after the last existing env entry (before 'resources:')
    text = re.sub(r"(resources:\n)", INJECT + "\n\\1", text, count=1)
    APP_YML.write_text(text)
    print(f"Patched {APP_YML} with Lakebase env vars")
