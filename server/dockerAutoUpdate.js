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

export function parseImageReference(imageRef) {
  const raw = String(imageRef || "").trim();
  const at = raw.lastIndexOf("@");
  const base = at >= 0 ? raw.slice(0, at) : raw;
  const digest = at >= 0 ? raw.slice(at + 1) : "";
  const lastSlash = base.lastIndexOf("/");
  const lastColon = base.lastIndexOf(":");
  const hasTag = lastColon > lastSlash;
  const name = hasTag ? base.slice(0, lastColon) : base;
  const tag = hasTag ? base.slice(lastColon + 1) : "";
  return {
    raw,
    name,
    tag: tag || "",
    effectiveTag: tag || "latest",
    digest: digest || "",
    isDigestPinned: Boolean(digest),
  };
}

export function pickLocalRepoDigest(imageInspect, repoName) {
  const digs =
    imageInspect && Array.isArray(imageInspect.RepoDigests) ? imageInspect.RepoDigests : [];
  const repo = String(repoName || "").trim();
  if (!repo || !digs.length) return "";
  const exact = digs.find((d) => typeof d === "string" && d.startsWith(`${repo}@`));
  const any = exact || digs.find((d) => typeof d === "string" && d.includes("@"));
  if (!any) return "";
  const idx = any.lastIndexOf("@");
  return idx >= 0 ? any.slice(idx + 1) : "";
}

export async function getRemoteTagDigest({ docker, imageName, authconfig }) {
  const img = docker.getImage(imageName);
  return await new Promise((resolve, reject) => {
    const cb = (err, data) => {
      if (err) return reject(err);
      const digest =
        data && data.Descriptor && typeof data.Descriptor.digest === "string"
          ? data.Descriptor.digest
          : "";
      resolve(digest);
    };
    try {
      if (authconfig) {
        img.distributionInspect(authconfig, cb);
      } else {
        img.distributionInspect(cb);
      }
    } catch (e) {
      reject(e);
    }
  });
}

export function buildCreateOptionsFromInspect(info, containerName, imageRefOverride) {
  const name = String(containerName || "").replace(/^\//, "");
  const networks =
    info &&
    info.NetworkSettings &&
    info.NetworkSettings.Networks &&
    typeof info.NetworkSettings.Networks === "object"
      ? info.NetworkSettings.Networks
      : {};
  const options = {
    name,
    ...(info && info.Config ? info.Config : {}),
    HostConfig: (info && info.HostConfig) || {},
    NetworkingConfig: { EndpointsConfig: networks },
  };
  if (imageRefOverride) options.Image = imageRefOverride;
  return options;
}

export function getHealthStatus(info) {
  const health =
    info && info.State && info.State.Health && typeof info.State.Health.Status === "string"
      ? info.State.Health.Status
      : "";
  return String(health || "");
}

export async function waitForContainerReady({
  docker,
  containerId,
  timeoutMs,
  intervalMs,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const timeout = Number.isFinite(Number(timeoutMs)) ? Math.max(1000, Number(timeoutMs)) : 60000;
  const interval = Number.isFinite(Number(intervalMs)) ? Math.max(200, Number(intervalMs)) : 2000;
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const info = await docker.getContainer(containerId).inspect();
      last = info;
      const running = Boolean(info && info.State && info.State.Running);
      const status =
        info && info.State && typeof info.State.Status === "string" ? info.State.Status : "";
      const exitCode =
        info && info.State && Number.isFinite(Number(info.State.ExitCode))
          ? Number(info.State.ExitCode)
          : null;

      if (!running && status === "exited" && exitCode !== null && exitCode !== 0) {
        return { ok: false, reason: `exited:${exitCode}`, lastInspect: last };
      }
      const health = getHealthStatus(info);
      if (running && (!health || health === "healthy")) {
        return { ok: true, reason: health ? "healthy" : "running", lastInspect: last };
      }
      if (health === "unhealthy") {
        return { ok: false, reason: "unhealthy", lastInspect: last };
      }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e), lastInspect: last };
    }
    await sleep(interval);
  }
  return { ok: false, reason: "timeout", lastInspect: last };
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

export async function runAutoUpdateTick(opts) {
  const {
    docker,
    si,
    systemConfig,
    adminData,
    systemConfigFilePath,
    atomicWrite,
    updateContainerIdGlobally,
    appendAuditLog,
    authconfig,
    healthCheck,
    sleep,
  } = opts || {};
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

  const tickId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeAppendAudit = async (entry) => {
    if (!appendAuditLog) return;
    try {
      await appendAuditLog(entry);
    } catch {}
  };

  const errors = [];
  let pulls = 0;
  let updates = 0;
  let pruned = 0;
  let skippedDueToDisk = false;
  let systemConfigDirty = false;

  const { freeBytes } = await getDockerRootFreeBytes({ docker, si });
  if (typeof freeBytes === "number" && freeBytes < settings.minFreeBytes) {
    skippedDueToDisk = true;
    await safeAppendAudit({
      ts: Date.now(),
      kind: "dockerAutoUpdateTick",
      tickId,
      enabled: true,
      skippedDueToDisk: true,
      minFreeBytes: settings.minFreeBytes,
      freeBytes,
    });
    return { enabled: true, ran: false, pulls, updates, pruned, skippedDueToDisk, errors };
  }

  let containers;
  try {
    containers = await docker.listContainers({ all: true });
  } catch (e) {
    errors.push({ scope: "listContainers", error: e instanceof Error ? e.message : String(e) });
    await safeAppendAudit({
      ts: Date.now(),
      kind: "dockerAutoUpdateTick",
      tickId,
      enabled: true,
      ran: false,
      error: e instanceof Error ? e.message : String(e),
    });
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
      const opStartedAt = Date.now();
      const info = await docker.getContainer(c.Id).inspect();
      const imageName = info?.Config?.Image || c.Image;
      const currentImageId = info?.Image || c.ImageID;
      if (!imageName || String(imageName).startsWith("sha256:")) continue;

      const parsed = parseImageReference(imageName);
      const containerName = String(info?.Name || name).replace(/^\//, "");

      if (parsed.isDigestPinned) {
        await safeAppendAudit({
          ts: Date.now(),
          kind: "dockerAutoUpdateContainer",
          tickId,
          containerId: c.Id,
          containerName,
          image: imageName,
          tagType: "digest",
          action: "skip",
          reason: "digest_pinned",
          currentImageId,
          durationMs: Date.now() - opStartedAt,
        });
        continue;
      }

      const currentHealth = getHealthStatus(info);
      if (currentHealth && currentHealth !== "healthy") {
        await safeAppendAudit({
          ts: Date.now(),
          kind: "dockerAutoUpdateContainer",
          tickId,
          containerId: c.Id,
          containerName,
          image: imageName,
          tagType: parsed.effectiveTag === "latest" ? "latest" : "tag",
          action: "skip",
          reason: `precheck_${currentHealth}`,
          currentImageId,
          durationMs: Date.now() - opStartedAt,
        });
        continue;
      }

      let localDigest = "";
      let remoteDigest = "";
      let shouldPull = true;
      try {
        const localInspect = await docker.getImage(imageName).inspect();
        localDigest = pickLocalRepoDigest(localInspect, parsed.name);
      } catch {}

      if (parsed.effectiveTag === "latest") {
        try {
          remoteDigest = await getRemoteTagDigest({ docker, imageName, authconfig });
          if (remoteDigest && localDigest && remoteDigest === localDigest) {
            shouldPull = false;
          }
        } catch (e) {
          errors.push({
            scope: "digestCompare",
            image: imageName,
            error: e instanceof Error ? e.message : String(e),
          });
          shouldPull = true;
        }
      }

      if (shouldPull) {
        await pullImageWithTimeout(docker, imageName, {
          idleTimeoutMs: 60000,
          totalTimeoutMs: 600000,
        });
        pulls++;
      }

      const imageInfo = await docker.getImage(imageName).inspect();
      const newImageId = imageInfo?.Id;
      const newDigest = pickLocalRepoDigest(imageInfo, parsed.name);
      if (currentImageId) {
        if (updateImageHistory(systemConfig, imageName, currentImageId)) systemConfigDirty = true;
      }
      if (newImageId) {
        if (updateImageHistory(systemConfig, imageName, newImageId)) systemConfigDirty = true;
      }

      if (!newImageId || !currentImageId || currentImageId === newImageId) {
        await safeAppendAudit({
          ts: Date.now(),
          kind: "dockerAutoUpdateContainer",
          tickId,
          containerId: c.Id,
          containerName,
          image: imageName,
          tagType: parsed.effectiveTag === "latest" ? "latest" : "tag",
          action: shouldPull ? "checked" : "skipped",
          reason: currentImageId === newImageId ? "no_update" : "missing_image_id",
          currentImageId,
          newImageId: newImageId || "",
          localDigest,
          remoteDigest,
          newDigest,
          durationMs: Date.now() - opStartedAt,
        });
        continue;
      }

      const oldContainer = docker.getContainer(c.Id);
      const backupName = `${containerName}__flatnas_backup__${Date.now()}`;
      const backupOptions = buildCreateOptionsFromInspect(info, containerName, currentImageId);
      const newOptions = buildCreateOptionsFromInspect(info, containerName, imageName);
      let backupMode = "rename";

      try {
        await oldContainer.stop();
      } catch {}

      try {
        if (typeof oldContainer.rename === "function") {
          await oldContainer.rename({ name: backupName });
        } else {
          backupMode = "recreate";
        }
      } catch {
        backupMode = "recreate";
      }

      if (backupMode === "recreate") {
        try {
          await oldContainer.remove();
        } catch {}
      }

      let newContainer;
      try {
        newContainer = await docker.createContainer(newOptions);
        await newContainer.start();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        errors.push({ scope: "updateStart", container: containerName, error: errMsg });

        try {
          if (newContainer && newContainer.id) {
            try {
              await docker.getContainer(newContainer.id).stop();
            } catch {}
            try {
              await docker.getContainer(newContainer.id).remove();
            } catch {}
          }
        } catch {}

        if (backupMode === "rename") {
          try {
            await oldContainer.rename({ name: containerName });
          } catch {}
          try {
            await oldContainer.start();
          } catch {}
        } else {
          try {
            const restored = await docker.createContainer(backupOptions);
            await restored.start();
          } catch {}
        }

        await safeAppendAudit({
          ts: Date.now(),
          kind: "dockerAutoUpdateContainer",
          tickId,
          containerId: c.Id,
          containerName,
          image: imageName,
          tagType: parsed.effectiveTag === "latest" ? "latest" : "tag",
          action: "rollback",
          reason: "start_failed",
          error: errMsg,
          currentImageId,
          newImageId,
          localDigest,
          remoteDigest,
          newDigest,
          backupMode,
          durationMs: Date.now() - opStartedAt,
        });
        continue;
      }

      const waitRes = await waitForContainerReady({
        docker,
        containerId: newContainer.id,
        timeoutMs: healthCheck && healthCheck.timeoutMs,
        intervalMs: healthCheck && healthCheck.intervalMs,
        sleep,
      });

      if (!waitRes.ok) {
        const reason = waitRes.reason || "health_check_failed";
        errors.push({ scope: "healthCheck", container: containerName, error: reason });

        try {
          await docker.getContainer(newContainer.id).stop();
        } catch {}
        try {
          await docker.getContainer(newContainer.id).remove();
        } catch {}

        if (backupMode === "rename") {
          try {
            await oldContainer.rename({ name: containerName });
          } catch {}
          try {
            await oldContainer.start();
          } catch {}
          await waitForContainerReady({
            docker,
            containerId: c.Id,
            timeoutMs: healthCheck && healthCheck.timeoutMs,
            intervalMs: healthCheck && healthCheck.intervalMs,
            sleep,
          });
        } else {
          try {
            const restored = await docker.createContainer(backupOptions);
            await restored.start();
            await waitForContainerReady({
              docker,
              containerId: restored.id,
              timeoutMs: healthCheck && healthCheck.timeoutMs,
              intervalMs: healthCheck && healthCheck.intervalMs,
              sleep,
            });
          } catch {}
        }

        await safeAppendAudit({
          ts: Date.now(),
          kind: "dockerAutoUpdateContainer",
          tickId,
          containerId: c.Id,
          containerName,
          image: imageName,
          tagType: parsed.effectiveTag === "latest" ? "latest" : "tag",
          action: "rollback",
          reason,
          currentImageId,
          newImageId,
          localDigest,
          remoteDigest,
          newDigest,
          backupMode,
          durationMs: Date.now() - opStartedAt,
        });
        continue;
      }

      updates++;
      await updateContainerIdGlobally(c.Id, newContainer.id, info.Name);

      if (backupMode === "rename") {
        try {
          await docker.getContainer(c.Id).remove();
        } catch {}
      }

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

      await safeAppendAudit({
        ts: Date.now(),
        kind: "dockerAutoUpdateContainer",
        tickId,
        containerId: c.Id,
        containerName,
        image: imageName,
        tagType: parsed.effectiveTag === "latest" ? "latest" : "tag",
        action: "updated",
        currentImageId,
        newImageId,
        localDigest,
        remoteDigest,
        newDigest,
        backupMode,
        prune: { removed: pruneRes.removed, failed: pruneRes.failed },
        durationMs: Date.now() - opStartedAt,
      });
    } catch (e) {
      errors.push({ scope: "container", name, error: e instanceof Error ? e.message : String(e) });
      await safeAppendAudit({
        ts: Date.now(),
        kind: "dockerAutoUpdateContainer",
        tickId,
        containerId: c.Id,
        containerName: String(name || "").replace(/^\//, ""),
        image: String(c.Image || ""),
        action: "error",
        error: e instanceof Error ? e.message : String(e),
      });
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

  await safeAppendAudit({
    ts: Date.now(),
    kind: "dockerAutoUpdateTick",
    tickId,
    enabled: true,
    ran: true,
    pulls,
    updates,
    pruned,
    skippedDueToDisk,
    errors,
  });

  return { enabled: true, ran: true, pulls, updates, pruned, skippedDueToDisk, errors };
}
