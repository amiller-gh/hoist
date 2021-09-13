import * as path from 'path';
import * as htmlMinify from 'html-minifier-terser';
import { HostingProvider } from '../providers';
import { getRemoteName, IFileDescriptor } from '../types';
import { gzip } from 'node-gzip';

export async function processHtml(hosting: HostingProvider<unknown>, filePath: string, buffer: Buffer, onArtifact: (file: IFileDescriptor) => Promise<any>): Promise<void> {
  buffer = Buffer.from(htmlMinify.minify(buffer.toString(), {
    caseSensitive: true,
    collapseBooleanAttributes: true,
    collapseInlineTagWhitespace: false,
    continueOnParseError: true,
    collapseWhitespace: true,
    decodeEntities: true,
    minifyCSS: true,
    minifyJS: true,
    minifyURLs: (url: string) => {
      console.log(url);
      const hash = hosting.files[url].hash;
      let fileName = path.posix.parse(url);
      fileName.base = hash;
      fileName.ext = '';
      return path.format(fileName);
      // for (let oldName of oldNames ) {
      //   let hashName = path.posix.format(hashNameObj);
      //   buffer = replace(buffer, `/${oldName}`, `/${hashName}`);
      //   const relativePath = path.posix.relative(path.posix.dirname(filePath), oldName);
      //   if (relativePath) {
      //     buffer = replace(buffer, `./${relativePath}`, `/${hashName}`);
      //     buffer = replace(buffer, relativePath, `/${hashName}`);
      //   }
      // }
    },
    quoteCharacter: `"`,
    removeAttributeQuotes: true,
    removeComments: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    sortAttributes: true,
    sortClassName: true,
    useShortDoctype: true,
  }));

  // Never cache HTML files. Always gzip them.
  onArtifact({
    filePath,
    remoteName: getRemoteName(hosting.domain, filePath, buffer),
    buffer: await gzip(buffer, { level: 8 }),
    contentType: 'image/jpeg',
    contentEncoding: 'gzip',
    cacheControl: 'public,max-age=0',
    contentSize: Buffer.byteLength(buffer),
  });
}
