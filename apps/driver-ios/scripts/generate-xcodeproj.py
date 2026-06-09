#!/usr/bin/env python3
"""
Generator for apps/driver-ios/TowDispatchDriver.xcodeproj/project.pbxproj.

We hand-write the xcodeproj rather than pull in an external project generator
(XcodeGen / Tuist) because the host environment doesn't have them and we want
the verification commands in SESSION_6_REPORT.md to work out of the box.

Re-run this script if you add or remove files from the app target. The SPM
packages discover their own sources via Package.swift and don't need to be
listed here.
"""
import hashlib
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "TowDispatchDriver"
TESTS_DIR = ROOT / "TowDispatchDriverTests"
UITESTS_DIR = ROOT / "TowDispatchDriverUITests"
PBXPROJ = ROOT / "TowDispatchDriver.xcodeproj" / "project.pbxproj"

# Deterministic 24-char hex IDs derived from a stable key.
def gid(key: str) -> str:
    h = hashlib.sha1(key.encode("utf-8")).hexdigest().upper()
    return h[:24]

def list_swift(root: Path) -> List[Path]:
    return sorted(p for p in root.rglob("*.swift") if "Tests" not in str(p.parent) or root.name.endswith("Tests"))

app_sources = sorted(APP_DIR.rglob("*.swift"))
test_sources = sorted(TESTS_DIR.rglob("*.swift")) if TESTS_DIR.exists() else []
uitest_sources = sorted(UITESTS_DIR.rglob("*.swift")) if UITESTS_DIR.exists() else []

# Resource files for the app target.
resource_files = []
info_plist = APP_DIR / "Resources" / "Info.plist"
entitlements = APP_DIR / "Resources" / "TowDispatchDriver.entitlements"
loc_en = APP_DIR / "Resources" / "Localizable.strings"
loc_es = APP_DIR / "Resources" / "es.lproj" / "Localizable.strings"
for p in [loc_en, loc_es]:
    if p.exists():
        resource_files.append(p)

def rel(p: Path) -> str:
    return os.path.relpath(p, ROOT)

# ---------- IDs ----------
PROJECT_ID = gid("project")
APP_TARGET_ID = gid("app-target")
TEST_TARGET_ID = gid("test-target")
UITEST_TARGET_ID = gid("uitest-target")
APP_PRODUCT_ID = gid("app-product")
TEST_PRODUCT_ID = gid("test-product")
UITEST_PRODUCT_ID = gid("uitest-product")
APP_CFG_LIST_ID = gid("app-cfg-list")
TEST_CFG_LIST_ID = gid("test-cfg-list")
UITEST_CFG_LIST_ID = gid("uitest-cfg-list")
PROJECT_CFG_LIST_ID = gid("project-cfg-list")
DEBUG_PROJECT_CFG_ID = gid("debug-project-cfg")
RELEASE_PROJECT_CFG_ID = gid("release-project-cfg")
DEBUG_APP_CFG_ID = gid("debug-app-cfg")
RELEASE_APP_CFG_ID = gid("release-app-cfg")
DEBUG_TEST_CFG_ID = gid("debug-test-cfg")
RELEASE_TEST_CFG_ID = gid("release-test-cfg")
DEBUG_UITEST_CFG_ID = gid("debug-uitest-cfg")
RELEASE_UITEST_CFG_ID = gid("release-uitest-cfg")

APP_SOURCES_PHASE = gid("app-sources-phase")
APP_RESOURCES_PHASE = gid("app-resources-phase")
APP_FRAMEWORKS_PHASE = gid("app-frameworks-phase")
TEST_SOURCES_PHASE = gid("test-sources-phase")
TEST_FRAMEWORKS_PHASE = gid("test-frameworks-phase")
UITEST_SOURCES_PHASE = gid("uitest-sources-phase")
UITEST_FRAMEWORKS_PHASE = gid("uitest-frameworks-phase")

# Swift packages.
CORE_PKG_REF = gid("core-pkg-ref")
DS_PKG_REF = gid("ds-pkg-ref")
CORE_PKG_PROD = gid("core-pkg-prod")
DS_PKG_PROD = gid("ds-pkg-prod")
CORE_PKG_BUILD = gid("core-pkg-build")
DS_PKG_BUILD = gid("ds-pkg-build")

# Groups.
MAIN_GROUP = gid("main-group")
APP_GROUP = gid("app-group")
TEST_GROUP = gid("test-group")
UITEST_GROUP = gid("uitest-group")
PRODUCTS_GROUP = gid("products-group")
PACKAGES_GROUP = gid("packages-group")

# Info.plist file ref.
INFO_PLIST_REF = gid("info-plist")
ENTITLEMENTS_REF = gid("entitlements-ref")

def make_file_ref(path: Path) -> str:
    return gid("fref-" + str(path))

def make_build_file(path: Path, phase: str) -> str:
    return gid(f"bf-{phase}-" + str(path))

# Build the pbxproj content.
out = []
w = out.append

w("// !$*UTF8*$!")
w("{")
w("\tarchiveVersion = 1;")
w("\tclasses = {};")
w("\tobjectVersion = 60;")
w("\tobjects = {")

# ---------- PBXBuildFile ----------
w("/* Begin PBXBuildFile section */")
for src in app_sources:
    bf = make_build_file(src, "app-sources")
    fr = make_file_ref(src)
    w(f"\t\t{bf} /* {src.name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fr} /* {src.name} */; }};")
for src in test_sources:
    bf = make_build_file(src, "test-sources")
    fr = make_file_ref(src)
    w(f"\t\t{bf} /* {src.name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fr} /* {src.name} */; }};")
for src in uitest_sources:
    bf = make_build_file(src, "uitest-sources")
    fr = make_file_ref(src)
    w(f"\t\t{bf} /* {src.name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fr} /* {src.name} */; }};")
# Resources: variant group for Localizable, plus any others
LOC_VARIANT_REF = gid("loc-variant")
LOC_EN_REF = gid("loc-en")
LOC_ES_REF = gid("loc-es")
LOC_BUILD = gid("loc-build")
w(f"\t\t{LOC_BUILD} /* Localizable.strings in Resources */ = {{isa = PBXBuildFile; fileRef = {LOC_VARIANT_REF} /* Localizable.strings */; }};")
# Package products linked into the app
w(f"\t\t{CORE_PKG_BUILD} /* Core in Frameworks */ = {{isa = PBXBuildFile; productRef = {CORE_PKG_PROD} /* Core */; }};")
w(f"\t\t{DS_PKG_BUILD} /* DesignSystem in Frameworks */ = {{isa = PBXBuildFile; productRef = {DS_PKG_PROD} /* DesignSystem */; }};")
w("/* End PBXBuildFile section */")
w("")

# ---------- PBXFileReference ----------
w("/* Begin PBXFileReference section */")
for src in app_sources + test_sources + uitest_sources:
    fr = make_file_ref(src)
    path = rel(src)
    w(f"\t\t{fr} /* {src.name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = \"{path}\"; sourceTree = \"<group>\"; }};")
# Info.plist
w(f"\t\t{INFO_PLIST_REF} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = \"{rel(info_plist)}\"; sourceTree = \"<group>\"; }};")
w(f"\t\t{ENTITLEMENTS_REF} /* TowDispatchDriver.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = \"{rel(entitlements)}\"; sourceTree = \"<group>\"; }};")
# Localizable variants
w(f"\t\t{LOC_EN_REF} /* en */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.strings; name = en; path = \"{rel(loc_en)}\"; sourceTree = \"<group>\"; }};")
w(f"\t\t{LOC_ES_REF} /* es */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.strings; name = es; path = \"{rel(loc_es)}\"; sourceTree = \"<group>\"; }};")
# Products
w(f"\t\t{APP_PRODUCT_ID} /* TowDispatchDriver.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = TowDispatchDriver.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
w(f"\t\t{TEST_PRODUCT_ID} /* TowDispatchDriverTests.xctest */ = {{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = TowDispatchDriverTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; }};")
w(f"\t\t{UITEST_PRODUCT_ID} /* TowDispatchDriverUITests.xctest */ = {{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = TowDispatchDriverUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR; }};")
w("/* End PBXFileReference section */")
w("")

# ---------- PBXVariantGroup for localized strings ----------
w("/* Begin PBXVariantGroup section */")
w(f"\t\t{LOC_VARIANT_REF} /* Localizable.strings */ = {{")
w("\t\t\tisa = PBXVariantGroup;")
w("\t\t\tchildren = (")
w(f"\t\t\t\t{LOC_EN_REF} /* en */,")
w(f"\t\t\t\t{LOC_ES_REF} /* es */,")
w("\t\t\t);")
w("\t\t\tname = Localizable.strings;")
w("\t\t\tsourceTree = \"<group>\";")
w("\t\t};")
w("/* End PBXVariantGroup section */")
w("")

# ---------- PBXGroup ----------
def group_block(group_id: str, name: str, children: List[str], path: Optional[str] = None) -> List[str]:
    lines = []
    lines.append(f"\t\t{group_id} /* {name} */ = {{")
    lines.append("\t\t\tisa = PBXGroup;")
    lines.append("\t\t\tchildren = (")
    for c in children:
        lines.append(f"\t\t\t\t{c},")
    lines.append("\t\t\t);")
    if path:
        lines.append(f"\t\t\tpath = {path};")
    lines.append(f"\t\t\tname = {name};")
    lines.append("\t\t\tsourceTree = \"<group>\";")
    lines.append("\t\t};")
    return lines

w("/* Begin PBXGroup section */")

# Main group
main_children = [
    f"{APP_GROUP} /* TowDispatchDriver */",
    f"{TEST_GROUP} /* TowDispatchDriverTests */",
    f"{UITEST_GROUP} /* TowDispatchDriverUITests */",
    f"{PRODUCTS_GROUP} /* Products */",
]
out.extend(group_block(MAIN_GROUP, "TowDispatchDriver", main_children))

# App group — flat list of all sources/resources
app_children = [f"{make_file_ref(s)} /* {s.name} */" for s in app_sources]
app_children.append(f"{INFO_PLIST_REF} /* Info.plist */")
app_children.append(f"{ENTITLEMENTS_REF} /* TowDispatchDriver.entitlements */")
app_children.append(f"{LOC_VARIANT_REF} /* Localizable.strings */")
out.extend(group_block(APP_GROUP, "TowDispatchDriver", app_children))

# Tests group
test_children = [f"{make_file_ref(s)} /* {s.name} */" for s in test_sources]
out.extend(group_block(TEST_GROUP, "TowDispatchDriverTests", test_children))

uitest_children = [f"{make_file_ref(s)} /* {s.name} */" for s in uitest_sources]
out.extend(group_block(UITEST_GROUP, "TowDispatchDriverUITests", uitest_children))

# Products group
prod_children = [
    f"{APP_PRODUCT_ID} /* TowDispatchDriver.app */",
    f"{TEST_PRODUCT_ID} /* TowDispatchDriverTests.xctest */",
    f"{UITEST_PRODUCT_ID} /* TowDispatchDriverUITests.xctest */",
]
out.extend(group_block(PRODUCTS_GROUP, "Products", prod_children))

w("/* End PBXGroup section */")
w("")

# ---------- PBXSourcesBuildPhase ----------
w("/* Begin PBXSourcesBuildPhase section */")
def sources_phase(phase_id: str, sources: List[Path], phase_key: str):
    w(f"\t\t{phase_id} /* Sources */ = {{")
    w("\t\t\tisa = PBXSourcesBuildPhase;")
    w("\t\t\tbuildActionMask = 2147483647;")
    w("\t\t\tfiles = (")
    for s in sources:
        bf = make_build_file(s, phase_key)
        w(f"\t\t\t\t{bf} /* {s.name} in Sources */,")
    w("\t\t\t);")
    w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    w("\t\t};")
sources_phase(APP_SOURCES_PHASE, app_sources, "app-sources")
sources_phase(TEST_SOURCES_PHASE, test_sources, "test-sources")
sources_phase(UITEST_SOURCES_PHASE, uitest_sources, "uitest-sources")
w("/* End PBXSourcesBuildPhase section */")
w("")

# ---------- PBXResourcesBuildPhase ----------
w("/* Begin PBXResourcesBuildPhase section */")
w(f"\t\t{APP_RESOURCES_PHASE} /* Resources */ = {{")
w("\t\t\tisa = PBXResourcesBuildPhase;")
w("\t\t\tbuildActionMask = 2147483647;")
w("\t\t\tfiles = (")
w(f"\t\t\t\t{LOC_BUILD} /* Localizable.strings in Resources */,")
w("\t\t\t);")
w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
w("\t\t};")
w("/* End PBXResourcesBuildPhase section */")
w("")

# ---------- PBXFrameworksBuildPhase ----------
w("/* Begin PBXFrameworksBuildPhase section */")
def fw_phase(phase_id: str, products: List[str]):
    w(f"\t\t{phase_id} /* Frameworks */ = {{")
    w("\t\t\tisa = PBXFrameworksBuildPhase;")
    w("\t\t\tbuildActionMask = 2147483647;")
    w("\t\t\tfiles = (")
    for p in products:
        w(f"\t\t\t\t{p},")
    w("\t\t\t);")
    w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    w("\t\t};")
fw_phase(APP_FRAMEWORKS_PHASE, [
    f"{CORE_PKG_BUILD} /* Core in Frameworks */",
    f"{DS_PKG_BUILD} /* DesignSystem in Frameworks */",
])
fw_phase(TEST_FRAMEWORKS_PHASE, [])
fw_phase(UITEST_FRAMEWORKS_PHASE, [])
w("/* End PBXFrameworksBuildPhase section */")
w("")

# ---------- PBXNativeTarget ----------
w("/* Begin PBXNativeTarget section */")
# App target
w(f"\t\t{APP_TARGET_ID} /* TowDispatchDriver */ = {{")
w("\t\t\tisa = PBXNativeTarget;")
w(f"\t\t\tbuildConfigurationList = {APP_CFG_LIST_ID} /* Build configuration list for app */;")
w("\t\t\tbuildPhases = (")
w(f"\t\t\t\t{APP_SOURCES_PHASE} /* Sources */,")
w(f"\t\t\t\t{APP_RESOURCES_PHASE} /* Resources */,")
w(f"\t\t\t\t{APP_FRAMEWORKS_PHASE} /* Frameworks */,")
w("\t\t\t);")
w("\t\t\tbuildRules = ();")
w("\t\t\tdependencies = ();")
w("\t\t\tname = TowDispatchDriver;")
w("\t\t\tpackageProductDependencies = (")
w(f"\t\t\t\t{CORE_PKG_PROD} /* Core */,")
w(f"\t\t\t\t{DS_PKG_PROD} /* DesignSystem */,")
w("\t\t\t);")
w("\t\t\tproductName = TowDispatchDriver;")
w(f"\t\t\tproductReference = {APP_PRODUCT_ID} /* TowDispatchDriver.app */;")
w("\t\t\tproductType = \"com.apple.product-type.application\";")
w("\t\t};")
# Test target
w(f"\t\t{TEST_TARGET_ID} /* TowDispatchDriverTests */ = {{")
w("\t\t\tisa = PBXNativeTarget;")
w(f"\t\t\tbuildConfigurationList = {TEST_CFG_LIST_ID} /* Build configuration list for tests */;")
w("\t\t\tbuildPhases = (")
w(f"\t\t\t\t{TEST_SOURCES_PHASE} /* Sources */,")
w(f"\t\t\t\t{TEST_FRAMEWORKS_PHASE} /* Frameworks */,")
w("\t\t\t);")
w("\t\t\tbuildRules = ();")
w("\t\t\tdependencies = ();")
w("\t\t\tname = TowDispatchDriverTests;")
w("\t\t\tproductName = TowDispatchDriverTests;")
w(f"\t\t\tproductReference = {TEST_PRODUCT_ID} /* TowDispatchDriverTests.xctest */;")
w("\t\t\tproductType = \"com.apple.product-type.bundle.unit-test\";")
w("\t\t};")
# UI Test target
w(f"\t\t{UITEST_TARGET_ID} /* TowDispatchDriverUITests */ = {{")
w("\t\t\tisa = PBXNativeTarget;")
w(f"\t\t\tbuildConfigurationList = {UITEST_CFG_LIST_ID} /* Build configuration list for uitests */;")
w("\t\t\tbuildPhases = (")
w(f"\t\t\t\t{UITEST_SOURCES_PHASE} /* Sources */,")
w(f"\t\t\t\t{UITEST_FRAMEWORKS_PHASE} /* Frameworks */,")
w("\t\t\t);")
w("\t\t\tbuildRules = ();")
w("\t\t\tdependencies = ();")
w("\t\t\tname = TowDispatchDriverUITests;")
w("\t\t\tproductName = TowDispatchDriverUITests;")
w(f"\t\t\tproductReference = {UITEST_PRODUCT_ID} /* TowDispatchDriverUITests.xctest */;")
w("\t\t\tproductType = \"com.apple.product-type.bundle.ui-testing\";")
w("\t\t};")
w("/* End PBXNativeTarget section */")
w("")

# ---------- PBXProject ----------
w("/* Begin PBXProject section */")
w(f"\t\t{PROJECT_ID} /* Project object */ = {{")
w("\t\t\tisa = PBXProject;")
w("\t\t\tattributes = {")
w("\t\t\t\tBuildIndependentTargetsInParallel = YES;")
w("\t\t\t\tLastSwiftUpdateCheck = 1530;")
w("\t\t\t\tLastUpgradeCheck = 1530;")
w("\t\t\t\tTargetAttributes = {")
w(f"\t\t\t\t\t{APP_TARGET_ID} = {{ CreatedOnToolsVersion = 15.3; }};")
w(f"\t\t\t\t\t{TEST_TARGET_ID} = {{ CreatedOnToolsVersion = 15.3; TestTargetID = {APP_TARGET_ID}; }};")
w(f"\t\t\t\t\t{UITEST_TARGET_ID} = {{ CreatedOnToolsVersion = 15.3; TestTargetID = {APP_TARGET_ID}; }};")
w("\t\t\t\t};")
w("\t\t\t};")
w(f"\t\t\tbuildConfigurationList = {PROJECT_CFG_LIST_ID} /* Build configuration list for project */;")
w("\t\t\tcompatibilityVersion = \"Xcode 14.0\";")
w("\t\t\tdevelopmentRegion = en;")
w("\t\t\thasScannedForEncodings = 0;")
w("\t\t\tknownRegions = (")
w("\t\t\t\ten,")
w("\t\t\t\tes,")
w("\t\t\t\tBase,")
w("\t\t\t);")
w(f"\t\t\tmainGroup = {MAIN_GROUP};")
w("\t\t\tpackageReferences = (")
w(f"\t\t\t\t{CORE_PKG_REF} /* XCLocalSwiftPackageReference \"Packages/Core\" */,")
w(f"\t\t\t\t{DS_PKG_REF} /* XCLocalSwiftPackageReference \"Packages/DesignSystem\" */,")
w("\t\t\t);")
w(f"\t\t\tproductRefGroup = {PRODUCTS_GROUP} /* Products */;")
w("\t\t\tprojectDirPath = \"\";")
w("\t\t\tprojectRoot = \"\";")
w("\t\t\ttargets = (")
w(f"\t\t\t\t{APP_TARGET_ID} /* TowDispatchDriver */,")
w(f"\t\t\t\t{TEST_TARGET_ID} /* TowDispatchDriverTests */,")
w(f"\t\t\t\t{UITEST_TARGET_ID} /* TowDispatchDriverUITests */,")
w("\t\t\t);")
w("\t\t};")
w("/* End PBXProject section */")
w("")

# ---------- XCLocalSwiftPackageReference ----------
w("/* Begin XCLocalSwiftPackageReference section */")
w(f"\t\t{CORE_PKG_REF} /* XCLocalSwiftPackageReference \"Packages/Core\" */ = {{")
w("\t\t\tisa = XCLocalSwiftPackageReference;")
w("\t\t\trelativePath = Packages/Core;")
w("\t\t};")
w(f"\t\t{DS_PKG_REF} /* XCLocalSwiftPackageReference \"Packages/DesignSystem\" */ = {{")
w("\t\t\tisa = XCLocalSwiftPackageReference;")
w("\t\t\trelativePath = Packages/DesignSystem;")
w("\t\t};")
w("/* End XCLocalSwiftPackageReference section */")
w("")

# ---------- XCSwiftPackageProductDependency ----------
w("/* Begin XCSwiftPackageProductDependency section */")
w(f"\t\t{CORE_PKG_PROD} /* Core */ = {{")
w("\t\t\tisa = XCSwiftPackageProductDependency;")
w(f"\t\t\tpackage = {CORE_PKG_REF} /* XCLocalSwiftPackageReference \"Packages/Core\" */;")
w("\t\t\tproductName = Core;")
w("\t\t};")
w(f"\t\t{DS_PKG_PROD} /* DesignSystem */ = {{")
w("\t\t\tisa = XCSwiftPackageProductDependency;")
w(f"\t\t\tpackage = {DS_PKG_REF} /* XCLocalSwiftPackageReference \"Packages/DesignSystem\" */;")
w("\t\t\tproductName = DesignSystem;")
w("\t\t};")
w("/* End XCSwiftPackageProductDependency section */")
w("")

# ---------- XCBuildConfiguration ----------
common_project_settings = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "CLANG_ANALYZER_NONNULL": "YES",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "CLANG_WARN_DOCUMENTATION_COMMENTS": "YES",
    "COPY_PHASE_STRIP": "NO",
    "ENABLE_NS_ASSERTIONS": "YES",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "GCC_WARN_64_TO_32_BIT_CONVERSION": "YES",
    "GCC_WARN_ABOUT_RETURN_TYPE": "YES_ERROR",
    "GCC_WARN_UNDECLARED_SELECTOR": "YES",
    "GCC_WARN_UNINITIALIZED_AUTOS": "YES_AGGRESSIVE",
    "GCC_WARN_UNUSED_FUNCTION": "YES",
    "GCC_WARN_UNUSED_VARIABLE": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": "16.4",
    "MTL_ENABLE_DEBUG_INFO": "NO",
    "MTL_FAST_MATH": "YES",
    "SDKROOT": "iphoneos",
    "SWIFT_VERSION": "5.9",
}

def write_xc_cfg(cfg_id: str, name: str, settings: Dict[str, str]):
    w(f"\t\t{cfg_id} /* {name} */ = {{")
    w("\t\t\tisa = XCBuildConfiguration;")
    w("\t\t\tbuildSettings = {")
    for k, v in sorted(settings.items()):
        if v.startswith("(") or v.startswith("{"):
            w(f"\t\t\t\t{k} = {v};")
        else:
            w(f"\t\t\t\t{k} = \"{v}\";")
    w("\t\t\t};")
    w(f"\t\t\tname = {name};")
    w("\t\t};")

w("/* Begin XCBuildConfiguration section */")
# Project-level Debug / Release
debug_project = dict(common_project_settings, **{
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "GCC_DYNAMIC_NO_PIC": "NO",
    "GCC_OPTIMIZATION_LEVEL": "0",
    "GCC_PREPROCESSOR_DEFINITIONS": "(\"DEBUG=1\", \"$(inherited)\")",
    "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG",
    "SWIFT_OPTIMIZATION_LEVEL": "-Onone",
})
release_project = dict(common_project_settings, **{
    "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
    "ENABLE_NS_ASSERTIONS": "NO",
    "MTL_ENABLE_DEBUG_INFO": "NO",
    "SWIFT_OPTIMIZATION_LEVEL": "-O",
    "VALIDATE_PRODUCT": "YES",
})
write_xc_cfg(DEBUG_PROJECT_CFG_ID, "Debug", debug_project)
write_xc_cfg(RELEASE_PROJECT_CFG_ID, "Release", release_project)

app_common = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "ENABLE_PREVIEWS": "YES",
    "GENERATE_INFOPLIST_FILE": "NO",
    "INFOPLIST_FILE": f"{rel(info_plist)}",
    "CODE_SIGN_ENTITLEMENTS": f"{rel(entitlements)}",
    "INFOPLIST_KEY_CFBundleDisplayName": "Tow Dispatch",
    "LD_RUNPATH_SEARCH_PATHS": "(\"$(inherited)\", \"@executable_path/Frameworks\")",
    "MARKETING_VERSION": "0.1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": "com.towdispatch.driver",
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "SWIFT_EMIT_LOC_STRINGS": "YES",
    "TARGETED_DEVICE_FAMILY": "1",
}
write_xc_cfg(DEBUG_APP_CFG_ID, "Debug", app_common)
write_xc_cfg(RELEASE_APP_CFG_ID, "Release", app_common)

test_common = {
    "BUNDLE_LOADER": "$(TEST_HOST)",
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "GENERATE_INFOPLIST_FILE": "YES",
    "MARKETING_VERSION": "0.1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": "com.towdispatch.driver.tests",
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "TARGETED_DEVICE_FAMILY": "1",
    "TEST_HOST": "$(BUILT_PRODUCTS_DIR)/TowDispatchDriver.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/TowDispatchDriver",
}
write_xc_cfg(DEBUG_TEST_CFG_ID, "Debug", test_common)
write_xc_cfg(RELEASE_TEST_CFG_ID, "Release", test_common)

uitest_common = {
    "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1",
    "GENERATE_INFOPLIST_FILE": "YES",
    "MARKETING_VERSION": "0.1.0",
    "PRODUCT_BUNDLE_IDENTIFIER": "com.towdispatch.driver.uitests",
    "PRODUCT_NAME": "$(TARGET_NAME)",
    "TARGETED_DEVICE_FAMILY": "1",
    "TEST_TARGET_NAME": "TowDispatchDriver",
}
write_xc_cfg(DEBUG_UITEST_CFG_ID, "Debug", uitest_common)
write_xc_cfg(RELEASE_UITEST_CFG_ID, "Release", uitest_common)

w("/* End XCBuildConfiguration section */")
w("")

# ---------- XCConfigurationList ----------
w("/* Begin XCConfigurationList section */")
def write_cfg_list(cfg_list_id: str, name: str, debug_id: str, release_id: str):
    w(f"\t\t{cfg_list_id} /* {name} */ = {{")
    w("\t\t\tisa = XCConfigurationList;")
    w("\t\t\tbuildConfigurations = (")
    w(f"\t\t\t\t{debug_id} /* Debug */,")
    w(f"\t\t\t\t{release_id} /* Release */,")
    w("\t\t\t);")
    w("\t\t\tdefaultConfigurationIsVisible = 0;")
    w("\t\t\tdefaultConfigurationName = Release;")
    w("\t\t};")
write_cfg_list(PROJECT_CFG_LIST_ID, "Project", DEBUG_PROJECT_CFG_ID, RELEASE_PROJECT_CFG_ID)
write_cfg_list(APP_CFG_LIST_ID, "App", DEBUG_APP_CFG_ID, RELEASE_APP_CFG_ID)
write_cfg_list(TEST_CFG_LIST_ID, "Tests", DEBUG_TEST_CFG_ID, RELEASE_TEST_CFG_ID)
write_cfg_list(UITEST_CFG_LIST_ID, "UITests", DEBUG_UITEST_CFG_ID, RELEASE_UITEST_CFG_ID)
w("/* End XCConfigurationList section */")
w("")

w("\t};")
w(f"\trootObject = {PROJECT_ID} /* Project object */;")
w("}")

PBXPROJ.parent.mkdir(parents=True, exist_ok=True)
PBXPROJ.write_text("\n".join(out) + "\n")

print(f"Wrote {PBXPROJ.relative_to(ROOT)}")
print(f"  App sources:   {len(app_sources)}")
print(f"  Tests:         {len(test_sources)}")
print(f"  UI Tests:      {len(uitest_sources)}")
