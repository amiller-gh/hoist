import minimatch from 'minimatch';

/**
 * Evaluates whether a configured redirect/rewrite/custom header should
 * be applied to a request against a specific path. All three features
 * are configured with a hash that contains either a Node-like glob path
 * specification as its `source` or `glob` field, or a regular expression
 * as its `regex` field.
 *
 * No special consideration is taken if the configuration hash contains both
 * a glob and a regex. normalizeConfig() will error in that case.
 *
 * @param {string} path The URL path from the request.
 * @param {Object} config A dictionary from a sanitized JSON configuration.
 * @return {boolean} Whether the config should be applied to the request.
 */
export function configMatcher(path: string, config: any) {
  const glob = config.glob || config.source;
  const regex = config.regex;
  if (glob) { return minimatch(path, glob); }
  if (regex) { return path.match(new RegExp(regex, "u")) !== null; }
  return false;
}
