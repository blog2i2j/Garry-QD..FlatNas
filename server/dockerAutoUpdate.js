export function getAutoUpdateSettingsFromAdminData(adminData) {
  const dockerWidget = adminData?.widgets?.find((w) => w.type === "docker" || w.id === "docker");
  const data = dockerWidget?.data || {};
  const enabled = Boolean(data.autoUpdate);
  const keepImagesRaw = data.autoUpdateKeepImages;
  const keepImages = Number.isFinite(Number(keepImagesRaw))
    ? Math.max(1, Math.min(20, Math.floor(Number(keepImagesRaw))))
    : 2;

  const minFreeGbRaw = data.autoUpdateMinFreeGB;
  const minFreeBytes = Number.isFinite(Number(minFreeGbRaw))
    ? Math.max(0, Number(minFreeGbRaw)) * 1024 * 1024 * 1024
    : 5 * 1024 * 1024 * 1024;

  const maxPruneRaw = data.autoUpdateMaxPrunePerRun;
  const maxPrunePerRun = Number.isFinite(Number(maxPruneRaw))
    ? Math.max(0, Math.min(200, Math.floor(Number(maxPruneRaw))))
    : 30;

  return { enabled, keepImages, minFreeBytes, maxPrunePerRun };
}

export function ensureDockerAutoUpdateState(systemConfig) {
  if (!systemConfig || typeof systemConfig !== "object") return;
  if (!systemConfig.dockerAutoUpdate || typeof systemConfig.dockerAutoUpdate !== "object") {
    systemConfig.dockerAutoUpdate = {};
  }
  if (
    !systemConfig.dockerAutoUpdate.history ||
    typeof systemConfig.dockerAutoUpdate.history !== "object"
  ) {
    systemConfig.dockerAutoUpdate.history = { images: {} };
  }
  if (
    !systemConfig.dockerAutoUpdate.history.images ||
    typeof systemConfig.dockerAutoUpdate.history.images !== "object"
  ) {
    systemConfig.dockerAutoUpdate.history.images = {};
  }
}

export function updateImageHistory(systemConfig, imageName, imageId, maxLen = 50) {
  ensureDockerAutoUpdateState(systemConfig);
  if (!imageName || !imageId) return false;
  const images = systemConfig.dockerAutoUpdate.history.images;
  const list = Array.isArray(images[imageName]) ? images[imageName] : [];
  const next = [imageId, ...list.filter((x) => x && x !== imageId)];
  const trimmed = next.slice(0, Math.max(1, maxLen));
  images[imageName] = trimmed;
  return true;
}

export function computePruneCandidates({ historyIds, keepImages, usedImageIds }) {
  const hist = Array.isArray(historyIds) ? historyIds.filter(Boolean) : [];
  const keep = Number.isFinite(Number(keepImages))
    ? Math.max(0, Math.floor(Number(keepImages)))
    : 0;
  const used = usedImageIds instanceof Set ? usedImageIds : new Set();
  if (keep <= 0) return [];
  const candidates = hist.slice(keep).filter((id) => !used.has(id));
  const uniq = [];
  const seen = new Set();
  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  return uniq;
}

export async function getDockerRootFreeBytes({ docker, si }) {
  try {
    const info = await docker.info();
    const root = info && typeof info.DockerRootDir === "string" ? info.DockerRootDir : "";
    const disks = await si.fsSize();
    if (!Array.isArray(disks) || !disks.length) return { rootPath: root, freeBytes: null };

    const norm = (p) =>
      String(p || "")
        .replace(/\\/g, "/")
        .toLowerCase();
    const rootNorm = norm(root);
    let best = null;
    let bestLen = -1;

    for (const d of disks) {
      const mount = norm(d.mount);
      if (!mount) continue;
      const match =
        (rootNorm && rootNorm.startsWith(mount)) ||
        (!rootNorm && mount.length === 2 && mount[1] === ":");
      if (!match) continue;
      if (mount.length > bestLen) {
        best = d;
        bestLen = mount.length;
      }
    }

    if (!best) {
      best = disks[0];
    }

    const freeBytes =
      Number.isFinite(Number(best.available)) && Number(best.available) >= 0
        ? Number(best.available)
        : null;
    return { rootPath: root, freeBytes };
  } catch {
    return { rootPath: "", freeBytes: null };
  }
}

export async function pullImageWithTimeout(docker, imageName, { idleTimeoutMs, totalTimeoutMs }) {
  const idleMs = Number.isFinite(Number(idleTimeoutMs))
    ? Math.max(1000, Number(idleTimeoutMs))
    : 60000;
  const totalMs = Number.isFinite(Number(totalTimeoutMs))
    ? Math.max(idleMs, Number(totalTimeoutMs))
    : 600000;

  return await new Promise((resolve, reject) => {
    let timedOut = false;
    let idleTimer = null;
    let totalTimer = null;

    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        cleanup();
        reject(new Error("Idle timeout pulling image"));
      }, idleMs);
    };

    totalTimer = setTimeout(() => {
      timedOut = true;
      cleanup();
      reject(new Error("Total timeout pulling image"));
    }, totalMs);

    resetIdleTimer();

    docker.pull(imageName, (err, stream) => {
      if (timedOut) return;
      if (err) {
        cleanup();
        return reject(err);
      }
      docker.modem.followProgress(
        stream,
        (err, output) => {
          cleanup();
          if (timedOut) return;
          if (err) return reject(err);
          resolve(output);
        },
        () => {
          if (!timedOut) resetIdleTimer();
        },
      );
    });
  });
}

export async function pruneImagesById({ docker, imageIds, usedImageIds, limit }) {
  const used = usedImageIds instanceof Set ? usedImageIds : new Set();
  const ids = Array.isArray(imageIds) ? imageIds.filter(Boolean) : [];
  const max = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 0;
  const removed = [];
  const failed = [];
  for (const id of ids) {
    if (max > 0 && removed.length >= max) break;
    if (used.has(id)) continue;
    try {
      await docker.getImage(id).remove();
      removed.push(id);
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { removed, failed };
}

export async function runAutoUpdateTick({
  docker,
  si,
  systemConfig,
  adminData,
  systemConfigFilePath,
  atomicWrite,
  updateContainerIdGlobally,
}) {
  const settings = getAutoUpdateSettingsFromAdminData(adminData);
  if (!settings.enabled)
    return {
      enabled: false,
      ran: false,
      pulls: 0,
      updates: 0,
      pruned: 0,
      skippedDueToDisk: false,
      errors: [],
    };

  ensureDockerAutoUpdateState(systemConfig);

  const errors = [];
  let pulls = 0;
  let updates = 0;
  let pruned = 0;
  let skippedDueToDisk = false;
  let systemConfigDirty = false;

  const { freeBytes } = await getDockerRootFreeBytes({ docker, si });
  if (typeof freeBytes === "number" && freeBytes < settings.minFreeBytes) {
    skippedDueToDisk = true;
    return { enabled: true, ran: false, pulls, updates, pruned, skippedDueToDisk, errors };
  }

  let containers;
  try {
    containers = await docker.listContainers({ all: true });
  } catch (e) {
    errors.push({ scope: "listContainers", error: e instanceof Error ? e.message : String(e) });
    return { enabled: true, ran: false, pulls, updates, pruned, skippedDueToDisk, errors };
  }

  for (const c of containers) {
    if (c.State !== "running") continue;
    const name = Array.isArray(c.Names) && c.Names[0] ? c.Names[0] : "";
    if (
      String(c.Image || "").includes("flatnas") ||
      (Array.isArray(c.Names) && c.Names.some((n) => String(n).toLowerCase().includes("flatnas")))
    ) {
      continue;
    }

    try {
      const info = await docker.getContainer(c.Id).inspect();
      const imageName = info?.Config?.Image || c.Image;
      const currentImageId = info?.Image || c.ImageID;
      if (!imageName || String(imageName).startsWith("sha256:")) continue;

      await pullImageWithTimeout(docker, imageName, {
        idleTimeoutMs: 60000,
        totalTimeoutMs: 600000,
      });
      pulls++;

      const imageInfo = await docker.getImage(imageName).inspect();
      const newImageId = imageInfo?.Id;
      if (currentImageId) {
        if (updateImageHistory(systemConfig, imageName, currentImageId)) systemConfigDirty = true;
      }
      if (newImageId) {
        if (updateImageHistory(systemConfig, imageName, newImageId)) systemConfigDirty = true;
      }

      if (!newImageId || !currentImageId || currentImageId === newImageId) {
        continue;
      }

      const container = docker.getContainer(c.Id);
      await container.stop();
      await container.remove();

      const options = {
        name: String(info?.Name || "").replace(/^\//, ""),
        ...info.Config,
        HostConfig: info.HostConfig,
        NetworkingConfig: { EndpointsConfig: info.NetworkSettings.Networks },
      };
      options.Image = imageName;

      const newContainer = await docker.createContainer(options);
      await newContainer.start();
      updates++;

      await updateContainerIdGlobally(c.Id, newContainer.id, info.Name);

      let containersAfter;
      try {
        containersAfter = await docker.listContainers({ all: true });
      } catch {
        containersAfter = containers;
      }
      const usedAfter = new Set(containersAfter.map((x) => x.ImageID).filter(Boolean));
      const historyIds = systemConfig.dockerAutoUpdate.history.images[imageName] || [];
      const candidates = computePruneCandidates({
        historyIds,
        keepImages: settings.keepImages,
        usedImageIds: usedAfter,
      });

      const pruneRes = await pruneImagesById({
        docker,
        imageIds: candidates,
        usedImageIds: usedAfter,
        limit: settings.maxPrunePerRun,
      });
      pruned += pruneRes.removed.length;
      for (const f of pruneRes.failed) {
        errors.push({ scope: "pruneImage", imageId: f.id, error: f.error });
      }
    } catch (e) {
      errors.push({ scope: "container", name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (systemConfigDirty && systemConfigFilePath && atomicWrite) {
    try {
      await atomicWrite(systemConfigFilePath, JSON.stringify(systemConfig, null, 2));
    } catch (e) {
      errors.push({
        scope: "persistSystemConfig",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { enabled: true, ran: true, pulls, updates, pruned, skippedDueToDisk, errors };
}
