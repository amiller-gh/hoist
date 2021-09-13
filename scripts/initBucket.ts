import * as path from 'path';
import { hoistCacheName } from './fileHash';

import { IConfig } from './getConfig';
import { GoogleCloudBucketProvider, HostingEmulator, HostingProvider  } from './providers';
import { CACHE_FILENAME, DELETE_FILENAME, SYSTEM_FILES } from './types';

let hosts: Record<string, HostingProvider<unknown>> = {};

export default async function initBucket(config: IConfig, directory: string, bucketName: string): Promise<HostingProvider<unknown>> {
  if (hosts[bucketName]) { return hosts[bucketName]; }
  const NOW = Date.now();
  config.project_id = config.projectId = process.env.PROJECT_ID || config.project_id || config.projectId;
  hosts[bucketName] = process.env.HOIST_EMULATE
    ? new HostingEmulator(bucketName, config)
    : new GoogleCloudBucketProvider(bucketName, config);
  const host = await hosts[bucketName].init();
  let toDelete = {};
  let fileCache = new Set();
  try { host.toDelete = await host.get<Record<string, number>>(path.posix.join(bucketName, DELETE_FILENAME)); } catch {}
  try { host.fileCache = new Set(await host.get<string[]>(path.posix.join(bucketName, CACHE_FILENAME))); } catch {}
  toDelete = toDelete || {};
  fileCache = fileCache && fileCache.size ? fileCache : new Set();

  for (let obj of await host.list(bucketName) || []) {
    if (SYSTEM_FILES.has(obj.name)) { continue; }

    const remoteName = path.posix.join(bucketName, obj.name);

    // Skip tracking remote files that aren't in our target upload directory.
    if (remoteName.indexOf(path.posix.join(bucketName, directory)) !== 0) { continue; }

    const cacheName = hoistCacheName(remoteName, obj.md5Hash);

    host.toDelete[cacheName] = host.toDelete[cacheName] || NOW;
  }

  return host;
}
