/**
 * Expo config plugin that regenerates a fully-wired iMessage (Messages App)
 * extension target from committed sources on every `expo prebuild`.
 *
 * Nothing under `ios/` is meant to be hand edited — the Swift sources live in
 * `./swift`, and this file is responsible for:
 *   1. Copying those sources (plus a generated Info.plist/entitlements/asset
 *      catalog) into `<platformProjectRoot>/WagerPalsMessages/`.
 *   2. Creating an `app_extension` Xcode target, wiring the Swift files into
 *      its Sources phase and the asset catalog into its Resources phase.
 *   3. Configuring build settings, entitlements, and the app-target embed
 *      phase so the extension is signed and bundled with the app.
 *   4. Emitting a shared Xcode scheme so CI can build the extension target
 *      directly (`xcodebuild -scheme WagerPalsMessages ...`).
 */
const {
  withXcodeProject,
  withEntitlementsPlist,
  withDangerousMod,
  createRunOncePlugin,
  IOSConfig,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const EXTENSION_NAME = "WagerPalsMessages";
const EXTENSION_BUNDLE_ID_SUFFIX = ".messages";
const APP_GROUP = "group.com.wagerpals.app";
const KEYCHAIN_ACCESS_GROUP_SUFFIX = "com.wagerpals.shared";
// `$(AppIdentifierPrefix)` is only resolved inside entitlements files — Info.plist
// values are used verbatim by the extension at runtime, so it gets the literal
// team-id-prefixed form instead (see `keychainAccessGroupLiteral` below).
const KEYCHAIN_ACCESS_GROUP_ENTITLEMENT = `$(AppIdentifierPrefix)${KEYCHAIN_ACCESS_GROUP_SUFFIX}`;
const KEYCHAIN_SERVICE = "wagerpals";
const DEPLOYMENT_TARGET = "15.1";
const SWIFT_VERSION = "5.0";
const DEFAULT_TEAM_ID = "3C4383262W";
const DEFAULT_WEB_BASE_URL = "https://wagerpals.io";
const DEFAULT_APP_STORE_ID = "6754625373";
const APP_ICON_SET_NAME = "iMessage App Icon";

// Standard iMessage app icon sizes, taken verbatim from Apple's own
// "Sticker Pack Extension Component.xctemplate" (ships inside Xcode.app) and
// verified locally with:
//   xcrun actool --app-icon "iMessage App Icon" --compile <out> \
//     --platform iphonesimulator --minimum-deployment-target 15.1 \
//     --target-device iphone --target-device ipad Assets.xcassets
// which exits 0 (only "unassigned children" warnings, since we ship no PNGs
// yet). If this ever stops compiling, drop ASSETCATALOG_COMPILER_APPICON_NAME
// below rather than shipping a project that fails `actool` — see the
// try/catch around its assignment.
const STICKER_ICON_SIZES = [
  { size: "32x24", idiom: "universal", scale: "1x", platform: "ios" },
  { size: "32x24", idiom: "universal", scale: "2x", platform: "ios" },
  { size: "32x24", idiom: "universal", scale: "3x", platform: "ios" },
  { size: "1024x768", idiom: "ios-marketing", scale: "1x", platform: "ios" },
  { idiom: "iphone", size: "29x29", scale: "2x" },
  { idiom: "iphone", size: "29x29", scale: "3x" },
  { idiom: "iphone", size: "60x45", scale: "2x" },
  { idiom: "iphone", size: "60x45", scale: "3x" },
  { idiom: "ipad", size: "29x29", scale: "1x" },
  { idiom: "ipad", size: "29x29", scale: "2x" },
  { idiom: "ipad", size: "67x50", scale: "1x" },
  { idiom: "ipad", size: "67x50", scale: "2x" },
  { idiom: "ipad", size: "74x55", scale: "2x" },
];

function resolveProps(config, props) {
  props = props || {};
  const teamId = props.teamId ?? config.ios?.appleTeamId ?? DEFAULT_TEAM_ID;
  const appGroup = props.appGroup ?? APP_GROUP;
  const apiBaseUrl =
    props.apiBaseUrl ?? process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_WEB_BASE_URL;
  const webBaseUrl = props.webBaseUrl ?? DEFAULT_WEB_BASE_URL;
  const appStoreId = props.appStoreId ?? DEFAULT_APP_STORE_ID;
  const appBundleId = config.ios?.bundleIdentifier ?? "com.wagerpals.app";
  const extensionBundleId = `${appBundleId}${EXTENSION_BUNDLE_ID_SUFFIX}`;

  return {
    teamId,
    appGroup,
    apiBaseUrl,
    webBaseUrl,
    appStoreId,
    appBundleId,
    extensionBundleId,
    keychainAccessGroupEntitlement: KEYCHAIN_ACCESS_GROUP_ENTITLEMENT,
    keychainAccessGroupLiteral: `${teamId}.${KEYCHAIN_ACCESS_GROUP_SUFFIX}`,
  };
}

function getSwiftSourceFiles() {
  const swiftDir = path.join(__dirname, "swift");
  if (!fs.existsSync(swiftDir)) {
    throw new Error(
      `[withIMessageExtension] Swift source directory not found: ${swiftDir}. ` +
        `Add the iMessage extension's .swift files to plugins/imessage-extension/swift/ before running prebuild.`
    );
  }
  const files = fs
    .readdirSync(swiftDir)
    .filter((f) => f.endsWith(".swift"))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `[withIMessageExtension] No .swift files found in ${swiftDir}. ` +
        `The iMessage extension needs at least one Swift source file to build.`
    );
  }
  return files;
}

// ---------------------------------------------------------------------------
// Plist serialization
// ---------------------------------------------------------------------------

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistValueXml(value, depth) {
  const pad = "\t".repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<array/>\n`;
    let out = `${pad}<array>\n`;
    for (const item of value) out += plistValueXml(item, depth + 1);
    out += `${pad}</array>\n`;
    return out;
  }
  if (value !== null && typeof value === "object") {
    let out = `${pad}<dict>\n`;
    for (const key of Object.keys(value)) {
      out += `${pad}\t<key>${escapeXml(key)}</key>\n`;
      out += plistValueXml(value[key], depth + 1);
    }
    out += `${pad}</dict>\n`;
    return out;
  }
  if (typeof value === "boolean") {
    return `${pad}<${value ? "true" : "false"}/>\n`;
  }
  if (typeof value === "number") {
    return `${pad}<integer>${value}</integer>\n`;
  }
  return `${pad}<string>${escapeXml(value)}</string>\n`;
}

function handBuildPlistXml(obj) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0">\n` +
    plistValueXml(obj, 0) +
    `</plist>\n`
  );
}

function buildPlistXml(obj) {
  try {
    const plistModule = require("@expo/plist");
    const builder = plistModule && (plistModule.default || plistModule);
    if (builder && typeof builder.build === "function") {
      return builder.build(obj);
    }
  } catch (e) {
    // @expo/plist not resolvable in this environment — fall back to a
    // hand-rolled (but valid) plist serializer below.
  }
  return handBuildPlistXml(obj);
}

function buildExtensionInfoPlistObject(resolved) {
  return {
    CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
    CFBundleDisplayName: "WagerPals",
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundlePackageType: "XPC!",
    CFBundleShortVersionString: "$(MARKETING_VERSION)",
    CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
    NSExtension: {
      NSExtensionPointIdentifier: "com.apple.message-payload-provider",
      NSExtensionPrincipalClass: "$(PRODUCT_MODULE_NAME).MessagesViewController",
    },
    // Custom keys read by the extension's Swift code at runtime.
    WPApiBaseURL: resolved.apiBaseUrl,
    WPWebBaseURL: resolved.webBaseUrl,
    WPAppGroup: resolved.appGroup,
    WPKeychainAccessGroup: resolved.keychainAccessGroupLiteral,
    WPKeychainService: KEYCHAIN_SERVICE,
    WPAppStoreId: resolved.appStoreId,
  };
}

function buildExtensionEntitlementsObject(resolved) {
  return {
    "com.apple.security.application-groups": [resolved.appGroup],
    "keychain-access-groups": [resolved.keychainAccessGroupEntitlement],
  };
}

function writeAssetCatalog(extensionDir) {
  const assetsDir = path.join(extensionDir, "Assets.xcassets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(
    path.join(assetsDir, "Contents.json"),
    JSON.stringify({ info: { version: 1, author: "xcode" } }, null, 2) + "\n"
  );

  const iconSetDir = path.join(assetsDir, `${APP_ICON_SET_NAME}.stickersiconset`);
  fs.mkdirSync(iconSetDir, { recursive: true });
  fs.writeFileSync(
    path.join(iconSetDir, "Contents.json"),
    JSON.stringify({ images: STICKER_ICON_SIZES, info: { version: 1, author: "xcode" } }, null, 2) +
      "\n"
  );
}

function materializeExtensionFiles(platformProjectRoot, resolved) {
  const swiftFiles = getSwiftSourceFiles();
  const swiftSourceDir = path.join(__dirname, "swift");
  const extensionDir = path.join(platformProjectRoot, EXTENSION_NAME);
  fs.mkdirSync(extensionDir, { recursive: true });

  for (const file of swiftFiles) {
    fs.copyFileSync(path.join(swiftSourceDir, file), path.join(extensionDir, file));
  }

  fs.writeFileSync(
    path.join(extensionDir, "Info.plist"),
    buildPlistXml(buildExtensionInfoPlistObject(resolved))
  );
  fs.writeFileSync(
    path.join(extensionDir, `${EXTENSION_NAME}.entitlements`),
    buildPlistXml(buildExtensionEntitlementsObject(resolved))
  );

  writeAssetCatalog(extensionDir);

  return swiftFiles;
}

// ---------------------------------------------------------------------------
// Mods
// ---------------------------------------------------------------------------

function mergeUniqueArray(existing, additions) {
  const merged = Array.isArray(existing) ? [...existing] : [];
  for (const item of additions) {
    if (!merged.includes(item)) merged.push(item);
  }
  return merged;
}

function withIMessageAppEntitlements(config, resolved) {
  return withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.security.application-groups"] = mergeUniqueArray(
      config.modResults["com.apple.security.application-groups"],
      [resolved.appGroup]
    );
    config.modResults["keychain-access-groups"] = mergeUniqueArray(
      config.modResults["keychain-access-groups"],
      [resolved.keychainAccessGroupEntitlement]
    );
    return config;
  });
}

function withIMessageExtensionFiles(config, resolved) {
  // Dangerous mods always run (regardless of whether the Xcode target already
  // exists), so this is what satisfies "refresh Swift/Info.plist/entitlements
  // on disk on every prebuild" even when the pbxproj mutation below is skipped.
  return withDangerousMod(config, [
    "ios",
    (config) => {
      materializeExtensionFiles(config.modRequest.platformProjectRoot, resolved);
      return config;
    },
  ]);
}

function ensureBuildPhase(xcodeProject, isa, comment, targetUuid) {
  const nativeTarget = xcodeProject.pbxNativeTargetSection()[targetUuid];
  const existingRef = (nativeTarget.buildPhases || []).find((p) => p.comment === comment);
  if (existingRef) {
    return xcodeProject.hash.project.objects[isa][existingRef.value];
  }
  const { buildPhase } = xcodeProject.addBuildPhase([], isa, comment, targetUuid);
  return buildPhase;
}

function getMainTargetVersions(xcodeProject, appTargetUuid) {
  const configurations = xcodeProject.pbxXCBuildConfigurationSection();
  const configList =
    xcodeProject.pbxXCConfigurationList()[
      xcodeProject.pbxNativeTargetSection()[appTargetUuid].buildConfigurationList
    ];
  let marketingVersion;
  let currentProjectVersion;
  if (configList && configList.buildConfigurations) {
    for (const ref of configList.buildConfigurations) {
      const settings = configurations[ref.value] && configurations[ref.value].buildSettings;
      if (settings && settings.MARKETING_VERSION) marketingVersion = settings.MARKETING_VERSION;
      if (settings && settings.CURRENT_PROJECT_VERSION)
        currentProjectVersion = settings.CURRENT_PROJECT_VERSION;
    }
  }
  return {
    marketingVersion: marketingVersion || "1.0",
    currentProjectVersion: currentProjectVersion || "1",
  };
}

// `addTarget()` already creates a "Copy Files" phase on the app target and
// pushes the extension's .appex product into it (destination "plugins" ->
// dstSubfolderSpec 13 by default for `app_extension` targets), but that relies
// on internal comment-matching heuristics in the `xcode` package. Re-derive
// and fix it up explicitly here instead of assuming it worked.
function fixEmbedExtensionsPhase(xcodeProject, appTargetUuid, extensionTarget) {
  const appNativeTarget = xcodeProject.pbxNativeTargetSection()[appTargetUuid];
  const phaseRef = (appNativeTarget.buildPhases || []).find((p) => p.comment === "Copy Files");
  if (!phaseRef) {
    throw new Error(
      "[withIMessageExtension] Expected addTarget() to create a Copy Files phase on the app target, but none was found."
    );
  }
  const copyFilesPhase = xcodeProject.hash.project.objects["PBXCopyFilesBuildPhase"][phaseRef.value];
  copyFilesPhase.name = '"Embed Foundation Extensions"';
  copyFilesPhase.dstSubfolderSpec = 13;
  copyFilesPhase.dstPath = copyFilesPhase.dstPath || '""';
  copyFilesPhase.files = copyFilesPhase.files || [];

  const productReference = extensionTarget.pbxNativeTarget.productReference;
  const buildFileSection = xcodeProject.pbxBuildFileSection();
  let buildFileUuid = Object.keys(buildFileSection).find(
    (key) => !key.endsWith("_comment") && buildFileSection[key].fileRef === productReference
  );
  if (!buildFileUuid) {
    buildFileUuid = xcodeProject.generateUuid();
    buildFileSection[buildFileUuid] = {
      isa: "PBXBuildFile",
      fileRef: productReference,
      fileRef_comment: `${EXTENSION_NAME}.appex`,
    };
    buildFileSection[`${buildFileUuid}_comment`] = `${EXTENSION_NAME}.appex in Embed Foundation Extensions`;
  }

  const alreadyEmbedded = copyFilesPhase.files.some((f) => f.value === buildFileUuid);
  if (!alreadyEmbedded) {
    copyFilesPhase.files.push({
      value: buildFileUuid,
      comment: `${EXTENSION_NAME}.appex in Embed Foundation Extensions`,
    });
  }
}

// The `xcode` package is inconsistent about quoting: a PBXNativeTarget parsed
// from an existing pbxproj file has a plain `.name` ("WagerPals"), but a
// target created in-memory via `addTarget()` stores `.name` pre-quoted
// (`"WagerPalsMessages"`, literal quote characters included) and that's what
// gets round-tripped back out on the *next* parse too. `pbxTargetByName`/
// `findTargetKey` compare `.name` with `===`, so depending on which shape the
// project is currently in they silently fail to match — which is exactly
// what caused duplicate targets to be added on repeated prebuilds during
// development of this plugin. Normalize before comparing instead of trusting
// those helpers.
function unquotePbxString(value) {
  if (typeof value !== "string") return value;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function findExtensionTargetUuid(xcodeProject) {
  const nativeTargets = xcodeProject.pbxNativeTargetSection();
  for (const key of Object.keys(nativeTargets)) {
    if (key.endsWith("_comment")) continue;
    const target = nativeTargets[key];
    if (target && unquotePbxString(target.name) === EXTENSION_NAME) {
      return key;
    }
  }
  return null;
}

function getXcodeProjectName(platformProjectRoot) {
  const entry = fs.readdirSync(platformProjectRoot).find((f) => f.endsWith(".xcodeproj"));
  if (!entry) {
    throw new Error(
      `[withIMessageExtension] Could not locate a *.xcodeproj inside ${platformProjectRoot}.`
    );
  }
  return entry.replace(/\.xcodeproj$/, "");
}

function buildSchemeXml({ extensionTargetUuid, projectName }) {
  const containerRef = `container:${projectName}.xcodeproj`;
  const buildableRef =
    `      <BuildableReference\n` +
    `         BuildableIdentifier = "primary"\n` +
    `         BlueprintIdentifier = "${extensionTargetUuid}"\n` +
    `         BuildableName = "${EXTENSION_NAME}.appex"\n` +
    `         BlueprintName = "${EXTENSION_NAME}"\n` +
    `         ReferencedContainer = "${containerRef}">\n` +
    `      </BuildableReference>\n`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Scheme\n` +
    `   LastUpgradeVersion = "1500"\n` +
    `   version = "1.3">\n` +
    `   <BuildAction\n` +
    `      parallelizeBuildables = "YES"\n` +
    `      buildImplicitDependencies = "YES">\n` +
    `      <BuildActionEntries>\n` +
    `         <BuildActionEntry\n` +
    `            buildForTesting = "YES"\n` +
    `            buildForRunning = "YES"\n` +
    `            buildForProfiling = "YES"\n` +
    `            buildForArchiving = "YES"\n` +
    `            buildForAnalyzing = "YES">\n` +
    buildableRef +
    `         </BuildActionEntry>\n` +
    `      </BuildActionEntries>\n` +
    `   </BuildAction>\n` +
    `   <TestAction\n` +
    `      buildConfiguration = "Debug"\n` +
    `      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"\n` +
    `      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"\n` +
    `      shouldUseLaunchSchemeArgsEnv = "YES">\n` +
    `      <Testables>\n` +
    `      </Testables>\n` +
    `   </TestAction>\n` +
    `   <LaunchAction\n` +
    `      buildConfiguration = "Debug"\n` +
    `      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"\n` +
    `      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"\n` +
    `      launchStyle = "0"\n` +
    `      askForAppToLaunch = "YES"\n` +
    `      useCustomWorkingDirectory = "NO"\n` +
    `      ignoresPersistentStateOnLaunch = "NO"\n` +
    `      debugDocumentVersioning = "YES"\n` +
    `      debugServiceExtension = "internal"\n` +
    `      allowLocationSimulation = "YES">\n` +
    `      <MacroExpansion>\n` +
    buildableRef +
    `      </MacroExpansion>\n` +
    `   </LaunchAction>\n` +
    `   <ProfileAction\n` +
    `      buildConfiguration = "Release"\n` +
    `      shouldUseLaunchSchemeArgsEnv = "YES"\n` +
    `      savedToolIdentifier = ""\n` +
    `      useCustomWorkingDirectory = "NO"\n` +
    `      debugDocumentVersioning = "YES">\n` +
    `   </ProfileAction>\n` +
    `   <AnalyzeAction\n` +
    `      buildConfiguration = "Debug">\n` +
    `   </AnalyzeAction>\n` +
    `   <ArchiveAction\n` +
    `      buildConfiguration = "Release"\n` +
    `      revealArchiveInOrganizer = "YES">\n` +
    `   </ArchiveAction>\n` +
    `</Scheme>\n`
  );
}

function writeSharedScheme(platformProjectRoot, projectName, extensionTargetUuid) {
  const schemesDir = path.join(
    platformProjectRoot,
    `${projectName}.xcodeproj`,
    "xcshareddata",
    "xcschemes"
  );
  fs.mkdirSync(schemesDir, { recursive: true });
  fs.writeFileSync(
    path.join(schemesDir, `${EXTENSION_NAME}.xcscheme`),
    buildSchemeXml({ extensionTargetUuid, projectName })
  );
}

function withIMessageXcodeProject(config, resolved) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const platformProjectRoot = config.modRequest.platformProjectRoot;
    const projectName = getXcodeProjectName(platformProjectRoot);

    const appTargetEntry = xcodeProject.getFirstTarget();
    if (!appTargetEntry || !appTargetEntry.uuid || !appTargetEntry.firstTarget) {
      throw new Error(
        "[withIMessageExtension] Could not locate the application's PBXNativeTarget."
      );
    }
    const appTargetUuid = appTargetEntry.uuid;

    // Idempotency: if a previous prebuild already created the target, don't
    // duplicate any pbxproj entries. The dangerous mod above has already
    // refreshed the Swift/Info.plist/entitlements files on disk.
    const existingTargetUuid = findExtensionTargetUuid(xcodeProject);
    if (existingTargetUuid) {
      writeSharedScheme(platformProjectRoot, projectName, existingTargetUuid);
      return config;
    }

    const swiftFiles = getSwiftSourceFiles();

    const target = xcodeProject.addTarget(
      EXTENSION_NAME,
      "app_extension",
      EXTENSION_NAME,
      resolved.extensionBundleId
    );
    if (!target || !target.uuid) {
      throw new Error(
        "[withIMessageExtension] xcodeProject.addTarget() failed to create the extension target."
      );
    }

    // The `xcode` package only knows the generic "app_extension" product type.
    // Real iMessage extensions use the more specific messages subtype so
    // Xcode's own tooling (archive validation, App Store Connect) treats it
    // correctly.
    target.pbxNativeTarget.productType = '"com.apple.product-type.app-extension.messages"';

    // `addTarget()` starts the new target with an empty `buildPhases` array.
    // The `xcode` package's build-phase lookup (`buildPhaseObject`) falls back
    // to a *global* search by comment when a target has no matching phase,
    // which would silently attach our files to the main app's
    // Sources/Resources/Frameworks phase instead of the extension's.
    // Pre-creating empty phases here pins every subsequent addition to the
    // correct target.
    ensureBuildPhase(xcodeProject, "PBXSourcesBuildPhase", "Sources", target.uuid);
    ensureBuildPhase(xcodeProject, "PBXResourcesBuildPhase", "Resources", target.uuid);
    ensureBuildPhase(xcodeProject, "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

    // Group + files. `ensureGroupRecursively`/`addBuildSourceFileToGroup`/
    // `addResourceFileToGroup` are the same helpers Expo's own plugins use to
    // add files to a project; they create exactly one PBXFileReference per
    // file and reuse its uuid for both the PBXGroup child entry and the
    // PBXBuildFile, which is what avoids the duplicate-file-reference bug in
    // the previous implementation (it called `addPbxGroup` *and* fabricated
    // its own PBXFileReference/PBXBuildFile entries for the same files).
    IOSConfig.XcodeUtils.ensureGroupRecursively(xcodeProject, EXTENSION_NAME);

    for (const file of swiftFiles) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: `${EXTENSION_NAME}/${file}`,
        groupName: EXTENSION_NAME,
        project: xcodeProject,
        targetUuid: target.uuid,
      });
    }

    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: `${EXTENSION_NAME}/Assets.xcassets`,
      groupName: EXTENSION_NAME,
      isBuildFile: true,
      project: xcodeProject,
      targetUuid: target.uuid,
    });

    // Real iMessage extensions link Messages.framework — see Apple's own
    // "iMessage Extension.xctemplate" (ships inside Xcode.app), whose
    // TemplateInfo.plist lists `Frameworks: [Messages]` for this target type.
    xcodeProject.addFramework("Messages.framework", { target: target.uuid, link: true });

    const { marketingVersion, currentProjectVersion } = getMainTargetVersions(
      xcodeProject,
      appTargetUuid
    );

    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    const targetConfigList =
      xcodeProject.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    if (targetConfigList && targetConfigList.buildConfigurations) {
      for (const ref of targetConfigList.buildConfigurations) {
        const configObj = configurations[ref.value];
        if (!configObj) continue;
        configObj.buildSettings = configObj.buildSettings || {};
        Object.assign(configObj.buildSettings, {
          PRODUCT_BUNDLE_IDENTIFIER: `"${resolved.extensionBundleId}"`,
          INFOPLIST_FILE: `"${EXTENSION_NAME}/Info.plist"`,
          CODE_SIGN_ENTITLEMENTS: `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`,
          DEVELOPMENT_TEAM: `"${resolved.teamId}"`,
          CODE_SIGN_STYLE: "Automatic",
          IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
          SWIFT_VERSION: SWIFT_VERSION,
          TARGETED_DEVICE_FAMILY: '"1,2"',
          SKIP_INSTALL: "YES",
          MARKETING_VERSION: marketingVersion,
          CURRENT_PROJECT_VERSION: currentProjectVersion,
          LD_RUNPATH_SEARCH_PATHS:
            '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
          GENERATE_INFOPLIST_FILE: "NO",
          ASSETCATALOG_COMPILER_APPICON_NAME: `"${APP_ICON_SET_NAME}"`,
          PRODUCT_NAME: '"$(TARGET_NAME)"',
        });
      }
    }

    // The main app needs to embed the Swift runtime dylibs the extension
    // depends on.
    const appConfigList =
      xcodeProject.pbxXCConfigurationList()[
        xcodeProject.pbxNativeTargetSection()[appTargetUuid].buildConfigurationList
      ];
    if (appConfigList && appConfigList.buildConfigurations) {
      for (const ref of appConfigList.buildConfigurations) {
        const configObj = configurations[ref.value];
        if (configObj && configObj.buildSettings) {
          configObj.buildSettings.ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = "YES";
        }
      }
    }

    fixEmbedExtensionsPhase(xcodeProject, appTargetUuid, target);

    // NOTE: `addTarget()` already calls `addTargetDependency()` internally to
    // wire the app -> extension dependency. Do not call it again here — it has
    // no dedup guard and would add a second PBXTargetDependency entry.

    const projectSection = xcodeProject.pbxProjectSection();
    for (const key of Object.keys(projectSection)) {
      const proj = projectSection[key];
      if (proj && proj.attributes && proj.attributes.TargetAttributes) {
        proj.attributes.TargetAttributes[target.uuid] = {
          DevelopmentTeam: resolved.teamId,
          ProvisioningStyle: "Automatic",
        };
      }
    }

    writeSharedScheme(platformProjectRoot, projectName, target.uuid);

    return config;
  });
}

function withIMessageExtension(config, props) {
  const resolved = resolveProps(config, props);
  config = withIMessageAppEntitlements(config, resolved);
  config = withIMessageExtensionFiles(config, resolved);
  config = withIMessageXcodeProject(config, resolved);
  return config;
}

module.exports = createRunOncePlugin(withIMessageExtension, "wagerpals-imessage-extension", "1.0.0");
