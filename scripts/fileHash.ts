import * as crypto from 'crypto';
import * as fs from 'fs';

// https://tools.ietf.org/html/rfc4648#section-5
function md5toMd5url(hash: string) {
  return hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function fileHash(buffer: string | Buffer) {
  try {
    if (typeof buffer === 'string' && fs.existsSync(buffer)) { buffer = fs.readFileSync(buffer); }
  } catch (err) { console.error(err); }
  let hash = crypto.createHash('md5');
  hash.update(buffer);
  return hash.digest('base64');
}

// Compute the original file's base64url encoded hash based on file contents.
export function cdnFileName(buffer: string | Buffer) {
  if (typeof buffer === 'string') { buffer = fs.readFileSync(buffer); }
  let hash = crypto.createHash('md5');
  hash.update(buffer);
  return md5toMd5url(hash.digest('base64'));
}

// Compute the original file's base64url encoded hash, with the file name included.
export function hoistCacheName(fileName: string, buffer: string | Buffer) {
  let contentHash;
  if (typeof buffer !== 'string') {
    contentHash = crypto.createHash('md5');
    contentHash.update(buffer);
    contentHash = md5toMd5url(contentHash.digest('base64'));
  }
  else {
    contentHash = md5toMd5url(buffer);
  }

  let hash = crypto.createHash('md5');
  hash.update(Buffer.from(fileName + contentHash));
  return md5toMd5url(hash.digest('base64'));
}
