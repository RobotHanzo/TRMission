// Exercises the pbxproj surgery in withLiveActivity.js against the REAL Expo SDK 56 bare template
// project (`__fixtures__/expo-sdk56-bare.pbxproj`, renamed HelloWorld→TRMission exactly as prebuild
// does), because `expo prebuild -p ios` refuses to run off macOS/Linux and nobody on this project
// owns a Mac. The live counterpart is the "Verify the Live Activity widget target was injected" step
// in .github/workflows/mobile-ios.yml, which asserts the same shape after a real prebuild; this test
// is the fast lane that catches a broken plugin without burning a macOS runner. It has already
// caught three silent `xcode`-library traps — see the plugin's comments.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Only the slice of the untyped `xcode` package (and the plugin) this test drives. */
interface PbxObjects {
  [section: string]: Record<string, unknown>;
}
interface PbxProject {
  parseSync(): void;
  writeSync(): string;
  hash: { project: { objects: PbxObjects } };
  pbxNativeTargetSection(): Record<string, { name?: string }>;
  pbxXCBuildConfigurationSection(): Record<string, { buildSettings?: Record<string, string> }>;
  pbxFileReferenceSection(): Record<string, { path?: string }>;
  getFirstProject(): { firstProject: { mainGroup: string } };
}
interface WidgetTargetOptions {
  appName: string;
  appBundleId: string;
  projectRoot: string;
  iosRoot: string;
  buildNumber: string;
  marketingVersion: string;
}

/* eslint-disable @typescript-eslint/no-require-imports */
// `xcode` ships no types, and the plugin is CommonJS (Expo requires it that way).
const xcode = require('xcode') as { project(pbxPath: string): PbxProject };
const { applyLiveActivityTarget, TARGET_NAME, BUNDLE_SUFFIX } = require('./withLiveActivity') as {
  applyLiveActivityTarget(project: PbxProject, opts: WidgetTargetOptions): boolean;
  TARGET_NAME: string;
  BUNDLE_SUFFIX: string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const APP_NAME = 'TRMission';
const APP_BUNDLE_ID = 'dev.robothanzo.trmission';
const FIXTURE = path.join(__dirname, '__fixtures__', 'expo-sdk56-bare.pbxproj');
const MOBILE_ROOT = path.join(__dirname, '..');

const unquote = (v: string | undefined): string => String(v ?? '').replace(/^"(.*)"$/, '$1');

/**
 * `xcode`'s `pbxTargetByName` matches a target's section comment verbatim, and `addTarget` writes
 * that comment QUOTED — so the library helper cannot find the target the plugin created. Look
 * targets up the same quote-tolerant way the plugin does.
 */
const targetByName = (
  project: PbxProject,
  name: string,
): { key?: string; target?: Record<string, never> } => {
  const section = project.pbxNativeTargetSection();
  const key = Object.keys(section).find(
    (k) => !k.endsWith('_comment') && unquote(section[k]?.name) === name,
  );
  return key ? { key, target: section[key] as unknown as Record<string, never> } : {};
};

/** A throwaway `ios/` tree seeded with the template project, as prebuild would leave it. */
const stageProject = (): { iosRoot: string; pbxPath: string; project: PbxProject } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-la-'));
  const iosRoot = path.join(root, 'ios');
  fs.mkdirSync(path.join(iosRoot, `${APP_NAME}.xcodeproj`), { recursive: true });
  const pbxPath = path.join(iosRoot, `${APP_NAME}.xcodeproj`, 'project.pbxproj');
  fs.copyFileSync(FIXTURE, pbxPath);
  const project = xcode.project(pbxPath);
  project.parseSync();
  return { iosRoot, pbxPath, project };
};

const apply = (project: PbxProject, iosRoot: string): boolean =>
  applyLiveActivityTarget(project, {
    appName: APP_NAME,
    appBundleId: APP_BUNDLE_ID,
    // The real projectRoot: the plugin copies the widget sources out of apps/mobile itself.
    projectRoot: MOBILE_ROOT,
    iosRoot,
    buildNumber: '42',
    marketingVersion: '1.2.3',
  });

const settingsForTarget = (project: PbxProject, name: string): Record<string, string>[] => {
  const target = targetByName(project, name).target as unknown as {
    buildConfigurationList: string;
  };
  const list = project.hash.project.objects.XCConfigurationList[
    target.buildConfigurationList
  ] as unknown as { buildConfigurations: { value: string }[] };
  const configs = project.pbxXCBuildConfigurationSection();
  return list.buildConfigurations
    .map((ref) => configs[ref.value]?.buildSettings)
    .filter((s): s is Record<string, string> => !!s);
};

describe('withLiveActivity: widget extension injection', () => {
  it("adds an app-extension target with the widget bundle id and the app's versions", () => {
    const { project, iosRoot } = stageProject();
    expect(apply(project, iosRoot)).toBe(true);

    const target = targetByName(project, TARGET_NAME).target as unknown as { productType: string };
    expect(target).toBeTruthy();
    expect(target.productType).toBe('"com.apple.product-type.app-extension"');

    const configs = settingsForTarget(project, TARGET_NAME);
    expect(configs).toHaveLength(2); // Debug + Release
    for (const settings of configs) {
      expect(settings.PRODUCT_BUNDLE_IDENTIFIER).toBe(`"${APP_BUNDLE_ID}.${BUNDLE_SUFFIX}"`);
      // Version parity with the app is an App Store Connect upload requirement.
      expect(settings.CURRENT_PROJECT_VERSION).toBe('"42"');
      expect(settings.MARKETING_VERSION).toBe('"1.2.3"');
      expect(settings.INFOPLIST_FILE).toBe(`"${TARGET_NAME}/${TARGET_NAME}-Info.plist"`);
      expect(settings.GENERATE_INFOPLIST_FILE).toBe('NO');
      expect(settings.SKIP_INSTALL).toBe('YES');
      // Must override the project-level compiler/linker RN's ccache pass installs at pod-install
      // time — the extension is not a pod target, so RN's $(REACT_NATIVE_PATH)-relative wrapper
      // path expands to nothing there and the archive can't spawn a compiler.
      for (const key of ['CC', 'LD', 'CXX', 'LDPLUSPLUS']) {
        expect(settings[key]).toBe(
          `"$(DT_TOOLCHAIN_DIR)/usr/bin/clang${key === 'CXX' || key === 'LDPLUSPLUS' ? '++' : ''}"`,
        );
      }
      // ActivityKit needs 16.1+; the template's own floor is well past that.
      expect(Number.parseFloat(settings.IPHONEOS_DEPLOYMENT_TARGET ?? '0')).toBeGreaterThanOrEqual(
        16.1,
      );
    }
  });

  it('compiles all three Swift sources, and copies them next to the Info.plist', () => {
    const { project, iosRoot } = stageProject();
    apply(project, iosRoot);

    const widgetDir = path.join(iosRoot, TARGET_NAME);
    for (const file of [
      'TRMissionWidgetBundle.swift',
      'TRMissionLiveActivityWidget.swift',
      'TRMissionActivityAttributes.swift',
      `${TARGET_NAME}-Info.plist`,
    ]) {
      expect(fs.existsSync(path.join(widgetDir, file))).toBe(true);
    }
    // The shared contract is a COPY of the local Expo module's file — one declaration in git.
    const shared = 'TRMissionActivityAttributes.swift';
    expect(fs.readFileSync(path.join(widgetDir, shared), 'utf8')).toBe(
      fs.readFileSync(path.join(MOBILE_ROOT, 'modules', 'live-activity', 'ios', shared), 'utf8'),
    );

    const target = targetByName(project, TARGET_NAME).target as unknown as {
      buildPhases: { value: string; comment: string }[];
    };
    const sourcesRef = target.buildPhases.find((p) => p.comment === 'Sources');
    const sources = project.hash.project.objects.PBXSourcesBuildPhase[
      sourcesRef?.value ?? ''
    ] as unknown as { files: { comment: string }[] };
    // The library's build-file comment is "<basename> in <phase>".
    expect(sources.files.map((f) => f.comment.replace(' in Sources', '')).sort()).toEqual([
      'TRMissionActivityAttributes.swift',
      'TRMissionLiveActivityWidget.swift',
      'TRMissionWidgetBundle.swift',
    ]);
    expect(target.buildPhases.map((p) => p.comment)).toEqual(
      expect.arrayContaining(['Sources', 'Frameworks', 'Resources']),
    );
  });

  it('embeds the .appex into the app target and makes it a build dependency', () => {
    const { project, iosRoot } = stageProject();
    apply(project, iosRoot);

    const app = targetByName(project, APP_NAME).target as unknown as {
      buildPhases: { value: string; comment: string }[];
      dependencies: { value: string }[];
    };
    const objects = project.hash.project.objects;
    const copyRef = app.buildPhases.find((p) => p.comment === 'Copy Files');
    expect(copyRef).toBeTruthy();
    const copyPhase = objects.PBXCopyFilesBuildPhase[copyRef?.value ?? ''] as unknown as {
      dstSubfolderSpec: number | string;
      files: { comment: string }[];
    };
    // 13 = "Plug-ins" (Xcode's "Embed Foundation Extensions" destination).
    expect(String(copyPhase.dstSubfolderSpec)).toBe('13');
    expect(copyPhase.files.map((f) => f.comment)).toContain(`${TARGET_NAME}.appex in Copy Files`);

    // Without the dependency, xcodebuild could run the embed phase before the extension is built.
    expect(app.dependencies).toHaveLength(1);
    const dep = objects.PBXTargetDependency[app.dependencies[0]?.value ?? ''] as unknown as {
      target: string;
    };
    expect(dep.target).toBe(targetByName(project, TARGET_NAME).key);
  });

  it('places the sources in ONE navigator group under the project root, with no duplicate refs', () => {
    const { project, iosRoot } = stageProject();
    apply(project, iosRoot);

    const groups = project.hash.project.objects.PBXGroup as Record<
      string,
      { name?: string; path?: string; children?: { value: string }[] }
    >;
    const groupKey = Object.keys(groups).find(
      (k) => !k.endsWith('_comment') && groups[k]?.name === TARGET_NAME,
    );
    const group = groups[groupKey ?? ''];
    // A group path would resolve its children (which carry `TRMissionWidget/…`) one level too deep.
    expect(group?.path).toBeUndefined();
    expect(group?.children).toHaveLength(4);

    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    expect(groups[mainGroupKey]?.children?.map((c) => c.value)).toContain(groupKey);

    const refs = project.pbxFileReferenceSection();
    const widgetPaths = Object.keys(refs)
      .filter((k) => !k.endsWith('_comment'))
      .map((k) => unquote(refs[k]?.path))
      .filter((p) => p.startsWith(`${TARGET_NAME}/`));
    expect(widgetPaths).toHaveLength(new Set(widgetPaths).size);
  });

  it('is idempotent (a non-clean prebuild re-runs the mods over an existing project)', () => {
    const { project, iosRoot } = stageProject();
    expect(apply(project, iosRoot)).toBe(true);
    expect(apply(project, iosRoot)).toBe(false);
    const targets = Object.keys(project.pbxNativeTargetSection()).filter(
      (k) => !k.endsWith('_comment'),
    );
    expect(targets).toHaveLength(2);
  });

  it('refuses to run when the first target is not the app (it would embed into the wrong one)', () => {
    const { project, iosRoot } = stageProject();
    expect(() =>
      applyLiveActivityTarget(project, {
        appName: 'SomethingElse',
        appBundleId: APP_BUNDLE_ID,
        projectRoot: MOBILE_ROOT,
        iosRoot,
        buildNumber: '1',
        marketingVersion: '1.0.0',
      }),
    ).toThrow(/first Xcode target/);
  });

  it('writes a pbxproj that parses back cleanly, and stays a no-op on re-run', () => {
    const { project, iosRoot, pbxPath } = stageProject();
    apply(project, iosRoot);
    fs.writeFileSync(pbxPath, project.writeSync());

    const reparsed = xcode.project(pbxPath);
    reparsed.parseSync();
    expect(targetByName(reparsed, TARGET_NAME).target).toBeTruthy();
    expect(targetByName(reparsed, APP_NAME).target).toBeTruthy();
    expect(apply(reparsed, iosRoot)).toBe(false);
  });

  // `xcode`'s parser round-trips values it should never have written: a scalar holding `$(…)` must
  // be quoted, and CocoaPods' stricter parser rejects the ENTIRE project when it isn't
  // (`Nanaimo::Reader::ParseError - Dictionary missing ';' after key-value pair for "CC", found
  // "("`) — which kills `pod install`, not just the archive. So check the written text directly.
  it('quotes every scalar build setting that interpolates a build variable', () => {
    const { project, iosRoot } = stageProject();
    apply(project, iosRoot);

    const offenders = project
      .writeSync()
      .split('\n')
      // Scalar assignments only: `KEY = value;`. Arrays/dicts open with ( or { and span lines.
      .map((line) => /^\s*([A-Za-z_][\w.[\]]*)\s*=\s*(.+);\s*$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(([, key, value]) => [key, value.replace(/\s*\/\*.*\*\/\s*$/, '')] as const)
      .filter(([, value]) => value.includes('$(') && !value.startsWith('"'));
    expect(offenders).toEqual([]);
  });

  // The in-memory project is not the artifact — Xcode reads the SERIALIZED one, and the writer's
  // omitEmptyValues defaults to false, so a key holding `undefined` lands as the literal string.
  // `path = undefined` on the widget group is what made a real archive resolve its sources to
  // `ios/undefined/TRMissionWidget/…` ("Build input files cannot be found") while every in-memory
  // assertion above still passed.
  it('serializes no `undefined` values, so Xcode resolves the sources at the project root', () => {
    const { project, iosRoot, pbxPath } = stageProject();
    apply(project, iosRoot);
    const written = project.writeSync();
    expect(written).not.toContain('undefined');

    fs.writeFileSync(pbxPath, written);
    const reparsed = xcode.project(pbxPath);
    reparsed.parseSync();
    const groups = reparsed.hash.project.objects.PBXGroup as Record<
      string,
      { name?: string; path?: string }
    >;
    const group = Object.keys(groups)
      .filter((k) => !k.endsWith('_comment'))
      .map((k) => groups[k])
      .find((g) => g?.name === TARGET_NAME);
    expect(group).toBeTruthy();
    expect('path' in (group as object)).toBe(false);
  });
});
