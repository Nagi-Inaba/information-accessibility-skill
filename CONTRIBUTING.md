# Contributing

Thank you for improving the information-accessibility skill package.

## Before opening a change

1. Search existing issues and pull requests.
2. Keep one behavior change per pull request where practical.
3. Preserve Codex and Claude distribution parity for shared runtime files.
4. Add or update regression tests for behavior changes.
5. Do not commit real audit artifacts, credentials, private URLs, local paths, or personally identifying evidence.

## Verification

Run the package verifier and the tests relevant to your change before requesting review.

```sh
node scripts/verify-package.mjs
node scripts/build-criteria-catalog.mjs --check
node --test tests/*.test.mjs
```

Some platform-specific tests may require their native operating system. State any test you could not run and why.

## Pull requests

Describe the problem, the behavioral change, the verification performed, and any compatibility or security implications. Link the issue when one exists.

Generated or mirrored files must remain synchronized rather than being edited on only one distribution surface.
