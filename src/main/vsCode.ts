import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import { join } from "path";
import { resolveConfigFile } from "./configFiles";

function isExecutableFile(candidate: string | undefined): candidate is string {
  if (!candidate) return false;
  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function detectVSCodePath(): string | null {
  const candidates = [
    process.env["VSCODE_EXECUTABLE"],
    join(
      process.env["LOCALAPPDATA"] ?? "",
      "Programs",
      "Microsoft VS Code",
      "Code.exe",
    ),
    join(
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      "Microsoft VS Code",
      "Code.exe",
    ),
    join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Microsoft VS Code",
      "Code.exe",
    ),
    join(
      process.env["LOCALAPPDATA"] ?? "",
      "Programs",
      "Microsoft VS Code Insiders",
      "Code - Insiders.exe",
    ),
    join(
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      "Microsoft VS Code Insiders",
      "Code - Insiders.exe",
    ),
  ].filter((value): value is string => Boolean(value));

  return candidates.find(isExecutableFile) ?? null;
}

export function openConfigInVSCode(
  instancePath: string,
  relativePath: string,
  configuredPath?: string,
): Promise<boolean> {
  if (process.platform !== "win32") {
    throw new Error(
      "Opening config files in VS Code is supported on Windows only",
    );
  }
  const explicitPath = configuredPath?.trim();
  if (explicitPath && !isExecutableFile(explicitPath)) {
    throw new Error(
      `The VS Code executable path is invalid or no longer exists: ${explicitPath}. Open Settings and select Code.exe.`,
    );
  }
  const executable = explicitPath || detectVSCodePath();
  if (!executable) {
    throw new Error(
      "VS Code was not found. Install Visual Studio Code to use this feature, or open Settings and browse to Code.exe.",
    );
  }
  const filePath = resolveConfigFile(instancePath, relativePath);
  return new Promise((resolve, reject) => {
    const process_ = spawn(executable, ["--new-window", filePath], {
      detached: true,
      stdio: "ignore",
    });
    process_.once("error", (error) => {
      reject(
        new Error(
          `Windows could not start VS Code from the configured path. Check that it points to the installed Code.exe. ${error.message}`,
        ),
      );
    });
    process_.once("spawn", () => {
      process_.unref();
      resolve(true);
    });
  });
}
