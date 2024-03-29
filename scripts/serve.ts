import * as https from 'https';
import * as http from 'http';
import * as urlParser from 'url';

import * as devcert from 'devcert';
import express from 'express';
import { createHttpTerminator } from 'http-terminator';
import open from 'open';
import { getPortPromise as getPort } from 'portfinder';
import mime from 'mime-types';
import * as hostile from 'hostile';
import * as sudo from 'sudo-prompt';
import isPortUsed from 'tcp-port-used';
import slasher from 'glob-slasher';
import ProxyServer, { createProxyServer } from 'http-proxy';

import { getConfig, IRedirect, IRewrite } from './getConfig';
import * as patterns from './patterns';

export interface HoistServer {
  root: string;
  url: string;
  isPublic(): boolean;
  isPrivate(): boolean;
  makePublic(): boolean;
  makePrivate(): boolean;
  stop(): Promise<void>;
}

function setHeaders(res: express.Response, file: string) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (file.endsWith('.br')) {
    res.setHeader('Content-Encoding', 'brotli');
    var type = mime.lookup(file.slice(0, -3));
    var charset = type && mime.charset(type);
    res.setHeader("Content-Type", type + (charset ? "; charset=" + charset : ""));
  }
  if (file.endsWith('.gz')) {
    res.setHeader('Content-Encoding', 'gzip');
    var type = mime.lookup(file.slice(0, -3));
    var charset = type && mime.charset(type);
    res.setHeader("Content-Type", type + (charset ? "; charset=" + charset : ""));
  }
}

function matcher(url: string, queries: IRedirect[]): IRedirect | null;
function matcher(url: string, queries: IRewrite[]): IRewrite | null;
function matcher(url: string, queries: IRedirect[] | IRewrite[]): IRewrite | IRedirect | null  {
  for (let i = 0; i < queries.length; i++) {
    if (patterns.configMatcher(url, queries[i])) {
      return queries[i];
    }
  }
  return null;
};

export async function serve(root: string, autoOpen=true, configRoot?: string): Promise<HoistServer> {
  const app = express();
  let settings = await getConfig(configRoot || root);
  const url = new URL(settings.testDomain || settings['test_domain'] || 'https://hoist.test');
  const domain = url.hostname;
  let proxy: ProxyServer;

  // Get a unique port if the user specified, or default port for the protocol is taken.
  let port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
  port = (await isPortUsed.check(port)) ? await getPort({ port }) : port;
  url.port = `${port}`;

  let isPublic = true;
  app.use((_req, res, next) => {
    if (!isPublic) {
      res.status(401).json({ status: 'error', code: 401, message: 'Unauthorized.'});
      return;
    }

    next();
  });

  app.use((req, res, next) => {
    const pathname = urlParser.parse(req.url).pathname;
    const match = pathname ? matcher(slasher(pathname), settings.rewrites) : false;
    if (match) {
      if (match.destination.startsWith('http://') || match.destination.startsWith('https://')) {
        try {
          proxy.web(req, res, { target: match.destination });
        } catch(err) {
          console.error(err);
          throw err;
        }
      }
      else {
        req.originalUrl = match.destination;
        req.url = match.destination;
        res.status(200);
      }
    }
    next();
  });

  app.use((req, res, next) => {
    const pathname = urlParser.parse(req.url).pathname;
    const match = pathname ? matcher(slasher(pathname), settings.redirects) : false;
    if (match) {
      req.originalUrl = match.destination;
      req.url = match.destination;
      res.status(match.type || 301).redirect(match.destination);
    }
    next();
  });

  app.use(express.static(root, {
    setHeaders,
    redirect: false,
    extensions: [
      // Text Based Files
      // Check for local GZip and Brotli versions of these.
      'html.br', 'htm.br', 'css.br', 'js.br', 'json.br', 'svg.br', 'md.br', 'txt.br',
      'html.gz', 'htm.gz', 'css.gz', 'js.gz', 'json.gz', 'svg.gz', 'md.gz', 'txt.gz',
      'html', 'htm', 'css', 'js', 'json', 'svg', 'md', 'txt',

      // Font Formats
      // Check for local GZip and Brotli versions of these.
      'woff.br', 'woff2.br', 'eot.br', 'ttf.br', 'otf.br',
      'woff.gz', 'woff2.gz', 'eot.gz', 'ttf.gz', 'otf.gz',
      'woff', 'woff2', 'eot', 'ttf', 'otf',

      // Binary Files. These will not be compressed so no need to check.
      'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'bin'
    ],
  }));

  // Try Local GZip Files. Express.static will not try fallback extensions if a valid extension is present, so we force it to try.
  app.use((req, _, next) => { req.originalUrl += '.gz'; req.url += '.gz'; next(); });
  app.use(express.static(root, { setHeaders, redirect: false }));

  // Try Local Brotli Files. Express.static will not try fallback extensions if a valid extension is present, so we force it to try.
  app.use((req, _, next) => { req.originalUrl = req.originalUrl.slice(0, -3) + '.br'; req.url = req.url.slice(0, -3) + '.br'; next(); });
  app.use(express.static(root, { setHeaders, redirect: false }));

  // For logging purposes, set the request url back to normal if we didn't find anything.
  app.use((req, _, next) => { req.originalUrl = req.originalUrl.slice(0, -3); req.url = req.url.slice(0, -3); next(); });

  let server: http.Server | https.Server;

  if (url.protocol === 'https:') {
    // If we don't have a dev certificate installed for this domain already, print a warning.
    if (!devcert.hasCertificateFor(domain)){
      console.log('Installing SSL Cert, This May Take a Moment');
    }

    // Ensure we have a dev certificate installed for this domain.
    const devcertOptions: devcert.Options = {};
    if (process.env.HOIST_WINDOWS_CERT_PASSWORD) {
      devcertOptions.ui = {
        getWindowsEncryptionPassword: async() => {
          return process.env.HOIST_WINDOWS_CERT_PASSWORD as string;
        }
      } as devcert.Options["ui"];
    }
    const ssl = await devcert.certificateFor(domain, {...devcertOptions, ...{ getCaPath: true }}); // For Typescript...

    // If we want this Node.js process to request files via `https` or `Request` from this server, we need to add the Certificate Authority.
    // https://stackoverflow.com/questions/29283040/how-to-add-custom-certificate-authority-ca-to-nodejs
    require('syswide-cas').addCAs(ssl.caPath);

    // Start the server!
    server = https.createServer(ssl, app).listen(port, () => console.log(`Static site "${root}" serving at ${url}!`));
    proxy = createProxyServer({
      secure: true,
      ssl: { key: ssl.key, cert: ssl.cert },
    });
  }

  else {
    // Ensure our test domain points to the loopback interface.
    const lines = hostile.get(false);
    let discovered = false;
    for (const line of lines) {
      discovered = discovered || line[1] === url.hostname;
    }
    if (!discovered) {
      await new Promise((resolve) => sudo.exec(`hostile set 127.0.0.1 ${url.hostname}`, { name: 'Hoist' }, resolve));
    }

    // Start the server!
    server = http.createServer(app).listen(port, () => console.log(`Static site "${root}" serving at ${url}!`));
    proxy = createProxyServer({});
  }


  const terminator = createHttpTerminator({ server });

  // Auto open the page if requested.
  if (autoOpen) {
    await open(url.toString());
  }

  return {
    root,
    url: url.toString(),
    isPublic: () => isPublic,
    isPrivate: () => !isPublic,
    makePublic: () => isPublic = true,
    makePrivate: () => isPublic = false,
    stop: () => { proxy.close(); return terminator.terminate();  },
  };
}
