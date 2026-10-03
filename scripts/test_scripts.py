"""Installation and launch contract checks. No desktop window is opened."""

import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1]


class ScriptTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="origin scripts ")
        self.root = Path(self.temp.name) / "原点 工作台"
        self.root.mkdir()
        shutil.copytree(SOURCE / "scripts", self.root / "scripts")
        launcher = SOURCE / "启动原点工作台.command"
        if launcher.exists():
            shutil.copy2(launcher, self.root / launcher.name)
        self.bin = self.root / "test-bin"
        self.bin.mkdir()
        self.env = os.environ.copy()
        for key in ["ORIGIN_BUN", "ORIGIN_UV", "ORIGIN_DATA_DIR", "ORIGIN_ROOT"]:
            self.env.pop(key, None)
        self.env.update({"PATH": str(self.bin) + os.pathsep + self.env["PATH"]})
        self.stub("bun", "printf '1.3.9\\n'\n")
        self.stub("uv", "printf 'uv 0.12.9\\n'\n")

    def tearDown(self):
        self.temp.cleanup()

    def stub(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/bash\nset -eu\n" + body)
        path.chmod(0o755)
        return path

    def run_script(self, path, *args):
        return subprocess.run(
            ["/bin/bash", str(self.root / path), *args],
            env=self.env, cwd=self.temp.name, text=True, capture_output=True, timeout=30,
        )

    def build_fixture(self, failing=False):
        scripts = {
            "node_modules/typescript/bin/tsc": "process.exit(3)" if failing else "require('fs').appendFileSync('steps', 'types\\n')",
            "scripts/check-i18n.js": "require('fs').appendFileSync('steps', 'locales\\n')",
            "node_modules/electron-vite/bin/electron-vite.js": "require('fs').appendFileSync('steps', 'build\\n')",
        }
        for relative, content in scripts.items():
            path = self.root / "desktop" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)

    def launcher_fixture(self):
        executable = self.root / "desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
        executable.parent.mkdir(parents=True)
        executable.write_text("#!/bin/bash\nset -eu\nprintf '%s\\n' \"$ORIGIN_ROOT\" \"$AIONUI_CDP_PORT\" \"${ELECTRON_RUN_AS_NODE-unset}\" \"${ELECTRON_RENDERER_URL-unset}\" > \"$ORIGIN_DATA_DIR/launch-result\"\n")
        executable.chmod(0o755)
        for relative in ["desktop/out/main/index.js", "runtime/backend/aioncore", "runtime/docling-env/bin/python"]:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture")
            path.chmod(0o755)


class NormalScripts(ScriptTest):
    def test_verified_backend_is_reused_without_network(self):
        source = SOURCE / "runtime/backend/aioncore"
        if not source.is_file():
            self.skipTest("Run setup first to verify the backend cache contract")
        destination = self.root / "runtime/backend/aioncore"
        destination.parent.mkdir(parents=True)
        try:
            os.link(source, destination)
        except OSError:
            shutil.copy2(source, destination)
        self.stub("curl", "exit 99\n")
        result = self.run_script("scripts/fetch-backend.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(destination.is_file())

    def test_shared_dependencies_use_current_checkout_and_can_run_twice(self):
        target = self.root / "desktop/node_modules"
        target.mkdir(parents=True)
        (self.root / "vendor/drawnix").mkdir(parents=True)
        for _ in range(2):
            result = self.run_script("scripts/link-dependencies.sh")
            self.assertEqual(result.returncode, 0, result.stderr)
        link = self.root / "vendor/drawnix/node_modules"
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(link), "../../desktop/node_modules")
        self.assertEqual(link.resolve(), target.resolve())

    def test_preflight_checks_dependencies_without_creating_runtime(self):
        result = self.run_script("scripts/setup.sh", "--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / "runtime").exists())

    def test_build_runs_in_its_own_checkout_with_spaces(self):
        self.build_fixture()
        result = self.run_script("scripts/build.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "desktop/steps").read_text(), "types\nlocales\nbuild\n")

    def test_launcher_isolates_local_data_and_disables_debugging(self):
        self.launcher_fixture()
        self.env.update({"ELECTRON_RUN_AS_NODE": "1", "ELECTRON_RENDERER_URL": "http://127.0.0.1:9999"})
        result = self.run_script("启动原点工作台.command")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "data/app/launch-result").read_text().splitlines(), [str(self.root), "0", "unset", "unset"])


class AdversarialScripts(ScriptTest):
    def test_runtime_check_rejects_a_mismatched_electron_runtime(self):
        self.assert_native_runtime_rejected({"electron": "37.10.3", "originSqliteValue": 42})

    def test_runtime_check_rejects_a_failed_database_result(self):
        self.assert_native_runtime_rejected({"electron": "44.4.5", "originSqliteValue": "invalid"})

    def assert_native_runtime_rejected(self, versions):
        executable = self.stub("fake-electron", "printf '%s\\n' '" + json.dumps(versions) + "'\n")
        package = self.root / "desktop/node_modules/electron"
        package.mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({"version": "44.4.5", "main": "index.js"}))
        (package / "index.js").write_text("module.exports = " + json.dumps(str(executable)) + ";")
        result = subprocess.run(
            [self.env.get("ORIGIN_NODE", "node"), str(self.root / "scripts/check-runtime.mjs")],
            env=self.env, text=True, capture_output=True, timeout=30,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Installed Electron does not match", result.stderr)

    def test_existing_vendor_dependencies_are_never_overwritten(self):
        (self.root / "desktop/node_modules").mkdir(parents=True)
        existing = self.root / "vendor/drawnix/node_modules"
        existing.mkdir(parents=True)
        (existing / "user-file").write_text("keep me")
        result = self.run_script("scripts/link-dependencies.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("node_modules", result.stderr)
        self.assertFalse(existing.is_symlink())
        self.assertEqual((existing / "user-file").read_text(), "keep me")

    def test_unsupported_node_stops_before_installation(self):
        self.env["ORIGIN_NODE"] = str(self.stub("node-old", "printf '20.20.0\\n'\n"))
        result = self.run_script("scripts/setup.sh", "--check")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Node.js", result.stderr)
        self.assertFalse((self.root / "runtime").exists())

    def test_wrong_bun_stops_before_installation(self):
        self.stub("bun", "printf '1.4.0\\n'\n")
        result = self.run_script("scripts/setup.sh", "--check")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("1.3.9", result.stderr)
        self.assertFalse((self.root / "runtime").exists())

    def test_unsupported_platform_does_not_create_runtime(self):
        self.stub("uname", "printf 'Linux\\n'\n")
        result = self.run_script("scripts/setup.sh", "--check")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("macOS", result.stderr)
        self.assertFalse((self.root / "runtime").exists())

    def test_failed_typecheck_prevents_build(self):
        self.build_fixture(failing=True)
        result = self.run_script("scripts/build.sh")
        self.assertEqual(result.returncode, 3)
        self.assertFalse((self.root / "desktop/steps").exists())

    def test_bad_backend_cache_and_download_preserve_existing_binary(self):
        backend = self.root / "runtime/backend/aioncore"
        backend.parent.mkdir(parents=True)
        backend.write_text("existing verified backend")
        self.stub("curl", "while [[ $# -gt 0 ]]; do\n  if [[ \"$1\" == --output ]]; then printf 'corrupt archive' > \"$2\"; exit 0; fi\n  shift\ndone\nexit 2\n")
        result = self.run_script("scripts/fetch-backend.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SHA-256", result.stderr)
        self.assertEqual(backend.read_text(), "existing verified backend")

    def test_missing_build_prevents_launcher_execution(self):
        self.launcher_fixture()
        (self.root / "desktop/out/main/index.js").unlink()
        result = self.run_script("启动原点工作台.command")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("scripts/build.sh", result.stderr)
        self.assertFalse((self.root / "data").exists())


if __name__ == "__main__":
    unittest.main()
