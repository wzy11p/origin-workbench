#!/bin/bash
# Each normal suite is followed by its adversarial counterpart.
set -uo pipefail
source "$(dirname -- "$0")/common.sh"
origin_require_macos
origin_require_node
origin_result=0
origin_python="$origin_root/runtime/docling-env/bin/python"
[[ -x "$origin_python" && -f "$origin_app/node_modules/vitest/vitest.mjs" ]] ||
  origin_fail '缺少测试依赖，请先运行 bash scripts/setup.sh。'
cd "$origin_root"
"$origin_python" -m unittest discover -s scripts -p test_scripts.py -k NormalScripts || origin_result=1
"$origin_python" -m unittest discover -s scripts -p test_scripts.py -k AdversarialScripts || origin_result=1
cd "$origin_app"
origin_sqlite_tests=(tests/integration/bootstrap/nodeSqliteMigration.test.ts tests/unit/process/services/nodeSqliteDriver.test.ts)
"$origin_node" node_modules/vitest/vitest.mjs run --maxWorkers=2 "${origin_sqlite_tests[@]}" -t normal || origin_result=1
"$origin_node" node_modules/vitest/vitest.mjs run --maxWorkers=2 "${origin_sqlite_tests[@]}" -t adversarial || origin_result=1
"$origin_node" node_modules/vitest/vitest.mjs run --maxWorkers=2 tests/integration/studio tests/unit/renderer/studioSource.dom.test.tsx -t 'normal|studio creation loop' || origin_result=1
"$origin_node" node_modules/vitest/vitest.mjs run --maxWorkers=2 tests/integration/studio tests/unit/renderer/studioSource.dom.test.tsx -t adversarial || origin_result=1
"$origin_node" node_modules/vitest/vitest.mjs run --maxWorkers=2 --config tests/regression/studio/vitest.config.ts -t normal || origin_result=1
"$origin_node" node_modules/vitest/vitest.mjs run --maxWorkers=2 --config tests/regression/studio/vitest.config.ts -t adversarial || origin_result=1
origin_regressions=(tests/unit/common/branding.test.ts tests/unit/renderer/modelBench/stream.test.ts tests/unit/bootstrap/quitCleanup.test.ts)
"$origin_node" node_modules/vitest/vitest.mjs run --maxWorkers=2 "${origin_regressions[@]}" -t 'uses|replaces|brands|preserves UTF-8|reads native|prevents the first quit' || origin_result=1
"$origin_node" node_modules/vitest/vitest.mjs run --maxWorkers=2 "${origin_regressions[@]}" -t 'does not let|preserves upstream|preserves partial|rejects|never exposes|allows the second' || origin_result=1
cd "$origin_root"
"$origin_python" -m unittest discover -s workers -p test_parser.py -k NormalParser || origin_result=1
"$origin_python" -m unittest discover -s workers -p test_parser.py -k AdversarialParser || origin_result=1
exit "$origin_result"
