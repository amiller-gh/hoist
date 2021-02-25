import * as fs from 'fs';
import findUp from 'find-up';

const CONFIG_FILENAME = 'gcloud.json';

export interface IConfig {
  type: string;
  cloudflare_token: string | undefined;
  bucket: string;
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
}

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
  return JSON.parse(fs.readFileSync(jsonKeyFile, 'utf8'));
}
