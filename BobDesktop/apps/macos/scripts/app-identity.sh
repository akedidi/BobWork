#!/usr/bin/env bash
# Shared Bob Work / Bob Work-test identity — source from packaging scripts.
# Keep these values aligned with:
#   src-tauri/tauri.conf.json
#   src-tauri/tauri.test.conf.json
#   src-tauri/src/app_identity.rs
#   scripts/verify-release-bundle.mjs

BOB_WORK_PROD_PRODUCT_NAME="Bob Work"
BOB_WORK_PROD_IDENTIFIER="com.bobwork.desktop"
BOB_WORK_PROD_EXECUTABLE="bob-work"
BOB_WORK_PROD_BUNDLE_NAME="Bob Work"

BOB_WORK_TEST_PRODUCT_NAME="Bob Work-test"
BOB_WORK_TEST_IDENTIFIER="com.bobwork.desktop.test"
BOB_WORK_TEST_EXECUTABLE="bob-work-test"
BOB_WORK_TEST_BUNDLE_NAME="Bob Work-test"

bob_work_is_test_identifier() {
  case "${1:-}" in
    *.test) return 0 ;;
    *) return 1 ;;
  esac
}
