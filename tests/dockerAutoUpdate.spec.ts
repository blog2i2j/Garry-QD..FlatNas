import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAutoUpdateTick } from "../server/dockerAutoUpdate.js";

const makeDocker = (overrides = {}) => {
  const docker = {
    info: vi.fn().mockResolvedValue({ DockerRootDir: "/var/lib/docker" }),
    listContainers: vi.fn().mockResolvedValue([]),
    pull: vi.fn((imageName, cb) => cb(null, {})),
    modem: {
      followProgress: vi.fn((stream, onFinished) => onFinished(null, [])),
    },
    getContainer: vi.fn(() => ({
      inspect: vi.fn().mockResolvedValue({
        Config: { Image: "nginx:latest" },
        Image: "sha256:old",
        Name: "/c1",
        State: { Running: true, Status: "running" },
        HostConfig: {},
        NetworkSettings: { Networks: {} },
      }),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    })),
    getImage: vi.fn(() => ({
      inspect: vi.fn().mockResolvedValue({ Id: "sha256:old", RepoDigests: ["nginx@sha256:d1"] }),
      distributionInspect: vi.fn((cb) => cb(null, { Descriptor: { digest: "sha256:d1" } })),
      remove: vi.fn().mockResolvedValue(undefined),
    })),
    createContainer: vi.fn().mockResolvedValue({
      id: "new-container-id",
      start: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  };
  return docker;
};

const makeSi = (availableBytes = 100 * 1024 * 1024 * 1024) => ({
  fsSize: vi.fn().mockResolvedValue([{ mount: "/", available: availableBytes }]),
});

describe("docker auto update", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when autoUpdate is disabled", async () => {
    const docker = makeDocker({
      info: vi.fn(() => {
        throw new Error("should_not_call");
      }),
    });
    const si = makeSi();
    const systemConfig = { authMode: "single" };
    const adminData = { widgets: [{ id: "docker", type: "docker", data: { autoUpdate: false } }] };

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "x",
      atomicWrite: vi.fn(),
      updateContainerIdGlobally: vi.fn(),
    });

    expect(result.enabled).toBe(false);
  });

  it("skips when free disk space is below threshold", async () => {
    const docker = makeDocker();
    const si = makeSi(0);
    const systemConfig = { authMode: "single" };
    const adminData = {
      widgets: [
        { id: "docker", type: "docker", data: { autoUpdate: true, autoUpdateMinFreeGB: 1 } },
      ],
    };

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "x",
      atomicWrite: vi.fn(),
      updateContainerIdGlobally: vi.fn(),
    });

    expect(result.enabled).toBe(true);
    expect(result.skippedDueToDisk).toBe(true);
    expect(docker.listContainers).not.toHaveBeenCalled();
  });

  it("pulls but does not update when there is no new version", async () => {
    const docker = makeDocker({
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: "c1",
          Names: ["/c1"],
          Image: "nginx:latest",
          ImageID: "sha256:old",
          State: "running",
        },
      ]),
      getContainer: vi.fn(() => ({
        inspect: vi.fn().mockResolvedValue({
          Config: { Image: "nginx:latest" },
          Image: "sha256:old",
          Name: "/c1",
          State: { Running: true, Status: "running" },
          HostConfig: {},
          NetworkSettings: { Networks: {} },
        }),
      })),
      getImage: vi.fn(() => ({
        inspect: vi
          .fn()
          .mockResolvedValue({ Id: "sha256:old", RepoDigests: ["nginx@sha256:same"] }),
        distributionInspect: vi.fn((cb) => cb(null, { Descriptor: { digest: "sha256:same" } })),
        remove: vi.fn().mockResolvedValue(undefined),
      })),
    });
    const si = makeSi();
    const systemConfig = { authMode: "single" };
    const adminData = { widgets: [{ id: "docker", type: "docker", data: { autoUpdate: true } }] };
    const atomicWrite = vi.fn().mockResolvedValue(undefined);

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "system.json",
      atomicWrite,
      updateContainerIdGlobally: vi.fn(),
    });

    expect(result.enabled).toBe(true);
    expect(result.pulls).toBe(0);
    expect(result.updates).toBe(0);
    expect(atomicWrite).toHaveBeenCalledTimes(1);
    const content = atomicWrite.mock.calls[0]?.[1];
    const saved = JSON.parse(String(content));
    expect(saved.dockerAutoUpdate.history.images["nginx:latest"][0]).toBe("sha256:old");
  });

  it("updates container and prunes old images beyond keep limit", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const docker = makeDocker({
      listContainers: vi
        .fn()
        .mockResolvedValueOnce([
          {
            Id: "c1",
            Names: ["/c1"],
            Image: "nginx:latest",
            ImageID: "sha256:id2",
            State: "running",
          },
        ])
        .mockResolvedValueOnce([
          {
            Id: "new-container-id",
            Names: ["/c1"],
            Image: "nginx:latest",
            ImageID: "sha256:id4",
            State: "running",
          },
        ]),
      getContainer: vi.fn((id) => ({
        inspect: vi.fn().mockResolvedValue(
          id === "new-container-id"
            ? {
                Config: { Image: "nginx:latest" },
                Image: "sha256:id4",
                Name: "/c1",
                State: { Running: true, Status: "running" },
                HostConfig: {},
                NetworkSettings: { Networks: {} },
              }
            : {
                Config: { Image: "nginx:latest" },
                Image: "sha256:id2",
                Name: "/c1",
                State: { Running: true, Status: "running" },
                HostConfig: {},
                NetworkSettings: { Networks: {} },
              },
        ),
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      })),
      getImage: vi.fn((idOrName) => ({
        inspect: vi
          .fn()
          .mockResolvedValue(
            idOrName === "nginx:latest"
              ? { Id: "sha256:id4", RepoDigests: ["nginx@sha256:new"] }
              : { Id: idOrName },
          ),
        distributionInspect: vi.fn((cb) =>
          cb(null, { Descriptor: { digest: "sha256:remote-new" } }),
        ),
        remove,
      })),
      createContainer: vi.fn().mockResolvedValue({
        id: "new-container-id",
        start: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const si = makeSi();
    const systemConfig = {
      authMode: "single",
      dockerAutoUpdate: {
        history: { images: { "nginx:latest": ["sha256:id3", "sha256:id2", "sha256:id1"] } },
      },
    };
    const adminData = {
      widgets: [
        {
          id: "docker",
          type: "docker",
          data: { autoUpdate: true, autoUpdateKeepImages: 2, autoUpdateMaxPrunePerRun: 1 },
        },
      ],
    };

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "system.json",
      atomicWrite: vi.fn().mockResolvedValue(undefined),
      updateContainerIdGlobally: vi.fn(),
      healthCheck: { timeoutMs: 1000, intervalMs: 1 },
      sleep: () => Promise.resolve(),
    });

    expect(result.updates).toBe(1);
    expect(result.pruned).toBe(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("records errors on pull failure without updating", async () => {
    const docker = makeDocker({
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: "c1",
          Names: ["/c1"],
          Image: "nginx:latest",
          ImageID: "sha256:old",
          State: "running",
        },
      ]),
      // Ensure shouldPull=true by simulating a digest mismatch
      getImage: vi.fn(() => ({
        inspect: vi.fn().mockResolvedValue({ Id: "sha256:old", RepoDigests: ["nginx@sha256:old"] }),
        distributionInspect: vi.fn((cb) => cb(null, { Descriptor: { digest: "sha256:new" } })),
        remove: vi.fn().mockResolvedValue(undefined),
      })),
      pull: vi.fn((imageName, cb) => cb(new Error("network_error"))),
    });
    const si = makeSi();
    const systemConfig = { authMode: "single" };
    const adminData = { widgets: [{ id: "docker", type: "docker", data: { autoUpdate: true } }] };

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "system.json",
      atomicWrite: vi.fn().mockResolvedValue(undefined),
      updateContainerIdGlobally: vi.fn(),
    });

    expect(result.pulls).toBe(0);
    expect(result.updates).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("skips update when container is unhealthy before upgrade", async () => {
    const docker = makeDocker({
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: "c1",
          Names: ["/c1"],
          Image: "nginx:latest",
          ImageID: "sha256:old",
          State: "running",
        },
      ]),
      getContainer: vi.fn(() => ({
        inspect: vi.fn().mockResolvedValue({
          Config: { Image: "nginx:latest" },
          Image: "sha256:old",
          Name: "/c1",
          State: { Running: true, Status: "running", Health: { Status: "unhealthy" } },
          HostConfig: {},
          NetworkSettings: { Networks: {} },
        }),
      })),
    });
    const si = makeSi();
    const systemConfig = { authMode: "single" };
    const adminData = { widgets: [{ id: "docker", type: "docker", data: { autoUpdate: true } }] };

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "system.json",
      atomicWrite: vi.fn().mockResolvedValue(undefined),
      updateContainerIdGlobally: vi.fn(),
    });

    expect(result.updates).toBe(0);
    expect(docker.pull).not.toHaveBeenCalled();
  });

  it("rolls back when new container becomes unhealthy", async () => {
    const updateContainerIdGlobally = vi.fn().mockResolvedValue(undefined);
    const docker = makeDocker({
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: "c1",
          Names: ["/c1"],
          Image: "nginx:stable",
          ImageID: "sha256:old",
          State: "running",
        },
      ]),
      getContainer: vi.fn((id) => ({
        inspect: vi.fn().mockResolvedValue(
          id === "new-container-id"
            ? {
                Config: { Image: "nginx:stable" },
                Image: "sha256:new",
                Name: "/c1",
                State: { Running: true, Status: "running", Health: { Status: "unhealthy" } },
                HostConfig: {},
                NetworkSettings: { Networks: {} },
              }
            : id === "restored-id"
              ? {
                  Config: { Image: "sha256:old" },
                  Image: "sha256:old",
                  Name: "/c1",
                  State: { Running: true, Status: "running" },
                  HostConfig: {},
                  NetworkSettings: { Networks: {} },
                }
              : {
                  Config: { Image: "nginx:stable" },
                  Image: "sha256:old",
                  Name: "/c1",
                  State: { Running: true, Status: "running" },
                  HostConfig: {},
                  NetworkSettings: { Networks: {} },
                },
        ),
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      })),
      getImage: vi.fn(() => ({
        inspect: vi
          .fn()
          .mockResolvedValue({ Id: "sha256:new", RepoDigests: ["nginx@sha256:newd"] }),
        distributionInspect: vi.fn((cb) =>
          cb(null, { Descriptor: { digest: "sha256:remote-newd" } }),
        ),
        remove: vi.fn().mockResolvedValue(undefined),
      })),
      createContainer: vi
        .fn()
        .mockResolvedValueOnce({
          id: "new-container-id",
          start: vi.fn().mockResolvedValue(undefined),
        })
        .mockResolvedValueOnce({
          id: "restored-id",
          start: vi.fn().mockResolvedValue(undefined),
        }),
    });
    const si = makeSi();
    const systemConfig = { authMode: "single" };
    const adminData = { widgets: [{ id: "docker", type: "docker", data: { autoUpdate: true } }] };

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "system.json",
      atomicWrite: vi.fn().mockResolvedValue(undefined),
      updateContainerIdGlobally,
      healthCheck: { timeoutMs: 1000, intervalMs: 1 },
      sleep: () => Promise.resolve(),
    });

    expect(result.updates).toBe(0);
    expect(updateContainerIdGlobally).not.toHaveBeenCalled();
    expect(docker.createContainer).toHaveBeenCalledTimes(2);
  });

  it("always pulls for non-latest tags", async () => {
    const pull = vi.fn((imageName, cb) => cb(null, {}));
    const docker = makeDocker({
      pull,
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: "c1",
          Names: ["/c1"],
          Image: "nginx:stable",
          ImageID: "sha256:old",
          State: "running",
        },
      ]),
      getContainer: vi.fn((id) => ({
        inspect: vi.fn().mockResolvedValue(
          id === "new-container-id"
            ? {
                Config: { Image: "nginx:stable" },
                Image: "sha256:new",
                Name: "/c1",
                State: { Running: true, Status: "running" },
                HostConfig: {},
                NetworkSettings: { Networks: {} },
              }
            : {
                Config: { Image: "nginx:stable" },
                Image: "sha256:old",
                Name: "/c1",
                State: { Running: true, Status: "running" },
                HostConfig: {},
                NetworkSettings: { Networks: {} },
              },
        ),
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      })),
      getImage: vi.fn(() => ({
        inspect: vi
          .fn()
          .mockResolvedValue({ Id: "sha256:new", RepoDigests: ["nginx@sha256:newd"] }),
        distributionInspect: vi.fn((cb) =>
          cb(null, { Descriptor: { digest: "sha256:remote-newd" } }),
        ),
        remove: vi.fn().mockResolvedValue(undefined),
      })),
      createContainer: vi.fn().mockResolvedValue({
        id: "new-container-id",
        start: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const si = makeSi();
    const systemConfig = { authMode: "single" };
    const adminData = { widgets: [{ id: "docker", type: "docker", data: { autoUpdate: true } }] };

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "system.json",
      atomicWrite: vi.fn().mockResolvedValue(undefined),
      updateContainerIdGlobally: vi.fn(),
      healthCheck: { timeoutMs: 1000, intervalMs: 1 },
      sleep: () => Promise.resolve(),
    });

    expect(result.updates).toBe(1);
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("skips container if it is in disabledContainers list", async () => {
    const docker = makeDocker({
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: "c1",
          Names: ["/c1"],
          Image: "nginx:latest",
          ImageID: "sha256:old",
          State: "running",
        },
      ]),
    });
    const si = makeSi();
    const systemConfig = { authMode: "single" };
    const adminData = {
      widgets: [
        {
          id: "docker",
          type: "docker",
          data: { autoUpdate: true, disabledContainers: ["c1"] },
        },
      ],
    };

    const result = await runAutoUpdateTick({
      docker,
      si,
      systemConfig,
      adminData,
      systemConfigFilePath: "system.json",
      atomicWrite: vi.fn().mockResolvedValue(undefined),
      updateContainerIdGlobally: vi.fn(),
    });

    expect(result.updates).toBe(0);
    expect(result.pulls).toBe(0);
    expect(docker.pull).not.toHaveBeenCalled();
  });
});
