import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
	dir: "",
	packaged: true,
	sdkHandlers: new Map<string, (...args: any[]) => void>(),
	appHandlers: new Map<string, (...args: any[]) => void>(),
	nativeHandlers: new Map<string, (...args: any[]) => void>(),
	updater: {
		logger: null as any,
		autoDownload: true,
		autoInstallOnAppQuit: true,
		on: vi.fn(),
		checkForUpdates: vi.fn(),
		downloadUpdate: vi.fn(),
		quitAndInstall: vi.fn(),
	},
}));
vi.mock("node:module", () => ({ createRequire: () => () => ({ autoUpdater: fake.updater }) }));
// @raise/backend 根入口会连带加载整个 Pi SDK（首栽约 7s），而 updater 只用 createLogger；
// mock 掉避免测试在 5s 默认超时内连模块都加载不完
vi.mock("@raise/backend", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("node:child_process", () => ({
	execFile: vi.fn((_file, _args, _options, callback) =>
		callback(null, "", "Authority=Developer ID Application\nTeamIdentifier=TEST"),
	),
}));
vi.mock("electron", () => ({
	app: {
		get isPackaged() {
			return fake.packaged;
		},
		getVersion: () => "0.6.4",
		getPath: (name: string) => (name === "exe" ? join(fake.dir, "Raise.app/Contents/MacOS/Raise") : fake.dir),
		on: (event: string, handler: (...args: any[]) => void) => fake.appHandlers.set(event, handler),
	},
	autoUpdater: {
		on: (event: string, handler: (...args: any[]) => void) => fake.nativeHandlers.set(event, handler),
	},
}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.local/tmp/updater-test");
// process.resourcesPath 是 Electron 运行时才注入的属性，纯 Node（vitest）下为 undefined，
// 而 hasUpdaterConfig/detectManualInstall 直接读它 → 测试里指到临时目录并放一个空 app-update.yml 模拟打包态
const realResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mkdirSync(root, { recursive: true });
	fake.dir = mkdtempSync(join(root, "case-"));
	const resourcesDir = join(fake.dir, "resources");
	mkdirSync(resourcesDir, { recursive: true });
	writeFileSync(join(resourcesDir, "app-update.yml"), "");
	Object.defineProperty(process, "resourcesPath", { value: resourcesDir, configurable: true });
	fake.packaged = true;
	fake.sdkHandlers.clear();
	fake.appHandlers.clear();
	fake.nativeHandlers.clear();
	fake.updater.on.mockImplementation((event, handler) => fake.sdkHandlers.set(event, handler));
	fake.updater.quitAndInstall.mockReset();
	fake.updater.checkForUpdates.mockResolvedValue(null);
	fake.updater.downloadUpdate.mockResolvedValue([]);
});
afterEach(() => {
	rmSync(fake.dir, { recursive: true, force: true });
	if (realResourcesPath) Object.defineProperty(process, "resourcesPath", realResourcesPath);
	else Reflect.deleteProperty(process, "resourcesPath");
});
const log = () => readFileSync(join(fake.dir, "update-diagnostics/updater.jsonl"), "utf8");
const attempt = () =>
	JSON.parse(readFileSync(join(fake.dir, "update-diagnostics/install-attempt.json"), "utf8"));

describe("updater diagnostic wiring", () => {
	it("connects SDK logger and emits bounded metadata without changing download policy", async () => {
		const updater = await import("./updater");
		await updater.initUpdater();
		expect(fake.updater.autoDownload).toBe(false);
		expect(fake.updater.autoInstallOnAppQuit).toBe(true);
		fake.updater.logger.info("Downloading https://user:secret@host/file?token=private");
		fake.sdkHandlers.get("update-available")?.({ version: "0.6.5", files: [{ sha512: "hash", size: 123 }] });
		fake.sdkHandlers.get("update-downloaded")?.({ version: "0.6.5", downloadedFile: "installer.exe" });
		expect(log()).toContain("hash");
		expect(log()).toContain("installer.exe");
		expect(log()).not.toContain("secret");
		expect(log()).not.toContain("private");
	});

	it("persists explicit handoff before quitAndInstall, preserves native handoff and app exit events", async () => {
		const updater = await import("./updater");
		await updater.initUpdater();
		fake.sdkHandlers.get("update-downloaded")?.({ version: "0.6.5" });
		fake.updater.quitAndInstall.mockImplementation(() => {
			expect(attempt().trigger).toBe("explicit");
		});
		updater.installUpdate();
		fake.nativeHandlers.get("before-quit-for-update")?.();
		fake.appHandlers.get("before-quit")?.();
		fake.appHandlers.get("quit")?.({}, 0);
		expect(attempt().trigger).toBe("explicit");
		expect(log()).toContain("before-quit-for-update");
		expect(log()).toContain("app-quit");
	});

	it("records automatic install-on-quit but no handoff on an ordinary quit", async () => {
		const updater = await import("./updater");
		await updater.initUpdater();
		fake.appHandlers.get("before-quit")?.();
		expect(updater.getUpdateDiagnostics().previousInstall).toBe("none");
		fake.sdkHandlers.get("update-downloaded")?.({ version: "0.6.5" });
		fake.appHandlers.get("before-quit")?.();
		expect(attempt().trigger).toBe("app-quit");
	});

	it("keeps errors after download visible in logs while preserving the existing UI-state policy", async () => {
		const updater = await import("./updater");
		await updater.initUpdater();
		const states: string[] = [];
		updater.onUpdateState((state) => states.push(state.phase));
		fake.sdkHandlers.get("update-downloaded")?.({ version: "0.6.5" });
		fake.sdkHandlers.get("error")?.(new Error("installer spawn denied"));
		expect(states).toEqual(["downloaded"]);
		expect(log()).toContain("installer spawn denied");
		expect(log()).toContain("update-error");
	});

	it("records rejected check/download operations", async () => {
		const updater = await import("./updater");
		await updater.initUpdater();
		fake.updater.checkForUpdates.mockRejectedValue(new Error("offline"));
		await updater.checkForUpdates();
		fake.sdkHandlers.get("update-available")?.({ version: "0.6.5" });
		fake.updater.downloadUpdate.mockRejectedValue(new Error("write denied"));
		await updater.downloadUpdate();
		expect(log()).toContain("check-rejected");
		expect(log()).toContain("download-rejected");
	});

	it("dev never starts updates but still supports diagnostic export", async () => {
		fake.packaged = false;
		const updater = await import("./updater");
		await updater.initUpdater();
		updater.installUpdate();
		expect(fake.updater.quitAndInstall).not.toHaveBeenCalled();
		expect(fake.sdkHandlers.size).toBe(0);
		expect(updater.getUpdateDiagnostics().previousInstall).toBe("none");
	});
});
