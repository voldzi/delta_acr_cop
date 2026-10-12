import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve the real Compose substitutions in isolation. Never inherit application
// credentials or load a developer's .env or Docker configuration. Only public
// bundled/system plugin directories are considered; no Docker daemon is contacted.
const composePluginDirs = [
  "/Applications/Docker.app/Contents/Resources/cli-plugins",
  "/usr/local/lib/docker/cli-plugins",
  "/usr/local/libexec/docker/cli-plugins",
  "/usr/lib/docker/cli-plugins",
  "/usr/libexec/docker/cli-plugins"
].filter((path) => existsSync(join(path, "docker-compose")));

function runCompose(args: string[], settings: Record<string, string> = {}, cwd?: string) {
  const dockerConfig = mkdtempSync(join(tmpdir(), "cop-compose-cli-config-"));
  try {
    writeFileSync(join(dockerConfig, "config.json"), JSON.stringify({ cliPluginsExtraDirs: composePluginDirs }));
    return spawnSync("docker", ["compose", ...args], {
      cwd, env: { PATH: process.env.PATH, DOCKER_CONFIG: dockerConfig, ...settings },
      encoding: "utf8", timeout: 10_000
    });
  } finally {
    rmSync(dockerConfig, { recursive: true, force: true });
  }
}

const composeAvailable = runCompose(["version"]).status === 0;

function frontendBuildArgs(settings: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "cop-public-auth-build-"));
  try {
    copyFileSync("docker-compose.yml", join(root, "compose.yml"));
    writeFileSync(join(root, "empty.env"), "");
    const result = runCompose([
      "--env-file", "empty.env", "-f", "compose.yml", "config", "--format", "json"
    ], settings, root);
    if (result.status !== 0) throw new Error("Isolated Compose configuration could not be resolved.");
    const config = JSON.parse(result.stdout) as {
      services: Record<string, { build: { args: Record<string, string> } }>;
    };
    return [config.services["cop-web"].build.args, config.services["cop-chat"].build.args];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("public frontend build authentication", () => {
  it.runIf(composeAvailable)("defaults omitted deployment settings to OIDC without a public lab credential", () => {
    for (const args of frontendBuildArgs()) {
      expect(args.VITE_COP_AUTH_MODE).toBe("oidc");
      expect(args.VITE_COP_PUBLIC_LAB_VALUE).toBe("");
    }
  });

  it.runIf(composeAvailable)("preserves an explicit local lab build", () => {
    for (const args of frontendBuildArgs({
      COP_WEB_AUTH_MODE: "lab", COP_PUBLIC_LAB_VALUE: "synthetic-local-lab-value"
    })) {
      expect(args.VITE_COP_AUTH_MODE).toBe("lab");
      expect(args.VITE_COP_PUBLIC_LAB_VALUE).toBe("synthetic-local-lab-value");
    }
  });

  it.runIf(composeAvailable)("preserves explicit public deployment settings and an empty lab value", () => {
    for (const args of frontendBuildArgs({
      COP_WEB_AUTH_MODE: "hybrid", COP_PUBLIC_LAB_VALUE: "",
      COP_WEB_BFF_SESSION_ENABLED: "true", COP_OIDC_CLIENT_ID: "cop-web",
      COP_OIDC_ISSUER: "https://identity.example.test/realms/cop"
    })) {
      expect(args.VITE_COP_AUTH_MODE).toBe("hybrid");
      expect(args.VITE_COP_PUBLIC_LAB_VALUE).toBe("");
      expect(args.VITE_COP_BFF_SESSION_ENABLED).toBe("true");
      expect(args.VITE_COP_OIDC_CLIENT_ID).toBe("cop-web");
      expect(args.VITE_COP_OIDC_ISSUER).toBe("https://identity.example.test/realms/cop");
    }
  });
});
