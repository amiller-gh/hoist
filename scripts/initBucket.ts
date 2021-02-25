
import { IConfig } from './getConfig';
import { GoogleCloudBucketProvider, HostingEmulator, HostingProvider  } from './providers';

let hosts: Record<string, HostingProvider<unknown>> = {};

export default async function initBucket(config: IConfig, bucketName: string): Promise<HostingProvider<unknown>> {
  if (hosts[bucketName]) { return hosts[bucketName]; }
  config.project_id = config.projectId = process.env.PROJECT_ID || config.project_id || config.projectId;
  hosts[bucketName] = process.env.HOIST_EMULATE
    ? new HostingEmulator(bucketName, config)
    : new GoogleCloudBucketProvider(bucketName, config);
  return await hosts[bucketName].init();
}
