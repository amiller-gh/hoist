import { client, GoogleCloudClient, GoogleCloudBucket, GoogleBucketObject } from 'google-cloud-bucket';
import { IConfig } from '../getConfig';

import { FileDescriptor, HostingProvider, IHeaders } from './types';

function googleObjectToFileDesc(o: GoogleBucketObject): FileDescriptor {
  return {
    name: o.name,
    createdAt: new Date(o.timeCreated),
    updatedAt: new Date(o.updated),
    contentType: o.contentType,
    contentEncoding: undefined,
    cacheControl: undefined,
    contentSize: parseInt(o.size || '0') || 0,
    md5Hash: o.md5Hash,
    etag: o.etag,
  }
}

export class GoogleCloudBucketProvider extends HostingProvider<IConfig> {
  private client: GoogleCloudClient;
  private bucket!: GoogleCloudBucket;

  constructor(domain: string, auth: IConfig) {
    super(domain, auth);
    this.client = client.new({
      clientEmail: auth.client_email || auth.clientEmail,
      privateKey: auth.private_key || auth.privateKey,
      projectId: auth.projectId,
    });
  }

  async init() {

    if (!await this.client.exists(this.domain)) {
      console.log(`🕐 Creating bucket ${this.domain}.`);
      await this.client.bucket(this.domain).create({ location: 'us-west1' });
    }

    // CONFIGURE CORS ON A BUCKET (warning: Your service account must have the 'roles/this.client.admin' role)
    const bucket = this.bucket = this.client.bucket(this.domain);

    await bucket.cors.setup({
      origin: ['*'],
      method: ['GET', 'OPTIONS', 'HEAD', 'POST'],
      responseHeader: ['Authorization', 'Origin', 'X-Requested-With', 'Content-Type', 'Accept'],
      maxAgeSeconds: 3600
    });

    await bucket.website.setup({
      mainPageSuffix: 'index.html',
      notFoundPage: '404.html',
    });

    return this;
  }

  async makePublic() { await this.bucket.addPublicAccess(); }
  async makePrivate() { await this.bucket.removePublicAccess(); }
  async get<T extends any>(name: string) {
    return this.client.get<T>(name, { timeout: 520000 });
  }
  async list(name: string) {
    const res = await this.client.list(name, { timeout: 520000 });
    return res.map(googleObjectToFileDesc);
  }
  async delete(name: string) {
    await (await this.bucket.object(name)).delete();
    return true;
  }
  async upload(content: Buffer, name: string, headers: IHeaders):  Promise<FileDescriptor> {
    const res = await this.client.insert(content, name, {
      timeout: 520000,
      headers,
    });
    return googleObjectToFileDesc(res);
  }

}