import * as fs from 'fs';
import findUp from 'find-up';
import type { PackageJson } from 'type-fest';

const CONFIG_FILENAME = 'gcloud.json';

export type IRewrite = {
  source: string;
  destination: string;
} | {
  glob: string;
  destination: string;
} | {
  regexp: string;
  destination: string;
};

export interface IRedirect {
  source?: string;
  glob?: string;
  regexp?: string;
  destination: string;
  type: 301 | 302;
}

export interface IConfig {
  type: string;
  cloudflare_token: string | undefined;
  bucket: string;
  location: string;
  test_domain: string;
  testDomain: string;

  project_id: string;
  projectId: string;

  private_key: string;
  privateKey: string;

  client_email: string;
  clientEmail: string;

  private_key_id: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;

  rewrites: IRewrite[];
  redirects: IRedirect[];
}

type CustomPackageJson = PackageJson & { hoist?: IConfig };

export async function getConfig(cwd: string): Promise<IConfig> {
  if (process.env.HOIST_EMULATE) {
    const url = new URL(process.env.HOIST_EMULATE || 'https://hoist.test');
    const port = url.port || (url.protocol === 'https:' ? 443 : 80);
    return { bucket: [url.hostname, port].filter(Boolean).join('-'), testDomain: process.env.HOIST_EMULATE } as IConfig;
  }
  const jsonKeyFile = await findUp(CONFIG_FILENAME, { cwd });
  if (!jsonKeyFile) {
    throw new Error('Error: No gcloud.json config file found.');
  }

  const packageJsonFile = await findUp('package.json', { cwd });
  let packageJson: CustomPackageJson = {};
  try { packageJson = packageJsonFile ? JSON.parse(fs.readFileSync(packageJsonFile, 'utf8')) as CustomPackageJson : {}; }
  catch { 1; }
  const config = JSON.parse(fs.readFileSync(jsonKeyFile, 'utf8')) as IConfig;
  config.testDomain = config.testDomain || config.test_domain || packageJson?.hoist?.testDomain || packageJson.homepage || 'https://hoist.test';
  config.bucket = config.bucket || packageJson?.hoist?.testDomain || (packageJson.homepage ? new URL(packageJson.homepage).hostname : '');
  config.rewrites = packageJson?.hoist?.rewrites || [];
  config.redirects = packageJson?.hoist?.redirects || [];
  return config;
}
