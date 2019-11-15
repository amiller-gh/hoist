# Hoist
Upload and host static websites in Google Storage Buckets.

```bash
yarn global add @cannery/hoist
# or
npm install -g @cannery/hoist
```

Hoist understands, and automatically pre-processes for production, the following file types out of the box:
 - HTML
   File URLs replaced with hashed CDN names and minified for production
 - CSS
   File URLs replaced with hashed CDN names, autoprefixer applied with default settings, minified for production, and file name is hashed for CDN cache busting.
 - JavaScript
   Minified for production and file name is hashed for CDN cache busting.
 - JPEG, PNG, GIF
   Compressed, and file names are hashed for CDN cache busting.
 - SVG, Ico, BMP, WebP
   File names are hashed for CDN cache busting

All other files discovered are uploaded as-is to the hosting provider. All files are gzipped as they are uploaded and appropriate cache-key headers are set. 

## CLI Usage
Hoist comes with just two commands:

```bash
$ hoist up [directory]
$ hoist down
```

`hoist up` will make your site public to the world. If you pass a directory as the second CLI argument it will upload that directory to your production site.

`hoist down` will make your site private, nobody will be able to see files in the Google Storage Bucket.

## Configuration
Hoist needs a [Service Account](https://cloud.google.com/iam/docs/creating-managing-service-accounts) and a [Service Account Key](https://cloud.google.com/iam/docs/creating-managing-service-account-keys) with Storage Bucket management permissions to operate.

When you run Hoist from the CLI, it will crawl up directories until it finds a `gcloud.json` file with the Service Account Key and attempt to use it for authentication. To configure the bucket that the site will upload to, add a single `bucket` field to this `gcloud.json` file with the target bucket name.

Once configured, your `gcloud.json` file should look something like this:

```json
{
  "type": "service_account",
  "project_id": "projectid",
  "bucket": "bucketname.com",

  "private_key_id": "01234567890123456789",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "name@projectid.iam.gserviceaccount.com",
  "client_id": "01234567890123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/name%40projectid.iam.gserviceaccount.com"
}
```