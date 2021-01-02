
import { IConfig } from './getConfig';
import { GoogleCloudBucketProvider, HostingEmulator, HostingProvider  } from './providers';

let host: HostingProvider<unknown> | null = null;

export default async function initBucket(config: IConfig, bucketName: string): Promise<HostingProvider<unknown>> {
  if (host) { return host; }
  config.project_id = config.projectId = process.env.PROJECT_ID || config.project_id || config.projectId;
  if (process.env.HOIST_EMULATE) { host = new HostingEmulator(bucketName, config); }
  else { host = new GoogleCloudBucketProvider(bucketName, config); }
  return await host.init();
}
