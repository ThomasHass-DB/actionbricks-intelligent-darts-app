"""Post-build script: injects Lakebase env vars and database resource into .build/app.yml.
Uses only stdlib so it works with any Python interpreter.
"""
import re
from pathlib import Path

APP_YML = Path(__file__).parent.parent / ".build" / "app.yml"

# New env entries — indented to match the existing env list items
INJECT_ENV = """\
  - name: INTELLIGENT_DARTS_LAKEBASE_PROJECT
    value: intelligent-darts
  - name: INTELLIGENT_DARTS_LAKEBASE_HOST
    value: ep-flat-haze-d16jh93f.database.us-west-2.cloud.databricks.com
  - name: INTELLIGENT_DARTS_LAKEBASE_PASSWORD
    valueFrom: lakebase-sp-secret"""

# Lakebase secret resource — grants SP READ access to the secret scope
INJECT_RESOURCE = """\
  - name: lakebase-sp-secret
    description: Static password for the Lakebase SP PostgreSQL role
    secret:
      scope: intelligent-darts
      key: lakebase-sp-password
      permission: READ"""

text = APP_YML.read_text()

# --- Inject env vars ---
if "INTELLIGENT_DARTS_LAKEBASE_PASSWORD" not in text:
    text = re.sub(r"(\n\nresources:)", "\n" + INJECT_ENV + r"\1", text, count=1)
    print("Patched env vars")
else:
    print("Env vars already present, skipping")

# --- Inject secret resource ---
if "name: lakebase-sp-secret" not in text:
    # Append to end of resources list
    text = text.rstrip() + "\n" + INJECT_RESOURCE + "\n"
    print("Patched database resource")
else:
    print("Database resource already present, skipping")

APP_YML.write_text(text)
print(f"Done: {APP_YML}")
